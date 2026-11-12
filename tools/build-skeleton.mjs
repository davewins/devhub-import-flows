// Builds the entity-skeletons-* folders from their sources. fetch:template renders each file in isolation (no includes),
// so the shared analysis (src*/_analysis.njk) is inlined at the {#@@ANALYSIS@@#} marker of every page.
//   node tools/build-skeleton.mjs            builds everything
//   node tools/build-skeleton.mjs bw-deep    src/      -> entity-skeletons-bw-deep/
//   node tools/build-skeleton.mjs mft        src-mft/  -> entity-skeletons-mft/
import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const targets = { 'bw-deep': { src: 'src', out: 'entity-skeletons-bw-deep' }, 'mft': { src: 'src-mft', out: 'entity-skeletons-mft', expand: true } };
const want = process.argv[2] ? [process.argv[2]] : Object.keys(targets);
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
// Template helpers written as nm(inst, "kind", expr) / slugify(expr) in the MFT sources are expanded into plain filter chains
// (restricted Hub builds only allow replace/split/length and the lower/truncate/trim/join/default filters).
const expand = t => t
  .replace(/\bnm\(inst, ("[a-z-]+"), ([^()]*)\)/g, (_, k, e) => `(((inst + "-" + ${k} + "-" + (${e})) | lower | replace(r/[^a-z0-9_.-]+/g, "-")) | truncate(63, true, "") | replace(r/^[-_.]+|[-_.]+$/g, ""))`)
  .replace(/\bslugify\(([^()]*)\)/g, (_, e) => `((${e}) | lower | replace(r/[^a-z0-9]+/g, "-") | replace(r/^-+|-+$/g, ""))`);
for (const name of want) {
  const t = targets[name]; if (!t) { console.error('unknown target', name); process.exit(2); }
  const src = path.join(root, t.src), out = path.join(root, t.out);
  const analysis = fs.readFileSync(path.join(src, '_analysis.njk'), 'utf8').trimEnd();
  fs.rmSync(out, { recursive: true, force: true });
  for (const f of walk(src)) {
    const rel = path.relative(src, f); if (path.basename(f).startsWith('_')) continue;
    let text = fs.readFileSync(f, 'utf8').replace('{#@@ANALYSIS@@#}', () => analysis);
    if (t.expand) text = expand(text);
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
    fs.writeFileSync(path.join(out, rel), text);
  }
  console.log('built', t.out + ':', walk(out).map(f => path.relative(out, f)).join(', '));
}
