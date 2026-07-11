create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  native_language_code text not null default 'zh-CN',
  native_language_label text not null default '中文',
  learning_language_code text not null default 'en',
  learning_language_label text not null default 'English',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_preferences_updated_idx
  on public.user_preferences (updated_at desc);

drop trigger if exists user_preferences_set_updated_at on public.user_preferences;
create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function public.set_updated_at();

alter table public.user_preferences enable row level security;

drop policy if exists "Users can read their preferences" on public.user_preferences;
create policy "Users can read their preferences"
  on public.user_preferences for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their preferences" on public.user_preferences;
create policy "Users can create their preferences"
  on public.user_preferences for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their preferences" on public.user_preferences;
create policy "Users can update their preferences"
  on public.user_preferences for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.user_preferences from anon;
grant select, insert, update on public.user_preferences to authenticated;
