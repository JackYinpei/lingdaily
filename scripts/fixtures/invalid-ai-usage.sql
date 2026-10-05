-- Must fail: the same Live report twice for one user.
insert into public.ai_usage (user_id, feature, model, report_id)
values ('00000000-0000-0000-0000-000000000001', 'live', 'm', '11111111-1111-4111-8111-111111111111'),
       ('00000000-0000-0000-0000-000000000001', 'live', 'm', '11111111-1111-4111-8111-111111111111');
