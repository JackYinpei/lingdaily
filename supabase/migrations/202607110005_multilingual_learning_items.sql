-- Add language identity to the historical unfamiliar_english event store. The
-- table name remains unchanged so deployed clients and saved data stay intact.
alter table public.unfamiliar_english
  add column if not exists learning_language_code text,
  add column if not exists learning_language_label text,
  add column if not exists native_language_code text,
  add column if not exists native_language_label text;

-- Normalize codes first, then derive canonical labels from the final code. This
-- also repairs partially applied upgrades such as `ja` paired with `English`.
update public.unfamiliar_english
set
  learning_language_code = case
    when learning_language_code in ('en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
      then learning_language_code
    else 'en'
  end,
  native_language_code = case
    when native_language_code in ('zh-CN', 'en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
      then native_language_code
    else 'zh-CN'
  end
where learning_language_code is null
   or native_language_code is null
   or learning_language_code not in ('en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
   or native_language_code not in ('zh-CN', 'en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it');

update public.unfamiliar_english
set native_language_code = 'zh-CN'
where learning_language_code = native_language_code;

update public.unfamiliar_english
set
  learning_language_label = case learning_language_code
    when 'en' then 'English'
    when 'ja' then '日本語'
    when 'es' then 'Español'
    when 'fr' then 'Français'
    when 'de' then 'Deutsch'
    when 'ko' then '한국어'
    when 'pt' then 'Português'
    when 'it' then 'Italiano'
  end,
  native_language_label = case native_language_code
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
where learning_language_label is distinct from case learning_language_code
    when 'en' then 'English'
    when 'ja' then '日本語'
    when 'es' then 'Español'
    when 'fr' then 'Français'
    when 'de' then 'Deutsch'
    when 'ko' then '한국어'
    when 'pt' then 'Português'
    when 'it' then 'Italiano'
  end
   or native_language_label is distinct from case native_language_code
    when 'zh-CN' then '中文'
    when 'en' then 'English'
    when 'ja' then '日本語'
    when 'es' then 'Español'
    when 'fr' then 'Français'
    when 'de' then 'Deutsch'
    when 'ko' then '한국어'
    when 'pt' then 'Português'
    when 'it' then 'Italiano'
  end;

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
    update public.user_preferences
    set
      learning_language_code = case
        when learning_language_code in ('en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
          then learning_language_code
        else 'en'
      end,
      native_language_code = case
        when native_language_code in ('zh-CN', 'en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
          then native_language_code
        else 'zh-CN'
      end
    where learning_language_code is null
       or learning_language_code not in ('en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it')
       or native_language_code is null
       or native_language_code not in ('zh-CN', 'en', 'ja', 'es', 'fr', 'de', 'ko', 'pt', 'it');

    update public.user_preferences
    set native_language_code = 'zh-CN'
    where learning_language_code = native_language_code;

    update public.user_preferences as preference
    set
      learning_language_label = learning.label,
      native_language_label = native.label
    from (
      values
        ('en', 'English'), ('ja', '日本語'), ('es', 'Español'),
        ('fr', 'Français'), ('de', 'Deutsch'), ('ko', '한국어'),
        ('pt', 'Português'), ('it', 'Italiano')
    ) as learning(code, label), (
      values
        ('zh-CN', '中文'), ('en', 'English'), ('ja', '日本語'),
        ('es', 'Español'), ('fr', 'Français'), ('de', 'Deutsch'),
        ('ko', '한국어'), ('pt', 'Português'), ('it', 'Italiano')
    ) as native(code, label)
    where preference.learning_language_code = learning.code
      and preference.native_language_code = native.code
      and (
        preference.learning_language_label is distinct from learning.label
        or preference.native_language_label is distinct from native.label
      );

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

revoke all on public.unfamiliar_english from anon;
grant select, insert on public.unfamiliar_english to authenticated;
