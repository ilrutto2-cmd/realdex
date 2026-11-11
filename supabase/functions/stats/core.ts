// 사용 통계 집계. Deno 전용 API를 쓰지 않아 Node 테스트에서도 그대로 불러올 수 있다.
// 날짜는 한국 시간(UTC+9) 기준으로 나눈다.

export interface ProfileRow {
  id: string;
  created_at: string;
}
export interface CallRow {
  user_id: string;
  status: string | null;
  created_at: string;
}
export interface ObservationRow {
  user_id: string;
  species_id: string;
  source: string;
  created_at: string;
}
export interface SpeciesRow {
  id: string;
  name_ko: string;
  kind: string;
}
export interface FeedbackRow {
  id: string;
  user_id: string;
  kind: 'general' | 'misid';
  rating: number | null;
  message: string;
  context: Record<string, unknown>;
  app_version: string | null;
  created_at: string;
}

export interface DailyRow {
  date: string;
  newUsers: number;
  activeUsers: number;
  calls: number;
  observations: number;
}

export interface Stats {
  generatedAt: string;
  totals: {
    users: number;
    newUsers7d: number;
    activeUsers7d: number;
    identifyCalls: number;
    identifyCalls7d: number;
    observations: number;
    observations7d: number;
    coreSpeciesFound: number;
    extSpeciesFound: number;
    feedback: number;
    misidReports: number;
  };
  identifyStatus: Record<string, number>;
  /** 가입한 날 다음 날 이후에 다시 쓴 사용자 비율, 가입 7일째 이후에 다시 쓴 사용자 비율 */
  retention: { d1Cohort: number; d1Returned: number; d7Cohort: number; d7Returned: number };
  /** 판별 오류 신고 수 / AI로 등록한 관찰 수 (참고 지표) */
  misidRate: number | null;
  avgRating: number | null;
  ratingCount: number;
  daily: DailyRow[];
  topSpecies: { id: string; nameKo: string; kind: string; count: number }[];
  recentFeedback: {
    id: string;
    kind: 'general' | 'misid';
    rating: number | null;
    message: string;
    context: Record<string, unknown>;
    appVersion: string | null;
    createdAt: string;
  }[];
}

const DAY = 24 * 60 * 60 * 1000;
const KST = 9 * 60 * 60 * 1000;

/** 한국 시간 기준 날짜 YYYY-MM-DD */
export const kstDate = (iso: string | number | Date): string => new Date(new Date(iso).getTime() + KST).toISOString().slice(0, 10);

const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

export const computeStats = (
  input: {
    profiles: ProfileRow[];
    calls: CallRow[];
    observations: ObservationRow[];
    species: SpeciesRow[];
    feedback: FeedbackRow[];
  },
  now: Date,
  days = 14,
): Stats => {
  const { profiles, calls, observations, species, feedback } = input;
  const nowMs = now.getTime();
  const within = (iso: string, d: number) => nowMs - Date.parse(iso) < d * DAY;
  const today = kstDate(now);

  // 사용자별 활동 날짜(판별 호출 또는 관찰 등록)
  const activity = new Map<string, Set<string>>();
  const touch = (uid: string, iso: string) => {
    const set = activity.get(uid) ?? new Set<string>();
    set.add(kstDate(iso));
    activity.set(uid, set);
  };
  for (const c of calls) touch(c.user_id, c.created_at);
  for (const o of observations) touch(o.user_id, o.created_at);

  // 재방문율: 가입일 다음 날 이후 활동 / 가입 7일째 이후 활동
  let d1Cohort = 0;
  let d1Returned = 0;
  let d7Cohort = 0;
  let d7Returned = 0;
  for (const p of profiles) {
    const signup = kstDate(p.created_at);
    const dates = [...(activity.get(p.id) ?? [])];
    const age = daysBetween(signup, today);
    if (age >= 1) {
      d1Cohort += 1;
      if (dates.some((d) => daysBetween(signup, d) >= 1)) d1Returned += 1;
    }
    if (age >= 7) {
      d7Cohort += 1;
      if (dates.some((d) => daysBetween(signup, d) >= 7)) d7Returned += 1;
    }
  }

  // 날짜별 추이(최근 days일, 오래된 날부터)
  const daily: DailyRow[] = [];
  const index = new Map<string, DailyRow>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const row = { date: kstDate(nowMs - i * DAY), newUsers: 0, activeUsers: 0, calls: 0, observations: 0 };
    daily.push(row);
    index.set(row.date, row);
  }
  for (const p of profiles) {
    const r = index.get(kstDate(p.created_at));
    if (r) r.newUsers += 1;
  }
  for (const c of calls) {
    const r = index.get(kstDate(c.created_at));
    if (r) r.calls += 1;
  }
  for (const o of observations) {
    const r = index.get(kstDate(o.created_at));
    if (r) r.observations += 1;
  }
  for (const dates of activity.values()) {
    for (const d of dates) {
      const r = index.get(d);
      if (r) r.activeUsers += 1;
    }
  }

  const identifyStatus: Record<string, number> = {};
  for (const c of calls) {
    const key = c.status ?? 'unknown';
    identifyStatus[key] = (identifyStatus[key] ?? 0) + 1;
  }

  const kindOf = new Map(species.map((s) => [s.id, s]));
  const speciesCount = new Map<string, number>();
  for (const o of observations) speciesCount.set(o.species_id, (speciesCount.get(o.species_id) ?? 0) + 1);
  const found = [...speciesCount.keys()];
  const topSpecies = [...speciesCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([id, count]) => ({ id, nameKo: kindOf.get(id)?.name_ko ?? id, kind: kindOf.get(id)?.kind ?? 'core', count }));

  const misidReports = feedback.filter((f) => f.kind === 'misid').length;
  const aiObservations = observations.filter((o) => o.source === 'ai').length;
  const rated = feedback.filter((f) => typeof f.rating === 'number');
  const activeUsers7d = [...activity.values()].filter((dates) =>
    [...dates].some((d) => daysBetween(d, today) < 7),
  ).length;

  return {
    generatedAt: now.toISOString(),
    totals: {
      users: profiles.length,
      newUsers7d: profiles.filter((p) => within(p.created_at, 7)).length,
      activeUsers7d,
      identifyCalls: calls.length,
      identifyCalls7d: calls.filter((c) => within(c.created_at, 7)).length,
      observations: observations.length,
      observations7d: observations.filter((o) => within(o.created_at, 7)).length,
      coreSpeciesFound: found.filter((id) => (kindOf.get(id)?.kind ?? 'core') === 'core').length,
      extSpeciesFound: found.filter((id) => kindOf.get(id)?.kind === 'ext').length,
      feedback: feedback.length,
      misidReports,
    },
    identifyStatus,
    retention: { d1Cohort, d1Returned, d7Cohort, d7Returned },
    misidRate: aiObservations > 0 ? misidReports / aiObservations : null,
    avgRating: rated.length > 0 ? rated.reduce((s, f) => s + (f.rating as number), 0) / rated.length : null,
    ratingCount: rated.length,
    daily,
    topSpecies,
    recentFeedback: [...feedback]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 50)
      .map((f) => ({
        id: f.id,
        kind: f.kind,
        rating: f.rating,
        message: f.message,
        context: f.context,
        appVersion: f.app_version,
        createdAt: f.created_at,
      })),
  };
};

/** 토큰 비교(길이와 무관하게 같은 시간). */
export const safeEqual = (a: string, b: string): boolean => {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
};
