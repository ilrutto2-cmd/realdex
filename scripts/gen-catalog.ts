/// <reference types="node" />
// src/domain의 종·미션 정의에서 서버용 파일을 만든다: npm run gen
//  - supabase/functions/identify/catalog.json (판별 함수가 쓰는 도감 목록)
//  - supabase/seed.sql (species, missions 테이블 초기 데이터)
import { writeFileSync } from 'node:fs';
import { MISSIONS } from '../src/domain/rules';
import { SPECIES } from '../src/domain/species';

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

const catalog = SPECIES.map((s) => ({ id: s.id, nameKo: s.nameKo, scientificName: s.scientificName, group: s.group }));
writeFileSync('supabase/functions/identify/catalog.json', `${JSON.stringify(catalog, null, 1)}\n`);

const speciesRows = SPECIES.map(
  (s) =>
    `  (${[q(s.id), s.no, q(s.nameKo), q(s.scientificName), q(s.group), q(s.taxon), q(s.tier), q(s.feature), q(s.habitat), q(s.season), q(s.role), q(s.similar)].join(', ')})`,
).join(',\n');
const missionRows = MISSIONS.map(
  (m) => `  (${[q(m.id), q(m.period), q(m.title), m.target, m.rewardXp].join(', ')})`,
).join(',\n');

writeFileSync(
  'supabase/seed.sql',
  `-- 자동 생성 파일. 직접 고치지 말고 src/domain을 고친 뒤 npm run gen 을 실행한다.
insert into public.species (id, no, name_ko, scientific_name, group_key, taxon, tier, feature, habitat, season, role, similar_note) values
${speciesRows}
on conflict (id) do update set
  no = excluded.no, name_ko = excluded.name_ko, scientific_name = excluded.scientific_name, group_key = excluded.group_key,
  taxon = excluded.taxon, tier = excluded.tier, feature = excluded.feature, habitat = excluded.habitat,
  season = excluded.season, role = excluded.role, similar_note = excluded.similar_note;

insert into public.missions (id, period, title, target, reward_xp) values
${missionRows}
on conflict (id) do update set
  period = excluded.period, title = excluded.title, target = excluded.target, reward_xp = excluded.reward_xp;
`,
);
console.log(`species ${SPECIES.length}, missions ${MISSIONS.length}`);
