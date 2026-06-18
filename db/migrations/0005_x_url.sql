ALTER TABLE papers
  ADD COLUMN IF NOT EXISTS x_url text;

ALTER TABLE user_papers
  ADD COLUMN IF NOT EXISTS x_url_override text;
