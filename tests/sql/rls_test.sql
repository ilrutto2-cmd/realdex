-- 스키마·RLS 검증. 실패하면 예외로 중단된다.
\set ON_ERROR_STOP on
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');

do $$ begin
  assert (select count(*) from public.profiles) = 2, '가입 시 프로필이 생성되어야 한다';
  assert (select count(*) from public.species) = 51, '종 51건';
  assert (select count(*) from public.missions) = 6, '미션 6건';
end $$;

-- 사용자 A
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.observations (id, species_id, observed_at, local_date, photo_hash, source)
  values ('10000000-0000-0000-0000-000000000001', 'pica-serica', now(), current_date, 'hash-a1', 'ai');
insert into public.dex_progress (species_id, first_observed_at, observation_count, stage)
  values ('pica-serica', now(), 1, 1);
insert into public.xp_events (id, idem_key, type, amount)
  values ('20000000-0000-0000-0000-000000000001', 'discover:pica-serica', 'discover', 100);
insert into public.mission_claims (mission_id, period_key) values ('d_log', current_date);
insert into storage.objects (bucket_id, name) values ('observation-photos', '00000000-0000-0000-0000-00000000000a/p1.jpg');

do $$
declare failed boolean;
begin
  -- 같은 보상 키 중복
  failed := false;
  begin
    insert into public.xp_events (id, idem_key, type, amount)
      values ('20000000-0000-0000-0000-000000000002', 'discover:pica-serica', 'discover', 100);
  exception when unique_violation then failed := true; end;
  assert failed, '같은 보상 키는 두 번 기록되면 안 된다';

  -- 지급액 조작
  failed := false;
  begin
    insert into public.xp_events (id, idem_key, type, amount)
      values ('20000000-0000-0000-0000-000000000003', 'discover:passer-montanus', 'discover', 99999);
  exception when check_violation then failed := true; end;
  assert failed, '유형별 지급액이 고정되어야 한다';

  -- 경험치 수정 금지(권한 없음)
  failed := false;
  begin
    update public.xp_events set amount = 100 where true;
  exception when insufficient_privilege then failed := true; end;
  assert failed, '경험치 이력은 수정할 수 없어야 한다';

  -- 같은 사진 중복
  failed := false;
  begin
    insert into public.observations (id, species_id, observed_at, local_date, photo_hash, source)
      values ('10000000-0000-0000-0000-000000000002', 'passer-montanus', now(), current_date, 'hash-a1', 'ai');
  exception when unique_violation then failed := true; end;
  assert failed, '같은 사진은 한 번만 기록';

  -- 남의 이름으로 쓰기
  failed := false;
  begin
    insert into public.observations (id, user_id, species_id, observed_at, local_date, photo_hash, source)
      values ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000b', 'pica-serica', now(), current_date, 'hash-x', 'ai');
  exception when insufficient_privilege then failed := true; end;
  assert failed, '다른 사용자 id로 기록할 수 없어야 한다';

  -- 남의 폴더에 사진 올리기
  failed := false;
  begin
    insert into storage.objects (bucket_id, name) values ('observation-photos', '00000000-0000-0000-0000-00000000000b/p.jpg');
  exception when insufficient_privilege then failed := true; end;
  assert failed, '다른 사용자 폴더에 사진을 올릴 수 없어야 한다';

  -- 판별 호출 기록은 클라이언트가 볼 수 없다
  failed := false;
  begin
    perform 1 from public.identify_calls;
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'identify_calls는 클라이언트 접근 불가';

  -- 종 정보는 읽기 전용
  failed := false;
  begin
    update public.species set is_protected = true where true;
  exception when insufficient_privilege then failed := true; end;
  assert failed, '종 정보는 수정할 수 없어야 한다';
end $$;

-- 사용자 B: A의 데이터가 보이지 않고, 지우거나 고칠 수도 없다
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$
declare n int;
begin
  assert (select count(*) from public.observations) = 0, 'B는 A의 관찰 기록을 볼 수 없다';
  assert (select count(*) from public.dex_progress) = 0, 'B는 A의 도감을 볼 수 없다';
  assert (select count(*) from public.xp_events) = 0, 'B는 A의 경험치를 볼 수 없다';
  assert (select count(*) from public.mission_claims) = 0, 'B는 A의 미션 기록을 볼 수 없다';
  assert (select count(*) from public.profiles) = 1, 'B는 자기 프로필만 본다';
  assert (select count(*) from storage.objects) = 0, 'B는 A의 사진을 볼 수 없다';
  delete from public.observations where true;
  get diagnostics n = row_count;
  assert n = 0, 'B는 A의 기록을 지울 수 없다';
  update public.dex_progress set stage = 3 where true;
  get diagnostics n = row_count;
  assert n = 0, 'B는 A의 도감을 고칠 수 없다';
  assert (select count(*) from public.species) = 51, '종 정보는 누구나 읽는다';
end $$;

-- 로그인하지 않은 사용자
set role anon;
reset request.jwt.claim.sub;
do $$
declare failed boolean := false;
begin
  assert (select count(*) from public.species) = 51, '비로그인도 종 정보는 읽는다';
  begin
    perform 1 from public.observations;
  exception when insufficient_privilege then failed := true; end;
  assert failed, '비로그인은 관찰 기록에 접근할 수 없다';
end $$;

-- A의 데이터는 그대로 남아 있다
reset role;
do $$ begin
  assert (select count(*) from public.observations) = 1;
  assert (select count(*) from public.xp_events) = 1;
  assert (select stage from public.dex_progress) = 1;
end $$;
select 'SQL_TESTS_PASSED' as result;
