// Load the game's non-DOM layers (core + data + sim) into a fresh vm context for headless tests.
//   import { loadGame } from './load.mjs';
//   const G = loadGame();            // core + data + sim
//   const G = loadGame({ layers: ['core', 'data'] });
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function scriptList(layers = ['core', 'data', 'sim']) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const all = [...html.matchAll(/<script\s+src="(src\/[^"]+)"\s*><\/script>/g)].map((m) => m[1]);
  return all.filter((f) => layers.some((l) => f.startsWith(`src/${l}/`)));
}

export function loadGame({ layers = ['core', 'data', 'sim'], allowMissing = false } = {}) {
  const sandbox = { console, setTimeout, clearTimeout };
  const ctx = vm.createContext(sandbox);
  for (const rel of scriptList(layers)) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) {
      if (allowMissing) continue;
      throw new Error(`loadGame: missing ${rel}`);
    }
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: rel });
  }
  return ctx.G;
}
