// Builds entity-skeletons-bw-deep/ from src/. fetch:template renders each file in isolation (no includes),
// so the shared analysis in src/_analysis.njk is inlined at the {#@@ANALYSIS@@#} marker of every page.
import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = path.join(root, 'src'), out = path.join(root, 'entity-skeletons-bw-deep');
const analysis = fs.readFileSync(path.join(src, '_analysis.njk'), 'utf8').trimEnd();
fs.rmSync(out, { recursive: true, force: true });
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
for (const f of walk(src)) {
  const rel = path.relative(src, f); if (path.basename(f).startsWith('_')) continue;
  const text = fs.readFileSync(f, 'utf8').replace('{#@@ANALYSIS@@#}', () => analysis);
  fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
  fs.writeFileSync(path.join(out, rel), text);
}
console.log('built', walk(out).map(f => path.relative(out, f)).join(', '));
