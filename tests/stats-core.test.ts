import { describe, expect, it } from 'vitest';
import { computeStats, kstDate, safeEqual, type FeedbackRow } from '../supabase/functions/stats/core';

// 기준 시각: 2026-11-12 12:00 KST (= 03:00 UTC)
const NOW = new Date('2026-11-12T03:00:00Z');
const kst = (date: string, hour = 12) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+09:00`).toISOString();

const fb = (over: Partial<FeedbackRow>): FeedbackRow => ({
  id: crypto.randomUUID(),
  user_id: 'u1',
  kind: 'general',
  rating: null,
  message: '',
  context: {},
  app_version: '0.1.0',
  created_at: kst('2026-11-11'),
  ...over,
});

const sample = () => ({
  profiles: [
    { id: 'u1', created_at: kst('2026-11-01') }, // 다음 날, 7일 뒤 모두 재방문
    { id: 'u2', created_at: kst('2026-11-01') }, // 가입 당일만 사용
    { id: 'u3', created_at: kst('2026-11-11') }, // 어제 가입, 오늘 재방문
    { id: 'u4', created_at: kst('2026-11-12') }, // 오늘 가입: 재방문 집계 대상 아님
  ],
  calls: [
    { user_id: 'u1', status: 'ok', created_at: kst('2026-11-01') },
    { user_id: 'u1', status: 'ok', created_at: kst('2026-11-02') },
    { user_id: 'u1', status: 'error:upstream', created_at: kst('2026-11-09') },
    { user_id: 'u2', status: 'no_organism', created_at: kst('2026-11-01') },
    { user_id: 'u3', status: 'ok', created_at: kst('2026-11-11') },
    { user_id: 'u3', status: 'ok', created_at: kst('2026-11-12', 1) },
    { user_id: 'u4', status: 'low_quality', created_at: kst('2026-11-12') },
  ],
  observations: [
    { user_id: 'u1', species_id: 'pica-serica', source: 'ai', created_at: kst('2026-11-01') },
    { user_id: 'u1', species_id: 'pica-serica', source: 'ai', created_at: kst('2026-11-02') },
    { user_id: 'u3', species_id: 'x-zosterops-japonicus', source: 'ai', created_at: kst('2026-11-11') },
    { user_id: 'u3', species_id: 'passer-montanus', source: 'manual_demo', created_at: kst('2026-11-12', 1) },
  ],
  species: [
    { id: 'pica-serica', name_ko: '까치', kind: 'core' },
    { id: 'passer-montanus', name_ko: '참새', kind: 'core' },
    { id: 'x-zosterops-japonicus', name_ko: '동박새', kind: 'ext' },
  ],
  feedback: [
    fb({ kind: 'general', rating: 5, message: '재밌어요', created_at: kst('2026-11-10') }),
    fb({ kind: 'general', rating: 3, message: '느려요', created_at: kst('2026-11-11') }),
    fb({ kind: 'misid', message: '물까치였어요', context: { speciesId: 'pica-serica' }, created_at: kst('2026-11-12', 2) }),
  ],
});

describe('사용 통계 집계', () => {
  it('한국 시간 기준으로 날짜를 나눈다', () => {
    expect(kstDate('2026-11-11T15:30:00Z')).toBe('2026-11-12'); // KST 00:30
    expect(kstDate('2026-11-11T14:30:00Z')).toBe('2026-11-11'); // KST 23:30
  });

  it('합계', () => {
    const s = computeStats(sample(), NOW);
    expect(s.totals).toEqual({
      users: 4,
      newUsers7d: 2,
      activeUsers7d: 3, // u1(11/9), u3, u4
      identifyCalls: 7,
      identifyCalls7d: 4,
      observations: 4,
      observations7d: 2,
      coreSpeciesFound: 2,
      extSpeciesFound: 1,
      feedback: 3,
      misidReports: 1,
    });
    expect(s.identifyStatus).toEqual({ ok: 4, 'error:upstream': 1, no_organism: 1, low_quality: 1 });
  });

  it('재방문율: 다음 날 이후 / 7일째 이후', () => {
    const s = computeStats(sample(), NOW);
    expect(s.retention).toEqual({ d1Cohort: 3, d1Returned: 2, d7Cohort: 2, d7Returned: 1 });
  });

  it('날짜별 추이는 최근 14일, 오래된 날부터', () => {
    const s = computeStats(sample(), NOW);
    expect(s.daily).toHaveLength(14);
    expect(s.daily[0].date).toBe('2026-10-30');
    expect(s.daily[13]).toEqual({ date: '2026-11-12', newUsers: 1, activeUsers: 2, calls: 2, observations: 1 });
    expect(s.daily.find((d) => d.date === '2026-11-01')).toEqual({ date: '2026-11-01', newUsers: 2, activeUsers: 2, calls: 2, observations: 1 });
  });

  it('많이 등록된 종, 평점, 오류 신고 비율, 최근 의견', () => {
    const s = computeStats(sample(), NOW);
    expect(s.topSpecies[0]).toEqual({ id: 'pica-serica', nameKo: '까치', kind: 'core', count: 2 });
    expect(s.topSpecies.find((t) => t.id === 'x-zosterops-japonicus')?.kind).toBe('ext');
    expect(s.avgRating).toBe(4);
    expect(s.ratingCount).toBe(2);
    expect(s.misidRate).toBeCloseTo(1 / 3);
    expect(s.recentFeedback.map((f) => f.message)).toEqual(['물까치였어요', '느려요', '재밌어요']);
  });

  it('데이터가 없어도 동작한다', () => {
    const s = computeStats({ profiles: [], calls: [], observations: [], species: [], feedback: [] }, NOW);
    expect(s.totals.users).toBe(0);
    expect(s.misidRate).toBeNull();
    expect(s.avgRating).toBeNull();
    expect(s.daily.every((d) => d.calls === 0)).toBe(true);
  });

  it('토큰 비교', () => {
    expect(safeEqual('abcdefghijkl', 'abcdefghijkl')).toBe(true);
    expect(safeEqual('abcdefghijkl', 'abcdefghijkx')).toBe(false);
    expect(safeEqual('abc', 'abcdefghijkl')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});
