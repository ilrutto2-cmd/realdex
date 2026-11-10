export const C = {
  bg: '#F5F0E1',
  surface: '#FFFCF3',
  line: '#E4DBC3',
  forest: '#1E4D3B',
  green: '#2F7A56',
  moss: '#7FA36B',
  mint: '#DCEBD3',
  ink: '#22301F',
  sub: '#6A735F',
  faint: '#A7AD98',
  amber: '#E2A12B',
  amberSoft: '#FBEBC4',
  coral: '#D9603F',
  coralSoft: '#FBE1D8',
  night: '#16241D',
  white: '#FFFFFF',
} as const;

export const R = { sm: 10, md: 16, lg: 22, pill: 999 } as const;

export const shadow = {
  shadowColor: '#3B3A20',
  shadowOpacity: 0.12,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
} as const;

export const STAGE_STYLE = {
  0: { border: C.line, label: '미발견', tint: C.faint },
  1: { border: C.moss, label: '1단계 · 발견', tint: C.green },
  2: { border: C.green, label: '2단계 · 재관찰', tint: C.forest },
  3: { border: C.amber, label: '3단계 · 생태 탐구', tint: C.amber },
} as const;
