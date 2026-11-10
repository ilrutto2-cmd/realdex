import { cloudEnabled, ensureSession, supabaseAnonKey, supabaseUrl } from './supabase';

export type Rank = 'species' | 'genus' | 'family';
export type Assessment = 'likely' | 'possible' | 'needs_check';

export interface Candidate {
  catalogId: string | null;
  nameKo: string;
  scientificName: string;
  rank: Rank;
  assessment: Assessment;
  reasoning: string;
}

export interface IdentifyResult {
  status: 'ok' | 'no_organism' | 'low_quality';
  quality: string;
  candidates: Candidate[];
  retakeAdvice: string | null;
  caution: string | null;
  possiblyProtected: boolean;
  model: string;
}

export type IdentifyOutcome =
  | { kind: 'ok'; result: IdentifyResult }
  | { kind: 'error'; code: 'network' | 'timeout' | 'rate_limit' | 'not_configured' | 'auth' | 'server'; message: string };

const TIMEOUT_MS = 45_000;

/** 서버의 판별 함수를 호출한다. 실패 시 가짜 결과를 만들지 않고 오류를 그대로 돌려준다. */
export const identifyPhoto = async (base64: string): Promise<IdentifyOutcome> => {
  if (!cloudEnabled) {
    return { kind: 'error', code: 'not_configured', message: 'AI 판별 서비스가 연결되지 않았습니다.' };
  }
  let accessToken: string;
  try {
    accessToken = (await ensureSession()).accessToken;
  } catch {
    return { kind: 'error', code: 'auth', message: '서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/identify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: supabaseAnonKey,
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ image_base64: base64, media_type: 'image/jpeg' }),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as (IdentifyResult & { error?: string; message?: string }) | null;
    if (res.ok && body && Array.isArray(body.candidates)) return { kind: 'ok', result: body };
    if (res.status === 429) {
      return { kind: 'error', code: 'rate_limit', message: body?.message ?? '오늘의 판별 횟수를 모두 사용했습니다.' };
    }
    if (res.status === 401) return { kind: 'error', code: 'auth', message: '로그인 정보가 만료되었습니다. 다시 시도해 주세요.' };
    if (body?.error === 'not_configured') {
      return { kind: 'error', code: 'not_configured', message: '서버에 AI 판별 키가 설정되지 않았습니다.' };
    }
    return { kind: 'error', code: 'server', message: body?.message ?? '판별 서버에서 오류가 발생했습니다.' };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { kind: 'error', code: 'timeout', message: '응답이 너무 오래 걸립니다. 다시 시도해 주세요.' };
    }
    return { kind: 'error', code: 'network', message: '인터넷에 연결할 수 없습니다. 연결을 확인하고 다시 시도해 주세요.' };
  } finally {
    clearTimeout(timer);
  }
};
