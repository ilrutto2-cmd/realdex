/// <reference types="node" />
// E2E 테스트 전용 가짜 백엔드. Supabase의 인증·함수·DB·저장소 주소를 흉내 낸다.
// 판별 함수는 실제 서버 코드(core.ts)를 그대로 실행하되, Anthropic API 응답만 미리 정한 값으로 대체한다.
// → 앱과 서버 함수의 연결·검증·오류 처리는 확인하지만, 실제 AI의 판별 능력은 확인하지 못한다.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import catalog from '../../supabase/functions/identify/catalog.json';
import { computeStats, type FeedbackRow } from '../../supabase/functions/stats/core';
import { generateSpeciesInfo, IdentifyError, identifyImage, isExtEligible } from '../../supabase/functions/identify/core';

export type Mode = 'ladybug' | 'magpie' | 'spider' | 'none' | 'fail500' | 'offline' | 'ratelimit';

const USER_ID = '11111111-2222-4333-8444-555555555555';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = (sub = USER_ID) =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

// 이메일 계정 시험용: taken@example.com 은 다른 기기에서 이미 쓰던 계정(까치 1건, 사진 포함)
const ACCOUNT_ID = '99999999-8888-4777-8666-555555555555';
const ACCOUNT_EMAIL = 'taken@example.com';
const OTP = '123456';
const TINY_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAwAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDkqKKKxPNCiop7qG22+a+3d04JqL+07P8A57f+On/CnYajJ7ItUVV/tOz/AOe3/jp/wqWC6hud3lPu29eCKLA4yW6JaKKKQgooooAytb/5Yf8AAv6Vl1qa3/yw/wCBf0rLrWOx20vgQVqaJ/y3/wCA/wBay61NE/5b/wDAf60S2Cr8DNWiiisjiCiiigCKe1hudvmpu29OSKi/syz/AOeP/jx/xq1RTuNSktmVf7Ms/wDnj/48f8algtYbbd5Sbd3XkmpaKLg5Se7CiiikI//Z', 'base64');
const ACCOUNT_ROWS: Record<string, unknown[]> = {
  observations: [
    {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      species_id: 'pica-serica',
      observed_at: '2026-11-01T03:00:00.000Z',
      local_date: '2026-11-01',
      photo_path: `${ACCOUNT_ID}/aaaaaaaa-0000-4000-8000-000000000001.jpg`,
      photo_hash: 'account-photo-hash',
      region: null,
      lat: null,
      lng: null,
      source: 'ai',
    },
  ],
  xp_events: [{ id: 'bbbbbbbb-0000-4000-8000-000000000001', idem_key: 'discover:pica-serica', type: 'discover', amount: 100, created_at: '2026-11-01T03:00:00.000Z' }],
  mission_claims: [{ mission_id: 'd_log', period_key: '2026-11-01', claimed_at: '2026-11-01T03:05:00.000Z' }],
  dex_progress: [{ species_id: 'pica-serica', study_completed_at: null }],
};
const userJson = (id: string, email: string) => {
  const now = new Date().toISOString();
  return { id, aud: 'authenticated', role: 'authenticated', email, is_anonymous: !email, app_metadata: {}, user_metadata: {}, created_at: now, updated_at: now };
};
const sessionJson = (id: string, email: string) => ({
  access_token: fakeJwt(id),
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: `refresh-${id}`,
  user: userJson(id, email),
});
const subOf = (auth: string | undefined): string | null => {
  try {
    return JSON.parse(Buffer.from((auth ?? '').replace(/^Bearer\s+/i, '').split('.')[1] ?? '', 'base64url').toString()).sub ?? null;
  } catch {
    return null;
  }
};

const SPIDER_INFO = {
  is_animal_species: true,
  name_ko: '산왕거미',
  group: 'other',
  taxon: '거미목 왕거미과',
  feature: '(테스트용 응답) 배가 크고 둥글며 갈색 무늬가 있다.',
  habitat: '(테스트용 응답) 숲 가장자리, 처마 밑',
  season: '여름~가을',
  role: '(테스트용 응답) 날벌레를 잡아먹는다.',
  similar: '(테스트용 응답) 왕거미와 비슷하다.',
  is_protected: false,
};

const CANNED: Record<'ladybug' | 'magpie' | 'spider' | 'none', unknown> = {
  spider: {
    organism_visible: true,
    image_quality: 'ok',
    candidates: [
      { catalog_id: null, name_ko: '산왕거미', scientific_name: 'Araneus ventricosus', rank: 'species', assessment: 'likely', reasoning: '(테스트용 응답) 둥근 그물 가운데 큰 배를 가진 거미가 보입니다.' },
      { catalog_id: null, name_ko: '왕거미속', scientific_name: 'Araneus', rank: 'genus', assessment: 'possible', reasoning: '(테스트용 응답) 속 단계까지만 확실합니다.' },
    ],
    retake_advice: null,
    caution: null,
    possibly_protected: false,
  },
  ladybug: {
    organism_visible: true,
    image_quality: 'ok',
    candidates: [
      { catalog_id: 'coccinella-septempunctata', name_ko: '칠성무당벌레', scientific_name: 'Coccinella septempunctata', rank: 'species', assessment: 'likely', reasoning: '(테스트용 응답) 붉은 딱지날개에 검은 점 7개가 보입니다.' },
      { catalog_id: 'harmonia-axyridis', name_ko: '무당벌레', scientific_name: 'Harmonia axyridis', rank: 'species', assessment: 'possible', reasoning: '(테스트용 응답) 무늬 변이형일 가능성이 있습니다.' },
      { catalog_id: null, name_ko: '무당벌레과', scientific_name: 'Coccinellidae', rank: 'family', assessment: 'needs_check', reasoning: '(테스트용 응답) 과 단계까지만 확실합니다.' },
    ],
    retake_advice: null,
    caution: null,
    possibly_protected: false,
  },
  magpie: {
    organism_visible: true,
    image_quality: 'ok',
    candidates: [
      { catalog_id: 'pica-serica', name_ko: '까치', scientific_name: 'Pica serica', rank: 'species', assessment: 'likely', reasoning: '(테스트용 응답) 검은 몸에 흰 배와 긴 꼬리가 보입니다.' },
    ],
    retake_advice: null,
    caution: null,
    possibly_protected: false,
  },
  none: {
    organism_visible: false,
    image_quality: 'ok',
    candidates: [],
    retake_advice: '생물이 화면 가운데에 크게 보이도록 다시 촬영해 주세요.',
    caution: null,
    possibly_protected: false,
  },
};

const readBody = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

export interface MockBackend {
  server: Server;
  setMode: (m: Mode) => void;
  log: { method: string; path: string; body?: unknown; auth?: string }[];
  feedback: FeedbackRow[];
  /** 앱이 올린 관찰 기록(누구 이름으로 올렸는지 포함) */
  uploads: { user_id: string; species_id: string; source: string; created_at: string }[];
  accountId: string;
  anthropicRequests: { hasKeyHeader: boolean; imageBytes: number; model: string }[];
}

export const startMockBackend = (port: number): Promise<MockBackend> => {
  let mode: Mode = 'ladybug';
  const log: MockBackend['log'] = [];
  const anthropicRequests: MockBackend['anthropicRequests'] = [];
  const feedback: FeedbackRow[] = [];
  let pendingEmail: string | null = null;
  let linkedEmail: string | null = null;
  const observations: { user_id: string; species_id: string; source: string; created_at: string }[] = [];
  let identifyCalls = 0;
  const extStore = new Map<string, import('../../supabase/functions/identify/core').ExtSpecies>();

  const fakeAnthropic = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    anthropicRequests.push({
      hasKeyHeader: (init.headers as Record<string, string>)['x-api-key'] === 'server-side-secret',
      imageBytes: body.messages[0].content[0].source?.data?.length ?? 0,
      model: body.model,
    });
    if (mode === 'fail500') return new Response('{}', { status: 500 });
    if (String(body.system).includes('편집자')) {
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(SPIDER_INFO) }] }));
    }
    const input = CANNED[mode === 'magpie' || mode === 'none' || mode === 'spider' ? mode : 'ladybug'];
    return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(input) }] }));
  }) as unknown as typeof fetch;

  const server = createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0];
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    const raw = await readBody(req);
    const isJson = (req.headers['content-type'] ?? '').includes('json');
    let parsed: unknown;
    try {
      parsed = isJson && raw.length ? JSON.parse(raw.toString()) : undefined;
    } catch {
      parsed = undefined;
    }
    const entry = { method: req.method ?? '', path, body: path.includes('/identify') ? '(image)' : (parsed ?? `(${raw.length} bytes)`), auth: req.headers.authorization };
    log.push(entry);

    // ---- 이메일 연결·로그인 ----
    const authBody = (parsed ?? {}) as { email?: string; token?: string; type?: string };
    if (path === '/auth/v1/user' && req.method === 'PUT') {
      if (authBody.email === ACCOUNT_EMAIL) {
        send(422, { code: 'email_exists', msg: 'A user with this email address has already been registered' });
        return;
      }
      pendingEmail = authBody.email ?? null;
      send(200, { ...userJson(USER_ID, ''), new_email: pendingEmail });
      return;
    }
    if (path === '/auth/v1/otp' && req.method === 'POST') {
      if (authBody.email !== ACCOUNT_EMAIL && authBody.email !== linkedEmail) {
        send(422, { code: 'otp_disabled', msg: 'Signups not allowed for otp' });
        return;
      }
      send(200, {});
      return;
    }
    if (path === '/auth/v1/verify' && req.method === 'POST') {
      if (authBody.token !== OTP) {
        send(403, { code: 'otp_expired', msg: 'Token has expired or is invalid' });
        return;
      }
      if (authBody.type === 'email_change') {
        linkedEmail = pendingEmail;
        send(200, sessionJson(USER_ID, linkedEmail ?? ''));
        return;
      }
      if (authBody.email === ACCOUNT_EMAIL) {
        send(200, sessionJson(ACCOUNT_ID, ACCOUNT_EMAIL));
        return;
      }
      send(200, sessionJson(USER_ID, linkedEmail ?? ''));
      return;
    }
    if (path === '/auth/v1/logout') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    if (path === '/auth/v1/user' && req.method === 'GET') {
      const sub = subOf(req.headers.authorization);
      send(200, sub === ACCOUNT_ID ? userJson(ACCOUNT_ID, ACCOUNT_EMAIL) : userJson(USER_ID, linkedEmail ?? ''));
      return;
    }
    // 계정 사진 내려받기
    if (req.method === 'GET' && path.startsWith('/storage/v1/object/') && path.endsWith('.jpg')) {
      res.writeHead(200, { ...cors, 'content-type': 'image/jpeg' });
      res.end(TINY_JPEG);
      return;
    }
    // 계정 기록 읽기(로그인한 계정 행만)
    if (req.method === 'GET' && path.startsWith('/rest/v1/')) {
      const table = path.slice('/rest/v1/'.length);
      if (table === 'species') {
        send(200, []);
        return;
      }
      send(200, subOf(req.headers.authorization) === ACCOUNT_ID ? (ACCOUNT_ROWS[table] ?? []) : []);
      return;
    }

    if (path === '/auth/v1/signup') {
      const now = new Date().toISOString();
      send(200, {
        access_token: fakeJwt(),
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'refresh',
        user: { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: '', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: now, updated_at: now },
      });
      return;
    }
    if (path === '/functions/v1/identify') {
      if (mode === 'offline') {
        req.socket.destroy(); // 통신 끊김 흉내
        return;
      }
      if (mode === 'ratelimit') {
        send(429, { error: 'rate_limit', message: '오늘의 판별 횟수를 모두 사용했습니다.' });
        return;
      }
      if (!req.headers.authorization?.startsWith('Bearer ')) {
        send(401, { error: 'unauthorized' });
        return;
      }
      identifyCalls += 1;
      const p = (parsed ?? {}) as { image_base64?: string; media_type?: string };
      try {
        const result = await identifyImage({
          imageBase64: p.image_base64 ?? '',
          mediaType: p.media_type ?? 'image/jpeg',
          catalog,
          apiKey: 'server-side-secret',
          model: 'mock-model',
          fetchImpl: fakeAnthropic,
        });
        // 실제 서버 함수(index.ts)와 같은 순서로 확장 종을 붙인다. DB 대신 메모리에 저장.
        for (const c of result.candidates) {
          if (!isExtEligible(c)) continue;
          c.ext =
            extStore.get(c.scientificName) ??
            (await generateSpeciesInfo({ scientificName: c.scientificName, nameKoHint: c.nameKo, apiKey: 'server-side-secret', model: 'mock-model', fetchImpl: fakeAnthropic }));
          if (c.ext) extStore.set(c.scientificName, c.ext);
        }
        send(200, result);
      } catch (e) {
        if (e instanceof IdentifyError) send(e.code === 'bad_request' ? 400 : 502, { error: e.code, message: e.message });
        else send(500, { error: 'server' });
      }
      return;
    }
    if (path === '/functions/v1/stats') {
      if (req.headers['x-stats-token'] !== 'test-stats-token-123') {
        send(401, { error: 'unauthorized', message: '관리자 토큰이 맞지 않습니다.' });
        return;
      }
      const now = new Date();
      send(
        200,
        computeStats(
          {
            profiles: [{ id: USER_ID, created_at: new Date(now.getTime() - 3 * 864e5).toISOString() }],
            calls: Array.from({ length: identifyCalls }, () => ({ user_id: USER_ID, status: 'ok', created_at: now.toISOString() })),
            observations,
            species: [],
            feedback,
          },
          now,
        ),
      );
      return;
    }
    if (path === '/rest/v1/feedback' && req.method === 'POST') {
      const row = parsed as Omit<FeedbackRow, 'user_id' | 'created_at'>;
      feedback.push({ ...row, user_id: USER_ID, created_at: new Date().toISOString() } as FeedbackRow);
      send(201, []);
      return;
    }
    if (path === '/rest/v1/observations' && req.method === 'POST') {
      const row = parsed as { species_id: string; source: string };
      observations.push({ user_id: subOf(req.headers.authorization) ?? USER_ID, species_id: row.species_id, source: row.source, created_at: new Date().toISOString() });
      send(201, []);
      return;
    }
    if (path.startsWith('/storage/v1/object/list/')) {
      send(200, []);
      return;
    }
    if (path.startsWith('/storage/v1/object')) {
      send(200, { Key: path, Id: 'x' });
      return;
    }
    if (path.startsWith('/rest/v1/')) {
      send(req.method === 'DELETE' ? 200 : 201, []);
      return;
    }
    send(404, { error: 'not_found', path });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () =>
      resolve({ server, setMode: (m) => (mode = m), log, anthropicRequests, feedback, uploads: observations, accountId: ACCOUNT_ID }),
    );
  });
};
