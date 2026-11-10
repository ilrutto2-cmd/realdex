import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { DexEntry, Species } from '../domain/types';
import { Icon, speciesNumber, StageStars } from './components';
import { C, R, STAGE_STYLE } from './theme';

/** 도감 격자에 쓰는 작은 카드. 미발견 종은 이름을 가리고 실루엣만 보여 준다. */
export const DexCard = ({
  species,
  entry,
  onPress,
  width,
}: {
  species: Species;
  entry?: DexEntry;
  onPress: () => void;
  width: number;
}) => {
  const stage = entry?.stage ?? 0;
  const st = STAGE_STYLE[stage];
  return (
    <Pressable
      testID={`dex-card-${species.id}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={entry ? `${species.nameKo}, ${st.label}` : `${species.no}번 미발견 생물`}
      style={({ pressed }) => [
        styles.card,
        { width, borderColor: st.border, opacity: pressed ? 0.85 : 1 },
        stage === 3 && styles.gold,
      ]}
    >
      <View style={[styles.photo, { height: width * 0.92 }, !entry && styles.unknown]}>
        {entry ? (
          <Image source={{ uri: entry.coverPhotoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <Icon name={species.icon} size={width * 0.46} color="#31443A" />
        )}
        <Text style={[styles.no, !entry && { color: C.faint }]}>{speciesNumber(species)}</Text>
      </View>
      <View style={styles.meta}>
        <Text numberOfLines={1} style={[styles.name, !entry && { color: C.faint }]}>
          {entry ? species.nameKo : '???'}
        </Text>
        <StageStars stage={stage} size={11} />
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: R.md, borderWidth: 2, overflow: 'hidden' },
  gold: { backgroundColor: C.amberSoft },
  photo: { backgroundColor: C.mint, alignItems: 'center', justifyContent: 'center' },
  unknown: { backgroundColor: C.night },
  no: {
    position: 'absolute',
    top: 5,
    left: 6,
    fontSize: 9,
    fontWeight: '800',
    color: C.white,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 3,
  },
  meta: { paddingHorizontal: 7, paddingVertical: 6, gap: 3 },
  name: { fontSize: 12, fontWeight: '800', color: C.ink },
});
