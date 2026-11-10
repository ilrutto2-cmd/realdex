import { useNavigation } from '@react-navigation/native';
import React, { useMemo } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SPECIES_BY_ID } from '../domain/species';
import type { Observation } from '../domain/types';
import type { RootNav } from '../navigation';
import { useStore } from '../state/store';
import { Banner, formatDate, H, Icon, Panel } from '../ui/components';
import { C, R } from '../ui/theme';

const NO_REGION = '지역 기록 없음';

/** 탐험 기록: 관찰 기록을 지역별로 묶어 보여 준다. 지도 표시는 다음 개발 단계. */
export const RecordsScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<RootNav>();
  const { state } = useStore();

  const groups = useMemo(() => {
    const map = new Map<string, Observation[]>();
    for (const o of state.observations) {
      const key = o.region ?? NO_REGION;
      const list = map.get(key);
      if (list) list.push(o);
      else map.set(key, [o]);
    }
    return [...map.entries()]
      .map(([region, list]) => ({
        region,
        list: [...list].sort((a, b) => b.observedAt.localeCompare(a.observedAt)),
        species: new Set(list.map((o) => o.speciesId)).size,
      }))
      .sort((a, b) => (a.region === NO_REGION ? 1 : b.region === NO_REGION ? -1 : b.list.length - a.list.length));
  }, [state.observations]);

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 10 }]} style={{ backgroundColor: C.bg }}>
      <Text style={styles.title}>탐험 기록</Text>
      <Banner
        icon="map-legend"
        text="지도 화면은 다음 개발 단계에서 추가됩니다. 지금은 관찰 기록을 지역별 목록으로 보여 줍니다. 위치는 나에게만 보이며 시·구 수준으로만 저장됩니다."
      />
      {!state.settings.recordRegion ? (
        <Banner icon="map-marker" tone="warn" text="발견 지역 기록이 꺼져 있습니다. 마이페이지에서 켜면 등록할 때 시·구 단위 지역이 함께 저장됩니다." />
      ) : null}
      {groups.length === 0 ? (
        <Panel>
          <Text style={styles.empty}>아직 관찰 기록이 없어요.</Text>
        </Panel>
      ) : (
        groups.map((g) => (
          <Panel key={g.region} style={{ gap: 10 }}>
            <View style={styles.row}>
              <Icon name="map-marker" size={20} color={C.green} />
              <H style={{ flex: 1 }}>{g.region}</H>
              <Text style={styles.count}>
                {g.species}종 · {g.list.length}건
              </Text>
            </View>
            {g.list.map((o) => {
              const sp = SPECIES_BY_ID[o.speciesId];
              return (
                <Pressable
                  key={o.id}
                  testID="record-row"
                  onPress={() => navigation.navigate('Species', { id: o.speciesId })}
                  accessibilityRole="button"
                  accessibilityLabel={`${sp.nameKo} ${formatDate(o.observedAt)}`}
                  style={styles.item}
                >
                  <Image source={{ uri: o.photoUri }} style={styles.photo} resizeMode="cover" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{sp.nameKo}</Text>
                    <Text style={styles.meta}>{formatDate(o.observedAt)}</Text>
                  </View>
                  <Icon name="chevron-right" size={22} color={C.faint} />
                </Pressable>
              );
            })}
          </Panel>
        ))
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  title: { fontSize: 22, fontWeight: '900', color: C.forest, letterSpacing: -0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  count: { fontSize: 12, fontWeight: '800', color: C.sub },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  photo: { width: 48, height: 48, borderRadius: R.sm, backgroundColor: C.mint },
  name: { fontSize: 15, fontWeight: '800', color: C.ink },
  meta: { fontSize: 12, color: C.sub, marginTop: 2 },
  empty: { fontSize: 14, color: C.sub },
});
