create table public.chat_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  news_key text not null,
  news_title text,
  news jsonb,
  history jsonb not null,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source_type text not null default 'news'
);

create unique index chat_history_user_news_key_idx
  on public.chat_history (user_id, news_key);

insert into public.chat_history (
  id, user_id, news_key, history
) values (
  '81000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'news:invalid-history',
  '{"must":"not be erased"}'::jsonb
);
