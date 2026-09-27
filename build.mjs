// Build: inline every local <link rel="stylesheet"> and <script src> referenced by index.html
// into single-file outputs. Zero dependencies.
//
//   dist/lightspeed.html  full standalone document (send this file / host it anywhere)
//   dist/artifact.html    same page without <!doctype>/<html>/<head>/<body> wrappers
//                         (the claude.ai Artifact host adds its own skeleton)
//
// Usage: node build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const read = (rel) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) throw new Error(`build: missing file referenced by index.html: ${rel}`);
  return fs.readFileSync(p, 'utf8');
};
// Keep a literal "</script" or "<!--" inside inlined JS from breaking out of the <script> element.
const safeJs = (code) => code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

const cssFiles = [...src.matchAll(/<link\s+rel="stylesheet"\s+href="(src\/[^"]+)"\s*>/g)].map((m) => m[1]);
const jsFiles = [...src.matchAll(/<script\s+src="(src\/[^"]+)"\s*><\/script>/g)].map((m) => m[1]);
const css = cssFiles.map((f) => `/* ${f} */\n${read(f)}`).join('\n');
const js = safeJs(jsFiles.map((f) => `// ${f}\n${read(f)}`).join('\n;\n'));

// NOTE: every .replace below uses a function replacer. A string replacement would expand
// `$'`, `$&`, `$$` sequences that appear inside the inlined sources.

// ---- standalone document ----
let full = src;
full = full.replace(/<link\s+rel="stylesheet"\s+href="src\/[^"]+"\s*>\n?/g, () => '');
full = full.replace('</head>', () => `<style>\n${css}\n</style>\n</head>`);
full = full.replace(/<!-- BUILD:SCRIPTS[^>]*-->\n?/, () => '');
full = full.replace(/<script\s+src="src\/[^"]+"\s*><\/script>\n?/g, () => '');
full = full.replace('</body>', () => `<script>\n${js}\n</script>\n</body>`);
if (!full.includes(js.slice(-200)) || !full.includes(css.slice(-200))) throw new Error('build: inlining failed');

// ---- artifact fragment ----
const title = (src.match(/<title>[\s\S]*?<\/title>/) || [''])[0];
const fontLinks = [...src.matchAll(/<link\s+rel="(?:stylesheet|preconnect)"\s+href="https:[^"]+"[^>]*>/g)].map((m) => m[0]);
const bodyInner = (src.match(/<body[^>]*>([\s\S]*?)<!-- BUILD:SCRIPTS/) || ['', ''])[1].trim();
if (!bodyInner.includes('id="app"')) throw new Error('build: could not extract body markup');
const artifact = [
  title,
  ...fontLinks,
  `<style>\n${css}\n</style>`,
  bodyInner,
  `<script>\n${js}\n</script>`,
  '',
].join('\n');

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'lightspeed.html'), full);
fs.writeFileSync(path.join(ROOT, 'dist', 'artifact.html'), artifact);
const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1) + ' KB';
console.log(`css files: ${cssFiles.length}, js files: ${jsFiles.length}`);
console.log(`dist/lightspeed.html  ${kb(full)}`);
console.log(`dist/artifact.html    ${kb(artifact)}`);
