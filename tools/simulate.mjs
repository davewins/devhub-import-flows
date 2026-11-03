// Offline simulation of the scaffolder run for import-flow-bw-deep.yaml.
// Re-implements tibco:extract-parameters (same libraries/logic as TIBCO's source), fetch:template
// (nunjucks with ${{ }} delimiters) and parseRepoUrl; clone/push/register are stubbed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'yaml';
import nunjucks from 'nunjucks';
import jp from 'jsonpath';
import RegexParser from 'regex-parser';
import { XMLParser } from 'fast-xml-parser';
import { glob } from 'glob';
import * as cm from '@backstage/catalog-model';

const [, , projectDir, paramsFile, templateDir = '..'] = process.argv;
if (!projectDir || !paramsFile) { console.error('usage: node simulate.mjs <bw-project-dir> <params.json> [template-dir]'); process.exit(2); }
const params = JSON.parse(fs.readFileSync(paramsFile, 'utf8'));
const tpl = yaml.parse(fs.readFileSync(path.join(templateDir, 'import-flow-bw-deep.yaml'), 'utf8'));

const parseRepoUrl = s => {
  const u = new URL('https://' + s);
  const g = k => u.searchParams.get(k) || undefined;
  return { host: u.host, owner: g('owner'), repo: g('repo'), organization: g('organization'), workspace: g('workspace'), project: g('project') };
};
const mkEnv = (loader) => {
  const env = new nunjucks.Environment(loader, { autoescape: false, tags: { variableStart: '${{', variableEnd: '}}' } });
  env.addFilter('parseRepoUrl', parseRepoUrl);
  return env;
};
const exprEnv = mkEnv(new nunjucks.FileSystemLoader('/nonexistent'));
const ctx = { parameters: params, steps: {} };
const evalValue = v => {
  if (typeof v === 'string') {
    const m = v.match(/^\s*\$\{\{([\s\S]*)\}\}\s*$/);
    if (m && !m[1].includes('}}')) {
      const out = exprEnv.renderString('${{ (' + m[1] + ') | dump }}', ctx);
      if (out === '' || out === 'undefined') return undefined;
      return JSON.parse(out);
    }
    return v.includes('${{') ? exprEnv.renderString(v, ctx) : v;
  }
  if (Array.isArray(v)) return v.map(evalValue);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, evalValue(x)]));
  return v;
};

// ---- workspace = copy of the project
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'bwdeep-'));
fs.cpSync(projectDir, ws, { recursive: true, filter: s => !/\/(devhub|\.git)(\/|$)/.test(s) && !/(components|system)-OrderProcessing\.yaml$/.test(s) });

const regexOf = r => {
  if (typeof r === 'object' && r.regexPattern) return new RegExp(r.regexPattern, r.regexFlags ?? '');
  const p = RegexParser(r); return new RegExp(p.source, p.flags);
};
async function extract(inp) {
  const root = path.resolve(ws, inp.sourcePath || '');
  const out = {};
  for (const [key, p] of Object.entries(inp.extractParameters)) {
    try {
      const abs = f => { const a = path.resolve(root, f); if (!a.startsWith(ws)) throw new Error('path escapes workspace: ' + f); if (a.split(path.sep).includes('.git')) throw new Error('.git blocked'); return a; };
      if (p.type === 'xml') {
        const c = fs.readFileSync(abs(p.filePath), 'utf8');
        out[key] = jp.query(new XMLParser({ ignoreAttributes: false }).parse(c), p.jsonPath);
      } else if (p.type === 'json') {
        out[key] = jp.query(JSON.parse(fs.readFileSync(abs(p.filePath), 'utf8')), p.jsonPath);
      } else if (p.type === 'file') {
        out[key] = fs.readFileSync(abs(p.filePath), 'utf8').match(regexOf(p.regex)) ? Array.from(fs.readFileSync(abs(p.filePath), 'utf8').match(regexOf(p.regex))) : [];
      } else if (p.type === 'workspace') {
        const dir = abs(p.directoryPath || '');
        let paths = await glob(p.glob || '**/*', { cwd: dir });
        if (p.onlyName) paths = paths.map(x => x.split('/').at(-1));
        const re = regexOf(p.regex);
        out[key] = paths.filter(x => x.match(re)).sort();   // sorted here only for stable test output
      }
    } catch (e) { console.log(`   [extract] ${key}: ${e.message.split('\n')[0]}`); if (inp.failOnError) throw e; }
  }
  return out;
}

const skelRender = (src, dst, values) => {
  const env = mkEnv(new nunjucks.FileSystemLoader(src));
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(src)) {
    const rel = path.relative(src, f); const isNjk = rel.endsWith('.njk');
    const target = path.join(dst, isNjk ? rel.slice(0, -4) : rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, isNjk ? env.renderString(fs.readFileSync(f, 'utf8'), { values }) : fs.readFileSync(f));
  }
};

for (const s of tpl.spec.steps) {
  const input = evalValue(s.input);
  console.log(`-> step ${s.id} (${s.action})`);
  if (s.action === 'tibco:git:clone') console.log('   clone', input.repoUrl, 'branch', input.branch);
  else if (s.action === 'tibco:extract-parameters') { ctx.steps[s.id] = { output: await extract(input) }; }
  else if (s.action === 'fetch:template') {
    const dst = path.resolve(ws, input.targetPath);
    skelRender(path.resolve(templateDir, input.url), dst, input.values);
    console.log('   generated into', input.targetPath);
  }
  else if (s.action === 'tibco:git:push') console.log('   push branch', input.branch, '-', input.commitMessage);
  else if (s.action === 'catalog:register') { console.log('   register', input.catalogInfoUrl); ctx.steps[s.id] = { output: { entityRef: 'component:default/x' } }; }
}
const outDir = path.resolve(ws, params.outputFolder);
console.log('\n==== workspace output:', outDir);
for (const f of fs.readdirSync(outDir, { recursive: true })) console.log('  ', f);

// ---- validate entities with Backstage's own rules
const docs = yaml.parseAllDocuments(fs.readFileSync(path.join(outDir, 'catalog-info.yaml'), 'utf8'));
const policy = cm.EntityPolicies.allOf([new cm.DefaultNamespaceEntityPolicy(), new cm.FieldFormatEntityPolicy(), new cm.NoForeignRootFieldsEntityPolicy(), new cm.SchemaValidEntityPolicy()]);
let bad = 0; const kinds = {};
for (const d of docs) {
  if (d.errors.length) { console.log('YAML ERROR', d.errors[0].message); bad++; continue; }
  const e = d.toJS(); if (!e) continue;
  kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  try { await policy.enforce(e); } catch (err) { bad++; console.log(`INVALID ${e.kind}/${e.metadata?.name}: ${err.message}`); }
}
console.log('\nentities:', kinds, bad ? `\n${bad} PROBLEM(S)` : '\nALL ENTITIES VALID');
console.log('workspace kept at', ws);
