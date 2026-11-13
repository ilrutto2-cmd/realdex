import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

export type TabParamList = {
  Home: undefined;
  Records: undefined;
  Capture: undefined;
  Dex: undefined;
  My: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  Species: { id: string };
  Quiz: { id: string };
  /** 의견 보내기(general) 또는 판별 오류 신고(misid) */
  Feedback: { kind: 'general' | 'misid'; context?: Record<string, unknown>; photoUri?: string | null; aiSaid?: string };
  Stats: undefined;
  Account: undefined;
};

export type RootNav = NativeStackNavigationProp<RootStackParamList>;
