import AsyncStorage from '@react-native-async-storage/async-storage';
import { emptyState, type AppState } from '../domain/types';

const KEY = 'realdex/state/v1';

export const loadState = async (): Promise<AppState> => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
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
  await AsyncStorage.setItem(KEY, JSON.stringify(state));
};

export const clearState = async (): Promise<void> => {
  await AsyncStorage.removeItem(KEY);
};
