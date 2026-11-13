import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

export interface PreparedPhoto {
  /** 줄인 사진의 임시 파일 주소 */
  uri: string;
  /** 서버로 보낼 JPEG(base64) */
  base64: string;
  /** 같은 사진 재사용을 막기 위한 SHA-256 */
  hash: string;
}

/** 긴 사진을 가로 1024px JPEG로 줄인다. 전송량과 판별 비용을 줄이기 위함. */
export const preparePhoto = async (uri: string): Promise<PreparedPhoto> => {
  const out = await manipulateAsync(uri, [{ resize: { width: 1024 } }], {
    compress: 0.7,
    format: SaveFormat.JPEG,
    base64: true,
  });
  if (!out.base64) throw new Error('사진을 처리하지 못했습니다.');
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, out.base64);
  return { uri: out.uri, base64: out.base64, hash };
};

const photoDir = () => new Directory(Paths.document, 'photos');

/** 사진을 앱 전용 저장소에 영구 보관하고 그 주소를 돌려준다. */
export const persistPhoto = async (photo: PreparedPhoto, id: string): Promise<string> => {
  if (Platform.OS === 'web') {
    // 웹에는 앱 전용 파일 저장소가 없어 줄인 사진을 데이터 주소로 IndexedDB에 보관한다.
    const small = await manipulateAsync(photo.uri, [{ resize: { width: 480 } }], {
      compress: 0.6,
      format: SaveFormat.JPEG,
      base64: true,
    });
    return `data:image/jpeg;base64,${small.base64}`;
  }
  const dir = photoDir();
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `${id}.jpg`);
  new File(photo.uri).copy(dest);
  return dest.uri;
};

export const deletePhoto = (uri: string): void => {
  if (Platform.OS === 'web' || !uri.startsWith('file:')) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // 이미 지워진 파일은 무시한다.
  }
};

export const deleteAllPhotos = (): void => {
  if (Platform.OS === 'web') return;
  try {
    const dir = photoDir();
    if (dir.exists) dir.delete();
  } catch {
    // 무시
  }
};

export const readPhotoBytes = async (uri: string): Promise<ArrayBuffer> => {
  if (Platform.OS === 'web' || !uri.startsWith('file:')) return (await fetch(uri)).arrayBuffer();
  return new File(uri).arrayBuffer();
};

/** 서버에서 내려받은 사진(JPEG 바이트)을 이 기기에 보관하고 주소를 돌려준다. */
export const saveDownloadedPhoto = async (bytes: ArrayBuffer, id: string): Promise<string> => {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
    try {
      const small = await manipulateAsync(url, [{ resize: { width: 480 } }], { compress: 0.6, format: SaveFormat.JPEG, base64: true });
      return `data:image/jpeg;base64,${small.base64}`;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const dir = photoDir();
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `${id}.jpg`);
  if (dest.exists) dest.delete();
  dest.create();
  await dest.write(new Uint8Array(bytes));
  return dest.uri;
};
