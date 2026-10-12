-- 在 Supabase 專案的 SQL Editor 執行一次即可。
-- 每位使用者只能讀寫自己的那一列（RLS）。

create table if not exists public.saving_plan_docs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.saving_plan_docs enable row level security;

create policy "read own doc"
  on public.saving_plan_docs for select
  using (auth.uid() = user_id);

create policy "insert own doc"
  on public.saving_plan_docs for insert
  with check (auth.uid() = user_id);

create policy "update own doc"
  on public.saving_plan_docs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
