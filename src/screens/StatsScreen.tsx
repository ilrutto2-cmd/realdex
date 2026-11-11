import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { fetchStats, loadStatsToken, saveStatsToken, type Stats } from '../services/stats';
import { Banner, Button, Chip, H, Icon, Panel, Tag } from '../ui/components';
import { C, R } from '../ui/theme';

const STATUS_LABEL: Record<string, string> = {
  ok: '후보 찾음',
  no_organism: '생물 없음',
  low_quality: '판별 어려움',
  'error:upstream': 'AI 서비스 오류',
  'error:upstream_overloaded': 'AI 과부하',
  'error:bad_model_output': 'AI 응답 오류',
  'error:bad_request': '잘못된 사진',
  'error:server': '서버 오류',
};

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '–');
const shortDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 막대 하나에 값 하나. 같은 차트에 다른 단위를 섞지 않는다(축 하나). */
const DailyBars = ({ title, rows, testID }: { title: string; rows: { date: string; value: number }[]; testID?: string }) => {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((s, r) => s + r.value, 0);
  const last = rows[rows.length - 1];
  return (
    <View style={{ gap: 8 }} testID={testID}>
      <View style={styles.rowBetween}>
        <Text style={styles.chartTitle}>{title}</Text>
        <Text style={styles.chartMeta}>
          14일 합계 {total} · 오늘 {last?.value ?? 0}
        </Text>
      </View>
      <View style={styles.bars} accessibilityLabel={`${title}: ${rows.map((r) => `${r.date.slice(5)} ${r.value}`).join(', ')}`}>
        {rows.map((r) => (
          <View key={r.date} style={styles.barSlot}>
            <View style={[styles.bar, { height: `${Math.max(r.value > 0 ? 4 : 0, (r.value / max) * 100)}%` }]} />
          </View>
        ))}
      </View>
      <View style={styles.rowBetween}>
        <Text style={styles.axis}>{rows[0]?.date.slice(5).replace('-', '/')}</Text>
        <Text style={styles.axis}>최고 {max}</Text>
        <Text style={styles.axis}>{last?.date.slice(5).replace('-', '/')}</Text>
      </View>
    </View>
  );
};

const Tile = ({ label, value, sub, testID }: { label: string; value: string; sub?: string; testID?: string }) => (
  <View style={styles.tile}>
    <Text style={styles.tileValue} testID={testID}>
      {value}
    </Text>
    <Text style={styles.tileLabel}>{label}</Text>
    {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
  </View>
);

export const StatsScreen = () => {
  const [token, setToken] = useState('');
  const [draft, setDraft] = useState('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [fbFilter, setFbFilter] = useState<'all' | 'general' | 'misid'>('all');

  const load = useCallback(async (t: string) => {
    if (!t) return;
    setLoading(true);
    setError(null);
    const r = await fetchStats(t);
    setLoading(false);
    if (r.kind === 'ok') {
      setStats(r.stats);
      await saveStatsToken(t);
      setToken(t);
    } else {
      setError(r.message);
      if (r.code === 'unauthorized') {
        setToken('');
        setStats(null);
      }
    }
  }, []);

  useEffect(() => {
    void loadStatsToken().then((t) => {
      if (t) {
        setToken(t);
        void load(t);
      }
    });
  }, [load]);

  const forget = async () => {
    await saveStatsToken('');
    setToken('');
    setDraft('');
    setStats(null);
  };

  if (!token || !stats) {
    return (
      <ScrollView contentContainerStyle={styles.content} style={{ backgroundColor: C.bg }} keyboardShouldPersistTaps="handled" testID="stats-login">
        <Panel style={{ gap: 10 }}>
          <H>관리자 통계</H>
          <Text style={styles.body}>
            테스터들의 사용 현황과 의견을 봅니다. Supabase의 Edge Functions → Secrets에 저장한 STATS_TOKEN 값을 입력하세요. 이 기기에만 저장됩니다.
          </Text>
          <TextInput
            testID="stats-token"
            value={draft}
            onChangeText={setDraft}
            placeholder="관리자 토큰"
            placeholderTextColor={C.faint}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          {error ? <Banner testID="stats-error" icon="alert-circle" tone="danger" text={error} /> : null}
          <Button testID="stats-open" label={loading ? '불러오는 중…' : '통계 보기'} icon="chart-bar" disabled={!draft || loading} onPress={() => void load(draft.trim())} />
        </Panel>
      </ScrollView>
    );
  }

  const t = stats.totals;
  const rt = stats.retention;
  const statusTotal = Object.values(stats.identifyStatus).reduce((s, n) => s + n, 0);
  const feedback = stats.recentFeedback.filter((f) => fbFilter === 'all' || f.kind === fbFilter);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={{ backgroundColor: C.bg }}
      testID="stats-view"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load(token)} />}
    >
      <View style={styles.rowBetween}>
        <Text style={styles.meta}>기준 {shortDate(stats.generatedAt)} · 한국 시간</Text>
        <Pressable testID="stats-refresh" onPress={() => void load(token)} accessibilityRole="button" accessibilityLabel="새로 고침" style={styles.iconBtn}>
          {loading ? <ActivityIndicator color={C.forest} /> : <Icon name="refresh" size={22} color={C.forest} />}
        </Pressable>
      </View>
      {error ? <Banner icon="alert-circle" tone="danger" text={error} /> : null}

      <View style={styles.tiles}>
        <Tile testID="stat-users" label="전체 사용자" value={`${t.users}`} sub={`7일 신규 ${t.newUsers7d}`} />
        <Tile testID="stat-active" label="7일 활동 사용자" value={`${t.activeUsers7d}`} />
        <Tile testID="stat-calls" label="판별 요청" value={`${t.identifyCalls}`} sub={`7일 ${t.identifyCalls7d}`} />
        <Tile testID="stat-obs" label="도감 등록" value={`${t.observations}`} sub={`7일 ${t.observations7d}`} />
        <Tile label="재방문(다음 날 이후)" value={pct(rt.d1Returned, rt.d1Cohort)} sub={`${rt.d1Returned}/${rt.d1Cohort}명`} />
        <Tile label="재방문(7일째 이후)" value={pct(rt.d7Returned, rt.d7Cohort)} sub={`${rt.d7Returned}/${rt.d7Cohort}명`} />
        <Tile testID="stat-rating" label="평균 별점" value={stats.avgRating ? stats.avgRating.toFixed(1) : '–'} sub={`${stats.ratingCount}명 응답`} />
        <Tile
          testID="stat-misid"
          label="판별 오류 신고"
          value={`${t.misidReports}`}
          sub={stats.misidRate !== null ? `AI 등록 대비 ${Math.round(stats.misidRate * 100)}%` : undefined}
        />
      </View>

      <Panel style={{ gap: 18 }}>
        <View style={styles.rowBetween}>
          <H>최근 14일</H>
          <Chip testID="stats-table-toggle" label={showTable ? '그래프로 보기' : '표로 보기'} onPress={() => setShowTable((v) => !v)} />
        </View>
        {showTable ? (
          <View testID="stats-table">
            <View style={[styles.tr, styles.th]}>
              {['날짜', '신규', '활동', '판별', '등록'].map((h) => (
                <Text key={h} style={[styles.td, styles.thText]}>
                  {h}
                </Text>
              ))}
            </View>
            {[...stats.daily].reverse().map((d) => (
              <View key={d.date} style={styles.tr}>
                <Text style={styles.td}>{d.date.slice(5).replace('-', '/')}</Text>
                <Text style={styles.td}>{d.newUsers}</Text>
                <Text style={styles.td}>{d.activeUsers}</Text>
                <Text style={styles.td}>{d.calls}</Text>
                <Text style={styles.td}>{d.observations}</Text>
              </View>
            ))}
          </View>
        ) : (
          <>
            <DailyBars testID="chart-active" title="활동 사용자" rows={stats.daily.map((d) => ({ date: d.date, value: d.activeUsers }))} />
            <DailyBars testID="chart-calls" title="판별 요청" rows={stats.daily.map((d) => ({ date: d.date, value: d.calls }))} />
            <DailyBars testID="chart-obs" title="도감 등록" rows={stats.daily.map((d) => ({ date: d.date, value: d.observations }))} />
          </>
        )}
      </Panel>

      <Panel style={{ gap: 10 }}>
        <H>판별 결과 (최근 90일)</H>
        {Object.entries(stats.identifyStatus)
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => (
            <View key={k} style={{ gap: 4 }}>
              <View style={styles.rowBetween}>
                <Text style={styles.body}>{STATUS_LABEL[k] ?? k}</Text>
                <Text style={styles.num}>
                  {n} · {pct(n, statusTotal)}
                </Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${(n / Math.max(1, statusTotal)) * 100}%` }]} />
              </View>
            </View>
          ))}
        {statusTotal === 0 ? <Text style={styles.empty}>아직 판별 기록이 없습니다.</Text> : null}
      </Panel>

      <Panel style={{ gap: 8 }}>
        <H>많이 등록된 생물</H>
        <Text style={styles.meta}>
          기본 도감 {t.coreSpeciesFound}종 · 확장 도감 {t.extSpeciesFound}종 발견
        </Text>
        {stats.topSpecies.map((s, i) => (
          <View key={s.id} style={styles.rowBetween}>
            <Text style={styles.body}>
              {i + 1}. {s.nameKo}
            </Text>
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              {s.kind === 'ext' ? <Tag label="확장" bg={C.amberSoft} color="#7A5206" /> : null}
              <Text style={styles.num}>{s.count}건</Text>
            </View>
          </View>
        ))}
        {stats.topSpecies.length === 0 ? <Text style={styles.empty}>아직 등록된 생물이 없습니다.</Text> : null}
      </Panel>

      <Panel style={{ gap: 10 }}>
        <H>의견 {t.feedback}건</H>
        <View style={styles.chips}>
          <Chip testID="fb-all" label="전체" active={fbFilter === 'all'} onPress={() => setFbFilter('all')} />
          <Chip testID="fb-general" label="의견" active={fbFilter === 'general'} onPress={() => setFbFilter('general')} />
          <Chip testID="fb-misid" label="판별 오류" active={fbFilter === 'misid'} onPress={() => setFbFilter('misid')} />
        </View>
        {feedback.length === 0 ? <Text style={styles.empty}>아직 받은 의견이 없습니다.</Text> : null}
        {feedback.map((f) => {
          const ctx = f.context as { aiSaid?: string; actual?: string; photoPath?: string; source?: string };
          return (
            <View key={f.id} style={styles.fb} testID="feedback-item">
              <View style={styles.rowBetween}>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <Tag label={f.kind === 'misid' ? '판별 오류' : '의견'} bg={f.kind === 'misid' ? C.coralSoft : C.mint} color={f.kind === 'misid' ? '#9B3A1E' : C.forest} />
                  {f.rating ? (
                    <Text style={styles.num} accessibilityLabel={`별점 ${f.rating}점`}>
                      {'★'.repeat(f.rating)}
                      <Text style={{ color: C.faint }}>{'★'.repeat(5 - f.rating)}</Text>
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.meta}>{shortDate(f.createdAt)}</Text>
              </View>
              {f.kind === 'misid' ? (
                <Text style={styles.body}>
                  AI: {ctx.aiSaid ?? '–'} → 실제: {ctx.actual ?? '모름'}
                </Text>
              ) : null}
              {f.message ? <Text style={styles.body}>{f.message}</Text> : null}
              <Text style={styles.meta}>
                {[f.appVersion && `v${f.appVersion}`, ctx.source === 'capture' ? '촬영 결과에서' : ctx.source === 'card' ? '도감 카드에서' : null, ctx.photoPath ? `사진: ${ctx.photoPath}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          );
        })}
      </Panel>

      <Button testID="stats-forget" label="이 기기에서 토큰 지우기" icon="logout" kind="ghost" onPress={() => void forget()} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  body: { fontSize: 14, lineHeight: 20, color: C.ink },
  meta: { fontSize: 11, color: C.sub },
  num: { fontSize: 13, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  empty: { fontSize: 13, color: C.sub },
  input: { backgroundColor: C.bg, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, height: 48, fontSize: 15, color: C.ink },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', flexGrow: 1, backgroundColor: C.surface, borderRadius: R.md, borderWidth: 1, borderColor: C.line, padding: 12 },
  tileValue: { fontSize: 24, fontWeight: '900', color: C.forest, fontVariant: ['tabular-nums'] },
  tileLabel: { fontSize: 12, fontWeight: '700', color: C.ink, marginTop: 2 },
  tileSub: { fontSize: 11, color: C.sub, marginTop: 2 },
  chartTitle: { fontSize: 14, fontWeight: '800', color: C.ink },
  chartMeta: { fontSize: 11, color: C.sub },
  bars: { height: 90, flexDirection: 'row', alignItems: 'flex-end', gap: 2, borderBottomWidth: 1, borderBottomColor: C.line },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { backgroundColor: C.green, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  axis: { fontSize: 10, color: C.sub },
  track: { height: 8, borderRadius: 4, backgroundColor: C.line, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: C.green },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  fb: { borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10, gap: 4 },
  tr: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.line },
  th: { borderBottomColor: C.sub },
  td: { flex: 1, fontSize: 13, color: C.ink, textAlign: 'center', fontVariant: ['tabular-nums'] },
  thText: { fontWeight: '800', color: C.sub },
});
