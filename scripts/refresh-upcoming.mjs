// Weekly release-date check for public/upcoming.json.
//   node scripts/refresh-upcoming.mjs [--dry-run] [--discover] [--file path] [--today YYYY-MM-DD]
//
// TV entries with a tvmazeId are re-read from TVMaze (one request each, no key). Everything else
// (movies, games) cannot be checked by a machine, so it is flagged for a human when its date has
// passed, is close, or has not been confirmed lately. Zero dependencies, hard caps on requests and time.
//
// --discover also looks for new titles: one request for TVMaze's full schedule adds popular season
// premieres on the services we cover, and one request per Wikipedia "original films" list suggests
// movies for a person to check (they are never added on their own). About 8 extra requests.
// Set REFRESH_CONTACT (a URL or address) to put a contact in the User-Agent, as Wikimedia asks.
import { readFileSync, writeFileSync, renameSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateData, classify, pruneExpired, mergeTvmaze, tvmazeUrl, createFetcher, BudgetError,
  renderReport, stringify, normalizeData, parseDate, daysBetween, whenOf,
  tvScheduleUrl, discoverTv, WIKI_FILM_PAGES, wikiParseUrl, parseWikiFilmRows, discoverMovies,
} from './lib/upcoming.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = n => argv.includes('--' + n);
const val = (n, d) => { const i = argv.lastIndexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const FILE = resolve(val('file', resolve(here, '..', 'public', 'upcoming.json')));
const REPORT = resolve(val('report', resolve(here, '.report.md')));
const TODAY = val('today', new Date().toISOString().slice(0, 10));
const MAX_REQUESTS = +val('max-requests', 140);         // hard cap on calls per run (TVMaze plus Wikipedia); the list has about 90 shows
const DEADLINE_MS = +val('deadline-ms', 4 * 60 * 1000); // stop checking after this long, whatever is left
const STAMP_DAYS = +val('stamp-days', 14);              // a run that changes nothing only rewrites the file this often
const GAP_MS = +val('gap-ms', 600);                    // pause between requests (TVMaze allows 20 per 10 s)
const RETRY_WAIT_S = +val('retry-wait-s', 5);          // pause before the one retry after a 429 or 5xx
const BASE = process.env.TVMAZE_BASE || 'https://api.tvmaze.com';
const WIKI = process.env.WIKI_BASE || 'https://en.wikipedia.org';
const DISCOVER = flag('discover');
const CONTACT = String(process.env.REFRESH_CONTACT || '').replace(/[^\w.:/@+-]/g, '').slice(0, 120);
const MAX_FAILS = 3;                                    // stop after this many failures in a row

if (!parseDate(TODAY) || parseDate(TODAY).month) { console.error('--today must be YYYY-MM-DD'); process.exit(2); }

const before = JSON.parse(readFileSync(FILE, 'utf8'));
const problems = validateData(before);
if (problems.length) { console.error('upcoming.json is invalid:\n- ' + problems.join('\n- ')); process.exit(1); }

const started = Date.now();
const fetcher = createFetcher({
  maxRequests: MAX_REQUESTS, minGapMs: GAP_MS, retryWaitSec: RETRY_WAIT_S,
  userAgent: 'sub-rotator-refresh/1.1 (weekly release-date check' + (CONTACT ? '; ' + CONTACT : '') + ') bot',
});
const changes = [], unchecked = [], checkedIds = new Set();
let items = before.items.map(i => Object.assign({}, i));
let fails = 0, halted = null;

const { kept, removed } = pruneExpired(items, TODAY);
items = kept;

for (let i = 0; i < items.length; i++) {
  const it = items[i];
  if (it.kind !== 'tv' || !it.tvmazeId) continue;
  if (halted) { unchecked.push({ title: it.title, reason: halted }); continue; }
  if (Date.now() - started > DEADLINE_MS) { halted = 'run time limit reached'; unchecked.push({ title: it.title, reason: halted }); continue; }
  try {
    const res = await fetcher.get(tvmazeUrl(it.tvmazeId, BASE));
    if (res.status === 404) { unchecked.push({ title: it.title, reason: 'TVMaze no longer has show ' + it.tvmazeId }); fails = 0; continue; }
    if (!res.json) {
      unchecked.push({ title: it.title, reason: 'TVMaze answered ' + res.status });
      if (++fails >= MAX_FAILS) halted = 'stopped after ' + MAX_FAILS + ' failures in a row';
      continue;
    }
    fails = 0;
    const m = mergeTvmaze(it, res.json, TODAY);
    items[i] = m.item; checkedIds.add(it.id);
    if (m.changes.length) changes.push({ title: it.title, notes: m.changes });
  } catch (e) {
    unchecked.push({ title: it.title, reason: e instanceof BudgetError ? e.message : 'network error (' + (e.message || e) + ')' });
    if (e instanceof BudgetError) halted = e.message;
    else if (++fails >= MAX_FAILS) halted = 'stopped after ' + MAX_FAILS + ' failures in a row';
  }
}

// New titles: TV premieres are added (TVMaze has the date and the episodes), films only suggested.
let added = [], ideas = [];
if (DISCOVER) {
  // Same rules as the TV checks: the request cap, 3 failures in a row, and the run's time limit. A request's
  // timeout (and its one retry) always fits in the time that is left.
  const tryGet = async (what, url, wantMs) => {
    if (halted) { unchecked.push({ title: what, reason: halted }); return null; }
    const left = DEADLINE_MS - (Date.now() - started);
    if (left < 5000) { halted = 'run time limit reached'; unchecked.push({ title: what, reason: halted }); return null; }
    const fail = reason => { unchecked.push({ title: what, reason }); if (++fails >= MAX_FAILS) halted = 'stopped after ' + MAX_FAILS + ' failures in a row'; };
    try {
      const res = await fetcher.get(url, { timeoutMs: Math.max(2000, Math.min(wantMs || 15000, Math.floor((left - 2500) / 2))) });
      if (!res.json) { fail('answered ' + res.status); return null; }
      fails = 0;
      return res.json;
    } catch (e) {
      if (e instanceof BudgetError) { halted = e.message; unchecked.push({ title: what, reason: e.message }); }
      else fail('network error (' + (e.message || e) + ')');
      return null;
    }
  };
  const skip = before.skip;
  const schedule = await tryGet('New shows (TVMaze schedule)', tvScheduleUrl(BASE), 60000);
  if (Array.isArray(schedule)) { added = discoverTv(schedule, items, TODAY, { skip }); items = items.concat(added); }
  else if (schedule) unchecked.push({ title: 'New shows (TVMaze schedule)', reason: 'unexpected answer' });
  const pages = [];
  for (const [service, page] of WIKI_FILM_PAGES) {
    const what = 'New films (' + page + ')', j = await tryGet(what, wikiParseUrl(page, WIKI));
    if (j && j.parse && typeof j.parse.wikitext === 'string') pages.push({ service, page, rows: parseWikiFilmRows(j.parse.wikitext) });
    else if (j) unchecked.push({ title: what, reason: 'Wikipedia said ' + ((j.error && j.error.code) || 'nothing usable') });   // e.g. missingtitle, ratelimited, maxlag
  }
  ideas = discoverMovies(pages, items, TODAY, { skip });
}

// Anything a machine did not just confirm gets the date-based flags.
const flags = [];
items.forEach(it => {
  if (checkedIds.has(it.id)) return;
  const f = classify(it, TODAY);
  if (f) flags.push({ title: it.title, date: whenOf(it, parseDate(TODAY).ms), code: f.code, message: f.message });   // a season under way: its last game
});

const next = { checked: TODAY, items };
if (Array.isArray(before.skip)) next.skip = before.skip;
const strip = d => JSON.stringify({ items: normalizeData(d).items.map(i => Object.assign({}, i, { checked: undefined })) });
const substantive = strip(before) !== strip(next);
const stampAge = daysBetween(parseDate(before.checked).ms, parseDate(TODAY).ms);
const write = substantive || stampAge >= STAMP_DAYS;

const errs = validateData(next);
if (errs.length) { console.error('refusing to write an invalid file:\n- ' + errs.join('\n- ')); process.exit(1); }

const report = renderReport({ today: TODAY, changes, removed, flags, unchecked, added, ideas, wiki: DISCOVER, requests: fetcher.count });
writeFileSync(REPORT, report);
console.log(report);

let changed = false;
if (write && !flag('dry-run')) {
  const out = stringify(next);
  if (out !== readFileSync(FILE, 'utf8')) {
    const tmp = FILE + '.tmp';
    writeFileSync(tmp, out); renameSync(tmp, FILE); changed = true;
  }
}
console.log(flag('dry-run') ? '(dry run: nothing written)' : changed ? 'Wrote ' + FILE : 'No file change needed.');

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, 'changed=' + changed + '\nsubstantive=' + (changed && substantive) + '\nflags=' + flags.length + '\nideas=' + ideas.length + '\nunchecked=' + unchecked.length + '\n');
}
// A run that could not check anything it should have is a failure worth an email, but a quiet week is not.
if (halted && !checkedIds.size && items.some(i => i.kind === 'tv' && i.tvmazeId)) process.exit(1);
