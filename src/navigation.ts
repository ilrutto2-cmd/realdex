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
};

export type RootNav = NativeStackNavigationProp<RootStackParamList>;
