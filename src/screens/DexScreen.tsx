import { useNavigation } from '@react-navigation/native';
import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GROUP_LABEL, SPECIES } from '../domain/species';
import type { SpeciesGroup } from '../domain/types';
import type { RootNav } from '../navigation';
import { useStore } from '../state/store';
import { Chip, ProgressBar } from '../ui/components';
import { DexCard } from '../ui/DexCard';
import { C } from '../ui/theme';

type Filter = 'all' | Exclude<SpeciesGroup, 'other'> | 'found' | 'ext';
const GAP = 10;
const PAD = 16;

export const DexScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<RootNav>();
  const { width } = useWindowDimensions();
  const { state, dex, rate } = useStore();
  const [filter, setFilter] = useState<Filter>('all');

  const columns = width >= 700 ? 5 : 3;
  const cardWidth = Math.floor((Math.min(width, 900) - PAD * 2 - GAP * (columns - 1)) / columns);
  // 확장 도감: 관찰 기록이 남아 있는 확장 종만, 최근 발견 순으로.
  const extList = useMemo(
    () =>
      Object.values(state.extSpecies)
        .filter((s) => !!dex[s.id])
        .sort((a, b) => dex[b.id].firstObservedAt.localeCompare(dex[a.id].firstObservedAt)),
    [dex, state.extSpecies],
  );
  const list = useMemo(() => {
    if (filter === 'ext') return extList;
    if (filter === 'found') return [...SPECIES.filter((s) => !!dex[s.id]), ...extList];
    return SPECIES.filter((s) => (filter === 'all' ? true : s.group === filter));
  }, [dex, filter, extList]);
  const groupCount = (g: SpeciesGroup) => {
    const all = SPECIES.filter((s) => s.group === g);
    return `${GROUP_LABEL[g]} ${all.filter((s) => dex[s.id]).length}/${all.length}`;
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.rowBetween}>
          <Text style={styles.title}>생물 도감</Text>
          <Text style={styles.rate} testID="dex-rate">
            {rate.found} / {rate.total}종 · {rate.percent}%
          </Text>
        </View>
        <ProgressBar ratio={rate.found / rate.total} />
        <View style={styles.chips}>
          <Chip testID="filter-all" label="전체" active={filter === 'all'} onPress={() => setFilter('all')} />
          <Chip testID="filter-insect" label={groupCount('insect')} active={filter === 'insect'} onPress={() => setFilter('insect')} />
          <Chip testID="filter-bird" label={groupCount('bird')} active={filter === 'bird'} onPress={() => setFilter('bird')} />
          <Chip testID="filter-mammal" label={groupCount('mammal')} active={filter === 'mammal'} onPress={() => setFilter('mammal')} />
          <Chip testID="filter-found" label="발견한 생물" active={filter === 'found'} onPress={() => setFilter('found')} />
          <Chip testID="filter-ext" label={`확장 도감 ${extList.length}종`} active={filter === 'ext'} onPress={() => setFilter('ext')} />
        </View>
      </View>
      <FlatList
        key={columns}
        data={list}
        numColumns={columns}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={{ gap: GAP }}
        renderItem={({ item }) => (
          <DexCard
            species={item}
            entry={dex[item.id]}
            width={cardWidth}
            onPress={() => navigation.navigate('Species', { id: item.id })}
          />
        )}
        ListHeaderComponent={
          filter === 'ext' ? (
            <Text style={styles.extHint}>
              기본 도감 밖에서 AI가 종까지 확실하게 판별한 생물이 모입니다. 끝이 없는 도감이라 수집률에는 들어가지 않아요.
            </Text>
          ) : undefined
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {filter === 'ext' ? '아직 확장 도감에 등록한 생물이 없어요.' : '아직 발견한 생물이 없어요.'}
          </Text>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  header: { paddingHorizontal: PAD, paddingBottom: 12, gap: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: '900', color: C.forest, letterSpacing: -0.5 },
  rate: { fontSize: 14, fontWeight: '800', color: C.green },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grid: { paddingHorizontal: PAD, paddingBottom: 28, gap: GAP },
  empty: { textAlign: 'center', color: C.sub, marginTop: 40, fontSize: 14 },
  extHint: { fontSize: 12, lineHeight: 18, color: C.sub, marginBottom: 4 },
});
