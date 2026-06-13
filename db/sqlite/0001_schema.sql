-- Consolidated SQLite schema, equivalent to the PostgreSQL migrations under
-- db/migrations (0001-0004) after all ALTERs are applied. Types are mapped to
-- SQLite affinities: timestamptz -> TEXT, boolean -> INTEGER (0/1),
-- jsonb -> TEXT (JSON string), bigserial -> INTEGER PRIMARY KEY AUTOINCREMENT,
-- double precision -> REAL. The regex CHECK on cron_local_time is dropped
-- (SQLite has no regex operator); all other CHECK/FK constraints are preserved.

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text,
  phone text,
  name text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  arxiv_daily_url text NOT NULL,
  cron_enabled integer NOT NULL DEFAULT 1,
  cron_local_time text NOT NULL,
  conductor_base_url text NOT NULL DEFAULT '',
  conductor_token text NOT NULL DEFAULT '',
  conductor_daemon_host text NOT NULL DEFAULT '',
  conductor_workspace_path text NOT NULL DEFAULT '',
  conductor_app_name text NOT NULL DEFAULT 'arxiv-radar',
  conductor_backend_type text NOT NULL DEFAULT '',
  tags text NOT NULL DEFAULT '[]',
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS papers (
  id text PRIMARY KEY,
  title text NOT NULL,
  authors text NOT NULL DEFAULT '[]',
  abstract text NOT NULL,
  categories text NOT NULL DEFAULT '[]',
  published_at text,
  article_updated_at text,
  arxiv_url text NOT NULL,
  pdf_url text,
  full_text_status text,
  full_text_url text,
  full_text_error text,
  full_text_analyzed_at text,
  github_url text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT papers_full_text_status_check
    CHECK (full_text_status IS NULL OR full_text_status IN ('available', 'unavailable', 'failed'))
);

CREATE TABLE IF NOT EXISTS user_analysis_runs (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id text NOT NULL,
  source_url text NOT NULL,
  started_at text NOT NULL,
  finished_at text,
  status text NOT NULL,
  fetched_count integer NOT NULL DEFAULT 0,
  skipped_already_processed_count integer NOT NULL DEFAULT 0,
  analyzed_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  skipped_ids text NOT NULL DEFAULT '[]',
  message text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, id),
  CONSTRAINT user_analysis_runs_status_check
    CHECK (status IN ('running', 'completed', 'failed'))
);

CREATE TABLE IF NOT EXISTS user_analysis_failures (
  id integer PRIMARY KEY AUTOINCREMENT,
  user_id text NOT NULL,
  run_id text NOT NULL,
  paper_id text NOT NULL,
  title text,
  error text NOT NULL,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id, run_id)
    REFERENCES user_analysis_runs(user_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_papers (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paper_id text NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  summary text NOT NULL DEFAULT '',
  hypothesis text NOT NULL DEFAULT '',
  method text NOT NULL DEFAULT '',
  problem text NOT NULL DEFAULT '',
  conclusion text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  confidence real,
  analyzed_at text NOT NULL,
  run_id text NOT NULL DEFAULT '',
  removed integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'analysis',
  github_url_override text,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, paper_id)
);

CREATE TABLE IF NOT EXISTS user_paper_tags (
  user_id text NOT NULL,
  paper_id text NOT NULL,
  tag text NOT NULL,
  evidence text NOT NULL DEFAULT '',
  confidence real,
  source text NOT NULL DEFAULT 'abstract',
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, paper_id, tag),
  FOREIGN KEY (user_id, paper_id)
    REFERENCES user_papers(user_id, paper_id)
    ON DELETE CASCADE,
  CONSTRAINT user_paper_tags_source_check
    CHECK (source IN ('title', 'abstract', 'full_text'))
);

CREATE TABLE IF NOT EXISTS user_favorites (
  user_id text NOT NULL,
  paper_id text NOT NULL,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, paper_id),
  FOREIGN KEY (user_id, paper_id)
    REFERENCES user_papers(user_id, paper_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_conductor_task_bindings (
  user_id text NOT NULL,
  paper_id text NOT NULL,
  task_id text NOT NULL,
  project_id text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, paper_id),
  UNIQUE (user_id, task_id),
  FOREIGN KEY (user_id, paper_id)
    REFERENCES user_papers(user_id, paper_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_analysis_run_logs (
  id integer PRIMARY KEY AUTOINCREMENT,
  user_id text NOT NULL,
  run_id text NOT NULL,
  ts text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  level text NOT NULL DEFAULT 'info',
  paper_id text,
  message text NOT NULL,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id, run_id)
    REFERENCES user_analysis_runs(user_id, id)
    ON DELETE CASCADE,
  CONSTRAINT user_analysis_run_logs_level_check
    CHECK (level IN ('info', 'warn', 'error'))
);

CREATE INDEX IF NOT EXISTS user_papers_user_updated_idx
  ON user_papers(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS user_papers_user_analyzed_idx
  ON user_papers(user_id, analyzed_at DESC);

CREATE INDEX IF NOT EXISTS user_analysis_runs_user_started_idx
  ON user_analysis_runs(user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS user_conductor_task_bindings_user_task_idx
  ON user_conductor_task_bindings(user_id, task_id);

CREATE INDEX IF NOT EXISTS user_analysis_run_logs_user_run_idx
  ON user_analysis_run_logs(user_id, run_id, id);
