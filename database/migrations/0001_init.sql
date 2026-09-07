-- Cloud APK Factory — initial schema (Postgres / Supabase)
-- Mirrors the data model in section 33 of the design spec.
-- Safe to re-run: every statement is CREATE TABLE IF NOT EXISTS.

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  google_id     text unique not null,
  email         text,
  name          text,
  avatar        text,
  created_at    timestamptz not null default now(),
  settings      jsonb not null default '{}'::jsonb
);

create table if not exists connected_accounts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id) on delete cascade,
  provider      text not null check (provider in ('google','github','expo','cloudflare','supabase')),
  external_id   text,
  email         text,
  scopes        jsonb not null default '[]'::jsonb,
  status        text not null default 'connected',
  connected_at  timestamptz not null default now(),
  last_used_at  timestamptz,
  expires_at    timestamptz
);

create table if not exists github_installations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id) on delete cascade,
  installation_id bigint unique not null,
  account_login text,
  repositories   jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists repositories (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id) on delete cascade,
  github_full_name text unique not null,
  default_branch   text default 'main',
  private      boolean default false,
  created_at    timestamptz not null default now()
);

create table if not exists projects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id) on delete cascade,
  repository_id uuid references repositories(id) on delete cascade,
  repo_name     text,
  org           text,
  source_files  jsonb,            -- snapshot of analyzed manifest files
  auto_build    boolean default false,
  created_at    timestamptz not null default now()
);

create table if not exists project_analysis (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid references projects(id) on delete cascade,
  detected_at   timestamptz not null default now(),
  primary_framework text,
  language      text,
  versions      jsonb not null default '{}'::jsonb,
  node_requirement jsonb,
  android_requirement jsonb,
  native_modules jsonb not null default '[]'::jsonb,
  dependencies  jsonb not null default '[]'::jsonb,
  signing       jsonb,
  permissions   jsonb not null default '[]'::jsonb,
  assets        jsonb,
  score         jsonb,
  compatible_environments jsonb not null default '[]'::jsonb
);

create table if not exists project_issues (
  id            uuid primary key default gen_random_uuid(),
  analysis_id   uuid references project_analysis(id) on delete cascade,
  severity      text not null check (severity in ('required','recommended','optional','good')),
  category      text,
  title         text not null,
  description   text,
  auto_fixable  boolean default false
);

create table if not exists project_suggestions (
  id            uuid primary key default gen_random_uuid(),
  analysis_id   uuid references project_analysis(id) on delete cascade,
  severity      text,
  title         text,
  recommended_value text,
  reason        text,
  patch         jsonb
);

create table if not exists builds (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid references projects(id) on delete cascade,
  user_id       uuid references users(id) on delete cascade,
  status        text not null,
  target        text,
  provider      text,
  triggered_by  text,
  route         jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists build_attempts (
  id            uuid primary key default gen_random_uuid(),
  build_id      uuid references builds(id) on delete cascade,
  attempt_index integer not null,
  provider      text,
  started_at    timestamptz,
  finished_at   timestamptz,
  status        text,
  error_hash    text,
  repair_applied text,
  created_at    timestamptz not null default now()
);

create table if not exists build_logs (
  id            uuid primary key default gen_random_uuid(),
  build_id      uuid references builds(id) on delete cascade,
  attempt_index integer,
  content       text,
  created_at    timestamptz not null default now()
);

create table if not exists repairs (
  id            uuid primary key default gen_random_uuid(),
  build_id      uuid references builds(id) on delete cascade,
  error_hash    text,
  source        text check (source in ('knowledge','ai','none')),
  summary       text,
  confidence    numeric(4,3),
  created_at    timestamptz not null default now()
);

create table if not exists repair_patches (
  id            uuid primary key default gen_random_uuid(),
  repair_id     uuid references repairs(id) on delete cascade,
  level         integer check (level between 0 and 3),
  file          text,
  target        text,
  value         jsonb,
  risk          text,
  applied       boolean default false
);

create table if not exists artifacts (
  id            uuid primary key default gen_random_uuid(),
  build_id      uuid references builds(id) on delete cascade,
  type          text check (type in ('apk','aab','logs','report','mapping')),
  name          text,
  size_bytes    bigint,
  sha256        text,
  url           text,
  expires_at    timestamptz
);

create table if not exists webhooks (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid references projects(id) on delete cascade,
  provider      text default 'github',
  events        jsonb not null default '[]'::jsonb,
  build_on_push boolean default true,
  build_on_release boolean default false,
  build_only_main  boolean default true,
  auto_repair   boolean default false,
  auto_create_pr boolean default false,
  secret        text,
  created_at    timestamptz not null default now()
);

create table if not exists build_environments (
  id            uuid primary key default gen_random_uuid(),
  image_tag     text unique not null,
  framework     text,
  node          text,
  java          text,
  gradle        text,
  android_sdk   integer,
  build_tools   text,
  kotlin        text,
  created_at    timestamptz not null default now()
);

create table if not exists usage (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id) on delete cascade,
  provider      text,
  unit          text,
  consumed      integer not null default 0,
  period_start  timestamptz not null default date_trunc('month', now()),
  period_end    timestamptz
);

create table if not exists notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id) on delete cascade,
  channel       text,
  event         text,
  payload       jsonb,
  read          boolean default false,
  created_at    timestamptz not null default now()
);

create table if not exists audit_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid,
  action        text not null,
  provider      text,
  project_id    uuid,
  ip_hash       text,
  result        text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_projects_user on projects(user_id);
create index if not exists idx_analysis_project on project_analysis(project_id);
create index if not exists idx_builds_project on builds(project_id);
create index if not exists idx_builds_user on builds(user_id);
create index if not exists idx_build_attempts_build on build_attempts(build_id);
create index if not exists idx_artifacts_build on artifacts(build_id);
create index if not exists idx_audit_created on audit_logs(created_at);
