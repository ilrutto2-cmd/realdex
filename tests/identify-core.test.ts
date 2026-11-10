import { describe, expect, it } from 'vitest';
import catalog from '../supabase/functions/identify/catalog.json';
import {
  buildSystemPrompt,
  extSpeciesId,
  generateSpeciesInfo,
  IdentifyError,
  isExtEligible,
  identifyImage,
  MAX_BASE64_LENGTH,
  normalize,
} from '../supabase/functions/identify/core';

// 주의: 이 테스트는 Anthropic API 응답을 흉내 낸 가짜 fetch로 서버 함수의 요청 구성·검증 로직만 확인한다.
// 실제 모델의 판별 정확도는 검증하지 않는다.

const IMG = 'A'.repeat(500);
const toolResponse = (input: unknown, status = 200) =>
  (async () =>
    new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(input) }] }), {
      status,
    })) as unknown as typeof fetch;

const base = {
  organism_visible: true,
  image_quality: 'ok',
  retake_advice: null,
  caution: null,
  possibly_protected: false,
};

describe('요청 구성', () => {
  it('키는 헤더로만 보내고, 이미지와 도감 목록을 담아 JSON 형식을 강제한다', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ ...base, candidates: [] }) }] }),
      );
    }) as unknown as typeof fetch;
    await identifyImage({ imageBase64: IMG, mediaType: 'image/jpeg', catalog, apiKey: 'sk-test', model: 'm', fetchImpl });
    expect(captured!.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(captured!.init.body as string);
    expect(body.model).toBe('m');
    expect(body.tool_choice).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema.additionalProperties).toBe(false);
    expect(body.output_config.format.schema.properties.candidates.items.additionalProperties).toBe(false);
    expect(body.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: IMG },
    });
    expect(body.system).toContain('coccinella-septempunctata | 칠성무당벌레 | Coccinella septempunctata');
    expect(JSON.stringify(body)).not.toContain('sk-test');
  });
  it('시스템 프롬프트에 도감 전 종이 들어간다', () => {
    const p = buildSystemPrompt(catalog);
    for (const c of catalog) expect(p).toContain(c.id);
  });
});

describe('결과 검증', () => {
  it('도감 수록 종은 도감의 이름과 학명으로 맞춘다', async () => {
    const r = await identifyImage({
      imageBase64: IMG,
      mediaType: 'image/jpeg',
      catalog,
      apiKey: 'k',
      model: 'm',
      fetchImpl: toolResponse({
        ...base,
        candidates: [
          {
            catalog_id: 'coccinella-septempunctata',
            name_ko: '칠성 무당벌레',
            scientific_name: 'C. septempunctata',
            rank: 'species',
            assessment: 'likely',
            reasoning: '붉은 딱지날개에 검은 점 7개가 보인다.',
          },
        ],
      }),
    });
    expect(r.status).toBe('ok');
    expect(r.candidates[0]).toMatchObject({
      catalogId: 'coccinella-septempunctata',
      nameKo: '칠성무당벌레',
      scientificName: 'Coccinella septempunctata',
      rank: 'species',
      assessment: 'likely',
    });
  });
  it('목록에 없는 id나 종 단계가 아닌 후보는 등록 대상이 아니다', () => {
    const r = normalize(
      {
        ...base,
        candidates: [
          { catalog_id: 'made-up-id', name_ko: '가짜종', scientific_name: 'Fakus fakus', rank: 'species', assessment: 'likely', reasoning: 'x' },
          { catalog_id: 'tenodera-sinensis', name_ko: '사마귀속', scientific_name: 'Tenodera', rank: 'genus', assessment: 'possible', reasoning: 'x' },
        ],
      },
      catalog,
      'm',
    );
    expect(r.candidates.map((c) => c.catalogId)).toEqual([null, null]);
    expect(r.candidates[1]).toMatchObject({ rank: 'genus', nameKo: '사마귀속' });
  });
  it('후보는 최대 3개, 형식이 틀린 항목은 버린다', () => {
    const cand = (n: number) => ({ catalog_id: null, name_ko: `종${n}`, scientific_name: `S ${n}`, rank: 'weird', assessment: 'sure', reasoning: '' });
    const r = normalize({ ...base, candidates: [cand(1), { name_ko: '' }, null, cand(2), cand(3), cand(4)] }, catalog, 'm');
    expect(r.candidates).toHaveLength(3);
    expect(r.candidates[0]).toMatchObject({ rank: 'family', assessment: 'needs_check' });
  });
  it('생물이 없거나 화면·그림을 찍은 사진이면 후보를 주지 않는다', () => {
    const cand = { catalog_id: 'pica-serica', name_ko: '까치', scientific_name: 'Pica serica', rank: 'species', assessment: 'likely', reasoning: 'x' };
    expect(normalize({ ...base, organism_visible: false, candidates: [cand] }, catalog, 'm')).toMatchObject({ status: 'no_organism', candidates: [] });
    expect(normalize({ ...base, image_quality: 'not_live_subject', candidates: [cand] }, catalog, 'm')).toMatchObject({ status: 'no_organism', candidates: [] });
  });
  it('후보가 없으면 재촬영 안내 상태가 된다', () => {
    const r = normalize({ ...base, image_quality: 'blurry', candidates: [], retake_advice: '초점을 맞춰 다시 찍어 주세요.' }, catalog, 'm');
    expect(r).toMatchObject({ status: 'low_quality', quality: 'blurry', retakeAdvice: '초점을 맞춰 다시 찍어 주세요.' });
  });
  it('주의 안내와 보호종 가능성을 전달한다', () => {
    const r = normalize(
      {
        ...base,
        caution: '말벌류는 쏘일 수 있으니 거리를 두세요.',
        possibly_protected: true,
        candidates: [{ catalog_id: null, name_ko: '말벌과', scientific_name: 'Vespidae', rank: 'family', assessment: 'possible', reasoning: 'x' }],
      },
      catalog,
      'm',
    );
    expect(r.caution).toContain('거리');
    expect(r.possiblyProtected).toBe(true);
  });
});

describe('오류 처리', () => {
  const call = (over: Partial<Parameters<typeof identifyImage>[0]>) =>
    identifyImage({ imageBase64: IMG, mediaType: 'image/jpeg', catalog, apiKey: 'k', model: 'm', fetchImpl: toolResponse({ ...base, candidates: [] }), ...over });
  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'no-error';
    } catch (e) {
      return e instanceof IdentifyError ? e.code : 'other';
    }
  };
  it('이미지 없음·과대·형식 오류는 요청 오류', async () => {
    expect(await codeOf(call({ imageBase64: '' }))).toBe('bad_request');
    expect(await codeOf(call({ imageBase64: 'A'.repeat(MAX_BASE64_LENGTH + 1) }))).toBe('bad_request');
    expect(await codeOf(call({ mediaType: 'image/heic' }))).toBe('bad_request');
  });
  it('통신 실패·서버 오류·과부하를 구분한다', async () => {
    const throwing = (async () => {
      throw new TypeError('network');
    }) as unknown as typeof fetch;
    expect(await codeOf(call({ fetchImpl: throwing }))).toBe('upstream');
    expect(await codeOf(call({ fetchImpl: toolResponse({}, 500) }))).toBe('upstream');
    expect(await codeOf(call({ fetchImpl: toolResponse({}, 429) }))).toBe('upstream_overloaded');
    expect(await codeOf(call({ fetchImpl: toolResponse({}, 529) }))).toBe('upstream_overloaded');
  });
  it('JSON이 아니거나 거절·빈 응답이면 결과 오류', async () => {
    const reply = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
    expect(await codeOf(call({ fetchImpl: reply({ content: [{ type: 'text', text: '까치입니다' }] }) }))).toBe('bad_model_output');
    expect(await codeOf(call({ fetchImpl: reply({ stop_reason: 'refusal', content: [{ type: 'text', text: '{}' }] }) }))).toBe('bad_model_output');
    expect(await codeOf(call({ fetchImpl: reply({ content: [] }) }))).toBe('bad_model_output');
  });
  it('크레딧 부족·키 오류는 원인을 알려 준다', async () => {
    const err = (status: number, message: string) =>
      (async () => new Response(JSON.stringify({ error: { type: 'invalid_request_error', message } }), { status })) as unknown as typeof fetch;
    await expect(call({ fetchImpl: err(400, 'Your credit balance is too low to access the Anthropic API.') })).rejects.toThrow('크레딧');
    await expect(call({ fetchImpl: err(401, 'invalid x-api-key') })).rejects.toThrow('키가 올바르지');
  });
});

describe('확장 도감', () => {
  const cand = (over: Partial<import('../supabase/functions/identify/core').Candidate> = {}) => ({
    catalogId: null,
    nameKo: '큰허리노린재',
    scientificName: 'Molipteryx fuliginosa',
    rank: 'species' as const,
    assessment: 'likely' as const,
    reasoning: '',
    ext: null,
    ...over,
  });

  it('도감 밖 종 단계의 유력 후보만 확장 도감 대상', () => {
    expect(isExtEligible(cand())).toBe(true);
    expect(isExtEligible(cand({ catalogId: 'pica-serica' }))).toBe(false);
    expect(isExtEligible(cand({ assessment: 'possible' }))).toBe(false);
    expect(isExtEligible(cand({ rank: 'genus', scientificName: 'Molipteryx' }))).toBe(false);
    expect(isExtEligible(cand({ scientificName: 'molipteryx fuliginosa' }))).toBe(false);
    expect(isExtEligible(cand({ scientificName: 'Molipteryx sp.' }))).toBe(false);
  });

  it('학명으로 같은 id를 만든다', () => {
    expect(extSpeciesId('Molipteryx fuliginosa')).toBe('x-molipteryx-fuliginosa');
    expect(extSpeciesId(' Araneus  ventricosus ')).toBe('x-araneus-ventricosus');
  });

  it('학명이 도감 종과 같으면 id가 없어도 도감 종으로 본다', () => {
    const r = normalize(
      { ...base, candidates: [{ catalog_id: null, name_ko: '참새', scientific_name: 'passer montanus', rank: 'species', assessment: 'likely', reasoning: 'x' }] },
      catalog,
      'm',
    );
    expect(r.candidates[0]).toMatchObject({ catalogId: 'passer-montanus', nameKo: '참새', ext: null });
  });

  const infoReply = (input: unknown) =>
    (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.output_config.format.type).toBe('json_schema');
      expect(JSON.stringify(body.messages)).toContain('Molipteryx fuliginosa');
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(input) }] }));
    }) as unknown as typeof fetch;
  const info = {
    is_animal_species: true,
    name_ko: '큰허리노린재',
    group: 'insect',
    taxon: '노린재목 허리노린재과',
    feature: '몸이 검은 갈색이고 배 가장자리가 넓게 튀어나와 있다.',
    habitat: '숲 가장자리, 산딸기·찔레 주변',
    season: '봄~가을',
    role: '식물 즙을 먹고 새와 거미의 먹이가 된다.',
    similar: '시골가시허리노린재는 더 작고 가시가 짧다.',
    is_protected: false,
  };
  const gen = (input: unknown) =>
    generateSpeciesInfo({ scientificName: 'Molipteryx fuliginosa', nameKoHint: '큰허리노린재', apiKey: 'k', model: 'm', fetchImpl: infoReply(input) });

  it('종 설명을 만들어 확장 종으로 돌려준다', async () => {
    expect(await gen(info)).toMatchObject({
      id: 'x-molipteryx-fuliginosa',
      nameKo: '큰허리노린재',
      scientificName: 'Molipteryx fuliginosa',
      group: 'insect',
      isProtected: false,
    });
  });
  it('국명이 없으면 학명을, 모르는 분류군은 기타로', async () => {
    expect(await gen({ ...info, name_ko: null, group: 'alien' })).toMatchObject({ nameKo: 'Molipteryx fuliginosa', group: 'other' });
  });
  it('실제 종이 아니거나 설명이 비면 만들지 않는다', async () => {
    expect(await gen({ ...info, is_animal_species: false })).toBeNull();
    expect(await gen({ ...info, habitat: '  ' })).toBeNull();
  });
});
