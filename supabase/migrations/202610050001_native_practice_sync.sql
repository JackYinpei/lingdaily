-- Native iOS cloud sync uses the existing per-user tables instead of a parallel store:
--   * rehearsals  -> chat_history, source_type 'practice', news_key 'practice:<session uuid>'
--   * vocabulary  -> unfamiliar_english (unchanged schema)
--   * own scenarios -> scenarios (private user rows) with an optional structured practice_plan
-- Re-runnable; only widens constraints and adds one nullable column.
begin;

do $$
begin
  if exists (
    select 1 from public.chat_history
    where source_type not in ('news', 'scenario', 'practice')
  ) then
    raise exception 'chat_history contains unknown source_type values; refusing to widen the check';
  end if;
  if exists (
    select 1 from public.chat_history
    where news_key like 'practice:%' and source_type <> 'practice'
  ) then
    raise exception 'chat_history contains practice:* keys outside the practice source';
  end if;
end
$$;

alter table public.chat_history drop constraint if exists chat_history_source_type_check;
alter table public.chat_history
  add constraint chat_history_source_type_check
  check (source_type in ('news', 'scenario', 'practice'));

alter table public.chat_history drop constraint if exists chat_history_practice_key_check;
alter table public.chat_history
  add constraint chat_history_practice_key_check
  check (
    (source_type = 'practice')
    = (news_key ~ '^practice:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  );

create or replace function public.save_chat_history(
  p_user_id uuid,
  p_news_key text,
  p_news_title text,
  p_news jsonb,
  p_history jsonb,
  p_summary text,
  p_source_type text,
  p_expected_revision integer default null
)
returns public.chat_history
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_record public.chat_history;
  saved_record public.chat_history;
  normalized_source_type text := coalesce(p_source_type, 'news');
begin
  if p_user_id is null then
    raise exception 'INVALID_CHAT_HISTORY_USER' using errcode = '22023';
  end if;
  if p_news_key is null or btrim(p_news_key) = '' then
    raise exception 'INVALID_CHAT_HISTORY_KEY' using errcode = '22023';
  end if;
  if p_history is null or jsonb_typeof(p_history) <> 'array' then
    raise exception 'INVALID_CHAT_HISTORY_PAYLOAD' using errcode = '22023';
  end if;
  if normalized_source_type not in ('news', 'scenario', 'practice') then
    raise exception 'INVALID_CHAT_HISTORY_SOURCE' using errcode = '22023';
  end if;
  if p_expected_revision is not null and p_expected_revision < 0 then
    raise exception 'INVALID_CHAT_HISTORY_REVISION' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || chr(31) || p_news_key, 0)
  );

  select *
  into current_record
  from public.chat_history
  where user_id = p_user_id and news_key = p_news_key
  for update;

  if found then
    if p_expected_revision is not null and p_expected_revision <> current_record.revision then
      raise exception 'CHAT_HISTORY_REVISION_CONFLICT' using errcode = 'P0001';
    end if;

    update public.chat_history
    set news_title = p_news_title,
        news = p_news,
        history = p_history,
        summary = p_summary,
        source_type = normalized_source_type,
        revision = current_record.revision + 1
    where id = current_record.id and user_id = p_user_id
    returning * into saved_record;
  else
    if p_expected_revision is not null and p_expected_revision <> 0 then
      raise exception 'CHAT_HISTORY_REVISION_CONFLICT' using errcode = 'P0001';
    end if;

    insert into public.chat_history (
      user_id,
      news_key,
      news_title,
      news,
      history,
      summary,
      source_type,
      revision
    ) values (
      p_user_id,
      p_news_key,
      p_news_title,
      p_news,
      p_history,
      p_summary,
      normalized_source_type,
      1
    )
    returning * into saved_record;
  end if;

  return saved_record;
end;
$$;

revoke all on function public.save_chat_history(uuid, text, text, jsonb, jsonb, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.save_chat_history(uuid, text, text, jsonb, jsonb, text, text, integer)
  to service_role;

-- Structured three-step rehearsal plan for scenarios a learner created in the app.
-- Only private user rows may carry one; web clients ignore it.
alter table public.scenarios add column if not exists practice_plan jsonb;
alter table public.scenarios drop constraint if exists scenarios_practice_plan_check;
alter table public.scenarios
  add constraint scenarios_practice_plan_check
  check (practice_plan is null or (jsonb_typeof(practice_plan) = 'object' and user_id is not null));

commit;
