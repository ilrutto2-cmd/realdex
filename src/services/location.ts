import * as Location from 'expo-location';

export interface RegionInfo {
  region: string;
  lat: number;
  lng: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

/**
 * 발견 지역을 '시·구' 수준으로만 구한다. 좌표는 소수 둘째 자리(약 1km)로 줄여 저장한다.
 * 권한이 없거나 실패하면 null — 위치 없이도 등록은 계속된다.
 */
export const getRegion = async (): Promise<RegionInfo | null> => {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const pos = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }), 8000);
    if (!pos) return null;
    const lat = round2(pos.coords.latitude);
    const lng = round2(pos.coords.longitude);
    let region = `위도 ${lat} · 경도 ${lng} 부근`;
    try {
      const places = await withTimeout(Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }), 5000);
      const p = places?.[0];
      const label = [p?.region, p?.city ?? p?.district ?? p?.subregion].filter(Boolean).join(' ');
      if (label) region = label;
    } catch {
      // 주소 변환이 안 되는 환경(웹 등)에서는 좌표 표기를 쓴다.
    }
    return { region, lat, lng };
  } catch {
    return null;
  }
};
