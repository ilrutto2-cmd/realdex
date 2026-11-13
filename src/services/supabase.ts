import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// 앱에는 공개용 주소와 anon 키만 들어간다. AI 서비스 키는 서버 함수의 비밀 환경변수에만 둔다.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Supabase가 설정되어 있으면 true. false면 앱은 '데모 모드'로 동작한다. */
export const cloudEnabled = url.length > 0 && anonKey.length > 0;
export const supabaseUrl = url;
export const supabaseAnonKey = anonKey;

/** 개인정보 처리방침 주소. 웹에서는 지금 사이트 기준, 앱에서는 EXPO_PUBLIC_SITE_URL 기준. */
export const privacyUrl = (): string => {
  if (typeof window !== 'undefined' && window.location?.origin?.startsWith('http')) return `${window.location.origin}/privacy.html`;
  return `${process.env.EXPO_PUBLIC_SITE_URL ?? ''}/privacy.html`;
};

let client: SupabaseClient | null = null;

export const getSupabase = (): SupabaseClient => {
  if (!cloudEnabled) throw new Error('Supabase가 설정되지 않았습니다.');
  if (!client) {
    client = createClient(url, anonKey, {
      auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    });
  }
  return client;
};

/**
 * 체험 모드: 이메일·이름 없이 익명 계정으로 로그인한다.
 * 익명 계정도 고유한 사용자 id를 가지므로 서버에서 사용자별로 데이터가 분리된다.
 */
export const ensureSession = async (): Promise<{ userId: string; accessToken: string }> => {
  const supabase = getSupabase();
  const current = await supabase.auth.getSession();
  let session = current.data.session;
  if (!session) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.session) throw new Error(error?.message ?? '익명 로그인에 실패했습니다.');
    session = data.session;
  }
  return { userId: session.user.id, accessToken: session.access_token };
};
