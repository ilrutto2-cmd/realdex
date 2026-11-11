-- 후기 수집: 의견 보내기와 판별 오류 신고
create table if not exists public.feedback (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- general: 의견 보내기, misid: 판별이 틀렸어요
  kind text not null check (kind in ('general', 'misid')),
  rating smallint check (rating between 1 and 5),
  message text not null default '' check (char_length(message) <= 2000),
  -- 신고 당시 정보(보여 준 후보, 등록한 종, 사진 경로 등). 개인 식별 정보는 넣지 않는다.
  context jsonb not null default '{}'::jsonb check (pg_column_size(context) <= 16000),
  app_version text,
  created_at timestamptz not null default now()
);
create index if not exists feedback_created on public.feedback (created_at desc);

alter table public.feedback enable row level security;
-- 사용자는 자기 의견만 쓰고 볼 수 있다. 전체 열람은 통계 함수(서비스 권한)로만 한다.
drop policy if exists "own feedback insert" on public.feedback;
create policy "own feedback insert" on public.feedback for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "own feedback select" on public.feedback;
create policy "own feedback select" on public.feedback for select to authenticated using (user_id = auth.uid());
grant select, insert on public.feedback to authenticated;
