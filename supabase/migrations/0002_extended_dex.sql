-- 확장 도감: AI가 확실히 판별한 도감 밖 종을 species 테이블에 함께 저장한다.
-- 기본 도감 종은 kind = 'core', 확장 종은 kind = 'ext'. 확장 종은 판별 서버 함수만 추가할 수 있다.
alter table public.species add column if not exists kind text not null default 'core';
alter table public.species drop constraint if exists species_kind_check;
alter table public.species add constraint species_kind_check check (kind in ('core', 'ext'));

alter table public.species drop constraint if exists species_group_key_check;
alter table public.species add constraint species_group_key_check
  check (group_key in ('insect', 'bird', 'mammal', 'other'));

alter table public.species add column if not exists created_at timestamptz not null default now();
create index if not exists species_kind on public.species (kind);
