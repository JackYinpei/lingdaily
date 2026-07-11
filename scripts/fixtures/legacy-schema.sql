-- A compact representation of layouts that existed before the numbered
-- migration chain. It intentionally includes a text preference owner, missing
-- columns, a podcast without status, and the old scenario category table.

create table public.user_preferences (
  user_id text,
  native_language_code text,
  native_language_label text,
  learning_language_code text,
  learning_language_label text,
  updated_at timestamp without time zone
);

insert into public.user_preferences values (
  '00000000-0000-0000-0000-000000000001',
  'zh-CN',
  'Chinese Custom',
  'ja',
  'Japanese Custom',
  '2026-07-10 08:00:00'
);

create table public.unfamiliar_english (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  items jsonb not null default '[]'::jsonb,
  context text,
  user_message text,
  timestamp timestamptz not null default now(),
  created_at timestamptz not null default now()
);

insert into public.unfamiliar_english (user_id, items)
values (
  '00000000-0000-0000-0000-000000000001',
  '[{"text":"legacy","type":"word"}]'::jsonb
);

create table public.podcasts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp without time zone not null default timezone('Asia/Shanghai', now()),
  updated_at timestamp without time zone default timezone('Asia/Shanghai', now()),
  date_folder text not null,
  category text not null,
  title text not null,
  summary text not null,
  script text not null,
  image_url text,
  audio_url text not null
);

create index podcasts_date_category_idx
  on public.podcasts (date_folder, category);

insert into public.podcasts (
  date_folder,
  category,
  title,
  summary,
  script,
  image_url,
  audio_url
) values (
  '2026-07-10',
  'daily',
  'Legacy episode',
  'Legacy summary',
  'Legacy script',
  'https://cdn.example.com/podcasts/legacy.jpg',
  'https://cdn.example.com/podcasts/legacy.mp3'
);

create table public.chat_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  news_key text not null,
  news_title text,
  news jsonb,
  history jsonb not null,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index chat_history_user_news_key_idx
  on public.chat_history (user_id, news_key);

create table public.scenario_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_zh text not null,
  name_en text not null,
  name_ja text,
  icon text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.scenarios (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.scenario_categories(id) on delete cascade,
  title_zh text not null,
  title_en text not null,
  title_ja text,
  description_zh text,
  description_en text,
  description_ja text,
  target_language_code text default 'en',
  native_language_code text default 'zh-CN',
  difficulty text not null default 'intermediate'
    check (difficulty in ('beginner', 'intermediate', 'advanced')),
  system_prompt text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.scenario_categories (
  id,
  slug,
  name_zh,
  name_en,
  name_ja,
  icon,
  sort_order
) values (
  '10000000-0000-0000-0000-000000000001',
  'daily_life',
  '日常生活',
  'Daily Life',
  '日常生活',
  '🏠',
  5
);

insert into public.scenarios (
  id,
  category_id,
  title_zh,
  title_en,
  title_ja,
  description_zh,
  description_en,
  target_language_code,
  native_language_code,
  difficulty,
  system_prompt,
  sort_order,
  created_at
) values
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '在餐厅点餐',
    'Ordering at a Restaurant',
    'レストランでの注文',
    '旧版场景',
    'Legacy scenario',
    'en',
    'zh-CN',
    'beginner',
    'Legacy prompt one',
    1,
    '2026-07-09 08:00:00+00'
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    '在餐厅点餐',
    'Ordering at a Restaurant',
    'レストランでの注文',
    '日语学习场景',
    'Japanese target scenario',
    'ja',
    'en',
    'beginner',
    'Japanese target prompt',
    1,
    '2026-07-08 08:00:00+00'
  );

insert into public.chat_history (
  id,
  user_id,
  news_key,
  news_title,
  news,
  history,
  updated_at
) values
  (
    '30000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'scenario:20000000-0000-0000-0000-000000000001',
    'Older duplicate history',
    '{"id":"20000000-0000-0000-0000-000000000001","_isScenario":true,"_scenarioId":"20000000-0000-0000-0000-000000000001"}'::jsonb,
    '[{"itemId":"older-message","role":"user","content":[{"type":"input_text","text":"older transcript"}],"metadata":{"isFinal":true}}]'::jsonb,
    '2026-07-09 08:00:00+00'
  );
