import { SPECIES, SPECIES_BY_ID } from './species';
import type {
  AppState,
  DexEntry,
  LevelInfo,
  MissionDef,
  MissionStatus,
  Observation,
  RegisterInput,
  RegisterResult,
  Stage,
  XpEvent,
  XpType,
} from './types';

/** 경험치 수치. 주간 미션 300점은 요청서에 값이 없어 임의로 정한 값이다. */
export const XP = {
  discover: 100,
  reobserve: 10,
  missionDaily: 150,
  missionWeekly: 300,
  study: 300,
} as const;

export const MISSIONS: MissionDef[] = [
  { id: 'd_log', period: 'daily', title: '오늘의 생물 관찰 기록 남기기', target: 1, rewardXp: XP.missionDaily },
  { id: 'd_new', period: 'daily', title: '새로운 생물 1종 발견하기', target: 1, rewardXp: XP.missionDaily },
  { id: 'd_three', period: 'daily', title: '서로 다른 생물 3종 관찰하기', target: 3, rewardXp: XP.missionDaily },
  { id: 'w_five', period: 'weekly', title: '이번 주 서로 다른 생물 5종 관찰하기', target: 5, rewardXp: XP.missionWeekly },
  { id: 'w_groups', period: 'weekly', title: '곤충과 새를 각각 1종 이상 관찰하기', target: 2, rewardXp: XP.missionWeekly },
  { id: 'w_study', period: 'weekly', title: '도감 탐구 카드 1개 완성하기', target: 1, rewardXp: XP.missionWeekly },
];

export const ACHIEVEMENTS: { id: string; title: string; desc: string; icon: string }[] = [
  { id: 'first', title: '첫 발견', desc: '처음으로 생물을 도감에 등록', icon: 'sprout' },
  { id: 'species5', title: '동네 탐험가', desc: '5종 발견', icon: 'map-marker-radius' },
  { id: 'species10', title: '열 가지 생명', desc: '10종 발견', icon: 'leaf' },
  { id: 'species25', title: '도감 절반', desc: '25종 발견', icon: 'book-open-variant' },
  { id: 'insect5', title: '곤충 관찰자', desc: '곤충 5종 발견', icon: 'ladybug' },
  { id: 'bird5', title: '새 관찰자', desc: '조류 5종 발견', icon: 'bird' },
  { id: 'study1', title: '첫 탐구 완료', desc: '생태 탐구를 1종 완료', icon: 'school' },
  { id: 'level5', title: '숲길 탐험가', desc: '탐험 레벨 5 달성', icon: 'medal' },
];

const TITLES: [number, string][] = [
  [16, '리얼덱스 마스터'],
  [12, '자연 박사'],
  [8, '생태 조사원'],
  [5, '숲길 탐험가'],
  [3, '동네 관찰자'],
  [1, '새싹 탐험가'],
];

// ---------- 날짜 ----------

const pad = (n: number) => String(n).padStart(2, '0');

/** 기기 현지 시간 기준 YYYY-MM-DD */
export const localDateOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 월요일 시작 주의 월요일 날짜(YYYY-MM-DD)를 주간 키로 쓴다. */
export const weekKeyOf = (d: Date): string => {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (m.getDay() + 6) % 7; // 월=0
  m.setDate(m.getDate() - dow);
  return localDateOf(m);
};

const weekKeyOfLocalDate = (localDate: string): string => {
  const [y, m, d] = localDate.split('-').map(Number);
  return weekKeyOf(new Date(y, m - 1, d));
};

// ---------- 경험치 · 레벨 ----------

export const totalXp = (state: AppState): number => state.xpEvents.reduce((s, e) => s + e.amount, 0);

/** 레벨 L에 도달하는 데 필요한 누적 경험치: 100 × (L-1) × L */
export const xpThreshold = (level: number): number => 100 * (level - 1) * level;

export const levelInfo = (xp: number): LevelInfo => {
  let level = 1;
  while (xp >= xpThreshold(level + 1)) level += 1;
  const base = xpThreshold(level);
  const next = xpThreshold(level + 1);
  const title = TITLES.find(([min]) => level >= min)![1];
  return { level, title, totalXp: xp, xpIntoLevel: xp - base, xpForNext: next - base };
};

/** 같은 키가 이미 있으면 지급하지 않는다(중복 획득 방지). */
const grant = (
  events: XpEvent[],
  key: string,
  type: XpType,
  amount: number,
  now: Date,
  makeId: () => string,
): { events: XpEvent[]; gained: number } => {
  if (events.some((e) => e.key === key)) return { events, gained: 0 };
  return {
    events: [...events, { id: makeId(), key, type, amount, createdAt: now.toISOString() }],
    gained: amount,
  };
};

// ---------- 도감 ----------

export const buildDex = (state: AppState): Record<string, DexEntry> => {
  const bySpecies = new Map<string, Observation[]>();
  for (const o of state.observations) {
    const list = bySpecies.get(o.speciesId);
    if (list) list.push(o);
    else bySpecies.set(o.speciesId, [o]);
  }
  const dex: Record<string, DexEntry> = {};
  for (const [speciesId, list] of bySpecies) {
    const sorted = [...list].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const distinctDates = new Set(sorted.map((o) => o.localDate)).size;
    const distinctRegions = new Set(sorted.map((o) => o.region).filter(Boolean)).size;
    const studyCompletedAt = state.studies[speciesId] ?? null;
    const reobserved = distinctDates >= 2 || distinctRegions >= 2;
    const stage: Stage = reobserved && studyCompletedAt ? 3 : reobserved ? 2 : 1;
    dex[speciesId] = {
      speciesId,
      firstObservedAt: first.observedAt,
      lastObservedAt: last.observedAt,
      observationCount: sorted.length,
      distinctDates,
      distinctRegions,
      stage,
      studyCompletedAt,
      coverPhotoUri: last.photoUri,
      firstRegion: first.region,
    };
  }
  return dex;
};

export const collectionRate = (state: AppState): { found: number; total: number; percent: number } => {
  const found = new Set(state.observations.map((o) => o.speciesId)).size;
  const total = SPECIES.length;
  return { found, total, percent: Math.round((found / total) * 100) };
};

const computeAchievements = (state: AppState): string[] => {
  const ids = new Set(state.observations.map((o) => o.speciesId));
  const count = (g: string) => [...ids].filter((id) => SPECIES_BY_ID[id]?.group === g).length;
  const earned: string[] = [];
  if (ids.size >= 1) earned.push('first');
  if (ids.size >= 5) earned.push('species5');
  if (ids.size >= 10) earned.push('species10');
  if (ids.size >= 25) earned.push('species25');
  if (count('insect') >= 5) earned.push('insect5');
  if (count('bird') >= 5) earned.push('bird5');
  if (Object.keys(state.studies).length >= 1) earned.push('study1');
  if (levelInfo(totalXp(state)).level >= 5) earned.push('level5');
  return earned;
};

/** 새로 달성한 업적을 기록한다. 한 번 얻은 업적은 기록을 지워도 유지된다. */
const withAchievements = (state: AppState, now: Date): { state: AppState; added: string[] } => {
  const added = computeAchievements(state).filter((id) => !state.achievements[id]);
  if (added.length === 0) return { state, added };
  const achievements = { ...state.achievements };
  for (const id of added) achievements[id] = now.toISOString();
  return { state: { ...state, achievements }, added };
};

// ---------- 관찰 등록 ----------

export const registerObservation = (
  state: AppState,
  input: RegisterInput,
  now: Date,
  makeId: () => string,
): { state: AppState; result: RegisterResult } => {
  const levelBefore = levelInfo(totalXp(state)).level;
  const dexBefore = buildDex(state);
  const entryBefore: DexEntry | undefined = dexBefore[input.speciesId];
  const stageBefore: Stage | 0 = entryBefore ? entryBefore.stage : 0;
  const fail = (reason: RegisterResult['reason']): { state: AppState; result: RegisterResult } => ({
    state,
    result: {
      ok: false,
      reason,
      isNewSpecies: false,
      xpGained: 0,
      stageBefore,
      stageAfter: (stageBefore || 1) as Stage,
      levelBefore,
      levelAfter: levelBefore,
      newAchievements: [],
    },
  });

  if (!SPECIES_BY_ID[input.speciesId]) return fail('unknown_species');
  // 같은 사진을 다시 올려 점수를 얻는 것을 막는다.
  if (state.observations.some((o) => o.photoHash === input.photoHash)) return fail('duplicate_photo');

  const localDate = localDateOf(now);
  const observation: Observation = {
    id: input.id,
    speciesId: input.speciesId,
    observedAt: now.toISOString(),
    localDate,
    photoUri: input.photoUri,
    photoHash: input.photoHash,
    region: input.region,
    lat: input.lat,
    lng: input.lng,
    source: input.source,
  };

  // 신규 발견 보상은 종마다 평생 한 번. 기록을 지우고 다시 등록해도 다시 주지 않는다.
  let xp = grant(state.xpEvents, `discover:${input.speciesId}`, 'discover', XP.discover, now, makeId);
  const isNewSpecies = stageBefore === 0;
  let gained = xp.gained;
  if (gained === 0) {
    // 재관찰 보상은 종마다 하루 한 번. 처음 발견한 날에는 주지 않는다.
    const firstDate = state.xpEvents.find((e) => e.key === `discover:${input.speciesId}`)?.createdAt;
    const discoveredToday = firstDate ? localDateOf(new Date(firstDate)) === localDate : false;
    if (!discoveredToday) {
      xp = grant(xp.events, `reobserve:${input.speciesId}:${localDate}`, 'reobserve', XP.reobserve, now, makeId);
      gained = xp.gained;
    }
  }

  let next: AppState = { ...state, observations: [...state.observations, observation], xpEvents: xp.events };
  const ach = withAchievements(next, now);
  next = ach.state;

  return {
    state: next,
    result: {
      ok: true,
      isNewSpecies,
      xpGained: gained,
      stageBefore,
      stageAfter: buildDex(next)[input.speciesId].stage,
      levelBefore,
      levelAfter: levelInfo(totalXp(next)).level,
      newAchievements: ach.added,
      observation,
    },
  };
};

/** 관찰 기록 삭제. 지급된 경험치와 업적은 되돌리지 않는다(삭제 후 재등록으로 점수를 반복 획득할 수 없다). */
export const deleteObservation = (state: AppState, observationId: string): AppState => {
  const syncedObservationIds = { ...state.syncedObservationIds };
  delete syncedObservationIds[observationId];
  return { ...state, observations: state.observations.filter((o) => o.id !== observationId), syncedObservationIds };
};

// ---------- 생태 탐구 ----------

export interface QuizQuestion {
  prompt: string;
  choices: string[];
  answerIndex: number;
}

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** 도감 정보에서 만드는 3문항 탐구 퀴즈. 같은 종이면 항상 같은 문제가 나온다. */
export const buildQuiz = (speciesId: string): QuizQuestion[] => {
  const sp = SPECIES_BY_ID[speciesId];
  if (!sp) return [];
  const others = SPECIES.filter((s) => s.id !== sp.id && s.group === sp.group);
  const make = (prompt: string, field: 'feature' | 'habitat' | 'role'): QuizQuestion => {
    const seed = hash(`${sp.id}:${field}`);
    const pool = others.filter((o) => o[field] !== sp[field]);
    const picked: string[] = [];
    for (let i = 0; picked.length < 2 && i < pool.length; i += 1) {
      const cand = pool[(seed + i * 7) % pool.length][field];
      if (!picked.includes(cand)) picked.push(cand);
    }
    const answerIndex = seed % (picked.length + 1);
    const choices = [...picked];
    choices.splice(answerIndex, 0, sp[field]);
    return { prompt, choices, answerIndex };
  };
  return [
    make(`${sp.nameKo}의 생김새로 알맞은 것은?`, 'feature'),
    make(`${sp.nameKo}를 주로 볼 수 있는 곳은?`, 'habitat'),
    make(`${sp.nameKo}가 자연에서 하는 일은?`, 'role'),
  ];
};

export const canStudy = (state: AppState, speciesId: string): boolean => {
  const entry = buildDex(state)[speciesId];
  return !!entry && entry.stage === 2 && !state.studies[speciesId];
};

export const completeStudy = (
  state: AppState,
  speciesId: string,
  answers: number[],
  now: Date,
  makeId: () => string,
): { state: AppState; ok: boolean; xpGained: number; newAchievements: string[] } => {
  const quiz = buildQuiz(speciesId);
  const correct = quiz.length > 0 && quiz.every((q, i) => answers[i] === q.answerIndex);
  if (!correct || !canStudy(state, speciesId)) return { state, ok: false, xpGained: 0, newAchievements: [] };
  const xp = grant(state.xpEvents, `study:${speciesId}`, 'study', XP.study, now, makeId);
  const next: AppState = { ...state, studies: { ...state.studies, [speciesId]: now.toISOString() }, xpEvents: xp.events };
  const ach = withAchievements(next, now);
  return { state: ach.state, ok: true, xpGained: xp.gained, newAchievements: ach.added };
};

// ---------- 미션 ----------

export const missionStatuses = (state: AppState, now: Date): MissionStatus[] => {
  const today = localDateOf(now);
  const week = weekKeyOf(now);
  const obsToday = state.observations.filter((o) => o.localDate === today);
  const obsWeek = state.observations.filter((o) => weekKeyOfLocalDate(o.localDate) === week);
  const firstDateBySpecies = new Map<string, string>();
  for (const o of state.observations) {
    const cur = firstDateBySpecies.get(o.speciesId);
    if (!cur || o.localDate < cur) firstDateBySpecies.set(o.speciesId, o.localDate);
  }
  const distinct = (list: Observation[]) => new Set(list.map((o) => o.speciesId));
  const weekGroups = new Set([...distinct(obsWeek)].map((id) => SPECIES_BY_ID[id]?.group));

  const progressOf = (id: string): number => {
    switch (id) {
      case 'd_log':
        return obsToday.length;
      case 'd_new':
        return [...firstDateBySpecies.values()].filter((d) => d === today).length;
      case 'd_three':
        return distinct(obsToday).size;
      case 'w_five':
        return distinct(obsWeek).size;
      case 'w_groups':
        return (weekGroups.has('insect') ? 1 : 0) + (weekGroups.has('bird') ? 1 : 0);
      case 'w_study':
        return Object.values(state.studies).filter((iso) => weekKeyOf(new Date(iso)) === week).length;
      default:
        return 0;
    }
  };

  return MISSIONS.map((m) => {
    const periodKey = m.period === 'daily' ? today : week;
    const progress = Math.min(progressOf(m.id), m.target);
    return {
      ...m,
      periodKey,
      progress,
      completed: progress >= m.target,
      claimed: !!state.missionClaims[`${m.id}:${periodKey}`],
    };
  });
};

export const claimMission = (
  state: AppState,
  missionId: string,
  now: Date,
  makeId: () => string,
): { state: AppState; ok: boolean; xpGained: number; levelBefore: number; levelAfter: number } => {
  const levelBefore = levelInfo(totalXp(state)).level;
  const status = missionStatuses(state, now).find((m) => m.id === missionId);
  if (!status || !status.completed || status.claimed) {
    return { state, ok: false, xpGained: 0, levelBefore, levelAfter: levelBefore };
  }
  const key = `${missionId}:${status.periodKey}`;
  const xp = grant(
    state.xpEvents,
    `mission:${key}`,
    status.period === 'daily' ? 'mission_daily' : 'mission_weekly',
    status.rewardXp,
    now,
    makeId,
  );
  let next: AppState = {
    ...state,
    xpEvents: xp.events,
    missionClaims: { ...state.missionClaims, [key]: now.toISOString() },
  };
  next = withAchievements(next, now).state;
  return { state: next, ok: true, xpGained: xp.gained, levelBefore, levelAfter: levelInfo(totalXp(next)).level };
};

/** 등록 직후 안내할 다음 미션: 아직 끝내지 못한 미션 가운데 가장 가까운 것. */
export const nextMission = (state: AppState, now: Date): MissionStatus | null => {
  const open = missionStatuses(state, now).filter((m) => !m.completed);
  if (open.length === 0) return null;
  return open.sort((a, b) => a.target - a.progress - (b.target - b.progress))[0];
};
