import { cloudEnabled, getSupabase } from './supabase';

export interface AccountInfo {
  userId: string | null;
  email: string | null;
  /** 이메일을 연결하지 않은 체험(익명) 계정 */
  isAnonymous: boolean;
}

export const getAccount = async (): Promise<AccountInfo> => {
  if (!cloudEnabled) return { userId: null, email: null, isAnonymous: true };
  const { data } = await getSupabase().auth.getSession();
  const user = data.session?.user;
  if (!user) return { userId: null, email: null, isAnonymous: true };
  return { userId: user.id, email: user.email ?? null, isAnonymous: user.is_anonymous === true || !user.email };
};

export type AuthStep = { ok: true } | { ok: false; code: 'exists' | 'not_found' | 'invalid_code' | 'rate_limited' | 'mail' | 'network'; message: string };

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

const classify = (err: { message?: string; status?: number; code?: string } | null): AuthStep => {
  const msg = (err?.message ?? '').toLowerCase();
  const code = (err?.code ?? '').toLowerCase();
  if (code === 'email_exists' || msg.includes('already been registered') || msg.includes('already registered')) {
    return { ok: false, code: 'exists', message: '이미 가입된 이메일입니다. 로그인하면 이 기기의 기록과 합쳐집니다.' };
  }
  if (code === 'otp_disabled' || msg.includes('signups not allowed') || code === 'user_not_found') {
    return { ok: false, code: 'not_found', message: '이 이메일로 연결된 기록이 없습니다. 먼저 "기록 지키기"로 이메일을 연결해 주세요.' };
  }
  if (code === 'otp_expired' || msg.includes('expired') || msg.includes('invalid') || msg.includes('token')) {
    return { ok: false, code: 'invalid_code', message: '코드가 맞지 않거나 시간이 지났습니다. 다시 확인해 주세요.' };
  }
  if (err?.status === 429 || msg.includes('rate limit') || code.includes('rate_limit')) {
    return { ok: false, code: 'rate_limited', message: '요청이 너무 잦습니다. 1분쯤 뒤에 다시 시도해 주세요.' };
  }
  if (msg.includes('email') && (msg.includes('send') || msg.includes('authorized'))) {
    return { ok: false, code: 'mail', message: '인증 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  }
  return { ok: false, code: 'network', message: '서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.' };
};

const guard = async (fn: () => Promise<AuthStep>): Promise<AuthStep> => {
  try {
    return await fn();
  } catch {
    return { ok: false, code: 'network', message: '서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.' };
  }
};

/** 지금 쓰는 익명 계정에 이메일을 연결한다. 계정(사용자 id)과 기록은 그대로다. 6자리 코드가 메일로 간다. */
export const startLinkEmail = (email: string): Promise<AuthStep> =>
  guard(async () => {
    if (!isEmail(email)) return { ok: false, code: 'invalid_code', message: '이메일 주소를 확인해 주세요.' };
    const { error } = await getSupabase().auth.updateUser({ email });
    return error ? classify(error) : { ok: true };
  });

export const verifyLinkEmail = (email: string, token: string): Promise<AuthStep> =>
  guard(async () => {
    const { error } = await getSupabase().auth.verifyOtp({ email, token: token.trim(), type: 'email_change' });
    return error ? classify(error) : { ok: true };
  });

/** 이미 이메일을 연결한 계정으로 로그인한다(다른 기기). 새 계정은 만들지 않는다. */
export const startLogin = (email: string): Promise<AuthStep> =>
  guard(async () => {
    if (!isEmail(email)) return { ok: false, code: 'invalid_code', message: '이메일 주소를 확인해 주세요.' };
    const { error } = await getSupabase().auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    return error ? classify(error) : { ok: true };
  });

export const verifyLogin = (email: string, token: string): Promise<AuthStep> =>
  guard(async () => {
    const { error } = await getSupabase().auth.verifyOtp({ email, token: token.trim(), type: 'email' });
    return error ? classify(error) : { ok: true };
  });

export const signOut = async (): Promise<void> => {
  if (!cloudEnabled) return;
  await getSupabase().auth.signOut();
};
