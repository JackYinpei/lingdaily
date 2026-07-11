-- Self-contained upgrade: this file is safe whether chat_history already exists or not.
begin;

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

create table if not exists public.chat_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  news_key text not null,
  news_title text,
  news jsonb,
  history jsonb not null default '[]'::jsonb,
  summary text,
  source_type text not null default 'news',
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.chat_history
  add column if not exists source_type text default 'news',
  add column if not exists revision integer default 1;

-- The production table already has this trigger. Disable it during one-time
-- classification/backfill so historical updated_at values remain unchanged.
drop trigger if exists chat_history_set_updated_at on public.chat_history;

do $$
begin
  if exists (
    select 1
    from public.chat_history
    where history is null or jsonb_typeof(history) <> 'array'
  ) then
    raise exception 'LINGDAILY_CHAT_HISTORY_INVALID_PAYLOAD'
      using hint = 'Repair or archive non-array chat history payloads before migrating.';
  end if;

  if exists (
    select 1
    from public.chat_history
    where source_type is not null
      and source_type not in ('news', 'scenario')
  ) then
    raise exception 'LINGDAILY_CHAT_HISTORY_INVALID_SOURCE'
      using hint = 'Map unsupported chat history source_type values before migrating.';
  end if;

  if exists (
    select 1
    from public.chat_history
    where revision is not null and revision < 1
  ) then
    raise exception 'LINGDAILY_CHAT_HISTORY_INVALID_REVISION'
      using hint = 'Repair non-positive chat history revisions before migrating.';
  end if;
end
$$;

update public.chat_history
set source_type = case
  when news_key like 'scenario:%' then 'scenario'
  else 'news'
end
where source_type is null;
-- Adding source_type with its default fills legacy rows as "news" before this
-- migration can infer their original type, so repair scenario-prefixed keys.
update public.chat_history
set source_type = 'scenario'
where news_key like 'scenario:%' and source_type = 'news';

update public.chat_history
set revision = 1
where revision is null or revision < 1;

alter table public.chat_history
  alter column history set default '[]'::jsonb,
  alter column history set not null,
  alter column source_type set default 'news',
  alter column source_type set not null,
  alter column revision set default 1,
  alter column revision set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_history'::regclass
      and conname = 'chat_history_history_array_check'
  ) then
    alter table public.chat_history
      add constraint chat_history_history_array_check
      check (jsonb_typeof(history) = 'array') not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_history'::regclass
      and conname = 'chat_history_source_type_check'
  ) then
    alter table public.chat_history
      add constraint chat_history_source_type_check
      check (source_type in ('news', 'scenario')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_history'::regclass
      and conname = 'chat_history_revision_positive_check'
  ) then
    alter table public.chat_history
      add constraint chat_history_revision_positive_check
      check (revision > 0) not valid;
  end if;
end;
$$;

alter table public.chat_history validate constraint chat_history_history_array_check;
alter table public.chat_history validate constraint chat_history_source_type_check;
alter table public.chat_history validate constraint chat_history_revision_positive_check;

do $$
begin
  if exists (
    select 1
    from public.chat_history
    group by user_id, news_key
    having count(*) > 1
  ) then
    raise exception 'LINGDAILY_CHAT_HISTORY_DUPLICATE_KEY'
      using hint = 'Merge duplicate user/news_key histories explicitly before migrating.';
  end if;
end
$$;

drop index if exists public.chat_history_user_news_key_idx;
create unique index chat_history_user_news_key_idx
  on public.chat_history (user_id, news_key);

create index if not exists chat_history_user_updated_id_idx
  on public.chat_history (user_id, updated_at desc, id desc);

create index if not exists chat_history_user_source_updated_id_idx
  on public.chat_history (user_id, source_type, updated_at desc, id desc);

do $$
begin
  if to_regclass('auth.users') is not null
    and not exists (
      select 1 from pg_constraint
      where conrelid = 'public.chat_history'::regclass
        and conname = 'chat_history_user_id_fkey'
    )
  then
    execute 'alter table public.chat_history
      add constraint chat_history_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade not valid';
  end if;
end;
$$;

create trigger chat_history_set_updated_at
  before update on public.chat_history
  for each row execute function public.set_updated_at();

alter table public.chat_history enable row level security;

drop policy if exists "Users can read their chat history" on public.chat_history;
create policy "Users can read their chat history"
  on public.chat_history for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their chat history" on public.chat_history;
create policy "Users can create their chat history"
  on public.chat_history for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their chat history" on public.chat_history;
create policy "Users can update their chat history"
  on public.chat_history for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their chat history" on public.chat_history;
create policy "Users can delete their chat history"
  on public.chat_history for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.chat_history from public, anon, authenticated;
grant select, insert, update, delete on public.chat_history to authenticated;
grant select, insert, update, delete on public.chat_history to service_role;

create or replace function public.save_chat_history(
  p_user_id uuid,
  p_news_key text,
  p_news_title text,
  p_news jsonb,
  p_history jsonb,
  p_summary text,
  p_source_type text,
  p_expected_revision integer default null
)
returns public.chat_history
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_record public.chat_history;
  saved_record public.chat_history;
  normalized_source_type text := coalesce(p_source_type, 'news');
begin
  if p_user_id is null then
    raise exception 'INVALID_CHAT_HISTORY_USER' using errcode = '22023';
  end if;
  if p_news_key is null or btrim(p_news_key) = '' then
    raise exception 'INVALID_CHAT_HISTORY_KEY' using errcode = '22023';
  end if;
  if p_history is null or jsonb_typeof(p_history) <> 'array' then
    raise exception 'INVALID_CHAT_HISTORY_PAYLOAD' using errcode = '22023';
  end if;
  if normalized_source_type not in ('news', 'scenario') then
    raise exception 'INVALID_CHAT_HISTORY_SOURCE' using errcode = '22023';
  end if;
  if p_expected_revision is not null and p_expected_revision < 0 then
    raise exception 'INVALID_CHAT_HISTORY_REVISION' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || chr(31) || p_news_key, 0)
  );

  select *
  into current_record
  from public.chat_history
  where user_id = p_user_id and news_key = p_news_key
  for update;

  if found then
    if p_expected_revision is not null and p_expected_revision <> current_record.revision then
      raise exception 'CHAT_HISTORY_REVISION_CONFLICT' using errcode = 'P0001';
    end if;

    update public.chat_history
    set news_title = p_news_title,
        news = p_news,
        history = p_history,
        summary = p_summary,
        source_type = normalized_source_type,
        revision = current_record.revision + 1
    where id = current_record.id and user_id = p_user_id
    returning * into saved_record;
  else
    if p_expected_revision is not null and p_expected_revision <> 0 then
      raise exception 'CHAT_HISTORY_REVISION_CONFLICT' using errcode = 'P0001';
    end if;

    insert into public.chat_history (
      user_id,
      news_key,
      news_title,
      news,
      history,
      summary,
      source_type,
      revision
    ) values (
      p_user_id,
      p_news_key,
      p_news_title,
      p_news,
      p_history,
      p_summary,
      normalized_source_type,
      1
    )
    returning * into saved_record;
  end if;

  return saved_record;
end;
$$;

revoke all on function public.save_chat_history(uuid, text, text, jsonb, jsonb, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.save_chat_history(uuid, text, text, jsonb, jsonb, text, text, integer)
  to service_role;

commit;
