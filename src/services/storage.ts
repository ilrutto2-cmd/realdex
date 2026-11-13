import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { emptyState, type AppState } from '../domain/types';

const KEY = 'realdex/state/v1';

// ---------- 웹: IndexedDB ----------
// 웹의 localStorage는 약 5MB라 사진이 들어간 기록을 오래 담을 수 없다. 웹에서는 IndexedDB를 쓴다.

const DB_NAME = 'realdex';
const STORE = 'kv';

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const idb = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> => {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
};

const webAvailable = (): boolean => Platform.OS === 'web' && typeof indexedDB !== 'undefined';

let persistAsked = false;
/** 브라우저에 저장 공간을 지우지 말아 달라고 요청한다(허용 여부는 브라우저가 정한다). */
const askPersist = () => {
  if (persistAsked || typeof navigator === 'undefined' || !navigator.storage?.persist) return;
  persistAsked = true;
  navigator.storage.persist().catch(() => undefined);
};

const readRaw = async (): Promise<string | null> => {
  if (webAvailable()) {
    try {
      const v = await idb<string | undefined>('readonly', (s) => s.get(KEY));
      if (typeof v === 'string') return v;
      // 이전 버전(localStorage)에 저장된 기록이 있으면 옮겨 온다.
      const legacy = await AsyncStorage.getItem(KEY);
      if (legacy) {
        await idb('readwrite', (s) => s.put(legacy, KEY));
        await AsyncStorage.removeItem(KEY);
      }
      return legacy;
    } catch {
      return AsyncStorage.getItem(KEY);
    }
  }
  return AsyncStorage.getItem(KEY);
};

export const loadState = async (): Promise<AppState> => {
  try {
    const raw = await readRaw();
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<AppState>;
    if (parsed.version !== 1) return emptyState();
    // 이후 버전에서 필드가 늘어나도 기본값으로 채워지도록 합친다.
    const base = emptyState();
    return { ...base, ...parsed, settings: { ...base.settings, ...parsed.settings } } as AppState;
  } catch {
    return emptyState();
  }
};

export const saveState = async (state: AppState): Promise<void> => {
  const raw = JSON.stringify(state);
  if (webAvailable()) {
    askPersist();
    await idb('readwrite', (s) => s.put(raw, KEY));
    return;
  }
  await AsyncStorage.setItem(KEY, raw);
};

export const clearState = async (): Promise<void> => {
  if (webAvailable()) {
    try {
      await idb('readwrite', (s) => s.delete(KEY));
    } catch {
      // 무시
    }
  }
  await AsyncStorage.removeItem(KEY);
};
