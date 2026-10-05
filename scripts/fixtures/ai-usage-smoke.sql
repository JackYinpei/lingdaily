-- Two calls for the same day/feature/model/user aggregate into one summary row.
insert into public.ai_usage (user_id, feature, model, input_tokens, output_tokens, total_tokens)
values ('00000000-0000-0000-0000-000000000001', 'suggest', 'gemini-3.1-flash-lite', 100, 50, 150),
       ('00000000-0000-0000-0000-000000000001', 'suggest', 'gemini-3.1-flash-lite', 100, 50, 150);
