import { describe, expect, it } from 'vitest';
import {
  buildDex,
  buildQuiz,
  canStudy,
  claimMission,
  collectionRate,
  completeStudy,
  deleteObservation,
  levelInfo,
  mergeStates,
  missionStatuses,
  nextMission,
  registerObservation,
  totalXp,
  weekKeyOf,
  xpThreshold,
} from '../src/domain/rules';
import { SPECIES } from '../src/domain/species';
import { emptyState, type AppState, type RegisterInput } from '../src/domain/types';

let seq = 0;
const makeId = () => `id-${(seq += 1)}`;
const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h, 0, 0);
const input = (speciesId: string, hash: string, region: string | null = null): RegisterInput => ({
  id: makeId(),
  speciesId,
  photoUri: `file:///${hash}.jpg`,
  photoHash: hash,
  region,
  lat: null,
  lng: null,
  source: 'ai',
});
const reg = (s: AppState, speciesId: string, hash: string, when: Date, region: string | null = null) =>
  registerObservation(s, input(speciesId, hash, region), when, makeId);

const LADYBUG = 'coccinella-septempunctata';
const MAGPIE = 'pica-serica';
const SPARROW = 'passer-montanus';

describe('종 데이터', () => {
  it('약 50종이고 id·번호·학명이 중복되지 않는다', () => {
    expect(SPECIES.length).toBe(51);
    expect(new Set(SPECIES.map((s) => s.id)).size).toBe(SPECIES.length);
    expect(new Set(SPECIES.map((s) => s.scientificName)).size).toBe(SPECIES.length);
    expect(new Set(SPECIES.map((s) => s.nameKo)).size).toBe(SPECIES.length);
    expect(SPECIES.map((s) => s.no)).toEqual(SPECIES.map((_, i) => i + 1));
  });
  it('모든 항목에 설명이 채워져 있다', () => {
    for (const s of SPECIES) {
      for (const f of [s.feature, s.habitat, s.season, s.role, s.similar, s.taxon]) expect(f.length).toBeGreaterThan(1);
    }
  });
});

describe('관찰 등록과 경험치', () => {
  it('신규 발견은 100점, 도감 카드 1단계가 생긴다', () => {
    const { state, result } = reg(emptyState(), LADYBUG, 'h1', at(2026, 11, 10));
    expect(result.ok).toBe(true);
    expect(result.isNewSpecies).toBe(true);
    expect(result.xpGained).toBe(100);
    expect(totalXp(state)).toBe(100);
    expect(buildDex(state)[LADYBUG]).toMatchObject({ observationCount: 1, stage: 1 });
    expect(collectionRate(state)).toMatchObject({ found: 1, total: 51, percent: 2 });
    expect(result.newAchievements).toContain('first');
  });

  it('같은 종을 다시 찍으면 카드가 늘지 않고 관찰 기록만 추가된다', () => {
    let s = reg(emptyState(), LADYBUG, 'h1', at(2026, 11, 10)).state;
    const r = reg(s, LADYBUG, 'h2', at(2026, 11, 11));
    s = r.state;
    expect(r.result.isNewSpecies).toBe(false);
    expect(r.result.xpGained).toBe(10);
    expect(Object.keys(buildDex(s))).toHaveLength(1);
    expect(s.observations).toHaveLength(2);
    expect(buildDex(s)[LADYBUG]).toMatchObject({ observationCount: 2, stage: 2 });
    expect(totalXp(s)).toBe(110);
  });

  it('처음 발견한 날의 추가 촬영은 기록되지만 점수는 없다', () => {
    let s = reg(emptyState(), LADYBUG, 'h1', at(2026, 11, 10, 9)).state;
    const r = reg(s, LADYBUG, 'h2', at(2026, 11, 10, 15));
    expect(r.result.ok).toBe(true);
    expect(r.result.xpGained).toBe(0);
    expect(r.state.observations).toHaveLength(2);
    expect(buildDex(r.state)[LADYBUG].stage).toBe(1);
  });

  it('재관찰 점수는 종마다 하루 한 번만 준다', () => {
    let s = reg(emptyState(), LADYBUG, 'h1', at(2026, 11, 10)).state;
    s = reg(s, LADYBUG, 'h2', at(2026, 11, 11, 9)).state;
    const r = reg(s, LADYBUG, 'h3', at(2026, 11, 11, 15));
    expect(r.result.xpGained).toBe(0);
    expect(totalXp(r.state)).toBe(110);
  });

  it('같은 사진은 다시 등록할 수 없다', () => {
    const s = reg(emptyState(), LADYBUG, 'h1', at(2026, 11, 10)).state;
    const r = reg(s, MAGPIE, 'h1', at(2026, 11, 11));
    expect(r.result.ok).toBe(false);
    expect(r.result.reason).toBe('duplicate_photo');
    expect(r.state).toBe(s);
  });

  it('도감에 없는 종은 등록할 수 없다', () => {
    const r = reg(emptyState(), 'not-a-species', 'h1', at(2026, 11, 10));
    expect(r.result.ok).toBe(false);
    expect(r.result.reason).toBe('unknown_species');
  });

  it('기록을 지우고 다시 등록해도 신규 발견 점수를 다시 받지 못한다', () => {
    let s = reg(emptyState(), LADYBUG, 'h1', at(2026, 11, 10)).state;
    s = deleteObservation(s, s.observations[0].id);
    expect(buildDex(s)[LADYBUG]).toBeUndefined();
    expect(totalXp(s)).toBe(100);
    const r = reg(s, LADYBUG, 'h2', at(2026, 11, 10, 12));
    expect(r.result.xpGained).toBe(0);
    expect(totalXp(r.state)).toBe(100);
  });

  it('다른 지역에서 관찰해도 2단계가 된다', () => {
    let s = reg(emptyState(), MAGPIE, 'h1', at(2026, 11, 10, 9), '서울 마포구').state;
    s = reg(s, MAGPIE, 'h2', at(2026, 11, 10, 15), '경기 고양시').state;
    expect(buildDex(s)[MAGPIE].stage).toBe(2);
  });
});

describe('레벨', () => {
  it('누적 경험치 기준으로 레벨이 오른다', () => {
    expect(xpThreshold(2)).toBe(200);
    expect(levelInfo(0)).toMatchObject({ level: 1, title: '새싹 탐험가', xpIntoLevel: 0, xpForNext: 200 });
    expect(levelInfo(199).level).toBe(1);
    expect(levelInfo(200).level).toBe(2);
    expect(levelInfo(600)).toMatchObject({ level: 3, title: '동네 관찰자' });
    expect(levelInfo(2000).level).toBe(5);
  });
  it('등록 결과에 레벨 변화가 담긴다', () => {
    let s = reg(emptyState(), LADYBUG, 'h1', at(2026, 11, 10)).state;
    const r = reg(s, MAGPIE, 'h2', at(2026, 11, 10));
    expect(r.result.levelBefore).toBe(1);
    expect(r.result.levelAfter).toBe(2);
  });
});

describe('생태 탐구(3단계)', () => {
  const stage2 = () => {
    let s = reg(emptyState(), LADYBUG, 'h1', at(2026, 11, 10)).state;
    s = reg(s, LADYBUG, 'h2', at(2026, 11, 11)).state;
    return s;
  };
  it('모든 종의 퀴즈는 3문항이고 보기가 서로 다르며 정답이 그 종의 정보다', () => {
    for (const sp of SPECIES) {
      const quiz = buildQuiz(sp.id);
      expect(quiz).toHaveLength(3);
      for (const q of quiz) {
        expect(q.choices).toHaveLength(3);
        expect(new Set(q.choices).size).toBe(3);
        expect([sp.feature, sp.habitat, sp.role]).toContain(q.choices[q.answerIndex]);
      }
    }
  });
  it('재관찰 전에는 탐구할 수 없다', () => {
    const s = reg(emptyState(), LADYBUG, 'h1', at(2026, 11, 10)).state;
    expect(canStudy(s, LADYBUG)).toBe(false);
    const answers = buildQuiz(LADYBUG).map((q) => q.answerIndex);
    expect(completeStudy(s, LADYBUG, answers, at(2026, 11, 10), makeId).ok).toBe(false);
  });
  it('오답이면 완료되지 않는다', () => {
    const s = stage2();
    const wrong = buildQuiz(LADYBUG).map((q) => (q.answerIndex + 1) % 3);
    expect(completeStudy(s, LADYBUG, wrong, at(2026, 11, 11), makeId).ok).toBe(false);
  });
  it('정답이면 300점과 3단계, 다시 해도 점수는 한 번뿐', () => {
    const s = stage2();
    const answers = buildQuiz(LADYBUG).map((q) => q.answerIndex);
    const r = completeStudy(s, LADYBUG, answers, at(2026, 11, 11), makeId);
    expect(r.ok).toBe(true);
    expect(r.xpGained).toBe(300);
    expect(buildDex(r.state)[LADYBUG].stage).toBe(3);
    expect(r.newAchievements).toContain('study1');
    const again = completeStudy(r.state, LADYBUG, answers, at(2026, 11, 12), makeId);
    expect(again.ok).toBe(false);
    expect(totalXp(again.state)).toBe(totalXp(r.state));
  });
});

describe('미션', () => {
  it('주간 키는 월요일 날짜다', () => {
    expect(weekKeyOf(at(2026, 11, 10))).toBe('2026-11-09'); // 화요일
    expect(weekKeyOf(at(2026, 11, 15))).toBe('2026-11-09'); // 일요일
    expect(weekKeyOf(at(2026, 11, 16))).toBe('2026-11-16'); // 월요일
  });
  it('관찰에 따라 진행도가 오르고 보상은 기간마다 한 번만 받는다', () => {
    const day = at(2026, 11, 10);
    let s = emptyState();
    expect(missionStatuses(s, day).every((m) => m.progress === 0)).toBe(true);
    expect(claimMission(s, 'd_log', day, makeId).ok).toBe(false);

    s = reg(s, LADYBUG, 'h1', day).state;
    const st = Object.fromEntries(missionStatuses(s, day).map((m) => [m.id, m]));
    expect(st.d_log.completed).toBe(true);
    expect(st.d_new.completed).toBe(true);
    expect(st.d_three).toMatchObject({ progress: 1, completed: false });
    expect(st.w_groups.progress).toBe(1);

    const c1 = claimMission(s, 'd_log', day, makeId);
    expect(c1).toMatchObject({ ok: true, xpGained: 150 });
    const c2 = claimMission(c1.state, 'd_log', day, makeId);
    expect(c2.ok).toBe(false);
    expect(totalXp(c2.state)).toBe(250);
    expect(claimMission(c1.state, 'd_three', day, makeId).ok).toBe(false);
  });
  it('일일 미션은 다음 날 초기화된다', () => {
    const day = at(2026, 11, 10);
    let s = reg(emptyState(), LADYBUG, 'h1', day).state;
    s = claimMission(s, 'd_log', day, makeId).state;
    const tomorrow = at(2026, 11, 11);
    const st = missionStatuses(s, tomorrow).find((m) => m.id === 'd_log')!;
    expect(st).toMatchObject({ progress: 0, completed: false, claimed: false });
    s = reg(s, LADYBUG, 'h2', tomorrow).state;
    expect(claimMission(s, 'd_log', tomorrow, makeId).ok).toBe(true);
  });
  it('주간 미션: 곤충과 새를 모두 관찰하면 완료', () => {
    const day = at(2026, 11, 10);
    let s = reg(emptyState(), LADYBUG, 'h1', day).state;
    s = reg(s, SPARROW, 'h2', at(2026, 11, 12)).state;
    const st = missionStatuses(s, at(2026, 11, 12)).find((m) => m.id === 'w_groups')!;
    expect(st.completed).toBe(true);
    expect(claimMission(s, 'w_groups', at(2026, 11, 12), makeId).xpGained).toBe(300);
    expect(missionStatuses(s, at(2026, 11, 17)).find((m) => m.id === 'w_groups')!.progress).toBe(0);
  });
  it('다음 미션을 안내한다', () => {
    const day = at(2026, 11, 10);
    const s = reg(emptyState(), LADYBUG, 'h1', day).state;
    const m = nextMission(s, day);
    expect(m).not.toBeNull();
    expect(m!.completed).toBe(false);
  });
});

describe('확장 도감', () => {
  const spider: import('../src/domain/types').Species = {
    id: 'x-araneus-ventricosus',
    kind: 'ext',
    no: 1001,
    nameKo: '산왕거미',
    scientificName: 'Araneus ventricosus',
    group: 'other',
    taxon: '거미목 왕거미과',
    tier: 'explore',
    icon: 'spider',
    feature: '큰 둥근 거미줄을 친다.',
    habitat: '숲 가장자리, 처마 밑',
    season: '여름~가을',
    role: '날벌레를 잡아먹는다.',
    similar: '왕거미와 비슷하다.',
  };
  const regExt = (s: AppState, hash: string, when: Date, ext?: typeof spider) =>
    registerObservation(s, { ...input(spider.id, hash), ext }, when, makeId);

  it('서버가 준 종 정보와 함께면 등록되고, 종 정보가 저장된다', () => {
    const r = regExt(emptyState(), 'e1', at(2026, 11, 10), spider);
    expect(r.result).toMatchObject({ ok: true, isNewSpecies: true, xpGained: 100 });
    expect(r.state.extSpecies[spider.id]).toEqual(spider);
    expect(r.result.newAchievements).toContain('ext1');
  });
  it('종 정보 없이 모르는 id는 등록할 수 없다', () => {
    expect(regExt(emptyState(), 'e1', at(2026, 11, 10)).result.reason).toBe('unknown_species');
  });
  it('기본 종을 확장 종으로 위장할 수 없다', () => {
    const fake = { ...spider, id: 'x-other', kind: 'ext' as const };
    expect(regExt(emptyState(), 'e1', at(2026, 11, 10), fake).result.reason).toBe('unknown_species');
    const coreKind = { ...spider, kind: 'core' as const };
    expect(regExt(emptyState(), 'e1', at(2026, 11, 10), coreKind).result.reason).toBe('unknown_species');
  });
  it('한 번 받은 확장 종은 다음부터 종 정보 없이도 재관찰된다', () => {
    let s = regExt(emptyState(), 'e1', at(2026, 11, 10), spider).state;
    const r = regExt(s, 'e2', at(2026, 11, 11));
    expect(r.result).toMatchObject({ ok: true, isNewSpecies: false, xpGained: 10, stageAfter: 2 });
  });
  it('수집률은 기본 도감 기준, 확장 종은 미션에는 반영', () => {
    const day = at(2026, 11, 10);
    let s = regExt(emptyState(), 'e1', day, spider).state;
    expect(collectionRate(s)).toMatchObject({ found: 0, total: 51 });
    s = reg(s, LADYBUG, 'h1', day).state;
    expect(collectionRate(s).found).toBe(1);
    const st = Object.fromEntries(missionStatuses(s, day).map((m) => [m.id, m]));
    expect(st.d_new.progress).toBe(1); // 목표 1, 2종 발견
    expect(st.d_three.progress).toBe(2);
  });
  it('확장 종은 생태 탐구 대상이 아니다', () => {
    let s = regExt(emptyState(), 'e1', at(2026, 11, 10), spider).state;
    s = regExt(s, 'e2', at(2026, 11, 11)).state;
    expect(canStudy(s, spider.id)).toBe(false);
  });
});

describe('다른 기기 기록 합치기', () => {
  const day = at(2026, 11, 10);
  const remoteFrom = (s: AppState) => ({
    observations: s.observations,
    xpEvents: s.xpEvents,
    studies: s.studies,
    missionClaims: s.missionClaims,
    extSpecies: s.extSpecies,
  });

  it('서버 기록과 이 기기 기록을 합치고, 같은 보상은 한 번만', () => {
    // 계정(다른 기기): 까치
    const account = reg(emptyState(), MAGPIE, 'r1', day).state;
    // 이 기기(익명): 까치(다른 사진) + 칠성무당벌레, 이미 익명 계정에 백업됨
    let local = reg(emptyState(), MAGPIE, 'l1', at(2026, 11, 11)).state;
    local = reg(local, LADYBUG, 'l2', at(2026, 11, 11)).state;
    local = { ...local, syncedObservationIds: Object.fromEntries(local.observations.map((o) => [o.id, true as const])) };

    const merged = mergeStates(local, remoteFrom(account), at(2026, 11, 12), makeId);
    expect(merged.observations).toHaveLength(3);
    expect(Object.keys(buildDex(merged)).sort()).toEqual([LADYBUG, MAGPIE].sort());
    // 양쪽 모두 까치 신규 발견 100을 받았지만 합치면 한 번만. + 칠성무당벌레 100
    expect(merged.xpEvents.filter((e) => e.key === `discover:${MAGPIE}`)).toHaveLength(1);
    expect(totalXp(merged)).toBe(200);
    expect(merged.achievements.first).toBeTruthy();
  });

  it('이 기기에만 있던 기록은 새 id로 바뀌고 다시 올라갈 대상이 된다', () => {
    const account = reg(emptyState(), MAGPIE, 'r1', day).state;
    let local = reg(emptyState(), LADYBUG, 'l2', day).state;
    const oldId = local.observations[0].id;
    local = { ...local, syncedObservationIds: { [oldId]: true } };
    const merged = mergeStates(local, remoteFrom(account), day, makeId);
    const moved = merged.observations.find((o) => o.speciesId === LADYBUG)!;
    expect(moved.id).not.toBe(oldId);
    expect(merged.syncedObservationIds[moved.id]).toBeUndefined();
    expect(merged.syncedObservationIds[account.observations[0].id]).toBe(true);
  });

  it('같은 사진은 한 번만, 탐구·미션 기록은 이른 쪽', () => {
    let account = reg(emptyState(), LADYBUG, 'same', day).state;
    account = { ...account, studies: { [LADYBUG]: '2026-11-12T00:00:00.000Z' }, missionClaims: { 'd_log:2026-11-10': '2026-11-10T05:00:00.000Z' } };
    let local = reg(emptyState(), LADYBUG, 'same', day).state;
    local = { ...local, studies: { [LADYBUG]: '2026-11-11T00:00:00.000Z' }, missionClaims: { 'd_log:2026-11-10': '2026-11-10T09:00:00.000Z' } };
    const merged = mergeStates(local, remoteFrom(account), day, makeId);
    expect(merged.observations).toHaveLength(1);
    expect(merged.studies[LADYBUG]).toBe('2026-11-11T00:00:00.000Z');
    expect(merged.missionClaims['d_log:2026-11-10']).toBe('2026-11-10T05:00:00.000Z');
  });

  it('빈 기기로 로그인하면 서버 기록이 그대로', () => {
    const account = reg(emptyState(), MAGPIE, 'r1', day).state;
    const merged = mergeStates(emptyState(), remoteFrom(account), day, makeId);
    expect(merged.observations).toEqual(account.observations);
    expect(totalXp(merged)).toBe(100);
  });
});
