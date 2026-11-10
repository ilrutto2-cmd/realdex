export type SpeciesGroup = 'insect' | 'bird' | 'mammal' | 'other';

/** core: 기본 도감(미리 정한 종). ext: 확장 도감(AI가 확실히 판별한 그 밖의 종). */
export type SpeciesKind = 'core' | 'ext';

/** 게임상 발견 난이도. 실제 개체 수나 법적 보호 등급과 무관한 게임 지표. */
export type Tier = 'common' | 'interest' | 'special' | 'season' | 'explore';

export interface Species {
  id: string;
  kind: SpeciesKind;
  no: number;
  nameKo: string;
  scientificName: string;
  group: SpeciesGroup;
  /** 목·과 표기 */
  taxon: string;
  tier: Tier;
  icon: string;
  feature: string;
  habitat: string;
  season: string;
  role: string;
  similar: string;
  /** 법정 보호종 여부(확장 종은 AI 판단). 보호종은 위치를 기록하지 않는다. */
  isProtected?: boolean;
}

export type ObservationSource = 'ai' | 'manual_demo';

export interface Observation {
  id: string;
  speciesId: string;
  observedAt: string; // ISO
  localDate: string; // YYYY-MM-DD (기기 현지 날짜)
  photoUri: string;
  photoHash: string;
  region: string | null;
  lat: number | null; // 소수 둘째 자리(약 1km)까지만 저장
  lng: number | null;
  source: ObservationSource;
}

export type Stage = 1 | 2 | 3;

export interface DexEntry {
  speciesId: string;
  firstObservedAt: string;
  lastObservedAt: string;
  observationCount: number;
  distinctDates: number;
  distinctRegions: number;
  stage: Stage;
  studyCompletedAt: string | null;
  coverPhotoUri: string;
  firstRegion: string | null;
}

export type XpType = 'discover' | 'reobserve' | 'mission_daily' | 'mission_weekly' | 'study';

export interface XpEvent {
  id: string;
  /** 중복 지급 방지 키. 같은 키로는 한 번만 지급된다. */
  key: string;
  type: XpType;
  amount: number;
  createdAt: string;
}

export interface Settings {
  recordRegion: boolean;
}

export interface AppState {
  version: 1;
  observations: Observation[];
  xpEvents: XpEvent[];
  /** speciesId -> ISO */
  studies: Record<string, string>;
  /** `${missionId}:${periodKey}` -> ISO */
  missionClaims: Record<string, string>;
  /** achievementId -> ISO */
  achievements: Record<string, string>;
  /** 확장 도감 종 정보(서버에서 받은 것). id -> 종 */
  extSpecies: Record<string, Species>;
  /** 클라우드에 반영된 관찰 기록 id */
  syncedObservationIds: Record<string, true>;
  settings: Settings;
}

export const emptyState = (): AppState => ({
  version: 1,
  observations: [],
  xpEvents: [],
  studies: {},
  missionClaims: {},
  achievements: {},
  extSpecies: {},
  syncedObservationIds: {},
  settings: { recordRegion: false },
});

export interface MissionDef {
  id: string;
  period: 'daily' | 'weekly';
  title: string;
  target: number;
  rewardXp: number;
}

export interface MissionStatus extends MissionDef {
  periodKey: string;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

export interface LevelInfo {
  level: number;
  title: string;
  totalXp: number;
  xpIntoLevel: number;
  xpForNext: number;
}

export interface RegisterInput {
  id: string;
  speciesId: string;
  photoUri: string;
  photoHash: string;
  region: string | null;
  lat: number | null;
  lng: number | null;
  source: ObservationSource;
  /** 확장 종을 처음 등록할 때 함께 넘기는 종 정보 */
  ext?: Species;
}

export interface RegisterResult {
  ok: boolean;
  reason?: 'duplicate_photo' | 'unknown_species';
  isNewSpecies: boolean;
  xpGained: number;
  stageBefore: Stage | 0;
  stageAfter: Stage;
  levelBefore: number;
  levelAfter: number;
  newAchievements: string[];
  observation?: Observation;
}
