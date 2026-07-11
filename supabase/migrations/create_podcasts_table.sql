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
  status text not null default 'in_progress'
    check (status in ('in_progress', 'script_generated', 'completed', 'failed')),
  error_message text,
  audio_bytes bigint,
  audio_duration_seconds numeric
);

create unique index if not exists podcasts_date_category_idx
  on public.podcasts (date_folder, category);
create index if not exists podcasts_status_date_idx
  on public.podcasts (status, date_folder desc);

drop trigger if exists podcasts_set_updated_at on public.podcasts;
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

grant select on public.podcasts to anon, authenticated;

drop function if exists public.claim_podcast_generation(text, boolean);

create or replace function public.claim_podcast_generation(
  p_date_folder text,
  p_force boolean,
  p_generation_id uuid
)
returns setof public.podcasts
language plpgsql
security definer
set search_path = public
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

revoke all on function public.claim_podcast_generation(text, boolean, uuid) from public;
grant execute on function public.claim_podcast_generation(text, boolean, uuid) to service_role;
