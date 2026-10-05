-- Token usage of AI calls made for the native iOS app, one row per model call
-- (text features) or per Live connection (reported by the app at hang-up).
-- Written only by the server (service_role); a signed-in user may read their own rows.
-- Re-runnable; creates new objects only.
begin;

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'ios',
  feature text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  thinking_tokens integer not null default 0,
  input_audio_tokens integer not null default 0,
  output_audio_tokens integer not null default 0,
  total_tokens integer not null default 0,
  -- Idempotency key for client-reported Live usage; null for server-recorded calls.
  report_id uuid,
  created_at timestamptz not null default now(),
  constraint ai_usage_source_check check (source in ('ios')),
  constraint ai_usage_feature_check check (feature in ('practice', 'scenario', 'ideas', 'translate', 'suggest', 'live')),
  constraint ai_usage_model_check check (char_length(model) between 1 and 100),
  constraint ai_usage_counts_check check (
    input_tokens >= 0 and output_tokens >= 0 and thinking_tokens >= 0
    and input_audio_tokens between 0 and input_tokens and output_audio_tokens between 0 and output_tokens
    and total_tokens >= 0
  )
);

create index if not exists ai_usage_user_created_idx on public.ai_usage (user_id, created_at desc);
create index if not exists ai_usage_created_idx on public.ai_usage (created_at desc);
-- Plain (not partial) so PostgREST on_conflict can target it; NULL report_ids never collide.
create unique index if not exists ai_usage_report_uidx on public.ai_usage (user_id, report_id);

alter table public.ai_usage enable row level security;

drop policy if exists "Users can read their AI usage" on public.ai_usage;
create policy "Users can read their AI usage"
  on public.ai_usage for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.ai_usage from public, anon, authenticated;
grant select on public.ai_usage to authenticated;
grant select, insert, delete on public.ai_usage to service_role;

-- Aggregates for the admin dashboard (p_user_id null) and a learner's own view.
create or replace function public.ai_usage_summary(p_since timestamptz, p_user_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with scoped as (
    select * from public.ai_usage
    where created_at >= p_since and (p_user_id is null or user_id = p_user_id)
  ),
  grouped as (
    select
      (created_at at time zone 'Asia/Shanghai')::date::text as day, feature, model, user_id,
      count(*) as calls, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
      sum(thinking_tokens) as thinking_tokens, sum(input_audio_tokens) as input_audio_tokens,
      sum(output_audio_tokens) as output_audio_tokens, sum(total_tokens) as total_tokens
    from scoped
    group by 1, 2, 3, 4
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(grouped) order by day desc, total_tokens desc) from grouped), '[]'::jsonb)
  )
$$;

revoke all on function public.ai_usage_summary(timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.ai_usage_summary(timestamptz, uuid) to service_role;

commit;
