-- Cloud APK Factory — Zero-Manual-Config additions
--   * sealed per-project signing credentials (§44 auto signing)
--   * sealed user/project secrets (§6 vault)
--   * user id on connected_accounts (real OAuth)
-- Safe to re-run.

create table if not exists project_signing (
  project_id    text primary key,
  record        jsonb not null,          -- SigningRecord (passwords + keystore are AES-256-GCM envelopes)
  updated_at    timestamptz not null default now()
);

create table if not exists secrets (
  id            text primary key,
  scope         text not null check (scope in ('user','project','connection')),
  owner_id      text not null,
  name          text not null,
  sealed        text not null,           -- AES-256-GCM envelope (JSON); never plaintext
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  unique (scope, owner_id, name)
);
create index if not exists secrets_owner_idx on secrets (scope, owner_id);

alter table connected_accounts add column if not exists user_id_text text;
create index if not exists connected_accounts_user_provider_idx on connected_accounts (user_id, provider);

-- projects: owner + analyzed ref
alter table projects add column if not exists owner_id text;
alter table projects add column if not exists ref text;
