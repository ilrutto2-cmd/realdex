import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ACHIEVEMENTS } from '../domain/rules';
import { GROUP_LABEL, TIER_LABEL } from '../domain/species';
import type { MissionStatus, RegisterResult, Species } from '../domain/types';
import { Button, Icon, StageStars, Tag } from './components';
import { C, R, STAGE_STYLE } from './theme';

export interface RevealData {
  species: Species;
  photoUri: string;
  result: RegisterResult;
  levelTitle: string;
  nextMission: MissionStatus | null;
}

/** 도감 등록 직후 화면. 신규 발견이면 카드가 뒤집히며 나타난다. */
export const RevealModal = ({
  data,
  onClose,
  onOpenCard,
}: {
  data: RevealData | null;
  onClose: () => void;
  onOpenCard: () => void;
}) => {
  const flip = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!data) return;
    flip.setValue(0);
    pop.setValue(0);
    glow.setValue(0);
    rise.setValue(0);
    const isNew = data.result.isNewSpecies;
    Animated.sequence([
      Animated.parallel([
        Animated.spring(pop, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }),
        Animated.timing(flip, {
          toValue: 1,
          duration: isNew ? 900 : 1,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(rise, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.loop(
          Animated.sequence([
            Animated.timing(glow, { toValue: 1, duration: 900, useNativeDriver: true }),
            Animated.timing(glow, { toValue: 0, duration: 900, useNativeDriver: true }),
          ]),
          { iterations: 3 },
        ),
      ]),
    ]).start();
  }, [data, flip, pop, glow, rise]);

  if (!data) return null;
  const { species, result } = data;
  const st = STAGE_STYLE[result.stageAfter];
  const stageUp = result.stageBefore !== 0 && result.stageAfter > result.stageBefore;
  const levelUp = result.levelAfter > result.levelBefore;
  const headline = result.isNewSpecies ? '새로운 발견!' : stageUp ? '도감 카드가 성장했어요' : '관찰 기록 추가';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ScrollView contentContainerStyle={styles.center}>
          <Text testID="reveal-headline" style={styles.headline}>
            {headline}
          </Text>
          <View>
            <Animated.View
              style={[
                styles.halo,
                { opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.7] }), backgroundColor: st.tint },
              ]}
            />
            <Animated.View
              style={[
                styles.card,
                {
                  borderColor: st.border,
                  transform: [
                    { perspective: 900 },
                    { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
                    { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ['540deg', '0deg'] }) },
                  ],
                },
              ]}
            >
              <Image source={{ uri: data.photoUri }} style={styles.photo} resizeMode="cover" />
              <View style={styles.cardBody}>
                <View style={styles.rowBetween}>
                  <Text style={styles.no}>No.{String(species.no).padStart(3, '0')}</Text>
                  <StageStars stage={result.stageAfter} size={14} />
                </View>
                <Text testID="reveal-name" style={styles.name}>
                  {species.nameKo}
                </Text>
                <Text style={styles.sci}>{species.scientificName}</Text>
                <View style={styles.tags}>
                  <Tag label={GROUP_LABEL[species.group]} />
                  <Tag label={TIER_LABEL[species.tier]} bg={C.amberSoft} color="#7A5206" />
                </View>
              </View>
            </Animated.View>
          </View>

          <Animated.View
            style={[
              styles.info,
              { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] },
            ]}
          >
            <Text testID="reveal-xp" style={styles.xp}>
              {result.xpGained > 0 ? `+${result.xpGained} 경험치` : '오늘 이 생물의 점수는 이미 받았어요'}
            </Text>
            {stageUp ? <Line icon="arrow-up-bold-circle" text={`${st.label}로 성장`} /> : null}
            {levelUp ? <Line icon="trophy" text={`탐험 레벨 ${result.levelAfter} 달성 · ${data.levelTitle}`} /> : null}
            {result.newAchievements.map((id) => {
              const a = ACHIEVEMENTS.find((x) => x.id === id);
              return a ? <Line key={id} icon={a.icon} text={`업적 획득: ${a.title}`} /> : null;
            })}
            <Text style={styles.eco}>{species.role}</Text>
            {data.nextMission ? (
              <View style={styles.mission}>
                <Icon name="target" size={18} color={C.amber} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.missionLabel}>다음 미션</Text>
                  <Text testID="reveal-next-mission" style={styles.missionTitle}>
                    {data.nextMission.title} ({data.nextMission.progress}/{data.nextMission.target})
                  </Text>
                </View>
              </View>
            ) : null}
            <Button testID="reveal-open-card" label="도감에서 보기" icon="book-open-variant" kind="amber" onPress={onOpenCard} />
            <Button testID="reveal-close" label="계속 탐험하기" kind="light" onPress={onClose} />
          </Animated.View>
        </ScrollView>
      </View>
    </Modal>
  );
};

const Line = ({ icon, text }: { icon: string; text: string }) => (
  <View style={styles.line}>
    <Icon name={icon} size={18} color={C.amber} />
    <Text style={styles.lineText}>{text}</Text>
  </View>
);

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,28,21,0.94)' },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 18 },
  headline: { color: C.amber, fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  halo: { position: 'absolute', top: -14, left: -14, right: -14, bottom: -14, borderRadius: R.lg + 14 },
  card: { width: 250, backgroundColor: C.surface, borderRadius: R.lg, borderWidth: 4, overflow: 'hidden' },
  photo: { width: '100%', height: 230, backgroundColor: C.mint },
  cardBody: { padding: 14, gap: 4 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  no: { fontSize: 11, fontWeight: '800', color: C.sub },
  name: { fontSize: 22, fontWeight: '900', color: C.ink, letterSpacing: -0.5 },
  sci: { fontSize: 13, fontStyle: 'italic', color: C.sub },
  tags: { flexDirection: 'row', gap: 6, marginTop: 6 },
  info: { width: '100%', maxWidth: 340, gap: 10 },
  xp: { color: C.white, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  line: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  lineText: { color: C.white, fontSize: 14, fontWeight: '700' },
  eco: { color: '#C9D6C4', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  mission: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    padding: 12,
    borderRadius: R.md,
  },
  missionLabel: { color: C.amber, fontSize: 11, fontWeight: '800' },
  missionTitle: { color: C.white, fontSize: 14, fontWeight: '700' },
});
