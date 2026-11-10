import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { buildQuiz } from '../domain/rules';
import { SPECIES_BY_ID } from '../domain/species';
import type { RootNav, RootStackParamList } from '../navigation';
import { useStore } from '../state/store';
import { Banner, Button, H, Icon, Panel } from '../ui/components';
import { C, R } from '../ui/theme';

export const QuizScreen = () => {
  const { params } = useRoute<RouteProp<RootStackParamList, 'Quiz'>>();
  const navigation = useNavigation<RootNav>();
  const { completeStudy } = useStore();
  const sp = SPECIES_BY_ID[params.id];
  const quiz = useMemo(() => buildQuiz(params.id), [params.id]);
  const [answers, setAnswers] = useState<(number | null)[]>(() => quiz.map(() => null));
  const [status, setStatus] = useState<'idle' | 'wrong' | 'done'>('idle');
  const [xp, setXp] = useState(0);

  const submit = async () => {
    const r = await completeStudy(params.id, answers.map((a) => a ?? -1));
    if (r.ok) {
      setXp(r.xpGained);
      setStatus('done');
    } else {
      setStatus('wrong');
    }
  };

  if (status === 'done') {
    return (
      <View style={styles.center} testID="quiz-done">
        <Icon name="trophy" size={72} color={C.amber} />
        <Text style={styles.big}>생태 탐구 완료!</Text>
        <Text style={styles.sub}>
          {sp.nameKo} 카드가 3단계로 성장했어요.{xp > 0 ? `\n+${xp} 경험치` : ''}
        </Text>
        <Button testID="quiz-back" label="카드 보러 가기" icon="book-open-variant" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} testID="quiz">
      <Panel style={{ gap: 4 }}>
        <H>{sp.nameKo} 탐구 노트</H>
        <Text style={styles.note}>먼저 읽어 보세요. 아래 문제의 답이 모두 여기에 있어요.</Text>
        <Text style={styles.label}>생김새</Text>
        <Text style={styles.body}>{sp.feature}</Text>
        <Text style={styles.label}>사는 곳</Text>
        <Text style={styles.body}>{sp.habitat}</Text>
        <Text style={styles.label}>자연에서 하는 일</Text>
        <Text style={styles.body}>{sp.role}</Text>
      </Panel>

      {quiz.map((q, qi) => (
        <Panel key={q.prompt} style={{ gap: 10 }}>
          <H>
            {qi + 1}. {q.prompt}
          </H>
          {q.choices.map((choice, ci) => {
            const active = answers[qi] === ci;
            return (
              <Pressable
                key={choice}
                testID={`quiz-${qi}-${ci}`}
                onPress={() => {
                  setStatus('idle');
                  setAnswers((prev) => prev.map((a, i) => (i === qi ? ci : a)));
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={[styles.choice, active && styles.choiceActive]}
              >
                <Icon name={active ? 'check-circle' : 'circle-outline'} size={20} color={active ? C.green : C.faint} />
                <Text style={styles.choiceText}>{choice}</Text>
              </Pressable>
            );
          })}
        </Panel>
      ))}

      {status === 'wrong' ? (
        <Banner testID="quiz-wrong" icon="alert-circle" tone="danger" text="틀린 답이 있어요. 탐구 노트를 다시 읽고 도전해 보세요." />
      ) : null}
      <Button testID="quiz-submit" label="답 제출하기" icon="check-circle" disabled={answers.some((a) => a === null)} onPress={() => void submit()} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 40, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14, backgroundColor: C.bg },
  big: { fontSize: 24, fontWeight: '900', color: C.ink },
  sub: { fontSize: 15, lineHeight: 23, color: C.sub, textAlign: 'center' },
  note: { fontSize: 12, color: C.sub },
  label: { fontSize: 11, fontWeight: '800', color: C.green, marginTop: 8 },
  body: { fontSize: 15, lineHeight: 22, color: C.ink },
  choice: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: R.md, borderWidth: 2, borderColor: C.line, backgroundColor: C.bg },
  choiceActive: { borderColor: C.green, backgroundColor: '#F1F8EC' },
  choiceText: { flex: 1, fontSize: 14, lineHeight: 20, color: C.ink },
});
