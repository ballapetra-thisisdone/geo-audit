import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const env = {
  root,
  // Nem PORT: azt sok indító (pl. preview) a frontendnek állítja be.
  port: Number(process.env.GEO_API_PORT ?? 4317),
  dataDir: path.resolve(root, process.env.DATA_DIR ?? './data'),
  configDir: path.join(root, 'config'),
  browserChannel: process.env.BROWSER_CHANNEL ?? 'msedge',
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
  claudeModel: process.env.CLAUDE_MODEL ?? 'claude-opus-5-5',
};
