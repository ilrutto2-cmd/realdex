import { buildDex, isCore, type RemoteSnapshot } from '../domain/rules';
import { GROUP_ICON } from '../domain/species';
import type { AppState, Observation, Species, SpeciesGroup, XpEvent, XpType } from '../domain/types';
import { readPhotoBytes, saveDownloadedPhoto } from './photos';
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

// ---------- 서버 → 기기: 다른 기기에서 로그인했을 때 기록 불러오기 ----------

const PAGE = 1000;

/** 내 행을 모두 읽는다(PostgREST는 한 번에 1000행까지). RLS로 본인 행만 보인다. */
const readAll = async <T,>(table: string, columns: string): Promise<T[]> => {
  const supabase = getSupabase();
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} 불러오기 실패: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
};

interface ObservationRow {
  id: string;
  species_id: string;
  observed_at: string;
  local_date: string;
  photo_path: string | null;
  photo_hash: string;
  region: string | null;
  lat: number | null;
  lng: number | null;
  source: 'ai' | 'manual_demo';
}

interface SpeciesRow {
  id: string;
  no: number;
  name_ko: string;
  scientific_name: string;
  group_key: SpeciesGroup;
  taxon: string;
  feature: string;
  habitat: string;
  season: string;
  role: string;
  similar_note: string;
  is_protected: boolean;
}

/**
 * 로그인한 계정의 서버 기록을 내려받는다. 사진은 이 기기에 저장해 두고 그 주소를 쓴다.
 * onProgress(완료, 전체)로 사진 내려받기 진행을 알린다. 이미 이 기기에 있는 사진은 다시 받지 않는다.
 */
export const pullState = async (
  existingPhotos: Record<string, string>,
  onProgress?: (done: number, total: number) => void,
): Promise<RemoteSnapshot> => {
  const supabase = getSupabase();
  const [obsRows, xpRows, claimRows, dexRows] = await Promise.all([
    readAll<ObservationRow>('observations', 'id, species_id, observed_at, local_date, photo_path, photo_hash, region, lat, lng, source'),
    readAll<{ id: string; idem_key: string; type: XpType; amount: number; created_at: string }>('xp_events', 'id, idem_key, type, amount, created_at'),
    readAll<{ mission_id: string; period_key: string; claimed_at: string }>('mission_claims', 'mission_id, period_key, claimed_at'),
    readAll<{ species_id: string; study_completed_at: string | null }>('dex_progress', 'species_id, study_completed_at'),
  ]);

  const extIds = [...new Set(obsRows.map((o) => o.species_id).filter((id) => !isCore(id)))];
  const extSpecies: Record<string, Species> = {};
  if (extIds.length > 0) {
    const { data, error } = await supabase
      .from('species')
      .select('id, no, name_ko, scientific_name, group_key, taxon, feature, habitat, season, role, similar_note, is_protected')
      .in('id', extIds);
    if (error) throw new Error(`확장 도감 불러오기 실패: ${error.message}`);
    for (const r of (data ?? []) as SpeciesRow[]) {
      extSpecies[r.id] = {
        id: r.id,
        kind: 'ext',
        no: r.no,
        nameKo: r.name_ko,
        scientificName: r.scientific_name,
        group: r.group_key,
        taxon: r.taxon,
        tier: 'explore',
        icon: GROUP_ICON[r.group_key] ?? 'paw',
        feature: r.feature,
        habitat: r.habitat,
        season: r.season,
        role: r.role,
        similar: r.similar_note,
        isProtected: r.is_protected,
      };
    }
  }

  const observations: Observation[] = [];
  let done = 0;
  onProgress?.(0, obsRows.length);
  for (const r of obsRows) {
    let photoUri = existingPhotos[r.id] ?? '';
    if (!photoUri && r.photo_path) {
      try {
        const { data } = await supabase.storage.from(BUCKET).download(r.photo_path);
        if (data) photoUri = await saveDownloadedPhoto(await data.arrayBuffer(), r.id);
      } catch {
        // 사진을 못 받아도 기록은 살린다(카드에는 사진 대신 아이콘이 보인다).
      }
    }
    observations.push({
      id: r.id,
      speciesId: r.species_id,
      observedAt: r.observed_at,
      localDate: r.local_date,
      photoUri,
      photoHash: r.photo_hash,
      region: r.region,
      lat: r.lat === null ? null : Number(r.lat),
      lng: r.lng === null ? null : Number(r.lng),
      source: r.source,
    });
    done += 1;
    onProgress?.(done, obsRows.length);
  }

  const xpEvents: XpEvent[] = xpRows.map((r) => ({ id: r.id, key: r.idem_key, type: r.type, amount: r.amount, createdAt: r.created_at }));
  const missionClaims: Record<string, string> = {};
  for (const c of claimRows) missionClaims[`${c.mission_id}:${c.period_key}`] = c.claimed_at;
  const studies: Record<string, string> = {};
  for (const d of dexRows) if (d.study_completed_at) studies[d.species_id] = d.study_completed_at;

  return { observations, xpEvents, studies, missionClaims, extSpecies };
};
