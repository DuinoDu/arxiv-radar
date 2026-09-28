ALTER TABLE user_papers
  ADD COLUMN IF NOT EXISTS relevance_score double precision,
  ADD COLUMN IF NOT EXISTS quality_score double precision,
  ADD COLUMN IF NOT EXISTS score_detail jsonb;
