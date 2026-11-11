// Supabase Edge Function: POST /functions/v1/stats
// 관리자용 사용 통계. 헤더 x-stats-token 이 비밀값 STATS_TOKEN 과 같을 때만 응답한다.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { computeStats, safeEqual } from './core.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-stats-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

/** 서버 전용 키. 새 프로젝트는 SUPABASE_SECRET_KEYS(JSON), 예전 프로젝트는 SUPABASE_SERVICE_ROLE_KEY를 쓴다. */
const serverKey = (): string => {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    return keys.default ?? Object.values(keys)[0] ?? '';
  } catch {
    return '';
  }
};

// deno-lint-ignore no-explicit-any
type Admin = SupabaseClient<any, any, any>;

/** PostgREST는 한 번에 1000행까지 주므로 나눠서 모두 읽는다(최대 limit행). */
const fetchAll = async <T,>(admin: Admin, table: string, columns: string, since?: string, limit = 50000): Promise<T[]> => {
  const out: T[] = [];
  for (let from = 0; from < limit; from += 1000) {
    let q = admin.from(table).select(columns).order('created_at', { ascending: true }).range(from, from + 999);
    if (since) q = q.gte('created_at', since);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const expected = Deno.env.get('STATS_TOKEN') ?? '';
  if (expected.length < 12) {
    return json(503, { error: 'not_configured', message: 'STATS_TOKEN(12자 이상)이 설정되지 않았습니다.' });
  }
  const given = req.headers.get('x-stats-token') ?? '';
  if (!safeEqual(given, expected)) return json(401, { error: 'unauthorized', message: '관리자 토큰이 맞지 않습니다.' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serverKey(), { auth: { persistSession: false } });
  try {
    const now = new Date();
    const since = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const [profiles, calls, observations, species, feedback] = await Promise.all([
      fetchAll(admin, 'profiles', 'id, created_at'),
      fetchAll(admin, 'identify_calls', 'user_id, status, created_at', since),
      fetchAll(admin, 'observations', 'user_id, species_id, source, created_at'),
      admin
        .from('species')
        .select('id, name_ko, kind')
        .then(({ data, error }) => {
          if (error) throw new Error(`species: ${error.message}`);
          return data ?? [];
        }),
      fetchAll(admin, 'feedback', 'id, user_id, kind, rating, message, context, app_version, created_at'),
    ]);
    // deno-lint-ignore no-explicit-any
    return json(200, computeStats({ profiles, calls, observations, species, feedback } as any, now));
  } catch (e) {
    console.error(e);
    return json(500, { error: 'server', message: e instanceof Error ? e.message : '통계를 만들지 못했습니다.' });
  }
});
