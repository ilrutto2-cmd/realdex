// Supabase Edge Function: POST /functions/v1/identify
// 앱이 보낸 사진을 서버에서 Claude 비전 모델로 판별한다. API 키는 이 함수의 비밀 환경변수에만 둔다.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import catalog from './catalog.json' with { type: 'json' };
import {
  extSpeciesId,
  generateSpeciesInfo,
  IdentifyError,
  identifyImage,
  isExtEligible,
  type ExtSpecies,
} from './core.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

interface SpeciesRow {
  id: string;
  name_ko: string;
  scientific_name: string;
  group_key: ExtSpecies['group'];
  taxon: string;
  feature: string;
  habitat: string;
  season: string;
  role: string;
  similar_note: string;
  is_protected: boolean;
}

const rowToExt = (r: SpeciesRow): ExtSpecies => ({
  id: r.id,
  nameKo: r.name_ko,
  scientificName: r.scientific_name,
  group: r.group_key,
  taxon: r.taxon,
  feature: r.feature,
  habitat: r.habitat,
  season: r.season,
  role: r.role,
  similar: r.similar_note,
  isProtected: r.is_protected,
});

const SPECIES_COLUMNS = 'id, name_ko, scientific_name, group_key, taxon, feature, habitat, season, role, similar_note, is_protected';

/** DB에 있는 확장 종이면 그대로, 없으면 AI로 설명을 만들어 저장한 뒤 돌려준다. */
const resolveExtSpecies = async (
  admin: Admin,
  scientificName: string,
  nameKo: string,
  apiKey: string,
  model: string,
): Promise<ExtSpecies | null> => {
  const id = extSpeciesId(scientificName);
  const found = await admin.from('species').select(SPECIES_COLUMNS).eq('id', id).maybeSingle();
  if (found.data) return rowToExt(found.data as SpeciesRow);

  const info = await generateSpeciesInfo({ scientificName, nameKoHint: nameKo, apiKey, model });
  if (!info) return null;
  const { data: maxNo } = await admin.from('species').select('no').order('no', { ascending: false }).limit(1).maybeSingle();
  const { error } = await admin.from('species').insert({
    id: info.id,
    no: ((maxNo as { no: number } | null)?.no ?? 1000) + 1,
    name_ko: info.nameKo,
    scientific_name: info.scientificName,
    group_key: info.group,
    taxon: info.taxon,
    tier: 'explore',
    feature: info.feature,
    habitat: info.habitat,
    season: info.season,
    role: info.role,
    similar_note: info.similar,
    is_protected: info.isProtected,
    kind: 'ext',
  });
  if (error) {
    // 다른 사용자가 같은 종을 동시에 만든 경우: 저장된 쪽을 쓴다.
    const again = await admin.from('species').select(SPECIES_COLUMNS).eq('id', id).maybeSingle();
    if (again.data) return rowToExt(again.data as SpeciesRow);
    console.error('ext insert failed', error.message);
    return null;
  }
  return info;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json(503, { error: 'not_configured', message: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' });
  const model = Deno.env.get('IDENTIFY_MODEL') ?? 'claude-sonnet-5-5';
  const dailyLimit = Number(Deno.env.get('IDENTIFY_DAILY_LIMIT') ?? '40');

  // 로그인(익명 포함)한 사용자만 호출할 수 있다.
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serverKey(), {
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json(401, { error: 'unauthorized' });
  const userId = userData.user.id;

  // 사용자별 하루 호출 횟수 제한(비용 보호).
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await admin
    .from('identify_calls')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since);
  if (countError) return json(500, { error: 'server', message: '호출 기록을 확인하지 못했습니다.' });
  if ((count ?? 0) >= dailyLimit) {
    return json(429, { error: 'rate_limit', message: '오늘의 판별 횟수를 모두 사용했습니다.' });
  }

  let payload: { image_base64?: string; media_type?: string };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'bad_request', message: '요청 형식이 올바르지 않습니다.' });
  }

  try {
    const result = await identifyImage({
      imageBase64: payload.image_base64 ?? '',
      mediaType: payload.media_type ?? 'image/jpeg',
      catalog,
      apiKey,
      model,
    });
    await admin.from('identify_calls').insert({ user_id: userId, status: result.status });

    // 확장 도감: 도감 밖 종을 확실히 판별하면 종 정보를 찾거나 새로 만들어 붙인다.
    // 이 단계가 실패해도 판별 결과는 그대로 돌려준다(그 후보만 등록할 수 없게 된다).
    for (const c of result.candidates) {
      if (!isExtEligible(c)) continue;
      try {
        c.ext = await resolveExtSpecies(admin, c.scientificName, c.nameKo, apiKey, model);
      } catch (err) {
        console.error('ext species failed', c.scientificName, err);
      }
    }
    return json(200, result);
  } catch (e) {
    if (e instanceof IdentifyError) {
      const status = e.code === 'bad_request' ? 400 : e.code === 'upstream_overloaded' ? 503 : 502;
      return json(status, { error: e.code, message: e.message });
    }
    console.error(e);
    return json(500, { error: 'server', message: '판별 중 오류가 발생했습니다.' });
  }
});
