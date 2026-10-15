// Fejlesztői indító: API (tsx watch) + Vite, PATH-tól függetlenül (a futó node binárist használja).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = (p) => path.join(root, 'node_modules', ...p.split('/'));

const procs = [
  ['api', [bin('tsx/dist/cli.mjs'), 'watch', '--clear-screen=false', 'server/index.ts']],
  ['web', [bin('vite/bin/vite.js')]],
].map(([name, args]) => {
  const p = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = (d) => d.toString().split(/\r?\n/).filter(Boolean).map((l) => `[${name}] ${l}`).join('\n');
  p.stdout.on('data', (d) => console.log(prefix(d)));
  p.stderr.on('data', (d) => console.error(prefix(d)));
  p.on('exit', (code) => {
    console.log(`[${name}] kilépett (${code})`);
    procs.forEach((x) => x.kill());
    process.exit(code ?? 0);
  });
  return p;
});

process.on('SIGINT', () => procs.forEach((p) => p.kill()));
