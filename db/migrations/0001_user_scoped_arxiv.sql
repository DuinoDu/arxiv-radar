CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text,
  phone text,
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  arxiv_daily_url text NOT NULL,
  cron_enabled boolean NOT NULL DEFAULT true,
  cron_local_time text NOT NULL,
  conductor_base_url text NOT NULL DEFAULT '',
  conductor_token text NOT NULL DEFAULT '',
  conductor_daemon_host text NOT NULL DEFAULT '',
  conductor_workspace_path text NOT NULL DEFAULT '',
  conductor_app_name text NOT NULL DEFAULT 'arxiv-radar',
  conductor_backend_type text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_settings_cron_local_time_format
    CHECK (cron_local_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')
);

CREATE TABLE IF NOT EXISTS papers (
  id text PRIMARY KEY,
  title text NOT NULL,
  authors jsonb NOT NULL DEFAULT '[]'::jsonb,
  abstract text NOT NULL,
  categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  published_at text,
  article_updated_at text,
  arxiv_url text NOT NULL,
  pdf_url text,
  full_text_status text,
  full_text_url text,
  full_text_error text,
  full_text_analyzed_at text,
  github_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
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
  skipped_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  CONSTRAINT user_analysis_runs_status_check
    CHECK (status IN ('running', 'completed', 'failed'))
);

CREATE TABLE IF NOT EXISTS user_analysis_failures (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  run_id text NOT NULL,
  paper_id text NOT NULL,
  title text,
  error text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
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
  confidence double precision,
  analyzed_at text NOT NULL,
  run_id text NOT NULL DEFAULT '',
  removed boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'analysis',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, paper_id)
);

CREATE TABLE IF NOT EXISTS user_paper_tags (
  user_id text NOT NULL,
  paper_id text NOT NULL,
  tag text NOT NULL,
  evidence text NOT NULL DEFAULT '',
  confidence double precision,
  source text NOT NULL DEFAULT 'abstract',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, paper_id, tag),
  FOREIGN KEY (user_id, paper_id)
    REFERENCES user_papers(user_id, paper_id)
    ON DELETE CASCADE,
  CONSTRAINT user_paper_tags_tag_check
    CHECK (tag IN ('egocentric', 'vla', 'world_model', 'so101', 'vr', 'teleop', 'slam', 'umi')),
  CONSTRAINT user_paper_tags_source_check
    CHECK (source IN ('title', 'abstract', 'full_text'))
);

CREATE TABLE IF NOT EXISTS user_favorites (
  user_id text NOT NULL,
  paper_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
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
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, paper_id),
  UNIQUE (user_id, task_id),
  FOREIGN KEY (user_id, paper_id)
    REFERENCES user_papers(user_id, paper_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS user_papers_user_updated_idx
  ON user_papers(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS user_papers_user_analyzed_idx
  ON user_papers(user_id, analyzed_at DESC);

CREATE INDEX IF NOT EXISTS user_analysis_runs_user_started_idx
  ON user_analysis_runs(user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS user_conductor_task_bindings_user_task_idx
  ON user_conductor_task_bindings(user_id, task_id);
