// A Claude Code skill összeállítása: skill/geo-audit/ (SKILL.md, references, config, assets, scripts/geo-audit.mjs).
//   node scripts/build-skill.mjs            → csak build
//   node scripts/build-skill.mjs --install  → build + másolás a ~/.claude/skills/geo-audit mappába
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'skill', 'geo-audit');
const MARKER = '.geo-audit-skill';

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'scripts'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'cli', 'index.ts')],
  outfile: path.join(out, 'scripts', 'geo-audit.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // A playwright-core opcionális: ha telepítve van, mérőszámokat is ad; ha nincs, a böngésző --dump-dom módja fut.
  external: ['playwright-core'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning',
});

const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true });
copy('skill-src/SKILL.md', 'SKILL.md');
copy('skill-src/references', 'references');
fs.mkdirSync(path.join(out, 'config'), { recursive: true });
for (const f of ['checks.json', 'bots.json', 'questions.json']) copy(`config/${f}`, `config/${f}`);
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
copy('web/public/logo-dark.svg', 'assets/logo-dark.svg');
fs.writeFileSync(path.join(out, MARKER), `Épült: ${new Date().toISOString()}\nForrás: ${root}\n`);

const size = (fs.statSync(path.join(out, 'scripts', 'geo-audit.mjs')).size / 1024).toFixed(0);
console.log(`Skill kész: ${out} (szkript: ${size} KB)`);

if (process.argv.includes('--install')) {
  const target = path.join(os.homedir(), '.claude', 'skills', 'geo-audit');
  if (fs.existsSync(target) && !fs.existsSync(path.join(target, MARKER))) {
    console.error(`A ${target} már létezik, és nem ez a build hozta létre – nem írom felül.`);
    process.exit(1);
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(out, target, { recursive: true });
  console.log(`Telepítve: ${target}`);
}
