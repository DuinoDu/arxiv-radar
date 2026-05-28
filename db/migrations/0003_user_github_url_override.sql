ALTER TABLE user_papers
  ADD COLUMN IF NOT EXISTS github_url_override text;
