import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ACHIEVEMENTS } from '../domain/rules';
import type { RootNav } from '../navigation';
import { APP_VERSION } from '../services/feedback';
import { cloudEnabled } from '../services/supabase';
import { useStore } from '../state/store';
import { Banner, Button, confirm, H, Icon, Panel, ProgressBar } from '../ui/components';
import { C, R } from '../ui/theme';

export const MyScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<RootNav>();
  const { state, level, rate, syncStatus, syncError, updateSettings, syncNow, wipeAll } = useStore();
  const [message, setMessage] = useState<string | null>(null);
  const pending = state.observations.filter((o) => !state.syncedObservationIds[o.id]).length;

  const wipe = async () => {
    const ok = await confirm(
      '모든 데이터 삭제',
      '도감, 관찰 기록, 사진, 경험치, 업적을 모두 지웁니다. 되돌릴 수 없습니다.',
      '모두 삭제',
    );
    if (!ok) return;
    const r = await wipeAll();
    setMessage(
      r.remoteOk
        ? '모든 데이터를 삭제했습니다.'
        : '기기의 데이터는 삭제했지만 서버 데이터는 지우지 못했습니다. 인터넷 연결 후 다시 시도해 주세요.',
    );
  };

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 10 }]} style={{ backgroundColor: C.bg }}>
      <Text style={styles.title}>마이페이지</Text>

      <Panel style={{ gap: 12 }}>
        <View style={styles.row}>
          <View style={styles.avatar}>
            <Icon name="compass-outline" size={30} color={C.amber} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{level.title}</Text>
            <Text style={styles.sub}>탐험 레벨 {level.level}</Text>
          </View>
        </View>
        <ProgressBar ratio={level.xpIntoLevel / level.xpForNext} color={C.amber} />
        <View style={styles.stats}>
          <Stat testID="stat-species" label="발견한 종" value={`${rate.found}종`} />
          <Stat testID="stat-observations" label="누적 관찰" value={`${state.observations.length}건`} />
          <Stat testID="stat-xp" label="누적 경험치" value={`${level.totalXp}`} />
        </View>
      </Panel>

      <Panel style={{ gap: 12 }}>
        <H>
          업적 {Object.keys(state.achievements).length}/{ACHIEVEMENTS.length}
        </H>
        <View style={styles.badges}>
          {ACHIEVEMENTS.map((a) => {
            const got = !!state.achievements[a.id];
            return (
              <View key={a.id} style={[styles.badge, !got && { opacity: 0.4 }]} accessibilityLabel={`${a.title}${got ? ' 획득' : ' 미획득'}`}>
                <View style={[styles.badgeIcon, got && { backgroundColor: C.amberSoft, borderColor: C.amber }]}>
                  <Icon name={got ? a.icon : 'lock'} size={24} color={got ? '#7A5206' : C.faint} />
                </View>
                <Text style={styles.badgeTitle}>{a.title}</Text>
                <Text style={styles.badgeDesc}>{a.desc}</Text>
              </View>
            );
          })}
        </View>
      </Panel>

      <Panel style={{ gap: 10 }}>
        <H>의견과 신고</H>
        <Text style={styles.settingDesc}>
          불편한 점, 바라는 기능, 판별이 틀린 경우를 알려 주세요. 판별 오류는 도감 카드의 관찰 기록이나 촬영 결과 화면에서도 신고할 수 있어요.
        </Text>
        <Button
          testID="open-feedback"
          label="의견 보내기"
          icon="message-text-outline"
          disabled={!cloudEnabled}
          onPress={() => navigation.navigate('Feedback', { kind: 'general', context: { source: 'my' } })}
        />
        {!cloudEnabled ? <Text style={styles.settingDesc}>데모 모드에서는 보낼 수 없습니다.</Text> : null}
      </Panel>

      <Panel style={{ gap: 12 }}>
        <H>개인정보 및 데이터</H>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.setting}>발견 지역 기록</Text>
            <Text style={styles.settingDesc}>
              켜면 등록할 때 시·구 단위 지역과 약 1km로 줄인 좌표를 저장합니다. 정확한 위치는 저장하지 않으며 다른 사람에게 공개되지 않습니다.
            </Text>
          </View>
          <Switch
            testID="toggle-region"
            value={state.settings.recordRegion}
            onValueChange={(v) => void updateSettings({ recordRegion: v })}
            trackColor={{ true: C.green, false: C.line }}
            accessibilityLabel="발견 지역 기록"
          />
        </View>

        <View style={styles.divider} />
        <View style={styles.row}>
          <Icon name={cloudEnabled ? 'cloud-check' : 'cloud-off-outline'} size={22} color={cloudEnabled ? C.green : C.sub} />
          <View style={{ flex: 1 }}>
            <Text style={styles.setting} testID="cloud-status">
              {cloudEnabled ? '서버 연결됨 (익명 체험 계정)' : '데모 모드 (서버 미연결)'}
            </Text>
            <Text style={styles.settingDesc}>
              {cloudEnabled
                ? syncStatus === 'syncing'
                  ? '서버에 백업하는 중…'
                  : pending > 0
                    ? `아직 백업되지 않은 관찰 기록 ${pending}건`
                    : '모든 기록이 서버에 백업되었습니다.'
                : '기록은 이 기기에만 저장됩니다. 앱을 지우면 기록도 사라집니다.'}
            </Text>
          </View>
        </View>
        {syncError ? <Banner testID="sync-error" icon="alert-circle" tone="danger" text={syncError} /> : null}
        {cloudEnabled ? <Button testID="sync-now" label="지금 백업" icon="cloud-sync" kind="ghost" onPress={() => void syncNow()} /> : null}

        <View style={styles.divider} />
        <Text style={styles.settingDesc}>
          이 버전은 이름·이메일 등 개인정보를 받지 않습니다. 사진과 관찰 기록은 본인만 볼 수 있습니다. 관찰 기록의 사진은 도감 카드 화면에서 한 장씩 지울 수 있습니다.
        </Text>
        {message ? <Banner testID="my-message" icon="information-outline" text={message} /> : null}
        <Button testID="wipe" label="모든 데이터 삭제" icon="delete-outline" kind="danger" onPress={() => void wipe()} />
      </Panel>

      <View style={styles.footer}>
        <Text style={styles.version}>REALDEX v{APP_VERSION}</Text>
        {cloudEnabled ? (
          <Button testID="open-stats" label="관리자 통계" icon="chart-bar" kind="ghost" onPress={() => navigation.navigate('Stats')} style={styles.adminBtn} />
        ) : null}
      </View>
    </ScrollView>
  );
};

const Stat = ({ label, value, testID }: { label: string; value: string; testID?: string }) => (
  <View style={styles.stat}>
    <Text style={styles.statValue} testID={testID}>
      {value}
    </Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '900', color: C.forest, letterSpacing: -0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: C.forest, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 20, fontWeight: '900', color: C.ink },
  sub: { fontSize: 13, fontWeight: '700', color: C.sub },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: C.bg, borderRadius: R.md, paddingVertical: 12, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '900', color: C.forest },
  statLabel: { fontSize: 11, fontWeight: '700', color: C.sub, marginTop: 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  badge: { width: '25%', alignItems: 'center', gap: 3, paddingHorizontal: 2 },
  badgeIcon: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, borderColor: C.line, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  badgeTitle: { fontSize: 11, fontWeight: '800', color: C.ink, textAlign: 'center' },
  badgeDesc: { fontSize: 9, color: C.sub, textAlign: 'center' },
  setting: { fontSize: 15, fontWeight: '800', color: C.ink },
  settingDesc: { fontSize: 12, lineHeight: 18, color: C.sub, marginTop: 2 },
  divider: { height: 1, backgroundColor: C.line },
  footer: { alignItems: 'center', gap: 8, marginTop: 4 },
  version: { fontSize: 11, color: C.faint },
  adminBtn: { minHeight: 40, borderColor: C.line },
});
