import { useIsFocused, useNavigation } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { nextMission } from '../domain/rules';
import type { Species } from '../domain/types';
import { GROUP_LABEL, SPECIES, SPECIES_BY_ID } from '../domain/species';
import type { RootNav } from '../navigation';
import { extToSpecies, identifyPhoto, type Candidate, type IdentifyResult } from '../services/identify';
import { getRegion } from '../services/location';
import { persistPhoto, preparePhoto, type PreparedPhoto } from '../services/photos';
import { cloudEnabled } from '../services/supabase';
import { useStore } from '../state/store';
import { Banner, Button, Icon, Tag } from '../ui/components';
import { RevealModal, type RevealData } from '../ui/RevealModal';
import { C, R } from '../ui/theme';

type Phase =
  | { k: 'camera' }
  | { k: 'analyzing'; uri: string }
  | { k: 'result'; photo: PreparedPhoto; result: IdentifyResult }
  | { k: 'manual'; photo: PreparedPhoto }
  | { k: 'error'; photo: PreparedPhoto | null; uri: string | null; message: string; retryable: boolean };

const RANK_LABEL = { species: '종', genus: '속 단계', family: '과 단계' } as const;
const ASSESS_LABEL = { likely: '유력한 후보', possible: '추정', needs_check: '추가 확인 필요' } as const;

export const CaptureScreen = () => {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const navigation = useNavigation<RootNav>();
  const store = useStore();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ k: 'camera' });
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reveal, setReveal] = useState<RevealData | null>(null);
  const [query, setQuery] = useState('');

  // 카메라 화면을 벗어나면 미리보기가 내려가므로, 돌아왔을 때 다시 준비될 때까지 셔터를 막는다.
  useEffect(() => {
    if (!focused) setCameraReady(false);
  }, [focused]);

  const reset = useCallback(() => {
    setCameraReady(false);
    setPhase({ k: 'camera' });
    setSelected(null);
    setNotice(null);
    setQuery('');
  }, []);

  /** 후보가 등록 가능하면 그 종 id(기본 도감 id 또는 확장 종 id), 아니면 null. */
  const candidateSpeciesId = (c: Candidate): string | null => c.catalogId ?? extToSpecies(c.ext)?.id ?? null;

  /** 선택한 id의 종 정보: 기본 도감 → 이번 판별의 확장 종 → 전에 받아 둔 확장 종 순서로 찾는다. */
  const resolveSelected = (result: IdentifyResult, id: string): Species | null =>
    SPECIES_BY_ID[id] ??
    extToSpecies(result.candidates.find((c) => c.ext?.id === id)?.ext) ??
    store.state.extSpecies[id] ??
    null;

  /** 사진 한 장을 받아 판별까지 진행한다. */
  const analyze = useCallback(
    async (uri: string, prepared?: PreparedPhoto) => {
      setSelected(null);
      setNotice(null);
      setPhase({ k: 'analyzing', uri });
      let photo: PreparedPhoto;
      try {
        photo = prepared ?? (await preparePhoto(uri));
      } catch {
        setPhase({ k: 'error', photo: null, uri, message: '사진을 불러오지 못했습니다. 다른 사진으로 시도해 주세요.', retryable: false });
        return;
      }
      if (store.state.observations.some((o) => o.photoHash === photo.hash)) {
        setPhase({ k: 'error', photo, uri, message: '이미 도감에 등록한 사진입니다. 새로 촬영한 사진을 사용해 주세요.', retryable: false });
        return;
      }
      if (!cloudEnabled) {
        // AI 판별 서비스가 없으면 분석한 척하지 않고 직접 고르는 데모 화면으로 간다.
        setPhase({ k: 'manual', photo });
        return;
      }
      const outcome = await identifyPhoto(photo.base64);
      if (outcome.kind === 'ok') {
        const first = outcome.result.candidates.map(candidateSpeciesId).find(Boolean);
        setSelected(first ?? null);
        setPhase({ k: 'result', photo, result: outcome.result });
      } else {
        setPhase({ k: 'error', photo, uri, message: outcome.message, retryable: outcome.code !== 'rate_limit' && outcome.code !== 'not_configured' });
      }
    },
    [store.state.observations],
  );

  const shoot = useCallback(async () => {
    if (!camera.current || !cameraReady) return;
    try {
      const pic = await camera.current.takePictureAsync({ quality: 0.8 });
      if (pic?.uri) await analyze(pic.uri);
    } catch {
      setPhase({ k: 'error', photo: null, uri: null, message: '촬영에 실패했습니다. 다시 시도해 주세요.', retryable: false });
    }
  }, [analyze, cameraReady]);

  const pick = useCallback(async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!res.canceled && res.assets[0]?.uri) await analyze(res.assets[0].uri);
    } catch {
      setPhase({ k: 'error', photo: null, uri: null, message: '사진첩을 열지 못했습니다. 사진 접근 권한을 확인해 주세요.', retryable: false });
    }
  }, [analyze]);

  const registerSelected = useCallback(
    async (photo: PreparedPhoto, sp: Species, source: 'ai' | 'manual_demo', protectedMaybe: boolean) => {
      const speciesId = sp.id;
      if (saving) return;
      setSaving(true);
      try {
        // 보호종 가능성이 있으면 위치를 아예 기록하지 않는다.
        const region = store.state.settings.recordRegion && !protectedMaybe && !sp.isProtected ? await getRegion() : null;
        const id = Crypto.randomUUID();
        const photoUri = await persistPhoto(photo, id);
        const result = await store.register({
          id,
          speciesId,
          photoUri,
          photoHash: photo.hash,
          region: region?.region ?? null,
          lat: region?.lat ?? null,
          lng: region?.lng ?? null,
          source,
          ext: sp.kind === 'ext' ? sp : undefined,
        });
        if (!result.ok) {
          setNotice(result.reason === 'duplicate_photo' ? '이미 등록한 사진입니다.' : '도감에 없는 종이라 등록할 수 없습니다.');
          return;
        }
        setReveal({
          species: sp,
          photoUri,
          result,
          levelTitle: '',
          nextMission: null,
        });
      } catch {
        setNotice('저장하지 못했습니다. 저장 공간을 확인하고 다시 시도해 주세요.');
      } finally {
        setSaving(false);
      }
    },
    [saving, store],
  );

  // 등록 후 최신 상태로 레벨 칭호와 다음 미션을 채운다.
  const revealData = useMemo<RevealData | null>(
    () => (reveal ? { ...reveal, levelTitle: store.level.title, nextMission: nextMission(store.state, new Date()) } : null),
    [reveal, store.level.title, store.state],
  );

  const closeReveal = useCallback(() => {
    setReveal(null);
    reset();
  }, [reset]);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
      <Text style={styles.title}>탐사 카메라</Text>
      {cloudEnabled ? (
        <Tag label="AI 판별 연결됨" />
      ) : (
        <Tag label="데모 모드 · AI 미연결" bg={C.amberSoft} color="#7A5206" />
      )}
    </View>
  );

  // ---------- 카메라 ----------
  const renderCamera = () => {
    if (!permission) {
      return (
        <View style={styles.centerBox}>
          <ActivityIndicator color={C.forest} />
        </View>
      );
    }
    if (!permission.granted || cameraError) {
      const blocked = !permission.granted && !permission.canAskAgain;
      return (
        <View style={styles.centerBox} testID="camera-permission">
          <Icon name="camera-off" size={54} color={C.moss} />
          <Text style={styles.bigText}>
            {cameraError ? '카메라를 사용할 수 없어요' : blocked ? '카메라 권한이 꺼져 있어요' : '카메라 권한이 필요해요'}
          </Text>
          <Text style={styles.subText}>
            {cameraError
              ? '이 기기에서 카메라를 열지 못했습니다. 사진첩의 사진으로 판별할 수 있어요.'
              : blocked
                ? '기기 설정에서 REALDEX의 카메라 권한을 켜면 바로 촬영할 수 있어요. 권한 없이도 사진첩의 사진으로 판별할 수 있습니다.'
                : '생물을 촬영해 판별하는 데만 카메라를 사용합니다.'}
          </Text>
          {cameraError ? null : blocked ? (
            Platform.OS !== 'web' ? (
              <Button testID="open-settings" label="설정 열기" icon="cog-outline" onPress={() => void Linking.openSettings()} />
            ) : null
          ) : (
            <Button testID="grant-camera" label="카메라 권한 허용" icon="camera" onPress={() => void requestPermission()} />
          )}
          <Button testID="pick-photo" label="사진첩에서 고르기" icon="image-multiple" kind="ghost" onPress={() => void pick()} />
        </View>
      );
    }
    return (
      <View style={styles.cameraWrap}>
        {focused ? (
          <CameraView
            ref={camera}
            style={StyleSheet.absoluteFill}
            facing="back"
            onCameraReady={() => setCameraReady(true)}
            onMountError={(e) => setCameraError(e.message)}
          />
        ) : null}
        <View pointerEvents="none" style={styles.frame}>
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />
        </View>
        <Text style={styles.hint}>생물이 틀 안에 크게 들어오도록 맞춰 주세요{'\n'}다가가거나 만지지 말고, 멀리서 확대해 찍어요</Text>
        <View style={styles.controls}>
          <Pressable testID="pick-photo" onPress={() => void pick()} style={styles.sideButton} accessibilityRole="button" accessibilityLabel="사진첩에서 고르기">
            <Icon name="image-multiple" size={26} color={C.white} />
          </Pressable>
          <Pressable
            testID="shutter"
            onPress={() => void shoot()}
            disabled={!cameraReady}
            accessibilityRole="button"
            accessibilityLabel="촬영"
            style={({ pressed }) => [styles.shutter, { opacity: !cameraReady ? 0.4 : pressed ? 0.7 : 1 }]}
          >
            <View style={styles.shutterInner} />
          </Pressable>
          <View style={styles.sideButton} />
        </View>
      </View>
    );
  };

  // ---------- 판별 결과 ----------
  const renderCandidate = (c: Candidate, index: number) => {
    const cid = candidateSpeciesId(c);
    const registerable = !!cid;
    const active = registerable && selected === cid;
    return (
      <Pressable
        key={`${c.scientificName}-${index}`}
        testID={`candidate-${index}`}
        disabled={!registerable}
        onPress={() => setSelected(cid)}
        accessibilityRole="radio"
        accessibilityState={{ selected: active, disabled: !registerable }}
        style={[styles.candidate, active && styles.candidateActive, !registerable && { opacity: 0.75 }]}
      >
        <View style={styles.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={styles.candName}>{c.nameKo}</Text>
            <Text style={styles.candSci}>{c.scientificName}</Text>
          </View>
          <Icon name={active ? 'check-circle' : registerable ? 'circle-outline' : 'lock'} size={24} color={active ? C.green : C.faint} />
        </View>
        <View style={styles.tagRow}>
          <Tag label={ASSESS_LABEL[c.assessment]} bg={c.assessment === 'likely' ? C.mint : C.amberSoft} color={c.assessment === 'likely' ? C.forest : '#7A5206'} />
          <Tag label={RANK_LABEL[c.rank]} bg={C.line} color={C.sub} />
          {c.ext ? <Tag label="확장 도감" bg={C.amberSoft} color="#7A5206" /> : null}
          {!registerable ? <Tag label={c.rank !== 'species' ? '종 확정 불가' : c.assessment !== 'likely' ? '확실하지 않아 등록 불가' : '도감 미수록'} bg={C.line} color={C.sub} /> : null}
        </View>
        {c.reasoning ? <Text style={styles.reason}>{c.reasoning}</Text> : null}
      </Pressable>
    );
  };

  const renderResult = (photo: PreparedPhoto, result: IdentifyResult) => {
    const sp = selected ? resolveSelected(result, selected) : null;
    const none = result.status !== 'ok';
    return (
      <ScrollView contentContainerStyle={styles.sheet} testID="result-view">
        <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="cover" />
        {none ? (
          <View style={styles.block}>
            <Text style={styles.bigText}>{result.status === 'no_organism' ? '생물을 찾지 못했어요' : '판별하기 어려운 사진이에요'}</Text>
            <Text style={styles.subText}>
              {result.retakeAdvice ??
                (result.quality === 'not_live_subject'
                  ? '화면이나 그림이 아닌, 실제 생물을 직접 촬영해 주세요.'
                  : '생물이 크고 선명하게 보이도록 다시 촬영해 주세요.')}
            </Text>
          </View>
        ) : (
          <View style={styles.block}>
            <Text style={styles.sectionTitle}>AI 판별 후보</Text>
            <Text style={styles.disclaimer}>
              AI가 사진의 생김새를 보고 추정한 결과입니다. 검증된 확률이 아니므로 설명을 읽고 직접 확인해 주세요.
            </Text>
            {result.caution ? <Banner icon="alert-circle" tone="danger" text={result.caution} /> : null}
            {result.possiblyProtected ? (
              <Banner
                icon="shield-alert"
                tone="warn"
                text="보호종일 수 있습니다. 가까이 가지 말고 서식 위치를 다른 사람에게 알리지 마세요. 이 기록에는 위치를 저장하지 않습니다."
              />
            ) : null}
            {result.candidates.map(renderCandidate)}
            {result.retakeAdvice ? <Banner icon="camera" text={result.retakeAdvice} /> : null}
            {sp ? (
              <View style={styles.speciesInfo}>
                {sp.kind === 'ext' ? (
                  <Text style={styles.extNote}>기본 도감 밖의 생물이에요. 아래 설명은 AI가 작성했고 사람이 검수하지 않았습니다.</Text>
                ) : null}
                <Text style={styles.infoLabel}>이렇게 생겼는지 확인해 보세요</Text>
                <Text style={styles.infoText}>{sp.feature}</Text>
                <Text style={styles.infoLabel}>비슷한 종과 구별</Text>
                <Text style={styles.infoText}>{sp.similar}</Text>
                <Text style={styles.infoLabel}>주요 서식 환경</Text>
                <Text style={styles.infoText}>{sp.habitat}</Text>
              </View>
            ) : (
              <Banner icon="information-outline" tone="warn" text="도감에 등록할 수 있는 후보가 없습니다. 다른 각도에서 다시 촬영해 보세요." />
            )}
          </View>
        )}
        {notice ? <Banner testID="notice" icon="alert-circle" tone="danger" text={notice} /> : null}
        <Pressable
          testID="report-capture"
          onPress={() =>
            navigation.navigate('Feedback', {
              kind: 'misid',
              aiSaid: none
                ? result.status === 'no_organism'
                  ? '생물을 찾지 못함'
                  : '판별하기 어려움'
                : result.candidates.map((c) => c.nameKo).join(', '),
              photoUri: photo.uri,
              context: {
                source: 'capture',
                status: result.status,
                quality: result.quality,
                model: result.model,
                candidates: result.candidates.map((c) => ({
                  nameKo: c.nameKo,
                  scientificName: c.scientificName,
                  rank: c.rank,
                  assessment: c.assessment,
                  catalogId: c.catalogId,
                  extId: c.ext?.id ?? null,
                })),
              },
            })
          }
          accessibilityRole="button"
          style={styles.reportLink}
        >
          <Icon name="comment-question-outline" size={18} color={C.coral} />
          <Text style={styles.reportText}>{none ? '판별 결과가 이상해요' : '후보 중에 맞는 게 없어요'}</Text>
        </Pressable>
        <View style={styles.actions}>
          {sp && !none ? (
            <Button
              testID="register"
              label={saving ? '등록 중…' : `${sp.nameKo}로 ${sp.kind === 'ext' ? '확장 도감에' : '도감에'} 등록`}
              icon="book-open-variant"
              disabled={saving}
              onPress={() => void registerSelected(photo, sp, 'ai', result.possiblyProtected)}
            />
          ) : null}
          <Button testID="retake" label="다시 촬영" icon="camera" kind="ghost" onPress={reset} />
        </View>
      </ScrollView>
    );
  };

  // ---------- 데모 모드: 직접 선택 ----------
  const renderManual = (photo: PreparedPhoto) => {
    const q = query.trim();
    const list = q ? SPECIES.filter((s) => s.nameKo.includes(q) || s.scientificName.toLowerCase().includes(q.toLowerCase())) : SPECIES;
    const sp = selected ? SPECIES_BY_ID[selected] : null;
    return (
      <View style={{ flex: 1 }} testID="manual-view">
        <FlatList
          data={list}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.sheet}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ gap: 12 }}>
              <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="cover" />
              <Banner
                testID="demo-banner"
                icon="flask-outline"
                tone="warn"
                text="데모 모드입니다. AI 판별 서비스가 연결되지 않아 사진을 분석하지 않았습니다. 아래에서 직접 고른 종으로 등록되며, 카드에 '직접 선택'으로 표시됩니다."
              />
              <View style={styles.search}>
                <Icon name="magnify" size={20} color={C.sub} />
                <TextInput
                  testID="manual-search"
                  value={query}
                  onChangeText={setQuery}
                  placeholder="생물 이름 검색"
                  placeholderTextColor={C.faint}
                  style={styles.searchInput}
                />
              </View>
            </View>
          }
          renderItem={({ item }) => {
            const active = selected === item.id;
            return (
              <Pressable
                testID={`manual-${item.id}`}
                onPress={() => setSelected(item.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={[styles.manualRow, active && styles.candidateActive]}
              >
                <Icon name={item.icon} size={22} color={C.green} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.candName}>{item.nameKo}</Text>
                  <Text style={styles.candSci}>
                    {item.scientificName} · {GROUP_LABEL[item.group]}
                  </Text>
                </View>
                <Icon name={active ? 'check-circle' : 'circle-outline'} size={22} color={active ? C.green : C.faint} />
              </Pressable>
            );
          }}
          ListEmptyComponent={<Text style={styles.subText}>찾는 생물이 도감에 없습니다.</Text>}
        />
        <View style={[styles.footer, { paddingBottom: 12 }]}>
          {notice ? <Banner testID="notice" icon="alert-circle" tone="danger" text={notice} /> : null}
          <Button
            testID="register"
            label={saving ? '등록 중…' : sp ? `${sp.nameKo}로 등록 (직접 선택)` : '생물을 선택해 주세요'}
            icon="book-open-variant"
            disabled={!sp || saving}
            onPress={() => sp && void registerSelected(photo, sp, 'manual_demo', false)}
          />
          <Button testID="retake" label="다시 촬영" icon="camera" kind="ghost" onPress={reset} />
        </View>
      </View>
    );
  };

  let body: React.ReactNode;
  if (phase.k === 'camera') body = renderCamera();
  else if (phase.k === 'analyzing') {
    body = (
      <View style={styles.centerBox} testID="analyzing">
        <Image source={{ uri: phase.uri }} style={styles.analyzingPhoto} resizeMode="cover" />
        <ActivityIndicator size="large" color={C.forest} />
        <Text style={styles.bigText}>{cloudEnabled ? 'AI가 사진을 살펴보는 중…' : '사진을 준비하는 중…'}</Text>
      </View>
    );
  } else if (phase.k === 'result') body = renderResult(phase.photo, phase.result);
  else if (phase.k === 'manual') body = renderManual(phase.photo);
  else {
    const { photo, uri, retryable } = phase;
    body = (
      <View style={styles.centerBox} testID="error-view">
        <Icon name={retryable ? 'wifi-off' : 'alert-circle'} size={54} color={C.coral} />
        <Text style={styles.bigText}>{retryable ? '판별하지 못했어요' : '진행할 수 없어요'}</Text>
        <Text testID="error-message" style={styles.subText}>
          {phase.message}
        </Text>
        {retryable && photo && uri ? (
          <Button testID="retry" label="같은 사진으로 다시 시도" icon="refresh" onPress={() => void analyze(uri, photo)} />
        ) : null}
        <Button testID="retake" label="다시 촬영" icon="camera" kind="ghost" onPress={reset} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {header}
      <View style={{ flex: 1 }}>{body}</View>
      <RevealModal
        data={revealData}
        onClose={closeReveal}
        onOpenCard={() => {
          const id = reveal?.species.id;
          closeReveal();
          if (id) navigation.navigate('Species', { id });
        }}
      />
    </View>
  );
};

const CORNER = 34;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 18, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: '900', color: C.forest, letterSpacing: -0.5 },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  bigText: { fontSize: 19, fontWeight: '900', color: C.ink, textAlign: 'center', letterSpacing: -0.3 },
  subText: { fontSize: 14, lineHeight: 21, color: C.sub, textAlign: 'center' },
  cameraWrap: { flex: 1, margin: 12, borderRadius: R.lg, overflow: 'hidden', backgroundColor: C.night },
  frame: { position: 'absolute', top: '14%', bottom: '30%', left: '10%', right: '10%' },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: C.white },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 14 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 14 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 14 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 14 },
  hint: {
    position: 'absolute',
    bottom: 122,
    left: 16,
    right: 16,
    textAlign: 'center',
    color: C.white,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowRadius: 6,
  },
  controls: {
    position: 'absolute',
    bottom: 22,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  sideButton: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  shutter: { width: 82, height: 82, borderRadius: 41, borderWidth: 5, borderColor: C.white, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: C.white },
  sheet: { padding: 16, gap: 14, paddingBottom: 28 },
  preview: { width: '100%', height: 220, borderRadius: R.lg, backgroundColor: C.mint },
  analyzingPhoto: { width: 200, height: 200, borderRadius: R.lg, backgroundColor: C.mint },
  block: { gap: 10 },
  sectionTitle: { fontSize: 18, fontWeight: '900', color: C.ink },
  disclaimer: { fontSize: 12, lineHeight: 18, color: C.sub },
  candidate: { backgroundColor: C.surface, borderRadius: R.md, borderWidth: 2, borderColor: C.line, padding: 14, gap: 8 },
  candidateActive: { borderColor: C.green, backgroundColor: '#F1F8EC' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  candName: { fontSize: 17, fontWeight: '900', color: C.ink },
  candSci: { fontSize: 13, fontStyle: 'italic', color: C.sub },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reason: { fontSize: 13, lineHeight: 19, color: C.ink },
  speciesInfo: { backgroundColor: C.surface, borderRadius: R.md, borderWidth: 1, borderColor: C.line, padding: 14, gap: 4 },
  infoLabel: { fontSize: 11, fontWeight: '800', color: C.green, marginTop: 6 },
  infoText: { fontSize: 14, lineHeight: 20, color: C.ink },
  extNote: { fontSize: 12, lineHeight: 18, color: '#7A5206', backgroundColor: C.amberSoft, padding: 8, borderRadius: R.sm },
  actions: { gap: 10 },
  reportLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44 },
  reportText: { fontSize: 13, fontWeight: '800', color: C.coral, textDecorationLine: 'underline' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, height: 46, fontSize: 15, color: C.ink },
  manualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 2,
    borderColor: C.line,
    padding: 12,
  },
  footer: { paddingHorizontal: 16, paddingTop: 10, gap: 8, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.line },
});
