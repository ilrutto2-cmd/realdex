-- REALDEX 초기 스키마
-- 사용자, 생물종, 관찰 기록, 도감 진행도, 경험치 이력, 미션 정보

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.species (
  id text primary key,
  no int not null unique,
  name_ko text not null,
  scientific_name text not null,
  group_key text not null check (group_key in ('insect', 'bird', 'mammal')),
  taxon text not null,
  tier text not null check (tier in ('common', 'interest', 'special', 'season', 'explore')),
  feature text not null,
  habitat text not null,
  season text not null,
  role text not null,
  similar_note text not null,
  -- 법정 보호종이면 위치를 어떤 경로로도 공개하지 않는다. 초기 수록종은 모두 false.
  is_protected boolean not null default false
);

create table public.observations (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  species_id text not null references public.species (id),
  observed_at timestamptz not null,
  local_date date not null,
  photo_path text,
  photo_hash text not null,
  region text,
  -- 약 1km 격자로 줄인 좌표만 저장한다.
  lat numeric(5, 2),
  lng numeric(5, 2),
  source text not null check (source in ('ai', 'manual_demo')),
  created_at timestamptz not null default now(),
  unique (user_id, photo_hash)
);
create index observations_user_species on public.observations (user_id, species_id);

create table public.dex_progress (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  species_id text not null references public.species (id),
  first_observed_at timestamptz not null,
  observation_count int not null check (observation_count >= 1),
  stage smallint not null check (stage between 1 and 3),
  study_completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, species_id)
);

create table public.xp_events (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  idem_key text not null,
  type text not null,
  amount int not null,
  created_at timestamptz not null default now(),
  -- 같은 보상을 두 번 기록할 수 없다.
  unique (user_id, idem_key),
  -- 유형별 지급액을 서버에서도 고정한다.
  constraint xp_amount_by_type check (
    (type = 'discover' and amount = 100)
    or (type = 'reobserve' and amount = 10)
    or (type = 'mission_daily' and amount = 150)
    or (type = 'mission_weekly' and amount = 300)
    or (type = 'study' and amount = 300)
  )
);

create table public.missions (
  id text primary key,
  period text not null check (period in ('daily', 'weekly')),
  title text not null,
  target int not null,
  reward_xp int not null
);

create table public.mission_claims (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  mission_id text not null references public.missions (id),
  period_key date not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, mission_id, period_key)
);

-- 판별 함수 호출 기록(호출 횟수 제한용). 클라이언트는 접근할 수 없고 서버 함수만 쓴다.
create table public.identify_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text,
  created_at timestamptz not null default now()
);
create index identify_calls_user_time on public.identify_calls (user_id, created_at);

-- 가입(익명 포함) 시 프로필 생성
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 행 수준 보안: 각 사용자는 자기 데이터만 읽고 쓸 수 있다.
alter table public.profiles enable row level security;
alter table public.species enable row level security;
alter table public.observations enable row level security;
alter table public.dex_progress enable row level security;
alter table public.xp_events enable row level security;
alter table public.missions enable row level security;
alter table public.mission_claims enable row level security;
alter table public.identify_calls enable row level security;

create policy "own profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "species readable" on public.species for select to anon, authenticated using (true);
create policy "missions readable" on public.missions for select to anon, authenticated using (true);

create policy "own observations" on public.observations for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own dex" on public.dex_progress for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- 경험치 이력은 추가와 조회만 허용한다(수정 불가). 삭제는 전체 데이터 삭제 기능을 위해 본인 행만 허용.
create policy "own xp select" on public.xp_events for select to authenticated using (user_id = auth.uid());
create policy "own xp insert" on public.xp_events for insert to authenticated with check (user_id = auth.uid());
create policy "own xp delete" on public.xp_events for delete to authenticated using (user_id = auth.uid());
create policy "own claims" on public.mission_claims for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- identify_calls: 정책 없음 = 클라이언트 접근 불가(service role만 사용)

grant usage on schema public to anon, authenticated;
grant select on public.species, public.missions to anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.observations, public.dex_progress, public.mission_claims to authenticated;
grant select, insert, delete on public.xp_events to authenticated;

-- 사진 저장소: 비공개 버킷, 경로 첫 폴더가 본인 uid인 파일만 접근
insert into storage.buckets (id, name, public) values ('observation-photos', 'observation-photos', false)
  on conflict (id) do nothing;
create policy "own photos" on storage.objects for all to authenticated
  using (bucket_id = 'observation-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'observation-photos' and (storage.foldername(name))[1] = auth.uid()::text);
