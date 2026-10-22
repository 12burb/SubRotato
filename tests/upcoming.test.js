// Tests for the weekly release-date refresh: the pure logic, the polite fetcher, and the whole script
// run offline against a local fake of TVMaze. Nothing here touches the network.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
const lib = () => import(pathToFileURL(path.join(root, 'scripts', 'lib', 'upcoming.mjs')).href);
const SCRIPT = path.join(root, 'scripts', 'refresh-upcoming.mjs');

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const item = (over) => Object.assign({ id: 'a', title: 'A', kind: 'game', date: '2026-11-19', confidence: 'unconfirmed', checked: '2026-10-01' }, over || {});
const tvItem = (over) => item(Object.assign({ id: 'show', title: 'Show', kind: 'tv', tvmazeId: 1, service: 'netflix', channel: 'Netflix', hours: null }, over || {}));
const ep = (season, number, airdate, runtime) => ({ season, number, airdate, runtime });
const show = (over, eps) => Object.assign({ id: 1, status: 'Running', premiered: null, runtime: null, averageRuntime: null, webChannel: { name: 'Netflix' }, network: null, _embedded: { episodes: eps || [] } }, over || {});

/* ---------- dates ---------- */
test('parseDate accepts real days and months and rejects impossible ones', async () => {
  const L = await lib();
  assert.strictEqual(L.parseDate('2026-11-19').ms, Date.UTC(2026, 10, 19));
  assert.strictEqual(L.parseDate('2026-11').month, true);
  ['2026-02-30', '2026-13-01', '2026-11-5', '11/19/2026', '', null, '2026-00', '1999-01-01'].forEach(s => assert.strictEqual(L.parseDate(s), null, String(s)));
  assert.strictEqual(L.parseDate('2028-02-29').ms, Date.UTC(2028, 1, 29));
  assert.strictEqual(L.parseDate('2027-02-29'), null);
});
test('dueMs: a month-only date is due at the end of that month', async () => {
  const L = await lib();
  assert.strictEqual(L.dueMs('2026-12'), Date.UTC(2026, 11, 31));
  assert.strictEqual(L.dueMs('2028-02'), Date.UTC(2028, 1, 29));
  assert.strictEqual(L.dueMs('2026-11-19'), Date.UTC(2026, 10, 19));
});

/* ---------- validation ---------- */
test('the shipped public/upcoming.json is valid', async () => {
  const L = await lib();
  const data = JSON.parse(fs.readFileSync(path.join(root, 'public', 'upcoming.json'), 'utf8'));
  assert.deepStrictEqual(L.validateData(data), []);
  assert.strictEqual(L.stringify(data), fs.readFileSync(path.join(root, 'public', 'upcoming.json'), 'utf8'), 'file is in the canonical format the script writes');
});
test('validateData names each kind of mistake', async () => {
  const L = await lib();
  const v = items => L.validateData({ checked: '2026-10-05', items });
  const has = (errs, re) => assert.ok(errs.some(e => re.test(e)), re + ' in ' + JSON.stringify(errs));
  has(v([item({ typo: 1 })]), /unknown key "typo"/);
  has(v([item({ hoursSource: '' })]), /hoursSource must be/);
  const tvi = o => item(Object.assign({ kind: 'tv' }, o));
  has(v([tvi({ episodes: 0 })]), /episodes must be/);
  has(v([tvi({ release: 'daily' })]), /release must be/);
  has(v([tvi({ release: 'all', firstDrop: 2 })]), /firstDrop/);
  has(v([tvi({ release: 'weekly', episodes: 8, firstDrop: 9 })]), /firstDrop/);
  has(v([item({ episodes: 8 })]), /only apply to kind "tv"/);
  assert.deepStrictEqual(v([tvi({ episodes: 12, release: 'weekly', firstDrop: 2 })]), [], 'a weekly season with two on day one is fine');
  has(v([tvi({ release: 'all', perWeek: 2 })]), /perWeek/);
  has(v([tvi({ release: 'weekly', perWeek: 8 })]), /perWeek/);
  has(v([item({ perWeek: 2 })]), /only apply to kind "tv"/);
  assert.deepStrictEqual(v([tvi({ episodes: 8, release: 'weekly', firstDrop: 2, perWeek: 2 })]), [], 'two every week is fine');
  assert.deepStrictEqual(v([tvi({ date: '2026-10-13', episodes: 8, release: 'weekly', firstDrop: 2, finale: '2026-11-10' })]), [], 'uneven weeks with an announced finale are fine');
  has(v([tvi({ episodes: 8, release: 'weekly', finale: 'Nov 10' })]), /finale/);
  has(v([tvi({ episodes: 8, release: 'weekly', finale: '2026-11-31' })]), /finale/);
  has(v([tvi({ episodes: 8, release: 'all', finale: '2026-11-10' })]), /finale/);
  has(v([tvi({ release: 'weekly', finale: '2026-11-10' })]), /finale/);
  has(v([tvi({ release: 'weekly', tvmazeId: 5 })]), /needs season/);
  assert.deepStrictEqual(v([tvi({ anime: true }), item({ id: 'm1', kind: 'movie', anime: true })]), [], 'anime shows and movies');
  has(v([item({ anime: true })]), /anime is true/);
  has(v([tvi({ anime: 'yes' })]), /anime is true/);
  assert.deepStrictEqual(v([tvi({ release: 'weekly', tvmazeId: 5, season: 2 })]), [], 'a weekly show with its season is fine');
  has(v([item({ hours: null, hoursSource: 'https://howlongtobeat.com/game/1' })]), /hoursSource needs hours/);
  assert.deepStrictEqual(v([item({ hours: 40, hoursSource: 'HowLongToBeat, Main + Extras: https://howlongtobeat.com/game/1' })]), [], 'a game with hours and where they came from is fine');
  has(v([item(), item()]), /duplicate id/);
  has(v([item({ date: '2026-02-30' })]), /real YYYY-MM-DD/);
  has(v([item({ confidence: 'sure' })]), /confidence/);
  has(v([item({ tvmazeId: 5 })]), /only applies to kind "tv"/);
  const noId = tvItem({ season: 2 }); delete noId.tvmazeId;
  has(v([noId]), /season needs a tvmazeId/);
  has(v([item({ hours: 0 })]), /hours/);
  has(v([item({ service: 'blockbuster' })]), /unknown service/);
  has(v([item({ id: 'Bad Id' })]), /slug/);
  has(v([item({ platforms: 'PS5' })]), /platforms/);
  has(L.validateData({ checked: 'soon', items: [] }), /checked/);
  has(L.validateData({ checked: '2026-10-05', items: {} }), /array/);
  has(L.validateData([]), /object/);
  assert.deepStrictEqual(v([item({ hours: null, platforms: ['PS5'], service: null })]), []);
  has(v([item({ subs: ['gp-ultimate'] })]), /subs must be a list of distinct catalog tier ids/);
  has(v([item({ subs: ['gp-ult', 'gp-ult'] })]), /subs must be a list of distinct/);
  has(v([item({ subs: 'gp-ult' })]), /subs must be a list/);
  has(v([item({ subsNote: 5 })]), /subsNote must be a string/);
  has(v([item({ subsNoteEs: 'Temporada 2' })]), /subsNoteEs is subsNote in Spanish/);
  assert.deepStrictEqual(v([item({ subs: ['gp-ult', 'gp-pc'], subsNote: 'Day one' }), item({ id: 'b', subs: [] })]), [], 'an empty list means buy only');
});
test('the tier ids the script accepts are exactly the app catalog ids', async () => {
  const L = await lib();
  const html = fs.readFileSync(path.join(root, 'public', 'app.html'), 'utf8');
  const cat = html.match(/const CATALOG=\[([\s\S]*?)\n\];/)[1];
  const ids = [...cat.matchAll(/id:'([^']+)'/g)].map(m => m[1]);
  assert.deepStrictEqual(L.CATALOG_IDS, ids);
});

test('LOWEST_TIER matches the app: the cheapest plan of each streaming service', async () => {
  const L = await lib();
  const html = fs.readFileSync(path.join(root, 'public', 'app.html'), 'utf8');
  const fd = Function('return ' + html.match(/const FAMILY_DEFAULT=(\{[^}]*\})/)[1])();
  Object.keys(L.LOWEST_TIER).forEach(k => assert.strictEqual(L.LOWEST_TIER[k], fd[k], k));
  assert.deepStrictEqual(Object.keys(L.LOWEST_TIER).sort(), L.SERVICES.filter(x => x !== 'gamepass' && x !== 'psplus').sort());
});

/* ---------- flags and pruning ---------- */
test('classify flags dates that passed, are close and unchecked, or are stale, most urgent first', async () => {
  const L = await lib();
  const c = (date, checked, today) => L.classify(item({ date, checked }), today || '2026-10-20');
  assert.strictEqual(c('2026-10-19', '2026-10-19').code, 'past');
  assert.strictEqual(c('2026-10-20', '2026-10-19'), null, 'due today and checked yesterday is fine');
  assert.strictEqual(c('2026-11-10', '2026-10-01').code, 'recheck-soon');
  assert.strictEqual(c('2026-11-10', '2026-10-15'), null);
  assert.strictEqual(c('2027-03-01', '2026-09-01').code, 'stale');
  assert.strictEqual(c('2027-03-01', '2026-10-10'), null);
  assert.strictEqual(c('2026-10', '2026-10-19'), null, 'a month-only date is not past until the month ends');
  assert.strictEqual(c('2026-09', '2026-10-19').code, 'past');
  assert.match(c('2026-10-19', '2026-10-19').message, /1 day ago/);
});
test('sports seasons: the checks, and a season under way is judged by its last game', async () => {
  const U = await lib();
  const base = { id: 'pl', title: 'Premier League', kind: 'sport', sport: 'Soccer', service: 'peacock', subs: ['peacock'], date: '2026-08-21', ends: '2027-05-23', gamesPerWeek: 1, gameHours: 2, confidence: 'confirmed', checked: '2026-10-20' };
  assert.deepStrictEqual(U.validateData({ checked: '2026-10-20', items: [base] }), []);
  const bad = (over, re) => { const e = U.validateData({ checked: '2026-10-20', items: [Object.assign({}, base, over)] }); assert.ok(e.some(x => re.test(x)), JSON.stringify(e)); };
  bad({ ends: '2026-08-01' }, /ends/);
  bad({ ends: undefined }, /ends/);
  bad({ gamesPerWeek: 0 }, /gamesPerWeek/);
  bad({ gameHours: 12 }, /gameHours/);
  bad({ sport: '' }, /sport is/);
  bad({ subs: [] }, /needs subs/);
  bad({ date: '2026-08' }, /first game/);
  const tvWithEnds = U.validateData({ checked: '2026-10-20', items: [{ id: 'x', title: 'X', kind: 'tv', date: '2026-11-01', ends: '2026-12-01', confidence: 'confirmed', checked: '2026-10-20' }] });
  assert.ok(tvWithEnds.some(x => /only apply to kind "sport"/.test(x)), JSON.stringify(tvWithEnds));
  // under way: not "past", and not pruned until its last game is a month gone
  assert.strictEqual(U.classify(base, '2026-10-20'), null);
  assert.strictEqual(U.pruneExpired([base], '2026-12-01').kept.length, 1);
  assert.strictEqual(U.pruneExpired([base], '2027-06-30').removed.length, 1);
  assert.strictEqual(U.classify(base, '2027-05-30').code, 'past');
});
test('sports seasons: the weekly report names a season under way by its last game', async () => {
  const L = await lib();
  const s = { id: 'b', title: 'Big Ten', kind: 'sport', sport: 'Football', service: 'peacock', subs: ['peacock'], date: '2026-08-29', ends: '2026-11-28', gamesPerWeek: 1, gameHours: 3.5, confidence: 'confirmed', checked: '2026-11-01' };
  assert.match(L.classify(s, '2026-12-15').message, /^The last game was 17 days ago/);
  assert.match(L.classify(s, '2026-11-20').message, /^Last game in 8 days/);
  assert.strictEqual(L.whenOf(s, L.parseDate('2026-12-15').ms), '2026-11-28');
});
test('pruneExpired keeps a release for 30 days and drops it on day 31', async () => {
  const L = await lib();
  const items = [item({ id: 'a', date: '2026-09-20' }), item({ id: 'b', date: '2026-09-19' }), item({ id: 'c', date: '2026-12' })];
  const r = L.pruneExpired(items, '2026-10-20');
  assert.deepStrictEqual(r.kept.map(i => i.id), ['a', 'c']);
  assert.deepStrictEqual(r.removed.map(i => i.id), ['b']);
});

/* ---------- TVMaze merge ---------- */
test('channelToService maps streaming names and leaves the rest unknown', async () => {
  const L = await lib();
  [['Netflix', 'netflix'], ['Disney+', 'disney'], ['FX', 'hulu'], ['HBO Max', 'max'], ['Max', 'max'], ['Apple TV+', 'apple'], ['Paramount+', 'paramount'], ['Crunchyroll', 'crunchy'], ['Hulu', 'hulu'], ['Peacock', 'peacock']]
    .forEach(([n, id]) => assert.strictEqual(L.channelToService(n), id, n));
  [['Prime Video', 'prime'], ['Viki', 'viki'], ['KOCOWA', 'kocowa'], ['ViX', 'vix'], ['BritBox', 'britbox'], ['Acorn TV', 'acorn']].forEach(([n, id]) => assert.strictEqual(L.channelToService(n), id, n));
  ['Tubi', 'YouTube', 'Maxim', '', null].forEach(n => assert.strictEqual(L.channelToService(n), null, String(n)));
});
test('mergeTvmaze: a new series takes its first air date, total hours, and an unconfirmed flag while in development', async () => {
  const L = await lib();
  const eps = [ep(1, 1, '2026-10-20', 30), ep(1, 2, '2026-10-20', 30), ep(1, 3, '2026-10-20', 30), ep(1, 4, '2026-10-20', 30)];
  const orig = tvItem({ date: '2026-12-01', confidence: 'confirmed', channel: 'Hulu', service: 'hulu' });
  const copy = JSON.parse(JSON.stringify(orig));
  const r = L.mergeTvmaze(orig, show({ status: 'In Development' }, eps), '2026-10-06');
  assert.deepStrictEqual(orig, copy, 'input is not mutated');
  assert.strictEqual(r.item.date, '2026-10-20');
  assert.strictEqual(r.item.confidence, 'unconfirmed');
  assert.strictEqual(r.item.channel, 'Netflix');
  assert.strictEqual(r.item.service, 'netflix');
  assert.strictEqual(r.item.hours, 2);
  assert.strictEqual(r.item.checked, '2026-10-06');
  assert.ok(r.changes.some(c => /^date: 2026-12-01 -> 2026-10-20/.test(c)), r.changes.join('|'));
  assert.strictEqual(L.mergeTvmaze(r.item, show({ status: 'Running' }, eps), '2026-10-13').item.confidence, 'confirmed');
});
test('mergeTvmaze: a date a person confirmed stays confirmed while TVMaze, calling the show "In Development", has the same date', async () => {
  const L = await lib();
  const eps = [ep(1, 1, '2026-12-25', 60)];
  const same = L.mergeTvmaze(tvItem({ date: '2026-12-25', confidence: 'confirmed' }), show({ status: 'In Development' }, eps), '2026-10-11');
  assert.strictEqual(same.item.confidence, 'confirmed');
  assert.deepStrictEqual(same.changes, []);
  const moved = L.mergeTvmaze(tvItem({ date: '2026-12-18', confidence: 'confirmed' }), show({ status: 'In Development' }, eps), '2026-10-11');
  assert.deepStrictEqual([moved.item.date, moved.item.confidence], ['2026-12-25', 'unconfirmed'], 'a new date from TVMaze alone is not confirmed');
  assert.strictEqual(L.mergeTvmaze(tvItem({ date: '2026-12-25', confidence: 'confirmed' }), show({ status: 'To Be Determined' }, eps), '2026-10-11').item.confidence, 'confirmed');
});
test('mergeTvmaze: a season number selects that season for the date and the hours', async () => {
  const L = await lib();
  const eps = [ep(1, 1, '2022-01-01', 60), ep(1, 2, '2022-01-08', 60), ep(2, 1, '2026-12-05', 15), ep(2, 2, '2026-12-12', 15), ep(2, 3, '2026-12-19', 15), ep(2, 4, '2026-12-26', 15)];
  const r = L.mergeTvmaze(tvItem({ season: 2, date: '2026-11' }), show({}, eps), '2026-10-06');
  assert.strictEqual(r.item.date, '2026-12-05');
  assert.strictEqual(r.item.hours, 1);
  const wrong = L.mergeTvmaze(tvItem({ season: 3 }), show({ premiered: '2022-01-01' }, eps), '2026-10-06');
  assert.strictEqual(wrong.item.date, '2026-11-19', 'no episodes in that season: keep the date, never fall back to the series premiere');
  const undated = L.mergeTvmaze(tvItem({ season: 3, date: '2027-03', confidence: 'rumored' }), show({ status: 'Running' }, eps), '2026-10-06');
  assert.strictEqual(undated.item.confidence, 'rumored', 'a season TVMaze has not dated is not "confirmed"');
  assert.ok(!undated.changes.some(c => /^confidence/.test(c)));
});
test('mergeTvmaze: hours are only set when every episode length is known', async () => {
  const L = await lib();
  const eps = [1, 2, 3, 4].map(n => ep(1, n, '2026-10-20', null));
  assert.strictEqual(L.mergeTvmaze(tvItem({ hours: 7 }), show({}, eps), '2026-10-06').item.hours, 7, 'unknown lengths keep the old hours');
  assert.strictEqual(L.mergeTvmaze(tvItem({ hours: 7 }), show({ averageRuntime: 30 }, eps), '2026-10-06').item.hours, 2, 'average runtime fills the gaps');
  const mixed = [ep(1, 1, '2026-10-20', 60), ep(1, 2, '2026-10-20', null), ep(1, 3, '2026-10-20', 60), ep(1, 4, '2026-10-20', 60)];
  assert.strictEqual(L.mergeTvmaze(tvItem({ hours: 7 }), show({}, mixed), '2026-10-06').item.hours, 7, 'a half-known list never lowers the total');
});
test('mergeTvmaze: a season still airing with fewer episodes listed than the season before leaves hours alone', async () => {
  const L = await lib();
  const s1 = [1, 2, 3, 4, 5, 6, 7, 8].map(n => ep(1, n, '2025-10-0' + (n % 9 || 1), 60));
  const s2 = [ep(2, 1, '2026-10-14', 71), ep(2, 2, '2026-10-14', 70), ep(2, 3, '2026-10-21', 60), ep(2, 4, '2026-10-28', 60), ep(2, 5, '2026-11-04', 60)];
  assert.strictEqual(L.mergeTvmaze(tvItem({ season: 2, hours: null }), show({}, s1.concat(s2)), '2026-10-11').item.hours, null, '5 of 8 listed is not the season');
  const full = s2.concat([6, 7, 8].map(n => ep(2, n, '2026-11-1' + n, 60)));
  assert.strictEqual(L.mergeTvmaze(tvItem({ season: 2, hours: null }), show({}, s1.concat(full)), '2026-10-11').item.hours, 8.4, 'all 8 listed: counted');
  const undated = s2.concat([6, 7, 8].map(n => ep(2, n, null, null)));
  assert.strictEqual(L.mergeTvmaze(tvItem({ season: 2, hours: null }), show({ averageRuntime: 60 }, s1.concat(undated)), '2026-10-11').item.hours, 8.4, 'undated episodes count toward the season');
  const aired = ['2026-09-25', '2026-10-02', '2026-10-09', '2026-10-15'].map((d, i) => ep(2, i + 1, d, 27));   // a weekly season listed only as it airs
  const h = (over, s, today) => L.mergeTvmaze(tvItem(Object.assign({ season: 2, hours: null }, over)), s || show({}, aired), today || '2026-10-16').item.hours;
  assert.strictEqual(h({ episodes: 11, release: 'weekly' }), null, '4 of 11 announced is not the season');
  assert.strictEqual(h({}), null, 'no count: aired episodes on different days, the last one this week, may still grow');
  assert.strictEqual(h({ episodes: 11 }, show({ status: 'Ended' }, aired)), 1.8, 'the show ended: what is listed is the season');
  assert.strictEqual(h({ episodes: 11 }, null, '2026-10-30'), 1.8, 'nothing new for two weeks: the season is over, even short of the announced count');
  assert.strictEqual(h({ episodes: 11 }, show({}, aired.concat([ep(3, 1, '2027-01-08', 27)]))), 1.8, 'a later season is listed');
  assert.strictEqual(h({}, show({}, [1, 2, 3, 4].map(n => ep(2, n, '2026-10-09', 30)))), 2, 'all on one day: a binge drop counts');
  assert.strictEqual(h({ episodes: 4 }, show({}, [1, 2, 3, 4].map(n => ep(2, n, '2026-10-09', 30)))), 2, 'the announced count is listed');
  assert.strictEqual(h({ season: 4, episodes: 8 }, show({}, [ep(4, 1, '2026-11-01', 60), ep(5, 1, null, null)])), null, 'a later season listed does not close one with episodes to come');
  assert.strictEqual(h({}, show({}, aired.slice(0, 3).concat([ep(2, 4, '2026-10-16', 27)]))), null, 'no count: one episode airing today is not a schedule');
  assert.strictEqual(h({}, show({}, aired.concat([ep(2, 5, '2026-10-22', 27), ep(2, 6, '2026-10-29', 27)]))), 2.7, 'no count: 2 listed ahead is a schedule');
});
test('mergeTvmaze: an upcoming season with only its first episodes listed leaves hours alone; a short season that aired counts', async () => {
  const L = await lib();
  const upcoming = [ep(4, 1, '2026-10-23', 50)];
  assert.strictEqual(L.mergeTvmaze(tvItem({ season: 4, hours: null }), show({}, upcoming), '2026-10-11').item.hours, null, 'one listed episode is not a season of 0.8 hours');
  const aired = [ep(1, 1, '2026-01-05', 60), ep(1, 2, '2026-01-12', 60), ep(1, 3, '2026-01-19', 60)];
  assert.strictEqual(L.mergeTvmaze(tvItem({ hours: null }), show({}, aired), '2026-10-11').item.hours, 3);
});
test('mergeTvmaze: with no episodes it uses the show premiere; a channel we do not cover never clears a service', async () => {
  const L = await lib();
  const elsewhere = show({ premiered: '2027-01-15', webChannel: null, network: { name: 'Some Network' } }, []);
  const r = L.mergeTvmaze(tvItem(), elsewhere, '2026-10-06');
  assert.strictEqual(r.item.date, '2027-01-15');
  assert.deepStrictEqual([r.item.channel, r.item.service], ['Netflix', 'netflix'], 'a service someone set is kept');
  const loose = tvItem(); delete loose.service; delete loose.channel;
  const u = L.mergeTvmaze(loose, elsewhere, '2026-10-06');
  assert.deepStrictEqual([u.item.channel, u.item.service], ['Some Network', null], 'without one, the channel is recorded and the service stays unknown');
  const fx = L.mergeTvmaze(tvItem({ service: 'hulu', channel: 'Hulu' }), show({ webChannel: null, network: { name: 'FX' } }, [ep(2, 1, '2026-10-14', 50)]), '2026-10-06');
  assert.deepStrictEqual([fx.item.channel, fx.item.service], ['FX', 'hulu'], 'FX streams on Hulu');
  const same = L.mergeTvmaze(tvItem({ date: '2026-10-20' }), show({}, [ep(1, 1, '2026-10-20', 30)]), '2026-10-06');
  assert.ok(!same.changes.some(c => /^date/.test(c)), 'unchanged date is not reported');
});

/* ---------- polite fetching ---------- */
const fakeRes = (status, json, headers) => ({ status, ok: status >= 200 && status < 300, headers: { get: k => (headers || {})[k.toLowerCase()] || null }, json: async () => json });
function clock() { let t = 1000; const sleeps = []; return { now: () => t, sleep: async ms => { sleeps.push(ms); t += ms; }, sleeps }; }

test('fetcher spaces requests out and counts them', async () => {
  const L = await lib(), k = clock();
  const f = L.createFetcher({ fetchFn: async () => fakeRes(200, { ok: 1 }), now: k.now, sleep: k.sleep, minGapMs: 700 });
  await f.get('u1'); await f.get('u2'); await f.get('u3');
  assert.deepStrictEqual(k.sleeps, [700, 700]);
  assert.strictEqual(f.count, 3);
});
test('fetcher retries a 429 once, waiting the server-requested time (capped), then gives up quietly', async () => {
  const L = await lib(), k = clock();
  let calls = 0;
  const f = L.createFetcher({ fetchFn: async () => (++calls, fakeRes(429, null, { 'retry-after': '3' })), now: k.now, sleep: k.sleep, minGapMs: 0 });
  const r = await f.get('u');
  assert.strictEqual(calls, 2);
  assert.deepStrictEqual(r, { status: 429, json: null });
  assert.ok(k.sleeps.includes(3000));
  const k2 = clock();
  const g = L.createFetcher({ fetchFn: async () => fakeRes(429, null, { 'retry-after': '999' }), now: k2.now, sleep: k2.sleep, minGapMs: 0 });
  await g.get('u');
  assert.ok(k2.sleeps.includes(20000) && !k2.sleeps.includes(999000), 'wait is capped at 20 s');
});
test('fetcher recovers when the retry works, passes a 404 straight back, and retries a network error once', async () => {
  const L = await lib(), k = clock();
  const seq = [fakeRes(503), fakeRes(200, { a: 1 })];
  const f = L.createFetcher({ fetchFn: async () => seq.shift(), now: k.now, sleep: k.sleep, minGapMs: 0 });
  assert.deepStrictEqual(await f.get('u'), { status: 200, json: { a: 1 } });
  let calls = 0;
  const g = L.createFetcher({ fetchFn: async () => (++calls, fakeRes(404)), now: k.now, sleep: k.sleep, minGapMs: 0 });
  assert.deepStrictEqual(await g.get('u'), { status: 404, json: null });
  assert.strictEqual(calls, 1, 'a 404 is final, not retried');
  let n = 0;
  const h = L.createFetcher({ fetchFn: async () => { if (++n === 1) throw new Error('boom'); return fakeRes(200, { ok: 1 }); }, now: k.now, sleep: k.sleep, minGapMs: 0 });
  assert.strictEqual((await h.get('u')).status, 200);
  const d = L.createFetcher({ fetchFn: async () => { throw new Error('down'); }, now: k.now, sleep: k.sleep, minGapMs: 0 });
  await assert.rejects(() => d.get('u'), /down/);
});
test('fetcher never exceeds its request budget, retries included', async () => {
  const L = await lib(), k = clock();
  let calls = 0;
  const f = L.createFetcher({ fetchFn: async () => (++calls, fakeRes(500)), now: k.now, sleep: k.sleep, minGapMs: 0, maxRequests: 3 });
  await f.get('a');                         // 2 requests (try + retry)
  await assert.rejects(() => f.get('b'), L.BudgetError);   // the 3rd is allowed, then the retry would be the 4th
  assert.ok(calls <= 3, 'calls ' + calls);
  await assert.rejects(() => f.get('c'), L.BudgetError);
  assert.ok(calls <= 3);
});

/* ---------- the script, end to end, against a local fake TVMaze ---------- */
function fakeTvmaze(routes) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    const m = /^\/shows\/(\d+)/.exec(req.url);
    hits.push({ id: m && +m[1], url: req.url, t: Date.now(), ua: req.headers['user-agent'] });
    const r = m ? routes[+m[1]] : routes[Object.keys(routes).find(k => k.startsWith('/') && req.url.startsWith(k))];
    if (!r) { res.writeHead(404); return res.end(); }
    res.writeHead(r.status || 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify((typeof r.body === 'function' ? r.body(decodeURIComponent(req.url)) : r.body) || {}));
  });
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok({ srv, hits, base: 'http://127.0.0.1:' + srv.address().port })));
}
function runScript(dir, data, extra, base, env) {
  const file = path.join(dir, 'upcoming.json'), out = path.join(dir, 'gh-output'), report = path.join(dir, 'report.md');
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
  fs.writeFileSync(out, '');
  const args = [SCRIPT, '--file', file, '--report', report, '--gap-ms', '0', '--retry-wait-s', '0'].concat(extra || []);
  return new Promise(ok => {
    const p = spawn(process.execPath, args, { env: Object.assign({}, process.env, { TVMAZE_BASE: base || 'http://127.0.0.1:9', GITHUB_OUTPUT: out }, env || {}) });
    let so = '', se = '';
    p.stdout.on('data', d => so += d); p.stderr.on('data', d => se += d);
    p.on('close', code => ok({ code, so, se, file, text: fs.readFileSync(file, 'utf8'), out: fs.readFileSync(out, 'utf8'), report: fs.existsSync(report) ? fs.readFileSync(report, 'utf8') : '' }));
  });
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'upc-'));
const data = (items, checked) => ({ checked: checked || '2026-10-05', items });
const ghOut = s => Object.fromEntries(s.trim().split('\n').filter(Boolean).map(l => l.split('=')));

test('script: a quiet week changes nothing, writes nothing, and asks for no pull request', async () => {
  const t = await fakeTvmaze({ 1: { body: show({ status: 'In Development' }, [ep(1, 1, '2026-10-20', null)]) } });
  try {
    const d = data([tvItem({ date: '2026-10-20', confidence: 'unconfirmed', checked: '2026-10-05' })]);
    const r = await runScript(tmp(), d, ['--today', '2026-10-09'], t.base);
    assert.strictEqual(r.code, 0, r.se);
    assert.strictEqual(r.text, JSON.stringify(d, null, 2) + '\n', 'file untouched');
    assert.deepStrictEqual(ghOut(r.out), { changed: 'false', substantive: 'false', flags: '0', ideas: '0', unchecked: '0' });
    assert.strictEqual(t.hits.length, 1);
    assert.match(t.hits[0].ua, /sub-rotator-refresh/);
  } finally { t.srv.close(); }
});
test('script: a moved date is written, reported, and marked substantive', async () => {
  const t = await fakeTvmaze({ 1: { body: show({ status: 'Running' }, [1, 2, 3, 4].map(n => ep(1, n, '2026-11-12', 50))) } });
  try {
    const r = await runScript(tmp(), data([tvItem({ date: '2026-10-20', confidence: 'unconfirmed' })]), ['--today', '2026-10-09'], t.base);
    assert.strictEqual(r.code, 0, r.se);
    const saved = JSON.parse(r.text);
    assert.strictEqual(saved.items[0].date, '2026-11-12');
    assert.strictEqual(saved.items[0].hours, 3.3);
    assert.strictEqual(saved.checked, '2026-10-09');
    assert.deepStrictEqual(ghOut(r.out), { changed: 'true', substantive: 'true', flags: '0', ideas: '0', unchecked: '0' });
    assert.match(r.report, /date: 2026-10-20 -> 2026-11-12/);
  } finally { t.srv.close(); }
});
test('script: nothing new still refreshes the "checked" stamp once it is two weeks old, as a non-substantive change', async () => {
  const t = await fakeTvmaze({ 1: { body: show({ status: 'In Development' }, [ep(1, 1, '2026-10-20', null)]) } });
  try {
    const d = data([tvItem({ date: '2026-10-20', confidence: 'unconfirmed', checked: '2026-09-20' })], '2026-09-20');
    const r = await runScript(tmp(), d, ['--today', '2026-10-06'], t.base);
    assert.strictEqual(r.code, 0, r.se);
    assert.strictEqual(JSON.parse(r.text).checked, '2026-10-06');
    assert.deepStrictEqual(ghOut(r.out), { changed: 'true', substantive: 'false', flags: '0', ideas: '0', unchecked: '0' });
  } finally { t.srv.close(); }
});
test('script: old releases are dropped and unverifiable ones are flagged without any request', async () => {
  const t = await fakeTvmaze({});
  try {
    const d = data([item({ id: 'old', title: 'Old', date: '2026-08-01' }), item({ id: 'gta', title: 'GTA', date: '2026-11-19', checked: '2026-10-05' }), item({ id: 'late', title: 'Late', date: '2026-10-02', checked: '2026-10-05' })]);
    const r = await runScript(tmp(), d, ['--today', '2026-10-09'], t.base);
    assert.strictEqual(r.code, 0, r.se);
    assert.deepStrictEqual(JSON.parse(r.text).items.map(i => i.id), ['gta', 'late']);
    assert.deepStrictEqual(ghOut(r.out), { changed: 'true', substantive: 'true', flags: '1', ideas: '0', unchecked: '0' });
    assert.match(r.report, /Removed[\s\S]*Old/);
    assert.match(r.report, /\[ \] \*\*Late\*\*/);
    assert.strictEqual(t.hits.length, 0, 'no TV items, so no requests at all');
  } finally { t.srv.close(); }
});
test('script: a show TVMaze no longer has is reported, kept, and does not fail the run', async () => {
  const t = await fakeTvmaze({ 2: { body: show({}, [ep(1, 1, '2026-10-20', 30)]) } });
  try {
    const d = data([tvItem({ id: 'gone', title: 'Gone', tvmazeId: 99 }), tvItem({ id: 'ok', title: 'Ok', tvmazeId: 2, date: '2026-10-20' })]);
    const r = await runScript(tmp(), d, ['--today', '2026-10-09'], t.base);
    assert.strictEqual(r.code, 0, r.se);
    assert.match(r.report, /Could not check[\s\S]*Gone: TVMaze no longer has show 99/);
    assert.ok(JSON.parse(r.text).items.some(i => i.id === 'gone'));
  } finally { t.srv.close(); }
});
test('script: when TVMaze is down it stops after 3 failures in a row, leaves the file alone, and fails the run', async () => {
  const t = await fakeTvmaze({ 1: { status: 500 }, 2: { status: 500 }, 3: { status: 500 }, 4: { status: 500 }, 5: { status: 500 }, 6: { status: 500 } });
  try {
    const items = [1, 2, 3, 4, 5, 6].map(n => tvItem({ id: 's' + n, title: 'S' + n, tvmazeId: n }));
    const d = data(items);
    const r = await runScript(tmp(), d, ['--today', '2026-10-09'], t.base);
    assert.strictEqual(r.code, 1);
    assert.strictEqual(r.text, JSON.stringify(d, null, 2) + '\n', 'file untouched');
    assert.ok(t.hits.length <= 6, 'requests sent: ' + t.hits.length + ' (3 shows, each tried twice)');
    assert.match(r.report, /stopped after 3 failures in a row/);
  } finally { t.srv.close(); }
});
test('script: the request cap is hard', async () => {
  const routes = {}; for (let n = 1; n <= 6; n++) routes[n] = { body: show({}, [ep(1, 1, '2026-10-20', 30)]) };
  const t = await fakeTvmaze(routes);
  try {
    const items = [1, 2, 3, 4, 5, 6].map(n => tvItem({ id: 's' + n, title: 'S' + n, tvmazeId: n, date: '2026-10-20' }));
    const r = await runScript(tmp(), data(items), ['--today', '2026-10-09', '--max-requests', '2'], t.base);
    assert.strictEqual(r.code, 0, r.se);
    assert.strictEqual(t.hits.length, 2);
    assert.match(r.report, /S3: request budget of 2 reached/);
  } finally { t.srv.close(); }
});
test('script: requests are spaced by --gap-ms', async () => {
  const routes = {}; for (let n = 1; n <= 3; n++) routes[n] = { body: show({}, [ep(1, 1, '2026-10-20', 30)]) };
  const t = await fakeTvmaze(routes);
  try {
    const items = [1, 2, 3].map(n => tvItem({ id: 's' + n, title: 'S' + n, tvmazeId: n, date: '2026-10-20' }));
    const dir = tmp(); fs.writeFileSync(path.join(dir, 'upcoming.json'), JSON.stringify(data(items)));
    const r = await runScript(dir, data(items), ['--today', '2026-10-09', '--gap-ms', '200'], t.base);
    assert.strictEqual(r.code, 0, r.se);
    assert.strictEqual(t.hits.length, 3);
    // arrival times jitter by a few ms, so judge the whole span: 2 gaps of 200 ms, and without spacing it would be about 20 ms
    const span = t.hits[2].t - t.hits[0].t;
    assert.ok(span >= 320, 'span ' + span);
  } finally { t.srv.close(); }
});
test('script: --dry-run and an invalid file both leave the file exactly as it was', async () => {
  const t = await fakeTvmaze({ 1: { body: show({}, [ep(1, 1, '2026-11-12', 30)]) } });
  try {
    const d = data([tvItem({ date: '2026-10-20' })]);
    const dry = await runScript(tmp(), d, ['--today', '2026-10-09', '--dry-run'], t.base);
    assert.strictEqual(dry.code, 0, dry.se);
    assert.strictEqual(dry.text, JSON.stringify(d, null, 2) + '\n');
    assert.match(dry.so, /dry run/);
    const bad = await runScript(tmp(), data([tvItem({ date: '2026-02-30' })]), ['--today', '2026-10-09'], t.base);
    assert.strictEqual(bad.code, 1);
    assert.match(bad.se, /real YYYY-MM-DD/);
    const junk = await runScript(tmp(), '{"checked":', ['--today', '2026-10-09'], t.base);
    assert.notStrictEqual(junk.code, 0);
    const badToday = await runScript(tmp(), d, ['--today', 'yesterday'], t.base);
    assert.strictEqual(badToday.code, 2);
  } finally { t.srv.close(); }
});

/* ---------- discovery ---------- */
// One schedule entry: an episode with its show embedded, as TVMaze's /schedule/full returns it.
const sched = (showId, name, season, number, airdate, over) => {
  const o = Object.assign({ channel: 'Netflix', weight: 99, language: 'English', type: 'Scripted', status: 'Running', runtime: 50 }, over || {});
  return { season, number, type: 'regular', airdate, runtime: o.runtime,
    _embedded: { show: { id: showId, url: 'https://www.tvmaze.com/shows/' + showId + '/x', name, type: o.type, language: o.language, status: o.status, weight: o.weight, averageRuntime: null, runtime: null,
      webChannel: o.network ? null : { name: o.channel }, network: o.network ? { name: o.channel } : null } } };
};
const season = (id, name, s, start, n, over) => Array.from({ length: n }, (_, i) => sched(id, name, s, i + 1, start, over));
test('discoverTv: popular English premieres on our services in the next 90 days, most popular first, ready to list', async () => {
  const L = await lib();
  const list = [
    ...season(10, 'Big Show', 3, '2026-11-05', 8, { weight: 100 }),
    ...season(11, 'New Drama', 1, '2026-10-20', 2, { weight: 97, channel: 'HBO', network: true, status: 'In Development' }),
    ...season(12, 'Too Far', 1, '2027-02-01', 6),
    ...season(13, 'Not Popular', 1, '2026-11-01', 6, { weight: 60 }),
    ...season(14, 'Elsewhere', 1, '2026-11-01', 6, { channel: 'Tubi' }),
    ...season(15, 'Late Night', 1, '2026-11-01', 6, { type: 'Talk Show' }),
    ...season(16, 'En Francais', 1, '2026-11-01', 6, { language: 'French' }),
    ...season(17, 'Already Listed', 2, '2026-11-01', 6),
    ...season(18, 'The Listed By Title', 1, '2026-11-01', 6),
    ...season(19, 'Aired', 1, '2026-10-01', 6),
    sched(10, 'Big Show', 3, 2, '2026-11-12', { weight: 100 }),         // a later episode is not a premiere
  ];
  const items = [tvItem({ id: 'already', title: 'Something', tvmazeId: 17 }), item({ id: 'lbt', title: 'Listed by Title' })];
  const got = L.discoverTv(list, items, '2026-10-11');
  assert.deepStrictEqual(got.map(i => i.title), ['Big Show', 'New Drama', 'En Francais'], 'a French show on Netflix comes in as a world show');
  assert.ok(!('origin' in got[2]) && got[2].subsNote === 'New series, in French' && got[2].subsNoteEs === 'Serie nueva, en francés', 'French could be France, Belgium or Canada: a person sets where it was made');
  assert.ok(!('origin' in got[0]), 'an American show has no origin');
  const [a, b] = got;
  assert.deepStrictEqual([a.id, a.kind, a.service, a.channel, a.subs, a.date, a.season, a.tvmazeId, a.confidence, a.subsNote, a.checked],
    ['big-show-season-3', 'tv', 'netflix', 'Netflix', ['nf-ads'], '2026-11-05', 3, 10, 'confirmed', 'Season 3', '2026-10-11']);
  assert.strictEqual(a.hours, 7.5, '9 listed episodes of 50 minutes');
  assert.deepStrictEqual([b.service, b.subs, b.confidence, b.subsNote, b.hours], ['max', ['max'], 'unconfirmed', 'New series', null], 'HBO maps to HBO Max; two listed episodes are too few to count hours');
  assert.match(a.source, /^https:\/\/www\.tvmaze\.com\/shows\/10/);
  assert.deepStrictEqual(L.validateData({ checked: '2026-10-11', items: items.concat(got) }), []);
  assert.strictEqual(L.discoverTv(list, items, '2026-10-11', { max: 1, maxWorld: 0 }).length, 1, 'capped');
  assert.strictEqual(L.discoverTv(list.concat(season(20, 'Big Show', 1, '2026-11-01', 4)), [item({ id: 'big-show-season-3' })], '2026-10-11').filter(i => i.id.startsWith('big-show')).every((i, n, arr) => arr.findIndex(x => x.id === i.id) === n), true, 'ids stay unique');
  assert.deepStrictEqual(L.discoverTv('nope', items, '2026-10-11'), []);
});
test('discoverTv: anime (Japanese animation) on a service we cover is listed and tagged, with its own cap of 3', async () => {
  const L = await lib();
  const a = (id, name, over) => season(id, name, 1, '2026-11-01', 6, Object.assign({ language: 'Japanese', type: 'Animation', channel: 'Crunchyroll', weight: 97, runtime: 24 }, over));
  const list = [...a(30, 'Blade Hunter'), ...a(31, 'Sky Pirates', { channel: 'Netflix', weight: 98 }), ...a(32, 'Tokyo Only', { channel: 'TV Tokyo', network: true }),
    ...season(33, 'Live Drama', 1, '2026-11-01', 6, { language: 'Japanese' }), ...a(34, 'Third Anime', { weight: 96 }), ...a(35, 'Fourth Anime', { weight: 96 }),
    ...season(36, 'English Show', 1, '2026-11-01', 6)];
  const got = L.discoverTv(list, [], '2026-10-11');
  assert.deepStrictEqual(got.map(i => i.title), ['English Show', 'Sky Pirates', 'Blade Hunter', 'Third Anime', 'Live Drama'], 'a Japanese TV channel alone gives no service; 3 anime at most; Japanese live action on Netflix is a world show');
  assert.deepStrictEqual([got[4].origin, got[4].anime], ['Japanese', undefined]);
  assert.deepStrictEqual([got[1].anime, got[1].service, got[1].subs, got[2].service, got[2].subs, got[2].hours], [true, 'netflix', ['nf-ads'], 'crunchy', ['crunchy'], null], 'an anime cour is often listed a few at a time: hours wait');
  // names: a listed show with an id is matched by its id, so another show with the same name can still come in
  const piece = season(46065, 'One Piece', 3, '2026-11-10', 8);
  assert.deepStrictEqual(L.discoverTv(piece, [tvItem({ id: 'the-one-piece', title: 'The One Piece', tvmazeId: 73510, anime: true })], '2026-10-11').map(i => i.title), ['One Piece']);
  assert.deepStrictEqual(L.discoverTv(piece, [item({ id: 'op', title: 'One Piece' })], '2026-10-11'), [], 'a row with no id is matched by name');
  // an anime cut by its cap never blocks an English show with the same name
  const clash = [...a(40, 'Monster', { weight: 95 }), ...a(41, 'A1', { weight: 99 }), ...a(42, 'A2', { weight: 99 }), ...a(43, 'A3', { weight: 99 }), ...season(44, 'Monster', 3, '2026-11-02', 6, { weight: 99 })];
  assert.deepStrictEqual(L.discoverTv(clash, [], '2026-10-11').map(i => i.title), ['Monster', 'A1', 'A2', 'A3']);
  assert.strictEqual(L.discoverTv(clash, [], '2026-10-11')[0].tvmazeId, 44);
  assert.ok(!('anime' in got[0]), 'an English show is not tagged');
  assert.deepStrictEqual(L.validateData({ checked: '2026-10-11', items: got }), []);
  assert.deepStrictEqual(L.discoverTv(list, [], '2026-10-11', { maxAnime: 0, maxWorld: 0 }).map(i => i.title), ['English Show'], 'English shows keep their own cap');
});
test('origin: where a show was made, from its channel country or language; the validator knows the list', async () => {
  const L = await lib();
  const sh = (language, country, web) => ({ language, network: web ? null : { name: 'X', country: country ? { code: country } : null }, webChannel: web ? { name: 'Netflix', country: country ? { code: country } : null } : null });
  assert.deepStrictEqual([sh('Korean', 'KR'), sh('Korean', null, true), sh('English', 'GB'), sh('English', 'US'), sh('English', null, true), sh('Spanish', 'MX'), sh('Spanish', null, true), sh('Mandarin', 'TW'), sh('Mandarin', null, true), sh('Hindi', null, true), sh('Portuguese', null, true), sh('Swedish', 'SE'), sh('Korean', 'US'), sh('Spanish', 'US')].map(L.originOf),
    ['Korean', 'Korean', 'British', null, null, 'Mexican', null, 'Taiwanese', null, 'Indian', null, 'Nordic', 'Korean', null], 'a language spoken in several places (Spanish, Chinese, Portuguese) needs the channel country');
  const v = items => L.validateData({ checked: '2026-10-05', items });
  const tv = o => Object.assign({ id: 'k', title: 'K', kind: 'tv', date: '2026-11-01', confidence: 'confirmed', checked: '2026-10-05' }, o);
  assert.deepStrictEqual(v([tv({ origin: 'Korean' }), tv({ id: 'm', kind: 'movie', origin: 'British' }), tv({ id: 'a', origin: 'American' })]), []);
  assert.ok(v([tv({ origin: 'Korea' })]).some(e => /origin is where/.test(e)), 'a typo is caught');
  assert.ok(v([tv({ kind: 'game', origin: 'Korean' })]).some(e => /origin is where/.test(e)));
});
test('discoverTv: K-dramas and other non-English shows on a service we cover come in, tagged, at most 3 a week', async () => {
  const L = await lib();
  const k = (id, name, over) => season(id, name, 1, '2026-11-01', 6, Object.assign({ language: 'Korean', weight: 97 }, over));
  const list = [...k(50, 'Seoul Hearts'), ...k(51, 'Busan Nights', { weight: 98 }), ...k(52, 'Only On tvN', { channel: 'tvN', network: true }), ...k(53, 'Fourth K', { weight: 96 }), ...k(54, 'Fifth K', { weight: 95 }), ...k(56, 'Mind Game Show', { type: 'Reality', weight: 99 }), ...season(55, 'English Show', 1, '2026-11-01', 6)];
  const got = L.discoverTv(list, [], '2026-10-11');
  assert.deepStrictEqual(got.map(i => i.title), ['English Show', 'Busan Nights', 'Seoul Hearts', 'Fourth K'], 'a Korean TV channel alone gives no service; a game show is no K-drama; 3 at most');
  assert.ok(got.slice(1).every(i => i.origin === 'Korean' && !i.anime));
  assert.deepStrictEqual(L.validateData({ checked: '2026-10-11', items: got }), []);
  assert.match(L.renderReport({ today: '2026-10-11', changes: [], removed: [], flags: [], unchecked: [], added: got, ideas: [], wiki: false, requests: 1 }), /\*\*Busan Nights\*\* \(Korean, New series/);
  const vix = season(60, 'Volver a Caer', 1, '2026-11-01', 6, { language: 'Spanish', channel: 'ViX', weight: 99 });
  vix.forEach(e => { e._embedded.show.webChannel.country = { code: 'US' }; });
  const v = L.discoverTv(vix, [], '2026-10-11');
  assert.deepStrictEqual([v.length, v[0].service, v[0].subs, v[0].subsNote, 'origin' in v[0]], [1, 'vix', ['vix'], 'New series, in Spanish', false], 'a Spanish show on ViX (a US channel) still comes in; a person sets where it was made');
});
test('indie: true only on games', async () => {
  const L = await lib();
  const v = items => L.validateData({ checked: '2026-10-05', items });
  const it = o => Object.assign({ id: 'g', title: 'G', kind: 'game', date: '2026-11-01', confidence: 'confirmed', checked: '2026-10-05' }, o);
  assert.deepStrictEqual(v([it({ indie: true })]), []);
  assert.ok(v([it({ kind: 'tv', indie: true })]).some(e => /indie is true/.test(e)));
  assert.ok(v([it({ indie: 'yes' })]).some(e => /indie is true/.test(e)));
});
const WIKI = [
  '==Feature films==',
  '{| class="wikitable sortable"',
  '|-',
  '! style="width:35%;"| Title',
  '! scope="col"| Release date',
  '! Genre',
  '! Runtime',
  '! Language',
  '|-',
  "| ''[[Old Film (film)|Old Film]]''",
  '| January 9, 2026',
  '| [[Drama]]',
  '| {{sort|117|1 h 57 min}}',
  '| English',
  '|-',
  "| ''[[The Big One (2026 film)|The Big One]]''<ref>{{cite web|title=x|access-date=October 5, 2026}}</ref>",
  '| November 20, 2026<ref>{{cite web|access-date=October 1, 2026}}</ref>',
  '| [[Action film|Action]]',
  '| {{sort|128|2 h 8 min}}',
  '| English',
  '|-',
  "| ''Small One''",
  '| {{dts|2026|12|04}}',
  '| Comedy',
  '| 95 minutes',
  '| English, Spanish',
  '|-',
  "| ''Foreign One''",
  '| December 11, 2026',
  '| Drama',
  '| TBA',
  '| Korean',
  '|-',
  "| ''Undated One''",
  '| 2027',
  '| Drama',
  '| TBA',
  '| English',
  '|-',
  "| ''Already Here''",
  '| November 1, 2026',
  '| Drama',
  '| TBA',
  '| English',
  '|-',
  "| ''Funny Person: Live''",
  '| November 6, 2026',
  '| [[Stand-up comedy]]',
  '| TBA',
  '| English',
  '|}',
  '',
  '==Documentaries==',
  '{| class="wikitable sortable"',
  '|-',
  '! Title !! Premiere !! Genre !! Runtime !! Language',
  '|-',
  "| ''A True Story'' || November 13, 2026 || Sports || TBA || English",
  '|}',
].join('\n');
test('parseWikiFilmRows reads titles, full dates and runtimes, and ignores citation dates', async () => {
  const L = await lib();
  const rows = L.parseWikiFilmRows(WIKI);
  assert.deepStrictEqual(rows.map(r => [r.title, r.date, r.hours, r.language]), [
    ['Old Film', '2026-01-09', 2, 'English'],
    ['The Big One', '2026-11-20', 2.1, 'English'],
    ['Small One', '2026-12-04', 1.6, 'English, Spanish'],
    ['Foreign One', '2026-12-11', null, 'Korean'],
    ['Already Here', '2026-11-01', null, 'English'],
  ]);
  assert.deepStrictEqual(L.parseWikiFilmRows(''), []);
  assert.deepStrictEqual(L.parseWikiFilmRows('{| class="wikitable"\n|-\n| \'\'A\'\' || March 3, 2027 || 90 min\n|}').map(r => [r.title, r.date]), [['A', '2027-03-03']], 'cells on one line');
});
test('parseWikiFilmRows: hidden sort keys are not dates, and a date that spans rows applies to each of them', async () => {
  const L = await lib();
  const wt = ['{| class="wikitable"', '|-', '! Title !! Premiere !! Runtime', '|-',
    "| ''Hidden Dts'' || {{dts|December 31, 2026|format=hide}}Late 2026 || TBA", '|-',
    "| ''Hidden Num'' || {{dts|2026|12|31|format=hide}}Late 2026 || TBA", '|-',
    "| ''Sort Attr'' || data-sort-value=\"December 31, 2026\" | Late 2026 || TBA", '|-',
    "| ''Sort Tpl'' || {{sort|2026-12-31|Late 2026}} || TBA", '|-',
    "| ''Shared A''", '| rowspan="2" | November 6, 2026', '| 100 min', '|-',
    "| ''Shared B''", '| 110 min', '|-',
    "| ''After'' || November 13, 2026 || 90 min", '|}'].join('\n');
  assert.deepStrictEqual(L.parseWikiFilmRows(wt).map(r => [r.title, r.date, r.hours]), [
    ['Shared A', '2026-11-06', 1.7], ['Shared B', '2026-11-06', 1.8], ['After', '2026-11-13', 1.5]]);
});
test('discoverMovies: English films from today to 180 days out that the list lacks, as unconfirmed suggestions', async () => {
  const L = await lib();
  const pages = [{ service: 'netflix', page: 'List of Netflix original films (since 2026)', rows: L.parseWikiFilmRows(WIKI) }];
  const got = L.discoverMovies(pages, [item({ id: 'ah', title: 'already here' }), item({ id: 'b1', title: 'Big One' })], '2026-10-11');
  assert.deepStrictEqual(got.map(i => i.title), ['Small One'], 'old, foreign and already-listed films (case and "The" ignored) are left out');
  const m = got[0];
  assert.deepStrictEqual([m.kind, m.service, m.channel, m.subs, m.confidence, m.hours, m.date], ['movie', 'netflix', 'Netflix', ['nf-ads'], 'unconfirmed', 1.6, '2026-12-04']);
  assert.strictEqual(m.source, 'https://en.wikipedia.org/wiki/List_of_Netflix_original_films_(since_2026)');
  assert.deepStrictEqual(L.validateData({ checked: '2026-10-11', items: got }), []);
  assert.strictEqual(L.discoverMovies(pages, [], '2026-10-11', { languages: [] }).length, 4, 'any language when asked');
});
test('skip: titles and "tvmaze:<id>" entries stop discovery from adding or suggesting them, and the list validates', async () => {
  const L = await lib();
  assert.deepStrictEqual(L.validateData({ checked: '2026-10-11', items: [], skip: ['Some Show', 'tvmaze:10'] }), []);
  assert.ok(L.validateData({ checked: '2026-10-11', items: [], skip: 'x' }).some(e => /skip/.test(e)));
  assert.ok(L.validateData({ checked: '2026-10-11', items: [], skip: [''] }).some(e => /skip/.test(e)));
  const list = season(10, 'Big Show', 3, '2026-11-05', 8, { weight: 100 }).concat(season(11, 'Other Show', 1, '2026-11-06', 8, { weight: 99 }));
  assert.deepStrictEqual(L.discoverTv(list, [], '2026-10-11', { skip: ['tvmaze:10'] }).map(i => i.title), ['Other Show']);
  assert.deepStrictEqual(L.discoverTv(list, [], '2026-10-11', { skip: ['the other show'] }).map(i => i.title), ['Big Show']);
  const pages = [{ service: 'netflix', page: 'P', rows: [{ title: 'Small One', date: '2026-12-04', hours: null, language: 'English' }, { title: 'Big One', date: '2026-12-05', hours: null, language: 'English' }] }];
  assert.deepStrictEqual(L.discoverMovies(pages, [], '2026-10-11', { skip: ['Small One'] }).map(i => i.title), ['Big One']);
  assert.deepStrictEqual(L.normalizeData({ checked: '2026-10-11', items: [], skip: ['A'] }), { checked: '2026-10-11', items: [], skip: ['A'] });
});
test('renderReport lists added shows and suggested films with ready-to-paste JSON, and credits Wikipedia', async () => {
  const L = await lib();
  const added = [{ title: 'Big Show', subsNote: 'Season 3', channel: 'Netflix', date: '2026-11-05', source: 'https://www.tvmaze.com/shows/10' }];
  const ideas = [{ id: 'small-one', title: 'Small One', kind: 'movie', service: 'netflix', channel: 'Netflix', subs: ['nf-ads'], date: '2026-12-04', confidence: 'unconfirmed', hours: 1.6, source: 'https://en.wikipedia.org/wiki/X', checked: '2026-10-11' }];
  const r = L.renderReport({ today: '2026-10-11', changes: [], removed: [], flags: [], unchecked: [], added, ideas, wiki: true, requests: 9 });
  assert.match(r, /## Added: new seasons from TVMaze[\s\S]*\*\*Big Show\*\* \(Season 3, Netflix, 2026-11-05\)/);
  assert.match(r, /## Movies to consider[\s\S]*- \[ \] \*\*Small One\*\* \(Netflix, 2026-12-04\)/);
  assert.match(r, /```json\n\{"id":"small-one"/);
  assert.match(r, /9 requests to TVMaze and Wikipedia.*Wikipedia \(CC BY-SA 4\.0\)/);
  assert.doesNotMatch(r, /Nothing changed/);
});
test('script --discover: adds a TV premiere, suggests films, says so in the GitHub output, and names a contact', async () => {
  const wikiPage = url => (/Netflix original films/.test(url) ? { parse: { wikitext: WIKI } } : { parse: { wikitext: '' } });
  const t = await fakeTvmaze({ '/schedule/full': { body: season(10, 'Big Show', 3, '2026-11-05', 8, { weight: 100 }) }, '/w/api.php': { body: wikiPage } });
  try {
    const r = await runScript(tmp(), data([item({ id: 'g', title: 'A game', date: '2026-12-01', checked: '2026-10-09' })]), ['--today', '2026-10-11', '--discover'], t.base, { WIKI_BASE: t.base, REFRESH_CONTACT: 'https://github.com/someone/sub-rotator' });
    assert.strictEqual(r.code, 0, r.se);
    const saved = JSON.parse(r.text);
    assert.deepStrictEqual(saved.items.map(i => i.id), ['g', 'big-show-season-3']);
    assert.ok(!saved.items.some(i => i.kind === 'movie'), 'films are never added on their own');
    assert.deepStrictEqual(ghOut(r.out), { changed: 'true', substantive: 'true', flags: '0', ideas: '3', unchecked: '0' });
    assert.match(r.report, /Big Show[\s\S]*Movies to consider[\s\S]*The Big One/);
    assert.strictEqual(t.hits.filter(h => /schedule\/full/.test(h.url)).length, 1);
    assert.strictEqual(t.hits.filter(h => /\/w\/api\.php/.test(h.url)).length, 7, 'one request per Wikipedia list');
    t.hits.forEach(h => assert.match(h.ua, /sub-rotator-refresh\/[\d.]+ \(.*https:\/\/github\.com\/someone\/sub-rotator\) bot/));
    const plain = await runScript(tmp(), data([item({ id: 'g', title: 'A game', date: '2026-12-01', checked: '2026-10-09' })]), ['--today', '2026-10-11'], t.base, { WIKI_BASE: t.base });
    assert.strictEqual(plain.code, 0, plain.se);
    assert.strictEqual(t.hits.length, 8, 'without --discover nothing extra is fetched');
  } finally { t.srv.close(); }
});
test('script --discover: the skip list is kept when the file is written, and skipped titles stay out', async () => {
  const t = await fakeTvmaze({ '/schedule/full': { body: season(10, 'Big Show', 3, '2026-11-05', 8, { weight: 100 }) }, '/w/api.php': { body: { parse: { wikitext: '' } } } });
  try {
    const d = Object.assign(data([item({ id: 'g', title: 'A game', date: '2026-12-01', checked: '2026-10-09' })], '2026-09-01'), { skip: ['Big Show'] });
    const r = await runScript(tmp(), d, ['--today', '2026-10-11', '--discover'], t.base, { WIKI_BASE: t.base });
    assert.strictEqual(r.code, 0, r.se);
    const saved = JSON.parse(r.text);
    assert.strictEqual(saved.checked, '2026-10-11', 'the file was written (the stamp was old)');
    assert.deepStrictEqual(saved.skip, ['Big Show']);
    assert.deepStrictEqual(saved.items.map(i => i.id), ['g']);
  } finally { t.srv.close(); }
});
test('script --discover: discovery stops after 3 failures in a row and says so in the output', async () => {
  const t = await fakeTvmaze({ '/schedule/full': { status: 500 } });
  try {
    const r = await runScript(tmp(), data([item({ id: 'g', title: 'A game', date: '2026-12-01', checked: '2026-10-09' })]), ['--today', '2026-10-11', '--discover'], t.base, { WIKI_BASE: t.base });
    assert.strictEqual(r.code, 0, r.se);
    assert.match(r.report, /stopped after 3 failures in a row/);
    assert.strictEqual(t.hits.filter(h => /\/w\/api\.php/.test(h.url)).length, 2, 'no more requests once stopped');
    assert.strictEqual(ghOut(r.out).unchecked, '8');
  } finally { t.srv.close(); }
});
test('script --discover: a Wikipedia error answer is named in the report', async () => {
  const t = await fakeTvmaze({ '/schedule/full': { body: [] }, '/w/api.php': { body: { error: { code: 'missingtitle' } } } });
  try {
    const r = await runScript(tmp(), data([item({ id: 'g', title: 'A game', date: '2026-12-01', checked: '2026-10-09' })]), ['--today', '2026-10-11', '--discover'], t.base, { WIKI_BASE: t.base });
    assert.strictEqual(r.code, 0, r.se);
    assert.match(r.report, /New films \(List of Netflix original films \(since 2026\)\): Wikipedia said missingtitle/);
  } finally { t.srv.close(); }
});
test('script --discover: a failed schedule or list is reported and the rest of the run goes on', async () => {
  const t = await fakeTvmaze({ 1: { body: show({}, [ep(1, 1, '2026-10-20', 30)]) }, '/schedule/full': { status: 500 } });
  try {
    const r = await runScript(tmp(), data([tvItem({ date: '2026-10-20' })]), ['--today', '2026-10-11', '--discover'], t.base, { WIKI_BASE: t.base });
    assert.strictEqual(r.code, 0, r.se);
    assert.match(r.report, /Could not check[\s\S]*New shows \(TVMaze schedule\): answered 500/);
    assert.match(r.report, /New films \(List of Netflix original films \(since 2026\)\): answered 404/);
  } finally { t.srv.close(); }
});

/* ---------- the browser and the weekly script must agree ---------- */
function browserTv() {
  const html = fs.readFileSync(path.join(root, 'public', 'app.html'), 'utf8');
  const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const block = (a) => js.match(new RegExp('// ==' + a + '-START==([\\s\\S]*)// ==' + a + '-END=='))[1];
  return new Function(block('CSV') + block('TV') + '\nreturn {tvSummary, tvService};')();
}
test('parity: app.html TV logic and scripts/lib mergeTvmaze give the same date, hours, confidence, channel and service', async () => {
  const L = await lib(), B = browserTv();
  const cases = [
    ['new series in development', show({ status: 'In Development' }, [ep(1, 1, '2026-12-05', 40), ep(1, 2, '2026-12-05', 45), ep(1, 3, '2026-12-05', 35)]), undefined],
    ['running series, weekly', show({ status: 'Running', webChannel: { name: 'Disney+' } }, [ep(1, 1, '2026-11-04', 55), ep(1, 2, '2026-11-11', 55), ep(1, 3, '2026-11-18', 55), ep(1, 4, '2026-11-25', 55)]), undefined],
    ['upcoming season, premiere only', show({ status: 'Running' }, [ep(1, 1, '2025-01-01', 50), ep(1, 2, '2025-01-08', 50), ep(2, 1, '2026-12-01', 50)]), 2],
    ['FX show', show({ webChannel: null, network: { name: 'FX' } }, [1, 2, 3, 4].map(n => ep(1, n, '2026-11-0' + n, 45))), undefined],
    ['undated episodes count', show({ averageRuntime: 30 }, [ep(1, 1, '2026-11-01', 30), ep(1, 2, '2026-11-08', 30), ep(1, 3, null, null), ep(1, 4, '', null)]), 1],
    ['season shorter than the last, still airing', show({}, [1, 2, 3, 4, 5, 6].map(n => ep(1, n, '2025-01-0' + n, 50)).concat([1, 2, 3, 4, 5].map(n => ep(2, n, '2026-11-0' + n, 50)))), 2],
    ['returning show, pinned season', show({ premiered: '2022-01-01' }, [ep(1, 1, '2022-01-01', 60), ep(2, 1, '2026-12-05', 30), ep(2, 2, '2026-12-12', 30)]), 2],
    ['average runtime fills blanks', show({ averageRuntime: 25, webChannel: null, network: { name: 'HBO' } }, [ep(1, 1, '2026-11-01', null), ep(1, 2, '2026-11-08', null)]), undefined],
    ['unknown lengths', show({}, [ep(1, 1, '2026-11-01', null)]), undefined],
    ['unmapped channel', show({ webChannel: { name: 'Tubi' } }, [ep(1, 1, '2026-11-01', 40)]), undefined],
    ['listed as it airs, count announced', show({}, ['2026-09-15', '2026-09-22', '2026-09-29', '2026-10-05'].map((d, i) => ep(1, i + 1, d, 25))), 1, 11],
    ['listed as it airs, no count', show({}, ['2026-09-15', '2026-09-22', '2026-09-29', '2026-10-05'].map((d, i) => ep(1, i + 1, d, 25))), 1],
    ['binge drop, all listed', show({}, [1, 2, 3, 4, 5, 6, 7].map(n => ep(1, n, '2026-10-03', 24))), 1, 7],
    ['binge drop, 4 of 7 listed', show({}, [1, 2, 3, 4].map(n => ep(1, n, '2026-10-03', 24))), 1, 7],
    ['ended short of the count', show({ status: 'Ended' }, [1, 2, 3, 4].map(n => ep(1, n, '2026-09-0' + n, 30))), 1, 6],
    ['quiet for two weeks', show({}, [1, 2, 3, 4].map(n => ep(1, n, '2026-09-0' + n, 30))), 1, 6],
    ['no season picked: the newest season dropped yesterday', show({}, [1, 2, 3].flatMap(s => [1, 2, 3, 4, 5, 6].map(n => ep(s, n, s === 3 ? '2026-10-05' : (2023 + s) + '-0' + n + '-01', 40)))), undefined],
    ['a later season listed, this one still to come', show({}, [ep(1, 1, '2026-11-01', 50), ep(2, 1, null, null)]), 1, 8],
  ];
  cases.forEach(([name, s, season, expected]) => {
    const b = B.tvSummary(s, '2026-10-06', season, expected);
    const item = Object.assign({ id: 'x', title: 'X', kind: 'tv', tvmazeId: 1, date: '2026-01-01', confidence: 'rumored', checked: '2026-10-01', hours: null }, season ? { season } : {}, expected ? { episodes: expected } : {});
    const m = L.mergeTvmaze(item, s, '2026-10-06').item;
    assert.strictEqual(m.date, b.date, name + ': date');
    assert.strictEqual(m.confidence, b.confidence, name + ': confidence');
    assert.strictEqual(m.hours, b.hours, name + ': hours');
    assert.strictEqual(m.channel === undefined ? null : m.channel, b.channel, name + ': channel');
    assert.strictEqual(m.service === undefined ? null : m.service, b.service, name + ': service');
  });
});
test('parity: both sides map every channel name the same way', async () => {
  const L = await lib(), B = browserTv();
  ['Netflix', 'netflix', 'Disney+', 'Disney Plus', 'Hulu', 'FX', 'FXX', 'FX on Hulu', 'HBO Max', 'Max', 'HBO', 'Peacock', 'Apple TV+', 'Apple TV', 'Paramount+', 'Paramount Plus', 'Crunchyroll', 'Prime Video', 'Amazon Freevee', 'Viki', 'Rakuten Viki', 'KOCOWA+', 'ViX', 'BritBox', 'Acorn TV', 'Tubi', 'YouTube', 'Maxim', '', null, undefined]
    .forEach(n => assert.strictEqual(B.tvService(n), L.channelToService(n), String(n)));
});

/* ---------- repo wiring ---------- */
test('the workflow is cheap by construction: weekly, one job, hard timeout, no installs, pausable', () => {
  const y = fs.readFileSync(path.join(root, '.github', 'workflows', 'refresh-upcoming.yml'), 'utf8');
  assert.match(y, /cron: '\d+ \d+ \* \* \d'/, 'one weekly schedule');
  assert.strictEqual((y.match(/^\s+schedule:/gm) || []).length, 1);
  assert.strictEqual((y.match(/^    runs-on:/gm) || []).length, 1, 'exactly one job');
  assert.match(y, /timeout-minutes: [1-5]\b/);
  assert.match(y, /concurrency:/);
  assert.match(y, /vars\.UPCOMING_REFRESH == 'on'/, 'opt-in: nothing runs until the repository variable is set to on');
  assert.doesNotMatch(y, /npm (ci|install)|setup-node|actions\/cache|matrix:/);
  assert.match(y, /fetch-depth: 1/);
  assert.match(y, /refresh-upcoming\.mjs --discover/, 'looks for new titles');
  assert.match(y, /REFRESH_CONTACT: \$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}/, 'Wikimedia asks for a contact in the User-Agent');
  assert.match(y, /IDEAS" != "0"/, 'suggested films open the needs-a-look issue');
  assert.match(y, /UNCHECKED" != "0"/, 'so do checks that could not run');
});

/* ---------- run ---------- */
(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log('ok   ' + name); }
    catch (e) { console.error('FAIL ' + name + '\n     ' + (e && e.message)); process.exitCode = 1; }
  }
  console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
})();
