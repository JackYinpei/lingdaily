create extension if not exists "pgcrypto";

create table if not exists public.unfamiliar_english (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  items jsonb not null default '[]'::jsonb
    constraint unfamiliar_english_items_array check (jsonb_typeof(items) = 'array'),
  context text,
  user_message text,
  timestamp timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists unfamiliar_english_user_timestamp_idx
  on public.unfamiliar_english (user_id, timestamp desc, id desc);

alter table public.unfamiliar_english enable row level security;

drop policy if exists "Users can read their learning items" on public.unfamiliar_english;
create policy "Users can read their learning items"
  on public.unfamiliar_english for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their learning items" on public.unfamiliar_english;
create policy "Users can create their learning items"
  on public.unfamiliar_english for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

revoke all on public.unfamiliar_english from anon;
grant select, insert on public.unfamiliar_english to authenticated;
