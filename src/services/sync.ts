import { buildDex } from '../domain/rules';
import type { AppState } from '../domain/types';
import { readPhotoBytes } from './photos';
import { cloudEnabled, ensureSession, getSupabase } from './supabase';

const BUCKET = 'observation-photos';

/**
 * 기기에 저장된 기록을 Supabase에 올린다(기기 → 서버 단방향 백업).
 * 모든 쓰기는 같은 키로 다시 보내도 결과가 같도록 upsert로 한다.
 * 돌려주는 값: 이번에 서버 반영이 끝난 관찰 기록 id 목록.
 */
export const pushState = async (state: AppState): Promise<string[]> => {
  if (!cloudEnabled) return [];
  const supabase = getSupabase();
  const { userId } = await ensureSession();

  const done: string[] = [];
  for (const o of state.observations) {
    if (state.syncedObservationIds[o.id]) continue;
    const path = `${userId}/${o.id}.jpg`;
    const bytes = await readPhotoBytes(o.photoUri);
    const up = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    if (up.error) throw new Error(`사진 업로드 실패: ${up.error.message}`);
    const { error } = await supabase.from('observations').upsert({
      id: o.id,
      species_id: o.speciesId,
      observed_at: o.observedAt,
      local_date: o.localDate,
      photo_path: path,
      photo_hash: o.photoHash,
      region: o.region,
      lat: o.lat,
      lng: o.lng,
      source: o.source,
    });
    if (error) throw new Error(`관찰 기록 저장 실패: ${error.message}`);
    done.push(o.id);
  }

  const dexRows = Object.values(buildDex(state)).map((d) => ({
    species_id: d.speciesId,
    first_observed_at: d.firstObservedAt,
    observation_count: d.observationCount,
    stage: d.stage,
    study_completed_at: d.studyCompletedAt,
    updated_at: new Date().toISOString(),
  }));
  if (dexRows.length > 0) {
    const { error } = await supabase.from('dex_progress').upsert(dexRows, { onConflict: 'user_id,species_id' });
    if (error) throw new Error(`도감 진행도 저장 실패: ${error.message}`);
  }

  if (state.xpEvents.length > 0) {
    const rows = state.xpEvents.map((e) => ({
      id: e.id,
      idem_key: e.key,
      type: e.type,
      amount: e.amount,
      created_at: e.createdAt,
    }));
    const { error } = await supabase
      .from('xp_events')
      .upsert(rows, { onConflict: 'user_id,idem_key', ignoreDuplicates: true });
    if (error) throw new Error(`경험치 이력 저장 실패: ${error.message}`);
  }

  const claims = Object.entries(state.missionClaims).map(([key, claimedAt]) => {
    const i = key.indexOf(':');
    return { mission_id: key.slice(0, i), period_key: key.slice(i + 1), claimed_at: claimedAt };
  });
  if (claims.length > 0) {
    const { error } = await supabase
      .from('mission_claims')
      .upsert(claims, { onConflict: 'user_id,mission_id,period_key', ignoreDuplicates: true });
    if (error) throw new Error(`미션 기록 저장 실패: ${error.message}`);
  }
  return done;
};

export const removeRemoteObservation = async (observationId: string): Promise<void> => {
  if (!cloudEnabled) return;
  const supabase = getSupabase();
  const { userId } = await ensureSession();
  await supabase.storage.from(BUCKET).remove([`${userId}/${observationId}.jpg`]);
  await supabase.from('observations').delete().eq('id', observationId);
};

/** 서버에 있는 내 데이터를 모두 지운다. */
export const wipeRemote = async (): Promise<void> => {
  if (!cloudEnabled) return;
  const supabase = getSupabase();
  const { userId } = await ensureSession();
  const listed = await supabase.storage.from(BUCKET).list(userId, { limit: 1000 });
  const paths = (listed.data ?? []).map((f) => `${userId}/${f.name}`);
  if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);
  for (const table of ['observations', 'dex_progress', 'xp_events', 'mission_claims']) {
    const { error } = await supabase.from(table).delete().eq('user_id', userId);
    if (error) throw new Error(`서버 데이터 삭제 실패: ${error.message}`);
  }
};
