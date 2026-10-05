-- Must fail: the practice source requires a `practice:<uuid>` identity.
insert into public.chat_history (user_id, news_key, news_title, news, history, source_type)
values ('00000000-0000-0000-0000-000000000001', 'scenario:not-a-practice', 'Bad', '{}'::jsonb, '[]'::jsonb, 'practice');
