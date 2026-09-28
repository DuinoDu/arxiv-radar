ALTER TABLE user_papers ADD COLUMN relevance_score real;

ALTER TABLE user_papers ADD COLUMN quality_score real;

ALTER TABLE user_papers ADD COLUMN score_detail text;
