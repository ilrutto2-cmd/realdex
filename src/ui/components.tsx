import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import {
  Alert,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import type { Species, Stage } from '../domain/types';
import { C, R, shadow, STAGE_STYLE } from './theme';

export type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export const Icon = ({ name, size = 20, color = C.ink }: { name: string; size?: number; color?: string }) => (
  <MaterialCommunityIcons name={name as IconName} size={size} color={color} />
);

export const Panel = ({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) => (
  <View style={[styles.panel, style]}>{children}</View>
);

export const H = ({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) => (
  <Text style={[styles.h, style]}>{children}</Text>
);

export const Chip = ({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  testID?: string;
}) => (
  <Pressable
    testID={testID}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected: !!active }}
    style={[styles.chip, active && styles.chipActive]}
  >
    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
  </Pressable>
);

export const Tag = ({ label, color = C.forest, bg = C.mint }: { label: string; color?: string; bg?: string }) => (
  <View style={[styles.tag, { backgroundColor: bg }]}>
    <Text style={[styles.tagText, { color }]}>{label}</Text>
  </View>
);

export const Button = ({
  label,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  testID,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'light' | 'danger' | 'amber';
  icon?: string;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) => {
  const bg = { primary: C.forest, ghost: 'transparent', light: 'transparent', danger: C.coralSoft, amber: C.amber }[kind];
  const fg = { primary: C.white, ghost: C.forest, light: C.white, danger: C.coral, amber: C.night }[kind];
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        kind === 'ghost' && { borderWidth: 1.5, borderColor: C.forest },
        kind === 'light' && { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)' },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={18} color={fg} /> : null}
      <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
};

export const ProgressBar = ({ ratio, color = C.green, height = 10 }: { ratio: number; color?: string; height?: number }) => {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: Math.max(0, Math.min(1, ratio)), duration: 500, useNativeDriver: false }).start();
  }, [anim, ratio]);
  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}>
      <Animated.View
        style={{
          height,
          borderRadius: height / 2,
          backgroundColor: color,
          width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }}
      />
    </View>
  );
};

export const StageStars = ({ stage, size = 12 }: { stage: Stage | 0; size?: number }) => (
  <View style={{ flexDirection: 'row', gap: 1 }} accessibilityLabel={STAGE_STYLE[stage].label}>
    {[1, 2, 3].map((n) => (
      <Icon key={n} name={stage >= n ? 'star' : 'star-outline'} size={size} color={stage >= n ? C.amber : C.faint} />
    ))}
  </View>
);

export const Banner = ({
  icon,
  text,
  tone = 'info',
  testID,
}: {
  icon: string;
  text: string;
  tone?: 'info' | 'warn' | 'danger';
  testID?: string;
}) => {
  const bg = { info: C.mint, warn: C.amberSoft, danger: C.coralSoft }[tone];
  const fg = { info: C.forest, warn: '#7A5206', danger: '#9B3A1E' }[tone];
  return (
    <View testID={testID} style={[styles.banner, { backgroundColor: bg }]}>
      <Icon name={icon} size={18} color={fg} />
      <Text style={[styles.bannerText, { color: fg }]}>{text}</Text>
    </View>
  );
};

/** 확인 창. 웹에서는 React Native의 Alert 버튼이 동작하지 않아 브라우저 확인 창을 쓴다. */
export const confirm = (title: string, message: string, okLabel: string): Promise<boolean> => {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: '취소', style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
};

export const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
};

const styles = StyleSheet.create({
  panel: { backgroundColor: C.surface, borderRadius: R.lg, padding: 16, borderWidth: 1, borderColor: C.line, ...shadow },
  h: { fontSize: 17, fontWeight: '800', color: C.ink, letterSpacing: -0.3 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: R.pill,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
  },
  chipActive: { backgroundColor: C.forest, borderColor: C.forest },
  chipText: { color: C.sub, fontWeight: '700', fontSize: 13 },
  chipTextActive: { color: C.white },
  tag: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: R.pill, alignSelf: 'flex-start' },
  tagText: { fontSize: 11, fontWeight: '800' },
  button: {
    minHeight: 50,
    borderRadius: R.md,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: { fontSize: 16, fontWeight: '800' },
  track: { backgroundColor: C.line, overflow: 'hidden' },
  banner: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: R.md, alignItems: 'flex-start' },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600' },
});

/** 카드에 표시하는 도감 번호. 확장 도감 종은 번호 대신 '확장'. */
export const speciesNumber = (sp: Species): string => (sp.kind === 'ext' ? '확장 도감' : `No.${String(sp.no).padStart(3, '0')}`);
