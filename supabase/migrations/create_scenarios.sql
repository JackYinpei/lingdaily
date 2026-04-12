-- Scenario categories (e.g. 留学面试, 当外语导游, 名人演讲)
create table if not exists public.scenario_categories (
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

create trigger scenario_categories_set_updated_at
  before update on public.scenario_categories
  for each row execute function public.set_updated_at();

-- Individual scenario cards
create table if not exists public.scenarios (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.scenario_categories(id) on delete cascade,
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scenarios_category_idx
  on public.scenarios (category_id);

create trigger scenarios_set_updated_at
  before update on public.scenarios
  for each row execute function public.set_updated_at();

-- Distinguish news vs scenario conversations in existing chat_history
alter table public.chat_history
  add column if not exists source_type text not null default 'news';
