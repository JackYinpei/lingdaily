-- Read-only preflight for the 2026-07-11 LingDaily production schema.
-- Run this in Supabase SQL Editor with "No limit" before applying migrations.
-- Do not migrate while any row reports BLOCKER.

with metrics as (
  select
    (select count(*) from public.user_preferences) as preference_rows,
    (
      select count(*)
      from public.user_preferences
      where learning_language_code not in ('en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
         or native_language_code not in ('zh-CN', 'en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
    ) as preference_invalid_languages,
    (
      select count(*)
      from public.user_preferences
      where learning_language_code = native_language_code
    ) as preference_identical_pairs,
    (
      select count(*)
      from public.user_preferences
      where btrim(learning_language_label) = ''
         or btrim(native_language_label) = ''
    ) as preference_blank_labels,
    (
      select count(*)
      from public.user_preferences preference
      where not exists (
        select 1 from auth.users auth_user
        where auth_user.id::text = preference.user_id
      )
    ) as preference_unmatched_auth_users,
    (select count(*) from public.unfamiliar_english) as learning_item_rows,
    (
      select count(*)
      from public.unfamiliar_english
      where items is null or jsonb_typeof(items) <> 'array'
    ) as learning_item_invalid_payloads,
    (
      select count(*)
      from public.unfamiliar_english item
      where not exists (
        select 1 from auth.users auth_user where auth_user.id = item.user_id
      )
    ) as learning_item_orphan_users,
    (select count(*) from public.podcasts) as podcast_rows,
    (
      select count(*)
      from (
        select date_folder, category
        from public.podcasts
        group by date_folder, category
        having count(*) > 1
      ) duplicate
    ) as podcast_duplicate_keys,
    (
      select count(*)
      from public.podcasts
      where status is not null
        and status not in ('in_progress', 'script_generated', 'completed', 'failed')
    ) as podcast_invalid_statuses,
    (
      select count(*)
      from public.podcasts
      where status = 'completed'
        and nullif(btrim(audio_url), '') is null
    ) as podcast_completed_without_audio,
    (
      select count(*)
      from public.podcasts
      where status <> 'completed'
        and nullif(btrim(audio_url), '') is not null
    ) as podcast_noncompleted_with_audio,
    (select count(*) from public.chat_history) as chat_rows,
    (
      select count(*)
      from public.chat_history
      where history is null or jsonb_typeof(history) <> 'array'
    ) as chat_invalid_payloads,
    (
      select count(*)
      from public.chat_history
      where source_type not in ('news', 'scenario')
    ) as chat_invalid_sources,
    (
      select count(*)
      from public.chat_history
      where news_key is null or btrim(news_key) = ''
    ) as chat_blank_keys,
    (
      select count(*)
      from (
        select user_id, news_key
        from public.chat_history
        group by user_id, news_key
        having count(*) > 1
      ) duplicate
    ) as chat_duplicate_keys,
    (
      select count(*)
      from public.chat_history history
      where not exists (
        select 1 from auth.users auth_user where auth_user.id = history.user_id
      )
    ) as chat_orphan_users,
    (select count(*) from public.scenario_categories) as scenario_category_rows,
    (select count(*) from public.scenarios) as scenario_rows,
    (
      select count(*)
      from (
        select category_slug, title_en
        from public.scenarios
        where user_id is null
        group by category_slug, title_en
        having count(*) > 1
      ) duplicate
    ) as duplicate_system_scenario_keys,
    (
      select count(*)
      from public.scenarios
      where user_id is null and not is_public
    ) as nonpublic_system_scenarios,
    (
      select count(*)
      from pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename in (
          'user_preferences', 'unfamiliar_english', 'podcasts',
          'chat_history', 'scenarios'
        )
        and not (
          (policy.tablename = 'unfamiliar_english' and policy.policyname in (
            'select own unfamiliar_english',
            'insert own unfamiliar_english',
            'Users can read their learning items',
            'Users can create their learning items'
          ))
          or (policy.tablename = 'podcasts' and policy.policyname in (
            'Allow public read access',
            'Public can read completed podcasts'
          ))
          or (policy.tablename = 'user_preferences' and policy.policyname in (
            'Users can read their preferences',
            'Users can create their preferences',
            'Users can update their preferences'
          ))
          or (policy.tablename = 'chat_history' and policy.policyname in (
            'Users can read their chat history',
            'Users can create their chat history',
            'Users can update their chat history',
            'Users can delete their chat history'
          ))
          or (policy.tablename = 'scenarios' and policy.policyname in (
            'Users can read available scenarios',
            'Users can create their scenarios',
            'Users can update their scenarios',
            'Users can delete their scenarios'
          ))
        )
    ) as unexpected_policies,
    (
      select count(*)
      from pg_index index_row
      join pg_class index_class on index_class.oid = index_row.indexrelid
      where index_class.relnamespace = 'public'::regnamespace
        and index_class.relname = 'podcasts_date_category_idx'
        and index_row.indisunique
        and index_row.indpred is null
        and pg_get_indexdef(index_row.indexrelid) like '%(date_folder, category)%'
    ) as podcast_unique_index_matches
)
select severity, check_name, observed, expected
from metrics
cross join lateral (
  values
    ('INFO', 'database_timezone', current_setting('TimeZone'), 'recorded for review'),
    ('INFO', 'migration_history_table', coalesce(to_regclass('supabase_migrations.schema_migrations')::text, 'absent'), 'absent before manual baseline'),
    ('INFO', 'user_preferences_rows', preference_rows::text, 'record only'),
    (case when preference_invalid_languages = 0 then 'PASS' else 'BLOCKER' end, 'user_preferences_invalid_languages', preference_invalid_languages::text, '0'),
    (case when preference_identical_pairs = 0 then 'PASS' else 'BLOCKER' end, 'user_preferences_identical_pairs', preference_identical_pairs::text, '0'),
    (case when preference_blank_labels = 0 then 'PASS' else 'BLOCKER' end, 'user_preferences_blank_labels', preference_blank_labels::text, '0'),
    (case when preference_unmatched_auth_users = 0 then 'PASS' else 'REVIEW' end, 'user_preferences_unmatched_auth_users', preference_unmatched_auth_users::text, 'review text OAuth owners'),
    ('INFO', 'unfamiliar_english_rows', learning_item_rows::text, 'record only'),
    (case when learning_item_invalid_payloads = 0 then 'PASS' else 'BLOCKER' end, 'unfamiliar_english_invalid_items', learning_item_invalid_payloads::text, '0'),
    (case when learning_item_orphan_users = 0 then 'PASS' else 'REVIEW' end, 'unfamiliar_english_orphan_users', learning_item_orphan_users::text, 'review before FK validation'),
    ('INFO', 'podcast_rows', podcast_rows::text, 'record only'),
    (case when podcast_duplicate_keys = 0 then 'PASS' else 'BLOCKER' end, 'podcast_duplicate_date_category', podcast_duplicate_keys::text, '0'),
    (case when podcast_invalid_statuses = 0 then 'PASS' else 'BLOCKER' end, 'podcast_invalid_statuses', podcast_invalid_statuses::text, '0'),
    (case when podcast_completed_without_audio = 0 then 'PASS' else 'BLOCKER' end, 'podcast_completed_without_audio', podcast_completed_without_audio::text, '0'),
    (case when podcast_noncompleted_with_audio = 0 then 'PASS' else 'REVIEW' end, 'podcast_noncompleted_with_audio', podcast_noncompleted_with_audio::text, 'review status intent'),
    (case when podcast_unique_index_matches = 1 then 'PASS' else 'BLOCKER' end, 'podcast_unique_index_definition', podcast_unique_index_matches::text, '1'),
    ('INFO', 'chat_history_rows', chat_rows::text, 'record only'),
    (case when chat_invalid_payloads = 0 then 'PASS' else 'BLOCKER' end, 'chat_history_invalid_payloads', chat_invalid_payloads::text, '0'),
    (case when chat_invalid_sources = 0 then 'PASS' else 'BLOCKER' end, 'chat_history_invalid_sources', chat_invalid_sources::text, '0'),
    (case when chat_blank_keys = 0 then 'PASS' else 'BLOCKER' end, 'chat_history_blank_keys', chat_blank_keys::text, '0'),
    (case when chat_duplicate_keys = 0 then 'PASS' else 'BLOCKER' end, 'chat_history_duplicate_keys', chat_duplicate_keys::text, '0'),
    (case when chat_orphan_users = 0 then 'PASS' else 'REVIEW' end, 'chat_history_orphan_users', chat_orphan_users::text, 'review before FK validation'),
    ('INFO', 'scenario_category_rows', scenario_category_rows::text, 'record before and after'),
    ('INFO', 'scenario_rows', scenario_rows::text, 'record before and after'),
    (case when duplicate_system_scenario_keys = 0 then 'PASS' else 'BLOCKER' end, 'duplicate_system_scenario_keys', duplicate_system_scenario_keys::text, '0'),
    (case when nonpublic_system_scenarios = 0 then 'PASS' else 'REVIEW' end, 'nonpublic_system_scenarios', nonpublic_system_scenarios::text, 'preserved; review intent'),
    (case when unexpected_policies = 0 then 'PASS' else 'BLOCKER' end, 'unexpected_policies', unexpected_policies::text, '0')
) result(severity, check_name, observed, expected)
order by
  case severity
    when 'BLOCKER' then 1
    when 'REVIEW' then 2
    when 'PASS' then 3
    else 4
  end,
  check_name;
