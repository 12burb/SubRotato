// Tiny static server for local development: serves public/ at http://localhost:5173 (override with PORT; PORT=0 picks a free port).
// Zero dependencies. Local only: it binds to 127.0.0.1 so nothing on your network can reach it.
// It sends the same headers as production: the "headers" rules in vercel.json, read on every request, so the
// Content-Security-Policy is enforced here too. Only Cache-Control stays its own (no-store), so edits show at once.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cspOf, scriptSources, withScriptSrc } from '../tools/csp-hash.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const vercelFile = resolve(root, '..', 'vercel.json');
const port = process.env.PORT ? Number(process.env.PORT) : 5173;
const types = {
  '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

// Vercel's "source" is a path-to-regexp pattern. This reads the parts vercel.json uses: literal paths ("/upcoming.json"),
// regex groups ("/(.*)", "/fonts/(.*)") and :name segments. Anything else stops the server, so a rule is never skipped quietly.
export function sourceToRegex(src) {
  let out = '';
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '(') {
      let depth = 0, j = i;
      for (; j < src.length; j++) { if (src[j] === '\\') { j++; continue; } if (src[j] === '(') depth++; else if (src[j] === ')' && --depth === 0) break; }
      if (j >= src.length) throw new Error('vercel.json source ' + src + ': unclosed (');
      out += src.slice(i, j + 1); i = j + 1;
    } else if (c === ':' && /[A-Za-z_]/.test(src[i + 1] || '')) {
      const name = /^:[A-Za-z_]\w*/.exec(src.slice(i))[0];
      out += '([^/]+)'; i += name.length;
    } else if (/[*+?{}[\]|^$\\]/.test(c)) {
      throw new Error('scripts/serve.mjs cannot read the vercel.json source "' + src + '" yet: teach sourceToRegex its "' + c + '"');
    } else { out += c === '.' ? '\\.' : c; i++; }
  }
  return new RegExp('^' + out + '$');
}

// The headers vercel.json gives a path: every matching rule in order, a later rule winning for the same header.
export function headersFor(vercel, pathname) {
  const out = {};
  for (const rule of vercel.headers || []) {
    if (!sourceToRegex(rule.source).test(pathname)) continue;
    for (const h of rule.headers) {
      for (const k of Object.keys(out)) if (k.toLowerCase() === h.key.toLowerCase()) delete out[k];
      out[h.key] = h.value;
    }
  }
  return out;
}

let warned = '';
async function rules(pathname) {
  const vercel = JSON.parse(await readFile(vercelFile, 'utf8'));
  if (/(^|\/|\.html?)$/i.test(pathname)) {             // a page: say so when the script hash is out of date, or the page will not run
    let msg = '';
    try { const now = cspOf(vercel); if (withScriptSrc(now, scriptSources()) !== now) msg = 'The Content-Security-Policy in vercel.json is stale, so the app script is blocked. Run: node tools/csp-hash.mjs'; }
    catch (e) { msg = 'CSP check failed: ' + e.message; }
    if (msg && msg !== warned) console.warn(msg);
    warned = msg;
  }
  return headersFor(vercel, pathname);
}

// vercel.json's headers with ours on top (same name in any case: ours wins).
function withOwn(extra, own) {
  const out = { ...extra };
  for (const k of Object.keys(own)) { for (const x of Object.keys(out)) if (x.toLowerCase() === k.toLowerCase()) delete out[x]; out[k] = own[k]; }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer(async (req, res) => {
    let p, extra;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
    catch (e) { res.writeHead(400, { 'Cache-Control': 'no-store' }); return res.end('Bad request'); }
    try { extra = await rules(p); }
    catch (e) { console.error('vercel.json: ' + e.message); res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end('vercel.json could not be read: ' + e.message); }
    try {
      if (p.endsWith('/')) p += 'index.html';
      const file = normalize(join(root, p));
      if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403, withOwn(extra, { 'Cache-Control': 'no-store' })); return res.end('Forbidden'); }
      const body = await readFile(file);
      res.writeHead(200, withOwn(extra, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }));
      res.end(body);
    } catch (e) {
      res.writeHead(e && e.code === 'ENOENT' ? 404 : 400, withOwn(extra, { 'Cache-Control': 'no-store' })); res.end(e && e.code === 'ENOENT' ? 'Not found' : 'Bad request');
    }
  });
  server.listen(port, '127.0.0.1', () => console.log('Sub Rotator running at http://localhost:' + server.address().port));
}
