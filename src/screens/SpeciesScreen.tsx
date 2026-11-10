import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { canStudy, speciesOf } from '../domain/rules';
import { GROUP_LABEL, TIER_LABEL } from '../domain/species';
import type { RootNav, RootStackParamList } from '../navigation';
import { useStore } from '../state/store';
import { Banner, Button, confirm, formatDate, H, Icon, Panel, speciesNumber, StageStars, Tag } from '../ui/components';
import { C, R, STAGE_STYLE } from '../ui/theme';

export const SpeciesScreen = () => {
  const { params } = useRoute<RouteProp<RootStackParamList, 'Species'>>();
  const navigation = useNavigation<RootNav>();
  const { state, dex, removeObservation } = useStore();
  const sp = speciesOf(state, params.id);
  const entry = dex[params.id];

  if (!sp) {
    return (
      <View style={styles.center}>
        <Text style={styles.body}>도감에 없는 생물입니다.</Text>
      </View>
    );
  }

  if (!entry) {
    return (
      <ScrollView contentContainerStyle={styles.content} testID="species-unknown">
        <View style={[styles.card, { borderColor: STAGE_STYLE[0].border }]}>
          <View style={[styles.photo, styles.unknown]}>
            <Icon name={sp.icon} size={130} color="#31443A" />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.no}>{speciesNumber(sp)}</Text>
            <Text style={styles.name}>???</Text>
            <View style={styles.tags}>
              <Tag label={GROUP_LABEL[sp.group]} />
              <Tag label={TIER_LABEL[sp.tier]} bg={C.amberSoft} color="#7A5206" />
            </View>
          </View>
        </View>
        <Panel style={{ gap: 6 }}>
          <H>아직 발견하지 못한 생물</H>
          <Text style={styles.label}>이런 곳을 살펴보세요</Text>
          <Text style={styles.body}>{sp.habitat}</Text>
          <Text style={styles.label}>자주 보이는 때</Text>
          <Text style={styles.body}>{sp.season}</Text>
        </Panel>
        <Button label="촬영하러 가기" icon="camera-iris" onPress={() => navigation.navigate('Tabs', { screen: 'Capture' })} />
      </ScrollView>
    );
  }

  const st = STAGE_STYLE[entry.stage];
  const history = state.observations
    .filter((o) => o.speciesId === sp.id)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const studyReady = canStudy(state, sp.id);
  const hasManual = history.some((o) => o.source === 'manual_demo');
  const isExt = sp.kind === 'ext';

  const remove = async (id: string) => {
    const last = history.length === 1;
    const ok = await confirm(
      '관찰 기록 삭제',
      last
        ? '이 기록과 사진을 지우면 도감 카드도 사라집니다. 이미 받은 경험치는 그대로이며, 다시 등록해도 신규 발견 점수는 받을 수 없습니다.'
        : '이 관찰 기록과 사진을 지웁니다.',
      '삭제',
    );
    if (!ok) return;
    await removeObservation(id);
    if (last) navigation.goBack();
  };

  return (
    <ScrollView contentContainerStyle={styles.content} testID="species-detail">
      <View style={[styles.card, { borderColor: st.border }, entry.stage === 3 && { backgroundColor: C.amberSoft }]}>
        <Image source={{ uri: entry.coverPhotoUri }} style={styles.photo} resizeMode="cover" />
        <View style={styles.cardBody}>
          <View style={styles.rowBetween}>
            <Text style={styles.no}>{speciesNumber(sp)}</Text>
            <StageStars stage={entry.stage} size={16} />
          </View>
          <Text style={styles.name} testID="species-name">
            {sp.nameKo}
          </Text>
          <Text style={styles.sci}>{sp.scientificName}</Text>
          <View style={styles.tags}>
            <Tag label={GROUP_LABEL[sp.group]} />
            {sp.taxon ? <Tag label={sp.taxon} bg={C.line} color={C.sub} /> : null}
            {isExt ? <Tag label="확장 도감" bg={C.amberSoft} color="#7A5206" /> : <Tag label={TIER_LABEL[sp.tier]} bg={C.amberSoft} color="#7A5206" />}
          </View>
          <View style={styles.stats}>
            <Stat label="첫 발견" value={formatDate(entry.firstObservedAt)} />
            <Stat label="발견 지역" value={entry.firstRegion ?? '기록 안 함'} />
            <Stat label="관찰 횟수" value={`${entry.observationCount}회`} testID="species-count" />
          </View>
          <Text style={[styles.stage, { color: st.tint }]} testID="species-stage">
            {st.label}
          </Text>
        </View>
      </View>

      {isExt ? (
        <Banner
          testID="ext-banner"
          icon="compass-outline"
          tone="warn"
          text="확장 도감 생물입니다. AI가 종까지 확실하다고 판별한 기록이며, 아래 설명은 AI가 작성해 사람이 검수하지 않았습니다. 수집률에는 포함되지 않습니다."
        />
      ) : null}

      {hasManual ? (
        <Banner icon="flask-outline" tone="warn" text="데모 모드에서 직접 선택해 등록한 기록이 포함되어 있습니다. AI 판별을 거치지 않았습니다." />
      ) : null}

      <Panel style={{ gap: 6 }}>
        <H>도감 성장</H>
        <Step done label="1단계 · 최초 발견" desc="도감 카드 해금" />
        <Step done={entry.stage >= 2} label="2단계 · 재관찰" desc="다른 날이나 다른 지역에서 한 번 더 관찰하기" />
        {isExt ? null : (
          <Step done={entry.stage >= 3} label="3단계 · 생태 탐구" desc="탐구 퀴즈 3문제를 모두 맞히기 (+300 경험치)" />
        )}
        {studyReady ? (
          <Button testID="start-quiz" label="생태 탐구 시작" icon="school" kind="amber" onPress={() => navigation.navigate('Quiz', { id: sp.id })} style={{ marginTop: 8 }} />
        ) : null}
      </Panel>

      <Panel style={{ gap: 4 }}>
        <H>생태 정보</H>
        <Text style={styles.label}>생김새</Text>
        <Text style={styles.body}>{sp.feature}</Text>
        <Text style={styles.label}>주요 서식 환경</Text>
        <Text style={styles.body}>{sp.habitat}</Text>
        <Text style={styles.label}>주요 활동 시기</Text>
        <Text style={styles.body}>{sp.season}</Text>
        <Text style={styles.label}>생태적 역할</Text>
        <Text style={styles.body}>{sp.role}</Text>
        <Text style={styles.label}>비슷한 종과 구별</Text>
        <Text style={styles.body}>{sp.similar}</Text>
      </Panel>

      <Panel style={{ gap: 10 }}>
        <H>관찰 기록 {history.length}건</H>
        {history.map((o) => (
          <View key={o.id} style={styles.obs} testID="observation-row">
            <Image source={{ uri: o.photoUri }} style={styles.obsPhoto} resizeMode="cover" />
            <View style={{ flex: 1 }}>
              <Text style={styles.obsDate}>{formatDate(o.observedAt)}</Text>
              <Text style={styles.obsMeta}>
                {o.region ?? '지역 기록 안 함'} · {o.source === 'ai' ? 'AI 판별' : '직접 선택'}
              </Text>
            </View>
            <Pressable
              testID="delete-observation"
              onPress={() => void remove(o.id)}
              accessibilityRole="button"
              accessibilityLabel="관찰 기록 삭제"
              style={styles.trash}
            >
              <Icon name="delete-outline" size={22} color={C.coral} />
            </Pressable>
          </View>
        ))}
      </Panel>
    </ScrollView>
  );
};

const Stat = ({ label, value, testID }: { label: string; value: string; testID?: string }) => (
  <View style={{ flex: 1 }}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={styles.statValue} testID={testID}>
      {value}
    </Text>
  </View>
);

const Step = ({ done, label, desc }: { done: boolean; label: string; desc: string }) => (
  <View style={styles.step}>
    <Icon name={done ? 'check-circle' : 'circle-outline'} size={22} color={done ? C.green : C.faint} />
    <View style={{ flex: 1 }}>
      <Text style={[styles.stepLabel, !done && { color: C.sub }]}>{label}</Text>
      <Text style={styles.stepDesc}>{desc}</Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  content: { padding: 16, gap: 16, paddingBottom: 40, backgroundColor: C.bg },
  card: { backgroundColor: C.surface, borderRadius: R.lg, borderWidth: 4, overflow: 'hidden' },
  photo: { width: '100%', height: 280, backgroundColor: C.mint },
  unknown: { backgroundColor: C.night, alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: 16, gap: 5 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  no: { fontSize: 12, fontWeight: '800', color: C.sub },
  name: { fontSize: 28, fontWeight: '900', color: C.ink, letterSpacing: -0.8 },
  sci: { fontSize: 15, fontStyle: 'italic', color: C.sub },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  stats: { flexDirection: 'row', gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line },
  statLabel: { fontSize: 11, fontWeight: '800', color: C.sub },
  statValue: { fontSize: 14, fontWeight: '800', color: C.ink, marginTop: 2 },
  stage: { fontSize: 13, fontWeight: '900', marginTop: 8 },
  label: { fontSize: 11, fontWeight: '800', color: C.green, marginTop: 8 },
  body: { fontSize: 15, lineHeight: 22, color: C.ink },
  step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 6 },
  stepLabel: { fontSize: 14, fontWeight: '800', color: C.ink },
  stepDesc: { fontSize: 12, color: C.sub, lineHeight: 18 },
  obs: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  obsPhoto: { width: 56, height: 56, borderRadius: R.sm, backgroundColor: C.mint },
  obsDate: { fontSize: 14, fontWeight: '800', color: C.ink },
  obsMeta: { fontSize: 12, color: C.sub, marginTop: 2 },
  trash: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
