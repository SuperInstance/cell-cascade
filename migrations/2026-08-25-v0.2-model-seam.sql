-- cell-cascade migration: v0.1 -> v0.2 (THE MODEL SEAM)
-- Run ONCE against an existing v0.1 database:
--   wrangler d1 execute cell-cascade-db --remote --file migrations/2026-08-25-v0.2-model-seam.sql
-- (Fresh databases get all of this from schema.sql directly.)

ALTER TABLE signals ADD COLUMN mode TEXT;
ALTER TABLE signals ADD COLUMN model_log TEXT;
ALTER TABLE signals ADD COLUMN escalated_from TEXT;

CREATE TABLE IF NOT EXISTS distillation_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organism TEXT NOT NULL,
  cell_id TEXT NOT NULL,
  escalated_to TEXT NOT NULL,
  signal_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_shape TEXT NOT NULL,
  question TEXT,
  answer TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolved_at INTEGER,
  resolution TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_candidates_organism ON distillation_candidates (organism, status);
