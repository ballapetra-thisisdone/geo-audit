// SQLite (node:sqlite, natív függőség nélkül). Normalizált séma: minden fő entitás külön tábla,
// auditra hivatkozó idegen kulccsal; a ritkán szűrt részletek a `data` JSON oszlopban vannak.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT, name TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  host TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'own', created_at TEXT NOT NULL,
  UNIQUE(project_id, host)
);
CREATE TABLE IF NOT EXISTS audits (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  domain_id TEXT NOT NULL REFERENCES domains(id), status TEXT NOT NULL,
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
  method_version TEXT NOT NULL, input TEXT NOT NULL, steps TEXT NOT NULL, data_sources TEXT NOT NULL,
  error TEXT, partial INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS crawl_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  site TEXT NOT NULL, root_url TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT, finished_at TEXT,
  pages INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  site TEXT NOT NULL, url TEXT NOT NULL, status INTEGER, page_class TEXT NOT NULL, depth INTEGER NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0, importance REAL NOT NULL DEFAULT 0, data TEXT NOT NULL,
  UNIQUE(audit_id, site, url)
);
CREATE INDEX IF NOT EXISTS pages_audit_site ON pages(audit_id, site);
CREATE TABLE IF NOT EXISTS page_snapshots (
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE, kind TEXT NOT NULL,
  data TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(page_id, kind)
);
CREATE TABLE IF NOT EXISTS links (
  audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE, site TEXT NOT NULL,
  from_url TEXT NOT NULL, to_url TEXT NOT NULL, anchor TEXT, zone TEXT, nofollow INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS links_audit ON links(audit_id, site);
CREATE TABLE IF NOT EXISTS issues (
  id TEXT NOT NULL, audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE, site TEXT NOT NULL,
  code TEXT NOT NULL, category TEXT NOT NULL, priority TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(audit_id, id)
);
CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT NOT NULL, audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE, issue_id TEXT,
  type TEXT NOT NULL, url TEXT, priority TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(audit_id, id)
);
CREATE TABLE IF NOT EXISTS scores (
  audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE, site TEXT NOT NULL, component TEXT NOT NULL,
  score REAL, weight REAL NOT NULL, confidence REAL NOT NULL, data TEXT NOT NULL, PRIMARY KEY(audit_id, site, component)
);
CREATE TABLE IF NOT EXISTS entities (
  id TEXT NOT NULL, audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE, site TEXT NOT NULL,
  type TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(audit_id, site, id)
);
CREATE TABLE IF NOT EXISTS entity_relationships (
  audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE, site TEXT NOT NULL,
  from_id TEXT NOT NULL, to_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS structured_data_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT, audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  site TEXT NOT NULL, url TEXT NOT NULL, format TEXT NOT NULL, types TEXT NOT NULL, valid INTEGER NOT NULL, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS topics (
  id TEXT NOT NULL, audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE, label TEXT NOT NULL,
  data TEXT NOT NULL, PRIMARY KEY(audit_id, id)
);
CREATE TABLE IF NOT EXISTS query_clusters (
  id TEXT NOT NULL, audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE, label TEXT NOT NULL,
  topic_id TEXT, weight REAL NOT NULL, PRIMARY KEY(audit_id, id)
);
CREATE TABLE IF NOT EXISTS queries (
  id TEXT NOT NULL, audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE, text TEXT NOT NULL,
  cluster_id TEXT, coverage TEXT NOT NULL, weight REAL NOT NULL, data TEXT NOT NULL, PRIMARY KEY(audit_id, id)
);
CREATE TABLE IF NOT EXISTS competitors (
  id TEXT NOT NULL, audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE, domain TEXT NOT NULL,
  source TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(audit_id, id)
);
CREATE TABLE IF NOT EXISTS ai_platforms (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, docs TEXT
);
CREATE TABLE IF NOT EXISTS ai_responses (
  id TEXT NOT NULL, audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE, query_id TEXT NOT NULL,
  platform_id TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(audit_id, id)
);
CREATE TABLE IF NOT EXISTS source_urls (
  audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE, url TEXT NOT NULL, domain TEXT NOT NULL,
  topic TEXT, competitor_id TEXT, is_own INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(audit_id, url)
);
CREATE TABLE IF NOT EXISTS citations (
  audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE, response_id TEXT NOT NULL,
  kind TEXT NOT NULL, url TEXT, domain TEXT NOT NULL, title TEXT, query_id TEXT NOT NULL, platform_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT NOT NULL, audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE, priority TEXT NOT NULL,
  data TEXT NOT NULL, PRIMARY KEY(audit_id, id)
);
CREATE TABLE IF NOT EXISTS developer_tasks (
  id TEXT NOT NULL, audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE, priority TEXT NOT NULL,
  data TEXT NOT NULL, PRIMARY KEY(audit_id, id)
);
CREATE TABLE IF NOT EXISTS audit_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT, audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  ref_type TEXT NOT NULL, ref_id TEXT NOT NULL, url TEXT, kind TEXT NOT NULL, detail TEXT NOT NULL, snippet TEXT
);
CREATE INDEX IF NOT EXISTS evidence_ref ON audit_evidence(audit_id, ref_type, ref_id);
CREATE TABLE IF NOT EXISTS artifacts (
  audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE, key TEXT NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY(audit_id, key)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  t TEXT NOT NULL, level TEXT NOT NULL, msg TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 2, run_after TEXT NOT NULL,
  locked_at TEXT, last_error TEXT, created_at TEXT NOT NULL, finished_at TEXT
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, run_after);
CREATE TABLE IF NOT EXISTS llm_cache (
  key TEXT PRIMARY KEY, model TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL,
  input_tokens INTEGER, output_tokens INTEGER
);
`;

export type DB = DatabaseSync;

let instance: DatabaseSync | undefined;

export function openDb(file: string): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  // timeout: ha egy másik folyamat (pl. újrainduló szerver vagy külön worker) épp ír, várunk a zárolásra, nem hibázunk
  const db = new DatabaseSync(file, { timeout: 10000 });
  db.exec('PRAGMA busy_timeout = 10000;');
  db.exec(SCHEMA);
  return db;
}

export function getDb(file?: string): DatabaseSync {
  if (!instance) {
    if (!file) throw new Error('Az adatbázis nincs inicializálva.');
    instance = openDb(file);
  }
  return instance;
}

/** Tesztekhez: saját (memóriabeli) adatbázis beállítása. */
export function setDb(db: DatabaseSync | undefined) {
  instance = db;
}

export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const j = (v: unknown) => JSON.stringify(v ?? null);
export function pj<T>(s: unknown, fallback: T): T {
  if (typeof s !== 'string') return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
