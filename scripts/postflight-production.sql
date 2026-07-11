-- Read-only verification after all seven LingDaily migrations have completed.
-- Run with "No limit" and require every non-INFO row to report PASS.

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
),
acl_mismatches as (
  select expectation.role_name, expectation.table_name, permission.privilege_name
  from acl_expectations expectation
  cross join lateral unnest(
    array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
  ) permission(privilege_name)
  where has_table_privilege(
    expectation.role_name,
    format('public.%I', expectation.table_name),
    permission.privilege_name
  ) <> (permission.privilege_name = any(expectation.allowed_privileges))
),
metrics as (
  select
    (
      select count(*)
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'user_preferences'
        and column_name = 'user_id'
        and data_type = 'text'
    ) as preference_text_owner,
    (
      select count(*)
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'unfamiliar_english'
        and column_name in (
          'created_at',
          'learning_language_code', 'learning_language_label',
          'native_language_code', 'native_language_label'
        )
    ) as learning_columns,
    (
      select count(*)
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'podcasts'
        and column_name in ('created_at', 'updated_at')
        and data_type = 'timestamp with time zone'
    ) as podcast_timestamptz_columns,
    (
      select count(*)
      from public.podcasts
      where generation_id is null
    ) as podcast_null_generation_ids,
    (
      select count(*)
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'chat_history'
        and column_name = 'revision'
        and data_type = 'integer'
        and is_nullable = 'NO'
    ) as chat_revision_column,
    (
      select count(*)
      from public.chat_history
      where revision < 1
        or history is null
        or jsonb_typeof(history) <> 'array'
    ) as invalid_chat_rows,
    (
      select count(*)
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'scenarios'
        and column_name in (
          'title_target', 'description_target',
          'target_language_code', 'native_language_code'
        )
    ) as scenario_language_columns,
    (
      select count(*)
      from public.scenarios
      where target_language_code is null
         or native_language_code is null
         or target_language_code = native_language_code
    ) as invalid_scenario_language_rows,
    (
      select count(*)
      from pg_class relation
      where relation.oid in (
        'public.user_preferences'::regclass,
        'public.unfamiliar_english'::regclass,
        'public.podcasts'::regclass,
        'public.chat_history'::regclass,
        'public.scenarios'::regclass
      )
        and relation.relrowsecurity
    ) as rls_enabled_tables,
    (
      select count(*)
      from pg_policies
      where schemaname = 'public'
        and (
          (tablename = 'user_preferences' and policyname in (
            'Users can read their preferences',
            'Users can create their preferences',
            'Users can update their preferences'
          ))
          or (tablename = 'unfamiliar_english' and policyname in (
            'Users can read their learning items',
            'Users can create their learning items'
          ))
          or (tablename = 'podcasts' and policyname = 'Public can read completed podcasts')
          or (tablename = 'chat_history' and policyname in (
            'Users can read their chat history',
            'Users can create their chat history',
            'Users can update their chat history',
            'Users can delete their chat history'
          ))
          or (tablename = 'scenarios' and policyname in (
            'Users can read available scenarios',
            'Users can create their scenarios',
            'Users can update their scenarios',
            'Users can delete their scenarios'
          ))
        )
    ) as canonical_policies,
    (
      select count(*)
      from pg_policies
      where schemaname = 'public'
        and tablename in (
          'user_preferences', 'unfamiliar_english', 'podcasts',
          'chat_history', 'scenarios'
        )
        and not (
          (tablename = 'user_preferences' and policyname in (
            'Users can read their preferences',
            'Users can create their preferences',
            'Users can update their preferences'
          ))
          or (tablename = 'unfamiliar_english' and policyname in (
            'Users can read their learning items',
            'Users can create their learning items'
          ))
          or (tablename = 'podcasts' and policyname = 'Public can read completed podcasts')
          or (tablename = 'chat_history' and policyname in (
            'Users can read their chat history',
            'Users can create their chat history',
            'Users can update their chat history',
            'Users can delete their chat history'
          ))
          or (tablename = 'scenarios' and policyname in (
            'Users can read available scenarios',
            'Users can create their scenarios',
            'Users can update their scenarios',
            'Users can delete their scenarios'
          ))
        )
    ) as unexpected_policies,
    (select count(*) from acl_mismatches) as table_acl_mismatches,
    (
      select count(*)
      from pg_proc function_row
      where function_row.oid in (
        to_regprocedure('public.claim_podcast_generation(text,boolean,uuid)'),
        to_regprocedure('public.save_chat_history(uuid,text,text,jsonb,jsonb,text,text,integer)')
      )
        and function_row.prosecdef
    ) as security_definer_rpcs,
    (
      select count(*)
      from pg_trigger trigger_row
      where not trigger_row.tgisinternal
        and trigger_row.tgname in (
          'user_preferences_set_updated_at',
          'podcasts_set_updated_at',
          'chat_history_set_updated_at',
          'scenarios_set_updated_at',
          'scenarios_set_language_defaults'
        )
    ) as canonical_triggers,
    (select count(*) from public.user_preferences) as preference_rows,
    (select count(*) from public.unfamiliar_english) as learning_item_rows,
    (select count(*) from public.podcasts) as podcast_rows,
    (select count(*) from public.chat_history) as chat_rows,
    (select count(*) from public.scenario_categories) as scenario_category_rows,
    (select count(*) from public.scenarios) as scenario_rows
)
select severity, check_name, observed, expected
from metrics
cross join lateral (
  values
    (case when preference_text_owner = 1 then 'PASS' else 'FAIL' end, 'preference_text_owner_preserved', preference_text_owner::text, '1'),
    (case when learning_columns = 5 then 'PASS' else 'FAIL' end, 'learning_columns', learning_columns::text, '5'),
    (case when podcast_timestamptz_columns = 2 then 'PASS' else 'FAIL' end, 'podcast_timestamptz_columns', podcast_timestamptz_columns::text, '2'),
    (case when podcast_null_generation_ids = 0 then 'PASS' else 'FAIL' end, 'podcast_null_generation_ids', podcast_null_generation_ids::text, '0'),
    (case when chat_revision_column = 1 then 'PASS' else 'FAIL' end, 'chat_revision_column', chat_revision_column::text, '1'),
    (case when invalid_chat_rows = 0 then 'PASS' else 'FAIL' end, 'invalid_chat_rows', invalid_chat_rows::text, '0'),
    (case when scenario_language_columns = 4 then 'PASS' else 'FAIL' end, 'scenario_language_columns', scenario_language_columns::text, '4'),
    (case when invalid_scenario_language_rows = 0 then 'PASS' else 'FAIL' end, 'invalid_scenario_language_rows', invalid_scenario_language_rows::text, '0'),
    (case when rls_enabled_tables = 5 then 'PASS' else 'FAIL' end, 'rls_enabled_tables', rls_enabled_tables::text, '5'),
    (case when canonical_policies = 14 then 'PASS' else 'FAIL' end, 'canonical_policies', canonical_policies::text, '14'),
    (case when unexpected_policies = 0 then 'PASS' else 'FAIL' end, 'unexpected_policies', unexpected_policies::text, '0'),
    (case when table_acl_mismatches = 0 then 'PASS' else 'FAIL' end, 'anon_authenticated_table_acl_mismatches', table_acl_mismatches::text, '0'),
    (case when security_definer_rpcs = 2 then 'PASS' else 'FAIL' end, 'security_definer_rpcs', security_definer_rpcs::text, '2'),
    (case when canonical_triggers = 5 then 'PASS' else 'FAIL' end, 'canonical_triggers', canonical_triggers::text, '5'),
    (case when not has_function_privilege('anon', 'public.claim_podcast_generation(text,boolean,uuid)', 'EXECUTE') then 'PASS' else 'FAIL' end, 'anon_cannot_claim_podcast', has_function_privilege('anon', 'public.claim_podcast_generation(text,boolean,uuid)', 'EXECUTE')::text, 'false'),
    (case when not has_function_privilege('authenticated', 'public.save_chat_history(uuid,text,text,jsonb,jsonb,text,text,integer)', 'EXECUTE') then 'PASS' else 'FAIL' end, 'authenticated_cannot_call_chat_rpc', has_function_privilege('authenticated', 'public.save_chat_history(uuid,text,text,jsonb,jsonb,text,text,integer)', 'EXECUTE')::text, 'false'),
    ('INFO', 'user_preferences_rows', preference_rows::text, 'compare with preflight'),
    ('INFO', 'unfamiliar_english_rows', learning_item_rows::text, 'compare with preflight'),
    ('INFO', 'podcast_rows', podcast_rows::text, 'compare with preflight'),
    ('INFO', 'chat_history_rows', chat_rows::text, 'compare with preflight'),
    ('INFO', 'scenario_category_rows', scenario_category_rows::text, 'compare with preflight'),
    ('INFO', 'scenario_rows', scenario_rows::text, 'preflight rows plus missing built-in seeds')
) result(severity, check_name, observed, expected)
order by
  case severity when 'FAIL' then 1 when 'PASS' then 2 else 3 end,
  check_name;
