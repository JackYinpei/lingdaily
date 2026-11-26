-- Per-user encrypted BYOK AI configuration (Google Gemini & OpenAI API keys,
-- optional custom base URLs, and chosen text/voice model IDs) synced across
-- native iOS and Android devices via /api/ios/sync.
-- Plaintext keys never enter Postgres: encrypted_config holds AES-256-GCM
-- ciphertext sealed by the server with a per-user HKDF key. Only service_role
-- may access this table.
begin;

create table if not exists public.user_ai_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_config text not null,
  updated_at timestamptz not null default now(),
  constraint user_ai_settings_config_check check (char_length(encrypted_config) between 16 and 16384)
);

alter table public.user_ai_settings enable row level security;

revoke all on public.user_ai_settings from public, anon, authenticated;
grant select, insert, update, delete on public.user_ai_settings to service_role;

commit;
