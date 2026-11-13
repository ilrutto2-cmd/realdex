import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { RootNav } from '../navigation';
import { startLinkEmail, startLogin, verifyLinkEmail, verifyLogin } from '../services/account';
import { cloudEnabled } from '../services/supabase';
import { useStore } from '../state/store';
import { Banner, Button, Chip, confirm, H, Icon, Panel } from '../ui/components';
import { C, R } from '../ui/theme';

type Mode = 'link' | 'login';
type Step = 'email' | 'code' | 'restoring' | 'done';

/** 기록 지키기(익명 계정에 이메일 연결)와 다른 기기 기록 불러오기(로그인). */
export const AccountScreen = () => {
  const navigation = useNavigation<RootNav>();
  const { account, state, refreshAccount, restoreAccount, logout } = useStore();
  const [mode, setMode] = useState<Mode>('link');
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [doneText, setDoneText] = useState('');

  const switchMode = (m: Mode) => {
    setMode(m);
    setStep('email');
    setCode('');
    setError(null);
    setInfo(null);
  };

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    const e = email.trim().toLowerCase();
    const r = mode === 'link' ? await startLinkEmail(e) : await startLogin(e);
    setBusy(false);
    if (r.ok) {
      setEmail(e);
      setStep('code');
      setInfo(`${e} 으로 6자리 코드를 보냈습니다. 메일이 안 보이면 스팸함도 확인해 주세요.`);
    } else if (r.code === 'exists' && mode === 'link') {
      // 이미 가입된 이메일이면 로그인으로 바꿔서 같은 주소로 코드를 보낸다.
      setMode('login');
      setInfo(r.message);
      setBusy(true);
      const r2 = await startLogin(e);
      setBusy(false);
      if (r2.ok) {
        setEmail(e);
        setStep('code');
      } else setError(r2.message);
    } else {
      setError(r.message);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    const r = mode === 'link' ? await verifyLinkEmail(email, code) : await verifyLogin(email, code);
    if (!r.ok) {
      setBusy(false);
      setError(r.message);
      return;
    }
    if (mode === 'link') {
      await refreshAccount();
      setBusy(false);
      setDoneText('이메일을 연결했습니다. 이제 다른 휴대폰이나 브라우저에서도 같은 이메일로 기록을 불러올 수 있어요.');
      setStep('done');
      return;
    }
    setStep('restoring');
    const res = await restoreAccount((done, total) => setProgress({ done, total }));
    setBusy(false);
    if (res.ok) {
      setDoneText(`로그인했습니다. 계정의 관찰 기록 ${res.total}건을 불러와 이 기기의 기록과 합쳤어요.`);
      setStep('done');
    } else {
      setError(`로그인은 됐지만 기록을 불러오지 못했습니다: ${res.message}`);
      setStep('code');
    }
  };

  const doLogout = async () => {
    const ok = await confirm(
      '로그아웃',
      '이 기기에서 로그아웃하고 기기에 있는 기록과 사진을 지웁니다. 서버에 백업된 기록은 같은 이메일로 다시 불러올 수 있습니다.',
      '로그아웃',
    );
    if (!ok) return;
    setBusy(true);
    const r = await logout();
    setBusy(false);
    if (r.ok) navigation.goBack();
    else setError(r.message);
  };

  if (!cloudEnabled) {
    return (
      <View style={styles.center}>
        <Banner icon="flask-outline" tone="warn" text="데모 모드에서는 계정 기능을 쓸 수 없습니다." />
      </View>
    );
  }

  // 이미 이메일이 연결된 계정
  if (!account.isAnonymous && step !== 'done') {
    const pending = state.observations.filter((o) => !state.syncedObservationIds[o.id]).length;
    return (
      <ScrollView contentContainerStyle={styles.content} style={{ backgroundColor: C.bg }} testID="account-linked">
        <Panel style={{ gap: 10 }}>
          <View style={styles.row}>
            <Icon name="shield-check" size={28} color={C.green} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>기록이 계정에 저장되고 있어요</Text>
              <Text style={styles.email} testID="account-email">
                {account.email}
              </Text>
            </View>
          </View>
          <Text style={styles.body}>
            {pending > 0 ? `아직 백업되지 않은 관찰 기록 ${pending}건이 있어요. 인터넷에 연결되면 자동으로 올라갑니다.` : '모든 관찰 기록이 백업되었습니다.'}
          </Text>
          <Text style={styles.hint}>다른 휴대폰이나 브라우저에서는 "다른 기기 기록 불러오기"에 같은 이메일을 넣으면 됩니다.</Text>
        </Panel>
        {error ? <Banner testID="account-error" icon="alert-circle" tone="danger" text={error} /> : null}
        <Button testID="logout" label={busy ? '처리 중…' : '이 기기에서 로그아웃'} icon="logout" kind="ghost" disabled={busy} onPress={() => void doLogout()} />
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="account-form">
        {step === 'done' ? (
          <Panel style={{ gap: 12, alignItems: 'center' }}>
            <Icon name="check-circle" size={56} color={C.green} />
            <Text style={styles.title} testID="account-done">
              완료!
            </Text>
            <Text style={[styles.body, { textAlign: 'center' }]}>{doneText}</Text>
            <Button testID="account-back" label="돌아가기" icon="arrow-left" onPress={() => navigation.goBack()} style={{ alignSelf: 'stretch' }} />
          </Panel>
        ) : step === 'restoring' ? (
          <Panel style={{ gap: 12, alignItems: 'center' }} >
            <ActivityIndicator size="large" color={C.forest} />
            <Text style={styles.title}>기록을 불러오는 중…</Text>
            {progress && progress.total > 0 ? (
              <Text style={styles.body} testID="restore-progress">
                사진 {progress.done} / {progress.total}
              </Text>
            ) : null}
          </Panel>
        ) : (
          <>
            <View style={styles.tabs}>
              <Chip testID="mode-link" label="기록 지키기" active={mode === 'link'} onPress={() => switchMode('link')} />
              <Chip testID="mode-login" label="다른 기기 기록 불러오기" active={mode === 'login'} onPress={() => switchMode('login')} />
            </View>
            <Panel style={{ gap: 10 }}>
              <H>{mode === 'link' ? '이메일로 기록 지키기' : '이메일로 로그인'}</H>
              <Text style={styles.body}>
                {mode === 'link'
                  ? '지금은 이 기기에만 묶인 체험 계정이에요. 브라우저 기록을 지우거나 휴대폰을 바꾸면 도감을 잃을 수 있습니다. 이메일을 연결하면 지금 기록 그대로 계정에 저장됩니다.'
                  : '이미 이메일을 연결한 계정의 기록을 이 기기로 불러옵니다. 이 기기에 있던 기록도 함께 합쳐집니다.'}
              </Text>
              {step === 'email' ? (
                <>
                  <TextInput
                    testID="account-email-input"
                    value={email}
                    onChangeText={setEmail}
                    placeholder="이메일 주소"
                    placeholderTextColor={C.faint}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    style={styles.input}
                  />
                  <Button testID="send-code" label={busy ? '보내는 중…' : '인증 코드 받기'} icon="email-outline" disabled={busy || email.trim().length < 5} onPress={() => void sendCode()} />
                  <Text style={styles.hint}>비밀번호는 없습니다. 메일로 온 6자리 숫자만 입력하면 됩니다.</Text>
                </>
              ) : (
                <>
                  {info ? <Banner testID="account-info" icon="email-outline" text={info} /> : null}
                  <TextInput
                    testID="account-code-input"
                    value={code}
                    onChangeText={(t) => {
                      setError(null);
                      setCode(t.replace(/\D/g, '').slice(0, 6));
                    }}
                    placeholder="6자리 코드"
                    placeholderTextColor={C.faint}
                    keyboardType="number-pad"
                    autoComplete="one-time-code"
                    maxLength={6}
                    style={[styles.input, styles.code]}
                  />
                  <Button testID="verify-code" label={busy ? '확인 중…' : '확인'} icon="check" disabled={busy || code.length !== 6} onPress={() => void verify()} />
                  <Button label="이메일 다시 입력" kind="ghost" onPress={() => setStep('email')} />
                </>
              )}
            </Panel>
            {step === 'email' && info ? <Banner icon="information-outline" text={info} /> : null}
            {error ? <Banner testID="account-error" icon="alert-circle" tone="danger" text={error} /> : null}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  center: { flex: 1, padding: 16, justifyContent: 'center', backgroundColor: C.bg },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 18, fontWeight: '900', color: C.ink },
  email: { fontSize: 14, fontWeight: '700', color: C.green, marginTop: 2 },
  body: { fontSize: 14, lineHeight: 21, color: C.ink },
  hint: { fontSize: 12, lineHeight: 18, color: C.sub },
  tabs: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  input: { backgroundColor: C.bg, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, height: 50, fontSize: 16, color: C.ink },
  code: { fontSize: 24, letterSpacing: 8, textAlign: 'center', fontWeight: '800' },
});
