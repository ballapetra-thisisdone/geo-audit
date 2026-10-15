// Fájlalapú tároló: data/audits/<id>/audit.json + round-<n>.json + r<n>/ nyers válaszok.
// Egy interfész mögött van, hogy később adatbázisra cserélhető legyen.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from './env.ts';
import type { AuditInput, AuditSummary, Round } from '../shared/types.ts';

interface AuditFile {
  id: string;
  createdAt: string;
  input: AuditInput;
  rounds: number[];
}

const auditsDir = () => path.join(env.dataDir, 'audits');
const auditDir = (id: string) => {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Érvénytelen audit-azonosító');
  return path.join(auditsDir(), id);
};

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as T;
}

function slug(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  } catch {
    return 'audit';
  }
}

export const store = {
  async createAudit(input: AuditInput): Promise<string> {
    const id = `${slug(input.url)}-${crypto.randomBytes(3).toString('hex')}`;
    const audit: AuditFile = { id, createdAt: new Date().toISOString(), input, rounds: [] };
    await writeJson(path.join(auditDir(id), 'audit.json'), audit);
    return id;
  },

  async getAudit(id: string): Promise<AuditFile> {
    return readJson<AuditFile>(path.join(auditDir(id), 'audit.json'));
  },

  async updateInput(id: string, input: AuditInput) {
    const audit = await this.getAudit(id);
    audit.input = input;
    await writeJson(path.join(auditDir(id), 'audit.json'), audit);
  },

  async listAudits(): Promise<AuditSummary[]> {
    let ids: string[] = [];
    try {
      ids = await fs.readdir(auditsDir());
    } catch {
      return [];
    }
    const out: AuditSummary[] = [];
    for (const id of ids) {
      try {
        out.push(await this.summary(id));
      } catch {
        /* sérült mappa: kihagyjuk */
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async summary(id: string): Promise<AuditSummary> {
    const audit = await this.getAudit(id);
    const rounds = [];
    for (const n of audit.rounds) {
      try {
        const r = await this.getRound(id, n);
        rounds.push({ n, createdAt: r.createdAt, status: r.status, scores: r.scores });
      } catch {
        /* kihagyjuk */
      }
    }
    return { id, createdAt: audit.createdAt, input: audit.input, rounds };
  },

  async addRound(id: string, round: Round) {
    const audit = await this.getAudit(id);
    if (!audit.rounds.includes(round.n)) audit.rounds.push(round.n);
    await writeJson(path.join(auditDir(id), 'audit.json'), audit);
    await this.saveRound(id, round);
  },

  async getRound(id: string, n: number): Promise<Round> {
    return readJson<Round>(path.join(auditDir(id), `round-${n}.json`));
  },

  async saveRound(id: string, round: Round) {
    await writeJson(path.join(auditDir(id), `round-${round.n}.json`), round);
  },

  /** Nyers válasz mentése; a visszaadott relatív útvonal kerül a Round-ba. */
  async saveBody(id: string, n: number, name: string, body: string): Promise<string> {
    const rel = `r${n}/${name}`;
    const file = path.join(auditDir(id), rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body, 'utf8');
    return rel;
  },

  async readBody(id: string, rel: string): Promise<string> {
    if (rel.includes('..')) throw new Error('Érvénytelen útvonal');
    return fs.readFile(path.join(auditDir(id), rel), 'utf8');
  },

  async deleteAudit(id: string) {
    await fs.rm(auditDir(id), { recursive: true, force: true });
  },
};
