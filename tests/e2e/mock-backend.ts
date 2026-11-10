/// <reference types="node" />
// E2E 테스트 전용 가짜 백엔드. Supabase의 인증·함수·DB·저장소 주소를 흉내 낸다.
// 판별 함수는 실제 서버 코드(core.ts)를 그대로 실행하되, Anthropic API 응답만 미리 정한 값으로 대체한다.
// → 앱과 서버 함수의 연결·검증·오류 처리는 확인하지만, 실제 AI의 판별 능력은 확인하지 못한다.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import catalog from '../../supabase/functions/identify/catalog.json';
import { IdentifyError, identifyImage } from '../../supabase/functions/identify/core';

export type Mode = 'ladybug' | 'magpie' | 'none' | 'fail500' | 'offline' | 'ratelimit';

const USER_ID = '11111111-2222-4333-8444-555555555555';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = () =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

const CANNED: Record<'ladybug' | 'magpie' | 'none', unknown> = {
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
  anthropicRequests: { hasKeyHeader: boolean; imageBytes: number; model: string }[];
}

export const startMockBackend = (port: number): Promise<MockBackend> => {
  let mode: Mode = 'ladybug';
  const log: MockBackend['log'] = [];
  const anthropicRequests: MockBackend['anthropicRequests'] = [];

  const fakeAnthropic = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    anthropicRequests.push({
      hasKeyHeader: (init.headers as Record<string, string>)['x-api-key'] === 'server-side-secret',
      imageBytes: body.messages[0].content[0].source.data.length,
      model: body.model,
    });
    if (mode === 'fail500') return new Response('{}', { status: 500 });
    const input = CANNED[mode === 'magpie' || mode === 'none' ? mode : 'ladybug'];
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
        send(200, result);
      } catch (e) {
        if (e instanceof IdentifyError) send(e.code === 'bad_request' ? 400 : 502, { error: e.code, message: e.message });
        else send(500, { error: 'server' });
      }
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
      resolve({ server, setMode: (m) => (mode = m), log, anthropicRequests }),
    );
  });
};
