import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from './env.ts';
import type { BotDef, CheckDef, ModuleDef, QuestionTemplate } from '../shared/types.ts';

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(env.configDir, file), 'utf8')) as T;
}

async function writeJson(file: string, data: unknown) {
  const target = path.join(env.configDir, file);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, target);
}

interface ChecksFile {
  _comment?: string;
  modules: ModuleDef[];
  checks: CheckDef[];
}

export async function loadChecks() {
  return readJson<ChecksFile>('checks.json');
}

export async function saveChecks(checks: CheckDef[], modules?: ModuleDef[]) {
  const current = await loadChecks();
  await writeJson('checks.json', { _comment: current._comment, modules: modules ?? current.modules, checks });
}

export async function loadBots() {
  return (await readJson<{ bots: BotDef[] }>('bots.json')).bots;
}

interface QuestionsFile {
  _comment?: string;
  templates: QuestionTemplate[];
}

export async function loadQuestionTemplates() {
  return (await readJson<QuestionsFile>('questions.json')).templates;
}

export async function saveQuestionTemplates(templates: QuestionTemplate[]) {
  const current = await readJson<QuestionsFile>('questions.json');
  await writeJson('questions.json', { _comment: current._comment, templates });
}
