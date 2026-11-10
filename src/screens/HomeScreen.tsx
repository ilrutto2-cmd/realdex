import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useRef, useState } from 'react';
import { Animated, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SPECIES_BY_ID } from '../domain/species';
import type { MissionStatus } from '../domain/types';
import type { RootNav } from '../navigation';
import { cloudEnabled } from '../services/supabase';
import { useStore } from '../state/store';
import { Banner, Button, H, Icon, Panel, ProgressBar, StageStars } from '../ui/components';
import { C, R } from '../ui/theme';

export const HomeScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<RootNav>();
  const { level, rate, missions, dex, claimMission } = useStore();
  const [toast, setToast] = useState<string | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  const claim = useCallback(
    async (m: MissionStatus) => {
      const r = await claimMission(m.id);
      if (!r.ok) return;
      setToast(r.levelAfter > r.levelBefore ? `+${r.xpGained} 경험치 · 레벨 ${r.levelAfter} 달성!` : `+${r.xpGained} 경험치`);
      toastAnim.setValue(0);
      // 보상 연출: 알림이 떠오르고 경험치 막대가 한 번 커졌다 돌아온다.
      Animated.parallel([
        Animated.sequence([
          Animated.spring(toastAnim, { toValue: 1, friction: 5, useNativeDriver: true }),
          Animated.delay(1400),
          Animated.timing(toastAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.04, duration: 180, useNativeDriver: true }),
          Animated.spring(pulse, { toValue: 1, friction: 3, useNativeDriver: true }),
        ]),
      ]).start(() => setToast(null));
    },
    [claimMission, pulse, toastAnim],
  );

  const recent = Object.values(dex)
    .sort((a, b) => b.lastObservedAt.localeCompare(a.lastObservedAt))
    .slice(0, 8);
  const daily = missions.filter((m) => m.period === 'daily');
  const weekly = missions.filter((m) => m.period === 'weekly');

  const renderMission = (m: MissionStatus) => (
    <View key={m.id} style={styles.mission} testID={`mission-${m.id}`}>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={[styles.missionTitle, m.claimed && { color: C.faint }]}>{m.title}</Text>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <ProgressBar ratio={m.progress / m.target} color={m.completed ? C.amber : C.green} height={8} />
          </View>
          <Text style={styles.missionCount}>
            {m.progress}/{m.target}
          </Text>
        </View>
      </View>
      {m.claimed ? (
        <View style={styles.done}>
          <Icon name="check-circle" size={22} color={C.moss} />
        </View>
      ) : m.completed ? (
        <Pressable
          testID={`claim-${m.id}`}
          onPress={() => void claim(m)}
          accessibilityRole="button"
          accessibilityLabel={`${m.title} 보상 받기`}
          style={styles.claim}
        >
          <Text style={styles.claimText}>+{m.rewardXp}</Text>
          <Text style={styles.claimSub}>받기</Text>
        </Pressable>
      ) : (
        <Text style={styles.reward}>+{m.rewardXp}</Text>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 14 }]}>
        <Animated.View style={[styles.hero, { transform: [{ scale: pulse }] }]}>
          <View style={styles.row}>
            <View style={styles.avatar}>
              <Icon name="compass-outline" size={30} color={C.amber} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle} testID="level-title">
                {level.title}
              </Text>
              <Text style={styles.heroLevel} testID="level">
                탐험 레벨 {level.level}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.heroRate} testID="rate">
                {rate.found}/{rate.total}
              </Text>
              <Text style={styles.heroRateLabel}>도감 {rate.percent}%</Text>
            </View>
          </View>
          <ProgressBar ratio={level.xpIntoLevel / level.xpForNext} color={C.amber} />
          <Text style={styles.heroXp} testID="xp">
            경험치 {level.xpIntoLevel} / {level.xpForNext} · 누적 {level.totalXp}
          </Text>
        </Animated.View>

        {!cloudEnabled ? (
          <Banner
            testID="home-demo-banner"
            icon="flask-outline"
            tone="warn"
            text="데모 모드: AI 판별 서버가 연결되지 않았습니다. 기록은 이 기기에만 저장되고, 생물은 직접 골라 등록합니다."
          />
        ) : null}

        <Button testID="go-capture" label="생물 촬영하러 가기" icon="camera-iris" onPress={() => navigation.navigate('Tabs', { screen: 'Capture' })} />

        <Panel style={{ gap: 12 }}>
          <View style={styles.row}>
            <Icon name="calendar-today" size={20} color={C.green} />
            <H>오늘의 미션</H>
          </View>
          {daily.map(renderMission)}
        </Panel>

        <Panel style={{ gap: 12 }}>
          <View style={styles.row}>
            <Icon name="calendar-week" size={20} color={C.green} />
            <H>이번 주 미션</H>
          </View>
          {weekly.map(renderMission)}
        </Panel>

        <View style={{ gap: 10 }}>
          <H>최근 수집한 생물</H>
          {recent.length === 0 ? (
            <Panel>
              <Text style={styles.empty}>아직 발견한 생물이 없어요. 집 앞 화단이나 공원에서 첫 생물을 찾아보세요.</Text>
            </Panel>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {recent.map((e) => {
                const sp = SPECIES_BY_ID[e.speciesId];
                return (
                  <Pressable
                    key={e.speciesId}
                    testID={`recent-${e.speciesId}`}
                    onPress={() => navigation.navigate('Species', { id: e.speciesId })}
                    accessibilityRole="button"
                    accessibilityLabel={sp.nameKo}
                    style={styles.recent}
                  >
                    <Image source={{ uri: e.coverPhotoUri }} style={styles.recentPhoto} resizeMode="cover" />
                    <Text numberOfLines={1} style={styles.recentName}>
                      {sp.nameKo}
                    </Text>
                    <StageStars stage={e.stage} size={11} />
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </ScrollView>
      {toast ? (
        <Animated.View
          pointerEvents="none"
          testID="toast"
          style={[
            styles.toast,
            { top: insets.top + 20, opacity: toastAnim, transform: [{ scale: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] },
          ]}
        >
          <Icon name="star" size={20} color={C.night} />
          <Text style={styles.toastText}>{toast}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hero: { backgroundColor: C.forest, borderRadius: R.lg, padding: 18, gap: 12 },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: C.white, fontSize: 21, fontWeight: '900', letterSpacing: -0.5 },
  heroLevel: { color: '#BFD3C2', fontSize: 13, fontWeight: '700' },
  heroRate: { color: C.amber, fontSize: 22, fontWeight: '900' },
  heroRateLabel: { color: '#BFD3C2', fontSize: 11, fontWeight: '700' },
  heroXp: { color: '#BFD3C2', fontSize: 12, fontWeight: '600' },
  mission: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  missionTitle: { fontSize: 14, fontWeight: '700', color: C.ink },
  missionCount: { fontSize: 12, fontWeight: '800', color: C.sub, minWidth: 28, textAlign: 'right' },
  reward: { fontSize: 13, fontWeight: '800', color: C.faint, minWidth: 54, textAlign: 'center' },
  done: { minWidth: 54, alignItems: 'center' },
  claim: { minWidth: 54, minHeight: 44, borderRadius: R.sm, backgroundColor: C.amber, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  claimText: { fontSize: 14, fontWeight: '900', color: C.night },
  claimSub: { fontSize: 10, fontWeight: '800', color: C.night },
  empty: { fontSize: 14, lineHeight: 21, color: C.sub },
  recent: { width: 104, backgroundColor: C.surface, borderRadius: R.md, borderWidth: 1, borderColor: C.line, overflow: 'hidden', paddingBottom: 8, gap: 4, alignItems: 'center' },
  recentPhoto: { width: 104, height: 92, backgroundColor: C.mint },
  recentName: { fontSize: 12, fontWeight: '800', color: C.ink, paddingHorizontal: 6 },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    backgroundColor: C.amber,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: R.pill,
  },
  toastText: { fontSize: 16, fontWeight: '900', color: C.night },
});
