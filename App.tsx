import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { RootStackParamList, TabParamList } from './src/navigation';
import { CaptureScreen } from './src/screens/CaptureScreen';
import { DexScreen } from './src/screens/DexScreen';
import { FeedbackScreen } from './src/screens/FeedbackScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { MyScreen } from './src/screens/MyScreen';
import { QuizScreen } from './src/screens/QuizScreen';
import { RecordsScreen } from './src/screens/RecordsScreen';
import { SpeciesScreen } from './src/screens/SpeciesScreen';
import { StatsScreen } from './src/screens/StatsScreen';
import { StoreProvider, useStore } from './src/state/store';
import { Icon } from './src/ui/components';
import { C, shadow } from './src/ui/theme';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: C.bg, card: C.surface, text: C.ink, border: C.line, primary: C.forest },
};

const tabIcon = (name: string) =>
  function TabIcon({ color, size }: { color: string; size: number }) {
    return <Icon name={name} size={size} color={color} />;
  };

const CameraTabIcon = () => (
  <View style={styles.cameraButton}>
    <Icon name="camera-iris" size={32} color={C.white} />
  </View>
);

const Tabs = () => (
  <Tab.Navigator
    screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: C.forest,
      tabBarInactiveTintColor: C.faint,
      tabBarStyle: { height: 68, paddingBottom: 8, paddingTop: 6, backgroundColor: C.surface, borderTopColor: C.line },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
    }}
  >
    <Tab.Screen name="Home" component={HomeScreen} options={{ title: '홈', tabBarButtonTestID: 'tab-home', tabBarIcon: tabIcon('home-variant') }} />
    <Tab.Screen name="Records" component={RecordsScreen} options={{ title: '탐험 기록', tabBarButtonTestID: 'tab-records', tabBarIcon: tabIcon('map-legend') }} />
    <Tab.Screen
      name="Capture"
      component={CaptureScreen}
      options={{ title: '촬영', tabBarButtonTestID: 'tab-capture', tabBarIcon: CameraTabIcon, tabBarLabel: () => null }}
    />
    <Tab.Screen name="Dex" component={DexScreen} options={{ title: '도감', tabBarButtonTestID: 'tab-dex', tabBarIcon: tabIcon('book-open-variant') }} />
    <Tab.Screen name="My" component={MyScreen} options={{ title: '마이', tabBarButtonTestID: 'tab-my', tabBarIcon: tabIcon('account-circle') }} />
  </Tab.Navigator>
);

const Root = () => {
  const { ready } = useStore();
  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={C.forest} />
      </View>
    );
  }
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.forest,
          headerTitleStyle: { fontWeight: '800' },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false, title: 'REALDEX' }} />
        <Stack.Screen name="Species" component={SpeciesScreen} options={{ title: '도감 카드' }} />
        <Stack.Screen name="Quiz" component={QuizScreen} options={{ title: '생태 탐구' }} />
        <Stack.Screen name="Feedback" component={FeedbackScreen} options={({ route }) => ({ title: route.params.kind === 'misid' ? '판별 오류 신고' : '의견 보내기' })} />
        <Stack.Screen name="Stats" component={StatsScreen} options={{ title: '관리자 통계' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style="dark" />
        <Root />
      </StoreProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  cameraButton: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -18,
    borderWidth: 4,
    borderColor: C.surface,
    ...shadow,
  },
});
