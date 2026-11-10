/// <reference types="node" />
// 웹 빌드를 헤드리스 크롬에서 실제로 조작하는 종단 테스트.
//   npm run e2e   (먼저 npm run build:e2e 로 dist/demo, dist/cloud 를 만든다)
// 크롬의 가짜 카메라 장치를 사용하므로 '실제 생물 촬영'과 '실제 AI 판별'은 이 테스트의 범위가 아니다.
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { buildQuiz } from '../../src/domain/rules';
import { startMockBackend, type MockBackend } from './mock-backend';

const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const SHOTS = 'dist/shots';
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf' };

const serveDir = (dir: string, port: number) =>
  new Promise<ReturnType<typeof createServer>>((resolve) => {
    const s = createServer((req, res) => {
      let p = join(dir, decodeURIComponent((req.url ?? '/').split('?')[0]));
      if (!existsSync(p) || statSync(p).isDirectory()) p = join(dir, 'index.html');
      res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
      createReadStream(p).pipe(res);
    });
    s.listen(port, '127.0.0.1', () => resolve(s));
  });

const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${!ok && detail ? `  → ${detail}` : ''}`);
};

const sel = (id: string) => `[data-testid="${id}"]`;
const visible = (page: Page, id: string, timeout = 15000) => page.waitForSelector(sel(id), { visible: true, timeout });
const click = async (page: Page, id: string) => {
  const el = await visible(page, id);
  await el!.click();
};
const text = async (page: Page, id: string) => {
  const el = await visible(page, id);
  return (await el!.evaluate((n) => n.textContent)) ?? '';
};
const exists = (page: Page, id: string) => page.$(sel(id)).then((e) => !!e);
const gone = (page: Page, id: string) => page.waitForSelector(sel(id), { hidden: true, timeout: 10000 });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const state = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('realdex/state/v1') ?? 'null')) as Promise<{
    observations: { id: string; speciesId: string; source: string; photoUri: string; localDate: string }[];
    xpEvents: { key: string; amount: number }[];
    studies: Record<string, string>;
    missionClaims: Record<string, string>;
    syncedObservationIds: Record<string, true>;
  } | null>;
const xpOf = async (page: Page) => ((await state(page))?.xpEvents ?? []).reduce((s, e) => s + e.amount, 0);
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` as `${string}.png` });

const newPage = async (browser: Browser, url: string) => {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  // 테스트에서 날짜를 넘기기 위한 장치: localStorage의 __dayOffset(일)만큼 시계를 앞당긴다.
  await page.evaluateOnNewDocument(`(() => {
    let off = 0;
    try { off = Number(localStorage.getItem('__dayOffset') || 0) * 86400000; } catch (e) { return; }
    if (!off) return;
    const Real = Date;
    window.Date = class extends Real {
      constructor(...a) {
        if (a.length === 0) super(Real.now() + off);
        else super(...a);
      }
      static now() {
        return Real.now() + off;
      }
    };
  })()`);
  page.on('dialog', (d) => void d.accept());
  page.on('pageerror', (e) => console.log('   [pageerror]', String(e).slice(0, 200)));
  await page.goto(url, { waitUntil: 'networkidle0' });
  return page;
};

let shots = 0;
/** 촬영 후 결과·오류·직접선택 화면 중 하나가 뜰 때까지 기다린다. */
const shootPhoto = async (page: Page) => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (attempt === 0) await click(page, 'tab-capture');
    await visible(page, 'shutter');
    await page.waitForFunction((s) => !(document.querySelector(s) as HTMLElement | null)?.hasAttribute('aria-disabled') && !(document.querySelector(s) as HTMLButtonElement | null)?.disabled, { timeout: 15000 }, sel('shutter'));
    shots += 1;
    await pause(300 + shots * 370);
    await click(page, 'shutter');
    await page.waitForSelector(`${sel('result-view')},${sel('error-view')},${sel('manual-view')}`, { visible: true, timeout: 30000 });
    // 크롬의 가짜 카메라 영상은 같은 장면이 반복되어, 가끔 이전과 완전히 같은 사진이 찍힌다.
    // 그때는 앱이 중복 사진으로 막으므로(의도된 동작) 다시 찍는다. 실제 카메라에서는 일어나지 않는다.
    const dup = (await exists(page, 'error-message')) && (await text(page, 'error-message')).includes('이미 도감에 등록한 사진');
    if (!dup) return;
    await click(page, 'retake');
  }
  throw new Error('서로 다른 사진을 찍지 못했습니다.');
};

const back = async (page: Page) => {
  const el = await page.waitForSelector('[aria-label$="back"]', { visible: true, timeout: 10000 });
  await el!.click();
  await pause(500);
};

const demoScenario = async (browser: Browser) => {
  console.log('\n[A] 데모 모드 (서버 미연결)');
  const page = await newPage(browser, 'http://127.0.0.1:8181/');
  check('A1 홈에 데모 모드 표시', await exists(page, 'home-demo-banner'));
  check('A1 초기 레벨 1, 수집 0/51', (await text(page, 'level')).includes('1') && (await text(page, 'rate')) === '0/51');
  await shot(page, 'a1-home-empty');

  await shootPhoto(page);
  await visible(page, 'manual-view');
  check('A2 촬영 후 AI 결과 대신 데모 안내가 나온다', (await text(page, 'demo-banner')).includes('분석하지 않았습니다') && !(await exists(page, 'result-view')));
  await shot(page, 'a2-demo-manual');
  await page.type(sel('manual-search'), '까치');
  await click(page, 'manual-pica-serica');
  await click(page, 'register');
  check('A3 신규 발견 연출', (await text(page, 'reveal-headline')) === '새로운 발견!' && (await text(page, 'reveal-name')) === '까치');
  check('A3 신규 발견 +100', (await text(page, 'reveal-xp')).includes('+100'));
  await pause(1500);
  await shot(page, 'a3-reveal');
  await click(page, 'reveal-close');
  let s = await state(page);
  check('A4 관찰 기록이 직접 선택으로 저장됨', s?.observations.length === 1 && s.observations[0].source === 'manual_demo');

  await page.reload({ waitUntil: 'networkidle0' });
  check('A5 새로 고침 후에도 기록 유지', (await text(page, 'rate')) === '1/51' && (await text(page, 'xp')).includes('누적 100'));
  await click(page, 'tab-dex');
  check('A6 도감 수집률 표시', (await text(page, 'dex-rate')).startsWith('1 / 51'));
  await shot(page, 'a6-dex');
  check('A6 미발견 종은 이름을 가린다', (await text(page, 'dex-card-passer-montanus')).includes('???'));
  await click(page, 'dex-card-pica-serica');
  check('A7 카드 상세', (await text(page, 'species-name')) === '까치' && (await text(page, 'species-count')) === '1회' && (await text(page, 'species-stage')).includes('1단계'));
  await shot(page, 'a7-card');
  await page.close();
};

const cloudScenario = async (browser: Browser, mock: MockBackend) => {
  console.log('\n[B] 서버 연결 모드 (가짜 백엔드, AI 응답은 테스트용 고정값)');
  const page = await newPage(browser, 'http://127.0.0.1:8182/');
  check('B0 데모 표시 없음', !(await exists(page, 'home-demo-banner')));

  mock.setMode('ladybug');
  await shootPhoto(page);
  await visible(page, 'result-view', 30000);
  await shot(page, 'b1-result');
  check('B1 후보 3개 표시', (await exists(page, 'candidate-0')) && (await exists(page, 'candidate-2')) && !(await exists(page, 'candidate-3')));
  check('B1 과 단계 후보는 선택 불가', (await text(page, 'candidate-2')).includes('종 확정 불가'));
  check('B1 서버 함수가 로그인 토큰을 받고, AI 키는 서버에서만 붙는다', mock.log.some((l) => l.path === '/functions/v1/identify' && !!l.auth?.startsWith('Bearer ')) && mock.anthropicRequests.at(-1)?.hasKeyHeader === true);
  await click(page, 'register');
  check('B2 신규 등록 +100, 다음 미션 안내', (await text(page, 'reveal-xp')).includes('+100') && (await text(page, 'reveal-next-mission')).length > 3);
  await click(page, 'reveal-close');
  await pause(1500);
  let s = await state(page);
  const paths = mock.log.map((l) => `${l.method} ${l.path}`);
  check('B3 사진·관찰 기록·도감·경험치가 서버로 전송됨', paths.some((p) => p.startsWith('POST /storage/v1/object/observation-photos/')) && paths.includes('POST /rest/v1/observations') && paths.includes('POST /rest/v1/dex_progress') && paths.includes('POST /rest/v1/xp_events'));
  check('B3 전송 완료 표시', Object.keys(s?.syncedObservationIds ?? {}).length === 1);

  await shootPhoto(page);
  await visible(page, 'result-view', 30000);
  await click(page, 'register');
  check('B4 같은 날 같은 종: 기록만 추가', (await text(page, 'reveal-headline')) === '관찰 기록 추가' && (await text(page, 'reveal-xp')).includes('이미'));
  await click(page, 'reveal-close');
  s = await state(page);
  check('B4 카드는 1장, 관찰 기록 2건, 경험치 100', new Set(s!.observations.map((o) => o.speciesId)).size === 1 && s!.observations.length === 2 && (await xpOf(page)) === 100);

  mock.setMode('none');
  await shootPhoto(page);
  await visible(page, 'result-view', 30000);
  check('B5 생물이 없으면 등록 버튼이 없다', (await text(page, 'result-view')).includes('생물을 찾지 못했어요') && !(await exists(page, 'register')));
  await click(page, 'retake');

  mock.setMode('fail500');
  await shootPhoto(page);
  await visible(page, 'error-view', 30000);
  check('B6 판별 서버 오류 시 안내와 재시도', (await exists(page, 'retry')) && (await text(page, 'error-message')).length > 5);
  await shot(page, 'b6-error');
  mock.setMode('magpie');
  await click(page, 'retry');
  await visible(page, 'result-view', 30000);
  await click(page, 'register');
  check('B6 재시도 후 등록, 레벨 2 달성', (await text(page, 'reveal-name')) === '까치' && (await xpOf(page)) === 200);
  await click(page, 'reveal-close');

  mock.setMode('offline');
  await shootPhoto(page);
  await visible(page, 'error-view', 30000);
  check('B7 통신 끊김 안내', (await text(page, 'error-message')).includes('인터넷'));
  await click(page, 'retake');

  mock.setMode('ratelimit');
  await shootPhoto(page);
  await visible(page, 'error-view', 30000);
  check('B8 횟수 초과 시 재시도 버튼 없음', (await text(page, 'error-message')).includes('횟수') && !(await exists(page, 'retry')), await text(page, 'error-message'));
  await click(page, 'retake');

  // 사진첩: 같은 파일을 두 번 고른다.
  mock.setMode('ladybug');
  const file = `${SHOTS}/gallery-source.png`;
  await page.screenshot({ path: file as `${string}.png`, clip: { x: 0, y: 0, width: 300, height: 300 } });
  await visible(page, 'pick-photo');
  let [chooser] = await Promise.all([page.waitForFileChooser(), click(page, 'pick-photo')]);
  await chooser.accept([file]);
  await visible(page, 'result-view', 30000);
  await click(page, 'register');
  await click(page, 'reveal-close');
  await visible(page, 'pick-photo');
  [chooser] = await Promise.all([page.waitForFileChooser(), click(page, 'pick-photo')]);
  await chooser.accept([file]);
  await visible(page, 'error-view', 30000);
  check('B9 사진첩 사진 판별, 같은 사진 재등록 차단', (await text(page, 'error-message')).includes('이미 도감에 등록한 사진'));
  await click(page, 'retake');

  // 미션 보상
  await click(page, 'tab-home');
  const before = await xpOf(page);
  await click(page, 'claim-d_log');
  await visible(page, 'toast');
  await shot(page, 'b10-mission-claim');
  await gone(page, 'claim-d_log');
  check('B10 일일 미션 보상 +150, 한 번만', (await xpOf(page)) === before + 150 && !(await exists(page, 'claim-d_log')));
  await shot(page, 'b10-home');

  // 다음 날
  await page.evaluate(() => localStorage.setItem('__dayOffset', '1'));
  await page.reload({ waitUntil: 'networkidle0' });
  s = await state(page);
  check('B11 다시 열어도 기록 유지', s!.observations.length === 4 && (await text(page, 'rate')) === '2/51');
  check('B11 다음 날 일일 미션 초기화', (await text(page, 'mission-d_log')).includes('0/1'));
  const xp0 = await xpOf(page);
  await shootPhoto(page);
  await visible(page, 'result-view', 30000);
  await click(page, 'register');
  check('B12 다른 날 재관찰: 카드 성장 +10', (await text(page, 'reveal-headline')) === '도감 카드가 성장했어요' && (await xpOf(page)) === xp0 + 10);
  await click(page, 'reveal-open-card');
  check('B12 카드 2단계, 관찰 4회', (await text(page, 'species-stage')).includes('2단계') && (await text(page, 'species-count')) === '4회');

  // 생태 탐구
  await click(page, 'start-quiz');
  const quiz = buildQuiz('coccinella-septempunctata');
  for (let i = 0; i < quiz.length; i += 1) await click(page, `quiz-${i}-${(quiz[i].answerIndex + 1) % 3}`);
  await click(page, 'quiz-submit');
  check('B13 오답이면 완료되지 않음', await visible(page, 'quiz-wrong').then(() => true));
  for (let i = 0; i < quiz.length; i += 1) await click(page, `quiz-${i}-${quiz[i].answerIndex}`);
  await shot(page, 'b13-quiz');
  const xp1 = await xpOf(page);
  await click(page, 'quiz-submit');
  await visible(page, 'quiz-done');
  check('B13 탐구 완료 +300', (await xpOf(page)) === xp1 + 300);
  await click(page, 'quiz-back');
  check('B13 카드 3단계', (await text(page, 'species-stage')).includes('3단계'));
  await shot(page, 'b13-card-stage3');

  // 관찰 기록 삭제
  await back(page);
  await click(page, 'tab-dex');
  await click(page, 'dex-card-pica-serica');
  const xp2 = await xpOf(page);
  await click(page, 'delete-observation');
  await visible(page, 'dex-rate');
  await pause(800);
  s = await state(page);
  check('B14 기록 삭제: 카드가 사라지고 경험치는 그대로', !s!.observations.some((o) => o.speciesId === 'pica-serica') && (await text(page, 'dex-rate')).startsWith('1 / 51') && (await xpOf(page)) === xp2);
  check('B14 서버에도 삭제 요청', mock.log.some((l) => l.method === 'DELETE' && l.path === '/rest/v1/observations'));

  await click(page, 'tab-records');
  check('B15 탐험 기록 목록', (await page.$$(sel('record-row'))).length === 4);
  await shot(page, 'b15-records');

  await click(page, 'tab-my');
  check('B16 마이페이지 통계', (await text(page, 'stat-species')) === '1종' && (await text(page, 'stat-observations')) === '4건' && (await text(page, 'cloud-status')).includes('연결됨'));
  await shot(page, 'b16-my');
  await click(page, 'wipe');
  await visible(page, 'my-message');
  s = await state(page);
  check('B17 전체 삭제', s === null && (await text(page, 'stat-species')) === '0종' && (await text(page, 'stat-xp')) === '0');
  await page.close();
};

const deniedScenario = async () => {
  console.log('\n[C] 카메라 권한 거부');
  // 권한 자동 허용 옵션 없이 실행하면 헤드리스 크롬은 카메라 요청을 거부한다.
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--deny-permission-prompts'] });
  try {
    const page = await newPage(browser, 'http://127.0.0.1:8181/');
    await click(page, 'tab-capture');
    await visible(page, 'camera-permission');
    if (await exists(page, 'grant-camera')) {
      await click(page, 'grant-camera');
      await pause(1500);
    }
    check('C1 권한이 없으면 안내 화면이 나오고 앱이 멈추지 않는다', (await exists(page, 'camera-permission')) && !(await exists(page, 'shutter')));
    await shot(page, 'c1-permission');
    const file = `${SHOTS}/gallery-source-2.png`;
    await page.screenshot({ path: file as `${string}.png`, clip: { x: 0, y: 0, width: 300, height: 300 } });
    const [chooser] = await Promise.all([page.waitForFileChooser(), click(page, 'pick-photo')]);
    await chooser.accept([file]);
    check('C2 권한 없이도 사진첩으로 진행 가능', await visible(page, 'manual-view').then(() => true));
  } finally {
    await browser.close();
  }
};

const main = async () => {
  mkdirSync(SHOTS, { recursive: true });
  const demo = await serveDir('dist/demo', 8181);
  const cloud = await serveDir('dist/cloud', 8182);
  const mock = await startMockBackend(54399);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  let crashed: unknown = null;
  try {
    await demoScenario(browser);
    await cloudScenario(browser, mock);
    await deniedScenario();
  } catch (e) {
    crashed = e;
    const pages = await browser.pages();
    await pages.at(-1)?.screenshot({ path: `${SHOTS}/crash.png` }).catch(() => undefined);
  } finally {
    await browser.close();
    demo.close();
    cloud.close();
    mock.server.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 통과`);
  if (crashed) console.log('중단:', crashed instanceof Error ? crashed.message : crashed);
  process.exit(failed.length > 0 || crashed ? 1 : 0);
};

void main();
