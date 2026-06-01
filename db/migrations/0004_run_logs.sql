CREATE TABLE IF NOT EXISTS user_analysis_run_logs (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  run_id text NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(),
  level text NOT NULL DEFAULT 'info',
  paper_id text,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, run_id)
    REFERENCES user_analysis_runs(user_id, id)
    ON DELETE CASCADE,
  CONSTRAINT user_analysis_run_logs_level_check
    CHECK (level IN ('info', 'warn', 'error'))
);

CREATE INDEX IF NOT EXISTS user_analysis_run_logs_user_run_idx
  ON user_analysis_run_logs(user_id, run_id, id);
