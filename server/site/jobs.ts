// Tartós (SQLite) job queue: az auditok nem egy HTTP-kérésen belül futnak.
// Állapotok: queued → running → done | failed. Hiba esetén visszalépéses újrapróbálás (max_attempts),
// induláskor a beragadt (running, lejárt zárolású) feladatok újra sorba kerülnek. A hibák visszakövethetők (last_error).
import { getDb } from './db.ts';

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

const handlers = new Map<string, JobHandler>();
let timer: NodeJS.Timeout | undefined;
let active = 0;

export function registerHandler(type: string, fn: JobHandler) {
  handlers.set(type, fn);
}

export function enqueue(type: string, payload: Record<string, unknown>, maxAttempts = 2): number {
  const now = new Date().toISOString();
  const r = getDb().prepare("INSERT INTO jobs(type, payload, status, attempts, max_attempts, run_after, created_at) VALUES (?,?, 'queued', 0, ?, ?, ?)").run(type, JSON.stringify(payload), maxAttempts, now, now);
  setImmediate(tick);
  return Number(r.lastInsertRowid);
}

export function listJobs(limit = 50) {
  return getDb().prepare('SELECT id, type, payload, status, attempts, max_attempts, run_after, locked_at, last_error, created_at, finished_at FROM jobs ORDER BY id DESC LIMIT ?').all(limit);
}

/** Beragadt feladatok visszaállítása (pl. a szerver leállt futás közben). */
export function recoverStale(maxAgeMs = 10 * 60 * 1000) {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const db = getDb();
  const stale = db.prepare("SELECT id FROM jobs WHERE status = 'running' AND (locked_at IS NULL OR locked_at < ?)").all(cutoff) as { id: number }[];
  for (const s of stale) db.prepare("UPDATE jobs SET status = 'queued', locked_at = NULL, last_error = COALESCE(last_error, '') || ' | újraindítva (beragadt futás)' WHERE id = ?").run(s.id);
  return stale.length;
}

async function tick() {
  const db = getDb();
  const max = Number(process.env.GEO_WORKER_CONCURRENCY ?? 1);
  while (active < max) {
    const now = new Date().toISOString();
    const job = db.prepare("SELECT * FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY id LIMIT 1").get(now) as
      | { id: number; type: string; payload: string; attempts: number; max_attempts: number }
      | undefined;
    if (!job) return;
    // optimista zárolás: csak akkor indul, ha még mindig queued
    const claimed = db.prepare("UPDATE jobs SET status = 'running', locked_at = ?, attempts = attempts + 1 WHERE id = ? AND status = 'queued'").run(now, job.id);
    if (!claimed.changes) continue;
    active++;
    const handler = handlers.get(job.type);
    void (async () => {
      try {
        if (!handler) throw new Error(`Ismeretlen feladattípus: ${job.type}`);
        await handler(JSON.parse(job.payload));
        db.prepare("UPDATE jobs SET status = 'done', finished_at = ? WHERE id = ?").run(new Date().toISOString(), job.id);
      } catch (e) {
        const attempts = job.attempts + 1;
        const msg = (e as Error).stack ?? String(e);
        if (attempts < job.max_attempts) {
          const runAfter = new Date(Date.now() + 15000 * attempts).toISOString();
          db.prepare("UPDATE jobs SET status = 'queued', locked_at = NULL, run_after = ?, last_error = ? WHERE id = ?").run(runAfter, msg.slice(0, 4000), job.id);
        } else {
          db.prepare("UPDATE jobs SET status = 'failed', finished_at = ?, last_error = ? WHERE id = ?").run(new Date().toISOString(), msg.slice(0, 4000), job.id);
        }
      } finally {
        active--;
        setImmediate(tick);
      }
    })();
  }
}

export function startWorker(intervalMs = 1500) {
  recoverStale();
  timer ??= setInterval(() => void tick(), intervalMs);
  void tick();
}

export function stopWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
}

/** Tesztekhez: megvárja, míg minden feladat befejeződik. */
export async function drain(timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pending = getDb().prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')").get() as { n: number };
    if (!pending.n && !active) return;
    await tick();
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('drain: időtúllépés');
}
