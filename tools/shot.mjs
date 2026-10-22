// Screenshot a page with headless Edge (DevTools protocol, no dependencies).
//   node tools/shot.mjs <file.html or http(s) url> <out.png> <width> [height=full] [light|dark] [css selector to clip to]
// Used for the link previews and the phone icon (tools/og-card.html, tools/icon-180.html) and to check layouts.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [, , target, out, W = '1200', H = '0', theme = 'light', sel = ''] = process.argv;
const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 600);
const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'edgeshot-')), '--no-first-run', '--disable-extensions', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); if (targets.some(t => t.type === 'page')) break; } catch (e) {} await sleep(250); }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
let id = 0; const pending = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };
await send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H || 900, deviceScaleFactor: 1, mobile: +W < 768 });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme === 'dark' ? 'dark' : 'light' }] });
await send('Page.navigate', { url: /^https?:/.test(target) ? target : pathToFileURL(resolve(target)).href });
for (let i = 0; i < 80; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(100); }
await ev('document.fonts.ready.then(()=>1)'); await sleep(400);
let clip;
if (sel) { clip = await ev('(()=>{const e=document.querySelector(' + JSON.stringify(sel) + ');if(!e)return null;const r=e.getBoundingClientRect();return{x:0,y:Math.max(0,r.top+scrollY-12),width:' + (+W) + ',height:Math.ceil(r.height)+24,scale:1}})()'); if (!clip) { console.error('no element ' + sel); process.exit(1); } }
else clip = { x: 0, y: 0, width: +W, height: +H || await ev('document.documentElement.scrollHeight'), scale: 1 };
const sideways = await ev('document.documentElement.scrollWidth>innerWidth');
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('wrote ' + out + ' ' + clip.width + 'x' + clip.height + (sideways ? '  WARNING: the page scrolls sideways' : ''));
ws.close(); edge.kill();
