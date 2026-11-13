import * as Crypto from 'expo-crypto';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildDex,
  claimMission as claimMissionRule,
  collectionRate,
  completeStudy as completeStudyRule,
  deleteObservation,
  levelInfo,
  mergeStates,
  missionStatuses,
  registerObservation,
  totalXp,
} from '../domain/rules';
import { emptyState, type AppState, type DexEntry, type LevelInfo, type MissionStatus, type RegisterInput, type RegisterResult, type Settings } from '../domain/types';
import { getAccount, signOut, type AccountInfo } from '../services/account';
import { deleteAllPhotos, deletePhoto } from '../services/photos';
import { clearState, loadState, saveState } from '../services/storage';
import { cloudEnabled } from '../services/supabase';
import { pullState, pushState, removeRemoteObservation, wipeRemote } from '../services/sync';

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error';

interface Store {
  ready: boolean;
  state: AppState;
  dex: Record<string, DexEntry>;
  level: LevelInfo;
  rate: { found: number; total: number; percent: number };
  missions: MissionStatus[];
  syncStatus: SyncStatus;
  syncError: string | null;
  register: (input: Omit<RegisterInput, 'id'> & { id?: string }) => Promise<RegisterResult>;
  removeObservation: (id: string) => Promise<void>;
  completeStudy: (speciesId: string, answers: number[]) => Promise<{ ok: boolean; xpGained: number }>;
  claimMission: (missionId: string) => Promise<{ ok: boolean; xpGained: number; levelBefore: number; levelAfter: number }>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  syncNow: () => Promise<void>;
  wipeAll: () => Promise<{ remoteOk: boolean }>;
  /** 서버 계정 상태(익명/이메일 연결) */
  account: AccountInfo;
  refreshAccount: () => Promise<AccountInfo>;
  /** 로그인한 계정의 서버 기록을 내려받아 이 기기 기록과 합친다. */
  restoreAccount: (onProgress?: (done: number, total: number) => void) => Promise<{ ok: true; total: number } | { ok: false; message: string }>;
  /** 이 기기에서 로그아웃하고 기기의 기록을 지운다. 백업이 안 된 기록이 있으면 하지 않는다. */
  logout: () => Promise<{ ok: true } | { ok: false; message: string }>;
}

const Ctx = createContext<Store | null>(null);
const makeId = () => Crypto.randomUUID();

export const StoreProvider = ({ children }: { children: React.ReactNode }) => {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<AppState>(emptyState);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(cloudEnabled ? 'idle' : 'off');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [today, setToday] = useState(() => new Date().toDateString());
  const [account, setAccount] = useState<AccountInfo>({ userId: null, email: null, isAnonymous: true });
  const ref = useRef(state);
  const syncing = useRef(false);

  const refreshAccount = useCallback(async () => {
    try {
      const a = await getAccount();
      setAccount(a);
      return a;
    } catch {
      return { userId: null, email: null, isAnonymous: true };
    }
  }, []);

  /** 상태를 바꾸면 곧바로 기기에 저장한다. 저장이 끝난 뒤에 화면에 반영된다. */
  const commit = useCallback(async (next: AppState) => {
    ref.current = next;
    await saveState(next);
    setState(next);
  }, []);

  const syncNow = useCallback(async () => {
    if (!cloudEnabled || syncing.current) return;
    syncing.current = true;
    setSyncStatus('syncing');
    try {
      const done = await pushState(ref.current);
      if (done.length > 0) {
        const synced = { ...ref.current.syncedObservationIds };
        for (const id of done) synced[id] = true;
        await commit({ ...ref.current, syncedObservationIds: synced });
      }
      setSyncError(null);
      setSyncStatus('idle');
      void refreshAccount();
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : '동기화에 실패했습니다.');
      setSyncStatus('error');
    } finally {
      syncing.current = false;
    }
  }, [commit, refreshAccount]);

  useEffect(() => {
    let alive = true;
    loadState().then((loaded) => {
      if (!alive) return;
      ref.current = loaded;
      setState(loaded);
      setReady(true);
      void syncNow();
    });
    // 자정이 지나면 일일 미션이 새로 계산되도록 한다.
    const timer = setInterval(() => setToday(new Date().toDateString()), 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [syncNow]);

  const register = useCallback<Store['register']>(
    async (input) => {
      const { state: next, result } = registerObservation(
        ref.current,
        { ...input, id: input.id ?? makeId() },
        new Date(),
        makeId,
      );
      if (result.ok) {
        await commit(next);
        void syncNow();
      }
      return result;
    },
    [commit, syncNow],
  );

  const removeObservation = useCallback<Store['removeObservation']>(
    async (id) => {
      const target = ref.current.observations.find((o) => o.id === id);
      if (!target) return;
      const wasSynced = !!ref.current.syncedObservationIds[id];
      await commit(deleteObservation(ref.current, id));
      deletePhoto(target.photoUri);
      if (wasSynced) {
        try {
          await removeRemoteObservation(id);
        } catch {
          setSyncError('서버의 기록을 지우지 못했습니다. 연결 후 다시 시도해 주세요.');
          setSyncStatus('error');
        }
      }
      void syncNow();
    },
    [commit, syncNow],
  );

  const completeStudy = useCallback<Store['completeStudy']>(
    async (speciesId, answers) => {
      const r = completeStudyRule(ref.current, speciesId, answers, new Date(), makeId);
      if (r.ok) {
        await commit(r.state);
        void syncNow();
      }
      return { ok: r.ok, xpGained: r.xpGained };
    },
    [commit, syncNow],
  );

  const claimMission = useCallback<Store['claimMission']>(
    async (missionId) => {
      const r = claimMissionRule(ref.current, missionId, new Date(), makeId);
      if (r.ok) {
        await commit(r.state);
        void syncNow();
      }
      return { ok: r.ok, xpGained: r.xpGained, levelBefore: r.levelBefore, levelAfter: r.levelAfter };
    },
    [commit, syncNow],
  );

  const updateSettings = useCallback<Store['updateSettings']>(
    async (patch) => {
      await commit({ ...ref.current, settings: { ...ref.current.settings, ...patch } });
    },
    [commit],
  );

  const wipeAll = useCallback(async () => {
    // 서버 삭제가 실패해도 기기의 데이터는 반드시 지우고, 실패 사실을 알려 준다.
    let remoteOk = true;
    try {
      await wipeRemote();
    } catch {
      remoteOk = false;
    }
    deleteAllPhotos();
    await clearState();
    const fresh = emptyState();
    ref.current = fresh;
    setState(fresh);
    return { remoteOk };
  }, []);

  const restoreAccount = useCallback<Store['restoreAccount']>(
    async (onProgress) => {
      try {
        const photos: Record<string, string> = {};
        for (const o of ref.current.observations) if (o.photoUri) photos[o.id] = o.photoUri;
        const remote = await pullState(photos, onProgress);
        await commit(mergeStates(ref.current, remote, new Date(), makeId));
        await refreshAccount();
        await syncNow(); // 이 기기에만 있던 기록을 계정으로 올린다
        return { ok: true, total: remote.observations.length };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : '기록을 불러오지 못했습니다.' };
      }
    },
    [commit, refreshAccount, syncNow],
  );

  const logout = useCallback<Store['logout']>(async () => {
    await syncNow();
    const pending = ref.current.observations.filter((o) => !ref.current.syncedObservationIds[o.id]).length;
    if (pending > 0) {
      return { ok: false, message: `아직 백업되지 않은 기록이 ${pending}건 있습니다. 인터넷에 연결한 뒤 다시 시도해 주세요.` };
    }
    try {
      await signOut();
    } catch {
      return { ok: false, message: '로그아웃하지 못했습니다. 인터넷 연결을 확인해 주세요.' };
    }
    deleteAllPhotos();
    await clearState();
    const fresh = emptyState();
    ref.current = fresh;
    setState(fresh);
    await refreshAccount();
    return { ok: true };
  }, [syncNow, refreshAccount]);

  const value = useMemo<Store>(() => {
    const now = new Date();
    return {
      ready,
      state,
      dex: buildDex(state),
      level: levelInfo(totalXp(state)),
      rate: collectionRate(state),
      missions: missionStatuses(state, now),
      syncStatus,
      syncError,
      register,
      removeObservation,
      completeStudy,
      claimMission,
      updateSettings,
      syncNow,
      wipeAll,
      account,
      refreshAccount,
      restoreAccount,
      logout,
    };
    // today: 날짜가 바뀌면 미션을 다시 계산한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, state, syncStatus, syncError, today, register, removeObservation, completeStudy, claimMission, updateSettings, syncNow, wipeAll, account, refreshAccount, restoreAccount, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useStore = (): Store => {
  const v = useContext(Ctx);
  if (!v) throw new Error('StoreProvider가 필요합니다.');
  return v;
};
