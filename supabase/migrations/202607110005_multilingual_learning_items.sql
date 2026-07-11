-- Add language identity to the historical unfamiliar_english event store. The
-- table name remains unchanged so deployed clients and saved data stay intact.
begin;

alter table public.unfamiliar_english
  add column if not exists learning_language_code text,
  add column if not exists learning_language_label text,
  add column if not exists native_language_code text,
  add column if not exists native_language_label text;

-- NULL values come from the historical table that had no language columns and
-- therefore have an unambiguous default. Never overwrite non-NULL user choices.
update public.unfamiliar_english
set
  learning_language_code = coalesce(learning_language_code, 'en'),
  native_language_code = coalesce(native_language_code, 'zh-CN')
where learning_language_code is null
   or native_language_code is null;

do $$
begin
  if exists (
    select 1
    from public.unfamiliar_english
    where learning_language_code not in ('en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
       or native_language_code not in ('zh-CN', 'en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
  ) then
    raise exception 'LINGDAILY_LEARNING_ITEMS_UNSUPPORTED_LANGUAGE'
      using hint = 'Map unsupported learning-item language codes explicitly before migrating.';
  end if;

  if exists (
    select 1
    from public.unfamiliar_english
    where learning_language_code = native_language_code
  ) then
    raise exception 'LINGDAILY_LEARNING_ITEMS_IDENTICAL_LANGUAGE_PAIR'
      using hint = 'Repair identical native and learning language pairs before migrating.';
  end if;
end
$$;

update public.unfamiliar_english
set
  learning_language_label = case
    when learning_language_label is null or btrim(learning_language_label) = '' then
      case learning_language_code
        when 'en' then 'English'
        when 'ja' then '日本語'
        when 'es' then 'Español'
        when 'fr' then 'Français'
        when 'de' then 'Deutsch'
        when 'ko' then '한국어'
        when 'pt' then 'Português'
        when 'it' then 'Italiano'
      end
    else learning_language_label
  end,
  native_language_label = case
    when native_language_label is null or btrim(native_language_label) = '' then
      case native_language_code
        when 'zh-CN' then '中文'
        when 'en' then 'English'
        when 'ja' then '日本語'
        when 'es' then 'Español'
        when 'fr' then 'Français'
        when 'de' then 'Deutsch'
        when 'ko' then '한국어'
        when 'pt' then 'Português'
        when 'it' then 'Italiano'
      end
    else native_language_label
  end
where learning_language_label is null
   or btrim(learning_language_label) = ''
   or native_language_label is null
   or btrim(native_language_label) = '';

alter table public.unfamiliar_english
  alter column learning_language_code set default 'en',
  alter column learning_language_code set not null,
  alter column learning_language_label set default 'English',
  alter column learning_language_label set not null,
  alter column native_language_code set default 'zh-CN',
  alter column native_language_code set not null,
  alter column native_language_label set default '中文',
  alter column native_language_label set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'unfamiliar_english_learning_language_check'
      and conrelid = 'public.unfamiliar_english'::regclass
  ) then
    alter table public.unfamiliar_english
      add constraint unfamiliar_english_learning_language_check check (
        learning_language_code in ('en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'unfamiliar_english_native_language_check'
      and conrelid = 'public.unfamiliar_english'::regclass
  ) then
    alter table public.unfamiliar_english
      add constraint unfamiliar_english_native_language_check check (
        native_language_code in ('zh-CN', 'en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'unfamiliar_english_language_labels_check'
      and conrelid = 'public.unfamiliar_english'::regclass
  ) then
    alter table public.unfamiliar_english
      add constraint unfamiliar_english_language_labels_check check (
        btrim(learning_language_label) <> '' and btrim(native_language_label) <> ''
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'unfamiliar_english_language_pair_check'
      and conrelid = 'public.unfamiliar_english'::regclass
  ) then
    alter table public.unfamiliar_english
      add constraint unfamiliar_english_language_pair_check check (
        learning_language_code <> native_language_code
      );
  end if;
end
$$;

do $$
begin
  -- Migration 001 normally creates preferences first; keep this upgrade safe
  -- for installations that only used the historical vocabulary table.
  if to_regclass('public.user_preferences') is not null then
    if exists (
      select 1
      from public.user_preferences
      where learning_language_code is null
         or learning_language_code not in ('en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
         or native_language_code is null
         or native_language_code not in ('zh-CN', 'en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
    ) then
      raise exception 'LINGDAILY_PREFS_UNSUPPORTED_LANGUAGE'
        using hint = 'Map unsupported preference language codes explicitly before migrating.';
    end if;

    if exists (
      select 1
      from public.user_preferences
      where learning_language_code = native_language_code
    ) then
      raise exception 'LINGDAILY_PREFS_IDENTICAL_LANGUAGE_PAIR'
        using hint = 'Choose distinct native and learning languages before migrating.';
    end if;

    if not exists (
      select 1 from pg_constraint
      where conname = 'user_preferences_learning_language_check'
        and conrelid = 'public.user_preferences'::regclass
    ) then
      alter table public.user_preferences
        add constraint user_preferences_learning_language_check check (
          learning_language_code in ('en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
        );
    end if;

    if not exists (
      select 1 from pg_constraint
      where conname = 'user_preferences_native_language_check'
        and conrelid = 'public.user_preferences'::regclass
    ) then
      alter table public.user_preferences
        add constraint user_preferences_native_language_check check (
          native_language_code in ('zh-CN', 'en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
        );
    end if;

    if not exists (
      select 1 from pg_constraint
      where conname = 'user_preferences_language_pair_check'
        and conrelid = 'public.user_preferences'::regclass
    ) then
      alter table public.user_preferences
        add constraint user_preferences_language_pair_check check (
          learning_language_code <> native_language_code
        );
    end if;
  end if;
end
$$;

create index if not exists unfamiliar_english_user_language_timestamp_idx
  on public.unfamiliar_english (
    user_id,
    learning_language_code,
    timestamp desc,
    id desc
  );

alter table public.unfamiliar_english enable row level security;

drop policy if exists "select own unfamiliar_english" on public.unfamiliar_english;
drop policy if exists "insert own unfamiliar_english" on public.unfamiliar_english;
drop policy if exists "Users can read their learning items" on public.unfamiliar_english;
create policy "Users can read their learning items"
  on public.unfamiliar_english for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their learning items" on public.unfamiliar_english;
create policy "Users can create their learning items"
  on public.unfamiliar_english for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

revoke all on public.unfamiliar_english from public, anon, authenticated;
grant select, insert on public.unfamiliar_english to authenticated;
grant select, insert on public.unfamiliar_english to service_role;

commit;
