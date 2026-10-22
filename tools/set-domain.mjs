// At launch: put the site's real address everywhere the pages name it (canonical, hreflang, Open Graph, JSON-LD,
// robots.txt, sitemap.xml). Until then they use https://subrotato.vercel.app.
//   node tools/set-domain.mjs https://your-domain.example
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const to = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(to)) { console.error('Give the address as https://name.example (no path).'); process.exit(1); }
const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const now = readFileSync(join(pub, 'robots.txt'), 'utf8').match(/Sitemap: (https:\/\/[^/\s]+)/);
const old = now ? now[1] : 'https://subrotato.vercel.app';
let n = 0;
for (const f of readdirSync(pub).filter(f => /\.(html|txt|xml)$/.test(f))) {
  const s = readFileSync(join(pub, f), 'utf8'), t = s.split(old).join(to);
  if (t !== s) { writeFileSync(join(pub, f), t); n++; console.log('  ' + f); }
}
console.log(n ? 'Set ' + to + ' in ' + n + ' files (was ' + old + ').' : 'Nothing to change: ' + old + ' not found.');
