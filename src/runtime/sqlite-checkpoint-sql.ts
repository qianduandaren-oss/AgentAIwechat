export const SQLITE_CHECKPOINT_SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_checkpoints (
  run_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export const SQLITE_SELECT_CHECKPOINT = `
SELECT run_id, version, payload, updated_at
FROM agent_checkpoints
WHERE run_id = ?;
`;

export const SQLITE_INSERT_CHECKPOINT_IF_ABSENT = `
INSERT INTO agent_checkpoints (run_id, version, payload, updated_at)
VALUES (?, ?, ?, ?)
ON CONFLICT(run_id) DO NOTHING;
`;

export const SQLITE_UPDATE_CHECKPOINT_IF_VERSION = `
UPDATE agent_checkpoints
SET version = ?, payload = ?, updated_at = ?
WHERE run_id = ? AND version = ?;
`;

export const SQLITE_CHECKPOINT_PRAGMAS = [
  "PRAGMA journal_mode = WAL;",
  "PRAGMA busy_timeout = 5000;"
] as const;
