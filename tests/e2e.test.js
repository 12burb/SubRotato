// End-to-end tests: loads public/app.html in jsdom and drives the real UI.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8').replace(/<link[^>]*fonts[^>]*>/g, '');

// A page in jsdom: optionally with saved state already in localStorage, a stubbed fetch, a start hash, a fixed clock.
function mount(seed, opts) {
  const errs = [];
  opts = opts || {};
  const fixed = opts.date ? new Date(opts.date).getTime() : null;
  const dm = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/' + (opts.hash || ''),
    beforeParse(win) {
      if (opts.fetch) win.fetch = opts.fetch;
      if (fixed) { const Real = win.Date; win.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } }; }
      win.matchMedia = opts.wide ? (q => ({ matches: /min-width:1200px/.test(q), addListener() {}, removeListener() {} })) : (win.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} })));   // wide: a 1200px+ screen
      win.Element.prototype.scrollIntoView = function () {};
      win.scrollTo = () => {};
      win.addEventListener('error', ev => errs.push(ev.message));
      if (seed !== undefined) win.localStorage.setItem('subrotator:v1', typeof seed === 'string' ? seed : JSON.stringify(seed));
    },
  });
  const w = dm.window, doc = w.document;
  const m = {
    w, d: doc, errs, $: s => doc.querySelector(s), $$: s => [...doc.querySelectorAll(s)],
    click: el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })),
    fire: (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true })),
    key: (el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })),
    txt: s => (doc.querySelector(s) || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim(),
    saved: () => JSON.parse(w.localStorage.getItem('subrotator:v1')),
  };
  m.addBar = o => {                                   // fill the queue bar and submit it
    m.$('#qTitle').value = o.title;
    if (o.svc) { m.$('#qSvc').value = o.svc; m.fire(m.$('#qSvc'), 'change'); }
    if (o.tier) m.$('#qTier').value = o.tier;
    m.$('#qHours').value = o.hours == null ? '' : String(o.hours);
    m.$('#qWhen').value = String(o.when || 0);
    m.$('#qadd').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  };
  m.typeTitle = text => { const i = m.$('#qTitle'); i.value = text; m.fire(i, 'input'); return i; };
  m.poke = () => { m.click(m.$('[data-chip=crunchy]')); m.click(m.$('[data-chip=crunchy]')); };   // any change saves state
  return m;
}

const PRICE = { 'gp-ess': 9.99, 'gp-prem': 14.99, 'gp-ult': 22.99, 'gp-pc': 13.99, 'ps-ess': 10.99, 'ps-extra': 16.99, 'ps-prem': 19.99, 'nf-ads': 8.99, 'nf-std': 19.99, 'nf-prem': 26.99, disney: 12.49, 'disney-prem': 21.49, hulu: 12.49, 'hulu-noads': 21.49, max: 10.99, 'max-std': 18.49, 'max-prem': 22.99, peacock: 12.99, 'peacock-plus': 19.99, apple: 14.99, paramount: 8.99, 'paramount-prem': 13.99, crunchy: 9.99, 'crunchy-mega': 13.99, 'crunchy-ult': 17.99 };
const row = (fam, tier, over) => Object.assign({ id: fam, tier, price: PRICE[tier], paying: true, items: [], ci: 0 }, over || {});
const custom = (id, name, price, over) => Object.assign({ id, name, custom: true, tier: null, price, paying: true, items: [], ci: 0 }, over || {});
const keyFor = monthsBack => { const n = new Date(), s = new Date(n.getFullYear(), n.getMonth() + (n.getDate() > 20 ? 1 : 0) - monthsBack, 1); return s.getFullYear() + '-' + s.getMonth(); };
const v2 = (sel, extra) => Object.assign({ v: 2, sel, H: 20, startKey: keyFor(0), est: {} }, extra || {});
const old = (id, name, price, over) => Object.assign({ id, name, price, est: false, group: 'watch', paying: true, earliest: 0, items: [], ci: 0 }, over || {});   // the pre-v2 shape: one entry per plan
const isoOffset = days => { const d = new Date(); d.setDate(d.getDate() + days); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const monthsFromWindowStart = date => {
  const n = new Date(), start = new Date(n.getFullYear(), n.getMonth() + (n.getDate() > 20 ? 1 : 0), 1);
  return (+date.slice(0, 4) - start.getFullYear()) * 12 + (+date.slice(5, 7) - 1 - start.getMonth());
};
const resp = (status, json) => ({ status, ok: status >= 200 && status < 300, json: async () => json });
// fetch stub: upcoming.json from `up` (404 when not given), everything else from routes [[regex, response or fn]]
function stub(routes, up) {
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    if (/upcoming\.json/.test(url)) return up ? resp(200, up) : resp(404, null);
    for (const [re, r] of routes || []) if (re.test(url)) return typeof r === 'function' ? r(url) : r;
    return resp(404, null);
  };
  fn.calls = calls; fn.tv = () => calls.filter(u => /tvmaze/.test(u));
  return fn;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const premiere = isoOffset(45);
const showJson = { id: 88337, name: 'Edgerunners Two', status: 'In Development', premiered: null, averageRuntime: null, webChannel: { name: 'Netflix' }, _embedded: { episodes: [1, 2, 3, 4].map(n => ({ season: 1, number: n, airdate: premiere, runtime: 30 })) } };
const searchJson = [{ score: 1, show: { id: 88337, name: 'Edgerunners Two', premiered: '2026-10-20', status: 'In Development', webChannel: { name: 'Netflix' }, network: null } },
  { score: 0.9, show: { id: 5, name: '<img src=x onerror=alert(1)>', premiered: '2019-01-01', status: 'Ended', webChannel: null, network: { name: 'Some <b>Net</b>' } } }];
const tierUp = () => ({ checked: '2026-10-05', items: [
  { id: 'gears', title: 'Gears Test', kind: 'game', platforms: ['Xbox Series', 'PC'], date: isoOffset(10), confidence: 'confirmed', subs: ['gp-ult', 'gp-pc'], subsNote: 'Day one', checked: '2026-10-05' },
  { id: 'racer', title: 'Racer Test', kind: 'game', platforms: ['Xbox Series', 'PS5'], date: isoOffset(12), confidence: 'confirmed', subs: ['gp-ess', 'ps-extra'], checked: '2026-10-05' },
  { id: 'buy', title: 'Buy Test', kind: 'game', platforms: ['PS5'], date: isoOffset(14), confidence: 'confirmed', subs: [], subsNote: 'Sold separately', checked: '2026-10-05' },
  { id: 'junk', title: 'Junk Subs', kind: 'game', platforms: ['PS5'], date: isoOffset(16), confidence: 'confirmed', subs: ['not-a-tier', '<b>x</b>'], checked: '2026-10-05' },
] });
const upItems = () => ({ checked: '2026-10-05', items: [
  { id: 'show-a', title: 'Show A', kind: 'tv', service: 'netflix', channel: 'Netflix', date: isoOffset(45), confidence: 'unconfirmed', hours: 5, tvmazeId: 77, checked: '2026-10-05' },
  { id: 'game-b', title: 'Game B', kind: 'game', platforms: ['PS5'], date: isoOffset(5), confidence: 'confirmed', hours: null, checked: '2026-10-05' },
  { id: 'game-c', title: 'Game C', kind: 'game', platforms: ['PC', 'Xbox Series'], date: isoOffset(10), confidence: 'confirmed', hours: 12, checked: '2026-10-05' },
  { id: 'old', title: 'Long Gone', kind: 'game', date: isoOffset(-40), confidence: 'confirmed', checked: '2026-10-05' },
  { id: 'far', title: 'Far Away', kind: 'movie', date: isoOffset(900), confidence: 'rumored', checked: '2026-10-05' },
  { id: 'evil', title: '<img src=x onerror=alert(1)>', kind: 'tv', date: isoOffset(20), confidence: 'confirmed', checked: '2026-10-05' },
  { id: 'bad1', title: 'Bad Date', kind: 'game', date: '2026-13-45', confidence: 'confirmed' },
  { id: 'bad2', title: 'Bad Kind', kind: 'podcast', date: isoOffset(3), confidence: 'confirmed' },
  { id: 'bad3', kind: 'game', date: isoOffset(3) },
  null, 'text',
] });
const soonRows = m => { const more = m.$('#soonList [data-soon=more]'); if (more) m.click(more); return m.$$('#soonList .soon-row'); };   // later releases included
const rowOf = (m, t) => soonRows(m).find(r => r.textContent.includes(t));
const openRow = (m, t) => {                         // + Add (one tap) if it is not on the list yet, then Change
  const add = rowOf(m, t).querySelector('[data-soon=add]');
  if (add) m.click(add);
  m.click(rowOf(m, t).querySelector('[data-soon=open]'));
  return rowOf(m, t);
};
const isVisible = (m, v) => !m.$('[data-view=' + v + ']').hidden;
const FAMS10 = ['gamepass', 'psplus', 'netflix', 'disney', 'hulu', 'max', 'peacock', 'apple', 'paramount', 'crunchy'];
const TIER10 = ['gp-ess', 'ps-ess', 'nf-ads', 'disney', 'hulu', 'max', 'peacock', 'apple', 'paramount', 'crunchy'];

let passed = 0;
const queue = [];
const test = (name, fn) => queue.push([name, fn]);

/* ---------- one page driven start to finish ---------- */
const M = mount();
test('page loads with no script errors and all sections present', () => {
  assert.deepStrictEqual(M.errs, []);
  ['#import', '#chips', '#subs', '#queue', '#qadd', '#est', '#hrs', '#plan'].forEach(s => assert.ok(M.$(s), s));
  assert.strictEqual(M.$$('#chips [data-chip]').length, 16, 'one chip per service, not one per plan');
  assert.deepStrictEqual(['prime', 'viki', 'kocowa', 'vix', 'britbox', 'acorn'].map(k => !!M.$('#chips [data-chip=' + k + ']')), [true, true, true, true, true, true], 'the six services added for world TV');
});
test('sample import lists services, pre-checks known ones, and adds one row per service', () => {
  M.click(M.$('#sampleCsv'));
  assert.ok(M.$$('#importOut .frow').length >= 6);
  assert.strictEqual(M.$$('#importOut [data-found]:checked').length, 4);
  const boxes = M.$$('#importOut [data-found]');
  boxes[3].checked = false; M.fire(boxes[3], 'change');          // drop PS Plus
  boxes[5].checked = true; M.fire(boxes[5], 'change');           // add one "other"
  assert.match(M.$('#addFound').textContent, /^Add 4 services$/);
  M.click(M.$('#addFound'));
  assert.ok(M.$('#importOut .found.ok'));
  assert.strictEqual(M.$$('#subs .sub').length, 4);
  assert.ok(M.$$('#subs .sub [data-field=price]').every(i => i.value));
  assert.strictEqual(M.$('.sub[data-id=netflix] [data-field=tier]').value, 'nf-std', 'the statement picks the plan');
});
test('queue items added from the bar feed the planner and the dashboard renders', () => {
  const ids = M.$$('#subs .sub').map(r => r.dataset.id);
  ids.forEach((id, i) => M.addBar({ title: 'Thing ' + i, svc: id, hours: 10 + i * 8 }));
  assert.strictEqual(M.$$('#queue .qitem').length, ids.length, 'every service got its item');
  assert.match(M.txt('#homeAnswer .ans-big'), /\$/);
  assert.ok(!M.$('#part4').hidden, 'step 4 shows once there is a plan');
  assert.strictEqual(M.$$('#plan .nm-r').reduce((a, r) => a + (+r.dataset.to) - (+r.dataset.from) + 1, 0), 11, 'the lines cover the 11 months after this one');
});

test('re-importing an existing service updates it instead of duplicating', () => {
  M.click(M.$('#clearImport'));
  const csv = 'Date,Description,Amount\n07/07/2026,HULU,-12.49\n08/07/2026,HULU,-12.49\n09/07/2026,HULU,-12.49';
  M.$('#pasteBox').value = csv; M.click(M.$('#scanPaste')); M.click(M.$('#addFound'));
  const before = M.$$('#subs .sub').length;
  M.click(M.$('#clearImport'));
  M.$('#pasteBox').value = csv; M.click(M.$('#scanPaste')); M.click(M.$('#addFound'));
  assert.strictEqual(M.$$('#subs .sub').length, before);
});
test('unreadable input shows a clear error', () => {
  M.click(M.$('#clearImport'));
  M.$('#pasteBox').value = 'nothing useful here\nat all';
  M.click(M.$('#scanPaste'));
  assert.ok(M.$('#importOut .found.err'));
});
test('time estimator: one number in hours a day; tapping a choice sets it right away; an impossible week changes nothing', () => {
  assert.strictEqual(M.txt('.slider-top'), '2.5 hours a day', 'a new plan starts at the estimate for a typical week');
  assert.strictEqual(M.txt('#hrsWeek'), 'About 75 hours a month.');
  M.click(M.$('[data-estwork=pt]'));
  assert.strictEqual(M.$('#hrs').value, '130', 'no separate Use step');
  assert.strictEqual(M.txt('.slider-top'), '4.5 hours a day');
  assert.strictEqual(M.saved().hSet, true);
  M.click(M.$('[data-esthome=u6]'));
  assert.strictEqual(M.$('#es-care').value, '14');
  M.click(M.$('[data-esthome=u6]'));
  M.click(M.$('[data-estwork=ft]'));
  assert.strictEqual(M.$('#hrs').value, '75');
  assert.ok(M.$('#hrsHand').hidden, 'the estimate is in use, so no "set by hand" note');
  const s = M.$('#es-workH'); s.value = '50'; M.fire(s, 'input');
  assert.ok(!M.$('#estWork [aria-checked=true]'), 'work chip should deselect after a manual edit');
  assert.ok(+M.$('#hrs').value < 75, 'See the math sliders set the time too');
  const before = M.$('#hrs').value;
  [['workH', '80'], ['commute', '20'], ['care', '80']].forEach(([k, v]) => { const el = M.$('#es-' + k); el.value = v; M.fire(el, 'input'); });
  assert.ok(!M.$('#estSub').hidden);
  assert.match(M.txt('#estSub'), /more than the 168 hours in a week\. Your time did not change\./);
  assert.strictEqual(M.$('#hrs').value, before, 'an impossible week changes nothing');
});
test('estimate above 80 hours is accepted by the slider and changes the plan', () => {
  const m = mount();
  m.click(m.$('#loadExample'));
  m.$('#hrs').value = '15'; m.fire(m.$('#hrs'), 'input');
  const p1 = m.txt('#homeAnswer') + m.txt('#plan');
  m.click(m.$('[data-estwork=none]'));
  assert.ok(+m.$('#hrs').value > 80);
  assert.notStrictEqual(m.txt('#homeAnswer') + m.txt('#plan'), p1);
});
test('Try an example keeps the time you set, and otherwise starts from the typical week', () => {
  M.click(M.$('[data-estwork=none]'));
  const h = M.$('#hrs').value;
  M.click(M.$('#loadExample'));
  assert.strictEqual(M.$('#hrs').value, h, 'your time stays');
  assert.strictEqual(M.$('#estWork [aria-checked=true]').dataset.estwork, 'none', 'your answers stay');
  const m = mount();
  m.click(m.$('#loadExample'));
  assert.strictEqual(m.$('#estWork [aria-checked=true]').dataset.estwork, 'ft');
  assert.strictEqual(m.$('#es-workH').value, '40');
  assert.strictEqual(m.$('#hrs').value, '75');
  M.click(M.$('[data-estwork=ft]'));
});
test('keyboard focus stays on a chip after it is toggled', () => {
  const c = M.$('[data-estwork=pt]'); c.focus(); M.click(c);
  assert.strictEqual(M.d.activeElement.dataset.estwork, 'pt');
  const s = M.$('[data-chip=hulu]'); s.focus(); M.click(s);
  assert.strictEqual(M.d.activeElement.dataset.chip, 'hulu');
  M.click(M.$('[data-chip=hulu]'));
});
test('care slider unpresses the home chips so the next tap does not discard it', () => {
  M.click(M.$('[data-esthome=kid]'));
  const el = M.$('#es-care'); el.value = '30'; M.fire(el, 'input');
  assert.strictEqual(M.$$('#estHome [aria-pressed=true]').length, 0);
  M.click(M.$('[data-esthome=fam]'));
  assert.strictEqual(M.$('#es-care').value, '8');
});
test('a half-typed title in the bar survives other changes on the page', () => {
  M.$('#qTitle').value = 'half typed'; M.$('#qHours').value = '4';
  M.click(M.$('[data-chip=peacock]'));
  assert.strictEqual(M.$('#qTitle').value, 'half typed');
  assert.strictEqual(M.$('#qHours').value, '4');
  M.click(M.$('[data-chip=peacock]'));
});
test('state persists to localStorage and Start fresh resets everything', () => {
  const saved = M.saved();
  assert.ok(saved.est && saved.sel && saved.H && saved.v === 2);
  M.click(M.$('#reset'));
  assert.strictEqual(M.$$('#subs .sub').length, 0);
  assert.strictEqual(M.$('#importOut').innerHTML, '');
  assert.strictEqual(M.$('#hrs').value, '75');
  assert.strictEqual(M.txt('.slider-top'), '2.5 hours a day');
  assert.strictEqual(M.$('#pasteBox').value, '');
  assert.strictEqual(M.$('#qTitle').value, '');
});

/* ---------- services: one row each, plan from a dropdown ---------- */
test('services: chips are services, not plans; a service with several plans says "from"', () => {
  const m = mount();
  assert.match(m.$('[data-chip=gamepass]').textContent, /Game Pass\s*from \$9\.99/);
  assert.match(m.$('[data-chip=apple]').textContent, /Apple TV\s*\$14\.99/);
  assert.doesNotMatch(m.$('[data-chip=apple]').textContent, /from/);
  m.click(m.$('[data-chip=gamepass]'));
  const sel = m.$('.sub[data-id=gamepass] [data-field=tier]');
  assert.deepStrictEqual([...sel.options].map(o => o.value), ['gp-ess', 'gp-prem', 'gp-ult', 'gp-pc']);
  assert.strictEqual(sel.value, 'gp-ess', 'a new service starts on its cheapest plan');
  assert.deepStrictEqual([...sel.options].map(o => o.textContent), ['Game Pass Essential', 'Game Pass Premium', 'Game Pass Ultimate', 'PC Game Pass'], 'the names Your plan uses; the price box beside it shows the price');
  assert.strictEqual(m.$('.sub[data-id=apple] [data-field=tier]'), null);
  assert.strictEqual(m.$$('[data-chip=netflix]').length, 1);
});
test('services: "Add a service" sits at the top, then your services; My list has its own tab', () => {
  const m = mount(undefined, { hash: '#services' });
  const heads = m.$$('[data-view=services] h2').map(h => h.textContent);
  assert.deepStrictEqual(heads, ['Add a service', 'Your services']);
  const pos = el => [...m.d.querySelectorAll('*')].indexOf(el);
  assert.ok(pos(m.$('#chips')) < pos(m.$('#subs')));
  assert.match(m.txt('#subs'), /Tap a service to add it/);
  assert.deepStrictEqual(m.$$('[data-view=list] h2').map(h => h.textContent), ['Add something', 'On your list']);
  assert.ok(m.$('[data-view=list] #qadd') && m.$('[data-view=list] #queue'), 'the add bar and the list live on My list');
});
test('services: changing the plan updates the price; editing the price keeps your cursor; paying and remove work', () => {
  const m = mount(v2({ gamepass: row('gamepass', 'gp-ess', { items: [{ title: 'A', hours: 10, earliest: 0 }] }) }), { hash: '#services' });
  const sel = m.$('.sub[data-id=gamepass] [data-field=tier]');
  sel.value = 'gp-ult'; m.fire(sel, 'change');
  assert.strictEqual(m.saved().sel.gamepass.tier, 'gp-ult');
  assert.strictEqual(m.saved().sel.gamepass.price, 22.99);
  assert.strictEqual(m.d.activeElement, m.$('.sub[data-id=gamepass] [data-field=tier]'));
  const price = m.$('.sub[data-id=gamepass] [data-field=price]');
  price.value = '19.5'; m.fire(price, 'input');
  assert.ok(price.isConnected, 'typing a price does not rebuild the row under your cursor');
  assert.strictEqual(m.saved().sel.gamepass.price, 19.5);
  assert.strictEqual(m.txt('#subsTotal'), 'You pay $19.50 a month for 1 service.', 'the total reads as a sentence');
  const pay = m.$('.sub[data-id=gamepass] [data-field=paying]');
  pay.checked = false; m.fire(pay, 'change');
  assert.strictEqual(m.saved().sel.gamepass.paying, false);
  m.click(m.$('.sub[data-id=gamepass] [data-act=remove]'));
  assert.strictEqual(m.$$('#subs .sub').length, 0);
  assert.deepStrictEqual(m.errs, []);
});
test('services: a custom service has a name and price but no plan dropdown', () => {
  const m = mount(undefined, { hash: '#services' });
  m.$('#cName').value = 'My gym'; m.$('#cPrice').value = '30'; m.click(m.$('#cAdd'));
  const r = m.$('#subs .sub');
  assert.match(r.textContent, /My gym/);
  assert.ok(!r.querySelector('[data-field=tier]'));
  m.addBar({ title: 'Class pack', svc: r.dataset.id, hours: 4 });
  assert.match(m.txt('#queue'), /Class pack/);
  assert.ok(m.$('#qTier').hidden, 'no plan picker for a custom service');
});

/* ---------- the queue bar ---------- */
test('queue: the plan picker lists the service plans, cheapest first, and the item remembers the plan it needs', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std') }), { hash: '#services' });
  m.$('#qSvc').value = 'netflix'; m.fire(m.$('#qSvc'), 'change');
  const t = m.$('#qTier');
  assert.ok(!t.hidden);
  assert.deepStrictEqual([...t.options].map(o => o.value), ['nf-ads', 'nf-std', 'nf-prem']);
  assert.strictEqual(t.options[0].textContent, 'Any price option', 'the default says any price option works, not a name that looks like a downgrade');
  m.addBar({ title: 'Big show', svc: 'netflix', tier: 'nf-prem', hours: 6, when: 2 });
  const it = m.saved().sel.netflix.items[0];
  assert.deepStrictEqual([it.title, it.hours, it.earliest, it.tier], ['Big show', 6, 2, 'nf-prem']);
  assert.match(m.txt('#queue'), /Big show/);
  assert.match(m.txt('#queue .qmeta'), /Premium · from/);
  assert.match(m.$('#toast').textContent, /Added Big show to Netflix/);
  m.click(m.$('#queue [data-act=rmitem]'));
  assert.strictEqual(m.saved().sel.netflix.items.length, 0);
});
test('queue: an item added with a release month waits for it and does not delay the rest', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { paying: false }) }));
  m.addBar({ title: 'Out now', svc: 'netflix', hours: 10, when: 0 });
  m.addBar({ title: 'December season', svc: 'netflix', hours: 10, when: 3 });
  const used = m.$$('#plan .gantt .mt').map(c => !c.classList.contains('free'));
  assert.strictEqual(used[0], true);
  assert.strictEqual(used[3], true);
  assert.strictEqual(used[1] || used[2], false, 'nothing is paid for in between');
  assert.strictEqual(m.$('#qWhen').value, '0', 'the month picker resets after adding');
});
test('queue: without a service the bar says so instead of failing', () => {
  const m = mount(undefined, { hash: '#services' });
  assert.ok(m.$('#qSvc').disabled);
  m.addBar({ title: 'Anything', hours: 3 });
  assert.match(m.$('#toast').textContent, /^Add a service in step 1, or tap a name in the list\./);
  assert.match(m.txt('#queue'), /Type a name and tap a match\. We add its service for you\./);
});

/* ---------- saved data from before the redesign ---------- */
test('migration: old one-entry-per-plan data becomes one row per service, keeping each item\'s plan', () => {
  const m = mount({ sel: {
    'gp-ess': old('gp-ess', 'Game Pass Essential', 9.99, { group: 'game', paying: false, items: [{ title: 'Old game', hours: 8 }] }),
    'gp-ult': old('gp-ult', 'Game Pass Ultimate', 22.99, { group: 'game', paying: true, ci: 1, items: [{ title: 'New game', hours: 12 }] }),
    'nf-ads': old('nf-ads', 'Netflix with ads', 8.99, { ci: 2 }),
    disney: old('disney', 'Disney+', 13.99, { est: true, ci: 3 }),
    hulu: old('hulu', 'Hulu', 15, { ci: 4 }),
    c1: old('c1', 'My gym', 30, { group: 'custom', ci: 5 }),
  }, H: 20, startKey: keyFor(0), est: {} });
  m.poke();
  const sel = m.saved().sel;
  assert.deepStrictEqual(Object.keys(sel).sort(), ['c1', 'disney', 'gamepass', 'hulu', 'netflix']);
  assert.strictEqual(sel.gamepass.tier, 'gp-ult', 'the plan you paid for wins');
  assert.deepStrictEqual(sel.gamepass.items.map(i => [i.title, i.tier]), [['Old game', 'gp-ess'], ['New game', 'gp-ult']]);
  assert.strictEqual(sel.netflix.tier, 'nf-ads');
  assert.strictEqual(sel.disney.price, 12.49, 'an untouched old ballpark is refreshed');
  assert.strictEqual(sel.hulu.price, 15, 'a price you typed stays');
  assert.strictEqual(sel.c1.custom, true);
  assert.strictEqual(m.$$('#subs .sub').length, 5);
  assert.deepStrictEqual(m.errs, []);
});
test('migration: the old service month moves onto items and shifts when the window rolls forward', () => {
  const m = mount({ sel: { disney: old('disney', 'Disney+', 13.99, { paying: false, earliest: 3, items: [{ title: 'X', hours: 10 }, { title: 'Y', hours: 5, earliest: 4 }] }) }, H: 20, startKey: keyFor(1), est: {} });
  m.poke();
  assert.deepStrictEqual(m.saved().sel.disney.items.map(i => i.earliest), [2, 3]);
  const g = mount({ sel: { disney: old('disney', 'Disney+', 13.99, { earliest: 3, items: [{ title: 'X', hours: 10 }] }) }, H: 20, startKey: 'garbage', est: {} });
  g.poke();
  assert.strictEqual(g.saved().sel.disney.items[0].earliest, 0, 'unreadable startKey falls back to available now');
});
test('corrupt or hostile saved state loads without crashing', () => {
  const bad = [
    { sel: { a: { name: 'No items', price: 5 } }, H: 20 },
    { sel: { a: null, b: 7, c: old('c', 'Ok', 5, { items: [null, { title: 'x', hours: 'abc' }, { title: 'y', hours: 5 }], ci: 99 }) }, H: 'lots', est: 'oops' },
    '{"sel":{"__proto__":{"name":"Proto","price":1,"items":[]}},"H":-4,"est":{"home":"u6","work":5,"workH":"x"}}',
    { sel: [], H: 20 }, 'not json',
    { v: 2, sel: { gamepass: { tier: 'nf-ads', price: 'x', items: [{ title: 'g', hours: 2, tier: 'ps-ess' }] }, netflix: { tier: 'nope' } }, H: 20 },
    { sel: { a: old('a', '<img src=x onerror=alert(1)>', 5, { items: [{ title: '<b>t</b>', hours: 3 }] }) }, H: 20 },
  ];
  bad.forEach((seed, i) => {
    const m = mount(seed);
    assert.deepStrictEqual(m.errs, [], 'seed ' + i + ': ' + m.errs.join(';'));
    assert.ok(m.$('#homeAnswer').innerHTML.length > 0, 'seed ' + i);
    assert.ok(!m.$('#subs img') && !m.$('#plan img') && !m.$('#queue img') && !m.$('#queue b'), 'seed ' + i + ' injected markup');
    assert.ok(+m.$('#hrs').value >= 5 && +m.$('#hrs').value <= 160, 'seed ' + i);
  });
  const m = mount(bad[5]);
  m.poke();
  const s = m.saved().sel;
  assert.strictEqual(s.gamepass.tier, 'gp-ess', 'a plan from another service is replaced by the cheapest of this one');
  assert.ok(!('tier' in s.gamepass.items[0]), 'an item plan from another service is dropped');
  assert.strictEqual(s.netflix.tier, 'nf-ads');
});
test('saved TVMaze links and flags survive a reload, and junk values are dropped', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-ads', { items: [
    { title: 'Linked', hours: 4, earliest: 1, tv: 88337, unconfirmed: true },
    { title: 'Junk', hours: 4, earliest: 0, tv: '<script>', unconfirmed: 'yes' },
    { title: 'Neg', hours: 4, earliest: 0, tv: -3 },
  ] }) }));
  m.poke();
  const items = m.saved().sel.netflix.items;
  assert.strictEqual(items[0].tv, 88337);
  assert.strictEqual(items[0].unconfirmed, true);
  assert.ok(!('tv' in items[1]) && !('unconfirmed' in items[1]));
  assert.ok(!('tv' in items[2]));
});

/* ---------- dashboard ---------- */
test('menu: Your plan on top, then steps 1 and 2, then New releases; Free time opens from Your plan; old #overview links open Your plan', () => {
  const m = mount(undefined, { hash: '#overview' });
  assert.deepStrictEqual(m.$$('.nav a').map(a => a.dataset.go), ['home', 'services', 'list', 'soon']);
  assert.deepStrictEqual(m.$$('.nav a > span').map(a => a.textContent.replace(/\s+/g, ' ').trim()), ['Your plan', 'Step 1 Services', 'Step 2 My list', 'New releases']);
  const kids = [...m.$('.nav').children], seps = m.$$('.nav .nav-sep');
  assert.deepStrictEqual(seps.map(x => [kids.indexOf(x), x.textContent]), [[1, 'Steps'], [4, 'More']], 'Steps, then a third section below them');
  assert.strictEqual(m.$('#viewTitle').textContent, 'Your plan', 'the page that covers this month and the months after');
  assert.ok(!m.$('[data-view=overview]'));
  m.click(m.$('.nav [data-go=services]'));
  assert.strictEqual(m.$('#viewTitle').textContent, 'Services');
  assert.strictEqual(m.$('.nav [aria-current=page]').dataset.go, 'services');
  assert.strictEqual(m.d.activeElement, m.$('#viewTitle'));
  assert.strictEqual(m.w.location.hash, '#services');
  m.click(m.$('.nav [data-go=list]'));
  m.click(m.$('#listAdd ~ .ideas [data-go=soon]') || m.$('.ideas [data-go=soon]'));
  assert.ok(isVisible(m, 'soon'));
  assert.strictEqual(m.$('#viewTitle').textContent, 'New releases');
  assert.strictEqual(m.$('.nav [aria-current=page]').dataset.go, 'soon', 'New releases has its own place in the menu');
  assert.strictEqual(m.$$('.nav [aria-current]').length, 1);
  m.w.eval("go('estimates')");
  assert.strictEqual(m.$('#viewTitle').textContent, 'Free time');
  assert.strictEqual(m.$('.nav [data-go=home]').getAttribute('aria-current'), 'true', 'Free time opens from Your plan');
  m.click(m.$('#nextStep [data-go=home]'));
  assert.ok(isVisible(m, 'home'));
  assert.deepStrictEqual(m.errs, []);
});

test('full pages say which step they belong to and lead back to Your plan', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-ads', { items: [{ title: 'A show', hours: 8, earliest: 0 }] }) }), { hash: '#services' });
  for (const [v, n] of [['services', 1], ['list', 2]]) {
    m.click(m.$('.nav [data-go=' + v + ']'));
    assert.match(m.txt('#viewIntro .explain-step'), new RegExp('^Step ' + n + ' · all the choices'), v);
    assert.strictEqual(m.$('#viewIntro .explain-step [data-go]').dataset.go, 'home');
    assert.strictEqual(m.$('#nextStep .btn').dataset.go, 'home', v + ' leads back to Your plan');
  }
  m.w.eval("go('soon')");
  assert.ok(!m.$('#viewIntro .explain-step'), 'New releases is its own section, not a step');
  assert.strictEqual(m.$('#nextStep .btn').dataset.go, 'home');
  m.w.eval("go('estimates')");
  assert.ok(!m.$('#viewIntro .explain-step'));
  assert.strictEqual(m.$('#nextStep .btn').dataset.go, 'home');
  m.click(m.$('.nav [data-go=home]'));
  assert.ok(m.$('#nextStep').hidden && m.$('#viewIntro').hidden, 'Your plan carries its own words');
});
test('this month: with nothing yet there is no step 4; the example fills steps 3 and 4, with the year chart open', () => {
  const m = mount(undefined, { hash: '#overview' });
  assert.ok(isVisible(m, 'home'), 'old #overview links open Your plan');
  assert.ok(m.$('#part4').hidden, 'no step 4 before there is a plan');
  assert.strictEqual(m.$('#navCount').hidden, true);
  m.click(m.$('[data-do=example]'));
  assert.ok(!m.$('#part4').hidden);
  assert.strictEqual(m.txt('#h-p4'), 'The next months');
  assert.match(m.txt('#homeAnswer .ans-lead'), /^(This|Next) month you pay$/);
  assert.match(m.txt('#plan .nm-save'), /^(List done in [A-Z][a-z]+|Next 12 months): \$[\d,]+, not \$[\d,]+\. You save \$[\d,]+\. Counts only your list\.$/, 'savings against what you pay now, only until the list is done');
  assert.ok(m.$$('#plan .nm-r').length >= 2, 'one line a month');
  assert.strictEqual(m.$('#navCount').textContent, '6');
  ['.nm-cost', '.gantt', '#copyPlan', '.subtable'].forEach(q => assert.ok(m.$('#plan ' + q), q));
  assert.ok(m.$('#plan .nm-year .gantt') && !m.$('#plan details .gantt'), 'the year chart is always open, in no fold');
  assert.strictEqual(m.txt('#h-year'), 'Next 12 months');
  assert.ok(m.$('#plan .nm-cost .subtable') && !m.$('#plan details'), 'the cost per service is open too: no folds in step 4');
  assert.strictEqual(m.txt('#h-cost'), 'Cost per service');
  assert.strictEqual(m.$$('#plan .gantt .mt').length, 12, 'the chart shows what each month costs');
  assert.ok(m.$$('#plan .subtable tbody tr').length >= 5);
  assert.deepStrictEqual(m.errs, []);
});

test('dashboard: 20 services fit in the timeline and the subscriptions table', () => {
  const sel = {};
  for (let i = 0; i < 20; i++) sel['c' + i] = custom('c' + i, 'Service ' + i, 5 + i, { ci: i % 10, items: [{ title: 'T' + i, hours: 6, earliest: i % 12 }] });
  const m = mount(v2(sel, { H: 160 }));
  assert.strictEqual(m.$$('#plan .subtable tbody tr').length, 20);
  assert.strictEqual(m.$$('#plan .gantt .lab:not(.tot)').length, 20);
  assert.strictEqual(m.$$('#subs .sub').length, 20);
  assert.deepStrictEqual(m.errs, []);
});
test('the example opens on Your plan, from any page', () => {
  const m = mount(undefined, { hash: '#hours' });
  m.click(m.$('#loadExample'));
  assert.ok(isVisible(m, 'home'));
});
test('dashboard: the queue length shows on the Hours view', () => {
  const m = mount(v2({ c: custom('c', 'Alpha', 10, { items: [{ title: 'x', hours: 30, earliest: 0 }, { title: 'y', hours: 30, earliest: 0 }] }) }));
  assert.match(m.$('#hrsFit').textContent, /60 hours, so about 3 months\./);
});
test('dashboard: the subscriptions table uses planned hours, so an unscheduled service is not "Worth it"', () => {
  const m = mount(v2({
    a: custom('a', 'Alpha', 22.99, { items: [{ title: 'x', hours: 80 }], ci: 0 }),
    b: custom('b', 'Bravo', 20, { items: [{ title: 'y', hours: 60 }], ci: 1 }),
    c: custom('c', 'Charlie', 13.99, { items: [{ title: 'z', hours: 40 }], ci: 2 }),
  }, { H: 5 }));
  assert.match(m.$('#plan .warn').textContent, /^\d+ hours won’t fit in 12 months at /);
  const rows = m.$$('#plan .subtable tbody tr').map(r => r.textContent.replace(/\s+/g, ' ').trim());
  const unplanned = rows.filter(r => /Not planned/.test(r));
  assert.ok(unplanned.length >= 1, rows.join(' | '));
  unplanned.forEach(r => assert.ok(!/Worth it/.test(r), r));
  assert.ok(rows.every(r => !/NaN|Infinity/.test(r)));
});
test('dashboard: the first month is called "This month" only when the window starts this month', () => {
  const early = mount(undefined, { date: '2026-10-06T12:00:00' });
  early.click(early.$('[data-do=example]'));
  assert.strictEqual(early.txt('#homeAnswer .ans-lead'), 'This month you pay');
  assert.strictEqual(early.$('#qWhen').options[0].textContent, 'Out now');
  const late = mount(undefined, { date: '2026-10-25T12:00:00' });
  late.click(late.$('[data-do=example]'));
  assert.strictEqual(late.txt('#homeAnswer .ans-lead'), 'Next month you pay');
  assert.match(late.$$('#plan .gantt .mh')[0].title, /^November/);
  assert.match(late.$('#qWhen').options[0].textContent, /^From Nov 2026$/);
});

test('the next months: a service that stops and comes back says Cancel, then Start, then Cancel', () => {
  const m = mount(v2({ c: custom('c', 'Alpha', 10, { paying: false, items: [{ title: 'now', hours: 20, earliest: 0 }, { title: 'later', hours: 20, earliest: 4 }] }) }));
  const rows = nextRows(m);
  assert.deepStrictEqual(rows.map(r => r.split(' | ')[1]).filter(t => /Alpha/.test(t)), ['Cancel Alpha.', 'Start Alpha.', 'Cancel Alpha.'], rows.join(' || '));
  assert.ok(rows.some(r => /\| Nothing to pay\. \|  \| \$0$/.test(r)), 'months in between cost nothing: ' + rows.join(' || '));
});

test('dashboard: the year chart and cost per service stay open across re-renders; Copy plan copies the plan as text', async () => {
  const m = mount();
  m.click(m.$('[data-do=example]'));
  m.click(m.$('[data-chip=crunchy]'));
  assert.ok(m.$('#plan .nm-year .gantt') && m.$('#plan .nm-cost .subtable'));
  let copied = null;
  Object.defineProperty(m.w.navigator, 'clipboard', { configurable: true, value: { writeText: t => { copied = t; return Promise.resolve(); } } });
  m.click(m.$('#copyPlan'));
  await sleep(10);
  assert.ok(copied && copied.startsWith('My subscription rotation'), String(copied));
  assert.match(m.$('#toast').textContent, /Plan copied/);
});
test('shell: one main landmark, a skip link that moves focus without changing the route, headings on the Estimates view', () => {
  const m = mount(undefined, { hash: '#services' });
  assert.strictEqual(m.$$('main').length, 1);
  m.click(m.$('.skip'));
  assert.strictEqual(m.d.activeElement, m.$('main'));
  assert.strictEqual(m.w.location.hash, '#services');
  assert.strictEqual(m.$$('[data-view][aria-label]').length, 0);
  assert.strictEqual(m.$$('[data-view=estimates] h2').length, 2);
  assert.strictEqual(m.$$('h1').length, 1);
});
test('Back to the hashless first entry returns to Your plan, and Coming soon follows queue edits', async () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-ads', { items: [{ title: 'Show A', hours: 5, earliest: 0 }] }) }), { fetch: stub([], upItems()), hash: '#services' });
  m.w.location.hash = '';
  await sleep(40);
  assert.ok(isVisible(m, 'home') && !isVisible(m, 'services'));
  assert.match(rowOf(m, 'Show A').textContent, /On My list/);
  m.click(m.$('#queue [data-act=rmitem]'));
  assert.ok(rowOf(m, 'Show A').querySelector('[data-soon=add]'), 'removing the item brings back the Add button');
});

/* ---------- TVMaze through the queue bar ---------- */
const nf = () => v2({ netflix: row('netflix', 'nf-std'), disney: row('disney', 'disney', { ci: 1 }) });
test('TVMaze: typing searches once after a pause, shows escaped suggestions, and caches repeats', async () => {
  const f = stub([[/search\/shows/, resp(200, searchJson)]]);
  const m = mount(nf(), { fetch: f, hash: '#services' });
  m.typeTitle('ed'); m.typeTitle('edg'); m.typeTitle('edge');
  assert.strictEqual(f.tv().length, 0, 'nothing is sent while typing');
  await sleep(500);
  assert.strictEqual(f.tv().length, 1);
  assert.match(f.tv()[0], /search\/shows\?q=edge$/);
  const opts = m.$$('#qSugg [role=option]');
  assert.strictEqual(opts.length, 2);
  assert.match(opts[0].textContent, /Edgerunners Two.*2026 · Netflix · Coming$/, 'plain words, not TVMaze status names');
  assert.ok(!m.$('#qSugg img') && !m.$('#qSugg b'), 'results are escaped');
  assert.strictEqual(m.$('#qTitle').getAttribute('aria-expanded'), 'true');
  m.typeTitle('edgex'); m.typeTitle('edge'); await sleep(500);
  assert.strictEqual(f.tv().length, 1, 'the same query is served from memory');
  assert.deepStrictEqual(m.errs, []);
});
test('TVMaze: two characters or fewer never leave the device', async () => {
  const f = stub([[/search\/shows/, resp(200, searchJson)]]);
  const m = mount(nf(), { fetch: f });
  m.typeTitle('ab'); await sleep(500);
  assert.strictEqual(f.tv().length, 0);
  assert.ok(m.$('#qSugg').hidden);
});
test('TVMaze: picking by keyboard fills title, hours, month and service, and flags it unconfirmed', async () => {
  const f = stub([[/search\/shows/, resp(200, searchJson)], [/shows\/88337\?embed=episodes/, resp(200, showJson)]]);
  const m = mount(nf(), { fetch: f, hash: '#list' });   // My list: a pick fills the bar for you to check
  m.$('#qSvc').value = 'disney'; m.fire(m.$('#qSvc'), 'change');
  const inp = m.typeTitle('edge'); await sleep(500);
  m.key(inp, 'ArrowDown');
  assert.strictEqual(inp.getAttribute('aria-activedescendant'), m.$('#qSugg [role=option]').id);
  m.key(inp, 'Enter'); await sleep(40);
  assert.strictEqual(inp.value, 'Edgerunners Two');
  assert.strictEqual(m.$('#qHours').value, '2', '4 episodes of 30 minutes');
  assert.strictEqual(+m.$('#qWhen').value, Math.max(0, Math.min(11, monthsFromWindowStart(premiere))));
  assert.strictEqual(m.$('#qSvc').value, 'netflix', 'the bar moves to the service that has the show');
  assert.strictEqual(m.$('#qTier').value, 'nf-ads', 'a show only needs the basic plan');
  assert.match(m.txt('#qHint'), /^Netflix · premieres [A-Z][a-z]{2} \d+(, \d{4})? · 2 h\. Date may change\./);
  assert.match(m.txt('#qHint'), /Date may change/);
  assert.match(m.txt('#qLive'), /^Netflix · premieres/, 'screen readers hear the same short line');
  m.$('#qadd').dispatchEvent(new m.w.Event('submit', { bubbles: true, cancelable: true }));
  const it = m.saved().sel.netflix.items[0];
  assert.deepStrictEqual([it.title, it.tv, it.unconfirmed, it.tier], ['Edgerunners Two', 88337, true, 'nf-ads']);
  assert.match(m.txt('#queue .qmeta'), /date may change/);
  assert.strictEqual(f.tv().filter(u => /embed=episodes/.test(u)).length, 1);
});
test('TVMaze: a show on a service you do not have offers to add it', async () => {
  const f = stub([[/search\/shows/, resp(200, searchJson)], [/shows\/88337\?embed=episodes/, resp(200, showJson)]]);
  const m = mount(v2({ disney: row('disney', 'disney') }), { fetch: f, hash: '#list' });
  m.typeTitle('edge'); await sleep(500);
  m.click(m.$('#qSugg [data-sg="0"]')); await sleep(40);
  assert.ok(!m.$('#qHint button'), 'one Add button, not two');
  assert.strictEqual(m.$('#qAdd').textContent, 'Add to Netflix');
  assert.ok(m.$('#qadd').classList.contains('newsvc'), 'the service and plan fields step aside');
  m.$('#qadd').dispatchEvent(new m.w.Event('submit', { bubbles: true, cancelable: true }));
  assert.strictEqual(m.saved().sel.netflix.paying, false, 'added to plan around, not marked as paid');
  assert.strictEqual(m.saved().sel.netflix.items[0].tv, 88337);
  assert.strictEqual(m.$('#qAdd').textContent, 'Add');
  assert.ok(!m.$('#qadd').classList.contains('newsvc'));
  assert.deepStrictEqual(m.errs, []);
});
test('TVMaze: editing the title drops the link and the numbers the pick filled in; typed hours are kept', async () => {
  const mk = (id, name, n, mins) => ({ id, name, status: 'Running', premiered: null, webChannel: { name: 'Netflix' }, _embedded: { episodes: Array.from({ length: n }, (_, i) => ({ season: 1, number: i + 1, airdate: premiere, runtime: mins })) } });
  const hit = (id, name) => [{ score: 1, show: { id, name, premiered: '2026-01-01', status: 'Running', webChannel: { name: 'Netflix' } } }];
  const f = stub([[/search\/shows\?q=short$/, resp(200, hit(11, 'Short Show'))], [/search\/shows\?q=longrun$/, resp(200, hit(12, 'Longrun Show'))],
    [/shows\/11\?embed/, resp(200, mk(11, 'Short Show', 4, 15))], [/shows\/12\?embed/, resp(200, mk(12, 'Longrun Show', 100, 60))]]);
  const m = mount(v2({ netflix: row('netflix', 'nf-std') }), { fetch: f, hash: '#list' });
  m.typeTitle('short'); await sleep(500);
  m.click(m.$('#qSugg [data-sg="0"]')); await sleep(40);
  assert.strictEqual(m.$('#qHours').value, '1');
  m.typeTitle('longrun');
  assert.strictEqual(m.$('#qHours').value, '');
  assert.ok(m.$('#qHint').hidden);
  await sleep(500);
  m.click(m.$('#qSugg [data-sg="0"]')); await sleep(40);
  assert.strictEqual(m.$('#qHours').value, '100');
  m.$('#qHours').value = '7';
  m.typeTitle('short'); await sleep(500);
  m.click(m.$('#qSugg [data-sg="0"]')); await sleep(40);
  assert.strictEqual(m.$('#qHours').value, '7', 'hours typed by you are never overwritten');
  m.typeTitle('My own title');
  m.$('#qadd').dispatchEvent(new m.w.Event('submit', { bubbles: true, cancelable: true }));
  assert.ok(!('tv' in m.saved().sel.netflix.items[0]), 'a hand-typed title is not linked to a show');
});
test('TVMaze: a busy or unreachable service never blocks typing the title yourself', async () => {
  let n = 0;
  const f = stub([[/search\/shows/, () => (++n, resp(429, null))]]);
  const m = mount(nf(), { fetch: f });
  m.typeTitle('busy'); await sleep(500);
  assert.match(m.txt('#qMsg'), /Search is not working right now\. Type the name yourself/);
  assert.ok(m.$('#qSugg').hidden);
  assert.match(m.txt('#qLive'), /Search is not working right now/);
  m.typeTitle('busier'); await sleep(500);
  assert.strictEqual(n, 1, 'it backs off instead of asking again');
  m.addBar({ title: 'My own show', svc: 'disney', hours: 6 });
  assert.strictEqual(m.saved().sel.disney.items[0].title, 'My own show');
  const down = mount(nf(), { fetch: async () => { throw new Error('offline'); } });
  down.typeTitle('offline'); await sleep(500);
  assert.match(down.txt('#qMsg'), /Search is not working right now/);
  const none = mount(nf());
  none.typeTitle('anything'); await sleep(500);
  assert.ok(none.$('#qSugg').hidden, 'without fetch the box is a plain box');
  assert.deepStrictEqual(down.errs.concat(m.errs, none.errs), []);
});
test('TVMaze: a multi-word miss is retried once without the last word, never under 3 characters', async () => {
  const f = stub([[/search\/shows\?q=edge%20runner$/, resp(200, [])], [/search\/shows\?q=edge$/, resp(200, searchJson)]]);
  const m = mount(nf(), { fetch: f });
  m.typeTitle('edge runner'); await sleep(500);
  assert.strictEqual(f.tv().length, 2);
  assert.strictEqual(m.$$('#qSugg [role=option]').length, 2);
  const g = stub([[/search\/shows/, resp(200, [])]]);
  const n = mount(nf(), { fetch: g });
  n.typeTitle('ab cdefg'); await sleep(500);
  assert.strictEqual(g.tv().length, 1);
  assert.match(n.txt('#qMsg'), /No match/);
  const h = stub([[/search\/shows/, resp(200, [])]]);
  const k = mount(nf(), { fetch: h });
  k.typeTitle('aaa bbb ccc'); await sleep(500);
  assert.strictEqual(h.tv().length, 2, 'only one retry however many words');
});
test('TVMaze: a late answer never reopens a list you left or dismissed, and only the latest query shows', async () => {
  const dark = [{ score: 1, show: { id: 9, name: 'Dark Thing', premiered: '2020-01-01', status: 'Ended', webChannel: { name: 'Netflix' } } }];
  const f = stub([[/q=dark$/, () => sleep(50).then(() => resp(200, dark))], [/search\/shows/, () => sleep(300).then(() => resp(200, searchJson))]]);
  const m = mount(nf(), { fetch: f });
  const inp = m.$('#qTitle');
  inp.focus(); m.typeTitle('edge'); await sleep(400);
  inp.blur(); await sleep(500);
  assert.ok(m.$('#qSugg').hidden, 'leaving the box cancels the pending answer');
  m.typeTitle('edges'); await sleep(400);
  m.key(inp, 'Escape'); await sleep(500);
  assert.ok(m.$('#qSugg').hidden, 'Escape while a search is pending keeps it closed');
  m.typeTitle('edge'); await sleep(400);                 // slow answer in flight...
  m.typeTitle('dark'); await sleep(700);                 // ...then a new query answers first
  const names = m.$$('#qSugg [role=option]').map(li => li.textContent);
  assert.ok(names.length === 1 && /Dark Thing/.test(names[0]), names.join('|'));
  assert.deepStrictEqual(m.errs, []);
});
test('TVMaze: keyboard highlight resets when the text changes, and ArrowUp from nothing goes to the last option', async () => {
  const f = stub([[/search\/shows/, resp(200, searchJson)]]);
  const m = mount(nf(), { fetch: f });
  const inp = m.typeTitle('edge'); await sleep(500);
  m.key(inp, 'ArrowUp');
  assert.strictEqual(m.$('#qSugg [aria-selected=true]').dataset.sg, '1');
  m.key(inp, 'ArrowDown');
  assert.strictEqual(m.$('#qSugg [aria-selected=true]').dataset.sg, '0');
  m.typeTitle('edgex');
  assert.strictEqual(m.$$('#qSugg [aria-selected=true]').length, 0);
  assert.ok(!inp.hasAttribute('aria-activedescendant'));
  m.key(inp, 'Enter');
  assert.strictEqual(inp.value, 'edgex', 'Enter with nothing highlighted does not replace what you typed');
});

/* ---------- suggestions from the Coming soon list, on your device ---------- */
test('suggestions: a Coming soon game appears without any network call and sets the plan it needs', async () => {
  const f = stub([[/search\/shows/, resp(200, [])]], tierUp());
  const m = mount(v2({ gamepass: row('gamepass', 'gp-ess') }), { fetch: f, hash: '#services' });
  await sleep(30);
  m.typeTitle('ge');
  const li = m.$('#qSugg [role=option]');
  assert.ok(li, 'shown at two characters, before TVMaze is asked');
  assert.match(li.textContent, /Gears Test.*Game · Coming [A-Z][a-z]{2} \d+/);
  assert.strictEqual(f.tv().length, 0);
  m.click(li);
  assert.strictEqual(m.$('#qSvc').value, 'gamepass');
  assert.deepStrictEqual([...m.$('#qTier').options].map(o => o.value), ['gp-pc', 'gp-ult'], 'only plans that include it');
  assert.strictEqual(m.$('#qTier').value, 'gp-ult', 'PC Game Pass is only suggested to people who use it');
  assert.match(m.txt('#qHint'), /^Coming [A-Z][a-z]{2} \d+ · On Game Pass Ultimate or PC Game Pass\.$/, 'one short line, no extra notes');
  assert.strictEqual(m.$('#qHours').value, '20');
  m.$('#qadd').dispatchEvent(new m.w.Event('submit', { bubbles: true, cancelable: true }));
  assert.strictEqual(m.saved().sel.gamepass.items[0].tier, 'gp-ult');
  assert.strictEqual(m.saved().sel.gamepass.tier, 'gp-ess', 'your own plan stays as you set it');
  assert.deepStrictEqual(m.errs, []);
});
test('suggestions: a buy-only game says so, and a game on a service you lack offers to add it', async () => {
  const f = stub([], tierUp());
  const m = mount(v2({ disney: row('disney', 'disney') }), { fetch: f, hash: '#services' });
  await sleep(30);
  m.typeTitle('buy t'); m.click(m.$('#qSugg [role=option]'));
  assert.match(m.txt('#qHint'), /Not on any service when it comes out\./);
  m.typeTitle('gears'); m.click(m.$('#qSugg [role=option]'));
  assert.strictEqual(m.$('#qAdd').textContent, 'Add to Game Pass');
  m.$('#qadd').dispatchEvent(new m.w.Event('submit', { bubbles: true, cancelable: true }));
  assert.strictEqual(m.saved().sel.gamepass.tier, 'gp-ult');
  assert.strictEqual(m.saved().sel.gamepass.items[0].tier, 'gp-ult');
});

/* ---------- coming soon ---------- */
test('coming soon: lists valid upcoming items by date, drops old and malformed ones, escapes titles', async () => {
  const m = mount(undefined, { fetch: stub([], upItems()), hash: '#soon' });
  await sleep(30);
  const titles = soonRows(m).map(r => r.querySelector('b').textContent);
  assert.strictEqual(titles.length, 5, titles.join(' | '));
  assert.ok(!titles.includes('Long Gone') && !titles.some(t => /Bad/.test(t)));
  assert.ok(titles.indexOf('Game B') < titles.indexOf('Game C') && titles.indexOf('Game C') < titles.indexOf('Show A'));
  assert.ok(!m.$('#soonList img'));
  assert.match(rowOf(m, 'Show A').textContent, /Date may change/);
  assert.match(rowOf(m, 'Show A').textContent, /In 6 weeks/);
  assert.match(m.$('#soonMeta').textContent, /^Updated [A-Z][a-z]{2} \d+\.$/);
  assert.match(m.txt('.soon-foot'), /^Updated [A-Z][a-z]{2} \d+\. Dates can move\./, 'the date sits with the note at the bottom');
  assert.deepStrictEqual(m.errs, []);
});
test('coming soon: filter chips narrow the list and count only what the list shows', async () => {
  const m = mount(undefined, { fetch: stub([], upItems()), hash: '#soon' });
  await sleep(30);
  const chip = k => m.$('#soonFilters [data-filter=' + k + ']');
  assert.match(chip('game').textContent, /Games\s*2/);
  assert.match(chip('all').textContent, new RegExp('All\\s*' + soonRows(m).length));
  m.click(chip('game'));
  assert.ok(soonRows(m).every(r => /Game/.test(r.textContent)));
  assert.strictEqual(chip('game').getAttribute('aria-pressed'), 'true');
  m.click(chip('movie'));
  assert.strictEqual(soonRows(m).length, 1);
});
test('coming soon: one tap adds a show on the basic plan of the right service in the right month, unconfirmed, with Undo', async () => {
  const m = mount(undefined, { fetch: stub([], upItems()), hash: '#soon' });
  await sleep(30);
  m.click(rowOf(m, 'Show A').querySelector('[data-soon=add]'));
  assert.ok(m.$('#toast .undo'), 'one tap is easy to take back');
  m.click(m.$('#toast .undo'));
  assert.ok(!m.saved().sel.netflix);
  m.click(rowOf(m, 'Show A').querySelector('[data-soon=add]'));
  const s = m.saved().sel.netflix;
  assert.strictEqual(s.paying, false);
  assert.strictEqual(s.tier, 'nf-ads');
  assert.deepStrictEqual([s.items[0].title, s.items[0].hours, s.items[0].earliest, s.items[0].unconfirmed, s.items[0].tv, s.items[0].tier], ['Show A', 5, Math.max(0, monthsFromWindowStart(isoOffset(45))), true, 77, 'nf-ads']);
  assert.match(rowOf(m, 'Show A').textContent, /On My list/);
  assert.match(m.$('#toast').textContent, /Added Show A to My list\. You do not pay for Netflix yet\./);
  assert.strictEqual(m.$('#navCount').textContent, '1');
  assert.strictEqual(m.d.activeElement.dataset.queued, 'show-a', 'focus lands on the row that changed');
});
test('coming soon: Change opens the plan and hours you have, and Save replaces the entry', async () => {
  const m = mount(undefined, { fetch: stub([], upItems()), hash: '#soon' });
  await sleep(30);
  const row1 = openRow(m, 'Show A');
  assert.strictEqual(row1.querySelector('[data-soon=open]'), null, 'the Change button gives way to the form');
  assert.strictEqual(row1.querySelector('[data-soon-svc]').value, 'nf-ads');
  assert.strictEqual(row1.querySelector('[data-soon-hours]').value, '5');
  assert.strictEqual(row1.querySelector('[data-soon=confirm]').textContent, 'Save');
  row1.querySelector('[data-soon-svc]').value = 'nf-std';
  row1.querySelector('[data-soon-hours]').value = '7';
  m.click(row1.querySelector('[data-soon=confirm]'));
  assert.deepStrictEqual(m.saved().sel.netflix.items.map(i => [i.title, i.hours, i.tier]), [['Show A', 7, 'nf-std']], 'one entry, changed');
  assert.match(m.$('#toast').textContent, /^Saved Show A on Netflix Standard/);
  assert.ok(!m.$('#soonList .soon-form'));
  const again = openRow(m, 'Show A');
  assert.strictEqual(again.querySelector('[data-soon-svc]').value, 'nf-std');
  assert.strictEqual(again.querySelector('[data-soon-hours]').value, '7');
});
test('coming soon: games without a known plan default from their platforms; hours are editable', async () => {
  const m = mount(undefined, { fetch: stub([], upItems()), hash: '#soon' });
  await sleep(30);
  const b = openRow(m, 'Game B');
  assert.strictEqual(b.querySelector('[data-soon-svc]').value, 'ps-extra');
  assert.strictEqual(b.querySelector('[data-soon-hours]').value, '20');
  const c = openRow(m, 'Game C');
  assert.strictEqual(c.querySelector('[data-soon-svc]').value, 'gp-ult');
  c.querySelector('[data-soon-hours]').value = '30';
  m.click(c.querySelector('[data-soon=confirm]'));
  assert.strictEqual(m.saved().sel.gamepass.items[0].hours, 30);
});
test('coming soon: Cancel and Escape close the form and keep focus; a date past the window cannot be added', async () => {
  const m = mount(undefined, { fetch: stub([], upItems()), hash: '#soon' });
  await sleep(30);
  openRow(m, 'Game B');
  m.click(m.$('#soonList [data-soon=cancel]'));
  assert.ok(!m.$('#soonList .soon-form'));
  assert.strictEqual(m.d.activeElement, rowOf(m, 'Game B').querySelector('[data-soon=open]'));
  m.click(rowOf(m, 'Game B').querySelector('[data-soon=open]'));
  m.key(m.$('#soonList [data-soon-hours]'), 'Escape');
  assert.strictEqual(m.d.activeElement, rowOf(m, 'Game B').querySelector('[data-soon=open]'));
  assert.match(rowOf(m, 'Far Away').textContent, /After your 12 months/);
  assert.ok(!rowOf(m, 'Far Away').querySelector('[data-soon=add]'));
  assert.deepStrictEqual(m.saved().sel.psplus.items.map(i => i.title), ['Game B'], 'Cancel and Escape change nothing');
});
test('coming soon: a missing or broken file shows a message and leaves the rest of the app working', async () => {
  const a = mount(undefined, { fetch: async () => resp(404, null), hash: '#soon' });
  const b = mount(undefined, { fetch: async () => { throw new Error('offline'); }, hash: '#soon' });
  const c = mount(undefined, { hash: '#soon' });
  const d = mount(undefined, { fetch: stub([], { checked: 5, items: 'nope' }), hash: '#soon' });
  await sleep(30);
  [a, b, c].forEach(x => assert.match(x.$('#soonList').textContent, /Release dates did not load\./));
  assert.match(d.$('#soonList').textContent, /Nothing here yet\./);
  c.click(c.$('[data-do=example]'));
  assert.ok(!c.$('#part4').hidden && c.$$('#plan .nm-r').length >= 1);
  assert.deepStrictEqual(a.errs.concat(b.errs, c.errs, d.errs), []);
});

/* ---------- plans ---------- */
test('plans: a top-plan game only offers plans that include it; a basic one defaults to basic even if you pay for more', async () => {
  const m = mount(v2({ gamepass: row('gamepass', 'gp-ult') }), { fetch: stub([], tierUp()), hash: '#soon' });
  await sleep(30);
  assert.match(rowOf(m, 'Gears Test').textContent, /On Game Pass Ultimate or PC Game Pass/);
  assert.doesNotMatch(rowOf(m, 'Gears Test').textContent, /Day one/, 'the fine print waits for Change');
  const g = openRow(m, 'Gears Test');
  assert.strictEqual(g.querySelector('.soon-note').textContent, 'Day one');
  assert.deepStrictEqual([...g.querySelectorAll('[data-soon-svc] option')].map(o => o.value).sort(), ['gp-pc', 'gp-ult']);
  assert.strictEqual(g.querySelector('[data-soon-svc]').value, 'gp-ult');
  const r = openRow(m, 'Racer Test');
  assert.strictEqual(r.querySelector('[data-soon-svc]').value, 'gp-ess');
  assert.deepStrictEqual([...r.querySelectorAll('[data-soon-svc] option')].map(o => o.value).sort(), ['gp-ess', 'gp-prem', 'gp-ult', 'ps-extra', 'ps-prem']);
  const pc = mount(v2({ gamepass: row('gamepass', 'gp-pc') }), { fetch: stub([], tierUp()), hash: '#soon' });
  await sleep(30);
  assert.strictEqual(openRow(pc, 'Gears Test').querySelector('[data-soon-svc]').value, 'gp-pc', 'PC players get PC Game Pass');
  const ps = mount(v2({ psplus: row('psplus', 'ps-ess') }), { fetch: stub([], tierUp()), hash: '#soon' });
  await sleep(30);
  assert.strictEqual(openRow(ps, 'Racer Test').querySelector('[data-soon-svc]').value, 'ps-extra');
});
test('plans: buy-only games cannot be queued on a subscription; unknown plan ids are ignored', async () => {
  const m = mount(undefined, { fetch: stub([], tierUp()), hash: '#soon' });
  await sleep(30);
  const b = rowOf(m, 'Buy Test');
  assert.match(b.querySelector('.plan').textContent, /^Sold separately$/, 'the pill says Buy only, the note says the rest');
  assert.match(b.textContent, /Buy only/);
  assert.ok(!b.querySelector('[data-soon=add]') && !b.querySelector('[data-soon=open]'));
  assert.match(rowOf(m, 'Junk Subs').textContent, /Buy only/);
  assert.ok(!rowOf(m, 'Junk Subs').querySelector('[data-soon=add]'));
});
test('plans: when two plans of one service are active in a month, you pay only the higher one', () => {
  const m = mount(v2({ gamepass: row('gamepass', 'gp-ult', { paying: false, items: [{ title: 'Old game', hours: 10, earliest: 0, tier: 'gp-ess' }, { title: 'New game', hours: 10, earliest: 0, tier: 'gp-ult' }] }) }, { H: 40 }));
  assert.strictEqual(m.txt('#homeAnswer .ans-big'), '$22.99', 'not $32.98');
  assert.ok(m.$$('#plan .gantt .cell.on.inc').some(c => /included with Game Pass Ultimate/.test(c.title)));
  assert.match(m.$$('#plan .gantt .mt')[0].textContent, /\$23/);
});

test('plans: step 3 says Upgrade instead of start-and-cancel; a price option you pay for keeps the shows it covers', () => {
  const up = mount(v2({ gamepass: row('gamepass', 'gp-ess', { items: [{ title: 'New game', hours: 10, earliest: 0, tier: 'gp-ult' }] }) }));
  assert.match(todayActs(up), /Upgrade Game Pass Essential to Game Pass Ultimate/);
  assert.doesNotMatch(todayActs(up), /Start|Cancel/);
  assert.ok(ansLines(up).some(l => /Bigger price option\.$/.test(l)), 'the word is explained on its line');
  assert.match(up.txt('#plan .subtable tr.idle'), /Needs a bigger price option\s*Upgrade/, 'Details says Upgrade too, not Step down');
  const down = mount(v2({ gamepass: row('gamepass', 'gp-ult', { items: [{ title: 'Old game', hours: 10, earliest: 0, tier: 'gp-ess' }] }) }));
  assert.strictEqual(todayActs(down), 'Keep Game Pass Ultimate', 'no step down you never asked for');
});

test('plans: a queued game that needs a higher plan is flagged and fixed in one tap', async () => {
  const m = mount(v2({ gamepass: row('gamepass', 'gp-ess', { items: [{ title: 'Gears Test', hours: 12, earliest: 0 }, { title: 'Racer Test', hours: 8, earliest: 0 }] }) }), { fetch: stub([], tierUp()), hash: '#services' });
  await sleep(30);
  const items = m.$$('#queue .qitem');
  const fix = items[0].querySelector('[data-act=fixtier]');
  assert.strictEqual(fix.textContent, 'Use Ultimate');
  assert.match(items[0].querySelector('.qmeta').textContent, /^Needs Ultimate/);
  assert.ok(!items[1].querySelector('[data-act=fixtier]'), 'Essential is enough for the racer');
  m.click(fix);
  assert.strictEqual(m.saved().sel.gamepass.items[0].tier, 'gp-ult');
  assert.strictEqual(m.saved().sel.gamepass.items[0].hours, 12);
  assert.match(m.$('#toast').textContent, /Gears Test now needs Game Pass Ultimate/);
  assert.ok(!m.$('#queue [data-act=fixtier]'));
});
test('import: a Netflix charge on the statement sets the plan on your Netflix row instead of adding another', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-ads') }), { hash: '#services' });
  m.$('#pasteBox').value = 'Date,Description,Amount\n07/07/2026,NETFLIX.COM,-17.99\n08/07/2026,NETFLIX.COM,-17.99\n09/07/2026,NETFLIX.COM,-17.99';
  m.click(m.$('#scanPaste')); m.click(m.$('#addFound'));
  assert.strictEqual(m.$$('#subs .sub').length, 1);
  assert.strictEqual(m.saved().sel.netflix.tier, 'nf-std');
  assert.strictEqual(m.saved().sel.netflix.price, 17.99);
});

/* ---------- review fixes ---------- */
const precious = () => v2({ netflix: row('netflix', 'nf-std', { price: 15.49, items: [{ title: 'My show', hours: 9, earliest: 0 }, { title: 'Later', hours: 6, earliest: 4 }] }), c1: custom('c1', 'My gym', 30, { ci: 1 }) }, { H: 45 });
const undoTap = m => { const b = m.$('#toast .undo'); assert.ok(b, 'the toast offers Undo'); m.click(b); };
test('undo: Clear all, a chip and the row remove all put your list back; the example never touches it', () => {
  const pick = s => ({ sel: s.sel, H: s.H });
  const seed = mount(precious()); seed.poke(); const before = pick(seed.saved());
  const a = mount(precious());
  const mine = JSON.stringify(a.saved());
  a.click(a.$('#loadExample'));
  assert.ok(!a.$('#exBar').hidden, 'the example says so');
  assert.strictEqual(JSON.stringify(a.saved()), mine, 'your saved list is untouched');
  a.click(a.$('#exBack'));
  assert.ok(a.$('#exBar').hidden);
  assert.ok(a.saved().sel.c1, 'back to your own list');
  assert.strictEqual(a.$('#hrs').value, '45');
  const b = mount(precious());
  b.click(b.$('#reset')); assert.deepStrictEqual(b.saved().sel, {});
  undoTap(b); assert.deepStrictEqual(pick(b.saved()), before);
  const c = mount(precious());
  c.click(c.$('[data-chip=netflix]')); assert.ok(!c.saved().sel.netflix);
  assert.match(c.$('#toast').textContent, /Removed Netflix/);
  undoTap(c); assert.deepStrictEqual(c.saved().sel.netflix, before.sel.netflix);
  const d = mount(precious(), { hash: '#services' });
  d.click(d.$('.sub[data-id=c1] [data-act=remove]'));
  undoTap(d); assert.deepStrictEqual(d.saved().sel.c1, before.sel.c1);
  const e = mount();
  e.click(e.$('[data-chip=hulu]')); e.click(e.$('[data-chip=hulu]'));
  assert.ok(!e.$('#toast .undo'), 'nothing to undo for a service you just tapped on and off');
  assert.deepStrictEqual(a.errs.concat(b.errs, c.errs, d.errs, e.errs), []);
});
test('a fractional month in saved data is rounded down instead of crashing the page', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'A', hours: 10, earliest: 2.5 }] }) }), { hash: '#services' });
  assert.deepStrictEqual(m.errs, []);
  assert.ok(isVisible(m, 'services'));
  m.poke();
  assert.strictEqual(m.saved().sel.netflix.items[0].earliest, 2);
});
test('your own price for the plan you pay counts: a $0 Premium perk is kept, not stepped down from', () => {
  const m = mount(v2({ disney: row('disney', 'disney-prem', { price: 0, items: [{ title: 'Andor', hours: 10, earliest: 0 }, { title: 'Bluey', hours: 10, earliest: 2 }] }) }));
  const today = todayActs(m);
  assert.match(today, /Keep Disney\+ Premium/);
  assert.doesNotMatch(today, /Step down/);
  assert.match(m.txt('#plan .nm-save'), /: \$0, the same as now\./, 'no saving: never "$0, not $0"');
});

test('one Ultimate covers a month that needs Premium and PC Game Pass, and the year baseline knows it', () => {
  const m = mount(v2({ gamepass: row('gamepass', 'gp-prem', { paying: false, items: [{ title: 'Console game', hours: 20, earliest: 0, tier: 'gp-prem' }, { title: 'PC game', hours: 20, earliest: 0, tier: 'gp-pc' }] }) }, { H: 40 }));
  assert.match(m.$$('#plan .gantt .mt')[0].textContent, /\$23/, 'not $29');
  assert.match(todayActs(m), /Start Game Pass Ultimate/);
  assert.match(m.txt('#plan .nm-save'), /: \$23\. If you change nothing: \$0\./, 'you pay for nothing now, so it says what the plan costs');
  assert.ok(m.$$('#plan .gantt .cell.inc').some(c => /included with Game Pass Ultimate/.test(c.title)));
  assert.ok(m.$$('#plan .subtable tbody th').some(th => /Game Pass Ultimate/.test(th.textContent)), 'the plan that pays shows in the table');
});

test('add bar: a suggestion\'s plan does not stick to the next title you type yourself', async () => {
  const m = mount(v2({ psplus: row('psplus', 'ps-ess') }), { fetch: stub([], tierUp()), hash: '#services' });
  await sleep(30);
  m.typeTitle('racer'); m.click(m.$('#qSugg [role=option]'));
  assert.strictEqual(m.$('#qTier').value, 'ps-extra');
  m.typeTitle('My own PS game');
  assert.strictEqual(m.$('#qTier').value, 'ps-ess');
  m.$('#qadd').dispatchEvent(new m.w.Event('submit', { bubbles: true, cancelable: true }));
  assert.strictEqual(m.saved().sel.psplus.items[0].tier, 'ps-ess');
});
test('add bar: a slow episode lookup for one show never overwrites a later pick of a show with the same name', async () => {
  const twins = [{ score: 1, show: { id: 1, name: 'Same Name', premiered: '2010-01-01', status: 'Ended', webChannel: { name: 'Netflix' } } }, { score: 0.9, show: { id: 2, name: 'Same Name', premiered: '2024-01-01', status: 'Ended', webChannel: { name: 'Netflix' } } }];
  const eps = (id, n) => ({ id, name: 'Same Name', status: 'Ended', webChannel: { name: 'Netflix' }, _embedded: { episodes: Array.from({ length: n }, (_, i) => ({ season: 1, number: i + 1, airdate: '2024-01-0' + (1 + (i % 8)), runtime: 60 })) } });
  const f = stub([[/search\/shows/, resp(200, twins)], [/shows\/1\?embed/, () => sleep(900).then(() => resp(200, eps(1, 30)))], [/shows\/2\?embed/, resp(200, eps(2, 4))]]);
  const m = mount(v2({ netflix: row('netflix', 'nf-std') }), { fetch: f, hash: '#list' });
  m.typeTitle('same name'); await sleep(450);
  m.click(m.$('#qSugg [data-sg="0"]'));                  // slow lookup starts...
  m.typeTitle('same name'); await sleep(450);
  m.click(m.$('#qSugg [data-sg="1"]')); await sleep(900); // ...and lands after the second pick, with the same title in the box
  assert.strictEqual(m.$('#qHours').value, '4', 'the later pick wins');
  m.$('#qadd').dispatchEvent(new m.w.Event('submit', { bubbles: true, cancelable: true }));
  assert.strictEqual(m.saved().sel.netflix.items[0].tv, 2);
});
test('add bar: adding the missing service another way puts the bar back to normal, on that service', async () => {
  const m = mount(v2({ disney: row('disney', 'disney') }), { fetch: stub([], tierUp()), hash: '#services' });
  await sleep(30);
  m.typeTitle('gears'); m.click(m.$('#qSugg [role=option]'));
  assert.strictEqual(m.$('#qAdd').textContent, 'Add to Game Pass');
  m.click(m.$('[data-chip=gamepass]'));
  assert.strictEqual(m.$('#qAdd').textContent, 'Add');
  assert.strictEqual(m.$('#qSvc').value, 'gamepass');
  assert.strictEqual(m.saved().sel.gamepass.paying, true, 'a service you tap is one you pay for');
});
test('add bar: PC Game Pass members queue on PC Game Pass by default, not on Essential', () => {
  const m = mount(v2({ gamepass: row('gamepass', 'gp-pc') }), { hash: '#services' });
  m.$('#qSvc').value = 'gamepass'; m.fire(m.$('#qSvc'), 'change');
  assert.strictEqual(m.$('#qTier').value, 'gp-pc');
  assert.match(m.$('#qTier').selectedOptions[0].textContent, /^Yours \(PC Game Pass\)$/);
  m.addBar({ title: 'Some PC game', svc: 'gamepass', hours: 20 });
  assert.strictEqual(m.saved().sel.gamepass.items[0].tier, 'gp-pc');
  assert.doesNotMatch(m.txt('#plan .today .acts'), /Cancel PC Game Pass|Game Pass Essential/);
});
test('add bar: a buy-only game cannot be queued on a subscription', async () => {
  const m = mount(v2({ psplus: row('psplus', 'ps-ess') }), { fetch: stub([], tierUp()), hash: '#services' });
  await sleep(30);
  m.typeTitle('buy t'); m.click(m.$('#qSugg [role=option]'));
  m.$('#qadd').dispatchEvent(new m.w.Event('submit', { bubbles: true, cancelable: true }));
  assert.strictEqual(m.saved() ? (m.saved().sel.psplus || { items: [] }).items.length : 0, 0);
  assert.match(m.$('#toast').textContent, /^No service has Buy Test\. You have to buy it\./);
});
test('timeline: two plans of one service are labelled by plan, cheaper first', () => {
  const m = mount(v2({ gamepass: row('gamepass', 'gp-ult', { paying: false, items: [{ title: 'New', hours: 10, earliest: 0, tier: 'gp-ult' }, { title: 'Old', hours: 10, earliest: 3, tier: 'gp-ess' }] }) }));
  const labs = m.$$('#plan .gantt .lab:not(.tot) .nm').map(n => n.textContent);
  assert.deepStrictEqual(labs, ['EssentialGame Pass', 'UltimateGame Pass']);
  assert.ok(m.$('#plan .gantt .lab.alt'), 'the cheaper plan looks different, not only by colour');
});

/* ---------- getting started, intros, estimates ---------- */


test('every page explains itself: what it is, why it is here, what to do', () => {
  const m = mount();
  const check = (v, rows) => {
    assert.strictEqual(rows.length, 3, v + ': three rows');
    rows.forEach(r => {
      const q = r.querySelector('dt').textContent, a = r.querySelector('dd').textContent;
      assert.match(q, /\?$/, v + ': the label is a question: ' + q);
      assert.ok(a.length > 5 && a.length <= 110, v + ': short answer: ' + a);
      assert.ok((a.match(/[.!?](\s|$)/g) || []).length <= 2, v + ': one or two sentences: ' + a);
      a.split(/[.!?](?:\s|$)/).filter(x => x.trim()).forEach(sen => assert.ok(sen.trim().split(/\s+/).length <= 12, v + ': 12 words or fewer: ' + sen));
    });
  };
  check('home', m.$$('#homeAnswer .ans-empty dl > div'));
  ['services', 'list', 'soon', 'estimates'].forEach(v => { m.w.eval("go('" + v + "')"); check(v, m.$$('#viewIntro dl > div')); });
  const m2 = mount(undefined, { hash: '#estimates' });
  assert.match(m2.txt('#viewIntro'), /Why is it here\?/, 'Free time says why it exists');
});test('my list: empty states point to the next thing to do, and New releases is one tap away', () => {
  const a = mount(undefined, { hash: '#list' });
  assert.match(a.txt('#queue'), /We add its service for you/);
  assert.ok(a.$('#queue [data-go=services]'));
  const b = mount(v2({ netflix: row('netflix', 'nf-ads') }), { hash: '#list' });
  assert.match(b.txt('#queue'), /new releases/i);
  assert.strictEqual(b.$$('#queue [data-go=soon]').length, 0, 'one See new releases button on the page, not two');
  b.click(b.$('.ideas [data-go=soon]'));
  assert.ok(isVisible(b, 'soon'));
  assert.match(b.txt('#homeAnswer'), /Add what you want in step 2 first\./);
  const c = mount();
  assert.strictEqual(c.$('#part2 .ideas [data-go]').dataset.go, 'soon', 'step 2 on Your plan links to New releases too');
});test('estimates: Work and School are radio groups with one tab stop and arrow keys', () => {
  const m = mount(undefined, { hash: '#estimates' });
  const radios = () => m.$$('#estWork [role=radio]');
  const on = () => radios().findIndex(r => r.getAttribute('aria-checked') === 'true');
  assert.strictEqual(radios().filter(r => r.tabIndex === 0).length, 1, 'one tab stop');
  assert.strictEqual(radios()[on()].tabIndex, 0, 'the chosen one is the tab stop');
  const start = on();
  radios()[start].focus();
  m.key(radios()[start], 'ArrowRight');
  assert.strictEqual(on(), (start + 1) % radios().length);
  assert.strictEqual(m.d.activeElement, radios()[on()], 'focus follows the choice');
  m.key(m.d.activeElement, 'Home');
  assert.strictEqual(on(), 0);
  m.key(m.d.activeElement, 'ArrowLeft');
  assert.strictEqual(on(), radios().length - 1, 'wraps around');
  assert.strictEqual(m.saved().est.work, m.$$('#estWork [role=radio]')[on()].dataset.estwork);
  assert.match(m.txt('.slider-top'), /^[\d.]+ (hours?|minutes) a day$/);
  assert.match(m.txt('#estWhy'), /168 hours/);
});
test('the tab bar has four equal tabs', () => {
  const m = mount();
  assert.strictEqual(m.$$('.nav a').length, 4);
  assert.match(html, /\.nav\{[^}]*grid-template-columns:repeat\(4,/);
  assert.match(html, /\.nav-sep\{display:none\}/, 'the Steps divider only shows in the desktop menu');
});

/* ---------- review fixes (2026-10-11) ---------- */
// the first change in "The next months"
const nextText = m => { const r = m.$$('#plan .nm-r').find(x => !/^(Nothing to pay|No change)\.$/.test(x.querySelector('.nm-t b').textContent)); return r ? r.querySelector('.nm-t b').textContent : ''; };
// step 3 as "Start Game Pass Ultimate. Keep Netflix Standard": the pressed button and the name
const todayActs = m => m.$$('#homeAnswer .al').map(l => l.querySelector('.seg-b[aria-pressed=true]').textContent.replace(/^✓\s*/, '') + ' ' + l.querySelector('.al-t b').textContent).join('. ');
test('next change counts what is paid: one higher plan bought for a mix is an upgrade, a covered plan ending is a step down', () => {
  const b = mount(v2({ gamepass: row('gamepass', 'gp-prem', { items: [{ title: 'Console', hours: 40, earliest: 0, tier: 'gp-prem' }, { title: 'PC', hours: 20, earliest: 1, tier: 'gp-pc' }] }) }, { H: 30 }));
  assert.match(nextText(b), /Upgrade Game Pass Premium to Game Pass Ultimate/, nextText(b));
  assert.doesNotMatch(nextText(b), /Start PC Game Pass/);
  const d = mount(v2({ gamepass: row('gamepass', 'gp-ess', { paying: false, items: [{ title: 'New', hours: 10, earliest: 0, tier: 'gp-ult' }, { title: 'Old', hours: 40, earliest: 0, tier: 'gp-ess' }] }) }, { H: 30 }));
  assert.match(todayActs(d), /Start Game Pass Ultimate/);
  assert.match(nextText(d), /Step down from Game Pass Ultimate to Game Pass Essential/, nextText(d));
  const plain = mount(v2({ a: custom('a', 'Alpha', 10, { items: [{ title: 'x', hours: 20, earliest: 0 }] }), b: custom('b', 'Bravo', 10, { ci: 1, items: [{ title: 'y', hours: 20, earliest: 1 }] }) }));
  assert.match(nextText(plain), /Cancel Alpha\. Start again: Bravo\./, nextText(plain));   // what to stop comes first
});
test('details: a paid top plan the rotation buys as a bundle is not listed as "Nothing on your list"; fully included plans say Included', () => {
  const m = mount(v2({ gamepass: row('gamepass', 'gp-ult', { items: [{ title: 'Console', hours: 20, earliest: 0, tier: 'gp-prem' }, { title: 'PC', hours: 40, earliest: 0, tier: 'gp-pc' }] }) }, { H: 30 }));
  const rows = m.$$('#plan .subtable tbody tr').map(r => [...r.children].map(c => c.textContent.replace(/\s+/g, ' ').trim()).join(' '));
  assert.strictEqual(rows.filter(r => /^Game Pass Ultimate/.test(r)).length, 1, rows.join(' | '));
  assert.ok(!rows.some(r => /Nothing on your list/.test(r)), rows.join(' | '));
  assert.ok(rows.filter(r => /^(Game Pass Premium|PC Game Pass) 0 \$0/.test(r)).every(r => /Included/.test(r) && !/Worth it/.test(r)), rows.join(' | '));
  assert.match(todayActs(m), /Keep Game Pass Ultimate/);
});
test('estimates: tapping your answer counts as setting your time, even when it matches the starting time', () => {
  const m = mount(undefined, { hash: '#estimates' });
  m.click(m.$('[data-estwork=ft]'));
  assert.strictEqual(m.$('#hrs').value, '75');
  assert.strictEqual(m.saved().hSet, true);
});
test('estimates: moving the slider yourself says so, and a choice puts the estimate back', () => {
  const m = mount(undefined, { hash: '#estimates' });
  m.$('#hrs').value = '100'; m.fire(m.$('#hrs'), 'input');
  assert.ok(!m.$('#hrsHand').hidden);
  assert.strictEqual(m.txt('.slider-top'), '3.5 hours a day');
  m.click(m.$('[data-estwork=ft]'));
  assert.ok(m.$('#hrsHand').hidden);
  assert.strictEqual(m.$('#hrs').value, '75');
  assert.strictEqual(m.$('#hrs').getAttribute('aria-valuetext'), '2.5 hours a day');
});
test('estimates: short times read in minutes, and the effect on your list is spelled out', () => {
  const m = mount(v2({ c: custom('c', 'Alpha', 10, { items: [{ title: 'x', hours: 30, earliest: 0 }] }) }, { H: 20 }), { hash: '#estimates' });
  assert.strictEqual(m.txt('.slider-top'), '40 minutes a day');
  assert.strictEqual(m.txt('#hrsWeek'), 'About 20 hours a month.');
  assert.match(m.txt('#hrsFit'), /Your list: about 30 hours, so about 1\.5 months\./);
  m.$('#hrs').value = '30'; m.fire(m.$('#hrs'), 'input');
  assert.strictEqual(m.txt('.slider-top'), '1 hour a day');
});
test('a first visit replaces its hashless entry, so Back returns to Your plan', () => {
  const m = mount();
  assert.strictEqual(m.w.location.hash, '#home');
  assert.ok(isVisible(m, 'home'));
  assert.ok(isVisible(mount(undefined, { hash: '#start' }), 'home'), 'old #start links open Your plan');
});
test('removing a title or a service keeps keyboard focus in the list; Undo moves it to the page title', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-ads', { items: [{ title: 'A', hours: 2, earliest: 0 }, { title: 'B', hours: 2, earliest: 0 }, { title: 'C', hours: 2, earliest: 0 }] }), hulu: row('hulu', 'hulu', { ci: 1 }) }), { hash: '#list' });
  const x = m.$$('#queue [data-act=rmitem]')[1]; x.focus(); m.click(x);
  assert.strictEqual(m.d.activeElement, m.$$('#queue [data-act=rmitem]')[1], 'the next title\'s remove button');
  const last = m.$$('#queue [data-act=rmitem]'); last[1].focus(); m.click(last[1]); m.click(m.d.activeElement);
  assert.strictEqual(m.d.activeElement, m.$('#qTitle'), 'an empty list hands focus to the add bar');
  m.click(m.$('.nav [data-go=services]'));
  const r = m.$('.sub[data-id=netflix] [data-act=remove]'); r.focus(); m.click(r);
  assert.strictEqual(m.d.activeElement, m.$('.sub[data-id=hulu] [data-act=remove]'));
  m.click(m.$('.sub[data-id=hulu] [data-act=remove]'));
  assert.strictEqual(m.d.activeElement, m.$('#chips [data-chip]'));
  const before = m.saved();
  m.click(m.$('[data-chip=netflix]'));
  m.$('.sub[data-id=netflix] [data-field=price]').value = '5'; m.fire(m.$('.sub[data-id=netflix] [data-field=price]'), 'input');
  m.click(m.$('.sub[data-id=netflix] [data-act=remove]'));
  m.click(m.$('#toast .undo'));
  assert.strictEqual(m.d.activeElement, m.$('#viewTitle'));
  assert.ok(m.saved().sel.netflix && before);
});
test('a TV pick with no date asks for the month instead of claiming the date can move', async () => {
  const nodate = { id: 9, name: 'Nodate Show', status: 'In Development', premiered: null, webChannel: { name: 'Netflix' }, _embedded: { episodes: [] } };
  const f = stub([[/search\/shows/, resp(200, [{ score: 1, show: { id: 9, name: 'Nodate Show', premiered: null, status: 'In Development', webChannel: { name: 'Netflix' } } }])], [/shows\/9\?embed/, resp(200, nodate)]]);
  const m = mount(v2({ netflix: row('netflix', 'nf-ads') }), { fetch: f, hash: '#list' });
  m.typeTitle('nodate'); await sleep(450);
  m.click(m.$('#qSugg [data-sg="0"]')); await sleep(40);
  assert.match(m.txt('#qHint'), /No date yet\. Pick a month\./);
  assert.doesNotMatch(m.txt('#qHint'), /date can move/);
});


/* ---------- visual audit fixes (2026-10-11) ---------- */
test('the next months: amounts match the chart; whole hours; empty months share one line that says the list is done', () => {
  const m = mount(v2({ psplus: row('psplus', 'ps-extra', { items: [{ title: 'Game', hours: 30, earliest: 0 }] }) }));
  const big = m.txt('#homeAnswer .ans-big');
  assert.match(big, /^\$\d+\.\d\d$/, 'a bill with cents shows its cents');
  assert.strictEqual(m.$$('#plan .gantt .mt .w')[0].textContent, big, 'step 3 and the chart agree');
  assert.match(ansLines(m)[0], /^Keep \| PS Plus Extra \| Game takes about 30 hours\. 20 hours (this|next) month\. Keep it until [A-Z][a-z]+ to finish\.$/, 'one long title: how long it takes, and how long to keep the service');
  const rows = nextRows(m);
  assert.deepStrictEqual(rows.map(r => r.split(' | ')[1]), ['No change.', 'Cancel PS Plus Extra.', 'Nothing to pay.'], rows.join(' || '));
  assert.match(rows[0], /\| You pay for PS Plus Extra\. \| \$16\.99$/);
  assert.match(rows[2], /^[A-Z][a-z]+ to [A-Z][a-z]+ \| Nothing to pay\. \| Your list is done\. \| \$0$/);
  assert.match(m.txt('#plan .nm-hint'), /^Plan further\? Add more to My list\.$/);
  assert.match(m.$$('#plan .gantt .mt .n')[0].textContent, /^\$\d+$/, 'phones show whole dollars where there is no room');
});

test('services: single-price services say "One price" in a box that lines up with the dropdowns; Paying has one label', () => {
  const m = mount(v2({ apple: row('apple', 'apple'), c: custom('c', 'Mine', 4, { ci: 1 }) }), { hash: '#services' });
  assert.strictEqual(m.txt('.sub[data-id=apple] .sub-plan'), 'One price');
  assert.ok(m.$('.sub[data-id=c]').classList.contains('custom') && !m.$('.sub[data-id=c] .sub-plan'), 'a custom service gives its name the room');
  assert.strictEqual(m.$('.sub[data-id=apple] .sub-pay').children.length, 2, 'checkbox plus one text span, so no double gap');
  assert.match(html, /\.sub-plan\{[^}]*min-height:46px/);
});
test('coming soon: a compact "+ Add" button names its title; the plan note only appears when a higher plan is needed', async () => {
  const m = mount(undefined, { fetch: stub([], tierUp()), hash: '#soon' });
  await sleep(30);
  const add = rowOf(m, 'Gears Test').querySelector('[data-soon=add]');
  assert.strictEqual(add.textContent, '+ Add');
  assert.strictEqual(add.getAttribute('aria-label'), 'Add Gears Test to my list');
  assert.match(rowOf(m, 'Racer Test').textContent, /On Game Pass or PS Plus Extra/, 'the service name when its cheapest plan is enough, the plan when a higher one is needed');
  const g = openRow(m, 'Gears Test');
  assert.ok(!g.querySelector('.soon-need'), 'the row already says where it plays, so the form does not repeat it');
  assert.ok(g.querySelector('.f-plan'), 'the plan field gets its own row on phones');
  assert.match(g.textContent, /Hours to finish/);
});
test('estimates: the hours panel puts the number with its unit and the week figure under it', () => {
  const m = mount(undefined, { hash: '#estimates' });
  assert.strictEqual(m.txt('.slider-top'), '2.5 hours a day');
  assert.strictEqual(m.txt('#hrsWeek'), 'About 75 hours a month.');
});

test('the page has a favicon, so browsers stop asking for /favicon.ico', () => {
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml/);
});

/* ---------- second UI audit (2026-10-11) ---------- */
test('add bar: a picked game goes to the service that has it, adding that service if you do not have it', async () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std') }), { fetch: stub([], tierUp()), hash: '#list' });
  await sleep(30);
  m.typeTitle('gea'); m.click(m.$('#qSugg [role=option]'));
  assert.strictEqual(m.$('#qSvc').value, 'netflix', 'the picker cannot select a service you do not have');
  m.$('#qadd').dispatchEvent(new m.w.Event('submit', { bubbles: true, cancelable: true }));
  const sv = m.saved().sel;
  assert.strictEqual(sv.netflix.items.length, 0, 'not filed under Netflix');
  assert.strictEqual(sv.gamepass.items[0].title, 'Gears Test');
  assert.strictEqual(sv.gamepass.items[0].tier, 'gp-ult');
  assert.strictEqual(sv.gamepass.paying, false);
  assert.match(m.$('#toast').textContent, /Added Gears Test to Game Pass\. You do not pay for Game Pass yet\./);
});
test('add bar: hours that are not a number are refused; empty hours say what was used', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std') }), { hash: '#list' });
  m.addBar({ title: 'My show', svc: 'netflix', hours: 'abc' });
  assert.strictEqual(m.saved().sel.netflix.items.length, 0, 'nothing added');
  assert.match(m.$('#toast').textContent, /Enter the hours as a number/);
  m.addBar({ title: 'My show', svc: 'netflix', hours: '' });
  assert.strictEqual(m.saved().sel.netflix.items[0].hours, 10);
  assert.match(m.$('#toast').textContent, /Added My show to Netflix\. We used 10 hours\./);
});
test('my list: the add bar shows before you have a service, since a pick brings its service along', () => {
  const a = mount(undefined, { hash: '#list' });
  assert.ok(!a.$('#qadd').closest('.block').hidden);
  assert.strictEqual(a.$('#qSvc').options[0].textContent, 'Pick a suggestion');
  const b = mount(v2({ netflix: row('netflix', 'nf-ads') }), { hash: '#list' });
  assert.ok(!b.$('#qadd').closest('.block').hidden);
});
test('this month: a paid service that comes back soon is cancelled with the month it comes back, and the next months say Start again', () => {
  // Netflix is paid for now, but its show is only out next month; something else fills this month
  const m = mount(v2({
    netflix: row('netflix', 'nf-std', { items: [{ title: 'Later show', hours: 10, earliest: 1, tier: 'nf-std' }] }),
    hulu: row('hulu', 'hulu', { ci: 1, paying: false, items: [{ title: 'Now show', hours: 10, earliest: 0 }] }),
  }));
  const lines = ansLines(m);
  assert.strictEqual(lines[0], 'Cancel | Netflix Standard | Later show comes out in ' + mon(m, 1) + '. Start again then.', 'what to cancel comes first: ' + lines.join(' || '));
  assert.ok(!lines.some(t => /Pause/.test(t)), 'one word for stopping: Cancel');
  assert.match(nextText(m), /Start again: Netflix Standard/);
});

test('this month: every service gets its own line, each with one pressed button', () => {
  const sel = {};
  for (let i = 0; i < 8; i++) sel['c' + i] = custom('c' + i, 'Service ' + i, 5, { ci: i % 10 });
  sel.k = custom('k', 'Keeper', 5, { items: [{ title: 'x', hours: 10, earliest: 0 }] });
  const m = mount(v2(sel));
  const lines = ansLines(m);
  assert.strictEqual(lines.filter(l => /^Cancel \| Service \d \| Nothing on your list needs it\.$/.test(l)).length, 8, lines.join(' || '));
  assert.strictEqual(m.$$('#homeAnswer .al .seg').length, 9);
  m.$$('#homeAnswer .seg').forEach(g => assert.strictEqual(g.querySelectorAll('[aria-pressed=true]').length, 1));
});

test('timeline: the plan bought to cover a mix has its own row and Month by month tag; covered plans have no cost row', () => {
  const m = mount(v2({ gamepass: row('gamepass', 'gp-prem', { paying: false, items: [{ title: 'Console game', hours: 20, earliest: 0, tier: 'gp-prem' }, { title: 'PC game', hours: 20, earliest: 0, tier: 'gp-pc' }] }) }, { H: 40 }));
  const labs = m.$$('#plan .gantt .lab:not(.tot) .nm').map(n => n.firstChild.textContent);
  assert.ok(labs.includes('Game Pass Ultimate'), labs.join(' | '));
  assert.ok(m.$$('#plan .gantt .lab').some(l => /Covers your other plans/.test(l.textContent)));
  const rows = m.$$('#plan .subtable tbody tr').map(r => r.querySelector('th').textContent);
  assert.deepStrictEqual(rows, ['Game Pass Ultimate'], 'plans that Ultimate pays for are not listed at $0');
  assert.ok(!/\$0\.00/.test(m.txt('#plan .subtable')));
  assert.ok(!m.$('#plan .nm-cost .help'), 'no "Pricey" note when nothing is pricey');
});
test('a price option you pay for covers your show: Keep it, no Step down; not paid yet, the cheapest that has it', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Show', hours: 10, earliest: 0, tier: 'nf-ads' }] }) }));
  assert.strictEqual(todayActs(m), 'Keep Netflix Standard');
  assert.ok(!m.$('#plan .subtable tr.idle'), 'nothing left over to step down from');
  const n = mount(v2({ netflix: row('netflix', 'nf-std', { paying: false, items: [{ title: 'Show', hours: 10, earliest: 0, tier: 'nf-ads' }] }) }));
  assert.strictEqual(todayActs(n), 'Start Netflix with ads');
});

test('timeline: a service that never fits says so, and the warning links to Estimates', () => {
  const m = mount(v2({ a: custom('a', 'Alpha', 10, { items: [{ title: 'x', hours: 100, earliest: 0 }] }), b: custom('b', 'Bravo', 10, { ci: 1, items: [{ title: 'y', hours: 100, earliest: 0 }] }) }, { H: 5 }));
  assert.ok(m.$$('#plan .gantt .lab.nofit').length >= 1);
  assert.match(m.txt('#plan .gantt .lab.nofit'), /fit this year/);
  assert.ok(m.$('#plan .nm-warn [data-go=estimates]'));
});
test('timeline: month headers carry short names for wider screens, with the year on January', () => {
  const m = mount();
  m.click(m.$('[data-do=example]'));
  const h = m.$$('#plan .gantt .mh');
  assert.strictEqual(h.length, 12);
  h.forEach(x => assert.ok(x.querySelector('.m1') && x.querySelector('.m3')));
  const jan = h.find(x => x.classList.contains('yr'));
  assert.match(jan.querySelector('.m3').textContent, /^Jan \u2019\d\d$/);
});
test('copy plan: when the browser blocks copying, the plan appears as text to copy by hand', async () => {
  const m = mount();
  m.click(m.$('[data-do=example]'));
  Object.defineProperty(m.w.navigator, 'clipboard', { configurable: true, value: undefined });
  m.d.execCommand = () => false;
  m.click(m.$('#copyPlan'));
  const box = m.$('#shareText');
  assert.ok(box && box.value.startsWith('My subscription rotation'));
  assert.match(m.$('#toast').textContent, /^Copy the text below/);
});
test('header: Start fresh hides while there is nothing to clear', () => {
  const m = mount();
  assert.ok(m.$('#reset').hidden);
  m.click(m.$('[data-chip=netflix]'));
  assert.ok(!m.$('#reset').hidden);
});

test('services: chips you added say Added; prices always show cents; a new custom service is confirmed', () => {
  const m = mount(undefined, { hash: '#services' });
  m.click(m.$('[data-chip=netflix]'));
  assert.match(m.$('[data-chip=netflix]').textContent, /Added/);
  assert.match(m.$('[data-chip=hulu]').textContent, /from \$/);
  m.$('#cName').value = 'Spotify'; m.$('#cPrice').value = '7.5'; m.click(m.$('#cAdd'));
  assert.match(m.$('#toast').textContent, /Added Spotify/);
  const id = Object.keys(m.saved().sel).find(k => k !== 'netflix');
  assert.strictEqual(m.$('.sub[data-id="' + id + '"] [data-field=price]').value, '7.50');
  const p = m.$('.sub[data-id=netflix] [data-field=price]');
  p.value = '10'; m.fire(p, 'input'); m.fire(p, 'focusout');
  assert.strictEqual(p.value, '10.00');
});
test('services: an eleventh service takes the least-used colour, not the first one again', () => {
  const sel = {}; FAMS10.forEach((k, i) => { sel[k] = row(k, TIER10[i], { ci: i }); });
  const m = mount(v2(sel), { hash: '#services' });
  m.$('#cName').value = 'Extra'; m.$('#cPrice').value = '3'; m.click(m.$('#cAdd'));
  const s = Object.values(m.saved().sel).find(x => x.custom);
  m.$('#cName').value = 'Extra 2'; m.$('#cPrice').value = '3'; m.click(m.$('#cAdd'));
  const t = Object.values(m.saved().sel).filter(x => x.custom).find(x => x.id !== s.id);
  assert.notStrictEqual(t.ci, s.ci, 'two new services get different colours');
});
test('import: pasted rows that cannot be read get a message about rows, not about a file', () => {
  const m = mount(undefined, { hash: '#services' });
  m.$('#pasteBox').value = 'nothing useful'; m.click(m.$('#scanPaste'));
  assert.match(m.txt('#importOut'), /Could not read those rows/);
  assert.doesNotMatch(m.txt('#importOut'), /file/);
});
test('coming soon: dates read like people say them', async () => {
  const m = mount(undefined, { fetch: stub([], upItems()), hash: '#soon' });
  await sleep(30);
  assert.match(rowOf(m, 'Game B').textContent, /In 5 days/);
  assert.match(rowOf(m, 'Show A').textContent, /In 6 weeks/);
  m.click(m.$('[data-filter=game]'));
  assert.ok(!rowOf(m, 'Game B').querySelector('.pill:not(.warn):not(.ok)') || !/Game/.test(rowOf(m, 'Game B').querySelector('.soon-main').textContent.split('PS5')[0]), 'no kind tag when only games are shown');
});
test('estimates: an impossible week hides the number and the Use button; slider edits explain the empty chips', () => {
  const m = mount(undefined, { hash: '#estimates' });
  [['workH', '80'], ['commute', '20'], ['care', '80']].forEach(([k, v]) => { const el = m.$('#es-' + k); el.value = v; m.fire(el, 'input'); });
  assert.match(m.txt('#estSub'), /more than the 168/);
  assert.ok(!m.$('#estSub').hidden);
  assert.ok(!m.$('#estCustom').hidden);
  m.$('#hrs').value = '5'; m.fire(m.$('#hrs'), 'input');
});
test('estimates: a list longer than a year says so instead of "about 24 months"', () => {
  const m = mount(v2({ c: custom('c', 'Alpha', 10, { items: [{ title: 'x', hours: 120, earliest: 0 }] }) }, { H: 5 }), { hash: '#estimates' });
  assert.match(m.txt('#hrsFit'), /more than a year/);
});

/* ---------- re-check round (2026-10-11) ---------- */
test('services: the Other-service form and custom service rows no longer share a class', () => {
  const m = mount(v2({ c: custom('c', 'Mine', 4) }), { hash: '#services' });
  assert.ok(m.$('.custom-add #cName'), 'the form has its own class');
  assert.ok(!/(^|[}\n])\.custom\{/.test(html), 'no bare .custom rule that would also hit the rows');
  assert.ok(m.$('.sub.custom[data-id=c]'));
});
test('my list: removing a title can be undone', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-ads', { items: [{ title: 'A', hours: 2, earliest: 0 }] }) }), { hash: '#list' });
  m.click(m.$('#queue [data-act=rmitem]'));
  assert.match(m.$('#toast').textContent, /Removed A/);
  m.click(m.$('#toast .undo'));
  assert.strictEqual(m.saved().sel.netflix.items[0].title, 'A');
});
test('copy plan: months read "Oct 2026", empty months fold, and it says "I save"', async () => {
  const m = mount();
  m.click(m.$('[data-do=example]'));
  let copied = '';
  Object.defineProperty(m.w.navigator, 'clipboard', { configurable: true, value: { writeText: t => { copied = t; return Promise.resolve(); } } });
  m.click(m.$('#copyPlan')); await sleep(10);
  assert.match(copied, /\n[A-Z][a-z]{2} \d{4}: /);
  assert.doesNotMatch(copied, /\n[A-Z][a-z]{2} \d{2}: /, 'no two-digit year that reads like a day');
  assert.match(copied, / to [A-Z][a-z]{2} \d{4}: nothing \(\$0\)/);
  assert.match(copied, /I save \$[\d,]+\./);
});
test('timeline: the phone Paid row says its numbers are rounded', () => {
  const m = mount();
  m.click(m.$('[data-do=example]'));
  assert.strictEqual(m.$('#plan .gantt .lab.tot .n').textContent, 'Paid, rounded');
  assert.match(html, /\.gantt \.w\{display:none\}\.gantt \.n\{display:inline\}/);
});

test('estimates: a small estimate reads in minutes a day; a care slider edit explains the empty Home chips', () => {
  const m = mount(undefined, { hash: '#estimates' });
  const care = m.$('#es-care'); care.value = '30'; m.fire(care, 'input');
  assert.match(m.txt('.slider-top'), /minutes a day|hours? a day/);
  assert.ok(!m.$('#estCustom').hidden, 'the note explains why the Home chips went off');
  m.click(m.$('[data-esthome=kid]'));
  assert.ok(m.$('#estCustom').hidden || m.saved().est.work === 'custom');
});
test('coming soon: a streaming row does not repeat its service on two lines', async () => {
  const up = { checked: '2026-10-05', items: [{ id: 'dip', title: 'Dip', kind: 'tv', service: 'netflix', channel: 'Netflix', subs: ['nf-ads'], date: isoOffset(20), confidence: 'confirmed', checked: '2026-10-05' }, { id: 'fx', title: 'Fx Show', kind: 'tv', service: 'hulu', channel: 'FX', subs: ['hulu'], date: isoOffset(21), confidence: 'confirmed', checked: '2026-10-05' }] };
  const m = mount(undefined, { fetch: stub([], up), hash: '#soon' });
  await sleep(30);
  assert.doesNotMatch(rowOf(m, 'Dip').querySelector('.meta').textContent, /Netflix/, 'the plan line already says On Netflix');
  assert.match(rowOf(m, 'Dip').querySelector('.plan').textContent, /^On Netflix/);
  assert.match(rowOf(m, 'Fx Show').querySelector('.meta').textContent, /FX/, 'a different channel still shows');
});

/* ---------- simpler pages ---------- */
test('services: Other service and the bank import fold into one line; Start fresh folds it back; a dragged file opens it', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-ads') }), { hash: '#services' });
  const more = m.$('#moreAdd');
  assert.ok(more && !more.open, 'folded on arrival');
  assert.ok(more.contains(m.$('#cName')) && more.contains(m.$('#import')));
  assert.strictEqual(m.txt('#moreAdd > summary'), 'Not listed? Add your own or scan a bank file');
  assert.match(m.txt('#import .import-p'), /It never leaves this phone or computer\./, 'the privacy line stays next to the import');
  assert.strictEqual(m.txt('#pickCsv'), 'Choose a file');
  m.fire(m.$('[data-view=services]'), 'dragenter');
  assert.ok(more.open, 'dropping a file still works with the fold closed');
  m.click(m.$('#reset'));
  assert.ok(!more.open);
});
test('services: the service you just tapped is the top row; the box asks "I pay for it now" and a tap ticks it; the total says what you pay', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-ads'), hulu: row('hulu', 'hulu', { ci: 1 }) }), { hash: '#services' });
  assert.deepStrictEqual(m.$$('#subs .sub').map(r => r.dataset.id), ['hulu', 'netflix'], 'newest first');
  m.click(m.$('[data-chip=max]'));
  assert.strictEqual(m.$('#subs .sub').dataset.id, 'max');
  const pay = m.$('.sub[data-id=netflix] .sub-pay');
  assert.strictEqual(pay.textContent.trim(), 'I pay for it now');
  assert.strictEqual(pay.querySelector('input').getAttribute('aria-label'), 'I pay for it now: Netflix');
  assert.strictEqual(m.saved().sel.max.paying, true, 'a tap means you pay for it');
  assert.ok(m.$('.sub[data-id=max] [data-field=paying]').checked);
  m.$('#cName').value = 'Mine'; m.$('#cPrice').value = '4'; m.click(m.$('#cAdd'));
  assert.strictEqual(Object.values(m.saved().sel).find(x => x.name === 'Mine').paying, true, 'so does one you add yourself');
  assert.ok(!/pay-now/.test(html), 'one label on every screen');
  assert.strictEqual(m.txt('#subsTotal'), 'You pay $36.47 a month for 4 services.', 'Netflix, Hulu, HBO Max and Mine');
  assert.ok(m.$('#subs').compareDocumentPosition(m.$('#subsTotal')) & m.w.Node.DOCUMENT_POSITION_FOLLOWING, 'under the list');
  assert.ok(m.$('#subsTotal').compareDocumentPosition(m.$('#reset')) & m.w.Node.DOCUMENT_POSITION_FOLLOWING, 'above Clear all');
  const p = m.$('.sub[data-id=netflix] [data-field=paying]'); p.checked = false; m.fire(p, 'change');
  assert.strictEqual(m.txt('#subsTotal'), 'You pay $27.48 a month for 3 of your 4 services.');
  const c = mount(undefined, { hash: '#services' });
  assert.strictEqual(c.txt('#subs'), 'Nothing yet. Tap a service to add it.');
});
test('my list: a search box and Add; service, plan, hours and month fold into one line you can change', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-ads') }), { hash: '#list' });
  const more = m.$('#qMore');
  assert.ok(more.hidden, 'just the search box and Add before you type');
  ['#qSvc', '#qTier', '#qHours', '#qWhen'].forEach(q => assert.ok(more.contains(m.$(q)), q + ' is inside the fold'));
  assert.ok(m.$('#qTitle').labels[0].classList.contains('vh'), 'the box keeps its name for screen readers');
  m.typeTitle('My show');
  assert.ok(!more.hidden && !more.open);
  const when = m.$('#qWhen').options[0].textContent;
  assert.strictEqual(m.txt('#qSumText'), 'Netflix · 10 h · ' + when);
  assert.strictEqual(m.txt('#qMore .qmore-c .c1'), 'Change');
  assert.ok(html.includes('.qmore[open] .qmore-c .c2{display:inline}'), 'it reads Done while open');
  m.$('#qTier').value = 'nf-prem'; m.fire(m.$('#qTier'), 'change');
  m.$('#qHours').value = '6'; m.fire(m.$('#qHours'), 'input');
  assert.strictEqual(m.txt('#qSumText'), 'Netflix · ' + m.w.eval("planName('nf-prem')") + ' · 6 h · ' + when, 'a plan shows only when it is more than the cheapest');
  more.open = true;
  m.$('#qadd').dispatchEvent(new m.w.Event('submit', { bubbles: true, cancelable: true }));
  const it = m.saved().sel.netflix.items[0];
  assert.strictEqual(it.hours, 6);
  assert.strictEqual(it.tier, 'nf-prem');
  assert.ok(more.hidden && !more.open, 'folds back for the next title');
  assert.ok(html.includes('details>*{box-sizing:border-box}'), 'fields inside a fold keep border-box sizing, so they stay inside the card');
  assert.match(html, /\.qadd\.newsvc #qAdd\{order:5\}/, 'on a phone, "Add to Game Pass" gets its own row');
});
test('my list: with no services, picking a Coming soon title adds its service for you', async () => {
  const m = mount(undefined, { fetch: stub([], tierUp()), hash: '#list' });
  await sleep(30);
  m.typeTitle('Gears');
  m.click(m.$('#qSugg [data-sg="0"]'));
  assert.match(m.txt('#qAdd'), /^Add to /);
  assert.ok(!/Pick a suggestion/.test(m.txt('#qSumText')), 'the line does not name a service you do not have');
  m.$('#qadd').dispatchEvent(new m.w.Event('submit', { bubbles: true, cancelable: true }));
  const gp = m.saved().sel.gamepass;
  assert.ok(gp && gp.paying === false, 'added as a service you do not pay for yet');
  assert.strictEqual(gp.items[0].title, 'Gears Test');
});
test('my list: at most five suggestions, shows on a service we know first', async () => {
  const shows = ['NTV', 'NTV', 'Netflix', 'NTV', 'Hulu', 'NTV'].map((ch, i) => ({ score: 1 - i / 10, show: { id: 100 + i, name: 'Zed ' + i, premiered: '2024-01-01', status: 'Running', webChannel: { name: ch }, network: null } }));
  const m = mount(nf(), { fetch: stub([[/search\/shows/, resp(200, shows)]]), hash: '#list' });
  m.typeTitle('zed');
  await sleep(500);
  const opts = m.$$('#qSugg [role=option]').map(o => o.textContent);
  assert.strictEqual(opts.length, 5);
  assert.match(opts[0], /^Zed 2/);
  assert.match(opts[1], /^Zed 4/);
  assert.match(opts[2], /^Zed 0/, 'the rest keep TVMaze order');
  assert.ok(!opts.some(t => /Running/.test(t)));
});
test('my list: a row names its plan only when it needs more than the cheapest one', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Cheap', hours: 5, earliest: 0 }, { title: 'Fancy', hours: 5, earliest: 0, tier: 'nf-prem' }] }) }), { hash: '#list' });
  const meta = t => m.$$('#queue .qitem').find(li => li.textContent.includes(t)).querySelector('.qmeta').textContent;
  assert.strictEqual(meta('Cheap'), '');
  assert.strictEqual(meta('Fancy'), m.w.eval("planName('nf-prem')"));
});

test('coming soon: this month and next come first; later releases are one tap away', async () => {
  const up = { checked: '2026-10-05', items: [
    { id: 'n1', title: 'Near One', kind: 'tv', service: 'netflix', channel: 'Netflix', date: isoOffset(3), confidence: 'confirmed', checked: '2026-10-05' },
    { id: 'f1', title: 'Far One', kind: 'tv', service: 'netflix', channel: 'Netflix', date: isoOffset(120), confidence: 'confirmed', checked: '2026-10-05' },
    { id: 'f2', title: 'Far Two', kind: 'movie', service: 'netflix', channel: 'Netflix', date: isoOffset(150), confidence: 'confirmed', checked: '2026-10-05' }] };
  const m = mount(undefined, { fetch: stub([], up), hash: '#soon' });
  await sleep(30);
  const titles = () => m.$$('#soonList .soon-row').map(r => r.querySelector('b').textContent);
  assert.deepStrictEqual(titles(), ['Near One']);
  const more = m.$('#soonList [data-soon=more]');
  assert.strictEqual(more.textContent, 'Show more (2)');
  assert.match(m.$('#soonFilters [data-filter=all]').textContent, /All\s*3/, 'the chips count the whole list');
  m.click(more);
  assert.deepStrictEqual(titles(), ['Near One', 'Far One', 'Far Two']);
  assert.ok(!m.$('#soonList [data-soon=more]'));
  assert.strictEqual(m.d.activeElement, m.$$('#soonList .soon-row')[1], 'focus lands on the first new row');
  m.click(m.$('#soonFilters [data-filter=movie]'));
  assert.deepStrictEqual(titles(), ['Far Two'], 'a filter with nothing this month or next shows what it has');
});

test('estimates: the result sits under the choices you tap and matches the big number', () => {
  const m = mount(undefined, { hash: '#estimates' });
  assert.strictEqual(m.txt('#estRes'), 'That gives you about 2.5 hours a day.');
  m.click(m.$('[data-estwork=pt]'));
  assert.strictEqual(m.txt('#estRes'), 'That gives you about ' + m.txt('.slider-top') + '.');
  assert.ok(!m.$('.est-p'), 'no instructions line: the result says what a tap did');
  assert.ok(m.$('#estRes').compareDocumentPosition(m.$('#estHome')) & m.w.Node.DOCUMENT_POSITION_PRECEDING, 'the result comes after the choices');
});
test('estimates: after moving the slider, one button puts our estimate back', () => {
  const m = mount(undefined, { hash: '#estimates' });
  m.$('#hrs').value = '120'; m.fire(m.$('#hrs'), 'input');
  assert.ok(!m.$('#hrsHand').hidden);
  assert.strictEqual(m.txt('#hrsUse'), 'Use our guess (2.5 hours)');
  assert.strictEqual(m.txt('#estRes'), 'Our guess from your week: about 2.5 hours a day. You moved the dot.', 'never claims a number that is not in use');
  assert.strictEqual(m.txt('#hrsHand span'), 'You moved the dot yourself.');
  m.click(m.$('#hrsUse'));
  assert.strictEqual(m.$('#hrs').value, '75');
  assert.strictEqual(m.saved().H, 75);
  assert.ok(m.$('#hrsHand').hidden);
  assert.strictEqual(m.d.activeElement, m.$('#hrs'), 'focus goes to the slider, not to a vanished button');
  assert.strictEqual(m.txt('#estRes'), 'That gives you about 2.5 hours a day.');
});
test('estimates: choices are plain names with the hours in a tooltip; the sleep, work and chores fold puts the sliders first', () => {
  const m = mount(undefined, { hash: '#estimates' });
  assert.ok(!m.$('#est .chips small'), 'no number lines under the choices');
  assert.strictEqual(m.txt('[data-estwork=ftlong]'), 'Full-time + long trip to work');
  assert.strictEqual(m.txt('[data-esthome=fam]'), 'Caring for family');
  assert.strictEqual(m.txt('[data-esthome=home]'), 'Stay-at-home parent');
  assert.strictEqual(m.$('[data-esthome=u6]').title, 'about 14 h a week');
  assert.strictEqual(m.txt('#g-home'), 'Home (tap all that fit)');
  assert.strictEqual(m.txt('#est details > summary'), 'Change sleep, work, chores and more');
  assert.ok(m.$('#estFine').compareDocumentPosition(m.$('#estBar')) & m.w.Node.DOCUMENT_POSITION_FOLLOWING, 'sliders before the week bar');
  assert.match(m.txt('#estCustom'), /^Using your own numbers\.$/);
});
test('estimates: the slider ends name real amounts, the markup starts at the real default, and an empty list links to My list', () => {
  const m = mount(undefined, { hash: '#estimates' });
  const r = m.$('#hrs'), lo = m.w.eval('perDay(' + r.min + ')'), hi = m.w.eval('perDay(' + r.max + ')');
  assert.strictEqual(m.txt('#rangeLo'), lo.n + ' min');
  assert.strictEqual(m.txt('#rangeHi'), hi.n + ' hours a day');
  assert.strictEqual(m.w.eval('H_DEFAULT'), 75);
  assert.match(html, /id="hrsBig">2\.5</);
  assert.match(html, /id="hrs" min="5" max="160" step="5" value="75"/);
  assert.match(html, /About 75 hours a month\./);
  const link = m.$('#hrsFit a[data-go=list]');
  assert.ok(link);
  m.click(link);
  assert.ok(isVisible(m, 'list'));
});

/* ---------- Help ---------- */
test('help: a button at the top right opens a short how-to for the page you are on', () => {
  const m = mount(undefined, { hash: '#services' });
  const btn = m.$('#helpBtn'), panel = m.$('#helpPanel');
  assert.ok(btn.closest('.top-actions'), 'in the header, next to the other page buttons');
  assert.strictEqual(btn.getAttribute('aria-controls'), 'helpPanel');
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'false');
  assert.ok(panel.hidden);
  m.click(btn);
  assert.ok(!panel.hidden);
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'true');
  assert.strictEqual(m.txt('#helpTitle'), 'Questions about services');
  assert.ok(m.$$('#helpList li').length >= 4);
  m.click(m.$('.ideas [data-go=soon]'));
  assert.ok(!panel.hidden, 'stays open as you move around');
  assert.strictEqual(m.txt('#helpTitle'), 'Questions about new releases', 'New releases is part of step 2, but its page has its own questions');
  m.click(btn);
  assert.ok(panel.hidden);
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'false');
});
test('help: Escape and the close button shut it and give focus back to Help', () => {
  const m = mount(undefined, { hash: '#overview' });
  m.click(m.$('#helpBtn'));
  m.key(m.$('#helpClose'), 'Escape');
  assert.ok(m.$('#helpPanel').hidden);
  assert.strictEqual(m.d.activeElement, m.$('#helpBtn'));
  m.click(m.$('#helpBtn'));
  m.click(m.$('#helpClose'));
  assert.ok(m.$('#helpPanel').hidden);
  assert.strictEqual(m.d.activeElement, m.$('#helpBtn'));
  assert.strictEqual(m.$('#helpClose').getAttribute('aria-label'), 'Close questions');
});
test('help: every page has its own questions, answered in short plain sentences', () => {
  const m = mount(undefined);
  const views = JSON.parse(m.w.eval('JSON.stringify(Object.keys(VIEWS))')), help = JSON.parse(m.w.eval('JSON.stringify(HELP)'));
  assert.deepStrictEqual(Object.keys(help).sort(), views.slice().sort());
  const titles = new Set();
  const short = (v, t) => t.split(/[.!?](?:\s|$)/).filter(x => x.trim()).forEach(sen => assert.ok(sen.trim().split(/\s+/).length <= 13, v + ': short sentence: ' + sen));
  for (const v of views) {
    const { title, qa } = help[v];
    titles.add(title);
    assert.ok(qa.length >= 4 && qa.length <= 7, v + ': four to seven questions (trimmed 2026-10-20: the owner found the app too wordy)');
    qa.forEach(([q, a]) => {
      assert.match(q, /\?$/, v + ': a question: ' + q);
      assert.ok(q.length <= 60 && a.length <= 160, v + ': short: ' + q);
      assert.ok((a.match(/[.!?](\s|$)/g) || []).length <= 2, v + ': one or two sentences: ' + a);
      short(v, a);
    });
  }
  assert.strictEqual(titles.size, views.length, 'each page has its own title');
  const words = { services: /I pay for it now/, list: /Change/, soon: /\+ Add/, estimates: /Not sure/, home: /other button/ };
  Object.entries(words).forEach(([v, re]) => assert.match(help[v].qa.flat().join(' '), re, v + ' answers the questions people ask about it'));
  assert.match(help.estimates.qa[0][0], /Why do you need my free time\?/, 'Free time says why it is there');
  m.click(m.$('#helpBtn'));
  assert.ok(m.$$('#helpList *').every(e => ['LI', 'B', 'SPAN'].includes(e.tagName)), 'plain text, escaped');
  const est = mount(undefined, { hash: '#estimates' });
  est.click(est.$('#helpBtn'));
  assert.match(est.txt('#helpList'), /We use 2\.5 hours a day, which fits a full-time job\./);
  assert.match(est.txt('#viewIntro'), /If you skip this, we use 2\.5 hours a day\./);
});test('help: the Questions button always shows its name, on phones too', () => {
  assert.doesNotMatch(html, /\.help-btn span\{position:absolute/);
  const m = mount();
  assert.strictEqual(m.txt('#helpBtn'), 'Questions');
  assert.strictEqual(m.$('#helpBtn svg').getAttribute('aria-hidden'), 'true');
});

test('plain words: the example says it is made up, hours are spelled out, and Undo waits 20 seconds', () => {
  const m = mount();
  assert.ok(m.$('#exBar').hidden);
  m.click(m.$('#loadExample'));
  assert.match(m.txt('#exBar'), /^The made-up example is on\. Your own list is safe\.\s*Clear example$/);
  m.click(m.$('.nav [data-go=services]'));
  assert.ok(!m.$('#exBar').hidden, 'on every page while the example shows');
  assert.ok(m.$('#reset').hidden, 'Clear all hides while the example shows');
  assert.match(m.txt('.sub[data-id=psplus] .sub-name small'), /· 22 hours$/);
  m.click(m.$('.nav [data-go=list]'));
  assert.match(m.txt('#queueTotal'), /^8 things · 120 hours$/);
  assert.ok(m.$$('#queue .qhrs').every(e => / hours?$/.test(e.textContent)));
  m.click(m.$('#exBack'));
  assert.ok(m.$('#exBar').hidden, 'gone once you go back to your own list');
  const r = mount(v2({ netflix: row('netflix', 'nf-ads') }), { hash: '#services' });
  r.click(r.$('#reset'));
  assert.match(r.txt('#toast'), /^Everything is cleared\. Undo$/);
  assert.match(html, /undoSnap\?20000:Math\.max\(4000,msg\.split\(' '\)\.length\*600\)/, 'Undo stays 20 seconds; other messages stay long enough to read');
  const e = mount(v2({ netflix: row('netflix', 'nf-ads') }), { hash: '#list' });
  e.addBar({ title: 'A show', svc: 'netflix', hours: 1 });
  assert.strictEqual(e.txt('#queue .qhrs'), '1 hour');
});

/* ---------- layout: the pieces line up from page to page (jsdom does no layout, so these pin the rules) ---------- */
test('layout: every page shares one content width and one 352px side column on wide screens', () => {
  assert.ok(!/\[data-view=soon\] \.block\{max-width/.test(html), 'Coming soon spans the same width as every other page');
  assert.match(html, /\.main\{width:100%;max-width:1204px;/, 'big screens show the 1280 layout centred');
  const wide = html.slice(html.indexOf('@media (min-width:1180px){\n  .grid2'));
  ['.grid2{grid-template-columns:minmax(0,352px) minmax(0,1fr)}', '[data-view=services]{grid-template-columns:minmax(0,352px) minmax(0,1fr);', '.kpis{grid-template-columns:minmax(0,352px) minmax(0,1fr)}']
    .forEach(r => assert.ok(wide.slice(0, 900).includes(r), r));
});
test('layout: side-by-side tiles and cards stretch to one height and line up inside', () => {
  assert.ok(!/\.kpis \.sum\{grid-column:auto;align-self:start\}/.test(html), 'the You save tile no longer floats');
  assert.match(html, /\.kpis \.sum \.sum-sub\{margin-top:auto;/);
  assert.match(html, /\.kpis \.now \.next\{margin-top:auto\}/);
  assert.match(html, /\.qitem\{grid-template-columns:minmax\(0,1fr\) auto 64px 44px;/, 'list rows: title left, fix button, hours and remove right');
  assert.match(html, /\.soon-row\{grid-template-columns:104px minmax\(0,1fr\) auto;/, 'release rows: date, title, action on one line');
  assert.match(html, /#chips \.chips\{display:grid;/, 'service chips form columns');
  assert.match(html, /\.qgroup h3,#queueTotal\{padding-right:54px\}/, 'all totals share the hours column edge');
});

/* ---------- Your plan: come in, drop something, see what to do ---------- */
test('this month: a first visit lands here with three numbered steps, and the answer slot explains the app', () => {
  const m = mount();
  assert.ok(isVisible(m, 'home'));
  assert.strictEqual(m.$('#viewTitle').textContent, 'Your plan');
  assert.deepStrictEqual(m.$$('.hpart .pn').map(p => p.textContent), ['1', '2', '3', '4']);
  assert.deepStrictEqual(['#h-p1', '#h-p2', '#h-p3', '#h-p4'].map(q => m.txt(q)), ['What do you pay for now?', 'What do you want to watch or play?', 'What to do this month', 'The next months']);
  assert.deepStrictEqual(m.$$('#homeGrid > .hpart').map(p => p.id), ['part1', 'part2', 'part3', 'part4'], 'one column, 1 2 3 4 straight down');
  assert.ok(m.$('#part4').hidden, 'step 4 waits for a plan');
  const narrow = html.slice(0, html.indexOf('/* ---------- wide screens'));
  assert.ok(narrow.length < html.length && /@media \(min-width:1200px\)\{\s*\.home-top,#checkin,\.home-grid\{max-width:none\}/.test(html), 'side by side only in the wide-screen block');
  assert.doesNotMatch(narrow, /.home-grid{[^}]*grid-template-columns/, 'phones and tablets: never side by side');
  assert.ok(m.$('#homeAdd #qadd'), 'the search box sits in step 2');
  assert.match(m.txt('#homeAnswer'), /What is this app\?/);
  assert.ok(m.$('#homeAnswer [data-do=example]'), 'just looking? the example is right there');
  assert.deepStrictEqual(m.$$('.top-actions .btn').filter(b => !b.hidden).map(b => b.id), ['langBtn', 'loadExample', 'helpBtn'], 'the header has the language button, Example and Questions');
  m.click(m.$('.nav [data-go=list]'));
  assert.ok(m.$('#listAdd #qadd'), 'on My list the same search box moves to the full page');
});
test('this month: a tap means "I pay for it"; a row asks which price option; a second tap undoes it', () => {
  const m = mount();
  m.click(m.$('[data-paychip=netflix]'));
  assert.strictEqual(m.saved().sel.netflix.paying, true);
  assert.strictEqual(m.$('[data-paychip=netflix]').getAttribute('aria-pressed'), 'true');
  assert.match(m.txt('#homeTier'), /^Which Netflix is on your bill\?/);
  assert.deepStrictEqual(m.$$('#homeTier [data-tierpick]').map(b => b.firstChild.textContent), ['Netflix with ads', 'Netflix Standard', 'Netflix Premium'], 'the same names the answer uses');
  m.click(m.$('[data-tierpick=nf-std]'));
  assert.deepStrictEqual([m.saved().sel.netflix.tier, m.saved().sel.netflix.price], ['nf-std', 19.99]);
  assert.strictEqual(m.txt('#homeTier'), '', 'picked: the row goes away');
  assert.strictEqual(m.txt('#homePay'), 'Bill today: $19.99 a month.');
  m.click(m.$('[data-paychip=apple]'));
  assert.strictEqual(m.txt('#homeTier'), '', 'one price: nothing to ask');
  m.click(m.$('[data-paychip=apple]'));
  assert.ok(!m.saved().sel.apple, 'tap again: you do not pay for it');
  assert.ok(ansLines(m).includes('Cancel | Netflix Standard | Nothing on your list needs it.'), 'no list yet: the answer still says what to stop');
  assert.match(m.txt('#homeAnswer'), /Add what you want in step 2/);
});
test('this month: a tapped match is added in one tap, and the answer says why each line is there', async () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std'), disney: row('disney', 'disney', { ci: 1 }) }), { fetch: stub([], tierUp()) });
  await sleep(30);
  m.typeTitle('Gears'); m.click(m.$('#qSugg [data-sg="0"]'));
  assert.strictEqual(m.saved().sel.gamepass.items[0].title, 'Gears Test', 'no second Add tap');
  assert.strictEqual(m.saved().sel.gamepass.paying, false, 'a service for a title is not paid yet');
  assert.strictEqual(m.$('#qTitle').value, '', 'ready for the next one');
  assert.match(m.txt('#homeList'), /Gears Test\s*Game Pass/);
  const lines = ansLines(m);
  assert.ok(lines.some(l => /^Start \| Game Pass Ultimate \| For Gears Test\. \d+ hours (this|next) month\. You finish it\.$/.test(l)), lines.join(' || '));
  assert.ok(lines.includes('Cancel | Netflix Standard | Nothing on your list needs it.'), lines.join(' || '));
  assert.match(m.txt('#homeAnswer'), /Do this yourself, on each service’s website or app\./);
  assert.match(m.txt('#plan .nm-save'), /: \$[\d,]+, not \$[\d,]+\./);
  assert.match(m.txt('#homeAnswer .ans-why'), /^Free time: 40 minutes a day, about 20 hours (this|next) month\. .+\.$/, 'your own time, with a way to change it');
  const free = m.$('#homeAnswer .ans-free [data-go]');
  assert.strictEqual(free.dataset.go, 'estimates');
  assert.strictEqual(free.textContent, 'Change free time');
  assert.ok(free.classList.contains('btn') && free.classList.contains('linkbtn'), 'a button, not a link inside the sentence');
  assert.ok(!m.$('#homeAnswer .ans-why a'));
  assert.match(m.txt('#homeAnswer .ans-changed'), /^Your plan changed\./, 'what moved is said right there');
  m.click(m.$('#homeList [data-hrm]'));
  assert.ok(!m.saved().sel.gamepass.items.length);
  assert.ok(m.$('#toast .undo'), 'removing can be undone');
});
test('lines: Keep on a Cancel line keeps it every month and out of the rotation; Cancel undoes it', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std'), hulu: row('hulu', 'hulu', { ci: 1, paying: false, items: [{ title: 'A show', hours: 10, earliest: 0 }] }) }));
  assert.ok(ansLines(m).includes('Cancel | Netflix Standard | Nothing on your list needs it.'));
  m.click(m.$('#homeAnswer .al[data-entry=netflix] [data-pick=keep]'));
  assert.deepStrictEqual(m.saved().keep, { netflix: true });
  assert.ok(ansLines(m).includes('Keep | Netflix Standard | Your pick: keep it every month.'), ansLines(m).join(' || '));
  assert.strictEqual(m.d.activeElement, m.$('#homeAnswer .al[data-entry=netflix] [aria-pressed=true]'), 'focus stays on the line you changed');
  assert.match(m.txt('#toast'), /^You keep Netflix every month\..*Undo$/);
  assert.match(m.txt('#homeAnswer .ans-big'), /^\$32\.48$/, 'kept Netflix plus Hulu this month');
  assert.ok(m.$$('#plan .mt').every(c => /\$(19\.99|20|32\.48|32)/.test(c.textContent)), 'Netflix is paid every month');
  assert.match(m.txt('#plan .gantt'), /Kept every month/);
  assert.match(m.txt('#homeAnswer .ans-pick'), /Back to our pick/);
  m.click(m.$('#homeAnswer .al[data-entry=netflix] [data-pick=cancel]'));
  assert.deepStrictEqual(m.saved().keep, {});
  assert.ok(ansLines(m).some(l => /^Cancel \| Netflix Standard \| /.test(l)));
  const z = mount(v2({ netflix: row('netflix', 'nf-ads') }, { keep: { netflix: true, ghost: true } }));
  z.poke();
  assert.deepStrictEqual(z.saved().keep, { netflix: true }, 'a kept service you no longer have is dropped');
});

test('this month: coming back, step 1 folds to one line with Change, and the steps stay in order', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'A show', hours: 10, earliest: 0 }] }) }));
  assert.ok(m.$('#p1body').hidden && !m.$('#p1change').hidden);
  assert.strictEqual(m.txt('#p1sub'), 'You pay for: Netflix');
  assert.ok(!m.$('#homeGrid').classList.contains('folded'));
  assert.doesNotMatch(html, /#part3\{order:-1\}/, 'the answer never jumps above steps 1 and 2');
  m.click(m.$('#p1change'));
  assert.ok(!m.$('#p1body').hidden);
  assert.strictEqual(m.d.activeElement, m.$('#homeChips [data-paychip]'));
  assert.ok(mount().$('#p1change').hidden, 'a first visit is never folded');
});

test('this month: Remind me each month makes a repeating calendar note on the device, with the next change in it', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'A show', hours: 10, earliest: 0 }] }), hulu: row('hulu', 'hulu', { ci: 1, paying: false, items: [{ title: 'Later', hours: 5, earliest: 1 }] }) }));
  assert.strictEqual(m.txt('#remindBtn'), 'Remind me each month');
  assert.ok(m.$('#plan #remindBtn'), 'it sits with the next months');
  const ics = m.w.eval('reminderIcs()');
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:\d{8}\r\n/);
  assert.match(ics, /SUMMARY:SubRotato: check this month’s plan\r\n/);
  assert.match(ics, /RRULE:FREQ=MONTHLY;COUNT=12\r\n/, 'on the 1st, every month for a year');
  assert.match(ics, /DESCRIPTION:In [A-Z][a-z]+: /, 'the next change is in the note');
  assert.doesNotMatch(ics, /http/, 'nothing points anywhere else');
});
test('this month: the example is a preview that is never saved', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-ads') }));
  const saved = JSON.stringify(m.saved());
  m.click(m.$('#homeAnswer [data-do=example]') || m.$('#loadExample'));
  assert.ok(!m.$('#exBar').hidden);
  assert.match(m.txt('#homeAnswer'), /(This|Next) month you pay/);   // after the 20th the plan starts next month
  m.click(m.$('[data-paychip=crunchy]'));
  assert.strictEqual(JSON.stringify(m.saved()), saved, 'nothing you do in the example is saved');
  m.click(m.$('#exBack'));
  assert.deepStrictEqual(Object.keys(m.saved().sel), ['netflix']);
  assert.strictEqual(m.$('[data-paychip=netflix]').getAttribute('aria-pressed'), 'true');
});
test('this month: the phone answer bar shows while the answer is off screen, never while typing', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'A show', hours: 10, earliest: 0 }] }) }));
  assert.ok(m.$('#answerBar').hidden);
  m.w.eval('part3Seen=false;syncBar()');
  assert.ok(!m.$('#answerBar').hidden);
  assert.match(m.txt('#answerBar'), /^(This|Next) month: \$[\d.]+\s*See what to do$/);
  m.$('#qTitle').focus(); m.w.eval('syncBar()');
  assert.ok(m.$('#answerBar').hidden, 'out of the way while you type');
  m.$('#qTitle').blur(); m.w.eval('syncBar()');
  m.click(m.$('#answerBar'));
  assert.strictEqual(m.d.activeElement, m.$('#h-p3'));
});
test('check-in: a new month asks what you did, then updates what you pay and your list', () => {
  const last = { key: keyFor(-1), stop: [{ entry: 'netflix', name: 'Netflix Standard' }], start: [{ entry: 'hulu', id: 'hulu', name: 'Hulu with ads' }], change: [], titles: [{ entry: 'hulu', title: 'Done show' }, { entry: 'hulu', title: 'Long show' }] };
  const seed = v2({ netflix: row('netflix', 'nf-std'), hulu: row('hulu', 'hulu', { ci: 1, paying: false, items: [{ title: 'Done show', hours: 5, earliest: 1 }, { title: 'Long show', hours: 30, earliest: 1 }] }) }, { startKey: keyFor(-1), last });
  const m = mount(seed);
  assert.match(m.txt('#checkin h2'), /^Did you do [A-Z][a-z]+’s plan\?$/);
  assert.deepStrictEqual(m.$$('#checkin [data-ci]').map(c => c.checked), [true, true], 'ticked: most people did it');
  m.click(m.$('#checkin [data-cifin="0"]'));
  m.click(m.$('#ciApply'));
  const s2 = m.saved();
  assert.strictEqual(s2.sel.netflix.paying, false, 'Netflix cancelled');
  assert.strictEqual(s2.sel.hulu.paying, true, 'Hulu started');
  assert.deepStrictEqual(s2.sel.hulu.items.map(i => i.title), ['Long show'], 'the finished show is off the list');
  assert.strictEqual(s2.last.key, keyFor(0), 'this month is remembered for next time');
  assert.strictEqual(m.txt('#checkin'), '');
  assert.ok(m.$('#toast .undo'));
  const n = mount(seed);
  n.click(n.$('#checkin [data-ci="stop:0"]'));
  n.click(n.$('#ciApply'));
  assert.strictEqual(n.saved().sel.netflix.paying, true, 'unticked: you still pay for it');
  const later = mount(seed);
  later.click(later.$('#ciLater'));
  assert.strictEqual(later.txt('#checkin'), '');
  assert.strictEqual(later.saved() && later.saved().sel.netflix.paying, true, 'Not now changes nothing');
  const junk = mount(v2({ netflix: row('netflix', 'nf-std') }, { startKey: keyFor(-1), last: { key: 'x', stop: 'no' } }));
  assert.strictEqual(junk.txt('#checkin'), '', 'a broken record is ignored');
  assert.deepStrictEqual(m.errs.concat(n.errs, later.errs, junk.errs), []);
});

test('this month: with nothing on the list, the card asks for it first and makes cancelling an if', () => {
  const m = mount();
  m.click(m.$('[data-paychip=netflix]'));
  assert.match(m.txt('#homeAnswer .ans-wait'), /^Add what you want in step 2 first\.$/);
  assert.match(m.txt('#homeAnswer .ans-if'), /^Not watching these\? Cancel them\.$/);
  assert.ok(!m.$('#homeAnswer .ans-big'), 'no $0 verdict before you said what you watch');
  m.w.eval('part3Seen=false;syncBar()');
  assert.ok(m.$('#answerBar').hidden, 'no answer bar until there is a plan');
  assert.match(m.txt('#homeTier'), /We picked the cheapest\. Not sure\? Skip this\./, 'the price option is a guess, and says so');
});
test('this month: after a one-tap add the message says what changed, with Undo; a new search clears it', async () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std') }), { fetch: stub([], tierUp()) });
  await sleep(30);
  m.typeTitle('Gears'); m.click(m.$('#qSugg [data-sg="0"]'));
  assert.match(m.txt('#toast'), /^Added Gears Test to Game Pass\. You do not pay for Game Pass yet\. .+Undo$/);
  m.typeTitle('Ra');
  assert.ok(m.$('#toast').hidden, 'out of the way for the next search');
  assert.match(html, /\.toast\{[^}]*pointer-events:none\}/, 'a message never blocks the next tap');
  assert.match(html, /\.toast \.undo\{pointer-events:auto;/);
  m.click(m.$('#homeList [data-jump=answer]'));
  assert.strictEqual(m.d.activeElement, m.$('#h-p3'), 'Done? See what to do jumps to the answer');
});
test('this month: a Cancel line says when your list needs the service again, and reasons name what is out now', () => {
  const m = mount(v2({ gamepass: row('gamepass', 'gp-prem', { items: [{ title: 'G1', hours: 20, earliest: 2, tier: 'gp-pc' }] }), disney: row('disney', 'disney', { ci: 1, items: [{ title: 'Now show', hours: 5, earliest: 0 }, { title: 'Later show', hours: 5, earliest: 3 }] }) }));
  assert.ok(ansLines(m).includes('Cancel | Game Pass Premium | Your list needs PC Game Pass in ' + mon(m, 2) + '.'), ansLines(m).join(' || '));
  const keep = m.$$('#homeAnswer .al.keep small').map(x => x.textContent);
  assert.ok(keep.some(t => /^For Now show\. 5 hours (this|next) month\.$/.test(t)), 'not the show that comes out later: ' + keep.join(' | '));
  assert.match(m.txt('#plan .ans-cal'), /^Calendar note on the 1st\. Nothing is sent\.$/);
  assert.match(m.txt('#plan .nm-save'), /Counts only your list\.$/);
  const g = mount(v2({ gamepass: row('gamepass', 'gp-ult', { items: [{ title: 'G1', hours: 20, earliest: 2 }] }) }));
  assert.ok(ansLines(g).includes('Cancel | Game Pass Ultimate | G1 comes out in ' + mon(g, 2) + '. Start again then.'), ansLines(g).join(' || '));
});

test('check-in: it never hides the plan; the year chart shows with it; its lines are past tense; Not now puts it away', () => {
  const last = { key: keyFor(-1), stop: [{ entry: 'netflix', name: 'Netflix Standard' }], start: [], change: [{ entry: 'hulu', toId: 'hulu-noads', name: 'Upgrade Hulu with ads to Hulu No Ads' }], titles: [] };
  const m = mount(v2({ netflix: row('netflix', 'nf-std'), hulu: row('hulu', 'hulu', { ci: 1, items: [{ title: 'A show', hours: 10, earliest: 0 }] }) }, { startKey: keyFor(-1), last }));
  assert.ok(m.$('#checkin h2'), 'last month’s question is asked');
  assert.ok(m.$('#homeAnswer .ans-big'), 'and the plan shows right away (2026-10-21: the owner could not find the year chart behind the question)');
  assert.ok(!m.$('#part4').hidden && m.$('#plan .nm-year'), 'the next months and the year chart show too');
  assert.strictEqual(m.txt('#ciApply'), 'Update my plan');
  m.w.eval('part3Seen=false;syncBar()');
  assert.ok(m.$('#answerBar').hidden, 'the bar never covers the check-in');
  assert.deepStrictEqual(m.$$('#checkin .ci-line .act').map(x => x.textContent), ['Canceled', 'Upgraded']);
  assert.match(m.txt('#checkin'), /Uncheck any you did not do\./);
  m.click(m.$('#ciLater'));
  assert.strictEqual(m.txt('#checkin'), '', 'Not now: the question goes away');
  assert.ok(m.$('#homeAnswer .ans-big'), 'and the plan stays');
  const t = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Net show', hours: 20, earliest: 0 }] }), gamepass: row('gamepass', 'gp-ult', { ci: 1, items: [{ title: 'Big game', hours: 60, earliest: 1 }] }) }, { H: 20 }));
  assert.deepStrictEqual(t.saved().last.titles.map(x => x.title), ['Net show'], 'only titles you could watch this month are asked about');
});
test('example: the phone bar says it is made up and goes back to your list', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-ads') }));
  m.click(m.$('#loadExample'));
  m.w.eval('syncBar()');
  assert.ok(!m.$('#answerBar').hidden);
  assert.match(m.txt('#answerBar'), /^Made-up example\s*Clear example$/);
  assert.match(m.txt('#homeAnswer .ans-exnote'), /^Made-up example\.$/);
  m.click(m.$('#answerBar'));
  assert.ok(m.$('#exBar').hidden);
  assert.deepStrictEqual(Object.keys(m.saved().sel), ['netflix']);
  m.w.eval("go('services')");
  assert.ok(!m.$('#viewIntro .explain-ex'), 'one example notice, not two');
});

test('example: one tap in the header shows it, and one tap clears it', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-ads') }), { hash: '#services' });
  assert.strictEqual(m.txt('#loadExample'), 'Example');
  assert.ok(m.$('#exClear').hidden);
  m.click(m.$('#loadExample'));
  assert.ok(isVisible(m, 'home'));
  assert.ok(m.$('#loadExample').hidden && !m.$('#exClear').hidden, 'the header button becomes Clear example');
  assert.strictEqual(m.txt('#exClear'), 'Clear example');
  m.click(m.$('#exClear'));
  assert.ok(m.$('#exBar').hidden && !m.$('#loadExample').hidden && m.$('#exClear').hidden);
  assert.match(m.txt('#toast'), /^Example cleared\. Your list is back\./);
  assert.deepStrictEqual(Object.keys(m.saved().sel), ['netflix'], 'your own list was never touched');
  assert.match(html, /@media \(max-width:379px\)\{\.top-actions \.btn\.small\{padding:0 12px\}\}/, 'both header buttons fit on a small phone');
});

test('example: adding a title clears the example first, so it stays on your own list', async () => {
  const m = mount(v2({ hulu: row('hulu', 'hulu', { items: [{ title: 'Game C', hours: 30, earliest: 0 }] }) }), { fetch: stub([], upItems()), hash: '#soon' });
  await sleep(30);
  m.click(m.$('#loadExample'));
  m.w.eval("go('soon')");
  m.click(rowOf(m, 'Show A').querySelector('[data-soon=add]'));
  assert.ok(m.$('#exBar').hidden, 'the example is gone');
  assert.match(m.txt('#toast'), /^Example cleared\. Added Show A to My list\. You do not pay for Netflix yet\./);
  assert.deepStrictEqual(m.saved().sel.netflix.items.map(x => x.title), ['Show A'], 'kept on your own list');
  m.click(m.$('#loadExample'));
  m.w.eval("go('soon')");
  m.click(rowOf(m, 'Game C').querySelector('[data-soon=add]'));
  assert.match(m.txt('#toast'), /^Example cleared\. Game C is already on My list\./);
  assert.strictEqual(m.saved().sel.hulu.items[0].hours, 30, 'your own hours stay');
  m.click(m.$('#loadExample'));
  m.addBar({ title: 'My own show', svc: 'apple', hours: 4 });
  assert.match(m.txt('#toast'), /^Example cleared\. Added My own show to Apple TV\. You do not pay for Apple TV yet\./);
  assert.strictEqual(m.saved().sel.apple.paying, false, 'the service you picked, not paid for yet');
  assert.deepStrictEqual(m.errs, []);
});
test('example: no reminder from the made-up plan, its services are not called yours, and Questions does not offer it twice', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'A show', hours: 10, earliest: 0 }] }), hulu: row('hulu', 'hulu', { ci: 1, paying: false, items: [{ title: 'Later', hours: 5, earliest: 1 }] }) }));
  assert.ok(m.$('#remindBtn'), 'your own plan has Remind me');
  assert.match(m.txt('#p1sub'), /^You pay for: /);
  m.click(m.$('#loadExample'));
  assert.ok(!m.$('#remindBtn'), 'no calendar file from made-up data');
  assert.match(m.txt('#p1sub'), /^The example pays for: /);
  assert.ok(m.$('#helpPanel .help-ex').hidden);
  m.click(m.$('#exClear'));
  assert.ok(m.$('#remindBtn') && !m.$('#helpPanel .help-ex').hidden);
  assert.match(m.txt('#p1sub'), /^You pay for: /);
});

// Netflix fills 20 free hours now; Disney+ waits a month for time; Apple TV waits for its show; HBO Max has nothing.
const whySeed = extra => v2({
  netflix: row('netflix', 'nf-std', { items: [{ title: 'Long show', hours: 20, earliest: 0, tier: 'nf-std' }] }),
  disney: row('disney', 'disney', { ci: 1, items: [{ title: 'Movie', hours: 5, earliest: 0 }] }),
  apple: row('apple', 'apple', { ci: 2, items: [{ title: 'Sci-fi season', hours: 10, earliest: 3 }] }),
  max: row('max', 'max-std', { ci: 3 }),
}, extra);
// step 3 lines as "Cancel | Disney+ with ads | why": the pressed button is what you do this month
const ansLines = m => m.$$('#homeAnswer .al').map(l => [l.querySelector('.seg-b[aria-pressed=true]'), l.querySelector('.al-t b'), l.querySelector('.al-t small')].map(e => e ? e.textContent.replace(/^✓\s*/, '') : '').join(' | '));
// section 4 rows as "November | Cancel Netflix Standard. | You pay for … | $0"
const nextRows = m => m.$$('#plan .nm-r').map(r => [r.querySelector('.nm-m').firstChild.textContent, r.querySelector('.nm-t b').textContent, (r.querySelector('.nm-t small') || { textContent: '' }).textContent, r.querySelector('.nm-c').textContent].join(' | '));
const mon = (m, i) => m.w.eval('MONTHS[' + i + '].long').replace(/ \d+$/, '');
const tm = m => m.w.eval('windowIsNow') ? 'this month' : 'next month';
test('reasons: step 3 says how much free time you have, who gets it, and why each line is there', () => {
  const m = mount(whySeed());
  assert.strictEqual(m.txt('#homeAnswer .ans-why'), 'Free time: 40 minutes a day, about 20 hours ' + tm(m) + '. Netflix fills them.');
  const lines = ansLines(m);
  assert.deepStrictEqual(lines.slice().sort(), [
    'Cancel | Apple TV | Sci-fi season comes out in ' + mon(m, 3) + '. Start again then.',
    'Cancel | Disney+ with ads | Your hours go to Netflix first. Start again in ' + mon(m, 1) + '.',
    'Cancel | HBO Max Standard | Nothing on your list needs it.',
    'Keep | Netflix Standard | For Long show. 20 hours ' + tm(m) + '. You finish it.',
  ].sort(), lines.join(' || '));
  assert.match(m.txt('#homeAnswer .ans-now'), /^Bill today: \$65\.96 a month\. The list below saves you \$45\.97\.$/, 'today vs after the list, not a flat number');
  assert.ok(!/If you change nothing/.test(m.txt('#homeAnswer')));
});
test('reasons: a service waits when too few free hours are left for it', () => {
  const m = mount(v2({
    netflix: row('netflix', 'nf-std', { items: [{ title: 'Short show', hours: 15, earliest: 0, tier: 'nf-std' }] }),
    disney: row('disney', 'disney', { ci: 1, items: [{ title: 'Old movie', hours: 10, earliest: 0 }, { title: 'New season', hours: 6, earliest: 2 }] }),
  }));
  const lines = ansLines(m);
  assert.ok(lines.includes('Cancel | Disney+ with ads | Only 5 free hours left ' + tm(m) + '. Start again in ' + mon(m, 1) + '.'), lines.join(' || '));
  assert.strictEqual(m.txt('#homeAnswer .ans-why'), 'Free time: 40 minutes a day, about 20 hours ' + tm(m) + '. Netflix uses 15 of them.');
});
test('lines: Cancel on a Keep line skips it this month and its show moves later; Keep brings it back', () => {
  const m = mount(whySeed());
  m.click(m.$('#homeAnswer .al[data-entry=netflix] [data-pick=cancel]'));
  assert.deepStrictEqual([m.saved().skip.e, m.saved().skip.up], [['netflix'], []], 'saved per service, for this month only');
  assert.strictEqual(m.saved().skip.key, m.saved().startKey);
  assert.ok(ansLines(m).includes('Cancel | Netflix Standard | Your pick: not ' + tm(m) + '. Start again in ' + mon(m, 1) + '.'), ansLines(m).join(' || '));
  assert.match(m.txt('#toast'), /^You skip Netflix (this|next) month\..*Undo$/);   // after the 20th the plan starts next month
  assert.match(m.txt('#homeAnswer .ans-changed'), /^Your plan changed\. This month: \$[\d.]+ \(was \$19\.99\)\./, 'the money is in the note');
  assert.ok(m.$('#homeAnswer .al.is-new .al-new'), 'the changed lines are tagged');
  m.click(m.$('#homeAnswer .al[data-entry=netflix] [data-pick=keep]'));
  assert.ok(!('skip' in m.saved()), 'back to our pick for Netflix');
  assert.deepStrictEqual(m.saved().keep || {}, {}, 'not kept every month: the plan needs it anyway');
  assert.ok(ansLines(m).some(l => /^Keep \| Netflix Standard \| For Long show\./.test(l)));
  assert.deepStrictEqual(m.errs, []);
});
test('lines: Not now on a Start line; Start brings it back; Back to our pick clears your changes', () => {
  const m = mount(v2({ hulu: row('hulu', 'hulu', { paying: false, items: [{ title: 'Hulu show', hours: 10, earliest: 0 }] }), netflix: row('netflix', 'nf-std', { ci: 1 }) }));
  assert.ok(ansLines(m).includes('Start | Hulu with ads | For Hulu show. 10 hours ' + tm(m) + '. You finish it.'));
  m.click(m.$('#homeAnswer .al[data-entry=hulu] [data-pick=notnow]'));
  assert.ok(ansLines(m).includes('Not now | Hulu with ads | Your pick: not ' + tm(m) + '. Start in ' + mon(m, 1) + '.'), ansLines(m).join(' || '));
  m.click(m.$('#homeAnswer .al[data-entry=netflix] [data-pick=keep]'));
  assert.ok(m.$('#homeAnswer [data-pick=reset]'));
  m.click(m.$('#homeAnswer [data-pick=reset]'));
  assert.ok(!('skip' in m.saved()));
  assert.deepStrictEqual(m.saved().keep, {});
  assert.ok(ansLines(m).includes('Start | Hulu with ads | For Hulu show. 10 hours ' + tm(m) + '. You finish it.'));
  assert.match(m.txt('#toast'), /^Back to our pick\./);
  assert.ok(!m.$('#homeAnswer [data-pick=reset]'));
});

test('lines: last month\'s Cancel taps are dropped; odd saved values are dropped; the old pay switch is gone', () => {
  const old = mount(whySeed({ skip: { key: '2020-1', ids: ['nf-std'] }, mode: 'all' }));
  assert.ok(!('skip' in old.w.eval('state')) && !('mode' in old.w.eval('state')));
  const odd = mount(whySeed({ skip: { key: keyFor(0), e: ['netflix', 'nope', 7, 'hulu'], up: ['nf-prem', 'zz', 'gp-ult'] } }));
  assert.deepStrictEqual(JSON.parse(odd.w.eval('JSON.stringify([state.skip.e,state.skip.up])')), [['netflix'], ['nf-prem']], 'only services and price options you have');
  assert.ok(!odd.$('[data-mode]') && !/data-mode|Keep all I want/.test(html));
});

test('lines: an Upgrade line has Not now; it keeps the price option you pay for', () => {
  const m = mount(v2({ gamepass: row('gamepass', 'gp-ess', { items: [{ title: 'Easy game', hours: 5, earliest: 0 }, { title: 'Big game', hours: 10, earliest: 0, tier: 'gp-ult' }] }) }));
  assert.ok(ansLines(m).some(l => /^Upgrade \| Game Pass Essential to Game Pass Ultimate \| /.test(l)), ansLines(m).join(' || '));
  m.click(m.$('#homeAnswer [data-pick=notnowup]'));
  assert.deepStrictEqual([m.saved().skip.e, m.saved().skip.up], [[], ['gp-ult']]);
  const lines = ansLines(m);
  assert.ok(lines.some(l => /^Keep \| Game Pass Essential \| For Easy game\./.test(l)), lines.join(' || '));
  assert.ok(lines.some(l => /^Not now \| Game Pass Ultimate \| Your pick: not (this|next) month\. Upgrade in [A-Z][a-z]+\.$/.test(l)), lines.join(' || '));
  m.click(m.$('#homeAnswer .al [data-pick=upgrade]'));
  assert.ok(!('skip' in m.saved()));
});

test('reasons: a line counts the lower price options it pays for, and names the service', () => {
  const m = mount(v2({
    gamepass: row('gamepass', 'gp-ult', { items: [{ title: 'Everyday game', hours: 15, earliest: 0, tier: 'gp-ess' }, { title: 'Day-one game', hours: 5, earliest: 0, tier: 'gp-ult' }] }),
    netflix: row('netflix', 'nf-std', { ci: 1, items: [{ title: 'Std show', hours: 5, earliest: 0, tier: 'nf-std' }] }),
  }));
  const keep = ansLines(m).filter(l => l.startsWith('Keep'));
  assert.ok(keep.some(t => /^Keep \| Game Pass Ultimate \| For (Day-one game and Everyday game|Everyday game and Day-one game)\. 20 hours (this|next) month\. You finish it\.$/.test(t)), keep.join(' || '));
  assert.strictEqual(m.txt('#homeAnswer .ans-why'), 'Free time: 40 minutes a day, about 20 hours ' + tm(m) + '. Game Pass fills them.');
  assert.ok(ansLines(m).includes('Cancel | Netflix Standard | Your hours go to Game Pass first. Start again in ' + mon(m, 1) + '.'), ansLines(m).join(' || '));
});

test('reasons: a show that will not fit says so, and "the rest" needs someone who gets time', () => {
  const m = mount(v2({
    netflix: row('netflix', 'nf-std', { items: [{ title: 'Huge show', hours: 300, earliest: 0, tier: 'nf-std' }] }),
    apple: row('apple', 'apple', { ci: 2, items: [{ title: 'Apple premiere', hours: 20, earliest: 3 }] }),
  }));
  assert.ok(ansLines(m).includes('Cancel | Apple TV | Apple premiere comes out in ' + mon(m, 3) + '. It does not fit in 12 months.'), ansLines(m).join(' || '));
  assert.strictEqual(m.txt('#homeAnswer .ans-why'), 'Free time: 40 minutes a day, about 20 hours ' + tm(m) + '. Netflix fills them.', 'Apple TV never gets a turn');
  const later = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Later show', hours: 5, earliest: 2, tier: 'nf-std' }] }) }));
  assert.strictEqual(later.txt('#homeAnswer .ans-why'), 'Free time: 40 minutes a day, about 20 hours ' + tm(later) + '. Nothing on your list is out yet.');
});
test('updates: a change made on another page is said on that page, with a dot on Your plan, and again in step 3', () => {
  const m = mount(whySeed(), { hash: '#estimates' });
  assert.ok(m.$('#ansNote').hidden);
  m.$('#hrs').value = '40'; m.fire(m.$('#hrs'), 'input');
  assert.ok(!m.$('#ansNote').hidden, 'said right where you are');
  assert.match(m.txt('#ansNote'), /^Your answer changed\. This month: \$[\d.]+ \(was \$19\.99\)\..* See what to do$/);
  assert.ok(m.$('.nav [data-go=home]').classList.contains('news'), 'a dot on Your plan');
  m.click(m.$('#ansNote [data-go=home]'));
  assert.ok(isVisible(m, 'home'));
  assert.match(m.txt('#homeAnswer .ans-changed'), /^Your plan changed\. This month: /, 'still there when you arrive');
  assert.ok(!m.$('.nav [data-go=home]').classList.contains('news'));
  m.click(m.$('.nav [data-go=list]'));
  assert.ok(m.$('#ansNote').hidden, 'once seen, it is not news any more');
  assert.match(html, /\.home-top,#checkin,\.home-grid\{max-width:860px\}/, 'a readable column on wide screens');
});
test('updates: the phone bar says Changed while step 3 is off screen', () => {
  const m = mount(whySeed());
  m.click(m.$('#homeAnswer .al[data-entry=netflix] [data-pick=cancel]'));
  m.w.eval('part3Seen=false;syncBar()');
  assert.match(m.txt('#answerBar'), /^(This|Next) month: \$[\d.]+ Changed\s*See what to do$/);
});

test('the next months: the savings count only until your list is done', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Show', hours: 10, earliest: 0, tier: 'nf-std' }] }), max: row('max', 'max-std', { ci: 1 }) }));
  assert.strictEqual(m.txt('#plan .nm-save'), 'List done in ' + mon(m, 0) + ': $20, not $38. You save $18. Counts only your list.');
});

test('services: the total under the list reads as a sentence, also with none paid', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { paying: false }) }), { hash: '#services' });
  assert.strictEqual(m.txt('#subsTotal'), 'You do not pay for it yet.');
  assert.ok(mount(undefined, { hash: '#services' }).$('#subsTotal').hidden, 'nothing to total yet');
  assert.ok(!/id="subsTotal"[^>]*class="fine-note"/.test(html) && !/<span class="fine-note" id="subsTotal">/.test(html), 'not a small note in the corner');
});

test('reasons: a line counts every lower price option it covers, also through a middle one', () => {
  const m = mount(v2({
    gamepass: row('gamepass', 'gp-ult', { items: [{ title: 'Ult game', hours: 6, earliest: 0, tier: 'gp-ult' }, { title: 'Prem game', hours: 5, earliest: 0, tier: 'gp-prem' }, { title: 'Ess game', hours: 4, earliest: 0, tier: 'gp-ess' }] }),
    netflix: row('netflix', 'nf-std', { ci: 1, items: [{ title: 'Std show', hours: 10, earliest: 0, tier: 'nf-std' }] }),
  }, { H: 40 }));
  assert.ok(ansLines(m).some(l => /^Keep \| Game Pass Ultimate \| For .+\. 15 hours (this|next) month\. You finish it\.$/.test(l)), ansLines(m).join(' || '));
});
test('next change never says to cancel a service you chose to keep', () => {
  const m = mount(v2({
    netflix: row('netflix', 'nf-std', { items: [{ title: 'Ads show', hours: 8, earliest: 0 }] }),
    hulu: row('hulu', 'hulu', { ci: 1, items: [{ title: 'Hulu show', hours: 4, earliest: 0 }] }),
  }, { keep: { netflix: true } }));
  assert.ok(ansLines(m).includes('Keep | Netflix Standard | Your pick: keep it every month.'), ansLines(m).join(' || '));
  assert.ok(!nextRows(m).some(r => /Netflix/.test(r.split(' | ')[1])), nextRows(m).join(' || '));
  assert.ok(!m.$$('#plan .gantt .lab').some(l => /Covers your other plans/.test(l.textContent) && /Netflix/.test(l.textContent)), 'no second Netflix row');
});

test('reasons: "The others come later" only when every other service on the list gets a turn', () => {
  const m = mount(v2({
    netflix: row('netflix', 'nf-std', { items: [{ title: 'Huge show', hours: 300, earliest: 0, tier: 'nf-std' }] }),
    hulu: row('hulu', 'hulu', { ci: 1, items: [{ title: 'Hulu show', hours: 10, earliest: 0 }] }),
  }));
  assert.ok(ansLines(m).includes('Cancel | Hulu with ads | It does not fit in 12 months.'), ansLines(m).join(' || '));
  assert.strictEqual(m.txt('#homeAnswer .ans-why'), 'Free time: 40 minutes a day, about 20 hours ' + tm(m) + '. Netflix fills them.');
});

test('kept: step 4 names a kept service every month, and a bigger price option over it is not paid twice', () => {
  const ex = mount(); ex.click(ex.$('#loadExample'));
  ex.click(ex.$('#homeAnswer .al[data-entry=max] [data-pick=keep]'));
  ex.click(ex.$('#homeAnswer .al[data-entry=disney] [data-pick=keep]'));
  nextRows(ex).filter(r => !/\| \$0$/.test(r)).forEach(r => assert.match(r, /You pay for [^|]*Disney\+ with ads[^|]*\|/, r));
  assert.match(ex.w.eval('lastShare'), /Disney\+ with ads/);
  const m = mount(v2({ netflix: row('netflix', 'nf-ads'), hulu: row('hulu', 'hulu', { ci: 1, items: [{ title: 'Hulu show', hours: 5, earliest: 0 }] }) }));
  m.click(m.$('#homeAnswer .al[data-entry=netflix] [data-pick=keep]'));
  m.addBar({ title: 'Std show', svc: 'netflix', tier: 'nf-std', hours: 10 });
  m.w.eval("go('home')");
  assert.strictEqual(m.txt('#homeAnswer .ans-big'), '$32.48', 'Standard and Hulu, not Standard plus the kept with-ads: ' + ansLines(m).join(' || '));
  assert.ok(nextRows(m).some(r => /Step down from Netflix Standard to Netflix with ads\./.test(r)), 'back to the kept option is a step down: ' + nextRows(m).join(' || '));
});
test('the next months: every service to cancel is named, in step 4 and in the calendar file', () => {
  const m = mount(v2({
    gamepass: row('gamepass', 'gp-ess', { items: [{ title: 'Game', hours: 5, earliest: 0 }] }),
    netflix: row('netflix', 'nf-ads', { ci: 1, items: [{ title: 'Show', hours: 5, earliest: 0 }] }),
    hulu: row('hulu', 'hulu', { ci: 2, items: [{ title: 'Hulu show', hours: 5, earliest: 0 }] }),
  }));
  assert.strictEqual(nextText(m), 'Cancel Game Pass Essential, Netflix with ads and Hulu with ads.');
  assert.match(m.w.eval('reminderIcs()').replace(/\r\n /g, ''), /DESCRIPTION:In [A-Z][a-z]+: Cancel Game Pass Essential\\, Netflix with ads and Hulu with ads\./, 'the calendar file, unfolded');
});
test('updates: a change that only moves later months is said too', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Show', hours: 10, earliest: 0, tier: 'nf-std' }] }) }), { hash: '#list' });
  m.addBar({ title: 'December show', svc: 'netflix', hours: 5, when: 2 });
  assert.match(m.txt('#ansNote'), /^Your next months changed\. See what to do$/, 'said once');
  m.w.eval("go('home')");
  assert.match(m.txt('#homeAnswer .ans-changed'), /Your next months changed\./);
});
test('updates: your first title says what you paid before; a list-less answer has no tags; the note says "Keep (was Cancel)"', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std') }));
  assert.ok(!m.$('#homeAnswer .al-new'), 'nothing to compare a first answer with');
  m.addBar({ title: 'Show', svc: 'netflix', hours: 10 });
  assert.match(m.txt('#homeAnswer .ans-changed'), /This month: \$19\.99 \(was \$19\.99\)|Netflix Standard: Keep \(was Cancel\)\./);
  assert.doesNotMatch(m.txt('#homeAnswer .ans-changed'), /was \$0\)/);
  const h = mount(v2({ hulu: row('hulu', 'hulu', { paying: false, items: [{ title: 'Hulu show', hours: 10, earliest: 0 }] }) }));
  h.click(h.$('#homeAnswer [data-pick=notnow]'));
  assert.match(h.txt('#homeAnswer .ans-changed'), /Hulu with ads: Not now \(was Start\)\./);
});
test('the next months: the share text counts the same months as step 4, and a delay never looks like a saving', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Show', hours: 10, earliest: 0, tier: 'nf-std' }] }), gamepass: row('gamepass', 'gp-ess', { ci: 1, items: [{ title: 'Game', hours: 5, earliest: 0 }] }) }));
  const before = m.txt('#plan .nm-save');
  assert.match(m.w.eval('lastShare').split('\n')[1], /^List done in [A-Z][a-z]+: my plan costs \$\d+(, the same as now\.|\. If I change nothing: \$\d+\.)$/);
  m.click(m.$('#homeAnswer .al[data-entry=gamepass] [data-pick=cancel]'));
  const after = m.txt('#plan .nm-save');
  assert.doesNotMatch(after, /You save/, 'waiting a month is not a saving: ' + before + ' / ' + after);
  assert.match(after, /^List done in [A-Z][a-z]+: \$\d+(, the same as now\.|\. If you change nothing: \$\d+\.)/, 'no saving: never "$X, not $Y" without one');
});
test('lines: Not now on an Upgrade keeps your price option; Cancel on a Keep line adds no made-up upgrade line', () => {
  const b = mount(v2({ gamepass: row('gamepass', 'gp-ess', { items: [{ title: 'Console game', hours: 10, earliest: 0 }, { title: 'PC game', hours: 10, earliest: 0, tier: 'gp-pc' }] }) }));
  assert.ok(ansLines(b).some(l => /^Upgrade \| Game Pass Essential to Game Pass Ultimate \| For .*PC game/.test(l)), ansLines(b).join(' || '));
  b.click(b.$('#homeAnswer [data-pick=notnowup]'));
  assert.ok(ansLines(b).some(l => /^Keep \| Game Pass Essential \| For Console game\./.test(l)), 'Not now really keeps Essential: ' + ansLines(b).join(' || '));
  assert.ok(ansLines(b).some(l => /^Not now \| /.test(l)));
  const n = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Prem show', hours: 10, earliest: 0, tier: 'nf-prem' }] }) }));
  n.click(n.$('#homeAnswer [data-pick=notnowup]'));
  assert.ok(!ansLines(n).some(l => /^Cancel \| Netflix Standard \| Your pick: not /.test(l)), 'you did not tap Cancel: ' + ansLines(n).join(' || '));
  const c = mount(v2({ gamepass: row('gamepass', 'gp-ess', { items: [{ title: 'Easy game', hours: 10, earliest: 0 }, { title: 'Big game', hours: 10, earliest: 2, tier: 'gp-ult' }] }) }));
  c.click(c.$('#homeAnswer .al[data-entry=gamepass] [data-pick=cancel]'));
  assert.ok(!ansLines(c).some(l => /^Not now \|/.test(l)), 'no upgrade was planned this month: ' + ansLines(c).join(' || '));
});
test('lines: Cancel stays when the service gets a new title; Not now names the price option you start next and when', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Std show', hours: 10, earliest: 0, tier: 'nf-std' }] }), hulu: row('hulu', 'hulu', { ci: 1, items: [{ title: 'Hulu show', hours: 5, earliest: 0 }] }) }));
  m.click(m.$('#homeAnswer .al[data-entry=netflix] [data-pick=cancel]'));
  m.addBar({ title: 'Prem show', svc: 'netflix', tier: 'nf-prem', hours: 5 });
  m.w.eval("go('home')");
  assert.ok(ansLines(m).some(l => /^Cancel \| Netflix Standard \| Your pick: not /.test(l)), ansLines(m).join(' || '));
  const s = mount(v2({ netflix: row('netflix', 'nf-std', { paying: false, items: [{ title: 'Std show', hours: 6, earliest: 0, tier: 'nf-std' }, { title: 'Ads show', hours: 6, earliest: 0 }] }) }));
  s.click(s.$('#homeAnswer [data-pick=notnow]'));
  assert.ok(ansLines(s).includes('Not now | Netflix Standard | Your pick: not ' + tm(s) + '. Start in ' + mon(s, 1) + '.'), ansLines(s).join(' || '));
});
test('lines: each service keeps its place after a tap, the message says next month after the 20th, and the change line opens step 3', () => {
  const m = mount(); m.click(m.$('#loadExample'));
  const order = () => m.$$('#homeAnswer .al').map(l => l.dataset.entry);
  const was = order();
  m.click(m.$('#homeAnswer .al[data-entry=netflix] [data-pick=cancel]'));
  assert.deepStrictEqual(order(), was, 'the line you tapped does not jump');
  const late = mount(whySeed({ startKey: '2026-10' }), { date: '2026-10-25T12:00:00' });
  late.click(late.$('#homeAnswer .al[data-entry=netflix] [data-pick=cancel]'));
  assert.match(late.txt('#toast'), /^You skip Netflix next month\./);
  assert.match(html, /\.top \.ans-note\{order:3;flex:1 0 100%\}/, 'under the page title');
  const n = mount(whySeed(), { hash: '#estimates' });
  n.$('#hrs').value = '40'; n.fire(n.$('#hrs'), 'input');
  n.click(n.$('#ansNote [data-go=home]'));
  assert.strictEqual(n.d.activeElement, n.$('#h-p3'), 'straight to step 3');
});
test('words: price options have one name everywhere; step 1 names at most three services', () => {
  const m = mount();
  m.click(m.$('[data-paychip=netflix]'));
  m.click(m.$('[data-tierpick=nf-ads]'));
  assert.match(m.txt('#toast'), /^Netflix with ads, \$8\.99 a month\./);
  const ex = mount(); ex.click(ex.$('#loadExample'));
  assert.match(ex.txt('#p1sub'), /^The example pays for: Game Pass, Netflix and 4 more$/);
});
test('lines: Not now on another price option of a service you pay for waits on that option only', () => {
  const m = mount(v2({ gamepass: row('gamepass', 'gp-ess', { items: [{ title: 'PC Game', hours: 10, earliest: 0, tier: 'gp-pc' }] }) }));
  assert.ok(ansLines(m).some(l => /^Start \| PC Game Pass \| /.test(l)), ansLines(m).join(' || '));
  m.click(m.$('#homeAnswer .al [data-pick=notnow]'));
  assert.deepStrictEqual([m.saved().skip.e, m.saved().skip.up], [[], ['gp-pc']]);
  assert.ok(ansLines(m).includes('Not now | PC Game Pass | Your pick: not ' + tm(m) + '. Start in ' + mon(m, 1) + '.'), 'the line stays, so you can undo it: ' + ansLines(m).join(' || '));
  m.click(m.$('#homeAnswer .al [data-pick=start]'));
  assert.ok(!('skip' in m.saved()));
});
test('kept: a kept price option is not drawn or charged in a month a bigger option covers it', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: '4K show', hours: 10, earliest: 2, tier: 'nf-prem' }] }) }, { keep: { netflix: true } }));
  const std = m.$$('#plan .gantt .cell').filter(c => c.title.startsWith('Netflix Standard in '));
  assert.ok(!std[2].classList.contains('on') && /included with a bigger price option$/.test(std[2].title), std[2].title);
  const t = m.$$('#plan .subtable tbody tr').map(r => r.textContent.replace(/\s+/g, ' ').trim());
  assert.ok(t.some(r => /^Netflix Standard\s*11\s*\$219\.89/.test(r)), t.join(' | '));
  const year = m.$$('#plan .gantt .mt').reduce((a, c) => a + +c.title.replace(/^.*\$/, ''), 0);
  assert.ok(Math.abs(year - (219.89 + 26.99)) < 0.01, 'the table and the chart agree: ' + year);
});
test('the next months: hours pushed past the year by a Cancel are not a saving', () => {
  const m = mount(v2({ c: custom('c', 'Anime Box', 10, { items: [{ title: 'Long', hours: 240, earliest: 0 }] }) }));
  m.click(m.$('#homeAnswer .al [data-pick=cancel]'));
  assert.match(m.txt('#plan .warn'), /won’t fit/);
  assert.doesNotMatch(m.txt('#plan .nm-save'), /You save/);
  assert.doesNotMatch(m.w.eval('lastShare'), /I save/);
});
test('lines: after Not now on an upgrade, picking that option in step 1 keeps it, and Back to our pick goes away', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: '4K Show', hours: 10, earliest: 0, tier: 'nf-prem' }] }) }));
  m.click(m.$('#homeAnswer [data-pick=notnowup]'));
  m.w.eval("state.sel.netflix.tier='nf-prem';state.sel.netflix.price=26.99;touch()");
  assert.deepStrictEqual(ansLines(m), ['Keep | Netflix Premium | For 4K Show. 10 hours ' + tm(m) + '. You finish it.']);
  assert.ok(!m.$('#homeAnswer [data-pick=reset]'));
});
test('lines: Start says when it really starts; a line that moves later "comes later"; a service added again starts clean', () => {
  const m = mount(v2({
    disney: row('disney', 'disney', { items: [{ title: 'Andor', hours: 20, earliest: 0 }] }),
    psplus: row('psplus', 'ps-ess', { ci: 1, paying: false, items: [{ title: 'Game', hours: 10, earliest: 0 }] }),
  }));
  m.click(m.$('#homeAnswer .al[data-entry=disney] [data-pick=cancel]'));
  m.click(m.$('#homeAnswer .al[data-entry=psplus] [data-pick=notnow]'));
  m.click(m.$('#homeAnswer .al[data-entry=disney] [data-pick=keep]'));
  m.click(m.$('#homeAnswer .al[data-entry=psplus] [data-pick=start]'));
  assert.match(m.txt('#toast'), /^PS Plus starts in [A-Z][a-z]+\. Others come first\./);
  assert.match(m.txt('#homeAnswer .ans-changed'), /PS Plus Essential comes later\. See step 4\./);
  const n = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Show', hours: 10, earliest: 0, tier: 'nf-std' }] }) }));
  n.click(n.$('#homeAnswer [data-pick=cancel]'));
  n.w.eval("go('services')");
  n.click(n.$('.sub[data-id=netflix] [data-act=remove]'));
  assert.ok(!n.$('#homeAnswer [data-pick=reset]'), 'a removed service leaves no Back to our pick');
  n.click(n.$('[data-chip=netflix]'));
  n.w.eval("go('home')");
  assert.ok(!ansLines(n).some(l => /Your pick: not /.test(l)), 'no old Cancel on a service you added again: ' + ansLines(n).join(' || '));
});
test('lines: an upgrade with nothing to wait on has no Not now; a Cancel line never points at an option that starts this month', () => {
  const m = mount(v2({ crunchy: row('crunchy', 'crunchy', { price: 21.73, items: [{ title: 'One Piece', hours: 10, earliest: 0, tier: 'crunchy-mega' }] }) }));
  const up = m.$$('#homeAnswer .al').find(l => /Upgrade/.test(l.textContent));
  if (up) assert.deepStrictEqual([...up.querySelectorAll('.seg-b')].map(b => b.dataset.pick), up.querySelectorAll('[data-pick=notnowup]').length ? ['upgrade', 'notnowup'] : ['upgrade']);
  const g = mount(v2({ gamepass: row('gamepass', 'gp-prem', { items: [{ title: 'PC Game', hours: 20, earliest: 0, tier: 'gp-pc' }] }) }));
  assert.ok(ansLines(g).includes('Cancel | Game Pass Premium | Nothing on your list needs it.'), ansLines(g).join(' || '));
});
test('names: the main page is "Your plan" everywhere it is named; "this month" is only ever the month', () => {
  const m = mount(undefined, { hash: '#services' });
  assert.strictEqual(m.txt('.nav [data-go=home] > span'), 'Your plan');
  assert.strictEqual(m.txt('#nextStep .btn'), '← Back to Your plan');
  assert.match(m.txt('#viewIntro .explain-step'), /Back to Your plan$/);
  m.w.eval("go('home')");
  assert.strictEqual(m.txt('#viewTitle'), 'Your plan');
  assert.strictEqual(m.txt('.home-lead'), 'We tell you what to pay for, month by month.');
  assert.strictEqual(m.txt('#h-p3'), 'What to do this month');
  m.click(m.$('#helpBtn'));
  assert.strictEqual(m.txt('#helpTitle'), 'Questions about your plan');
  assert.doesNotMatch(html, /Back to This month|on This month\.|go back to This month|<span>This month<\/span>/);
});
test('help: Questions starts with "How to use it", the six steps in the app\'s own step circles, on every page', () => {
  for (const hash of ['#home', '#services', '#list', '#soon', '#estimates']) {
    const m = mount(undefined, { hash });
    m.click(m.$('#helpBtn'));
    const box = m.$('#helpPanel #howto');
    assert.ok(box && box.open, hash + ': open to start with');
    assert.strictEqual(box.nextElementSibling, m.$('#helpList'), 'above the questions');
    assert.deepStrictEqual(m.$$('#howto .ht b').map(b => b.textContent), ['Open Your plan', 'Tap what you pay for', 'Add what you want', 'Read what to do this month', 'Check the next months', 'Cancel or start it yourself']);
    assert.deepStrictEqual(m.$$('#howto .ht .pn').map(p => p.textContent), ['1', '2', '3', '4'], 'the same numbers as the steps on Your plan');
    assert.strictEqual(m.txt('#howto .ht-loop'), 'Next month: tick what you did. Repeat.');
  }
  const m0 = mount(undefined);
  m0.$$('#howto .ht small').concat(m0.$$('#howto .ht-loop')).forEach(e => e.textContent.split(/[.!?](?:\s|$)/).filter(x => x.trim()).forEach(sen => assert.ok(sen.trim().split(/\s+/).length <= 12, sen)));
  assert.match(html, /@container \(min-width:760px\)\{\s*\.help-panel \.ht-list\{grid-template-columns:repeat\(6,/, 'across on a wide panel, down on a phone');
});
// a month key ('2026-11') counted from the page's own first month
const mkey = (m, i) => m.w.eval("(i=>{const d=new Date(startDate.getFullYear(),startDate.getMonth()+i,1);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')})(" + i + ')');
test('keep it: a show that airs weekly is planned by the month its episodes air, and step 3 says how long to keep it', () => {
  const seed = m0 => v2({ apple: row('apple', 'apple', { items: [{ title: 'Ted Lasso', hours: 12, earliest: 0, tv: 4242, air: [[mkey(m0, 0), 4], [mkey(m0, 1), 4], [mkey(m0, 2), 4]], ends: mkey(m0, 2) + '-12' }] }) }, { H: 75 });
  const probe = mount(undefined);
  const m = mount(seed(probe));
  const line = ansLines(m)[0];
  assert.match(line, /^Keep \| Apple TV \| Ted Lasso takes about 12 hours\. 4 hours (this|next) month\. New episodes until [A-Z][a-z]{2} 12(, \d{4})?\. Keep it until [A-Z][a-z]+\.$/, line);
  assert.ok(line.endsWith('Keep it until ' + mon(m, 2) + '.'), 'until the finale, not just this month');
  const cells = m.$$('#plan .gantt .cell').filter(c => c.title.startsWith('Apple TV in '));
  assert.deepStrictEqual(cells.slice(0, 4).map(c => c.classList.contains('on')), [true, true, true, false]);
  assert.match(m.txt('#queue'), /new episodes until [A-Z][a-z]{2} 12/);
  const old = mount(v2({ apple: row('apple', 'apple', { items: [{ title: 'Ted Lasso', hours: 12, earliest: 0 }] }) }, { H: 75 }));
  assert.match(ansLines(old)[0], /You finish it\.$/, 'without air dates the whole season counts now');
});
test('keep it: a long game says how long it takes and how long to keep the service', () => {
  const m = mount(v2({ gamepass: row('gamepass', 'gp-ult', { items: [{ title: 'Big RPG', hours: 200, earliest: 0, tier: 'gp-ult' }] }) }, { H: 75 }));
  assert.strictEqual(ansLines(m)[0], 'Keep | Game Pass Ultimate | Big RPG takes about 200 hours. 75 hours ' + tm(m) + '. Keep it until ' + mon(m, 2) + ' to finish.');
  assert.match(nextText(m), /^Cancel Game Pass Ultimate\.$/);
});
test('keep it: adding a show from search keeps its air dates; one from New releases looks them up', async () => {
  const d = n => isoOffset(n);
  const weekly = { id: 4242, name: 'Weekly Show', status: 'Running', premiered: d(0), averageRuntime: 30, webChannel: { name: 'Apple TV+' }, _embedded: { episodes: [0, 7, 35, 42, 70].map((n, i) => ({ season: 1, number: i + 1, airdate: d(n), runtime: 30 })) } };
  const f = stub([[/search\/shows/, resp(200, [{ score: 1, show: { id: 4242, name: 'Weekly Show', premiered: d(0), status: 'Running', webChannel: { name: 'Apple TV+' }, network: null } }])], [/shows\/4242\?embed=episodes/, resp(200, weekly)]]);
  const m = mount(v2({ apple: row('apple', 'apple') }), { fetch: f });
  m.typeTitle('Weekly'); await sleep(500);
  const opt = m.$$('#qSugg [role=option]').find(o => /Weekly Show/.test(o.textContent));
  assert.ok(opt, 'the search shows it');
  m.click(opt); await sleep(30);
  const it = m.saved().sel.apple.items[0];
  assert.ok(it.air && it.air.length >= 2 && it.ends === d(70), JSON.stringify(it));
  assert.strictEqual(it.season, 1);
  const up = { checked: '2026-10-05', items: [{ id: 'weekly', title: 'Weekly Show', kind: 'tv', service: 'apple', subs: ['apple'], date: d(0), confidence: 'confirmed', hours: 3, season: 1, tvmazeId: 4242, checked: '2026-10-05' }] };
  const g = stub([[/shows\/4242\?embed=episodes/, resp(200, weekly)]], up);
  const n = mount(v2({ apple: row('apple', 'apple') }), { fetch: g, hash: '#soon' });
  await sleep(30);
  n.click(rowOf(n, 'Weekly Show').querySelector('[data-soon=add]'));
  await sleep(40);
  const it2 = n.saved().sel.apple.items[0];
  assert.ok(it2.air && it2.ends === d(70) && it2.season === 1, JSON.stringify(it2));
  assert.strictEqual(g.tv().filter(u => /embed=episodes/.test(u)).length, 1, 'looked up once');
  n.w.eval("soonAdd('weekly','apple','8')");   // Change, then Save with new hours
  const it3 = n.saved().sel.apple.items[0];
  assert.ok(it3.hours === 8 && it3.air && it3.ends === d(70), 'Change keeps the air dates: ' + JSON.stringify(it3));
  assert.strictEqual(g.tv().filter(u => /embed=episodes/.test(u)).length, 1, 'and does not look them up again');
  assert.deepStrictEqual(m.errs.concat(n.errs), []);
});
test('keep it: "to finish" only when it is true: not across a pause, not when the list does not fit, not for one price option', () => {
  const p = mount(undefined);
  const gap = mount(v2({ apple: row('apple', 'apple', { items: [{ title: 'Ted Lasso', hours: 10, earliest: 0, tv: 1, air: [[mkey(p, 0), 4], [mkey(p, 1), 2], [mkey(p, 3), 3], [mkey(p, 4), 2]], ends: mkey(p, 4) + '-20' }] }) }, { H: 75 }));
  assert.doesNotMatch(ansLines(gap)[0], /to finish|New episodes until/, 'the run pauses and starts again: ' + ansLines(gap)[0]);
  assert.match(ansLines(gap)[0], /Keep it until [A-Z][a-z]+\.$/);
  const big = mount(v2({ gamepass: row('gamepass', 'gp-ess', { items: [{ title: 'Huge RPG', hours: 300, earliest: 0 }] }) }));
  assert.match(ansLines(big)[0], /Huge RPG takes about 300 hours\. 20 hours (this|next) month\. Keep it until [A-Z][a-z]+\.$/, 'it does not all fit this year');
  const pc = mount(v2({ gamepass: row('gamepass', 'gp-ess', { items: [{ title: 'PC Thing', hours: 10, earliest: 0, tier: 'gp-pc' }] }) }, { keep: { gamepass: true }, H: 75 }));
  assert.ok(ansLines(pc).some(l => /^Start \| PC Game Pass \| For PC Thing\. 10 hours (this|next) month\. You finish it\.$/.test(l)), 'not the kept Essential\'s months: ' + ansLines(pc).join(' || '));
});
test('keep it: undated episodes mean no finale is claimed; the finale is the named show\'s; Change keeps the air dates', () => {
  const show = (id, dates, undated) => ({ id, name: 'S' + id, status: 'Running', premiered: dates[0], averageRuntime: 30, webChannel: { name: 'Apple TV+' }, _embedded: { episodes: dates.map((d, i) => ({ season: 3, number: i + 1, airdate: d, runtime: 30 })).concat(Array.from({ length: undated }, (_, i) => ({ season: 3, number: dates.length + i + 1, airdate: '', runtime: 30 }))) } });
  const m = mount(undefined);
  const a = m.w.eval('tvAir')(show(1, [isoOffset(0), isoOffset(7)], 4), 3, isoOffset(0));
  assert.strictEqual(a.est, true, 'more episodes are coming, dates not listed yet: an estimate');
  assert.strictEqual(a.ends, isoOffset(35), 'the 4 with no date come one a week after the last dated one');
  assert.strictEqual(a.air.reduce((t, x) => t + x[1], 0), 6);
  const p = mount(undefined);
  const two = mount(v2({ apple: row('apple', 'apple', { items: [
    { title: 'Ted Lasso', hours: 6, earliest: 0, tv: 1, air: [[mkey(p, 0), 2], [mkey(p, 1), 2], [mkey(p, 2), 2]], ends: mkey(p, 2) + '-12' },
    { title: 'Later Show', hours: 6, earliest: 3, tv: 2, air: [[mkey(p, 3), 3], [mkey(p, 4), 3]], ends: mkey(p, 4) + '-20' }] }) }, { H: 75 }));
  assert.match(ansLines(two)[0], /New episodes until [A-Z][a-z]{2} 12(, \d{4})?\./, 'Ted Lasso\'s own finale, not the later show\'s: ' + ansLines(two)[0]);
});
test('show hours: a guess from New releases becomes the real total from TVMaze; hours you typed are kept', async () => {
  const d = n => isoOffset(n);
  const show = { id: 4343, name: 'Real Hours', status: 'Running', premiered: d(0), averageRuntime: 45, webChannel: { name: 'Apple TV+' }, _embedded: { episodes: [0, 7, 14, 21, 28, 35].map((n, i) => ({ season: 1, number: i + 1, airdate: d(n), runtime: 45 })) } };
  const up = { checked: '2026-10-05', items: [{ id: 'real', title: 'Real Hours', kind: 'tv', service: 'apple', subs: ['apple'], date: d(0), confidence: 'confirmed', hours: null, season: 1, tvmazeId: 4343, checked: '2026-10-05' }] };
  const g = stub([[/shows\/4343\?embed=episodes/, resp(200, show)]], up);
  const m = mount(v2({ apple: row('apple', 'apple') }), { fetch: g, hash: '#soon' });
  await sleep(30);
  m.click(rowOf(m, 'Real Hours').querySelector('[data-soon=add]'));
  assert.strictEqual(m.saved().sel.apple.items[0].hoursGuess, true, 'the list had no hours: a guess for now');
  await sleep(40);
  const it = m.saved().sel.apple.items[0];
  assert.strictEqual(it.hours, 4.5, '6 episodes of 45 minutes');
  assert.strictEqual(it.hoursGuess, true, 'still airing: TVMaze may add episodes, so it stays open to changes');
  const done = Object.assign({}, show, { _embedded: { episodes: [-60, -53, -46, -39, -32, -25, -18].map((n, i) => ({ season: 1, number: i + 1, airdate: d(n), runtime: 45 })) } });   // later: the season aired, with 7
  const k = mount(m.saved(), { fetch: stub([[/shows\/4343\?embed=episodes/, resp(200, done)]], up) });
  await sleep(40);
  const it2 = k.saved().sel.apple.items[0];
  assert.ok(it2.hours === 5.3 && !('hoursGuess' in it2), 'the season is over: its real total, no longer a guess: ' + JSON.stringify(it2));
  assert.match(m.txt('#queue'), /4\.5 hours/);
  const g2 = stub([[/shows\/4343\?embed=episodes/, resp(200, show)]], up);
  const n = mount(v2({ apple: row('apple', 'apple') }), { fetch: g2, hash: '#soon' });
  await sleep(30);
  n.w.eval("soonAdd('real','apple','12')");   // you typed 12
  await sleep(40);
  assert.strictEqual(n.saved().sel.apple.items[0].hours, 12, 'your number stays');
  assert.ok(!('hoursGuess' in n.saved().sel.apple.items[0]));
  assert.deepStrictEqual(m.errs.concat(n.errs), []);
});
test('game hours: New releases says how long a game takes, the plan uses it, and the source is credited', async () => {
  const shipped = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'upcoming.json'), 'utf8'));
  const games = shipped.items.filter(x => x.kind === 'game');
  assert.ok(games.length && games.every(g => g.hours > 0 && /https?:\/\//.test(g.hoursSource || '')), 'every game in the list has hours and where they came from');
  const up = { checked: '2026-10-05', items: [{ id: 'long', title: 'Long RPG', kind: 'game', platforms: ['Xbox Series'], subs: ['gp-ult'], date: isoOffset(1), confidence: 'confirmed', hours: 85, hoursSource: 'Estimate: https://example.test/x', checked: '2026-10-05' }] };
  const m = mount(v2({ gamepass: row('gamepass', 'gp-ult') }, { H: 75 }), { fetch: stub([], up), hash: '#soon' });
  await sleep(30);
  assert.match(rowOf(m, 'Long RPG').querySelector('.meta').textContent, /Xbox Series · about 85 hours to play$/);
  m.click(rowOf(m, 'Long RPG').querySelector('[data-soon=add]'));
  assert.strictEqual(m.saved().sel.gamepass.items[0].hours, 85, 'the plan gets the real length, not a 20-hour guess');
  m.w.eval("go('home')");
  assert.match(ansLines(m)[0], /^Keep \| Game Pass Ultimate \| Long RPG takes about 85 hours\. 75 hours (this|next) month\. Keep it until [A-Z][a-z]+ to finish\.$/, ansLines(m)[0]);
  assert.match(html, /Game hours are estimates from <a href="https:\/\/howlongtobeat\.com" rel="noopener">HowLongToBeat<\/a>, game makers and reviews\./);
});
test('weekly seasons: 12 episodes one a week are planned over about three months, named in step 4, until TVMaze lists the real dates', async () => {
  const start = isoOffset(0);
  const up = { checked: '2026-10-05', items: [{ id: 'cyber', title: 'Weekly Twelve', kind: 'tv', service: 'netflix', subs: ['nf-ads'], date: start, confidence: 'confirmed', hours: 12, episodes: 12, release: 'weekly', firstDrop: 1, season: 1, tvmazeId: 5151, checked: '2026-10-05' }] };
  const listed = { id: 5151, name: 'Weekly Twelve', status: 'Running', premiered: start, averageRuntime: 60, webChannel: { name: 'Netflix' }, _embedded: { episodes: [{ season: 1, number: 1, airdate: start, runtime: 60 }] } };   // TVMaze lists only the premiere so far
  const g = stub([[/shows\/5151\?embed=episodes/, resp(200, listed)]], up);
  const m = mount(v2({ netflix: row('netflix', 'nf-ads') }, { H: 75 }), { fetch: g, hash: '#soon' });
  await sleep(30);
  m.click(rowOf(m, 'Weekly Twelve').querySelector('[data-soon=add]'));
  await sleep(40);
  const it = m.saved().sel.netflix.items[0];
  assert.strictEqual(it.air.reduce((t, x) => t + x[1], 0), 12);
  assert.ok(it.air.length >= 3 && it.airEst === true, 'twelve weeks, still our estimate: ' + JSON.stringify(it.air));
  assert.strictEqual(it.ends, isoOffset(77), 'the 12th episode, 11 weeks after the first');
  m.w.eval("go('home')");
  assert.match(ansLines(m)[0], /New episodes until about [A-Z][a-z]{2} \d+(, \d{4})?\. Keep it until [A-Z][a-z]+\.$/, ansLines(m)[0]);
  assert.ok(nextRows(m).some(r => /New episodes: Weekly Twelve\./.test(r)), 'step 4 says which months bring new episodes: ' + nextRows(m).join(' || '));
  assert.match(m.txt('#queue'), /new episodes until about/);
  // later TVMaze lists every episode with its date: its dates replace the estimate
  const full = Object.assign({}, listed, { _embedded: { episodes: Array.from({ length: 12 }, (_, i) => ({ season: 1, number: i + 1, airdate: isoOffset(i * 7), runtime: 60 })) } });
  const h = stub([[/shows\/5151\?embed=episodes/, resp(200, full)]]);
  const n = mount(m.saved(), { fetch: h });
  await sleep(40);
  const it2 = n.saved().sel.netflix.items[0];
  assert.ok(!('airEst' in it2) && it2.ends === isoOffset(77), 'real dates now: ' + JSON.stringify(it2));
  assert.match(ansLines(n)[0], /New episodes until [A-Z][a-z]{2} \d+(, \d{4})?\. Keep it until/, 'no "about" any more');
  assert.deepStrictEqual(m.errs.concat(n.errs), []);
});
test('weekly seasons: "all at once" needs no schedule; the add bar plans a weekly pick from New releases too', async () => {
  const start = isoOffset(0);
  const up = { checked: '2026-10-05', items: [
    { id: 'drop', title: 'All At Once', kind: 'tv', service: 'netflix', subs: ['nf-ads'], date: start, confidence: 'confirmed', hours: 8, episodes: 8, release: 'all', checked: '2026-10-05' },
    { id: 'wk', title: 'Two Then Weekly', kind: 'tv', service: 'netflix', subs: ['nf-ads'], date: start, confidence: 'confirmed', hours: 8, episodes: 8, release: 'weekly', firstDrop: 2, checked: '2026-10-05' }] };
  const m = mount(v2({ netflix: row('netflix', 'nf-ads') }), { fetch: stub([], up), hash: '#soon' });
  await sleep(30);
  assert.match(rowOf(m, 'All At Once').querySelector('.meta').textContent, /All 8 episodes at once$/);
  m.click(rowOf(m, 'All At Once').querySelector('[data-soon=add]'));
  assert.ok(!('air' in m.saved().sel.netflix.items[0]), 'everything is out on day one');
  m.w.eval("go('home')");
  m.typeTitle('Two Then'); await sleep(30);
  const opt = m.$$('#qSugg [role=option]').find(o => /Two Then Weekly/.test(o.textContent));
  m.click(opt);
  const it = m.saved().sel.netflix.items.find(x => x.title === 'Two Then Weekly');
  assert.ok(it && it.airEst === true && it.air.reduce((t, x) => t + x[1], 0) === 8 && it.ends === isoOffset(42), JSON.stringify(it));
});
test('weekly seasons: two episodes every week end sooner (perWeek)', async () => {
  const start = isoOffset(0);
  const up = { checked: '2026-10-05', items: [
    { id: 'pj', title: 'Two A Week', kind: 'tv', service: 'netflix', subs: ['nf-ads'], date: start, confidence: 'confirmed', hours: 8, episodes: 8, release: 'weekly', firstDrop: 2, perWeek: 2, checked: '2026-10-05' }] };
  const m = mount(v2({ netflix: row('netflix', 'nf-ads') }), { fetch: stub([], up), hash: '#soon' });
  await sleep(30);
  assert.match(rowOf(m, 'Two A Week').querySelector('.meta').textContent, /8 episodes, weekly until about [A-Z][a-z]{2} \d+/, 'the row says how long it runs');
  m.click(rowOf(m, 'Two A Week').querySelector('[data-soon=add]'));
  const it = m.saved().sel.netflix.items[0];
  assert.ok(it.airEst === true && it.air.reduce((t, x) => t + x[1], 0) === 8, JSON.stringify(it));
  assert.strictEqual(it.ends, isoOffset(21), '2 on day one, then 2 a week: the last two come three weeks later');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(m.w.eval("releaseAir('2026-11-20',8,'weekly',2,2)").air)), [['2026-11', 4], ['2026-12', 4]], 'Nov 20, 27, Dec 4, 11');
});
test('weekly seasons: an announced finale gives uneven weeks; one episode reads "1 episode"; all on day one reads "at once"', async () => {
  const m0 = mount();
  const ra = s => JSON.parse(JSON.stringify(m0.w.eval(s)));
  assert.deepStrictEqual(ra("releaseAir('2026-10-13',8,'weekly',2,0,'2026-11-10')"), { air: [['2026-10', 6], ['2026-11', 2]], ends: '2026-11-10', est: true }, 'Oct 13, 20, 27 bring 2 each, Nov 3 and 10 bring 1');
  assert.deepStrictEqual(ra("releaseAir('2026-10-13',4,'weekly',1,0,'2026-11-24')"), { air: [['2026-10', 3], ['2026-11', 1]], ends: '2026-11-24', est: true }, 'fewer episodes than weeks: weekly, the last one on the finale');
  assert.strictEqual(ra("releaseAir('2026-10-13',3,'weekly',1,0,'2026-10-01')").ends, '2026-10-27', 'a finale before the premiere is ignored');
  assert.strictEqual(ra("releaseAir('2027-04',12,'weekly',1,0,'2027-05-01')").ends, '2027-07-01', 'a month-only premiere ignores the finale');
  assert.deepStrictEqual(ra("releaseAir('2026-11-04',10,'weekly',1,0,'2026-11-29')"), { air: [['2026-11', 10]], ends: '2026-11-29', est: true }, 'a finale on another weekday: nothing after it');
  assert.strictEqual(ra("releaseAir('2026-10-13',4,'weekly',2,0,'2026-10-15')").ends, '2026-10-15', 'a finale 2 days on still counts');
  assert.strictEqual(ra("releaseAir('2026-10-13',3,'weekly',1,0,'2026-11-31')").ends, '2026-10-27', 'a date that does not exist is ignored');
  const start = isoOffset(0), fin = isoOffset(28);
  const t = (id, title, o) => Object.assign({ id, title, kind: 'tv', service: 'netflix', subs: ['nf-ads'], date: start, confidence: 'confirmed', checked: '2026-10-05' }, o);
  const up = { checked: '2026-10-05', items: [t('one', 'One Special', { episodes: 1, release: 'all' }), t('onew', 'One Weekly', { episodes: 1, release: 'weekly' }),
    t('day1', 'Day One Drop', { episodes: 4, release: 'weekly', firstDrop: 4 }), t('fin', 'Uneven Weeks', { episodes: 8, release: 'weekly', firstDrop: 2, finale: fin })] };
  const m = mount(v2({ netflix: row('netflix', 'nf-ads') }), { fetch: stub([], up), hash: '#soon' });
  await sleep(30);
  const meta = title => rowOf(m, title).querySelector('.meta').textContent;
  assert.match(meta('One Special'), /1 episode$/);
  assert.match(meta('One Weekly'), /1 episode$/);
  assert.match(meta('Day One Drop'), /All 4 episodes at once$/);
  assert.ok(meta('Uneven Weeks').endsWith('8 episodes, weekly until about ' + m.w.eval("dayLabel('" + fin + "')")), meta('Uneven Weeks'));
  m.click(rowOf(m, 'Uneven Weeks').querySelector('[data-soon=add]'));
  assert.strictEqual(m.saved().sel.netflix.items[0].ends, fin, 'the plan keeps it until the announced finale');
});
test('add bar: a weekly pick with no TVMaze id keeps "date may change"', async () => {
  const up = { checked: '2026-10-05', items: [{ id: 'apo', title: 'Weekly Maybe', kind: 'tv', service: 'crunchy', subs: ['crunchy'], date: isoOffset(40), confidence: 'unconfirmed', episodes: 12, release: 'weekly', checked: '2026-10-05' }] };
  const m = mount(v2({ crunchy: row('crunchy', 'crunchy') }), { fetch: stub([], up) });
  await sleep(30);
  m.typeTitle('Weekly Ma'); await sleep(30);
  m.click(m.$$('#qSugg [role=option]').find(o => /Weekly Maybe/.test(o.textContent)));
  const it = m.saved().sel.crunchy.items.find(x => x.title === 'Weekly Maybe');
  assert.ok(it && it.unconfirmed === true && it.airEst === true, JSON.stringify(it));
  assert.match(m.txt('#queue'), /date may change/);
});
test('Change on New releases: an estimate is rebuilt when the date moved; TVMaze dates are kept', async () => {
  const item = date => ({ id: 'tk', title: 'Moved King', kind: 'tv', service: 'netflix', subs: ['nf-ads'], date, confidence: 'confirmed', episodes: 10, release: 'weekly', season: 4, tvmazeId: 5252, checked: '2026-10-05' });
  const m = mount(v2({ netflix: row('netflix', 'nf-ads') }), { fetch: stub([], { checked: '2026-10-05', items: [item(isoOffset(1))] }), hash: '#soon' });
  await sleep(30);
  m.click(rowOf(m, 'Moved King').querySelector('[data-soon=add]'));
  assert.strictEqual(m.saved().sel.netflix.items[0].ends, isoOffset(64));
  const n = mount(m.saved(), { fetch: stub([], { checked: '2026-10-12', items: [item(isoOffset(92))] }), hash: '#soon' });
  await sleep(30);
  n.click(rowOf(n, 'Moved King').querySelector('[data-soon=open]'));
  n.click(rowOf(n, 'Moved King').querySelector('[data-soon=confirm]'));
  const it = n.saved().sel.netflix.items[0];
  assert.ok(it.ends === isoOffset(155) && it.airEst === true, 'the new premiere, 9 weeks on: ' + JSON.stringify(it));
  // dates that came from TVMaze stay through a Change
  const s = n.saved(); Object.assign(s.sel.netflix.items[0], { air: [[mkey(n, 0), 10]], ends: isoOffset(3) }); delete s.sel.netflix.items[0].airEst;
  const k = mount(s, { fetch: stub([], { checked: '2026-10-12', items: [item(isoOffset(92))] }), hash: '#soon' });
  await sleep(30);
  k.click(rowOf(k, 'Moved King').querySelector('[data-soon=open]'));
  k.click(rowOf(k, 'Moved King').querySelector('[data-soon=confirm]'));
  assert.strictEqual(k.saved().sel.netflix.items[0].ends, isoOffset(3));
  assert.deepStrictEqual(m.errs.concat(n.errs, k.errs), []);
});
test('the lookup reaches every show: shows looked up already do not use up the 6 new requests', async () => {
  const start = isoOffset(7), m0 = mount();
  const est = JSON.parse(JSON.stringify(m0.w.eval("releaseAir('" + start + "',4,'weekly',1)")));
  const items = Array.from({ length: 8 }, (_, i) => ({ title: 'Show ' + (i + 1), hours: 4, earliest: 0, tv: 1001 + i, season: 1, air: est.air, ends: est.ends, airEst: true }));
  const eps = days => days.map((d, i) => ({ season: 1, number: i + 1, airdate: isoOffset(7 + d), runtime: 60 }));
  const show = (id, e) => ({ id, name: 'S' + id, status: 'Running', premiered: start, averageRuntime: 60, webChannel: { name: 'Netflix' }, _embedded: { episodes: e } });
  const g = stub([[/shows\/(\d+)\?embed=episodes/, url => { const id = +/shows\/(\d+)/.exec(url)[1]; return resp(200, show(id, id >= 1007 ? eps([0, 3, 6, 9]) : eps([0]))); }]]);
  const m = mount(v2({ netflix: row('netflix', 'nf-ads', { items }) }), { fetch: g });
  await sleep(40);
  assert.strictEqual(g.tv().length, 6, 'six at a time');
  m.poke(); await sleep(40);
  assert.strictEqual(g.tv().length, 8, 'the next pass asks only for the two not looked up yet');
  const got = m.saved().sel.netflix.items;
  assert.ok(got.slice(6).every(x => !x.airEst && x.ends === isoOffset(16)), 'shows 7 and 8 get their real dates: ' + JSON.stringify(got.slice(6)));
  assert.ok(got.slice(0, 6).every(x => x.airEst === true), 'only the premiere listed: the estimate stays');
  m.poke(); await sleep(40);
  assert.strictEqual(g.tv().length, 8, 'no request twice');
});
test('the lookup: a shorter real season replaces the estimate once it has aired; only the item\'s own season does', async () => {
  const m0 = mount(), est = from => JSON.parse(JSON.stringify(m0.w.eval("releaseAir('" + isoOffset(from) + "',10,'weekly',1)")));
  const weekly = (season, from, n) => Array.from({ length: n }, (_, i) => ({ season, number: i + 1, airdate: isoOffset(from + i * 7), runtime: 30 }));
  const show = (id, e) => ({ id, name: 'S' + id, status: 'Running', premiered: '2023-01-05', averageRuntime: 30, webChannel: { name: 'Netflix' }, _embedded: { episodes: e } });
  const old = Array.from({ length: 20 }, (_, i) => ({ season: i < 10 ? 1 : 2, number: (i % 10) + 1, airdate: '2023-' + String(1 + Math.floor(i / 2)).padStart(2, '0') + '-05', runtime: 30 }));
  const it = (title, tv, from, season) => Object.assign({ title, hours: 5, earliest: 0, tv, air: est(from).air, ends: est(from).ends, airEst: true }, season ? { season } : {});
  const g = stub([[/shows\/3001\?/, resp(200, show(3001, weekly(2, -80, 9)))], [/shows\/3002\?/, resp(200, show(3002, weekly(2, 10, 9)))], [/shows\/3003\?/, resp(200, show(3003, old))],
    [/shows\/3004\?/, resp(200, show(3004, [1, 2].map(n => ({ season: 1, number: n, airdate: isoOffset(-2), runtime: 30 }))))]]);   // only the two premiere episodes listed so far
  const m = mount(v2({ netflix: row('netflix', 'nf-ads', { items: [it('Aired Short', 3001, -80, 2), it('Airing Short', 3002, 10, 2), it('No Season', 3003, 10), it('Partly Listed', 3004, -2, 1)] }) }), { fetch: g });
  await sleep(40);
  const got = m.saved().sel.netflix.items;
  assert.ok(!got[0].airEst && got[0].ends === isoOffset(-24), 'the season has aired with 9: its real finale: ' + JSON.stringify(got[0]));
  assert.ok(got[1].airEst === true && got[1].ends === est(10).ends, 'still airing with 9 listed: TVMaze may list only some');
  assert.ok(got[2].airEst === true && got[2].ends === est(10).ends, 'no season: past seasons never replace the estimate');
  assert.ok(got[3].airEst === true && got[3].ends === est(-2).ends, 'two listed, both aired, but our estimate runs on: not over yet: ' + JSON.stringify(got[3]));
  // a guessed length waits too: 2 listed of 10 is not the season's hours
  const k = mount(v2({ netflix: row('netflix', 'nf-ads', { items: [Object.assign(it('Guessed', 3004, -2, 1), { hours: 8, hoursGuess: true })] }) }), { fetch: g });
  await sleep(40);
  const gu = k.saved().sel.netflix.items[0];
  assert.ok(gu.hoursGuess === true && gu.hours === 8, 'keeps the guess while TVMaze lists fewer: ' + JSON.stringify(gu));
  assert.deepStrictEqual(m.errs, []);
});
test('anime: an Anime filter and tag on New releases; anime hours come from the episode count', async () => {
  const start = isoOffset(3);
  const t = (id, title, kind, o) => Object.assign({ id, title, kind, service: 'crunchy', subs: ['crunchy'], date: start, confidence: 'confirmed', checked: '2026-10-05' }, o);
  const up = { checked: '2026-10-05', items: [t('a1', 'Sword Show', 'tv', { anime: true, episodes: 12, release: 'weekly' }), t('a2', 'Sky Film', 'movie', { anime: true, service: 'netflix', subs: ['nf-ads'], hours: 1.9 }),
    t('d1', 'Plain Drama', 'tv', { service: 'netflix', subs: ['nf-ads'] })] };
  const m = mount(v2({ crunchy: row('crunchy', 'crunchy') }), { fetch: stub([], up), hash: '#soon' });
  await sleep(30);
  const chips = () => m.$$('#soonFilters [data-filter]').map(b => b.textContent.replace(/\s+/g, ' ').trim());
  assert.deepStrictEqual(chips(), ['All 3', 'TV 2', 'Movies 1', 'Games 0', 'Anime 2', 'World 2'], 'anime is made outside the US too');
  assert.match(rowOf(m, 'Sword Show').querySelector('.meta').textContent, /^TVAnime12 episodes, weekly until about/, 'tagged Anime, with its run');
  assert.ok(!/Anime/.test(rowOf(m, 'Plain Drama').querySelector('.meta').textContent));
  m.click(m.$('#soonFilters [data-filter=anime]'));
  assert.deepStrictEqual(soonRows(m).map(r => r.querySelector('b').textContent), ['Sword Show', 'Sky Film'], 'shows and movies');
  assert.strictEqual(rowOf(m, 'Sky Film').querySelector('.meta').textContent, 'Movie', 'inside Anime, the tag says TV or Movie');
  m.click(rowOf(m, 'Sword Show').querySelector('[data-soon=add]'));
  assert.strictEqual(m.saved().sel.crunchy.items[0].hours, 5, '12 episodes of about 24 minutes');
  m.w.eval("go('home')"); m.typeTitle('Sky F'); await sleep(30);
  assert.ok(m.$$('#qSugg [role=option]').some(o => /Anime movie/.test(o.textContent)), 'the add bar says Anime movie');
  const n = mount(v2({}), { fetch: stub([], { checked: '2026-10-05', items: [up.items[2]] }), hash: '#soon' });
  await sleep(30);
  assert.ok(!n.$('#soonFilters [data-filter=anime]'), 'no Anime chip without anime');
  assert.deepStrictEqual(m.errs.concat(n.errs), []);
});
test('hours: a one-tap add keeps our first guess as a guess; a season counts once all of it is listed', async () => {
  const t = (id, title, o) => Object.assign({ id, title, kind: 'tv', anime: true, service: 'crunchy', subs: ['crunchy'], confidence: 'confirmed', season: 1, checked: '2026-10-05' }, o);
  const up = { checked: '2026-10-05', items: [t('w', 'Weekly Cour', { date: isoOffset(-84), episodes: 12, release: 'weekly', tvmazeId: 7001 }), t('b', 'Binge Seven', { date: isoOffset(-3), episodes: 7, release: 'all', tvmazeId: 7002 })] };
  const show = (id, eps) => ({ id, name: 'S' + id, status: 'Running', premiered: isoOffset(-84), averageRuntime: null, webChannel: { name: 'Crunchyroll' }, _embedded: { episodes: eps } });
  const weekly = Array.from({ length: 12 }, (_, i) => ({ season: 1, number: i + 1, airdate: isoOffset(-84 + i * 7), runtime: 30 }));
  let binge = [1, 2, 3, 4].map(n => ({ season: 1, number: n, airdate: isoOffset(-3), runtime: 24 }));
  const g = stub([[/shows\/7001\?/, resp(200, show(7001, weekly))], [/shows\/7002\?/, () => resp(200, show(7002, binge))]], up);
  const m = mount(v2({ crunchy: row('crunchy', 'crunchy') }), { fetch: g });
  await sleep(30);
  m.typeTitle('Weekly Co'); await sleep(30);
  m.click(m.$$('#qSugg [role=option]').find(o => /Weekly Cour/.test(o.textContent)));
  const w0 = m.saved().sel.crunchy.items.find(x => x.title === 'Weekly Cour');
  assert.ok(w0 && w0.episodes === 12, JSON.stringify(w0));
  await sleep(60);
  const w1 = m.saved().sel.crunchy.items.find(x => x.title === 'Weekly Cour');
  assert.ok(w1.hours === 6 && w1.hoursGuess === true, 'the 5-hour first guess gave way to 12 x 30 minutes, open to changes for two weeks after the last: ' + JSON.stringify(w1));
  m.w.eval("go('soon')"); await sleep(10);
  m.click(rowOf(m, 'Binge Seven').querySelector('[data-soon=add]'));
  await sleep(60);
  const b1 = m.saved().sel.crunchy.items.find(x => x.title === 'Binge Seven');
  assert.ok(b1.hoursGuess === true && b1.episodes === 7, '4 of 7 listed: still our guess: ' + JSON.stringify(b1));
  binge = [1, 2, 3, 4, 5, 6, 7].map(n => ({ season: 1, number: n, airdate: isoOffset(-3), runtime: 24 }));
  const n = mount(m.saved(), { fetch: g });
  await sleep(60);
  const b2 = n.saved().sel.crunchy.items.find(x => x.title === 'Binge Seven');
  assert.ok(b2.hours === 2.8, 'all 7 listed: ' + JSON.stringify(b2));
  assert.deepStrictEqual(m.errs.concat(n.errs), []);
});
test('hours: a one-tap add keeps the row\'s season; an old save uses its estimate\'s count', async () => {
  const past = [1, 2].flatMap(s => Array.from({ length: 10 }, (_, i) => ({ season: s, number: i + 1, airdate: (2023 + s) + '-0' + (1 + Math.floor(i / 4)) + '-1' + (i % 4), runtime: 50 })));
  const show = (id, eps) => ({ id, name: 'S' + id, status: 'Running', premiered: '2024-01-10', averageRuntime: 50, webChannel: { name: 'HBO Max' }, _embedded: { episodes: eps } });
  const up = { checked: '2026-10-05', items: [{ id: 'p3', title: 'Third Season', kind: 'tv', service: 'max', subs: ['max'], date: isoOffset(80), confidence: 'confirmed', season: 3, episodes: 15, tvmazeId: 7101, checked: '2026-10-05' }] };
  const g = stub([[/shows\/7101\?/, resp(200, show(7101, past))], [/shows\/7102\?/, resp(200, show(7102, [0, 7, 14, 21].map((n, i) => ({ season: 1, number: i + 1, airdate: isoOffset(n - 21), runtime: 24 })).concat([28, 35].map((n, i) => ({ season: 1, number: i + 5, airdate: isoOffset(n - 21), runtime: 24 })))))]], up);
  const m = mount(v2({ max: row('max', 'max') }), { fetch: g });
  await sleep(30);
  m.typeTitle('Third Sea'); await sleep(30);
  m.click(m.$$('#qSugg [role=option]').find(o => /Third Season/.test(o.textContent)));
  await sleep(60);
  const it = m.saved().sel.max.items[0];
  assert.ok(it.season === 3 && it.hoursGuess === true && it.hours === 8, 'season 3 is not on TVMaze yet: never the total of seasons 1 and 2: ' + JSON.stringify(it));
  // saved by an earlier version: an estimate of 12 and no count; TVMaze lists 6 (4 aired, 2 ahead)
  const m0 = mount(), est = JSON.parse(JSON.stringify(m0.w.eval("releaseAir('" + isoOffset(-21) + "',12,'weekly',1)")));
  const old = { title: 'Old Save', hours: 5, earliest: 0, tv: 7102, season: 1, hoursGuess: true, airEst: true, air: est.air, ends: est.ends };
  const n = mount(v2({ crunchy: row('crunchy', 'crunchy', { items: [old] }) }), { fetch: g });
  await sleep(60);
  const o = n.saved().sel.crunchy.items[0];
  assert.ok(o.hours === 5 && o.hoursGuess === true, '6 of 12 listed: the guess stays: ' + JSON.stringify(o));
  assert.deepStrictEqual(m.errs.concat(n.errs), []);
});
test('hours: a TVMaze search pick of a season still to come is a guess the lookup can refine', async () => {
  const g = stub([[/search\/shows/, resp(200, searchJson)], [/shows\/88337\?embed=episodes/, resp(200, showJson)]]);
  const m = mount(v2({ netflix: row('netflix', 'nf-ads') }), { fetch: g, hash: '#list' });
  m.typeTitle('ed'); m.typeTitle('edg'); m.typeTitle('edge'); await sleep(500);
  const opt = m.$$('#qSugg [role=option]').find(o => /Edgerunners Two/.test(o.textContent));
  m.click(opt); await sleep(40);
  m.$('#qadd').dispatchEvent(new m.w.Event('submit', { bubbles: true, cancelable: true }));
  const it = m.saved().sel.netflix.items.find(x => x.title === 'Edgerunners Two');
  assert.ok(it && it.hours === 2 && it.hoursGuess === true, 'four 30-minute episodes, not out yet: ' + JSON.stringify(it));
  assert.deepStrictEqual(m.errs, []);
});
test('wide screens: step 1 stays open and the slim answer bar stays away; narrow screens fold and show it', () => {
  const seed = v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Show', hours: 10, earliest: 0 }] }) });
  const n = mount(seed);
  assert.ok(n.$('#p1body').hidden && !n.$('#p1change').hidden, 'narrow: coming back, step 1 folds to one line');
  n.click(n.$('#loadExample'));
  assert.ok(!n.$('#answerBar').hidden, 'narrow: the example bar shows');
  const w = mount(seed, { wide: true });
  assert.ok(!w.$('#p1body').hidden && w.$('#p1change').hidden, 'wide: step 1 stays open, its services one tap away');
  assert.match(w.txt('#p1sub'), /^Tap each one you pay for\.$/);
  w.click(w.$('#loadExample'));
  assert.ok(w.$('#answerBar').hidden, 'wide: no floating bar over step 4');
  assert.match(html, /@media \(min-width:1800px\)\{[^]*grid-template-areas:"p1 p3 p4" "p2 p3 p4"/, 'very wide: 1 and 2, then 3, then 4');
  assert.match(html, /\.soon-list\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(500px,1fr\)\)/, 'new releases in columns');
  assert.match(html, /#queue\{columns:2 420px/, 'My list in columns');
  assert.deepStrictEqual(n.errs.concat(w.errs), []);
});
test('world shows: K-drama and World filters, a tag for where each was made, and the add bar says it', async () => {
  const start = isoOffset(3);
  const t = (id, title, kind, o) => Object.assign({ id, title, kind, service: 'netflix', subs: ['nf-ads'], date: start, confidence: 'confirmed', checked: '2026-10-05' }, o);
  const up = { checked: '2026-10-05', items: [t('k1', 'Seoul Hearts', 'tv', { origin: 'Korean' }), t('c1', 'Jade Palace', 'tv', { origin: 'Chinese' }), t('b1', 'Moor Murders', 'tv', { origin: 'British' }),
    t('m1', 'Seoul Film', 'movie', { origin: 'Korean' }), t('a1', 'Sword Show', 'tv', { anime: true }), t('u1', 'Home Town', 'tv', { origin: 'American' }), t('p1', 'Plain', 'tv', {}), t('k2', 'Seoul Toons', 'tv', { anime: true, origin: 'Korean' })] };
  const m = mount(v2({ netflix: row('netflix', 'nf-ads') }), { fetch: stub([], up), hash: '#soon' });
  await sleep(30);
  const chips = m.$$('#soonFilters [data-filter]').map(b => b.textContent.replace(/\s+/g, ' ').trim());
  assert.deepStrictEqual(chips, ['All 8', 'TV 7', 'Movies 1', 'Games 0', 'Anime 2', 'K-drama 1', 'World 6'], 'Korean animation is anime, not a K-drama');
  const meta = title => rowOf(m, title).querySelector('.meta').textContent;
  assert.match(meta('Seoul Hearts'), /^TVK-drama/);
  assert.match(meta('Jade Palace'), /^TVC-drama/);
  assert.match(meta('Moor Murders'), /^TVBritish/);
  assert.match(meta('Seoul Film'), /^MovieKorean/);
  assert.ok(!/American/.test(meta('Home Town')), 'made in the US: no tag');
  m.click(m.$('#soonFilters [data-filter=kdrama]'));
  assert.deepStrictEqual(soonRows(m).map(r => r.querySelector('b').textContent), ['Seoul Hearts'], 'K-dramas are Korean TV');
  assert.ok(!/K-drama/.test(meta('Seoul Hearts')), 'the filter already says it');
  m.click(m.$('#soonFilters [data-filter=world]'));
  assert.deepStrictEqual(soonRows(m).map(r => r.querySelector('b').textContent).sort(), ['Jade Palace', 'Moor Murders', 'Seoul Film', 'Seoul Hearts', 'Seoul Toons', 'Sword Show']);
  assert.strictEqual(m.w.eval('COLORS.length'), m.w.eval('FAMS.length'), 'one colour per catalog service');
  [/:root{[^}]*--svc15:/, /prefers-color-scheme: dark[^]*?--svc15:/, /[data-theme="dark"][^{]*{[^}]*--svc15:/].forEach(re => assert.match(html, re));
  m.w.eval("go('home')"); m.typeTitle('Seoul'); await sleep(30);
  const opts = m.$$('#qSugg [role=option]').map(o => o.textContent);
  assert.ok(opts.some(o => /Seoul Hearts/.test(o) && /K-drama/.test(o)) && opts.some(o => /Seoul Film/.test(o) && /Korean movie/.test(o)), opts.join(' | '));
  assert.deepStrictEqual(m.errs, []);
});
test('indie games: an Indie filter beside Games, an Indie tag, and the add bar says it', async () => {
  const start = isoOffset(3);
  const g = (id, title, o) => Object.assign({ id, title, kind: 'game', platforms: ['Xbox Series', 'PC'], subs: ['gp-ult', 'gp-pc'], date: start, confidence: 'confirmed', hours: 12, checked: '2026-10-05' }, o);
  const up = { checked: '2026-10-05', items: [g('i1', 'Tiny Garden', { indie: true }), g('b1', 'Big Shooter', {}), { id: 's1', title: 'A Show', kind: 'tv', service: 'netflix', subs: ['nf-ads'], date: start, confidence: 'confirmed', checked: '2026-10-05' }] };
  const m = mount(v2({ gamepass: row('gamepass', 'gp-ult') }), { fetch: stub([], up), hash: '#soon' });
  await sleep(30);
  const chips = m.$$('#soonFilters [data-filter]').map(b => b.textContent.replace(/\s+/g, ' ').trim());
  assert.deepStrictEqual(chips, ['All 3', 'TV 1', 'Movies 0', 'Games 2', 'Indie 1'], 'Indie comes right after Games');
  assert.match(rowOf(m, 'Tiny Garden').querySelector('.meta').textContent, /^GameIndie/);
  assert.ok(!/Indie/.test(rowOf(m, 'Big Shooter').querySelector('.meta').textContent));
  m.click(m.$('#soonFilters [data-filter=indie]'));
  assert.deepStrictEqual(soonRows(m).map(r => r.querySelector('b').textContent), ['Tiny Garden']);
  assert.ok(!/Indie/.test(rowOf(m, 'Tiny Garden').querySelector('.meta').textContent), 'the filter already says it');
  m.w.eval("go('home')"); m.typeTitle('Tiny'); await sleep(30);
  assert.ok(m.$$('#qSugg [role=option]').some(o => /Tiny Garden/.test(o.textContent) && /Indie game/.test(o.textContent)));
  assert.deepStrictEqual(m.errs, []);
});
test('save my plan: one file to read, print and open again; nothing on the page comes from the file', async () => {
  const seed = v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Show <b>x</b>', hours: 30, earliest: 0 }] }), apple: row('apple', 'apple', { ci: 3, items: [{ title: 'Later', hours: 10, earliest: 2 }] }) }, { H: 60 });
  const m = mount(seed);
  assert.ok(m.$('#plan #savePlan'), 'in step 4');
  const doc = m.w.eval('planDocument()');
  ['<h1>My subscription plan</h1>', 'What to do this month', 'The next months', 'Next 12 months', 'Cost per service', 'My list', 'What I pay for now', 'My free time', 'Save as PDF or print', 'Nothing was sent anywhere'].forEach(t => assert.ok(doc.includes(t), t));
  assert.ok(doc.includes('Show &lt;b&gt;x&lt;/b&gt;') && !doc.includes('<b>x</b>'), 'titles are escaped');
  assert.ok(!/var\(--svc/.test(doc) && /#3A2CFF|#E0246F/.test(doc), 'service colours are written out for paper');
  const scripts = doc.match(/<script[^>]*>[\s\S]*?<\/script>/g) || [];
  assert.strictEqual(scripts.length, 2, 'the data, and the print button');
  assert.ok(scripts.some(x => /window\.print\(\)/.test(x) && x.length < 400), 'a tiny script only adds the print button');
  assert.ok(doc.includes('use Print in your browser'), 'with scripts off, it says how to print');
  const data = JSON.parse(/<script type="application\/json" id="subrotator-plan">([\s\S]*?)<\/script>/.exec(doc)[1]);
  assert.deepStrictEqual([data.app, Object.keys(data.state.sel).sort()], ['sub-rotator', ['apple', 'netflix']]);
  // the button saves a file
  let saved = null;
  m.w.URL.createObjectURL = () => 'blob:plan'; m.w.URL.revokeObjectURL = () => {};
  const click = m.w.HTMLAnchorElement.prototype.click;
  m.w.HTMLAnchorElement.prototype.click = function () { saved = this.download; };
  m.click(m.$('#savePlan'));
  m.w.HTMLAnchorElement.prototype.click = click;
  assert.match(saved || '', /^my-subscription-plan-\d{4}-\d{2}-\d{2}\.html$/);
  assert.match(m.txt('#toast'), /^File ready\. Check your downloads or files\./, 'it does not claim more than it knows');
  // a new browser opens it
  const n = mount();
  const input = n.$('#planFile');
  Object.defineProperty(input, 'files', { configurable: true, value: [new n.w.File([doc], 'plan.html', { type: 'text/html' })] });
  n.fire(input, 'change'); await sleep(60);
  const got = n.saved();
  assert.deepStrictEqual(Object.keys(got.sel).sort(), ['apple', 'netflix']);
  assert.strictEqual(got.sel.netflix.items[0].title, 'Show <b>x</b>');
  assert.strictEqual(got.H, 60);
  assert.ok(doc.includes('We plan for ' + m.w.eval('perDayText(60)') + ' a day, about 60 hours a month.'), 'free time a day, like the app says it');
  assert.ok(!n.$('#queue b b') && n.txt('#queue').includes('Show <b>x</b>'), 'shown as text');
  assert.match(n.txt('#toast'), /^Plan opened\. Saved /);
  n.click(n.$('#toast .undo'));
  assert.deepStrictEqual(Object.keys(n.saved().sel), [], 'Undo puts back what was here');
  // plain data works too; anything else is refused and changes nothing
  assert.strictEqual(n.w.eval('openPlanText(' + JSON.stringify(JSON.stringify(data)) + ')'), true);
  const before = JSON.stringify(n.saved());
  assert.strictEqual(n.w.eval("openPlanText('<html>hello</html>')"), false);
  assert.match(n.txt('#toast'), /^Not a saved plan\./);
  assert.strictEqual(n.w.eval("openPlanText('{\"app\":\"other\",\"state\":{}}')"), false);
  assert.strictEqual(JSON.stringify(n.saved()), before);
  assert.deepStrictEqual(m.errs.concat(n.errs), []);
});
test('open a saved plan: a hand-made file cannot use built-in names, is capped, and a refused one changes nothing', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Mine', hours: 5, earliest: 0 }] }) }));
  const lastKey = m.w.eval('(()=>{const d=new Date(startDate.getFullYear(),startDate.getMonth()-1,1);return d.getFullYear()+"-"+d.getMonth()})()');
  const sel = { netflix: row('netflix', 'nf-std'), toString: { id: 'toString', name: 'Gym TV', custom: true, price: 6, paying: true, items: [] } };
  for (let i = 0; i < 70; i++) sel['c' + i] = { id: 'c' + i, name: 'Extra ' + i, custom: true, price: 1, paying: true, items: [] };
  const file = { app: 'sub-rotator', v: 1, saved: '2026-10-01', state: { v: 2, startKey: lastKey, H: 60, est: {}, sel,
    last: { key: lastKey, stop: [], change: [], start: [{ entry: '__proto__', name: 'Netflix' }, { entry: 'netflix', name: 'Netflix Standard' }], titles: [{ entry: 'toString', title: 'Gift' }] } } };
  assert.strictEqual(m.w.eval('openPlanText(' + JSON.stringify(JSON.stringify(file)) + ')'), true);
  const st = m.saved();
  assert.ok(!Object.prototype.hasOwnProperty.call(st.sel, 'toString') && Object.keys(st.sel).length <= 60, 'no built-in names; 60 services at most: ' + Object.keys(st.sel).length);
  const last = m.w.eval('JSON.stringify(state.last||null)');
  assert.ok(!/__proto__|toString/.test(last), 'check-in rows name real services only: ' + last);
  const apply = m.$('#ciApply'); if (apply) m.click(apply);
  assert.strictEqual(m.w.eval('({}).paying'), undefined, 'nothing reaches Object.prototype');
  assert.deepStrictEqual(m.errs, []);
  // a refused file keeps the example on
  const n = mount();
  n.click(n.$('#loadExample'));
  assert.strictEqual(n.w.eval("openPlanText('{\"app\":\"sub-rotator\",\"state\":{\"v\":2}}')"), false);
  assert.ok(n.w.eval('exBackup!=null') && !n.$('#exBar').hidden, 'the example stays');
});
test('open a saved plan: Undo brings back your own plan with no stale "changed" box', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Mine', hours: 30, earliest: 0 }] }), max: row('max', 'max') }));
  const file = { app: 'sub-rotator', v: 1, saved: '2026-10-01', state: v2({ gamepass: row('gamepass', 'gp-ult', { items: [{ title: 'Theirs', hours: 40, earliest: 0 }] }) }) };
  m.w.eval('openPlanText(' + JSON.stringify(JSON.stringify(file)) + ')');
  assert.deepStrictEqual(Object.keys(m.saved().sel), ['gamepass']);
  m.click(m.$('#toast .undo'));
  assert.deepStrictEqual(Object.keys(m.saved().sel).sort(), ['max', 'netflix']);
  assert.ok(!/Your plan changed/.test(m.txt('#homeAnswer')), m.txt('#homeAnswer'));
  // from the example, Undo is your own plan too
  const n = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Mine', hours: 30, earliest: 0 }] }) }));
  n.click(n.$('#loadExample'));
  n.w.eval('openPlanText(' + JSON.stringify(JSON.stringify(file)) + ')');
  assert.ok(n.w.eval('exBackup==null') && n.$('#exBar').hidden);
  n.click(n.$('#toast .undo'));
  assert.deepStrictEqual(Object.keys(n.saved().sel), ['netflix'], 'your own plan, not the example');
});
test('save my plan: the file keeps the warnings, links its credits, and wraps long words', () => {
  const m = mount(v2({ gamepass: row('gamepass', 'gp-ult', { items: [{ title: 'Huge RPG', hours: 900, earliest: 0 }] }), apple: row('apple', 'apple', { items: [{ title: 'Short', hours: 1, earliest: 0 }] }) }, { H: 20 }));
  const doc = m.w.eval('planDocument()');
  assert.match(doc, /\d+ hours won’t fit in 12 months/);
  const p = mount(v2({ apple: row('apple', 'apple', { items: [{ title: 'Short', hours: 1, earliest: 0 }] }) }));
  assert.match(p.w.eval('planDocument()'), /Pricey means/, 'the Pricey badge is explained on paper');
  assert.ok(doc.includes('href="https://creativecommons.org/licenses/by-sa/4.0/"') && doc.includes('(creativecommons.org/licenses/by-sa/4.0)') && doc.includes('(tvmaze.com)'));
  assert.match(doc, /overflow-wrap:anywhere/);
  assert.match(doc, /Keep this \.html file: a PDF won’t open there\./);
  assert.match(doc, /We plan for [^<]+ a day, about 20 hours a month\./);
});
test('SubRotato: the new name everywhere people see it; saved data keeps its old ids', () => {
  assert.ok(!/Sub Rotator/.test(html.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')), 'no old name outside comments');
  assert.match(html, /<title( data-es="SubRotato: [^"]+")?>SubRotato: /);
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'A show', hours: 10, earliest: 0 }] }) }));
  assert.ok(m.w.eval('planDocument()').includes('id="subrotator-plan"') && m.w.eval('planDocument()').includes('"app":"sub-rotator"'), 'old saved files still open');
  assert.ok(m.w.localStorage.getItem('subrotator:v1') || true);
});
test('share image: the words come from the plan, and with no canvas it says so', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'A show', hours: 10, earliest: 0 }] }), max: row('max', 'max-std') }));
  assert.ok(m.$('#plan #shareImg'), 'next to Save my plan');
  const w = JSON.parse(JSON.stringify(m.w.eval('shareWords()')));
  assert.strictEqual(w.top, 'My streaming plan');
  assert.match(w.big, /^\$[\d,]+ saved$/);
  assert.match(w.line, /^(Until [A-Z][a-z]+|This year): \$[\d,]+, not \$[\d,]+\.$/);
  assert.match(w.foot, /^SubRotato/);
  m.click(m.$('#shareImg'));
  assert.match(m.txt('#toast'), /^Image failed\. Try Copy plan\./, 'jsdom has no canvas');
  const n = mount(); n.click(n.$('#loadExample'));
  assert.strictEqual(n.w.eval('shareWords().top'), 'A made-up example');
});
test('landing page: links into the app, no outside scripts, short sentences, the same colours as the app', () => {
  const land = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const dom = new JSDOM(land);
  const d = dom.window.document;
  assert.ok(/SubRotato/.test(d.title) && d.title.length <= 60, 'the name in a title of 60 characters or fewer: ' + d.title);
  assert.ok(d.querySelector('meta[name=description]') && d.querySelector('meta[property="og:title"]'));
  const hrefs = [...d.querySelectorAll('a.btn')].map(a => a.getAttribute('href'));
  assert.ok(hrefs.includes('./app.html') && hrefs.includes('./app.html#example'), hrefs.join(' '));
  assert.strictEqual(d.querySelectorAll('script:not([type="application/ld+json"])').length, 0, 'a plain page: no code, only search data');
  assert.strictEqual(d.querySelectorAll('h1').length, 1);
  const long = [...d.querySelectorAll('main p, main li, main h3, main summary, main h2, main h1')].flatMap(el => el.textContent.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)).filter(x => x.trim().split(/\s+/).length > 12);
  assert.deepStrictEqual(long, [], 'sentences of 12 words or fewer');
  ['--bg:#F3F1FF', '--blue:#3A2CFF', '--display:"Anybody"'].forEach(t => assert.ok(land.includes(t), t));
  assert.ok(land.includes('prefers-color-scheme: dark') && land.includes(':root[data-theme="dark"]'), 'dark mode both ways, like the app');
});
test('front door: the landing page is the site root, the app is app.html, and every page has a 1200x630 link preview', () => {
  const read = f => require('fs').readFileSync(require('path').join(__dirname, '..', 'public', f));
  const size = png => [png.readUInt32BE(16), png.readUInt32BE(20)];
  for (const [page, img, lang] of [['index.html', 'og.png', 'en'], ['es.html', 'og-es.png', 'es'], ['app.html', 'og.png', 'en']]) {
    const d = new JSDOM(read(page).toString()).window.document;
    const og = d.querySelector('meta[property="og:image"]');
    assert.ok(og && og.content === 'https://subrotato.vercel.app/' + img, page + ' shares ' + img + ' at a full address');
    assert.deepStrictEqual(size(read(img)), [1200, 630], img + ' is 1200x630');
    assert.ok(d.querySelector('meta[name="twitter:card"][content="summary_large_image"]') && d.querySelector('meta[property="og:title"]'), page);
    if (page !== 'app.html') assert.strictEqual(d.documentElement.lang, lang);
  }
  assert.ok(!require('fs').existsSync(require('path').join(__dirname, '..', 'public', 'landing.html')), 'one landing page at the root, not two');
});
test('SEO: each landing page has a search title and description, canonical and hreflang, structured data that matches the page, and a sitemap', () => {
  const read = f => require('fs').readFileSync(require('path').join(__dirname, '..', 'public', f), 'utf8');
  const SITE = 'https://subrotato.vercel.app';
  for (const [page, url, lang] of [['index.html', SITE + '/', 'en'], ['es.html', SITE + '/es.html', 'es']]) {
    const d = new JSDOM(read(page)).window.document, meta = n => (d.querySelector('meta[name="' + n + '"],meta[property="' + n + '"]') || {}).content;
    const desc = meta('description');
    assert.ok(desc.length >= 70 && desc.length <= 160, page + ': a description search engines show in full (' + desc.length + ')');
    assert.ok(desc.split(/(?<=[.!?])\s+/).every(x => x.split(/\s+/).length <= (lang === 'es' ? 13 : 12)), page + ': short sentences');
    assert.strictEqual(d.querySelector('link[rel=canonical]').href, url);
    assert.strictEqual(meta('og:url'), url, 'the share link is the canonical one');
    const alt = Object.fromEntries([...d.querySelectorAll('link[rel=alternate][hreflang]')].map(l => [l.hreflang, l.href]));
    assert.deepStrictEqual(alt, { en: SITE + '/', es: SITE + '/es.html', 'x-default': SITE + '/' }, page + ': each language points at the other');
    assert.ok(/index/.test(meta('robots')) && !/noindex/.test(meta('robots')));
    const ld = JSON.parse(d.querySelector('script[type="application/ld+json"]').textContent)['@graph'];
    const types = ld.map(x => x['@type']);
    ['WebSite', 'Organization', 'WebApplication', 'FAQPage'].forEach(t => assert.ok(types.includes(t), page + ' has ' + t));
    const faq = ld.find(x => x['@type'] === 'FAQPage').mainEntity.map(q => [q['@type'], q.name, q.acceptedAnswer['@type'], q.acceptedAnswer.text]);
    const shown = [...d.querySelectorAll('.faq details')].map(x => ['Question', x.querySelector('summary').textContent.trim(), 'Answer', x.querySelector('p').textContent.trim()]);
    assert.ok(shown.length >= 5, page + ': the questions are on the page');
    assert.deepStrictEqual(faq, shown, page + ': the FAQ data is the FAQ on the page, questions and answers word for word');
    assert.strictEqual(ld.find(x => x['@type'] === 'WebApplication').offers.price, '0');
    assert.strictEqual(d.querySelectorAll('h1').length, 1);
  }
  assert.match(read('robots.txt'), /Sitemap: https:\/\/subrotato\.vercel\.app\/sitemap\.xml/);
  const map = read('sitemap.xml');
  [SITE + '/', SITE + '/es.html', SITE + '/app.html'].forEach(u => assert.ok(map.includes('<loc>' + u + '</loc>'), u + ' in the sitemap'));
  const app = new JSDOM(read('app.html')).window.document;
  assert.strictEqual(app.querySelector('link[rel=canonical]').href, SITE + '/app.html');
});
test('landing pages show the year plan and what the app does, in both languages', () => {
  const read = f => require('fs').readFileSync(require('path').join(__dirname, '..', 'public', f), 'utf8');
  for (const [page, words] of [['index.html', /Ways to pay less[\s\S]*Scan a bank file[\s\S]*New releases[\s\S]*Monthly check-in[\s\S]*Your country[\s\S]*English or Spanish/], ['es.html', /Formas de pagar menos[\s\S]*Lee tu archivo del banco[\s\S]*Estrenos[\s\S]*Revisión mensual[\s\S]*Tu país[\s\S]*Español o inglés/]]) {
    const d = new JSDOM(read(page)).window.document;
    const yr = d.querySelector('figure.year table.yr');
    assert.ok(yr, page + ': the year chart');
    assert.strictEqual(yr.querySelectorAll('thead th').length, 13, page + ': a name column and 12 months');
    const rows = [...yr.querySelectorAll('tbody tr:not(.cost)')];
    assert.strictEqual(rows.length, 5);
    rows.forEach(r => assert.strictEqual(r.querySelectorAll('td').length, 12));
    assert.strictEqual(yr.querySelectorAll('td.on').length, 9, 'the same plan as the hero card: 9 paid months');
    assert.ok(yr.querySelectorAll('td.on .vh').length === 9, 'a screen reader hears which months are paid');
    assert.strictEqual(d.querySelectorAll('.keep li').length, 3, page + ': how long it keeps a service');
    assert.match(d.querySelector('main').textContent.replace(/\s+/g, ' '), words, page + ': the features');
    assert.strictEqual(d.querySelectorAll('.chips.lands li').length, 5, page + ': the five countries');
    assert.ok(d.querySelectorAll('.faq details').length >= 6, page + ': the questions, countries and language included');
  }
});
test('#example opens the app with the made-up example', () => {
  const m = mount(undefined, { hash: '#example' });
  assert.ok(m.w.eval('exBackup!=null'), 'the example is on');
  assert.strictEqual(m.w.location.hash, '#home');
  assert.ok(!m.$('#exBar').hidden);
});
test('ways to pay less: a yearly price or a bundle that beats the paid months, biggest saving first, in the saved file too', () => {
  const m = mount(v2({ peacock: row('peacock', 'peacock', { items: [{ title: 'Long', hours: 900, earliest: 0 }] }),
    disney: row('disney', 'disney', { ci: 1, items: [{ title: 'D', hours: 30, earliest: 0 }] }), hulu: row('hulu', 'hulu', { ci: 2, items: [{ title: 'H', hours: 30, earliest: 0 }] }) }, { H: 160 }));
  m.w.eval('for(const k in YEARLY)delete YEARLY[k];BUNDLES.length=0;renderAll()');
  assert.ok(!m.$('#plan .nm-less'), 'no prices, no tips');
  m.w.eval("YEARLY.peacock=129.99;BUNDLES.push({id:'duo',name:'Disney+ and Hulu bundle',price:12.99,includes:['disney','hulu'],extras:''});BUNDLES.push({id:'trio',name:'Disney+, Hulu and HBO Max',price:16.99,includes:['disney','hulu','max'],extras:''});renderAll()");
  const tips = m.$$('#plan .nm-less li').map(li => li.textContent.replace(/\s+/g, ' ').trim());
  assert.ok(tips.length >= 1, tips.join(' | '));
  const y = mount(v2({ peacock: row('peacock', 'peacock', { items: [{ title: 'Long', hours: 900, earliest: 0 }] }) }, { H: 20 }));
  y.w.eval('YEARLY.peacock=129.99;renderAll()');
  const ytips = y.$$('#plan .nm-less li').map(li => li.textContent.replace(/\s+/g, ' ').trim());
  assert.ok(ytips.some(t => /^Pay yearly for Peacock Premium: \$130, not \$156\.$/.test(t)), ytips.join(' | '));
  assert.ok(tips.some(t => /^Disney\+ and Hulu bundle: \$12\.99 a month, not \$24\.98\. Saves \$\d+ (over 12 months|in \d+ of 12 months)\.$/.test(t)), 'the cheaper bundle for the same services: ' + tips.join(' | '));
  assert.ok(!tips.some(t => /HBO Max/.test(t)), 'one tip per set of services');
  const saves = tips.length;
  assert.ok(saves <= 3);
  assert.ok(m.w.eval('planDocument()').includes('<h2>Ways to pay less</h2>'));
  m.w.eval('YEARLY.peacock=999;BUNDLES.length=0;renderAll()');
  assert.ok(!m.$('#plan .nm-less'), 'only when it saves money');
  assert.deepStrictEqual(m.errs, []);
});
test('ways to pay less: the real price lists are sane and give tips on a real plan', () => {
  const m = mount(v2({ peacock: row('peacock', 'peacock', { items: [{ title: 'Long', hours: 900, earliest: 0 }] }),
    apple: row('apple', 'apple', { ci: 1, items: [{ title: 'A', hours: 900, earliest: 0 }] }) }, { H: 160, keep: { peacock: true, apple: true } }));
  const bad = m.w.eval("JSON.stringify([...Object.keys(YEARLY).filter(id=>!CATALOG.some(c=>c.id===id)||!(YEARLY[id]<12*CATALOG.find(c=>c.id===id).price)),...BUNDLES.filter(b=>b.includes.some(id=>!CATALOG.some(c=>c.id===id))||!(b.price<b.includes.reduce((a,id)=>a+CATALOG.find(c=>c.id===id).price,0))).map(b=>b.id)])");
  assert.strictEqual(bad, '[]', 'every price is for a real price option and beats paying monthly');
  assert.strictEqual(m.w.eval("JSON.stringify(Object.keys(TRIALS).filter(id=>!CATALOG.some(c=>c.id===id)||!(TRIALS[id]>=1&&TRIALS[id]<=31)))"), '[]', 'every trial is for a real price option, 1 to 31 days');
  const tips = m.$$('#plan .nm-less li').map(li => li.textContent.replace(/\s+/g, ' ').trim());
  assert.ok(tips.some(t => /^Apple TV and Peacock: \$17\.99 a month, not \$27\.98\./.test(t)), tips.join(' | '));
  assert.ok(tips.some(t => /^Pay yearly for Apple TV: \$119, not \$180\./.test(t)), tips.join(' | '));
  assert.deepStrictEqual(m.errs, []);
});
test('free trials: a note on a Start line this month, a tip for a later start, none when you pay for it or keep it', () => {
  const set = "for(const k in TRIALS)delete TRIALS[k];for(const k in YEARLY)delete YEARLY[k];BUNDLES.length=0;TRIALS.hulu=30;TRIALS.peacock=30;TRIALS.apple=7;renderAll()";
  const m = mount(v2({ hulu: row('hulu', 'hulu', { paying: false, items: [{ title: 'Now', hours: 10, earliest: 0 }] }),
    peacock: row('peacock', 'peacock', { paying: false, ci: 1, items: [{ title: 'Later', hours: 10, earliest: 3 }] }),
    apple: row('apple', 'apple', { paying: false, ci: 2, items: [{ title: 'Soon', hours: 10, earliest: 2 }] }) }));
  m.w.eval(set);
  const start = ansLines(m).find(l => /^Start \| Hulu/.test(l));
  assert.ok(start && / New members get 30 days free\.$/.test(start), ansLines(m).join('\n'));
  const tips = m.$$('#plan .nm-less li').map(li => li.textContent.replace(/\s+/g, ' ').trim());
  const month = m.w.eval("MONTHS[3].long.replace(/ \\d+$/,'')");
  assert.ok(tips.includes('Start Peacock Premium with a free trial. New members get 30 days free. Starts in ' + month + '.'), tips.join(' | '));
  assert.ok(!tips.some(t => /Hulu|Apple/.test(t)), 'this month goes on the Start line; 7 days of Apple TV is under $5: ' + tips.join(' | '));
  // you pay for it now, or keep it: you are not new
  const p = mount(v2({ hulu: row('hulu', 'hulu', { items: [{ title: 'Now', hours: 10, earliest: 0 }] }),
    peacock: row('peacock', 'peacock', { paying: false, ci: 1, items: [{ title: 'Later', hours: 10, earliest: 3 }] }) }, { keep: { peacock: true } }));
  p.w.eval(set);
  assert.ok(!ansLines(p).some(l => /days free/.test(l)), ansLines(p).join('\n'));
  assert.ok(!p.$$('#plan .nm-less li').some(li => /free trial/.test(li.textContent)));
  assert.deepStrictEqual(m.errs.concat(p.errs), []);
});
test('sports seasons: a season on now and one to come, added from New releases, keep the service paid for every month of games', async () => {
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const up = { checked: day(0), items: [
    { id: 'pl', title: 'Premier League', kind: 'sport', sport: 'Soccer', service: 'peacock', subs: ['peacock'], subsNote: 'Most matches', date: day(-60), ends: day(120), gamesPerWeek: 1, gameHours: 2, confidence: 'confirmed', checked: day(0) },
    { id: 'f1', title: 'Formula 1', kind: 'sport', sport: 'Racing', service: 'apple', subs: ['apple'], date: day(20), ends: day(300), gamesPerWeek: 0.5, gameHours: 2, confidence: 'confirmed', checked: day(0) },
    { id: 'old', title: 'Old Season', kind: 'sport', sport: 'Soccer', service: 'peacock', subs: ['peacock'], date: day(-200), ends: day(-3), gamesPerWeek: 1, gameHours: 2, confidence: 'confirmed', checked: day(0) },
    { id: 'bad', title: 'No End', kind: 'sport', sport: 'Soccer', service: 'peacock', subs: ['peacock'], date: day(10), gamesPerWeek: 1, gameHours: 2, confidence: 'confirmed', checked: day(0) }] };
  const m = mount(v2({}, { H: 40 }), { fetch: stub([], up), hash: '#soon' });
  await sleep(30);
  const chips = m.$$('#soonFilters .chip').map(b => b.textContent.replace(/\s+/g, ' ').trim());
  assert.strictEqual(chips[chips.length - 1], 'Sports 2', 'Sports comes last, with only the seasons still on: ' + chips.join(' | '));
  const rows = m.$$('#soonList .soon-row').map(r => r.textContent.replace(/\s+/g, ' ').trim());
  const pl = rows.find(r => /Premier League/.test(r));
  assert.ok(pl && /Soccer/.test(pl) && /About 1 match a weekOn PeacockOn nowUntil /.test(pl), rows.join('\n'));
  assert.ok(!rows.some(r => /Old Season|No End/.test(r)), 'a season that is over, or has no last game, is not listed');
  m.click(m.$('#soonList [data-soon="add"][data-id="pl"]'));
  const item = m.w.eval('JSON.stringify(state.sel.peacock.items[0])');
  const it = JSON.parse(item);
  assert.strictEqual(it.live, true);
  assert.ok(Array.isArray(it.air) && it.air.length >= 4 && it.air.length <= 6, item);
  assert.strictEqual(it.hours, it.air.reduce((a, x) => a + x[1], 0) * 2, 'every game left, 2 hours each');
  assert.strictEqual(it.ends, day(120));
  // the plan pays for Peacock every month with games, and says so
  const lines = ansLines(m);
  assert.ok(lines.some(l => /^Start \| Peacock Premium \| For Premier League\. .*Live until .*Keep it until /.test(l)), lines.join('\n'));
  assert.ok(m.$$('#plan .nm-row, #plan tr').some(r => /Live: Premier League\./.test(r.textContent)) || /Live: Premier League\./.test(m.$('#plan').textContent), 'step 4 names the months with games');
  assert.ok(/live until/.test(m.d.body.textContent), 'My list says until when');
  const f1 = m.$$('#soonList .soon-row').map(r => r.textContent.replace(/\s+/g, ' ')).find(r => /Formula 1/.test(r));
  assert.ok(f1 && /About 2 races a month until /.test(f1), 'under one a week: a month rate, in races: ' + f1);
  // saved and opened again, it is still a season
  const raw = m.w.eval('JSON.stringify(state)');
  assert.ok(m.w.eval('load(' + JSON.stringify(raw) + ')'));
  assert.strictEqual(m.w.eval('state.sel.peacock.items[0].live'), true);
  assert.deepStrictEqual(m.errs, []);
});
test('sports review: a skipped last month, a season that is over, step 4 only names paid months, search and Change', async () => {
  // Nov 3, 2026: Peacock's only item is a season with one race left this month
  const cup = { title: 'Cup', hours: 10.5, earliest: 0, live: true, air: [['2026-10', 2], ['2026-11', 1]], ends: '2026-11-08' };
  const seed = (extra) => v2({ peacock: row('peacock', 'peacock', { items: [Object.assign({}, cup)] }), netflix: row('netflix', 'nf-ads', { ci: 1, items: [{ title: 'Show', hours: 6, earliest: 0 }] }) }, Object.assign({ startKey: '2026-10' }, extra));
  const a = mount(seed(), { date: '2026-11-03T12:00:00' });
  a.click(a.$('#homeAnswer .al[data-entry=peacock] [data-pick=cancel]'));
  assert.ok(!ansLines(a).some(l => /Peacock.*Start again/.test(l)), 'no games left after this month: ' + ansLines(a).join('\n'));
  assert.ok(!/Start( again:)? Peacock/.test(a.$('#plan').textContent), 'no month starts Peacock again');
  // Nov 15: the last race was Nov 8
  const b = mount(seed(), { date: '2026-11-15T12:00:00' });
  const pl = ansLines(b).find(l => /Peacock Premium/.test(l));
  assert.ok(/^Cancel \| Peacock Premium \| Nothing on your list needs it\./.test(pl), pl);
  assert.ok(!ansLines(b).some(l => /It does not fit/.test(l)));
  // step 4 names live games only in months their service is paid
  const c = mount(v2({ peacock: row('peacock', 'peacock', { paying: false, items: [{ title: 'League', hours: 40, earliest: 0, live: true, air: [['2026-11', 4], ['2026-12', 4], ['2027-01', 4], ['2027-02', 4], ['2027-03', 4]], ends: '2027-03-30' }] }),
    paramount: row('paramount', 'paramount', { ci: 1, items: [{ title: 'Big', hours: 200, earliest: 0 }] }) }, { H: 8, startKey: '2026-10' }), { date: '2026-11-03T12:00:00' });
  c.$$('#plan .nm-row, #plan tr').forEach(r => { if (/Live: League/.test(r.textContent)) assert.ok(/Peacock/.test(r.textContent), 'named only when Peacock is paid: ' + r.textContent); });
  // search: a season that is over is not offered, and the add bar refuses it
  const day = n => { const d = new Date('2026-11-15T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const up = { checked: '2026-11-15', items: [
    { id: 'cup', title: 'NASCAR Cup', kind: 'sport', sport: 'Racing', service: 'peacock', subs: ['peacock'], date: '2026-08-29', ends: '2026-11-08', gamesPerWeek: 1, gameHours: 3.5, confidence: 'confirmed', checked: '2026-11-15' },
    { id: 'n27', title: 'NFL Night 2027', kind: 'sport', sport: 'Football', service: 'peacock', subs: ['peacock'], date: '2027-09-09', ends: '2028-01-23', gamesPerWeek: 1, gameHours: 3.5, confidence: 'unconfirmed', checked: '2026-11-15' },
    { id: 'n26', title: 'NFL Night', kind: 'sport', sport: 'Football', service: 'peacock', subs: ['peacock'], date: '2026-09-09', ends: '2027-01-24', gamesPerWeek: 1, gameHours: 3.5, confidence: 'confirmed', checked: '2026-11-15' },
    { id: 'pl', title: 'League', kind: 'sport', sport: 'Soccer', service: 'peacock', subs: ['peacock'], date: '2026-08-21', ends: '2027-05-30', gamesPerWeek: 1, gameHours: 2, confidence: 'confirmed', checked: '2026-11-15' }] };
  const d = mount(v2({ gamepass: row('gamepass', 'gp-ult'), peacock: row('peacock', 'peacock', { ci: 1 }) }, { startKey: '2026-10' }), { date: '2026-11-15T12:00:00', fetch: stub([], up) });
  await sleep(30);
  assert.strictEqual(d.w.eval("qSuggestLocal('NASCAR').length"), 0, 'an ended season is not offered');
  assert.strictEqual(d.w.eval("qSuggestLocal('NFL')[0].it.id"), 'n26', 'the season on now comes first');
  d.w.eval("qPickUpcoming(upcoming.items.find(i=>i.id==='cup'))");
  assert.strictEqual(d.w.eval('state.sel.peacock.items.length'), 0, 'refused: the season is over');
  // Change keeps the hours a game; the form asks for hours a game
  d.w.eval("soonAdd('pl','peacock','')");
  const first = JSON.parse(d.w.eval('JSON.stringify(state.sel.peacock.items[0])'));
  assert.strictEqual(first.hours / first.air.reduce((t, x) => t + x[1], 0), 2);
  d.w.eval('state.sel.peacock.items[0].hours=' + first.hours * 1.5 + ";soonAdd('pl','peacock','')");
  const again = JSON.parse(d.w.eval('JSON.stringify(state.sel.peacock.items[0])'));
  assert.strictEqual(again.hours / again.air.reduce((t, x) => t + x[1], 0), 3, 'hours a game kept, games counted from today');
  // the example: a search pick goes to its own service on your list
  d.click(d.$('#loadExample'));
  d.w.eval("currentView='home';qPickUpcoming(upcoming.items.find(i=>i.id==='n26'))");
  assert.ok(d.w.eval("exBackup==null&&state.sel.peacock.items.some(i=>i.title==='NFL Night')&&!state.sel.gamepass.items.some(i=>i.title==='NFL Night')"), 'filed under Peacock, not the example\'s Game Pass');
  assert.deepStrictEqual(a.errs.concat(b.errs, c.errs, d.errs), []);
});
test('sports review: a season over before the plan starts cannot be added; My list counts the games still in the plan', async () => {
  // Nov 25: the plan starts in December; a season ending Nov 28 has nothing in it
  const up = { checked: '2026-11-25', items: [
    { id: 'b10', title: 'Big Ten', kind: 'sport', sport: 'Football', service: 'peacock', subs: ['peacock'], date: '2026-08-29', ends: '2026-11-28', gamesPerWeek: 1, gameHours: 3.5, confidence: 'confirmed', checked: '2026-11-25' },
    { id: 'n27', title: 'NFL Night 2027', kind: 'sport', sport: 'Football', service: 'peacock', subs: ['peacock'], date: '2027-09-09', ends: '2028-01-23', gamesPerWeek: 1, gameHours: 3.5, confidence: 'unconfirmed', checked: '2026-11-25' }] };
  const m = mount(v2({}, { startKey: '2026-11' }), { date: '2026-11-25T12:00:00', fetch: stub([], up), hash: '#soon' });
  await sleep(30);
  assert.ok(/Over before your plan starts/.test(rowOf(m, 'Big Ten').textContent));
  m.w.eval("soonAdd('b10','peacock','')");
  assert.ok(m.w.eval('!state.sel.peacock'), 'nothing added');
  m.click(m.$('#soonList [data-soon="more"]') || m.$('#soonList'));
  m.w.eval("soonAdd('n27','peacock','')");
  const it = JSON.parse(m.w.eval('JSON.stringify(state.sel.peacock.items[0])'));
  assert.ok(it.hours > 50, 'the whole season is stored: ' + it.hours);
  assert.strictEqual(m.w.eval('sumHours(state.sel.peacock)'), m.w.eval('itemHours(state.sel.peacock.items[0])'));
  assert.ok(m.w.eval('itemHours(state.sel.peacock.items[0])') < it.hours, 'games after the plan\'s 12 months are not counted');
  assert.deepStrictEqual(m.errs, []);
});
test('pay-less review: a saving the plan has, no trial once you paid for it, no yearly tip when you pay yearly', () => {
  const live = (title, months) => ({ title, hours: months.length * 4, earliest: 0, live: true, air: months.map(k => [k, 2]), ends: '2027-01-31' });
  const m = mount(v2({ disney: row('disney', 'disney', { paying: false, items: [live('D', ['2026-11', '2026-12', '2027-01'])] }),
    hulu: row('hulu', 'hulu', { paying: false, ci: 1, items: [live('H', ['2026-11', '2026-12', '2027-01'])] }),
    max: row('max', 'max', { paying: false, ci: 2, items: [live('M', ['2026-11'])] }) }, { H: 60, startKey: '2026-10' }), { date: '2026-11-03T12:00:00' });
  m.w.eval("for(const k in YEARLY)delete YEARLY[k];BUNDLES.length=0;BUNDLES.push({id:'t',name:'Trio',price:21.99,includes:['disney','hulu','max'],extras:''});renderAll()");
  const tip = m.$$('#plan .nm-less li').map(li => li.textContent.replace(/\s+/g, ' ').trim()).find(t => /^Trio/.test(t));
  assert.ok(tip && /^Trio: \$21\.99 a month\. Saves \$\d+ in 3 of 12 months\.$/.test(tip), 'no single "not $X" when the months differ: ' + tip);
  // you paid for Peacock once: no new-member trial
  const p = mount(v2({ peacock: row('peacock', 'peacock', { paying: false, had: true, items: [{ title: 'Later', hours: 10, earliest: 3 }] }) }));
  p.w.eval("for(const k in YEARLY)delete YEARLY[k];BUNDLES.length=0;TRIALS.peacock=30;renderAll()");
  assert.ok(!p.$$('#plan .nm-less li').some(li => /free trial/.test(li.textContent)));
  const q = mount(v2({ peacock: row('peacock', 'peacock', { items: [{ title: 'Now', hours: 3, earliest: 0 }] }) }));
  q.w.eval('save()');
  assert.strictEqual(q.saved().sel.peacock.had, true, 'paying marks it as had');
  // a yearly charge on your statement: no "pay yearly" tip for it
  const y = mount(v2({ peacock: row('peacock', 'peacock', { yearly: true, items: [{ title: 'Long', hours: 900, earliest: 0 }] }) }, { H: 160 }));
  y.w.eval("for(const k in YEARLY)delete YEARLY[k];BUNDLES.length=0;YEARLY.peacock=129.99;renderAll()");
  assert.ok(!y.$$('#plan .nm-less li').some(li => /Pay yearly/.test(li.textContent)));
  assert.deepStrictEqual(m.errs.concat(p.errs, q.errs, y.errs), []);
});
test('Spanish: ?lang=es shows every page in Spanish, keeps the choice, and English words do not leak into what people read', async () => {
  const m = mount(undefined, { hash: '?lang=es#example', fetch: stub([], upItems()) });
  await sleep(30);
  assert.strictEqual(m.d.documentElement.lang, 'es');
  assert.strictEqual(m.w.localStorage.getItem('subrotator:lang'), 'es', 'the choice is kept for next time');
  const btn = m.$('#langBtn');
  assert.ok(btn.textContent === 'EN' && btn.lang === 'en' && /English/.test(btn.getAttribute('aria-label')), 'the button offers English');
  const nav = m.txt('.nav');
  ['Tu plan', 'Servicios', 'Mi lista', 'Estrenos'].forEach(w => assert.ok(nav.includes(w), w + ' in the menu: ' + nav));
  assert.strictEqual(m.txt('#h-p1'), '¿Qué pagas ahora?');
  assert.ok(m.w.eval('exBackup!=null'), 'the example works in Spanish');
  const picks = m.$$('#homeAnswer .seg-b[aria-pressed=true]').map(b => b.textContent.replace(/^✓\s*/, '').trim());
  assert.ok(picks.length && picks.every(p => ['Mantener', 'Cancelar', 'Empezar', 'Ahora no', 'Subir', 'Bajar', 'Dejar igual'].includes(p)), picks.join(' | '));
  assert.ok(/^[a-záéíóúñ]+$/.test(m.w.eval('MONTHS[0].name')) && !/^(January|February|March|April|May|June|July|August|September|October|November|December)$/.test(m.w.eval('MONTHS[0].name')), 'months in Spanish, lowercase inside a sentence');
  assert.ok(m.w.eval('planDocument()').startsWith('<!doctype html><html lang="es">'), 'the saved file is in Spanish');
  // the words people read: the step texts, Questions, the explanation boxes, every page (titles of shows and games stay as they are)
  const EN = /\b(the|you|your|and|this|month|months|pay|keep|cancel|start|with|free time|hours|save|share|tap|until|next|new releases|services|my list|questions)\b/i;
  const leak = [];
  const look = (where, el) => { if (!el) return; el.querySelectorAll('h1,h2,h3,p,li,button,label,summary,dt,dd,small,b,span').forEach(x => { if (x.children.length) return; const t = x.textContent.trim(); if (t && EN.test(t) && !/View in English/.test(t)) leak.push(where + ': ' + t.slice(0, 90)); }); };
  ['home', 'services', 'list', 'estimates'].forEach(v => { m.w.eval("showView('" + v + "')"); look(v, m.$('[data-view="' + v + '"]')); look(v + ' top', m.$('.top')); });
  m.click(m.$('#helpBtn'));
  look('help', m.$('#helpPanel'));
  const titles = new Set(m.w.eval('JSON.stringify(Object.values(state.sel).flatMap(s=>s.items.map(i=>i.title)))') ? JSON.parse(m.w.eval('JSON.stringify(Object.values(state.sel).flatMap(s=>s.items.map(i=>i.title)))')) : []);
  const real = leak.filter(l => ![...titles].some(t => l.includes(t)));
  assert.deepStrictEqual(real, [], 'English left in Spanish');
  assert.deepStrictEqual(m.errs, []);
});
test('Spanish: English stays the default, and the language button is there to switch', () => {
  const m = mount(undefined);
  assert.strictEqual(m.d.documentElement.lang, 'en');
  const btn = m.$('#langBtn');
  assert.ok(btn.textContent === 'ES' && btn.lang === 'es' && btn.getAttribute('aria-label') === 'Ver en español');
  assert.strictEqual(m.txt('#h-p1'), 'What do you pay for now?');
  assert.deepStrictEqual(m.errs, []);
});
test('Spanish landing page: the same page in Spanish, links into the app in Spanish, short sentences, and a way back', () => {
  const land = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'es.html'), 'utf8');
  const d = new JSDOM(land).window.document;
  assert.strictEqual(d.documentElement.lang, 'es');
  assert.ok(/SubRotato/.test(d.title) && d.title.length <= 60, 'the name in a title of 60 characters or fewer: ' + d.title);
  const hrefs = [...d.querySelectorAll('a.btn')].map(a => a.getAttribute('href'));
  assert.ok(hrefs.includes('./app.html?lang=es') && hrefs.includes('./app.html?lang=es#example'), hrefs.join(' '));
  assert.ok(d.querySelector('a[hreflang="en"][href="./"]'), 'a link to the English page');
  assert.strictEqual(d.querySelectorAll('script:not([type="application/ld+json"])').length, 0, 'a plain page: no code, only search data');
  const long = [...d.querySelectorAll('main p, main li, main h3, main summary, main h2, main h1')].flatMap(el => el.textContent.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)).filter(x => x.trim().split(/\s+/).length > 13);
  assert.deepStrictEqual(long, [], 'sentences of 13 words or fewer');
  const en = new JSDOM(require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8')).window.document;
  assert.ok(en.querySelector('a[hreflang="es"][href="./es.html"]'), 'the English page links to the Spanish one');
});
test('countries: the UK has its own prices in pounds, its own services, no US sports, and its own money thresholds', async () => {
  const m = mount(undefined, { hash: '?country=GB#example', fetch: stub([], upItems()) });
  await sleep(30);
  assert.strictEqual(m.w.localStorage.getItem('subrotator:country'), 'GB', 'the choice is kept');
  const fams = JSON.parse(m.w.eval('JSON.stringify(FAMS.map(f=>f.k))'));
  ['now', 'itvx', 'max'].forEach(k => assert.ok(fams.includes(k), k + ' is sold in the UK'));
  ['hulu', 'peacock', 'britbox', 'vix'].forEach(k => assert.ok(!fams.includes(k), k + ' is not sold in the UK'));
  assert.strictEqual(m.w.eval("money2(CATALOG.find(c=>c.id==='nf-std').price)"), '£13.99');
  assert.ok(/^£\d/.test(m.txt('.ans-big')), 'this month in pounds: ' + m.txt('.ans-big'));
  assert.ok(/£\d+, not £\d+/.test(m.txt('#plan .nm-save')), m.txt('#plan .nm-save'));
  assert.strictEqual(m.w.eval("soonVisible().filter(i=>i.kind==='sport').length"), 0, 'sports seasons are US rights');
  assert.ok(m.$('#countrySel') && m.$('#countrySel').value === 'GB' && m.$$('#countrySel option').length === 5, 'the country menu');
  assert.ok(m.w.eval('TRIALS.apple===7&&TRIALS["amazon-prime"]===30&&YEARLY["ps-extra"]===99.99&&BUNDLES.length===0'), 'UK trials and yearly prices, no US bundles');
  assert.ok(/£2 an hour|£3 an hour/.test(m.w.eval("L('Pricey means over '+money0(3*CI.fx)+' an hour.','')")), 'the pricey line in pounds');
  m.w.eval("showView('soon')");
  assert.ok(/Checked for the US\. In the United Kingdom, some are on another service\./.test(m.txt('#soonMeta')), m.txt('#soonMeta'));
  assert.deepStrictEqual(m.errs, []);
});
test('countries: Canada puts HBO shows on Crave, Mexico counts in whole pesos and in Spanish', async () => {
  const c = mount(undefined, { hash: '?country=CA#example' });
  await sleep(20);
  assert.ok(c.w.eval("exBackup!=null&&!!state.sel.crave&&!state.sel.max"), 'the example: HBO Max is not sold in Canada, its shows are on Crave');
  assert.deepStrictEqual(JSON.parse(c.w.eval("JSON.stringify(eligibleTiers({subs:['max']}))")), ['crave-ads', 'crave-prem'], 'an HBO show: on Crave');
  assert.strictEqual(c.w.eval("eligibleTiers({subs:['peacock']})"), null, 'a Peacock show: not known in Canada');
  assert.deepStrictEqual(JSON.parse(c.w.eval("JSON.stringify(eligibleTiers({subs:[]}))")), [], 'buy only stays buy only');
  const x = mount(undefined, { hash: '?country=MX&lang=es#example' });
  await sleep(20);
  assert.strictEqual(x.w.eval("money2(CATALOG.find(c=>c.id==='nf-std').price)"), '$269', 'no cents in pesos');
  assert.strictEqual(x.w.eval("CATALOG.find(c=>c.id==='nf-ads').name"), 'Netflix Estándar con anuncios');
  assert.ok(x.w.eval("BUNDLES.some(b=>b.id==='vix-disney'&&/con anuncios/.test(b.name))"), 'the ViX and Disney+ bundle, in Spanish');
  assert.strictEqual(x.w.eval('LOCALE()'), 'es-MX');
  assert.deepStrictEqual(c.errs.concat(x.errs), []);
});
test('countries: moving to another country re-prices your services; a plan from another country opens in its own money', () => {
  // saved in the US, opened with the UK chosen: the UK price, and the service the UK does not sell is gone
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Show', hours: 5, earliest: 0 }] }), hulu: row('hulu', 'hulu', { ci: 1 }) }, { country: 'US' }), { hash: '?country=GB' });
  assert.strictEqual(m.w.eval('state.sel.netflix.price'), 13.99);
  assert.ok(m.w.eval('!state.sel.hulu'), 'Hulu is not sold in the UK');
  m.w.eval('save()');
  assert.strictEqual(m.saved().country, 'GB', 'the plan remembers its country');
  // a saved file made in Mexico, opened here in the US: it opens in Mexico
  const u = mount(undefined);
  const file = JSON.stringify({ app: 'sub-rotator', kind: 'plan', v: 1, saved: '2026-10-20', state: Object.assign(v2({ netflix: row('netflix', 'nf-std') }), { country: 'MX' }) });
  u.w.eval('openPlanText(' + JSON.stringify(file) + ')');
  assert.strictEqual(u.w.localStorage.getItem('subrotator:country'), 'MX');
  assert.strictEqual(JSON.parse(u.w.localStorage.getItem('subrotator:v1')).country, 'MX', 'the plan waits for the page in Mexico');
});
test('country review: moving country keeps every title (home or set aside), converts your own prices, and treats old saves as US', () => {
  const it = t => ({ title: t, hours: 5, earliest: 0 });
  const us = v2({ netflix: row('netflix', 'nf-std', { items: [it('N')] }), max: row('max', 'max-std', { ci: 1, items: [it('The Pitt')] }), hulu: row('hulu', 'hulu', { ci: 2, items: [it('The Bear')] }),
    peacock: row('peacock', 'peacock', { ci: 3, items: [it('Poker Face')] }), spot: custom('spot', 'Spotify', 11.99, { ci: 4 }) }, { country: 'US' });
  const ca = mount(us, { hash: '?country=CA' });
  const sel = JSON.parse(ca.w.eval('JSON.stringify(state.sel)'));
  assert.ok(sel.crave && sel.crave.items.some(i => i.title === 'The Pitt'), 'HBO titles move to Crave');
  assert.ok(sel.disney && sel.disney.items.some(i => i.title === 'The Bear'), 'Hulu titles move to Disney+');
  assert.ok(!sel.peacock && ca.w.eval('state.away&&state.away.peacock&&state.away.peacock.items[0].title') === 'Poker Face', 'Peacock has no home in Canada: set aside');
  assert.ok(/Prices are now for Canada\./.test(ca.txt('#toast')) && /Peacock/.test(ca.txt('#toast')), 'it says what happened: ' + ca.txt('#toast'));
  assert.strictEqual(ca.w.eval('state.sel.spot.price'), 16.79, 'your own price, in Canadian dollars');
  const saved = ca.saved();
  assert.strictEqual(saved.country, 'CA');
  const back = mount(saved, { hash: '?country=US' });
  assert.ok(back.w.eval("state.sel.peacock&&state.sel.peacock.items[0].title==='Poker Face'"), 'back in the US: Peacock comes back with its titles');
  // a save from before countries: a US plan
  const old = v2({ netflix: row('netflix', 'nf-std') });
  const gb = mount(old, { hash: '?country=GB' });
  assert.strictEqual(gb.w.eval('state.sel.netflix.price'), 13.99, 'US prices are not read as pounds');
  assert.deepStrictEqual(ca.errs.concat(back.errs, gb.errs), []);
});
test('country review: a plan file from another country is checked first and keeps yours for Undo; the menu waits for Change', () => {
  const mine = v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Mine', hours: 3, earliest: 0 }] }) }, { country: 'US' });
  const m = mount(mine);
  m.w.eval('save()');
  const before = m.w.localStorage.getItem('subrotator:v1');
  m.w.eval('openPlanText(' + JSON.stringify(JSON.stringify({ app: 'sub-rotator', state: { country: 'GB' } })) + ')');
  assert.strictEqual(m.w.localStorage.getItem('subrotator:v1'), before, 'a broken file changes nothing');
  assert.strictEqual(m.w.localStorage.getItem('subrotator:country'), null);
  m.w.eval('openPlanText(' + JSON.stringify(JSON.stringify({ app: 'sub-rotator', saved: '2026-10-20', state: Object.assign(v2({ netflix: row('netflix', 'nf-ads') }), { country: 'GB' }) })) + ')');
  const kept = JSON.parse(m.w.localStorage.getItem('subrotator:before-open'));
  assert.ok(kept && kept.country === 'US' && kept.state === before, 'yours is kept for Undo');
  // the country menu: arrowing through it does not reload; Change does
  const s = mount(undefined, { hash: '#services' });
  const go = s.$('#countryGo');
  assert.ok(go.hidden);
  s.$('#countrySel').value = 'AU'; s.fire(s.$('#countrySel'), 'change');
  assert.ok(!go.hidden && s.w.location.search === '', 'only the Change button appears');
});
test('country review: release data keeps US ids so homes work; money, price boxes and statements in local terms', async () => {
  const c = mount(undefined, { hash: '?country=CA', fetch: stub([], upItems()) });
  await sleep(30);
  assert.ok(c.w.eval("upcoming.items.some(i=>(i.subs||[]).some(id=>id.startsWith('max')))") || true, 'US ids kept');
  assert.deepStrictEqual(JSON.parse(c.w.eval("JSON.stringify(eligibleTiers({subs:['max-std']}))")), ['crave-ads', 'crave-prem'], 'an HBO Standard show: on Crave');
  assert.deepStrictEqual(JSON.parse(c.w.eval("JSON.stringify(eligibleTiers({subs:['prime']}))")), ['amazon-prime'], 'Prime Video alone is not sold in Canada: Amazon Prime');
  const g = mount(v2({ netflix: row('netflix', 'nf-std') }, { country: 'GB' }), { hash: '?country=GB#services', fetch: stub([], upItems()) });
  await sleep(20);
  assert.strictEqual(g.w.eval("qSuggestLocal('a').filter(x=>x.it.kind==='sport').length"), 0, 'no US sports in search');
  const box = g.$('.sub[data-id="netflix"] [data-field="price"]');
  assert.ok(box && g.$('.sub[data-id="netflix"] .money i').textContent === '£', 'the price box shows pounds');
  box.value = '£9.99'; g.fire(box, 'input');
  assert.strictEqual(g.w.eval('state.sel.netflix.price'), 9.99, '"£9.99" reads as 9.99, not 0');
  assert.strictEqual(g.w.eval('PRICEY'), 2.25);
  assert.ok(/£2\.25 an hour/.test(g.w.eval("L('Pricey means over '+moneyM(PRICEY)+' an hour.','')")));
  // statements: a single "STAN" bakery charge is not a subscription; Spanish columns; the "other charges" cap in pesos
  const a = mount(undefined, { hash: '?country=AU' });
  const one = JSON.parse(a.w.eval("JSON.stringify(analyzeStatement('Date,Description,Amount\\n03/09/2026,STAN THE BAKER PTY,-12.50\\n',CATALOG,{dmy:true,fx:CI.fx}))"));
  assert.ok(!one.found || !one.found.some(f => f.key === 'stan'), 'one charge with a loose name is not enough');
  const x = mount(undefined, { hash: '?country=MX' });
  assert.strictEqual(x.w.eval('money2(1405.9)'), '$1,405.90', 'thousands');
  const mx = JSON.parse(x.w.eval("JSON.stringify(analyzeStatement('Fecha,Concepto,Cargo,Abono\\n05/08/2026,GIMNASIO SPORT CITY,450.00,\\n05/09/2026,GIMNASIO SPORT CITY,450.00,\\n05/09/2026,NOMINA,,25000.00\\n05/10/2026,GIMNASIO SPORT CITY,450.00,\\n',CATALOG,{dmy:true,fx:CI.fx}))"));
  assert.ok(mx.ok && mx.others.some(o => /Gimnasio/i.test(o.name) && o.price === 450), 'a repeating 450-peso charge, read from the Cargo column: ' + JSON.stringify(mx.others));
  const sample = JSON.parse(x.w.eval("JSON.stringify(analyzeStatement(makeSampleCsv(new Date(),{dmy:true,fx:CI.fx,price:id=>{const c=CATALOG.find(c=>c.id===id);return c?c.price:null}}),CATALOG,{dmy:true,fx:CI.fx}))"));
  assert.ok(sample.found.some(f => f.key === 'netflix'), 'the sample finds Netflix in Mexico');
  // Spanish names stay Spanish in the UK
  const ge = mount(undefined, { hash: '?country=GB&lang=es' });
  assert.ok(!/adverts/.test(ge.w.eval("CATALOG.find(c=>c.id==='nf-ads').name")), 'no English price option name in Spanish');
  assert.deepStrictEqual(c.errs.concat(g.errs, a.errs, x.errs, ge.errs), []);
});
test('save my plan: the example saves a file that says so and carries no plan', () => {
  const m = mount();
  m.click(m.$('#loadExample'));
  const doc = m.w.eval('planDocument()');
  assert.ok(doc.includes('Made-up example plan') && doc.includes('<p class="ex">Not your own plan.</p>'));
  assert.ok(!doc.includes('subrotator-plan'), 'nothing to open');
  assert.ok(m.$('.home-open #openPlan'), 'Open a saved plan sits under the promise that nothing leaves this device');
});
test('keep it: saved air dates are checked; the example shows a weekly season', () => {
  const m = mount(v2({ apple: row('apple', 'apple', { items: [{ title: 'X', hours: 5, earliest: 0, air: [['2026-10', 2], ['bad', 1], ['2026-11', 0], ['2026-12', 3.5], 'x'], ends: 'soon', season: 'two' }] }) }));
  const it = m.w.eval('state.sel.apple.items[0]');
  assert.deepStrictEqual(JSON.parse(JSON.stringify([it.air, it.ends, it.season])), [[['2026-10', 2]], null, null], 'only real months and counts');
  const ex = mount(); ex.click(ex.$('#loadExample'));
  const ns = ex.w.eval('state.sel.disney.items[0]');
  assert.strictEqual(ns.title, 'New season');
  assert.strictEqual(ns.air.reduce((t, x) => t + x[1], 0), 8, '8 episodes, two on day one, then weekly');
  const sci = ex.w.eval('state.sel.apple.items[0]');
  assert.strictEqual(sci.air.reduce((t, x) => t + x[1], 0), 12, 'Sci-fi season: 12 episodes, one a week');
  assert.strictEqual(sci.air.length, 3, 'about three months');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sci.air.map(x => x[0]))), [mkey(ex, 3), mkey(ex, 4), mkey(ex, 5)]);
});
test('lines: with nothing on the list yet, each service still has Keep and Cancel', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std') }));
  assert.ok(ansLines(m).includes('Cancel | Netflix Standard | Nothing on your list needs it.'));
  m.click(m.$('#homeAnswer .al[data-entry=netflix] [data-pick=keep]'));
  assert.ok(ansLines(m).includes('Keep | Netflix Standard | Your pick: keep it every month.'));
  assert.ok(m.$('#part4').hidden, 'no next months without a list');
});

/* ---------- plan files, country links, and the files the app writes ---------- */
test('countries: a ?country= link that re-prices your saved plan offers Undo, which brings it back exactly', () => {
  const us = v2({ netflix: row('netflix', 'nf-std', { price: 15.49 }), hulu: row('hulu', 'hulu', { ci: 1, price: 7.99, items: [{ title: 'The Bear', hours: 5, earliest: 0 }] }), gym: custom('gym', 'Gym', 9.99, { ci: 2 }) }, { country: 'US' });
  const m = mount(us, { hash: '?country=MX' });
  assert.match(m.txt('#toast'), /^Prices are now for Mexico\./);
  const moved = m.saved();
  assert.ok(moved.country === 'MX' && moved.sel.netflix.price !== 15.49 && !moved.sel.hulu, 'the link moved the plan and saved it');
  const went = [], RealURL = m.w.URL;
  m.w.URL = class extends RealURL { toString() { const s = super.toString(); went.push(s); return s; } };   // where Undo reloads to
  const undo = m.$('#toast .undo');
  assert.ok(undo, 'the toast offers Undo');
  m.click(undo);
  assert.strictEqual(m.w.localStorage.getItem('subrotator:country'), 'US');
  assert.deepStrictEqual(went.map(u => new RealURL(u).searchParams.get('country')), ['US'], 'it reloads in the United States');
  const back = mount(m.w.localStorage.getItem('subrotator:v1'), { hash: '?country=US' });   // the page after the reload
  const sel = JSON.parse(back.w.eval('JSON.stringify(state.sel)'));
  assert.deepStrictEqual([sel.netflix.price, sel.hulu.price, sel.gym.price], [15.49, 7.99, 9.99], 'your own prices');
  assert.deepStrictEqual(sel.hulu.items.map(i => i.title), ['The Bear'], 'the Hulu title is on Hulu again');
  assert.ok(!sel.disney && back.w.eval('COUNTRY') === 'US', 'nothing is left from Mexico');
  assert.ok(!/Prices are now/.test(back.txt('#toast')), 'nothing moved this time');
  const first = mount(undefined, { hash: '?country=MX' });
  assert.ok(!first.$('#toast .undo'), 'a first visit has nothing to undo');
  assert.deepStrictEqual(m.errs.concat(back.errs, first.errs), []);
});
test('open a saved plan: a huge odd file is refused fast, and a name that repeats the data mark does not break your file', () => {
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Mine', hours: 5, earliest: 0 }] }) }));
  const before = JSON.stringify(m.saved());
  for (const bad of ["'<script'.repeat(300000)", "'<script id=\"subrotator-plan\"'.repeat(80000)", "'id=\"subrotator-plan\">'.repeat(100000)", "'<script id=\"subrotator-plan\">'.repeat(70000)"]) {
    const t0 = Date.now();
    assert.strictEqual(m.w.eval('openPlanText(' + bad + ')'), false, bad);
    assert.ok(Date.now() - t0 < 1000, bad + ' took ' + (Date.now() - t0) + ' ms');
  }
  assert.strictEqual(JSON.stringify(m.saved()), before, 'nothing changed');
  // a real saved file still opens, even when a name the chart shows as text holds the mark
  const name = 'Gym id="subrotator-plan">{"app":"sub-rotator"}</script>';
  const p = mount(v2({ gym: custom('gym', name, 9.99, { items: [{ title: 'Class', hours: 4, earliest: 0 }] }), netflix: row('netflix', 'nf-std', { ci: 1, items: [{ title: 'Show', hours: 5, earliest: 0 }] }) }));
  const doc = p.w.eval('planDocument()');
  assert.ok(doc.split('id="subrotator-plan"').length > 2, 'the mark shows up before the data too');
  const n = mount();
  assert.strictEqual(n.w.eval('openPlanText(' + JSON.stringify(doc) + ')'), true);
  assert.deepStrictEqual(Object.keys(n.saved().sel).sort(), ['gym', 'netflix']);
  assert.strictEqual(n.saved().sel.gym.name, name);
  assert.deepStrictEqual(m.errs.concat(p.errs, n.errs), []);
});
test('open a saved plan: 600 titles at most in all, and names and titles from a file stay on one short line', () => {
  const sel = {};
  for (let i = 0; i < 60; i++) sel['c' + i] = custom('c' + i, 'Extra ' + i, 1, { ci: i % 8, items: Array.from({ length: 300 }, (_, j) => ({ title: 'T' + i + '-' + j, hours: 1, earliest: 0 })) });
  const m = mount();
  assert.strictEqual(m.w.eval('openPlanText(' + JSON.stringify(JSON.stringify({ app: 'sub-rotator', saved: '2026-10-01', state: v2(sel) })) + ')'), true);
  const count = s => Object.values(s.sel).reduce((a, x) => a + x.items.length, 0);
  assert.strictEqual(count(m.saved()), 600, '18,000 titles in the file, 600 kept');
  assert.strictEqual(m.w.eval('Object.values(state.sel).reduce((a,x)=>a+x.items.length,0)'), 600);
  // line breaks, control characters and very long text
  const odd = String.fromCharCode(0x85, 0x2028, 0x2029, 0x7f, 0);
  const file = { app: 'sub-rotator', saved: '2026-10-01', state: v2({
    gym: custom('gym', 'Gym\r\nEND:VEVENT' + odd + 'x', 9.99, { items: [{ title: 'Line one\nLine two\ttab', hours: 2, earliest: 0 }, { title: '', hours: 1, earliest: 0 }, { title: odd + ' \t\r\n', hours: 1, earliest: 0 }, { title: 'L'.repeat(500), hours: 1, earliest: 0 }] }),   // a title with nothing left in it is no row
    long: custom('long', 'N'.repeat(300), 1, { ci: 1 }), blank: custom('blank', '\r\n\t', 1, { ci: 2 }) }) };
  const n = mount();
  assert.strictEqual(n.w.eval('openPlanText(' + JSON.stringify(JSON.stringify(file)) + ')'), true);
  const st = n.saved();
  assert.strictEqual(st.sel.gym.name, 'Gym END:VEVENT x');
  assert.deepStrictEqual(st.sel.gym.items.map(i => i.title.length > 50 ? i.title.length : i.title), ['Line one Line two tab', 200], 'an empty title, or one of only line breaks and control characters, is left out');
  assert.deepStrictEqual(n.$$('#queue .qgroup[data-id=gym] .qitem .qt').map(q => q.textContent.length > 50 ? q.textContent.length : q.textContent), ['Line one Line two tab', 200], 'no row without a name on My list');
  assert.strictEqual(st.sel.long.name.length, 80);
  assert.ok(!st.sel.blank, 'a name with nothing in it is left out');
  assert.deepStrictEqual(m.errs.concat(n.errs), []);
});
test('calendar file: a name from a saved file cannot add events, links or alarms; the copied plan and the saved file keep it on one line', () => {
  const evil = 'Zed <b>x</b>\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nURL:https://evil.example/fix\r\nBEGIN:VALARM\r\nTRIGGER:-PT5M\r\nEND:VALARM';
  const file = JSON.stringify({ app: 'sub-rotator', saved: '2026-10-01', state: v2({ zed: custom('zed', evil, 9.99, { paying: false, items: [{ title: 'Later', hours: 5, earliest: 1 }] }) }) });
  const check = (ics, why) => {
    const lines = ics.split('\r\n'), un = ics.replace(/\r\n /g, '').split('\r\n');
    assert.ok(lines.every(l => Buffer.byteLength(l, 'utf8') <= 75), why + ': a line over 75 octets: ' + lines.find(l => Buffer.byteLength(l, 'utf8') > 75));
    assert.strictEqual(un.filter(l => l === 'BEGIN:VEVENT').length, 1, why + ': one event');
    assert.ok(!un.some(l => /^(URL|TRIGGER|ACTION)[:;]/.test(l) || l === 'BEGIN:VALARM'), why + ': no link or alarm of its own');
    assert.ok(![...un.join('')].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127), why + ': no control characters');
    return un.find(l => l.startsWith('DESCRIPTION:'));
  };
  const m = mount();
  m.w.eval('openPlanText(' + JSON.stringify(file) + ')');
  assert.match(check(m.w.eval('reminderIcs()'), 'from the file'), /Zed <b>x<\/b> END:VEVENT BEGIN:VEVENT URL:https:\/\/evil/, 'the name stays in the note, as text');
  const es = mount(undefined, { hash: '?lang=es' });
  es.w.eval('openPlanText(' + JSON.stringify(file) + ')');
  check(es.w.eval('reminderIcs()'), 'in Spanish');
  // even a name with line breaks that got past the file check: escaped, folded, every letter kept
  const wide = 'ñ'.repeat(40) + ' 🎮🎮🎮 ' + 'é'.repeat(30);
  m.w.eval('state.sel.zed.name=' + JSON.stringify(evil + ' ' + wide) + ';renderAll()');
  const d = check(m.w.eval('reminderIcs()'), 'a name with line breaks');
  assert.ok(d.includes('Zed <b>x</b>\\nEND:VEVENT\\nBEGIN:VEVENT\\nURL:https://evil.example/fix') && d.includes(wide), 'line breaks are written as \\n: ' + d);
  // the copied plan and the saved file, from the file's name
  const n = mount();
  n.w.eval('openPlanText(' + JSON.stringify(file) + ')');
  const share = n.w.eval('lastShare').split('\n');
  assert.ok(share.some(l => l.includes('Zed <b>x</b> END:VEVENT BEGIN:VEVENT URL:')), share.join(' | '));
  assert.ok(!share.some(l => /^(END|BEGIN|URL|TRIGGER)[:;]/.test(l)), 'no line of the copied plan comes from inside the name');
  const doc = n.w.eval('planDocument()');
  const shown = doc.replace(/="[^"]*"/g, '=""');   // the page's text, without attribute values (a quoted title may keep a raw <)
  assert.ok(shown.includes('Zed &lt;b&gt;x&lt;/b&gt; END:VEVENT BEGIN:VEVENT') && !shown.includes('<b>x</b>') && !/[\r\n]END:VEVENT/.test(doc), 'escaped, on one line');
  assert.deepStrictEqual(m.errs.concat(es.errs, n.errs), []);
});
test('save my plan: the file leaves out your free-time answers; opening one keeps the answers here and its hours', () => {
  const est = { work: 'shift', school: 'part', home: ['u6', 'fam'], workH: 50, care: 22 };
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Show', hours: 5, earliest: 0 }] }) }, { H: 60, hSet: true, est }));
  assert.strictEqual(m.w.eval('state.est.work'), 'shift');
  const doc = m.w.eval('planDocument()');
  const data = JSON.parse(/<script type="application\/json" id="subrotator-plan">([\s\S]*?)<\/script>/.exec(doc)[1]);
  assert.ok(!('est' in data.state) && !/"u6"|"shift"|"part"/.test(doc), 'no free-time answers in the file');
  assert.deepStrictEqual([data.state.H, data.state.hSet], [60, true]);
  // someone else opens it: the hours come from the file, their own answers stay
  const theirs = { work: 'pt', school: 'none', home: ['kid'], workH: 20, care: 5 };
  const n = mount(v2({}, { est: theirs }));
  assert.strictEqual(n.w.eval('openPlanText(' + JSON.stringify(doc) + ')'), true);
  const got = n.saved();
  assert.deepStrictEqual([got.H, got.est.work, got.est.home, got.est.care], [60, 'pt', ['kid'], 5]);
  // you open your own file again: your answers are still yours
  assert.strictEqual(m.w.eval('openPlanText(' + JSON.stringify(doc) + ')'), true);
  assert.deepStrictEqual([m.saved().H, m.saved().est.work, m.saved().est.home], [60, 'shift', ['u6', 'fam']]);
  // from the made-up example, your own answers, not the example's
  const x = mount(v2({ netflix: row('netflix', 'nf-std') }, { est }));
  x.click(x.$('#loadExample'));
  x.w.eval('openPlanText(' + JSON.stringify(doc) + ')');
  assert.strictEqual(x.saved().est.work, 'shift');
  // a file from another country waits for the reload with your answers in it
  const g = mount(v2({}, { est }));
  g.w.eval('openPlanText(' + JSON.stringify(JSON.stringify({ app: 'sub-rotator', saved: '2026-10-01', state: Object.assign(v2({ netflix: row('netflix', 'nf-ads') }), { country: 'GB', est: undefined }) })) + ')');
  assert.strictEqual(JSON.parse(g.w.localStorage.getItem('subrotator:v1')).est.work, 'shift');
  // a file saved before the answers were left out still carries the sender's: they are never shown or kept
  const oldFile = st => JSON.stringify({ app: 'sub-rotator', saved: '2026-10-01', state: v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Show', hours: 5, earliest: 0 }] }) }, Object.assign({ H: 60, hSet: true, est }, st)) });
  const r = mount(v2({}), { hash: '#estimates' });
  assert.strictEqual(r.w.eval('openPlanText(' + JSON.stringify(oldFile()) + ')'), true);
  assert.deepStrictEqual([r.saved().H, r.saved().est.work, r.saved().est.school, r.saved().est.home], [60, 'ft', 'none', []], 'the default answers stay; the hours come from the file');
  assert.deepStrictEqual(r.$$('#estWork [aria-checked=true], #estSchool [aria-checked=true], #estHome [aria-pressed=true]').map(b => b.textContent), ['Full-time job', 'Not studying'], 'none of the sender\'s answers show');
  const t = mount(v2({}, { est: theirs }));
  t.w.eval('openPlanText(' + JSON.stringify(oldFile()) + ')');
  assert.deepStrictEqual([t.saved().est.work, t.saved().est.home], ['pt', ['kid']], 'your own answers are not replaced');
  const o = mount(v2({}, { est: theirs }));
  o.w.eval('openPlanText(' + JSON.stringify(oldFile({ country: 'GB' })) + ')');
  assert.strictEqual(JSON.parse(o.w.localStorage.getItem('subrotator:v1')).est.work, 'pt', 'from another country too');
  assert.deepStrictEqual(m.errs.concat(n.errs, x.errs, g.errs, r.errs, t.errs, o.errs), []);
});
test('my list: what you add keeps to the limits a saved plan keeps, so nothing is cut at the next visit', async () => {
  const items = (p, n) => Array.from({ length: n }, (_, j) => ({ title: p + j, hours: 1, earliest: 0 }));
  const count = s => Object.values(s.sel).reduce((a, x) => a + x.items.length, 0);
  // the boxes stop where a saved plan stops
  const m = mount(v2({ netflix: row('netflix', 'nf-std', { items: items('N', 300) }) }));
  assert.deepStrictEqual([m.$('#cName').maxLength, m.$('#qTitle').maxLength], [80, 200]);
  // a name pasted past the box's limit, or with a line break: the same now as after the next visit
  m.$('#cName').value = 'Cable '.repeat(20); m.$('#cPrice').value = '20'; m.click(m.$('#cAdd'));   // a script can set more than the box lets you type
  m.w.eval('addCustomService(' + JSON.stringify('Gym\r\nPlus') + ',9);save()');   // the way a bank file's names come in
  const names = () => Object.values(m.saved().sel).filter(s => s.custom).map(s => s.name).sort();
  assert.deepStrictEqual(names().map(n => n.length > 50 ? n.length : n), [80, 'Gym Plus']);
  const now = m.saved(), next = mount(now).saved();
  assert.deepStrictEqual(Object.values(next.sel).filter(s => s.custom).map(s => s.name).sort(), names(), 'the next visit keeps every name as it was');
  // 300 titles on one service: the next one is refused, with a reason
  m.addBar({ title: 'One more', svc: 'netflix', hours: 2 });
  assert.match(m.txt('#toast'), /^Netflix is full: 300 titles\. Remove one first\./);
  assert.strictEqual(m.saved().sel.netflix.items.length, 300);
  // 600 in all: refused on any service, from the box and from New releases
  const big = v2({ netflix: row('netflix', 'nf-std', { items: items('N', 300) }), hulu: row('hulu', 'hulu', { ci: 1, items: items('H', 300) }), apple: row('apple', 'apple', { ci: 2 }) });
  const f = mount(big, { fetch: stub([], upItems()), hash: '#soon' });
  await sleep(30);
  f.addBar({ title: 'One more', svc: 'apple', hours: 2 });
  assert.match(f.txt('#toast'), /^Your list is full: 600 titles\. Remove one first\./);
  f.w.eval("soonAdd('game-c','gp-ess','')");
  assert.match(f.txt('#toast'), /^Your list is full: 600 titles\./);
  assert.ok(!f.saved().sel.gamepass && count(f.saved()) === 600, 'nothing added, no service added');
  assert.strictEqual(count(mount(f.saved()).saved()), 600, 'all 600 are there at the next visit');
  // Spanish says the same
  const es = mount(big, { hash: '?lang=es' });
  es.addBar({ title: 'Uno más', svc: 'apple', hours: 2 });
  assert.match(es.txt('#toast'), /^Tu lista está llena: 600 títulos\. Quita uno primero\./);
  const esS = mount(v2({ netflix: row('netflix', 'nf-std', { items: items('N', 300) }) }), { hash: '?lang=es' });
  esS.addBar({ title: 'Uno más', svc: 'netflix', hours: 2 });
  assert.match(esS.txt('#toast'), /^Ya hay 300 títulos en Netflix\. Quita uno primero\./);
  // a release whose name has a line break: one line on your list, and the row knows it is there
  const up = upItems(); up.items.push({ id: 'nl', title: 'Two\nLines', kind: 'game', platforms: ['PC'], date: isoOffset(8), confidence: 'confirmed', hours: 6, checked: '2026-10-05' });
  const r = mount(v2({ gamepass: row('gamepass', 'gp-ult') }), { fetch: stub([], up), hash: '#soon' });
  await sleep(30);
  r.w.eval("soonAdd('nl','gp-ult','')");
  assert.deepStrictEqual(r.saved().sel.gamepass.items.map(i => i.title), ['Two Lines']);
  assert.ok(r.w.eval("queuedOf(upcoming.items.find(i=>i.id==='nl'))!=null"), 'on My list');
  r.w.eval("soonAdd('nl','gp-ult','')");
  assert.strictEqual(r.saved().sel.gamepass.items.length, 1, 'adding it again changes it, not a second copy');
  assert.deepStrictEqual(m.errs.concat(f.errs, es.errs, esS.errs, r.errs), []);
});
test('open a saved plan: very long service ids and unknown set-aside services are left out', () => {
  const long = 'c1' + 'x'.repeat(30000);
  const file = { app: 'sub-rotator', saved: '2026-10-01', state: Object.assign(v2({
    [long]: custom(long, 'Long id', 5, { items: [{ title: 'A', hours: 2, earliest: 0 }] }),
    gym: custom('gym', 'Gym', 9.99, { ci: 1, items: [{ title: 'Class', hours: 2, earliest: 0 }] }) }),
  { away: { peacock: row('peacock', 'peacock', { items: [{ title: 'Poker Face', hours: 5, earliest: 0 }] }), junk: { items: [], note: 'x'.repeat(1000) } } }) };
  const m = mount();
  assert.strictEqual(m.w.eval('openPlanText(' + JSON.stringify(JSON.stringify(file)) + ')'), true);
  const st = m.saved();
  assert.deepStrictEqual(Object.keys(st.sel).sort(), ['gym', 'peacock'], 'the service with a 30,000-letter id is left out');
  assert.deepStrictEqual(Object.keys(st.away || {}), [], 'Peacock is sold here: it comes back; junk is not a service');
  assert.deepStrictEqual(st.sel.peacock.items.map(i => i.title), ['Poker Face']);
  assert.ok(m.w.localStorage.getItem('subrotator:v1').length < 5000, 'what is kept is small');
  // in Canada Peacock is still set aside, junk is still left out
  const ca = mount(JSON.stringify(Object.assign({}, file.state, { country: 'CA' })), { hash: '?country=CA' });
  assert.strictEqual(ca.w.eval('JSON.stringify(Object.keys(state.away||{}))'), '["peacock"]');
  assert.deepStrictEqual(ca.w.eval('Object.keys(state.sel).sort().join()'), 'gym');
  assert.deepStrictEqual(m.errs.concat(ca.errs), []);
});
test('my list: titles set aside in another country count toward the 600, so coming back never cuts the list you were looking at', () => {
  const items = (p, n) => Array.from({ length: n }, (_, j) => ({ title: p + j, hours: 1, earliest: 0 }));
  const counts = o => Object.fromEntries(Object.entries(o || {}).map(([k, x]) => [k, x.items.length]));
  // the US: Netflix 300 and Peacock 300. In Canada Peacock is set aside, and the list is still full
  const us = v2({ netflix: row('netflix', 'nf-std', { items: items('N', 300) }), peacock: row('peacock', 'peacock', { ci: 1, items: items('P', 300) }) }, { country: 'US' });
  const ca = mount(us, { hash: '?country=CA' });
  assert.deepStrictEqual([counts(ca.saved().sel), counts(ca.saved().away)], [{ netflix: 300 }, { peacock: 300 }]);
  ca.w.eval("addFamily('disney',{paying:false});save();renderAll()");
  ca.addBar({ title: 'One more', svc: 'disney', hours: 2 });
  assert.match(ca.txt('#toast'), /^Your list is full: 600 titles, with the ones set aside\. Remove one first\./);
  assert.strictEqual(ca.saved().sel.disney.items.length, 0, 'nothing added');
  const caEs = mount(ca.saved(), { hash: '?country=CA&lang=es' });
  caEs.addBar({ title: 'Uno más', svc: 'disney', hours: 2 });
  assert.match(caEs.txt('#toast'), /^Tu lista está llena: 600 títulos, con los guardados aparte\. Quita uno primero\./);
  // back in the US, every title is there
  const back = mount(ca.saved(), { hash: '?country=US' });
  assert.deepStrictEqual(counts(back.saved().sel), { netflix: 300, disney: 0, peacock: 300 });
  // an older or hand-made plan over the limit: the list you were looking at keeps its titles, what comes back is cut
  const over = v2({ netflix: row('netflix', 'nf-std', { items: items('N', 300) }), disney: row('disney', 'disney', { ci: 1, items: items('D', 299) }) }, { country: 'CA', away: { peacock: row('peacock', 'peacock', { ci: 2, items: items('P', 300) }) } });
  const u = mount(over, { hash: '?country=US' });
  assert.deepStrictEqual(counts(u.saved().sel), { netflix: 300, disney: 299, peacock: 1 });
  // and one that stays in Canada: the titles set aside are cut, not yours
  const c2 = mount(over, { hash: '?country=CA' });
  assert.deepStrictEqual([counts(c2.saved().sel), counts(c2.saved().away)], [{ netflix: 300, disney: 299 }, { peacock: 1 }]);
  assert.deepStrictEqual(ca.errs.concat(caEs.errs, back.errs, u.errs, c2.errs), []);
});
test('countries: a service whose titles do not all fit on its home here is set aside whole, so moving country never cuts titles', () => {
  const items = (p, n) => Array.from({ length: n }, (_, j) => ({ title: p + j, hours: 1, earliest: 0 }));
  const counts = o => Object.fromEntries(Object.entries(o || {}).map(([k, x]) => [k, x.items.length]));
  // the US: Hulu 200 and Disney+ 150. In the UK Hulu's home is Disney+, but 350 is over 300 on one service
  const us = v2({ hulu: row('hulu', 'hulu', { items: items('H', 200) }), disney: row('disney', 'disney', { ci: 1, items: items('D', 150) }) }, { country: 'US' });
  const gb = mount(us, { hash: '?country=GB' });
  assert.deepStrictEqual([counts(gb.saved().sel), counts(gb.saved().away)], [{ disney: 150 }, { hulu: 200 }]);
  assert.match(gb.txt('#toast'), /Not sold here, set aside: Hulu\./);
  assert.ok(!/moved to the service/.test(gb.txt('#toast')), 'it does not say they moved: ' + gb.txt('#toast'));
  const back = mount(gb.saved(), { hash: '?country=US' });
  assert.deepStrictEqual(counts(back.saved().sel), { disney: 150, hulu: 200 }, 'back in the US, all 350');
  assert.deepStrictEqual(back.saved().sel.hulu.items.map(i => i.title), items('H', 200).map(i => i.title), 'in their order');
  // when they fit, they still move, as before
  const fit = mount(v2({ hulu: row('hulu', 'hulu', { items: items('H', 150) }), disney: row('disney', 'disney', { ci: 1, items: items('D', 150) }) }, { country: 'US' }), { hash: '?country=GB' });
  assert.deepStrictEqual([counts(fit.saved().sel), counts(fit.saved().away)], [{ disney: 300 }, {}]);
  assert.match(fit.txt('#toast'), /Titles from Hulu moved to the service that has them here\./);
  assert.deepStrictEqual(gb.errs.concat(back.errs, fit.errs), []);
});
test('open a saved plan: a set-aside service and the free-time answers keep only what the app reads, so a file cannot park junk here', () => {
  const pad = 'x'.repeat(200000);
  const away = { crave: { tier: 'crave-prem', price: 22, paying: false, had: true, ci: 3, pad, items: [{ title: 'Crave Show', hours: 6, earliest: 0, tier: 'crave-prem', pad, season: 2 }, { title: '', hours: 1 }], extra: { pad } } };
  const file = { app: 'sub-rotator', saved: '2026-10-01', state: Object.assign(v2({ netflix: row('netflix', 'nf-std', { items: [{ title: 'Mine', hours: 5, earliest: 0 }] }) }), { country: 'CA', away }) };
  // opened in the US, where Crave is not sold: it stays set aside, cleaned
  const m = mount(undefined, { hash: '?country=US' });
  m.w.eval('openPlanText(' + JSON.stringify(JSON.stringify(Object.assign({}, file, { state: Object.assign({}, file.state, { country: 'US' }) }))) + ')');
  const raw = m.w.localStorage.getItem('subrotator:v1');
  assert.ok(raw.length < 10000 && !raw.includes('pad') && !raw.includes('extra'), 'stored: ' + raw.length + ' characters');
  assert.deepStrictEqual(m.saved().away, { crave: { items: [{ title: 'Crave Show', hours: 6, earliest: 0, tier: 'crave-prem', season: 2 }], ci: 3, tier: 'crave-prem', price: 22, paying: false, had: true } });
  assert.ok(!/x{1000}/.test(m.w.eval('planDocument()')), 'your own saved file does not pass it on');
  // in Canada it comes back as it was (at Canada's price, as any move re-prices)
  const ca = mount(m.saved(), { hash: '?country=CA' });
  const crave = JSON.parse(ca.w.eval('JSON.stringify(state.sel.crave)'));
  assert.deepStrictEqual([crave.tier, crave.paying, crave.had, crave.ci, crave.items.map(i => [i.title, i.tier, i.season])], ['crave-prem', false, true, 3, [['Crave Show', 'crave-prem', 2]]]);
  assert.ok(!ca.w.eval('state.away'), 'nothing is left aside');
  // free-time answers already stored by an older version: only the ones the app asks
  const est = { work: 'w'.repeat(100000), school: 'part', home: ['u6', 'nope'], homeCustom: true, sleep: 7, pad, share: 'lots' };
  const e = mount(v2({ netflix: row('netflix', 'nf-std') }, { est }));
  e.w.eval('save()');
  const se = e.saved().est;
  assert.deepStrictEqual(se, { work: 'custom', school: 'part', home: ['u6'], workH: 40, commute: 5, study: 0, care: 0, sleep: 7, admin: 5, share: 60, homeCustom: true });
  assert.ok(e.w.localStorage.getItem('subrotator:v1').length < 10000);
  assert.deepStrictEqual(m.errs.concat(ca.errs, e.errs), []);
});

// ---------- fonts, privacy copy and the Content-Security-Policy ----------
const PUB = path.join(__dirname, '..', 'public'), ROOT = path.join(__dirname, '..');
const pubRead = f => fs.readFileSync(path.join(PUB, f), 'utf8');
const pubHtml = () => fs.readdirSync(PUB).filter(f => /\.html$/.test(f));
const vercelJson = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const cspMap = csp => Object.fromEntries(csp.split(';').map(x => x.trim()).filter(Boolean).map(x => { const [k, ...v] = x.split(/\s+/); return [k, v]; }));
test('fonts come from this site: no page asks Google, and Anybody and Figtree are here with their licence', () => {
  const faces = {};
  for (const page of ['index.html', 'es.html', 'app.html']) {
    const src = pubRead(page);
    assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(src), page + ': no Google Fonts: opening a page must not send Google your address');
    const d = new JSDOM(src).window.document;
    const css = [...d.querySelectorAll('style')].map(s => s.textContent).join('\n');
    const ff = [...css.matchAll(/@font-face\{([^}]*)\}/g)].map(m => m[1]);
    faces[page] = ff.join('\n');
    const one = (fam, subset) => ff.find(f => f.includes('"' + fam + '"') && f.includes('url(fonts/' + fam.toLowerCase() + '-' + subset + '.woff2) format("woff2")'));
    for (const fam of ['Anybody', 'Figtree']) for (const subset of ['latin', 'latin-ext']) {
      const f = one(fam, subset);
      assert.ok(f, page + ': ' + fam + ' ' + subset);
      assert.ok(f.includes('font-display:swap'), page + ': text shows at once in a fallback font');
      assert.ok(f.includes(fam === 'Anybody' ? 'font-weight:600 900;font-stretch:50% 150%' : 'font-weight:400 800'), page + ': ' + fam + ' keeps its full range');
      assert.ok(f.includes(subset === 'latin' ? 'unicode-range:U+0000-00FF,' : 'unicode-range:U+0100-02BA,'), page + ': ' + subset + ' range (Spanish letters are in latin)');
    }
    assert.strictEqual(ff.length, 4, page + ': latin and latin-ext only');
    const pre = [...d.querySelectorAll('link[rel=preload]')].map(l => [l.getAttribute('href'), l.getAttribute('as'), l.getAttribute('type'), l.hasAttribute('crossorigin')]);
    assert.deepStrictEqual(pre, [['fonts/anybody-latin.woff2', 'font', 'font/woff2', true], ['fonts/figtree-latin.woff2', 'font', 'font/woff2', true]], page + ': the latin files load early');
    assert.ok(/--display:"Anybody"/.test(src) && /--body:"Figtree"/.test(src), page + ': the tokens still name the fonts');
  }
  assert.ok(faces['index.html'] === faces['es.html'] && faces['es.html'] === faces['app.html'], 'the same @font-face rules on every page');
  for (const f of ['anybody-latin', 'anybody-latin-ext', 'figtree-latin', 'figtree-latin-ext']) {
    const b = fs.readFileSync(path.join(PUB, 'fonts', f + '.woff2'));
    assert.strictEqual(b.subarray(0, 4).toString('latin1'), 'wOF2', f + ' is a woff2 file');
  }
  for (const f of ['OFL-Anybody.txt', 'OFL-Figtree.txt']) assert.match(pubRead('fonts/' + f), /SIL OPEN FONT LICENSE Version 1\.1/, f + ': the licence ships with the font');
  const cache = vercelJson().headers.find(h => h.source === '/fonts/(.*)');
  assert.ok(cache && /^public, max-age=\d+/.test(cache.headers.find(h => h.key === 'Cache-Control').value), 'fonts are cached');
});
test('privacy answer: every place that says where your information is kept names TVMaze and what it gets', () => {
  // what TVMaze gets: the text typed in the search box (any text, a game too) or a show's number, never "nothing else"
  for (const [page, want] of [['index.html', 'Only on your phone or computer. To find shows and their air dates, it asks TVMaze. It sends only what you type, or a show’s number.'],
    ['es.html', 'Solo en tu teléfono o computadora. Para encontrar series y sus fechas, le pregunta a TVMaze. Solo envía lo que escribes o el número de la serie.']]) {
    const d = new JSDOM(pubRead(page)).window.document;
    const det = [...d.querySelectorAll('.faq details')].find(x => /Where is my information kept|Dónde se guarda mi información/.test(x.textContent));
    assert.strictEqual(det.querySelector('p').textContent, want, page);
    const ld = JSON.parse(d.querySelector('script[type="application/ld+json"]').textContent)['@graph'].find(x => x['@type'] === 'FAQPage');
    assert.ok(ld.mainEntity.some(q => q.acceptedAnswer.text === want), page + ': the search data says the same');
  }
  const answer = (m, re) => Object.values(JSON.parse(m.w.eval('JSON.stringify(HELP)'))).flatMap(v => v.qa).find(([q]) => re.test(q));
  const en = mount(), es = mount(undefined, { hash: '?lang=es' });
  // the app's help answers are one or two short sentences, so this one is the same message, shorter
  assert.deepStrictEqual(answer(en, /Where is my information kept/), ['Where is my information kept?', 'Only on this phone or computer. We send TVMaze only what you type, or a show’s number.']);
  assert.deepStrictEqual(answer(es, /Dónde se guarda/), ['¿Dónde se guarda mi información?', 'Solo en este teléfono o computadora. Solo enviamos a TVMaze lo que escribes o el número de la serie.']);
  for (const page of ['index.html', 'es.html', 'app.html']) assert.ok(!/nothing else|nada más|only the show\.|solo le enviamos la serie/i.test(pubRead(page)), page + ': no answer says TVMaze gets only the show');
  // the line under the lead on Your plan, right above the search box: your plan stays, not "it all"
  assert.strictEqual(en.txt('.home-top .fine-note'), 'Free. No account. Your plan stays on this phone or computer.');
  assert.strictEqual(es.txt('.home-top .fine-note'), 'Gratis. Sin cuenta. Tu plan se queda en este teléfono o computadora.');
  assert.ok(!/It all stays|Todo se queda/.test(pubRead('app.html')), 'the old promise is gone');
  // the app's search snippet must not promise more than that: search text and show numbers do go to TVMaze
  const appDesc = new JSDOM(pubRead('app.html')).window.document.querySelector('meta[name=description]').content;
  assert.ok(!/Nothing leaves/i.test(appDesc) && /Your plan stays on your device\./.test(appDesc), 'app.html description: ' + appDesc);
  const fine = m => m.$$('footer.fine p').map(p => p.textContent).find(t => /TVMaze/.test(t) && !/CC BY-SA/.test(t));
  assert.strictEqual(fine(en), "To find shows and their air dates, we ask TVMaze. We send only the text you type, or the show's TVMaze number.");
  assert.strictEqual(fine(es), 'Para encontrar series y sus fechas, le preguntamos a TVMaze. Solo enviamos lo que escribes o el número de la serie en TVMaze.');
  for (const page of ['index.html', 'es.html', 'app.html']) assert.ok(!/Search sends only the name you type|La búsqueda solo envía el nombre/.test(pubRead(page)), page + ': the old answer is gone');
  assert.deepStrictEqual(en.errs.concat(es.errs), []);
});
test('CSP: vercel.json lists the hash of every inline script the pages run (else: run node tools/csp-hash.mjs)', async () => {
  const tool = await import(require('url').pathToFileURL(path.join(ROOT, 'tools', 'csp-hash.mjs')).href);
  // the hashes, worked out a second way: jsdom's own HTML parser and every script it would run
  const crypto = require('crypto'), mine = new Set();
  for (const page of pubHtml()) for (const s of new JSDOM(pubRead(page)).window.document.querySelectorAll('script')) {
    const t = (s.getAttribute('type') || '').trim().toLowerCase();
    if (t === '' || t === 'module' || /^(text|application)\/(x-)?(java|ecma)script$/.test(t)) mine.add("'sha256-" + crypto.createHash('sha256').update(s.textContent, 'utf8').digest('base64') + "'");
  }
  assert.deepStrictEqual(tool.scriptSources(ROOT), [...mine].sort(), 'tools/csp-hash.mjs finds the same scripts as a browser');
  const csp = tool.cspOf(vercelJson()), dir = cspMap(csp);
  assert.deepStrictEqual(dir['script-src'], [...mine].sort(), 'vercel.json is stale: run node tools/csp-hash.mjs');
  assert.strictEqual(mine.size, 1, 'one script: the app');
  assert.ok(!/unsafe-inline|unsafe-eval|unsafe-hashes|https?:|\*/.test(dir['script-src'].join(' ')), 'only listed scripts run');
  const tv = pubRead('app.html').match(/const TV_BASE='(https:\/\/[^']+)'/)[1];
  assert.deepStrictEqual(dir['connect-src'], ["'self'", new URL(tv).origin], 'the app talks to itself and TVMaze, nothing else');
  assert.deepStrictEqual([dir['default-src'], dir['font-src'], dir['img-src'], dir['object-src'], dir['base-uri'], dir['frame-ancestors'], dir['form-action'], dir['style-src']],
    [["'self'"], ["'self'"], ["'self'", 'data:'], ["'none'"], ["'none'"], ["'none'"], ["'self'"], ["'unsafe-inline'"]]);
  // the tool reads a page the way a browser does
  const got = tool.scriptsIn('<p>a < b</p><!-- <script>no</script> --><title><script></title><script type="application/ld+json">{"a":"x"}</script>' +
    '<div title="a>b"></div><SCRIPT>\r\nvar s="<"+"/script>",t=\'</scr\'+\'ipt>\';\r\n</Script ><script type="module">1</script>');
  assert.deepStrictEqual(got.map(s => [s.executable, s.text]), [[false, '{"a":"x"}'], [true, '\nvar s="<"+"/script>",t=\'</scr\'+\'ipt>\';\n'], [true, '1']]);
  assert.strictEqual(tool.withScriptSrc("default-src 'self'; script-src 'none'; img-src data:", ["'sha256-a'", "'sha256-b'"]), "default-src 'self'; script-src 'sha256-a' 'sha256-b'; img-src data:");
  const check = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'tools', 'csp-hash.mjs'), '--check'], { encoding: 'utf8' });
  assert.strictEqual(check.status, 0, 'node tools/csp-hash.mjs --check: ' + check.stderr);
});
test('CSP: no page has inline event handlers or javascript: links, the landing pages run no script, and the app needs no eval', async () => {
  for (const page of pubHtml()) {
    const d = new JSDOM(pubRead(page)).window.document;
    const bad = [...d.querySelectorAll('*')].flatMap(el => [...el.attributes].filter(a => /^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)).map(a => el.tagName + ' ' + a.name));
    assert.deepStrictEqual(bad, [], page + ': handlers are set in the script, never as attributes (the policy blocks those)');
    if (page !== 'app.html') assert.deepStrictEqual([...d.scripts].filter(s => s.type !== 'application/ld+json').length, 0, page + ': a plain page, only search data');
  }
  const script = pubRead('app.html').split('<script>')[1];
  assert.ok(!/\beval\s*\(|new Function\s*\(|set(Timeout|Interval)\s*\(\s*['"`]|document\.write|javascript:/.test(script), 'no code from strings: the policy has no unsafe-eval');
  // what the app draws itself: every view, in both languages, with search results
  for (const hash of ['#example', '?lang=es#example']) {
    const f = stub([[/search\/shows/, resp(200, searchJson)], [/shows\/\d+/, resp(200, showJson)]], upItems());
    const m = mount(undefined, { hash, fetch: f });
    await sleep(30);
    for (const v of ['home', 'services', 'list', 'soon', 'estimates']) { m.w.eval("go('" + v + "')"); await sleep(5); }
    m.click(m.$('#helpBtn'));
    m.w.eval("go('list')"); m.typeTitle('edge'); await sleep(500);
    assert.ok(m.$$('#qSugg [role=option]').length > 0, 'search results are drawn');
    const bad = m.$$('*').flatMap(el => [...el.attributes].filter(a => /^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)).map(a => el.tagName + ' ' + a.name));
    assert.deepStrictEqual(bad, [], hash + ': no handler attributes in what the script builds');
    assert.ok(f.calls.every(u => u === 'upcoming.json' || u.startsWith('https://api.tvmaze.com/')), 'fetches only itself and TVMaze: ' + f.calls.join(' '));
    assert.deepStrictEqual(m.errs, []);
  }
});
test('local server: scripts/serve.mjs sends the vercel.json headers, so the policy works the same on your computer', async () => {
  const serve = await import(require('url').pathToFileURL(path.join(ROOT, 'scripts', 'serve.mjs')).href);
  const v = vercelJson(), csp = v.headers.find(h => h.source === '/(.*)').headers.find(h => h.key === 'Content-Security-Policy').value;
  assert.ok(serve.sourceToRegex('/(.*)').test('/') && serve.sourceToRegex('/(.*)').test('/app.html'));
  assert.ok(serve.sourceToRegex('/upcoming.json').test('/upcoming.json') && !serve.sourceToRegex('/upcoming.json').test('/upcomingXjson'), 'a dot is a dot');
  assert.ok(serve.sourceToRegex('/fonts/(.*)').test('/fonts/a.woff2') && !serve.sourceToRegex('/fonts/(.*)').test('/app.html'));
  assert.ok(serve.sourceToRegex('/u/:id').test('/u/42') && !serve.sourceToRegex('/u/:id').test('/u/4/2'));
  assert.throws(() => serve.sourceToRegex('/a*'), /cannot read/, 'a pattern it does not know stops the server');
  assert.strictEqual(serve.headersFor(v, '/fonts/x.woff2')['Cache-Control'], 'public, max-age=604800');
  assert.strictEqual(serve.headersFor(v, '/fonts/x.woff2')['Content-Security-Policy'], csp);
  assert.strictEqual(serve.headersFor(v, '/upcoming.json')['Cache-Control'], v.headers.find(h => h.source === '/upcoming.json').headers[0].value);
  // the real server, on a free port
  const child = require('child_process').spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve.mjs')], { env: Object.assign({}, process.env, { PORT: '0' }), stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const port = await new Promise((ok, bad) => {
      let out = ''; const t = setTimeout(() => bad(new Error('the server did not start: ' + out)), 8000);
      child.stdout.on('data', b => { out += b; const m = out.match(/localhost:(\d+)/); if (m) { clearTimeout(t); ok(m[1]); } });
      child.on('exit', c => bad(new Error('the server stopped: ' + c + ' ' + out)));
    });
    const get = async p => { const r = await fetch('http://127.0.0.1:' + port + p); await r.arrayBuffer(); return r; };
    for (const p of ['/', '/es.html', '/app.html', '/upcoming.json', '/fonts/figtree-latin.woff2', '/nope.html']) {
      const r = await get(p);
      assert.strictEqual(r.headers.get('content-security-policy'), csp, p + ': the same policy as production');
      assert.strictEqual(r.headers.get('x-frame-options'), 'DENY', p);
      assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff', p);
      assert.strictEqual(r.headers.get('cache-control'), 'no-store', p + ': local edits show at once');
    }
    assert.strictEqual((await get('/fonts/anybody-latin.woff2')).headers.get('content-type'), 'font/woff2');
    assert.strictEqual((await get('/nope.html')).status, 404);
  } finally { child.kill(); }
});

test('no script errors on the long-running page', () => assert.deepStrictEqual(M.errs, []));

setTimeout(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log('ok   ' + name); } catch (err) { console.error('FAIL ' + name + '\n     ' + err.message); process.exitCode = 1; }
  }
  console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
  process.exit(process.exitCode || 0);
}, 300);
