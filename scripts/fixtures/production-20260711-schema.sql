-- Synthetic fixture matching the LingDaily production catalog captured on
-- 2026-07-11. It contains no production credentials or user content.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.user_preferences (
  user_id text primary key,
  native_language_code text not null default 'zh-CN',
  native_language_label text not null default '中文',
  learning_language_code text not null default 'en',
  learning_language_label text not null default 'English',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Simulate an old explicit role grant. Migrations must remove dangerous
-- privileges such as TRUNCATE/REFERENCES/TRIGGER, not merely rely on RLS.
grant all privileges on public.user_preferences to authenticated;

insert into public.user_preferences (
  user_id,
  native_language_code,
  native_language_label,
  learning_language_code,
  learning_language_label,
  created_at,
  updated_at
) values
  (
    '00000000-0000-0000-0000-000000000001',
    'zh-CN',
    '中文（自定义）',
    'en',
    'English (custom)',
    '2026-07-01 01:00:00+00',
    '2026-07-02 01:00:00+00'
  ),
  (
    'linuxdo-user-1001',
    'zh-CN',
    '中文',
    'en',
    'English',
    '2026-07-03 01:00:00+00',
    '2026-07-04 01:00:00+00'
  );

create table public.unfamiliar_english (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  items jsonb not null,
  context text,
  user_message text,
  timestamp timestamptz not null default now()
);

alter table public.unfamiliar_english enable row level security;

create policy "insert own unfamiliar_english"
  on public.unfamiliar_english for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "select own unfamiliar_english"
  on public.unfamiliar_english for select
  to authenticated
  using (auth.uid() = user_id);

grant all privileges on public.unfamiliar_english to authenticated;

insert into public.unfamiliar_english (
  id,
  user_id,
  items,
  context,
  user_message,
  timestamp
) values (
  '40000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '[{"text":"legacy","type":"word"}]'::jsonb,
  'synthetic context',
  'synthetic message',
  '2026-07-05 03:04:05+00'
);

create table public.podcasts (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp without time zone
    default timezone('Asia/Shanghai'::text, now()) not null,
  category text not null,
  title text not null,
  summary text not null,
  script text not null,
  content jsonb,
  image_url text[],
  audio_url text,
  date_folder text not null,
  updated_at timestamp without time zone
    default timezone('Asia/Shanghai'::text, now()),
  status text default 'in_progress'
    constraint podcasts_status_check check (
      status in ('in_progress', 'script_generated', 'completed', 'failed')
    ),
  error_message text,
  audio_bytes bigint,
  audio_duration_seconds numeric
);

create unique index podcasts_date_category_idx
  on public.podcasts (date_folder, category);

alter table public.podcasts enable row level security;

create policy "Allow public read access"
  on public.podcasts for select
  to public
  using (true);

grant select on public.podcasts to public;
grant all privileges on public.podcasts to authenticated;

insert into public.podcasts (
  id,
  created_at,
  category,
  title,
  summary,
  script,
  content,
  image_url,
  audio_url,
  date_folder,
  updated_at,
  status,
  audio_bytes,
  audio_duration_seconds
) values
  (
    '50000000-0000-0000-0000-000000000001',
    '2026-07-10 08:00:00',
    'daily',
    'Completed production-shape episode',
    'Synthetic summary',
    'Synthetic script',
    '{"synthetic":true}'::jsonb,
    array['https://cdn.example.com/image.jpg'],
    'https://cdn.example.com/episode.mp3',
    '2026-07-10',
    '2026-07-10 08:30:00',
    'completed',
    1234,
    42
  ),
  (
    '50000000-0000-0000-0000-000000000002',
    '2026-07-11 08:00:00',
    'daily',
    'Failed production-shape episode',
    'Synthetic failed summary',
    'Synthetic failed script',
    null,
    null,
    null,
    '2026-07-11',
    '2026-07-11 08:30:00',
    'failed',
    null,
    null
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
  updated_at timestamptz not null default now(),
  source_type text not null default 'news'
);

create unique index chat_history_user_news_key_idx
  on public.chat_history (user_id, news_key);
create index chat_history_user_created_idx
  on public.chat_history (user_id, created_at desc);

create trigger chat_history_set_updated_at
  before update on public.chat_history
  for each row execute function public.set_updated_at();

-- Deliberately broad legacy grants: the migration must converge them to the
-- canonical owner-only ACL before enabling RLS.
grant select, insert, update, delete on public.chat_history to public;
grant all privileges on public.chat_history to authenticated;

create table public.scenario_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_zh text not null,
  name_en text not null,
  name_ja text,
  icon text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger scenario_categories_set_updated_at
  before update on public.scenario_categories
  for each row execute function public.set_updated_at();

insert into public.scenario_categories (
  id, slug, name_zh, name_en, name_ja, icon, sort_order
) values
  ('61000000-0000-0000-0000-000000000001', 'study_abroad_interview', '留学面试', 'Study Abroad Interview', '留学面接', '🎓', 1),
  ('61000000-0000-0000-0000-000000000002', 'tour_guide', '当外语导游', 'Tour Guide', '外国語ガイド', '🗺️', 2),
  ('61000000-0000-0000-0000-000000000003', 'celebrity_speech', '名人演讲', 'Celebrity Speech', '著名人スピーチ', '🎤', 3),
  ('61000000-0000-0000-0000-000000000004', 'job_interview', '求职面试', 'Job Interview', '就職面接', '💼', 4),
  ('61000000-0000-0000-0000-000000000005', 'daily_life', '日常生活', 'Daily Life', '日常生活', '🏠', 5);

create table public.scenarios (
  id uuid primary key default gen_random_uuid(),
  category_slug text not null default 'other',
  category_name_zh text,
  category_name_en text,
  category_name_ja text,
  category_icon text,
  category_sort integer not null default 0,
  title_zh text not null,
  title_en text not null,
  title_ja text,
  description_zh text,
  description_en text,
  description_ja text,
  difficulty text not null default 'intermediate'
    constraint scenarios_difficulty_check check (
      difficulty in ('beginner', 'intermediate', 'advanced')
    ),
  system_prompt text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  user_id uuid references auth.users(id) on delete cascade,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scenarios_category_idx on public.scenarios (category_slug);
create index scenarios_user_idx on public.scenarios (user_id);

create trigger scenarios_set_updated_at
  before update on public.scenarios
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.scenarios to public;
grant all privileges on public.scenarios to authenticated;

insert into public.scenarios (
  id,
  category_slug,
  category_name_zh,
  category_name_en,
  category_name_ja,
  category_icon,
  category_sort,
  title_zh,
  title_en,
  title_ja,
  description_zh,
  description_en,
  difficulty,
  system_prompt,
  sort_order,
  is_active,
  user_id,
  is_public,
  created_at,
  updated_at
) values
  (
    '62000000-0000-0000-0000-000000000001',
    'daily_life', '日常生活', 'Daily Life', '日常生活', '🏠', 5,
    '在餐厅点餐', 'Ordering at a Restaurant', 'レストランでの注文',
    '生产库保留的描述', 'Production description sentinel',
    'beginner', 'PRODUCTION_PROMPT_SENTINEL', 1, true, null, true,
    '2026-06-01 01:00:00+00', '2026-06-02 01:00:00+00'
  ),
  (
    '62000000-0000-0000-0000-000000000002',
    'other', '其他', 'Other', null, '🧪', 99,
    '隐藏系统场景', 'Hidden System Sentinel', null,
    '不应改写可见性', 'Visibility must be preserved',
    'intermediate', 'HIDDEN_SYSTEM_PROMPT', 99, true, null, false,
    '2026-06-03 01:00:00+00', '2026-06-04 01:00:00+00'
  ),
  (
    '62000000-0000-0000-0000-000000000003',
    'other', '其他', 'Other', null, '🔒', 99,
    '私有用户场景', 'Private User Sentinel', null,
    '仅所有者可见', 'Owner only',
    'intermediate', 'PRIVATE_USER_PROMPT', 100, true,
    '00000000-0000-0000-0000-000000000001', false,
    '2026-06-05 01:00:00+00', '2026-06-06 01:00:00+00'
  ),
  (
    '62000000-0000-0000-0000-000000000004',
    'other', '其他', 'Other', null, '🌍', 99,
    '公开用户场景', 'Public User Sentinel', null,
    '任何人可见', 'Public user scenario',
    'intermediate', 'PUBLIC_USER_PROMPT', 101, true,
    '00000000-0000-0000-0000-000000000001', true,
    '2026-06-07 01:00:00+00', '2026-06-08 01:00:00+00'
  );

insert into public.chat_history (
  id,
  user_id,
  news_key,
  news_title,
  news,
  history,
  summary,
  created_at,
  updated_at,
  source_type
) values
  (
    '63000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'news:synthetic',
    'Synthetic news',
    '{"id":"news:synthetic"}'::jsonb,
    '[{"itemId":"news-message","role":"user"}]'::jsonb,
    'Synthetic news history',
    '2026-06-09 01:00:00+00',
    '2026-06-10 01:00:00+00',
    'news'
  ),
  (
    '63000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'scenario:62000000-0000-0000-0000-000000000001',
    'Synthetic scenario',
    '{"id":"62000000-0000-0000-0000-000000000001"}'::jsonb,
    '[{"itemId":"scenario-message","role":"assistant"}]'::jsonb,
    'Synthetic scenario history',
    '2026-06-11 01:00:00+00',
    '2026-06-12 01:00:00+00',
    'news'
  );
