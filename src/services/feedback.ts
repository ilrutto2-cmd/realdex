import * as Crypto from 'expo-crypto';
import appConfig from '../../app.json';
import { readPhotoBytes } from './photos';
import { cloudEnabled, ensureSession, getSupabase } from './supabase';

export type FeedbackKind = 'general' | 'misid';

export interface FeedbackInput {
  kind: FeedbackKind;
  rating: number | null;
  message: string;
  context: Record<string, unknown>;
  /** 함께 보낼 사진(판별 오류 신고). 없으면 사진 없이 보낸다. */
  photoUri?: string | null;
}

export const APP_VERSION: string = appConfig.expo.version;

/** 의견을 서버에 저장한다. 사진은 본인 폴더(observation-photos/<uid>/feedback-<id>.jpg)에 올린다. */
export const sendFeedback = async (input: FeedbackInput): Promise<{ ok: true } | { ok: false; message: string }> => {
  if (!cloudEnabled) return { ok: false, message: '서버가 연결되지 않은 데모 모드에서는 보낼 수 없습니다.' };
  try {
    const supabase = getSupabase();
    const { userId } = await ensureSession();
    const id = Crypto.randomUUID();
    const context: Record<string, unknown> = { ...input.context };
    if (input.photoUri) {
      const path = `${userId}/feedback-${id}.jpg`;
      const bytes = await readPhotoBytes(input.photoUri);
      const up = await supabase.storage.from('observation-photos').upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
      if (!up.error) context.photoPath = path;
    }
    const { error } = await supabase.from('feedback').insert({
      id,
      kind: input.kind,
      rating: input.rating,
      message: input.message.trim().slice(0, 2000),
      context,
      app_version: APP_VERSION,
    });
    if (error) return { ok: false, message: '보내지 못했습니다. 잠시 후 다시 시도해 주세요.' };
    return { ok: true };
  } catch {
    return { ok: false, message: '인터넷에 연결할 수 없습니다. 연결을 확인하고 다시 시도해 주세요.' };
  }
};
