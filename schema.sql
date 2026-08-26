-- cell-cascade D1 schema — the Differentiation Cascade
-- A model is a STEM CELL. Differentiation = pruning potential into scope.
-- The silencing pattern lives in the character sheet (sheet_json).
-- The quilt is the neural inter-connector; myelination = reflex promotion.

CREATE TABLE IF NOT EXISTS organisms (
  name TEXT PRIMARY KEY,
  zygote_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Every cell carries the full DNA (the inherited sheet); the tier says how
-- much of it is allowed to be expressed.
CREATE TABLE IF NOT EXISTS cells (
  id TEXT PRIMARY KEY,
  organism TEXT NOT NULL,
  name TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'totipotent',        -- totipotent|multipotent|differentiated|sclerotic
  role TEXT NOT NULL DEFAULT '',
  sheet_json TEXT NOT NULL DEFAULT '{}',          -- the character sheet: inherited DNA + committed fate evidence
  cost_per_call REAL NOT NULL DEFAULT 1.0,        -- relative model cost; 0 = no model call (sclerotic tissue)
  latency_ms INTEGER NOT NULL DEFAULT 2000,       -- expected response latency
  plasticity REAL NOT NULL DEFAULT 1.0,           -- 1.0 totipotent -> 0.05 sclerotic
  status TEXT NOT NULL DEFAULT 'active',          -- active|retired (retired = wounded/replaced)
  created_from TEXT,                              -- parent cell id (mitosis lineage); NULL = zygote
  versions INTEGER NOT NULL DEFAULT 1,            -- sheet revision count (bumped on mitosis/distill/heal)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cells_organism ON cells (organism);
CREATE INDEX IF NOT EXISTS idx_cells_created_from ON cells (created_from);

-- The connectome log: every signal that crossed an axon.
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_cell TEXT NOT NULL,                        -- cell id, or a system sentinel ('wound','clock','environment','gardener')
  to_cell TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT,
  ok INTEGER NOT NULL DEFAULT 1,                  -- 0 = miss/error (e.g. sclerotic rule-table miss)
  mode TEXT,                                      -- v0.2: how it was served (table|model|escalated|model-required|...)
  model_log TEXT,                                 -- v0.2: JSON — tokens, latency, cost estimate, escalated_from
  escalated_from TEXT,                            -- v0.2: set when a germ-line ancestor answered for a child
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signals_to ON signals (to_cell, at);
CREATE INDEX IF NOT EXISTS idx_signals_from ON signals (from_cell, at);

-- Myelination counters: repeated signal paths get faster and cheaper.
-- Crossing the fire threshold with a clean error ratio AUTO-PROMOTES the
-- target cell differentiated -> sclerotic (tendency -> rule table).
CREATE TABLE IF NOT EXISTS myelin (
  path_id TEXT PRIMARY KEY,                       -- "{from}->{to}::{kind}"
  from_cell TEXT NOT NULL,
  to_cell TEXT NOT NULL,
  kind TEXT NOT NULL,
  fire_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  tier_promoted_to TEXT,                          -- set when this path triggered auto-promotion
  last_fired INTEGER
);
CREATE INDEX IF NOT EXISTS idx_myelin_to ON myelin (to_cell);

-- Fate decisions with provenance: who decided, on what evidence.
CREATE TABLE IF NOT EXISTS distillations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cell_id TEXT NOT NULL,
  from_tier TEXT NOT NULL,
  to_tier TEXT NOT NULL,
  evidence_ref TEXT,                              -- the experiment report / doc that justifies the decision
  gardener_verdict TEXT,                          -- the gardener's (or myelin auto-rule's) one-line verdict
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_distill_cell ON distillations (cell_id, at);

-- THE SAVED DECOMPOSITIONS: experiments that went well, stored as
-- re-instantiable organisms (cells + myelin + distillations with provenance).
CREATE TABLE IF NOT EXISTS examples (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                             -- decomposition archetype
  description TEXT NOT NULL,
  seed_json TEXT NOT NULL,                        -- full organism seed
  evidence_ref TEXT
);

-- DISTILLATION CANDIDATES (v0.2 — the escalation ledger): every time a
-- differentiated cell's rule table MISSED and a totipotent ancestor
-- successfully answered via the model bridge, the pair (missed rule,
-- successful escalation) is recorded here — evidence the rule table has
-- a hole the organism should grow into. The gardener resolves candidates
-- by distilling the answer into a deterministic rule.
CREATE TABLE IF NOT EXISTS distillation_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organism TEXT NOT NULL,
  cell_id TEXT NOT NULL,                          -- the differentiated cell whose table missed
  escalated_to TEXT NOT NULL,                     -- the totipotent ancestor that answered
  signal_id INTEGER NOT NULL,                     -- the signal that exposed the hole
  kind TEXT NOT NULL,                             -- the missed signal kind
  payload_shape TEXT NOT NULL,                    -- sorted payload keys — the hole's shape
  question TEXT,                                  -- what was asked
  answer TEXT,                                    -- what the germ line said (the seed of the new rule)
  status TEXT NOT NULL DEFAULT 'open',            -- open|distilled|dismissed
  resolved_at INTEGER,
  resolution TEXT,                                -- gardener verdict on resolve (provenance)
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_candidates_organism ON distillation_candidates (organism, status);
