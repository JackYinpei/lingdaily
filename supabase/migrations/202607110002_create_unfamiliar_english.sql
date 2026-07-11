create extension if not exists "pgcrypto";

create table if not exists public.unfamiliar_english (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  items jsonb not null default '[]'::jsonb
    constraint unfamiliar_english_items_array check (jsonb_typeof(items) = 'array'),
  context text,
  user_message text,
  learning_language_code text not null default 'en',
  learning_language_label text not null default 'English',
  native_language_code text not null default 'zh-CN',
  native_language_label text not null default '中文',
  timestamp timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint unfamiliar_english_learning_language_check check (
    learning_language_code in ('en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
  ),
  constraint unfamiliar_english_native_language_check check (
    native_language_code in ('zh-CN', 'en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
  ),
  constraint unfamiliar_english_language_pair_check check (
    learning_language_code <> native_language_code
  ),
  constraint unfamiliar_english_language_labels_check check (
    btrim(learning_language_label) <> '' and btrim(native_language_label) <> ''
  )
);

-- Keep this bootstrap migration safe when the legacy table already exists.
alter table public.unfamiliar_english
  add column if not exists learning_language_code text not null default 'en',
  add column if not exists learning_language_label text not null default 'English',
  add column if not exists native_language_code text not null default 'zh-CN',
  add column if not exists native_language_label text not null default '中文';

create index if not exists unfamiliar_english_user_timestamp_idx
  on public.unfamiliar_english (user_id, timestamp desc, id desc);

create index if not exists unfamiliar_english_user_language_timestamp_idx
  on public.unfamiliar_english (
    user_id,
    learning_language_code,
    timestamp desc,
    id desc
  );

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
