-- Single scenarios table (no separate categories table)
-- Category info is embedded directly in each row.
-- System scenarios: user_id IS NULL, is_public = true
-- User scenarios: user_id = <uuid>, is_public = true/false

create table if not exists public.scenarios (
  id uuid primary key default gen_random_uuid(),

  -- Category (embedded, no FK)
  category_slug text not null default 'other',
  category_name_zh text,
  category_name_en text,
  category_name_ja text,
  category_icon text,
  category_sort int not null default 0,

  -- Content
  title_zh text not null,
  title_en text not null,
  title_ja text,
  description_zh text,
  description_en text,
  description_ja text,
  difficulty text not null default 'intermediate'
    check (difficulty in ('beginner', 'intermediate', 'advanced')),
  system_prompt text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,

  -- Ownership: NULL = system/public, uuid = user-created
  user_id uuid references auth.users(id) on delete cascade,
  is_public boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scenarios_category_idx on public.scenarios (category_slug);
create index if not exists scenarios_user_idx on public.scenarios (user_id);

create trigger scenarios_set_updated_at
  before update on public.scenarios
  for each row execute function public.set_updated_at();

-- Distinguish news vs scenario conversations in existing chat_history
alter table public.chat_history
  add column if not exists source_type text not null default 'news';
