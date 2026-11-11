import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Stats } from '../../supabase/functions/stats/core';
import { cloudEnabled, supabaseAnonKey, supabaseUrl } from './supabase';

export type { Stats };

const TOKEN_KEY = 'realdex/statsToken';

export const loadStatsToken = async (): Promise<string> => {
  try {
    return (await AsyncStorage.getItem(TOKEN_KEY)) ?? '';
  } catch {
    return '';
  }
};

export const saveStatsToken = async (token: string): Promise<void> => {
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
};

export type StatsOutcome = { kind: 'ok'; stats: Stats } | { kind: 'error'; code: 'unauthorized' | 'not_configured' | 'network' | 'server'; message: string };

/** 관리자 통계를 가져온다. 토큰은 서버 비밀값 STATS_TOKEN 과 같아야 한다. */
export const fetchStats = async (token: string): Promise<StatsOutcome> => {
  if (!cloudEnabled) return { kind: 'error', code: 'not_configured', message: '서버가 연결되지 않은 데모 모드입니다.' };
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/stats`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        authorization: `Bearer ${supabaseAnonKey}`,
        'x-stats-token': token,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    const body = (await res.json().catch(() => null)) as (Stats & { error?: string; message?: string }) | null;
    if (res.ok && body && body.totals) return { kind: 'ok', stats: body };
    if (res.status === 401) return { kind: 'error', code: 'unauthorized', message: '관리자 토큰이 맞지 않습니다.' };
    if (res.status === 404) return { kind: 'error', code: 'not_configured', message: '서버에 stats 함수가 배포되지 않았습니다.' };
    if (body?.error === 'not_configured') return { kind: 'error', code: 'not_configured', message: body.message ?? '서버 설정이 필요합니다.' };
    return { kind: 'error', code: 'server', message: body?.message ?? `통계 서버 오류(${res.status})` };
  } catch {
    return { kind: 'error', code: 'network', message: '인터넷에 연결할 수 없습니다.' };
  }
};
