// Supabase Edge Function: POST /functions/v1/identify
// 앱이 보낸 사진을 서버에서 Claude 비전 모델로 판별한다. API 키는 이 함수의 비밀 환경변수에만 둔다.
import { createClient } from 'npm:@supabase/supabase-js@2';
import catalog from './catalog.json' with { type: 'json' };
import { IdentifyError, identifyImage } from './core.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json(503, { error: 'not_configured', message: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' });
  const model = Deno.env.get('IDENTIFY_MODEL') ?? 'claude-sonnet-5-5';
  const dailyLimit = Number(Deno.env.get('IDENTIFY_DAILY_LIMIT') ?? '40');

  // 로그인(익명 포함)한 사용자만 호출할 수 있다.
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
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
