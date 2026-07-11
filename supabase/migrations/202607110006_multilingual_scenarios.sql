-- Upgrade every historical scenarios layout to the embedded, language-aware
-- schema. This supports an empty database, the original category_id/two-table
-- layout, and the current embedded-category layout.
create extension if not exists "pgcrypto";

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
  category_slug text not null default 'other',
  category_name_zh text,
  category_name_en text,
  category_name_ja text,
  category_icon text,
  category_sort int not null default 0,
  title_zh text not null,
  title_en text not null,
  title_ja text,
  description_zh text,
  description_en text,
  description_ja text,
  title_target text,
  description_target text,
  target_language_code text not null default 'en',
  native_language_code text not null default 'zh-CN',
  difficulty text not null default 'intermediate'
    check (difficulty in ('beginner', 'intermediate', 'advanced')),
  system_prompt text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  user_id uuid,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- `create table if not exists` does not add missing columns to the original
-- category_id schema, so declare every embedded/ownership field explicitly.
alter table public.scenarios
  add column if not exists category_slug text default 'other',
  add column if not exists category_name_zh text,
  add column if not exists category_name_en text,
  add column if not exists category_name_ja text,
  add column if not exists category_icon text,
  add column if not exists category_sort int default 0,
  add column if not exists user_id uuid,
  add column if not exists is_public boolean default false,
  add column if not exists title_target text,
  add column if not exists description_target text,
  add column if not exists target_language_code text default 'en',
  add column if not exists native_language_code text default 'zh-CN';

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

-- Copy category metadata out of the original scenario_categories table when
-- both that table and the legacy category_id column are present.
do $$
declare
  legacy_constraint record;
begin
  if to_regclass('public.scenario_categories') is not null
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'scenarios'
        and column_name = 'category_id'
    )
  then
    alter table public.scenarios alter column category_id drop not null;

    execute $migration$
      update public.scenarios as scenario
      set
        category_slug = category.slug,
        category_name_zh = coalesce(nullif(btrim(scenario.category_name_zh), ''), category.name_zh),
        category_name_en = coalesce(nullif(btrim(scenario.category_name_en), ''), category.name_en),
        category_name_ja = coalesce(nullif(btrim(scenario.category_name_ja), ''), category.name_ja),
        category_icon = coalesce(nullif(btrim(scenario.category_icon), ''), category.icon),
        category_sort = category.sort_order
      from public.scenario_categories as category
      where scenario.category_id = category.id
        and (
          scenario.category_slug is distinct from category.slug
          or scenario.category_name_zh is distinct from coalesce(nullif(btrim(scenario.category_name_zh), ''), category.name_zh)
          or scenario.category_name_en is distinct from coalesce(nullif(btrim(scenario.category_name_en), ''), category.name_en)
          or scenario.category_name_ja is distinct from coalesce(nullif(btrim(scenario.category_name_ja), ''), category.name_ja)
          or scenario.category_icon is distinct from coalesce(nullif(btrim(scenario.category_icon), ''), category.icon)
          or scenario.category_sort is distinct from category.sort_order
        )
    $migration$;

    -- The embedded fields are now authoritative. Sever the old relationship so
    -- deleting or editing a legacy category can no longer delete/overwrite the
    -- upgraded scenario on a later migration run.
    execute 'update public.scenarios set category_id = null where category_id is not null';

    for legacy_constraint in
      select constraint_row.conname
      from pg_constraint as constraint_row
      join pg_attribute as column_row
        on column_row.attrelid = constraint_row.conrelid
       and column_row.attnum = any(constraint_row.conkey)
      where constraint_row.conrelid = 'public.scenarios'::regclass
        and constraint_row.contype = 'f'
        and constraint_row.confdeltype = 'c'
        and column_row.attname = 'category_id'
    loop
      execute format(
        'alter table public.scenarios drop constraint %I',
        legacy_constraint.conname
      );
    end loop;

    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.scenarios'::regclass
        and conname = 'scenarios_legacy_category_id_fkey'
    ) then
      alter table public.scenarios
        add constraint scenarios_legacy_category_id_fkey
        foreign key (category_id)
        references public.scenario_categories(id)
        on delete set null
        not valid;
    end if;
  end if;
end
$$;

update public.scenarios
set
  category_slug = coalesce(nullif(btrim(category_slug), ''), 'other'),
  category_sort = coalesce(category_sort, 0),
  is_public = case when user_id is null then true else coalesce(is_public, false) end
where category_slug is null
   or btrim(category_slug) = ''
   or category_sort is null
   or is_public is null
   or (user_id is null and is_public is distinct from true);

update public.scenarios
set title_target = title_en
where title_target is null or btrim(title_target) = '';

update public.scenarios
set description_target = coalesce(
  nullif(btrim(description_en), ''),
  nullif(btrim(description_zh), ''),
  nullif(btrim(description_ja), '')
)
where (description_target is null or btrim(description_target) = '')
  and coalesce(
    nullif(btrim(description_en), ''),
    nullif(btrim(description_zh), ''),
    nullif(btrim(description_ja), '')
  ) is not null;

update public.scenarios
set
  target_language_code = case
    when target_language_code in ('en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
      then target_language_code
    else 'en'
  end,
  native_language_code = case
    when native_language_code in ('zh-CN', 'en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
      then native_language_code
    else 'zh-CN'
  end
where target_language_code is null
   or target_language_code not in ('en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
   or native_language_code is null
   or native_language_code not in ('zh-CN', 'en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it');

update public.scenarios
set native_language_code = 'zh-CN'
where target_language_code = native_language_code;

alter table public.scenarios
  alter column category_slug set default 'other',
  alter column category_slug set not null,
  alter column category_sort set default 0,
  alter column category_sort set not null,
  alter column target_language_code set default 'en',
  alter column target_language_code set not null,
  alter column native_language_code set default 'zh-CN',
  alter column native_language_code set not null,
  alter column is_public set default false,
  alter column is_public set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.scenarios'::regclass
      and conname = 'scenarios_target_language_check'
  ) then
    alter table public.scenarios
      add constraint scenarios_target_language_check check (
        target_language_code in ('en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.scenarios'::regclass
      and conname = 'scenarios_native_language_check'
  ) then
    alter table public.scenarios
      add constraint scenarios_native_language_check check (
        native_language_code in ('zh-CN', 'en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.scenarios'::regclass
      and conname = 'scenarios_language_pair_check'
  ) then
    alter table public.scenarios
      add constraint scenarios_language_pair_check check (
        target_language_code <> native_language_code
      );
  end if;

  if to_regclass('auth.users') is not null
    and not exists (
      select 1 from pg_constraint
      where conrelid = 'public.scenarios'::regclass
        and conname = 'scenarios_user_id_fkey'
    )
  then
    alter table public.scenarios
      add constraint scenarios_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade not valid;
  end if;
end
$$;

create index if not exists scenarios_category_slug_idx
  on public.scenarios (category_slug, sort_order);
create index if not exists scenarios_user_idx
  on public.scenarios (user_id);
create index if not exists scenarios_target_language_idx
  on public.scenarios (target_language_code, category_slug, sort_order);

-- The application normally uses the service role, but direct REST access must
-- still protect private user-created scenarios.
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
