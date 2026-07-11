-- Single scenarios table (no separate categories table)
-- Category info is embedded directly in each row.
-- System scenarios: user_id IS NULL, is_public = true
-- User scenarios: user_id = <uuid>, is_public = true/false

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_scenario_language_defaults()
returns trigger
language plpgsql
as $$
begin
  if new.title_target is null or btrim(new.title_target) = '' then
    new.title_target = case new.target_language_code
      when 'ja' then coalesce(new.title_ja, new.title_en, new.title_zh)
      else coalesce(new.title_en, new.title_ja, new.title_zh)
    end;
  end if;
  if new.description_target is null or btrim(new.description_target) = '' then
    new.description_target = case new.target_language_code
      when 'ja' then coalesce(new.description_ja, new.description_en, new.description_zh)
      else coalesce(new.description_en, new.description_ja, new.description_zh)
    end;
  end if;
  return new;
end;
$$;

create table if not exists public.scenarios (
  id uuid primary key default gen_random_uuid(),

  -- Category (embedded, no FK)
  category_slug text not null default 'other',
  category_name_zh text,
  category_name_en text,
  category_name_ja text,
  category_icon text,
  category_sort int not null default 0,

  -- Content
  title_zh text not null,
  title_en text not null,
  title_ja text,
  description_zh text,
  description_en text,
  description_ja text,
  title_target text,
  description_target text,
  target_language_code text not null default 'en'
    constraint scenarios_target_language_check check (
      target_language_code in ('en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
    ),
  native_language_code text not null default 'zh-CN'
    constraint scenarios_native_language_check check (
      native_language_code in ('zh-CN', 'en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
    ),
  constraint scenarios_language_pair_check check (
    target_language_code <> native_language_code
  ),
  difficulty text not null default 'intermediate'
    check (difficulty in ('beginner', 'intermediate', 'advanced')),
  system_prompt text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,

  -- Ownership: NULL = system/public, uuid = user-created
  user_id uuid references auth.users(id) on delete cascade,
  is_public boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scenarios_category_idx on public.scenarios (category_slug);
create index if not exists scenarios_category_slug_idx on public.scenarios (category_slug, sort_order);
create index if not exists scenarios_user_idx on public.scenarios (user_id);
create index if not exists scenarios_target_language_idx
  on public.scenarios (target_language_code, category_slug, sort_order);

drop trigger if exists scenarios_set_updated_at on public.scenarios;
create trigger scenarios_set_updated_at
  before update on public.scenarios
  for each row execute function public.set_updated_at();

drop trigger if exists scenarios_set_language_defaults on public.scenarios;
create trigger scenarios_set_language_defaults
  before insert or update of
    title_target, description_target, target_language_code,
    title_zh, title_en, title_ja,
    description_zh, description_en, description_ja
  on public.scenarios
  for each row execute function public.set_scenario_language_defaults();

alter table public.scenarios enable row level security;

drop policy if exists "Users can read available scenarios" on public.scenarios;
create policy "Users can read available scenarios"
  on public.scenarios for select
  to anon, authenticated
  using (
    (is_active and (user_id is null or is_public))
    or (select auth.uid()) = user_id
  );

drop policy if exists "Users can create their scenarios" on public.scenarios;
create policy "Users can create their scenarios"
  on public.scenarios for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their scenarios" on public.scenarios;
create policy "Users can update their scenarios"
  on public.scenarios for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their scenarios" on public.scenarios;
create policy "Users can delete their scenarios"
  on public.scenarios for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.scenarios from anon;
grant select on public.scenarios to anon;
grant select, insert, update, delete on public.scenarios to authenticated;

-- Distinguish news vs scenario conversations when that table is already present.
do $$
begin
  if to_regclass('public.chat_history') is not null then
    alter table public.chat_history
      add column if not exists source_type text not null default 'news';
  end if;
end
$$;
