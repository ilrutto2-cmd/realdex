import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { RootNav, RootStackParamList } from '../navigation';
import { sendFeedback } from '../services/feedback';
import { cloudEnabled } from '../services/supabase';
import { Banner, Button, Chip, H, Icon, Panel } from '../ui/components';
import { C, R } from '../ui/theme';

const RATING_LABEL = ['', '별로예요', '아쉬워요', '보통이에요', '좋아요', '최고예요'];
const AGE_GROUPS = ['10대', '20대', '30대', '40대', '50대 이상'];

/** 의견 보내기와 판별 오류 신고를 함께 처리하는 화면. */
export const FeedbackScreen = () => {
  const { params } = useRoute<RouteProp<RootStackParamList, 'Feedback'>>();
  const navigation = useNavigation<RootNav>();
  const misid = params.kind === 'misid';
  const [rating, setRating] = useState<number | null>(null);
  const [ageGroup, setAgeGroup] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [answer, setAnswer] = useState('');
  const [withPhoto, setWithPhoto] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const canSend = cloudEnabled && !sending && (misid ? true : rating !== null || message.trim().length > 0);

  const send = async () => {
    setSending(true);
    setError(null);
    const r = await sendFeedback({
      kind: params.kind,
      rating: misid ? null : rating,
      message: misid ? [answer.trim() && `실제: ${answer.trim()}`, message.trim()].filter(Boolean).join('\n') : message,
      context: {
        ...(params.context ?? {}),
        aiSaid: params.aiSaid ?? null,
        actual: misid ? answer.trim() || null : undefined,
        ageGroup: misid ? undefined : (ageGroup ?? undefined),
      },
      photoUri: misid && withPhoto ? params.photoUri : null,
    });
    setSending(false);
    if (r.ok) setDone(true);
    else setError(r.message);
  };

  if (done) {
    return (
      <View style={styles.center} testID="feedback-done">
        <Icon name="heart" size={64} color={C.coral} />
        <Text style={styles.big}>보내 주셔서 고마워요!</Text>
        <Text style={styles.sub}>{misid ? '알려 주신 내용은 판별 정확도를 높이는 데 쓰입니다.' : '보내 주신 의견은 REALDEX를 고치는 데 꼭 반영할게요.'}</Text>
        <Button testID="feedback-back" label="돌아가기" icon="arrow-left" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID={misid ? 'misid-form' : 'feedback-form'}>
        {!cloudEnabled ? (
          <Banner icon="flask-outline" tone="warn" text="데모 모드에서는 서버가 연결되지 않아 보낼 수 없습니다." />
        ) : null}

        {misid ? (
          <>
            <Panel style={{ gap: 10 }}>
              <H>AI가 틀렸나요?</H>
              {params.photoUri ? <Image source={{ uri: params.photoUri }} style={styles.photo} resizeMode="cover" /> : null}
              {params.aiSaid ? (
                <Text style={styles.body}>
                  AI 판별: <Text style={styles.bold}>{params.aiSaid}</Text>
                </Text>
              ) : null}
              <Text style={styles.label}>실제로는 무엇이었나요? (모르면 비워 두세요)</Text>
              <TextInput
                testID="misid-answer"
                value={answer}
                onChangeText={setAnswer}
                placeholder="예: 물까치, 무당벌레가 아니라 잎벌레"
                placeholderTextColor={C.faint}
                style={styles.input}
                maxLength={100}
              />
              <Text style={styles.label}>더 알려 줄 내용 (선택)</Text>
              <TextInput
                testID="feedback-message"
                value={message}
                onChangeText={setMessage}
                placeholder="예: 날개 무늬가 달랐어요"
                placeholderTextColor={C.faint}
                style={[styles.input, styles.multiline]}
                multiline
                maxLength={1000}
              />
              {params.photoUri ? (
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.setting}>사진 함께 보내기</Text>
                    <Text style={styles.hint}>판별을 개선하는 데만 쓰고 공개하지 않습니다. 사람 얼굴이 찍혔다면 끄세요.</Text>
                  </View>
                  <Switch testID="misid-photo" value={withPhoto} onValueChange={setWithPhoto} trackColor={{ true: C.green, false: C.line }} />
                </View>
              ) : null}
            </Panel>
          </>
        ) : (
          <Panel style={{ gap: 12 }}>
            <H>REALDEX 어떠셨나요?</H>
            <View style={styles.stars} accessibilityRole="radiogroup">
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable
                  key={n}
                  testID={`rating-${n}`}
                  onPress={() => setRating(n)}
                  accessibilityRole="radio"
                  accessibilityLabel={`${n}점 ${RATING_LABEL[n]}`}
                  accessibilityState={{ selected: rating === n }}
                  style={styles.star}
                >
                  <Icon name={rating !== null && n <= rating ? 'star' : 'star-outline'} size={40} color={rating !== null && n <= rating ? C.amber : C.faint} />
                </Pressable>
              ))}
            </View>
            <Text style={styles.ratingLabel}>{rating ? RATING_LABEL[rating] : '별을 눌러 주세요'}</Text>
            <Text style={styles.label}>좋았던 점, 불편했던 점, 바라는 기능을 자유롭게 적어 주세요</Text>
            <TextInput
              testID="feedback-message"
              value={message}
              onChangeText={setMessage}
              placeholder="예: 새를 찍을 때 줌이 있으면 좋겠어요"
              placeholderTextColor={C.faint}
              style={[styles.input, styles.multiline]}
              multiline
              maxLength={2000}
            />
            <Text style={styles.label}>연령대 (선택)</Text>
            <View style={styles.ages}>
              {AGE_GROUPS.map((a) => (
                <Chip key={a} testID={`age-${a}`} label={a} active={ageGroup === a} onPress={() => setAgeGroup(ageGroup === a ? null : a)} />
              ))}
            </View>
            <Text style={styles.hint}>이름, 전화번호 같은 개인정보는 적지 말아 주세요. 연령대는 어떤 분들이 즐겨 쓰는지 알아보는 데만 씁니다.</Text>
          </Panel>
        )}

        {error ? <Banner testID="feedback-error" icon="alert-circle" tone="danger" text={error} /> : null}
        <Button testID="feedback-send" label={sending ? '보내는 중…' : '보내기'} icon="send" disabled={!canSend} onPress={() => void send()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14, backgroundColor: C.bg },
  big: { fontSize: 22, fontWeight: '900', color: C.ink },
  sub: { fontSize: 14, lineHeight: 21, color: C.sub, textAlign: 'center' },
  photo: { width: '100%', height: 200, borderRadius: R.md, backgroundColor: C.mint },
  body: { fontSize: 15, color: C.ink },
  bold: { fontWeight: '900' },
  label: { fontSize: 12, fontWeight: '800', color: C.green, marginTop: 4 },
  input: { backgroundColor: C.bg, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.ink },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  setting: { fontSize: 14, fontWeight: '800', color: C.ink },
  hint: { fontSize: 12, lineHeight: 17, color: C.sub },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  ages: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  star: { padding: 4 },
  ratingLabel: { textAlign: 'center', fontSize: 14, fontWeight: '800', color: C.sub },
});
