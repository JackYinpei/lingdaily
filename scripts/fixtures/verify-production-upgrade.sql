-- Assertions for the synthetic 2026-07-11 production-shape upgrade.

do $$
declare
  policy_count integer;
  foreign_key_count integer;
begin
  if (select count(*) from public.user_preferences) <> 2 then
    raise exception 'production fixture preference rows changed';
  end if;
  if (
    select data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_preferences'
      and column_name = 'user_id'
  ) <> 'text' then
    raise exception 'production text preference owner was coerced';
  end if;
  if not exists (
    select 1
    from public.user_preferences
    where user_id = '00000000-0000-0000-0000-000000000001'
      and native_language_label = '中文（自定义）'
      and learning_language_label = 'English (custom)'
      and updated_at = '2026-07-02 01:00:00+00'::timestamptz
  ) then
    raise exception 'production preference values were overwritten';
  end if;
  if not exists (
    select 1 from public.user_preferences where user_id = 'linuxdo-user-1001'
  ) then
    raise exception 'non-UUID OAuth preference owner was lost';
  end if;

  if (select count(*) from public.unfamiliar_english) <> 1 then
    raise exception 'production learning item rows changed';
  end if;
  if not exists (
    select 1
    from public.unfamiliar_english
    where id = '40000000-0000-0000-0000-000000000001'
      and items = '[{"text":"legacy","type":"word"}]'::jsonb
      and created_at = timestamp
      and learning_language_code = 'en'
      and native_language_code = 'zh-CN'
  ) then
    raise exception 'production learning item was not preserved/backfilled';
  end if;
  select count(*) into policy_count
  from pg_policies
  where schemaname = 'public' and tablename = 'unfamiliar_english';
  if policy_count <> 2
    or exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'unfamiliar_english'
        and policyname in (
          'select own unfamiliar_english',
          'insert own unfamiliar_english'
        )
    )
  then
    raise exception 'legacy learning-item policies were not replaced exactly';
  end if;

  if (select count(*) from public.podcasts) <> 2 then
    raise exception 'production podcast rows changed';
  end if;
  if not exists (
    select 1
    from public.podcasts
    where id = '50000000-0000-0000-0000-000000000001'
      and created_at = '2026-07-10 00:00:00+00'::timestamptz
      and updated_at = '2026-07-10 00:30:00+00'::timestamptz
      and title = 'Completed production-shape episode'
      and script = 'Synthetic script'
      and content = '{"synthetic":true}'::jsonb
      and image_url = array['https://cdn.example.com/image.jpg']
      and audio_url = 'https://cdn.example.com/episode.mp3'
      and generation_id is not null
  ) then
    raise exception 'production podcast values/timezone were not preserved';
  end if;
  if not exists (
    select 1
    from pg_index index_row
    join pg_class index_class on index_class.oid = index_row.indexrelid
    where index_class.relnamespace = 'public'::regnamespace
      and index_class.relname = 'podcasts_date_category_idx'
      and index_row.indisunique
      and index_row.indpred is null
      and pg_get_indexdef(index_row.indexrelid) like '%(date_folder, category)%'
  ) then
    raise exception 'podcast unique index definition is not canonical';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'podcasts'
      and policyname = 'Allow public read access'
  ) then
    raise exception 'legacy podcast public policy remains';
  end if;

  if (select count(*) from public.chat_history) <> 2 then
    raise exception 'production chat rows changed before RPC verification';
  end if;
  if not exists (
    select 1
    from public.chat_history
    where id = '63000000-0000-0000-0000-000000000002'
      and history = '[{"itemId":"scenario-message","role":"assistant"}]'::jsonb
      and source_type = 'scenario'
      and revision = 1
      and updated_at = '2026-06-12 01:00:00+00'::timestamptz
  ) then
    raise exception 'production scenario chat was not preserved/classified';
  end if;

  if (select count(*) from public.scenario_categories) <> 5 then
    raise exception 'legacy scenario categories changed';
  end if;
  if (select count(*) from public.scenarios) <> 17 then
    raise exception 'production scenarios were lost or over-seeded';
  end if;
  if not exists (
    select 1
    from public.scenarios
    where id = '62000000-0000-0000-0000-000000000001'
      and system_prompt = 'PRODUCTION_PROMPT_SENTINEL'
      and description_en = 'Production description sentinel'
      and title_target = 'Ordering at a Restaurant'
      and target_language_code = 'en'
      and native_language_code = 'zh-CN'
      and updated_at = '2026-06-02 01:00:00+00'::timestamptz
  ) then
    raise exception 'existing production scenario content was overwritten';
  end if;
  if not exists (
    select 1
    from public.scenarios
    where id = '62000000-0000-0000-0000-000000000002'
      and user_id is null
      and is_public = false
      and updated_at = '2026-06-04 01:00:00+00'::timestamptz
  ) then
    raise exception 'null-owner scenario visibility/timestamp was rewritten';
  end if;
  select count(*) into foreign_key_count
  from pg_constraint constraint_row
  join pg_attribute column_row
    on column_row.attrelid = constraint_row.conrelid
   and column_row.attnum = any(constraint_row.conkey)
  where constraint_row.conrelid = 'public.scenarios'::regclass
    and constraint_row.contype = 'f'
    and column_row.attname = 'user_id';
  if foreign_key_count <> 1 then
    raise exception 'scenario user FK count drifted';
  end if;

  if not (
    select relrowsecurity from pg_class where oid = 'public.user_preferences'::regclass
  ) or not (
    select relrowsecurity from pg_class where oid = 'public.unfamiliar_english'::regclass
  ) or not (
    select relrowsecurity from pg_class where oid = 'public.podcasts'::regclass
  ) or not (
    select relrowsecurity from pg_class where oid = 'public.chat_history'::regclass
  ) or not (
    select relrowsecurity from pg_class where oid = 'public.scenarios'::regclass
  ) then
    raise exception 'canonical RLS was not enabled';
  end if;

  if exists (
    with acl_expectations(role_name, table_name, allowed_privileges) as (
      values
        ('anon', 'user_preferences', array[]::text[]),
        ('anon', 'unfamiliar_english', array[]::text[]),
        ('anon', 'podcasts', array['SELECT']),
        ('anon', 'chat_history', array[]::text[]),
        ('anon', 'scenarios', array['SELECT']),
        ('authenticated', 'user_preferences', array['SELECT', 'INSERT', 'UPDATE']),
        ('authenticated', 'unfamiliar_english', array['SELECT', 'INSERT']),
        ('authenticated', 'podcasts', array['SELECT']),
        ('authenticated', 'chat_history', array['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
        ('authenticated', 'scenarios', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
    )
    select 1
    from acl_expectations expectation
    cross join lateral unnest(
      array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    ) permission(privilege_name)
    where has_table_privilege(
      expectation.role_name,
      format('public.%I', expectation.table_name),
      permission.privilege_name
    ) <> (permission.privilege_name = any(expectation.allowed_privileges))
  ) then
    raise exception 'anon/authenticated table ACL did not converge exactly';
  end if;

  if has_function_privilege(
    'anon',
    'public.claim_podcast_generation(text,boolean,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.claim_podcast_generation(text,boolean,uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.claim_podcast_generation(text,boolean,uuid)',
    'EXECUTE'
  ) then
    raise exception 'podcast RPC ACL is not service-role-only';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.save_chat_history(uuid,text,text,jsonb,jsonb,text,text,integer)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.save_chat_history(uuid,text,text,jsonb,jsonb,text,text,integer)',
    'EXECUTE'
  ) then
    raise exception 'chat RPC ACL is not service-role-only';
  end if;
end
$$;

set role anon;
do $$
begin
  if (select count(*) from public.podcasts) <> 1 then
    raise exception 'anon can see non-completed podcasts';
  end if;
  if exists (
    select 1 from public.scenarios
    where id = '62000000-0000-0000-0000-000000000003'
  ) then
    raise exception 'anon can see private user scenarios';
  end if;
  if (
    select count(*) from public.scenarios
    where id in (
      '62000000-0000-0000-0000-000000000002',
      '62000000-0000-0000-0000-000000000004'
    )
  ) <> 2 then
    raise exception 'anon cannot see canonical system/public scenarios';
  end if;
end
$$;
reset role;

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  false
);
set role authenticated;
do $$
begin
  if not exists (
    select 1 from public.scenarios
    where id = '62000000-0000-0000-0000-000000000003'
  ) then
    raise exception 'scenario owner cannot see private scenario';
  end if;
  if (select count(*) from public.user_preferences) <> 1 then
    raise exception 'preference owner RLS is not isolated';
  end if;
  if (select count(*) from public.unfamiliar_english) <> 1 then
    raise exception 'learning-item owner RLS is not isolated';
  end if;
  if (select count(*) from public.chat_history) <> 2 then
    raise exception 'chat owner RLS is not isolated';
  end if;
end
$$;
reset role;

set role service_role;
do $$
declare
  claimed integer;
  saved_revision integer;
begin
  select count(*) into claimed
  from public.claim_podcast_generation(
    '2026-07-11',
    false,
    '71000000-0000-0000-0000-000000000001'
  );
  if claimed <> 1 then
    raise exception 'failed podcast was not claimable';
  end if;

  select count(*) into claimed
  from public.claim_podcast_generation(
    '2026-07-11',
    false,
    '71000000-0000-0000-0000-000000000002'
  );
  if claimed <> 0 then
    raise exception 'active podcast lease was claimed twice';
  end if;

  select count(*) into claimed
  from public.claim_podcast_generation(
    '2026-07-10',
    false,
    '71000000-0000-0000-0000-000000000003'
  );
  if claimed <> 0 then
    raise exception 'completed podcast was claimed without force';
  end if;

  select count(*) into claimed
  from public.claim_podcast_generation(
    '2026-07-10',
    true,
    '71000000-0000-0000-0000-000000000004'
  );
  if claimed <> 1 then
    raise exception 'completed podcast was not force-claimable';
  end if;

  select (public.save_chat_history(
    '00000000-0000-0000-0000-000000000001',
    'news:rpc-test',
    'RPC test',
    '{"id":"rpc-test"}'::jsonb,
    '[{"itemId":"rpc-one"}]'::jsonb,
    'RPC insert',
    'news',
    0
  )).revision into saved_revision;
  if saved_revision <> 1 then
    raise exception 'chat RPC insert revision mismatch';
  end if;

  select (public.save_chat_history(
    '00000000-0000-0000-0000-000000000001',
    'news:rpc-test',
    'RPC test updated',
    '{"id":"rpc-test"}'::jsonb,
    '[{"itemId":"rpc-two"}]'::jsonb,
    'RPC update',
    'news',
    1
  )).revision into saved_revision;
  if saved_revision <> 2 then
    raise exception 'chat RPC update revision mismatch';
  end if;

  begin
    perform public.save_chat_history(
      '00000000-0000-0000-0000-000000000001',
      'news:rpc-test',
      'Stale update',
      '{"id":"rpc-test"}'::jsonb,
      '[{"itemId":"rpc-stale"}]'::jsonb,
      'RPC stale update',
      'news',
      1
    );
    raise exception 'chat RPC accepted stale revision';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'CHAT_HISTORY_REVISION_CONFLICT' then
        raise;
      end if;
  end;
end
$$;
reset role;
