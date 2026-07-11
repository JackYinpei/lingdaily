begin;

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public.podcasts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  date_folder text not null,
  category text not null default 'daily',
  title text,
  summary text,
  script text,
  content jsonb,
  image_url text[],
  audio_url text,
  generation_id uuid not null default gen_random_uuid(),
  status text not null default 'in_progress',
  error_message text,
  audio_bytes bigint,
  audio_duration_seconds numeric
);

alter table public.podcasts
  add column if not exists content jsonb,
  add column if not exists image_url text[],
  add column if not exists audio_url text,
  add column if not exists updated_at timestamptz not null default now(),
  -- Add status as nullable first. Existing legacy episodes must be classified
  -- from audio_url before the default is installed below.
  add column if not exists status text,
  add column if not exists error_message text,
  add column if not exists audio_bytes bigint,
  add column if not exists audio_duration_seconds numeric,
  add column if not exists generation_id uuid;

drop trigger if exists podcasts_set_updated_at on public.podcasts;

update public.podcasts
set generation_id = gen_random_uuid()
where generation_id is null;

alter table public.podcasts
  alter column generation_id set default gen_random_uuid(),
  alter column generation_id set not null;

-- The first production layout used a scalar image URL. Preserve it as the
-- first array element instead of discarding it when converging on text[].
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'podcasts'
      and column_name = 'image_url'
      and udt_name = 'text'
  ) then
    alter table public.podcasts alter column image_url drop default;
    alter table public.podcasts
      alter column image_url type text[]
      using case
        when nullif(btrim(image_url), '') is null then null
        else array[image_url]
      end;
  end if;
end
$$;

-- The legacy table stored Beijing wall-clock values in timestamp columns
-- without a timezone. Interpret those existing values explicitly before the
-- lease logic compares them with now(), otherwise a fresh job can look stale
-- by eight hours on UTC-based deployments.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'podcasts'
      and column_name = 'created_at'
      and data_type = 'timestamp without time zone'
  ) then
    alter table public.podcasts alter column created_at drop default;
    alter table public.podcasts
      alter column created_at type timestamptz
      using created_at at time zone 'Asia/Shanghai';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'podcasts'
      and column_name = 'updated_at'
      and data_type = 'timestamp without time zone'
  ) then
    alter table public.podcasts alter column updated_at drop default;
    alter table public.podcasts
      alter column updated_at type timestamptz
      using updated_at at time zone 'Asia/Shanghai';
  end if;
end;
$$;

update public.podcasts
set created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, created_at, now())
where created_at is null or updated_at is null;

alter table public.podcasts
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.podcasts
  alter column title drop not null,
  alter column summary drop not null,
  alter column script drop not null,
  alter column audio_url drop not null,
  alter column category set default 'daily';

update public.podcasts
set status = case
  when nullif(btrim(audio_url), '') is not null then 'completed'
  else 'failed'
end
where status is null;

alter table public.podcasts
  alter column status set default 'in_progress',
  alter column status set not null;

do $$
begin
  if exists (
    select 1
    from public.podcasts
    where status not in ('in_progress', 'script_generated', 'completed', 'failed')
  ) then
    raise exception 'LINGDAILY_PODCAST_INVALID_STATUS'
      using hint = 'Map unsupported podcast status values explicitly before migrating.';
  end if;

  if exists (
    select 1
    from public.podcasts
    group by date_folder, category
    having count(*) > 1
  ) then
    raise exception 'LINGDAILY_PODCAST_DUPLICATE_DATE_CATEGORY'
      using hint = 'Merge duplicate podcast date/category rows explicitly before migrating.';
  end if;
end;
$$;

alter table public.podcasts
  drop constraint if exists podcasts_status_check;
alter table public.podcasts
  add constraint podcasts_status_check
  check (status in ('in_progress', 'script_generated', 'completed', 'failed')) not valid;
alter table public.podcasts validate constraint podcasts_status_check;

-- A historical schema used the same name for a non-unique index. Recreate it
-- so ON CONFLICT(date_folder, category) is guaranteed to have an arbiter.
drop index if exists public.podcasts_date_category_idx;
create unique index podcasts_date_category_idx
  on public.podcasts (date_folder, category);
create index if not exists podcasts_status_date_idx
  on public.podcasts (status, date_folder desc);

create trigger podcasts_set_updated_at
  before update on public.podcasts
  for each row execute function public.set_updated_at();

alter table public.podcasts enable row level security;
drop policy if exists "Allow public read access" on public.podcasts;
drop policy if exists "Public can read completed podcasts" on public.podcasts;
create policy "Public can read completed podcasts"
  on public.podcasts for select
  to anon, authenticated
  using (status = 'completed');
revoke all on public.podcasts from public, anon, authenticated;
grant select on public.podcasts to anon, authenticated;
grant select, insert, update on public.podcasts to service_role;

drop function if exists public.claim_podcast_generation(text, boolean);

create or replace function public.claim_podcast_generation(
  p_date_folder text,
  p_force boolean,
  p_generation_id uuid
)
returns setof public.podcasts
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
  insert into public.podcasts (
    date_folder,
    category,
    status,
    error_message,
    generation_id
  )
  values (p_date_folder, 'daily', 'in_progress', null, p_generation_id)
  on conflict (date_folder, category) do update
    set status = 'in_progress',
        error_message = null,
        generation_id = excluded.generation_id,
        updated_at = now()
    where public.podcasts.status = 'failed'
       or (public.podcasts.status = 'completed' and p_force)
       or (
         public.podcasts.status in ('in_progress', 'script_generated')
         and public.podcasts.updated_at < now() - interval '30 minutes'
       )
  returning public.podcasts.*;
end;
$$;

revoke all on function public.claim_podcast_generation(text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_podcast_generation(text, boolean, uuid) to service_role;

commit;
