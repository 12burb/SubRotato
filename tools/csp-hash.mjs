// Keeps the Content-Security-Policy in vercel.json in step with the pages.
//   node tools/csp-hash.mjs           rewrite script-src in vercel.json
//   node tools/csp-hash.mjs --check   exit 1 if vercel.json is stale (writes nothing)
// The policy lets a script run only when its sha256 is listed in script-src. So every edit to the inline
// <script> in public/app.html changes the hash, and the browser refuses the old one: run this after each edit
// (tests/e2e.test.js fails until you do). It hashes every executable inline <script> in public/**/*.html.
// JSON-LD and other data blocks are not run, so they need no hash. A <script src> is refused here:
// script-src lists no hosts, so it would never load.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_TEXT = /^(script|style|textarea|title|xmp|iframe|noembed|noframes)$/;   // their text is not markup
const JS_TYPES = new Set(['', 'module', 'importmap', 'speculationrules', 'application/ecmascript', 'application/javascript',
  'application/x-ecmascript', 'application/x-javascript', 'text/ecmascript', 'text/javascript', 'text/javascript1.0',
  'text/javascript1.1', 'text/javascript1.2', 'text/javascript1.3', 'text/javascript1.4', 'text/javascript1.5',
  'text/jscript', 'text/livescript', 'text/x-ecmascript', 'text/x-javascript']);

function attrsOf(tag) {
  const out = {}, body = tag.replace(/^<[^\s/>]+/, '').replace(/\/?>$/, '');
  for (const m of body.matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

// Every <script> in a page, as the browser's parser sees it: { attrs, text, executable }.
// Line breaks are normalized first (CRLF and CR become LF), as the browser does before it hashes.
export function scriptsIn(html) {
  html = html.replace(/\r\n?/g, '\n');
  const out = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt + 4); i = e < 0 ? html.length : e + 3; continue; }
    const m = /^<([a-zA-Z][^\s/>]*)/.exec(html.slice(lt, lt + 64));
    if (!m) { i = lt + 1; continue; }
    let j = lt + m[0].length;                                   // the end of the start tag; a '>' inside a quoted value does not end it
    while (j < html.length && html[j] !== '>') {
      if (html[j] === '=') {
        j++; while (/\s/.test(html[j] || '')) j++;
        if (html[j] === '"' || html[j] === "'") { const e = html.indexOf(html[j], j + 1); j = e < 0 ? html.length : e + 1; continue; }
      } else j++;
    }
    const tag = html.slice(lt, j + 1), name = m[1].toLowerCase();
    i = j + 1;
    if (!RAW_TEXT.test(name)) continue;
    const rest = html.slice(i), close = new RegExp('</' + name + '[\\s/>]', 'i').exec(rest);
    const text = close ? rest.slice(0, close.index) : rest;
    i += text.length;
    if (name !== 'script') continue;
    if (/<!--/.test(text)) throw new Error('a <script> holds "<!--": the browser may read it differently, so it cannot be hashed safely');
    const attrs = attrsOf(tag), type = (attrs.type ?? '').split(';')[0].trim().toLowerCase();
    out.push({ attrs, text, executable: JS_TYPES.has(type) });
  }
  return out;
}

export const sha256 = text => "'sha256-" + createHash('sha256').update(text, 'utf8').digest('base64') + "'";

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? htmlFiles(join(dir, e.name)) : /\.html?$/i.test(e.name) ? [join(dir, e.name)] : []);
}

// The script-src sources the site needs: one hash per executable inline script, sorted, no repeats.
export function scriptSources(root = ROOT) {
  const hashes = new Set();
  for (const file of htmlFiles(join(root, 'public')).sort()) {
    for (const s of scriptsIn(readFileSync(file, 'utf8'))) {
      if (!s.executable) continue;
      if ('src' in s.attrs) throw new Error(relative(root, file) + ': <script src="' + s.attrs.src + '"> would be blocked: script-src lists no hosts');
      hashes.add(sha256(s.text));
    }
  }
  return hashes.size ? [...hashes].sort() : ["'none'"];
}

export function withScriptSrc(policy, sources) {
  const parts = policy.split(';').map(x => x.trim()).filter(Boolean);
  const k = parts.findIndex(p => /^script-src(\s|$)/i.test(p));
  if (k < 0) throw new Error('the policy has no script-src');
  parts[k] = 'script-src ' + sources.join(' ');
  return parts.join('; ');
}

// The Content-Security-Policy value in vercel.json's "/(.*)" block.
export function cspOf(vercel) {
  const block = (vercel.headers || []).find(h => h.source === '/(.*)');
  const h = block && block.headers.find(x => x.key.toLowerCase() === 'content-security-policy');
  if (!h) throw new Error('vercel.json has no Content-Security-Policy in its "/(.*)" headers');
  return h.value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = join(ROOT, 'vercel.json'), raw = readFileSync(file, 'utf8');
  const now = cspOf(JSON.parse(raw)), next = withScriptSrc(now, scriptSources());
  if (now === next) { console.log('vercel.json is up to date: ' + next.match(/script-src[^;]*/)[0]); process.exit(0); }
  if (process.argv.includes('--check')) { console.error('vercel.json is stale. Run: node tools/csp-hash.mjs\n  has:  ' + now + '\n  want: ' + next); process.exit(1); }
  const from = JSON.stringify(now);
  if (raw.split(from).length !== 2) throw new Error('could not find the policy text once in vercel.json');
  writeFileSync(file, raw.replace(from, () => JSON.stringify(next)));
  console.log('vercel.json updated: ' + next.match(/script-src[^;]*/)[0]);
}
