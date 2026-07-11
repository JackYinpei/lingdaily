-- Create the language preferences store and upgrade the manually-created
-- legacy layout used by early LingDaily deployments. In particular, legacy
-- installations may use a text user_id and may be missing timestamps or some
-- language columns. Keep the user_id type in place so existing OAuth ids are
-- never rewritten or discarded.

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

-- CREATE TABLE IF NOT EXISTS does not add columns to an existing table.
-- Add every application-owned field explicitly before normalizing old rows.
alter table public.user_preferences
  add column if not exists user_id uuid,
  add column if not exists native_language_code text default 'zh-CN',
  add column if not exists native_language_label text default '中文',
  add column if not exists learning_language_code text default 'en',
  add column if not exists learning_language_label text default 'English',
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

-- Rows without an owner cannot be read by the application. Remove them before
-- enforcing ownership, then retain the newest row if an old table did not have
-- a unique user_id constraint.
delete from public.user_preferences
where user_id is null;

with ranked_preferences as (
  select
    ctid,
    row_number() over (
      partition by user_id
      order by updated_at desc nulls last, created_at desc nulls last, ctid desc
    ) as duplicate_rank
  from public.user_preferences
)
delete from public.user_preferences as preference
using ranked_preferences as ranked
where preference.ctid = ranked.ctid
  and ranked.duplicate_rank > 1;

update public.user_preferences
set
  learning_language_code = case
    when learning_language_code in ('en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
      then learning_language_code
    else 'en'
  end,
  native_language_code = case
    when native_language_code in ('zh-CN', 'en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
      then native_language_code
    else 'zh-CN'
  end,
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, created_at, now());

update public.user_preferences
set native_language_code = 'zh-CN'
where learning_language_code = native_language_code;

update public.user_preferences as preference
set
  learning_language_label = learning.label,
  native_language_label = native.label
from (
  values
    ('en', 'English'), ('ja', '日本語'), ('es', 'Español'),
    ('fr', 'Français'), ('de', 'Deutsch'), ('ko', '한국어'),
    ('pt', 'Português'), ('it', 'Italiano')
) as learning(code, label), (
  values
    ('zh-CN', '中文'), ('en', 'English'), ('ja', '日本語'),
    ('es', 'Español'), ('fr', 'Français'), ('de', 'Deutsch'),
    ('ko', '한국어'), ('pt', 'Português'), ('it', 'Italiano')
) as native(code, label)
where preference.learning_language_code = learning.code
  and preference.native_language_code = native.code
  and (
    preference.learning_language_label is distinct from learning.label
    or preference.native_language_label is distinct from native.label
  );

alter table public.user_preferences
  alter column user_id set not null,
  alter column native_language_code set default 'zh-CN',
  alter column native_language_code set not null,
  alter column native_language_label set default '中文',
  alter column native_language_label set not null,
  alter column learning_language_code set default 'en',
  alter column learning_language_code set not null,
  alter column learning_language_label set default 'English',
  alter column learning_language_label set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.user_preferences
  drop constraint if exists user_preferences_native_language_check,
  drop constraint if exists user_preferences_learning_language_check,
  drop constraint if exists user_preferences_language_pair_check,
  drop constraint if exists user_preferences_language_labels_check;

alter table public.user_preferences
  add constraint user_preferences_native_language_check check (
    native_language_code in ('zh-CN', 'en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
  ),
  add constraint user_preferences_learning_language_check check (
    learning_language_code in ('en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
  ),
  add constraint user_preferences_language_pair_check check (
    learning_language_code <> native_language_code
  ),
  add constraint user_preferences_language_labels_check check (
    btrim(learning_language_label) <> '' and btrim(native_language_label) <> ''
  );

create unique index if not exists user_preferences_user_id_uidx
  on public.user_preferences (user_id);
create index if not exists user_preferences_updated_idx
  on public.user_preferences (updated_at desc);

-- A fresh table already has this FK. Add it to compatible legacy UUID tables,
-- but do not coerce text ids or reject historical rows during the upgrade.
do $$
begin
  if to_regclass('auth.users') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'user_preferences'
        and column_name = 'user_id'
        and udt_name = 'uuid'
    )
    and not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.user_preferences'::regclass
        and contype = 'f'
        and conkey = array[
          (
            select attnum
            from pg_attribute
            where attrelid = 'public.user_preferences'::regclass
              and attname = 'user_id'
          )::smallint
        ]
    )
  then
    alter table public.user_preferences
      add constraint user_preferences_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade not valid;
  end if;
end
$$;

drop trigger if exists user_preferences_set_updated_at on public.user_preferences;
create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function public.set_updated_at();

alter table public.user_preferences enable row level security;

drop policy if exists "Users can read their preferences" on public.user_preferences;
create policy "Users can read their preferences"
  on public.user_preferences for select
  to authenticated
  using ((select auth.uid())::text = user_id::text);

drop policy if exists "Users can create their preferences" on public.user_preferences;
create policy "Users can create their preferences"
  on public.user_preferences for insert
  to authenticated
  with check ((select auth.uid())::text = user_id::text);

drop policy if exists "Users can update their preferences" on public.user_preferences;
create policy "Users can update their preferences"
  on public.user_preferences for update
  to authenticated
  using ((select auth.uid())::text = user_id::text)
  with check ((select auth.uid())::text = user_id::text);

revoke all on public.user_preferences from anon;
grant select, insert, update on public.user_preferences to authenticated;
