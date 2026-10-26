// Pure-logic tests. Extracts the marked PURE / CSV / EST blocks from public/app.html and runs them in Node.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const block = (a, b) => js.match(new RegExp('// ==' + a + '-START==([\\s\\S]*)// ==' + b + '-END=='))[1];
const catalog = js.match(/const CATALOG=\[[\s\S]*?\n\];/)[0];
const code = block('PURE', 'PURE') + catalog + block('CSV', 'CSV') + block('EST', 'EST') + block('TV', 'TV') +
  '\nreturn {plan,analyzeStatement,makeSampleCsv,parseAmount,parseDateStr,parseCSV,detectColumns,estimate,estClone,estSetWork,estSetSchool,estToggleHome,estSnap,CATALOG,FAMILIES,tvSummary,tvService,tvFamilyOfService,dateMonthIndex,isoDay,FAMILY_DEFAULT,planMonthCost,isCovered,monthCosts};';
const L = new Function(code)();

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('ok   ' + name); } catch (e) { console.error('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; } };
const names = (arr) => arr.map(x => x.name);
const find = (arr, name) => arr.find(x => x.name === name);

// ---------- planner ----------
test('planner finishes the queue and beats keeping everything all year', () => {
  const svcs = [
    { id: 'a', name: 'Game Pass Ultimate', price: 22.99, earliest: 0, hours: 57 },
    { id: 'b', name: 'Netflix Standard', price: 20, earliest: 0, hours: 14 },
    { id: 'c', name: 'Disney+', price: 13.99, earliest: 2, hours: 17 },
    { id: 'd', name: 'Apple TV', price: 14.99, earliest: 3, hours: 10 },
    { id: 'e', name: 'PS Plus Extra', price: 16.99, earliest: 0, hours: 22 },
  ];
  const r = L.plan(svcs, 20);
  assert.strictEqual(r.unfinished, 0);
  assert.ok(r.cost < 160, 'rotation cost ' + r.cost);
  // respects earliest month
  r.grid[2].slice(0, 2).forEach(h => assert.strictEqual(h, 0)); // Disney+ not before month 2
  r.grid[3].slice(0, 3).forEach(h => assert.strictEqual(h, 0)); // Apple TV not before month 3
  // never exceeds monthly hours
  for (let m = 0; m < 12; m++) assert.ok(r.grid.reduce((t, row) => t + row[m], 0) <= 20 + 1e-9);
});
test('planner reports unfinished hours when time is too tight', () => {
  const svcs = [{ id: 'a', name: 'A', price: 10, earliest: 0, hours: 100 }];
  assert.ok(L.plan(svcs, 5).unfinished > 0);
});
test('planner handles 9 services (heuristic path) without losing hours', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ id: 's' + i, name: 'S' + i, price: 10 + i, earliest: i % 3, hours: 15 + i * 3 }));
  assert.strictEqual(L.plan(many, 25).unfinished, 0);
});

// ---------- parsing helpers ----------
test('parseAmount handles common bank formats', () => {
  const eq = (s, v) => assert.ok(Math.abs(L.parseAmount(s) - v) < 1e-9, s + ' -> ' + L.parseAmount(s));
  eq('$1,234.56', 1234.56); eq('(12.34)', -12.34); eq('12.34-', -12.34); eq('-5.00', -5); eq('19,99', 19.99); eq('1.234,56', 1234.56);
  assert.ok(isNaN(L.parseAmount('abc'))); assert.ok(isNaN(L.parseAmount('')));
});
test('parseDateStr handles formats and rejects text that only looks like a date', () => {
  const iso = (s, f) => { const t = L.parseDateStr(s, f || 'mdy'); return t == null ? null : new Date(t).toISOString().slice(0, 10); };
  assert.strictEqual(iso('2026-09-07'), '2026-09-07');
  assert.strictEqual(iso('9/7/2026'), '2026-09-07');
  assert.strictEqual(iso('07/09/2026', 'dmy'), '2026-09-07');
  assert.strictEqual(iso('Sep 7, 2026'), '2026-09-07');
  assert.strictEqual(iso('7 Sep 2026'), '2026-09-07');
  assert.strictEqual(iso('NETFLIX 2026'), null);
  assert.strictEqual(iso('hello 1'), null);
});

// ---------- statement import ----------
test('sample statement: finds streaming and gaming, ignores everyday spending', () => {
  const r = L.analyzeStatement(L.makeSampleCsv(new Date()), L.CATALOG);
  assert.ok(r.ok);
  assert.strictEqual(find(r.found, 'Netflix Standard').price, 19.99); // latest price after a hike, matching the list price
  assert.strictEqual(find(r.found, 'Disney+ with ads').price, 12.49);
  assert.strictEqual(find(r.found, 'Game Pass Ultimate').price, 22.99);
  assert.strictEqual(find(r.found, 'PS Plus Essential').price, 10.99); // loose PSN match accepted only because it recurs
  ['Spotify', 'YouTube Premium', 'Planet Fitness'].forEach(n => assert.ok(names(r.others).includes(n), n));
  names(r.others).forEach(n => assert.ok(!/Starbucks|Kroger|Shell|Amazon/.test(n), 'noise leaked: ' + n));
});
test('credit card export (positive charges) and a large price jump', () => {
  const cc = ['Transaction Date,Post Date,Description,Category,Type,Amount,Memo'];
  for (let m = 3; m >= 0; m--) {
    const d = (day) => { const x = new Date(2026, 8 - m, day); return (x.getMonth() + 1) + '/' + x.getDate() + '/' + x.getFullYear(); };
    cc.push(d(5) + ',' + d(6) + ',"NETFLIX.COM",Entertainment,Sale,20.00,');
    cc.push(d(9) + ',' + d(10) + ',"HULU 877-8244858 CA",Entertainment,Sale,' + (m > 1 ? '12.99' : '18.99') + ',');
    cc.push(d(20) + ',' + d(20) + ',PAYMENT THANK YOU,,Payment,-500.00,');
  }
  const r = L.analyzeStatement(cc.join('\n'), L.CATALOG);
  assert.ok(r.ok);
  assert.strictEqual(find(r.found, 'Hulu (No Ads)').price, 18.99); // nearest plan: $18.99 is the old no-ads price, not the ads plan
  assert.strictEqual(find(r.found, 'Hulu (No Ads)').catalogId, 'hulu-noads');
  assert.strictEqual(find(r.found, 'Netflix Standard').count, 4);
});
test('debit/credit columns, tax-inclusive price, ISO dates', () => {
  const co = ['Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit'];
  for (let m = 3; m >= 0; m--) {
    const d = (day) => { const x = new Date(2026, 8 - m, day); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0'); };
    co.push(d(4) + ',' + d(5) + ',1234,XBOX GAME PASS ULTIMATE,Entertainment,24.83,');
    co.push(d(11) + ',' + d(12) + ',1234,CRUNCHYROLL,Entertainment,9.99,');
    co.push(d(18) + ',' + d(19) + ',1234,PAYMENT,Payment,,300.00');
  }
  const r = L.analyzeStatement(co.join('\n'), L.CATALOG);
  assert.strictEqual(find(r.found, 'Game Pass Ultimate').price, 24.83);
  assert.strictEqual(find(r.found, 'Crunchyroll Fan').catalogId, 'crunchy');
});
test('headerless export with CRLF and bank-style descriptions', () => {
  const wf = [];
  for (let m = 3; m >= 0; m--) {
    const d = (day) => { const x = new Date(2026, 8 - m, day); return '"' + String(x.getMonth() + 1).padStart(2, '0') + '/' + String(day).padStart(2, '0') + '/' + x.getFullYear() + '"'; };
    wf.push(d(7) + ',"-19.99","*","","PURCHASE AUTHORIZED ON 09/07 NETFLIX.COM 866-579-7172 CA S5870"');
    wf.push(d(16) + ',"-15.99","*","","RECURRING PAYMENT AUTHORIZED ON 09/16 DISNEY PLUS 888-905-7888 CA S3"');
    wf.push(d(25) + ',"2000.00","*","","DIRECT DEPOSIT ACME"');
  }
  const r = L.analyzeStatement(wf.join('\r\n'), L.CATALOG);
  assert.strictEqual(find(r.found, 'Netflix Standard').price, 19.99);
  assert.strictEqual(find(r.found, 'Disney+ with ads').price, 15.99);
});
test('European export: semicolons, dd.mm.yyyy, decimal commas, no English header', () => {
  const eu = ['Datum;Beschreibung;Betrag'];
  for (let m = 3; m >= 0; m--) {
    const mm = String(9 - m).padStart(2, '0');
    eu.push('25.' + mm + '.2026;NETFLIX.COM;-19,99');
    eu.push('14.' + mm + '.2026;SPOTIFY AB;-11,99');
  }
  const r = L.analyzeStatement(eu.join('\n'), L.CATALOG);
  assert.ok(r.ok);
  assert.ok(find(r.found, 'Netflix Standard'));
  assert.ok(names(r.others).includes('Spotify'));
});
test('preamble rows and a single annual PS Plus charge map to the monthly rate', () => {
  const pre = ['Account Summary for 1234', 'Generated 09/20/2026', '', 'Date,Description,Amount,Running Bal.', '08/03/2026,PLAYSTATION PLUS 12M,-79.99,1200.00', '08/09/2026,COFFEE HOUSE,-4.50,1195.50'];
  const r = L.analyzeStatement(pre.join('\n'), L.CATALOG);
  const ps = find(r.found, 'PS Plus Essential');
  assert.ok(ps && ps.annual === true && ps.price === 10.99);
});
test('garbage and empty input fail cleanly', () => {
  assert.strictEqual(L.analyzeStatement('hello world\nthis is not a csv', L.CATALOG).ok, false);
  assert.strictEqual(L.analyzeStatement('', L.CATALOG).ok, false);
});

// ---------- time estimator ----------
test('estimator defaults: full-time job, no kids, matches the 2025 time-use survey (about 4 h free, 2.4 h of TV and games a day)', () => {
  const r = L.estimate(L.estClone());
  assert.strictEqual(r.free, 28.5);
  assert.ok(Math.abs(r.free / 7 - 4.07) < 0.01, 'about 4 hours of leisure a day');
  assert.ok(Math.abs(r.queueM - 74.1) < 0.1);
  assert.strictEqual(L.estSnap(r.queueM), 75);
  assert.ok(Math.abs(r.queueW / 7 - 2.44) < 0.01, 'about 2.4 hours a day of shows and games');
});
test('estimator: part-time, kids, commute, and over-capacity', () => {
  let e = L.estClone(); L.estSetWork(e, 'pt');
  assert.ok(Math.abs(L.estimate(e).queueM - 131.3) < 0.2);
  e = L.estClone(); L.estToggleHome(e, 'u6');
  assert.strictEqual(L.estimate(e).free, 14.5);
  e = L.estClone(); L.estSetWork(e, 'shift'); L.estToggleHome(e, 'u6'); L.estToggleHome(e, 'kid');
  assert.strictEqual(L.estimate(e).over, true);
  assert.strictEqual(L.estSnap(L.estimate(e).queueM), 5); // floor
});
test('estimator: toggling a home chip twice restores care; admin hours follow work status', () => {
  const e = L.estClone(); L.estToggleHome(e, 'u6'); L.estToggleHome(e, 'u6');
  assert.strictEqual(e.care, 0);
  L.estSetWork(e, 'none'); assert.strictEqual(e.admin, 6);
  L.estSetWork(e, 'ft'); assert.strictEqual(e.admin, 5);
});

// ---------- review fixes ----------
const stmt = (rows, head) => (head || 'Date,Description,Amount') + '\n' + rows.join('\n');
test('parseAmount reads accounting parens with a symbol, unicode minus, and CR', () => {
  assert.strictEqual(L.parseAmount('$ (12.34)'), -12.34);
  assert.strictEqual(L.parseAmount('USD(12.34)'), -12.34);
  assert.strictEqual(L.parseAmount('\u221212.34'), -12.34);
  assert.strictEqual(L.parseAmount('12.34 CR'), -12.34);
  assert.strictEqual(L.parseAmount('12.34 DR'), 12.34);
  assert.strictEqual(L.parseAmount('(12.34)'), -12.34);
});
test('parseDateStr rejects impossible calendar dates', () => {
  assert.strictEqual(L.parseDateStr('2026-02-30'), null);
  assert.strictEqual(L.parseDateStr('02/31/2026', 'mdy'), null);
  assert.strictEqual(L.parseDateStr('31/04/2026', 'dmy'), null);
  assert.strictEqual(L.parseDateStr('Feb 29, 2028'), Date.UTC(2028, 1, 29));
  assert.strictEqual(L.parseDateStr('Feb 29, 2027'), null);
});
test('brand words inside other words do not become subscriptions', () => {
  const r = L.analyzeStatement(stmt(['07/03/2026,COSTCO WHSE #0332 KAHULUI HI,-12.99', '08/03/2026,STOPS PLUS GAS,-10.99', '09/03/2026,SCHULUNG GMBH,-12.99']), L.CATALOG);
  assert.strictEqual(r.found.length, 0, JSON.stringify(r.found));
});
test('a game bought after the last renewal does not become the subscription price', () => {
  const r = L.analyzeStatement(stmt(['07/05/2026,PLAYSTATION NETWORK,-10.99', '08/05/2026,PLAYSTATION NETWORK,-10.99', '09/05/2026,PLAYSTATION NETWORK,-10.99', '09/20/2026,PLAYSTATION NETWORK,-24.99']), L.CATALOG);
  const f = r.found.find(x => x.key === 'psplus');
  assert.ok(f, 'PS Plus found');
  assert.strictEqual(f.price, 10.99);
  assert.strictEqual(f.catalogId, 'ps-ess');
  assert.strictEqual(f.count, 3);
});
test('Wells Fargo recurring-payment descriptors keep merchants apart', () => {
  const rows = [];
  ['07', '08', '09'].forEach(m => {
    rows.push(m + '/05/2026,RECURRING PAYMENT AUTHORIZED ON ' + m + '/04 SPOTIFY USA 877-7781161 NY,-12.99');
    rows.push(m + '/09/2026,RECURRING PAYMENT AUTHORIZED ON ' + m + '/08 PLANET FITNESS NH,-24.99');
  });
  const r = L.analyzeStatement(stmt(rows), L.CATALOG);
  assert.deepStrictEqual(r.others.map(o => o.name).sort(), ['Planet Fitness', 'Spotify']);
});
test('the world TV services are found on a statement by name and price; Viking, Acorns and Amazon shopping are not', () => {
  const rows = [];
  ['07', '08', '09'].forEach(m => {
    rows.push(m + '/03/2026,VIKI.COM,-7.99');
    rows.push(m + '/04/2026,KOCOWA,-8.99');
    rows.push(m + '/05/2026,VIX.COM,-6.99');
    rows.push(m + '/06/2026,BRITBOX LLC NEW YORK NY,-10.99');
    rows.push(m + '/07/2026,ACORN.TV ACORNMEDIA AT 888-370-2597 MD,-9.99');
    rows.push(m + '/08/2026,AMAZON PRIME*A1B2C3D4E AMZN.COM/BILL,-14.99');
    rows.push(m + '/09/2026,VIKING CRUISES,-250.00');
    rows.push(m + '/10/2026,ACORNS INVEST,-5.00');
    rows.push(m + '/11/2026,AMAZON MKTPL*AB12CD,-23.17');
  });
  const r = L.analyzeStatement(stmt(rows), L.CATALOG);
  assert.ok(r.ok, JSON.stringify(r));
  const got = Object.fromEntries(r.found.map(x => [x.key, x.catalogId]));
  assert.deepStrictEqual(got, { viki: 'viki', kocowa: 'kocowa-prem', vix: 'vix', britbox: 'britbox', acorn: 'acorn', prime: 'amazon-prime' });
  const yr = L.analyzeStatement(stmt(['01/12/2026,AMAZON PRIME*Z9Y8X7 AMZN.COM/BILL,-139.00', '07/14/2026,PRIME VIDEO *J80 SEATTLE WA,-8.99', '08/14/2026,PRIME VIDEO *J80 SEATTLE WA,-8.99']), L.CATALOG);
  assert.deepStrictEqual(yr.found.filter(x => x.key === 'prime').map(x => [x.catalogId, x.annual]), [['amazon-prime', true]], 'the yearly membership decides, not the Prime Video charges beside it');
});
test('Prime Video on a statement: a rental, a purchase or a channel is not the subscription; the $4.99 add-on means no ads', () => {
  const run = rows => L.analyzeStatement(stmt(rows), L.CATALOG).found;
  const prime = rows => run(rows).filter(x => x.key === 'prime').map(x => [x.catalogId, x.price]);
  assert.deepStrictEqual(prime(['09/18/2026,PRIME VIDEO*2K3L4M5N6 888-802-3080 WA,-5.99']), [], 'one rental');
  assert.deepStrictEqual(prime(['09/18/2026,PRIME VIDEO*9Z8Y7X6 888-802-3080 WA,-19.99']), [], 'one purchase');
  assert.deepStrictEqual(prime(['03/12/2026,AMAZON PRIME*Z9Y8X7 AMZN.COM/BILL,-139.00', '09/18/2026,PRIME VIDEO*2K3L4M5N6,-5.99']), [['amazon-prime', 14.99]], 'a rental never replaces the membership');
  const months = ['07', '08', '09'];
  assert.deepStrictEqual(prime(months.flatMap(m => [m + '/05/2026,AMAZON PRIME*A1 AMZN.COM/BILL,-14.99', m + '/11/2026,PRIME VIDEO CHANNELS,-10.99'])), [['amazon-prime', 14.99]], 'a channel is another service');
  const both = run(months.map(m => m + '/06/2026,PRIME VIDEO CHANNELS BRITBOX,-10.99'));
  assert.deepStrictEqual(both.map(x => x.key), ['britbox'], 'counted once, as BritBox');
  assert.deepStrictEqual(prime(months.flatMap(m => [m + '/05/2026,AMAZON PRIME*A1 AMZN.COM/BILL,-14.99', m + '/05/2026,PRIME VIDEO*ULTRA,-4.99'])), [['amazon-prime-noads', 19.98]], 'Amazon Prime with the add-on');
  assert.deepStrictEqual(prime(months.flatMap(m => [m + '/02/2026,PRIME VIDEO *J80 SEATTLE WA,-8.99', m + '/02/2026,PRIME VIDEO *J80 SEATTLE WA,-4.99'])), [['prime-noads', 13.98]], 'Prime Video with the add-on');
  assert.deepStrictEqual(prime(months.map(m => m + '/02/2026,PRIME VIDEO *J80 SEATTLE WA,-8.99')), [['prime', 8.99]], 'Prime Video, monthly');
});
test('a bare VIKI or VIX needs a monthly pair: a person or another company is not a subscription', () => {
  const keys = rows => L.analyzeStatement(stmt(rows), L.CATALOG).found.map(x => x.key);
  assert.deepStrictEqual(keys(['10/05/2026,ZELLE TO VIKI PATEL,-12.00']), []);
  assert.deepStrictEqual(keys(["10/05/2026,SQ *VIKI'S NAILS SPA,-15.00"]), []);
  assert.deepStrictEqual(keys(['10/05/2026,VIX TECHNOLOGY TRANSIT,-10.00']), []);
  assert.deepStrictEqual(keys(['10/05/2026,VIKI.COM,-7.99']), ['viki'], 'its own name is enough');
  assert.deepStrictEqual(keys(['10/05/2026,VIX.COM,-6.99']), ['vix']);
});
test('an Amount column wins over a text Debit/Credit indicator column', () => {
  const r = L.analyzeStatement(stmt(['07/07/2026,NETFLIX.COM,-17.99,Debit', '08/07/2026,NETFLIX.COM,-17.99,Debit', '09/07/2026,NETFLIX.COM,-17.99,Debit', '09/08/2026,PAYROLL,2400.00,Credit'], 'Date,Description,Amount,Debit/Credit'), L.CATALOG);
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.found[0].catalogId, 'nf-std');
  const r2 = L.analyzeStatement(stmt(['07/07/2026,NETFLIX.COM,-17.99,1234', '08/07/2026,NETFLIX.COM,-17.99,1234', '09/07/2026,NETFLIX.COM,-17.99,1234'], 'Date,Description,Amount,Debit Card'), L.CATALOG);
  assert.ok(r2.ok && r2.found.length === 1, JSON.stringify(r2));
});
test('semicolon file with decimal commas and commas in descriptions parses as semicolons', () => {
  const rows = L.parseCSV('Date;Description;Amount\n07/07/2026;NETFLIX, INC;-17,99\n08/07/2026;NETFLIX, INC;-17,99\n09/07/2026;NETFLIX, INC;-17,99');
  assert.strictEqual(rows[0].length, 3, JSON.stringify(rows[0]));
  assert.strictEqual(rows[1][1], 'NETFLIX, INC');
});
test('tab file after a long preamble parses as tabs', () => {
  const pre = Array.from({ length: 12 }, (_, i) => 'Account summary line ' + (i + 1)).join('\n');
  const rows = L.parseCSV(pre + '\nDate\tDescription\tAmount\n07/07/2026\tNETFLIX.COM\t-17.99\n08/07/2026\tNETFLIX.COM\t-17.99');
  assert.ok(rows.some(r => r.length === 3 && r[1] === 'NETFLIX.COM'), JSON.stringify(rows.slice(-2)));
});
test('statement import: a hostile file stays fast; long cells are cut; Acorn TV and accounting parens still read', () => {
  const fast = (what, f) => { const t0 = Date.now(); f(); const ms = Date.now() - t0; assert.ok(ms < 1000, what + ' took ' + ms + ' ms'); };
  fast('( and 80,000 digits', () => L.parseAmount('(' + '1'.repeat(80000)));
  fast('( and 80,000 digits, closed', () => assert.ok(L.parseAmount('(' + '1'.repeat(80000) + ')') < 0));
  fast('ACORN, 80,000 spaces and x', () => assert.ok(!L.FAMILIES.find(f => f.k === 'acorn').re.test('ACORN' + ' '.repeat(80000) + 'x')));
  fast('a file of both, in one row', () => L.analyzeStatement('Date,Description,Amount\n09/07/2026,ACORN' + ' '.repeat(80000) + 'x,(' + '1'.repeat(80000) + '\n10/07/2026,ACORN TV,-9.99\n', L.CATALOG));
  const rows = L.parseCSV('a,"' + 'b'.repeat(1000) + '","' + '""'.repeat(1000) + '"\nc,' + 'd'.repeat(1000));
  assert.deepStrictEqual([rows[0][1].length, rows[0][2].length, rows[1][1].length], [256, 256, 256], 'a cell keeps 256 characters');
  const acorn = ['ACORN.TV', 'ACORN TV', 'ACORN . TV', 'ACORNTV', 'ACORN. TV', 'ACORNMEDIA'];
  assert.deepStrictEqual(acorn.filter(d => L.FAMILIES.find(f => f.k === 'acorn').re.test(d)), acorn, 'every way a bank writes Acorn TV');
  assert.deepStrictEqual(['(9.99)', '( 9.99 )', '$ (12.34)', '9.99', '(x) 9.99', '9.99 (x)', ')9.99('].map(L.parseAmount), [-9.99, -9.99, -12.34, 9.99, 9.99, 9.99, 9.99], 'parens around a number, and only then');
});
test('statement import: finding the date column stays fast on a long header cell, and still prefers the transaction date', () => {
  const t0 = Date.now();
  assert.strictEqual(L.detectColumns([['trans'.repeat(40000), 'x'], ['1', '2']]), null, 'no date column');   // /trans.*date/ took ~13 s on this
  assert.ok(Date.now() - t0 < 1000, 'took ' + (Date.now() - t0) + ' ms');
  const col = h => L.detectColumns([h, ['07/07/2026', '07/08/2026', 'NETFLIX.COM', '-17.99']]);
  assert.strictEqual(col(['Posting Date', 'Trans. Date', 'Description', 'Amount']).date, 1, 'Trans. Date beats Posting Date');
  assert.strictEqual(col(['Posted Date', 'Transaction Date', 'Description', 'Amount']).date, 1);
  assert.strictEqual(col(['Posted', 'Purchase date', 'Description', 'Amount']).date, 1);
  assert.strictEqual(col(['Posted', ' Date', 'Description', 'Amount']).date, 1, 'a cell that starts with Date');
  assert.strictEqual(col(['Datum', 'Fecha', 'Concepto', 'Importe']).date, 1, 'Spanish');
  assert.strictEqual(col(['Date transferred', 'Trans date', 'Description', 'Amount']).date, 0, 'date before trans is a plain date column, found first');
});
test('Netflix with ads is on the confirmed price list (no estimate mark)', () => {
  assert.ok(!L.CATALOG.find(c => c.id === 'nf-ads').est);
});

// ---------- per-item release months ----------
test('a later-releasing item does not delay items that are out now (the Netflix-in-December case)', () => {
  const r = L.plan([{ id: 'n', name: 'Netflix', price: 20, hours: 20, earliest: 0, chunks: [{ hours: 10, earliest: 0 }, { hours: 10, earliest: 3 }] }], 20);
  assert.strictEqual(r.unfinished, 0);
  assert.deepStrictEqual(r.grid[0].map(h => (h > 0 ? 1 : 0)), [1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.strictEqual(r.cost, 40);
  const old = L.plan([{ id: 'n', name: 'Netflix', price: 20, hours: 20, earliest: 3 }], 20);
  assert.ok(old.grid[0].slice(0, 3).every(h => h === 0), 'a service-level month still delays everything');
});
test('chunks: hours are conserved, nothing is played before its month, cost is per active month', () => {
  const svcs = [
    { id: 'a', name: 'A', price: 15, hours: 35, chunks: [{ hours: 20, earliest: 0 }, { hours: 15, earliest: 5 }] },
    { id: 'b', name: 'B', price: 12, hours: 30, chunks: [{ hours: 30, earliest: 2 }] },
    { id: 'c', name: 'C', price: 9, hours: 25, chunks: [{ hours: 10, earliest: 0 }, { hours: 15, earliest: 8 }] },
  ];
  const r = L.plan(svcs, 20);
  assert.ok(r.unfinished < 1e-9);
  svcs.forEach((s, i) => {
    assert.ok(Math.abs(r.grid[i].reduce((a, b) => a + b, 0) - s.hours) < 1e-9, 'hours conserved for ' + s.name);
  });
  assert.ok(r.grid[1].slice(0, 2).every(h => h === 0), 'B not before month 2');
  const sum = (row, a, b) => row.slice(a, b).reduce((x, y) => x + y, 0);
  assert.ok(sum(r.grid[0], 0, 5) <= 20 + 1e-9, 'A: only its first 20h are out before month 5');
  assert.ok(sum(r.grid[2], 0, 8) <= 10 + 1e-9, 'C: only its first 10h are out before month 8');
  for (let m = 0; m < 12; m++) assert.ok(r.grid.reduce((t, row) => t + row[m], 0) <= 20 + 1e-9);
  const expected = svcs.reduce((t, s, i) => t + r.grid[i].filter(h => h > 0).length * s.price, 0);
  assert.ok(Math.abs(r.cost - expected) < 1e-9);
});
test('chunks: a month-11 item is still reachable, and an item beyond what fits is reported unfinished', () => {
  const r = L.plan([{ id: 'a', name: 'A', price: 10, hours: 10, chunks: [{ hours: 10, earliest: 11 }] }], 20);
  assert.strictEqual(r.unfinished, 0);
  assert.ok(r.grid[0][11] > 0);
  const tight = L.plan([{ id: 'a', name: 'A', price: 10, hours: 40, chunks: [{ hours: 40, earliest: 11 }] }], 20);
  assert.ok(Math.abs(tight.unfinished - 20) < 1e-9);
});
test('chunks and the plain {hours, earliest} shape give the same plan', () => {
  const a = L.plan([{ id: 'a', name: 'A', price: 10, hours: 30, earliest: 2 }, { id: 'b', name: 'B', price: 14, hours: 25, earliest: 0 }], 20);
  const b = L.plan([{ id: 'a', name: 'A', price: 10, hours: 30, earliest: 2, chunks: [{ hours: 30, earliest: 2 }] }, { id: 'b', name: 'B', price: 14, hours: 25, earliest: 0, chunks: [{ hours: 25, earliest: 0 }] }], 20);
  assert.deepStrictEqual(a.grid, b.grid);
  assert.strictEqual(a.cost, b.cost);
});

// ---------- TVMaze helpers (browser side) ----------
const ep = (season, number, airdate, runtime) => ({ season, number, airdate, runtime });
const show = (over, eps) => Object.assign({ id: 1, name: 'S', status: 'Running', premiered: null, runtime: null, averageRuntime: null, webChannel: { name: 'Netflix' }, network: null, _embedded: { episodes: eps || [] } }, over || {});
test('tvSummary: a new series takes its first air date, total hours, and is unconfirmed while in development', () => {
  const eps = [ep(1, 1, '2026-12-05', 30), ep(1, 2, '2026-12-05', 30), ep(1, 3, '2026-12-05', 30), ep(1, 4, '2026-12-05', 30)];
  const r = L.tvSummary(show({ status: 'In Development' }, eps), '2026-10-06');
  assert.strictEqual(r.date, '2026-12-05');
  assert.strictEqual(r.hours, 2);
  assert.strictEqual(r.confidence, 'unconfirmed');
  assert.strictEqual(r.service, 'netflix');
  assert.strictEqual(r.channel, 'Netflix');
  assert.strictEqual(r.season, 1);
  assert.strictEqual(L.tvSummary(show({ status: 'Running' }, eps), '2026-10-06').confidence, 'confirmed');
  const premiereOnly = L.tvSummary(show({ status: 'Running' }, [ep(1, 1, '2026-12-05', 50)]), '2026-10-06');
  assert.deepStrictEqual([premiereOnly.date, premiereOnly.hours], ['2026-12-05', null], 'one listed episode of an upcoming season is not a 50-minute season');
  assert.strictEqual(L.tvSummary(show({ status: 'Running' }, []), '2026-10-06').confidence, 'unconfirmed', 'no date yet: nothing is confirmed');
});
test('tvSummary: a returning show uses its next season, not the series premiere', () => {
  const eps = [ep(1, 1, '2022-01-01', 60), ep(1, 2, '2022-01-08', 60), ep(2, 1, '2026-12-05', 15), ep(2, 2, '2026-12-12', 15), ep(2, 3, '2026-12-19', 15), ep(2, 4, '2026-12-26', 15)];
  const r = L.tvSummary(show({ premiered: '2022-01-01' }, eps), '2026-10-06');
  assert.strictEqual(r.date, '2026-12-05');
  assert.strictEqual(r.hours, 1);
  assert.strictEqual(r.season, 2);
  assert.strictEqual(r.episodes, 4);
  const pinned = L.tvSummary(show({}, eps), '2026-10-06', 1);
  assert.strictEqual(pinned.date, '2022-01-01');
  assert.strictEqual(pinned.hours, 2);
  assert.strictEqual(L.tvSummary(show({ premiered: '2022-01-01' }, eps), '2026-10-06', 9).date, null, 'an unknown season never falls back to the premiere');
});
test('tvSummary: a show that is fully out reports everything; episode lengths must all be known for hours', () => {
  const out = [ep(1, 1, '2024-03-01', 50), ep(1, 2, '2024-03-08', 50)];
  const r = L.tvSummary(show({ status: 'Ended' }, out), '2026-10-06');
  assert.strictEqual(r.date, '2024-03-01');
  assert.strictEqual(r.hours, 1.7);
  assert.strictEqual(L.tvSummary(show({}, [ep(1, 1, '2026-12-01', null)]), '2026-10-06').hours, null);
  assert.strictEqual(L.tvSummary(show({ averageRuntime: 30 }, [1, 2, 3, 4].map(n => ep(1, n, '2026-12-01', null))), '2026-10-06').hours, 2);
  assert.strictEqual(L.tvSummary(show({}, [ep(1, 1, '2026-12-01', 60), ep(1, 2, '2026-12-01', null)]), '2026-10-06').hours, null);
});
test('tvSummary: with no episode list it falls back to the premiere, and bad data never throws', () => {
  assert.strictEqual(L.tvSummary(show({ premiered: '2027-01-15' }, []), '2026-10-06').date, '2027-01-15');
  assert.strictEqual(L.tvSummary(show({ premiered: 'soon' }, []), '2026-10-06').date, null);
  assert.strictEqual(L.tvSummary(null, '2026-10-06').date, null);
  assert.strictEqual(L.tvSummary({}, '2026-10-06').service, null);
  assert.strictEqual(L.tvSummary(show({}, [ep(1, 1, '2026-02-30', 30), ep(1, 2, 'nope', 30)]), '2026-10-06').date, null, 'impossible air dates are ignored');
  assert.strictEqual(L.tvSummary(show({ webChannel: null, network: { name: 'Some Network' } }, []), '2026-10-06').service, null);
});
test('tvService, family lookup, and defaults line up with the catalog', () => {
  [['Netflix', 'netflix'], ['Disney+', 'disney'], ['Hulu', 'hulu'], ['HBO Max', 'max'], ['Peacock', 'peacock'], ['Apple TV+', 'apple'], ['Paramount+', 'paramount'], ['Crunchyroll', 'crunchy']]
    .forEach(([n, k]) => assert.strictEqual(L.tvService(n), k, n));
  [['Prime Video', 'prime'], ['Amazon Freevee', 'prime'], ['Viki', 'viki'], ['KOCOWA+', 'kocowa'], ['ViX', 'vix'], ['BritBox', 'britbox'], ['Acorn TV', 'acorn']].forEach(([n, k]) => assert.strictEqual(L.tvService(n), k, n));
  ['Tubi', 'YouTube', 'tvN', 'Viking TV', 'Acorns', '', null].forEach(n => assert.strictEqual(L.tvService(n), null, String(n)));
  assert.strictEqual(L.tvFamilyOfService('nf-ads'), 'netflix');
  assert.strictEqual(L.tvFamilyOfService('gp-pc'), 'gamepass');
  assert.strictEqual(L.tvFamilyOfService('c123'), null);
  L.FAMILIES.forEach(f => {
    assert.ok(L.FAMILY_DEFAULT[f.k], 'default tier for ' + f.k);
    assert.ok(f.tiers.includes(L.FAMILY_DEFAULT[f.k]), f.k + ' default is one of its tiers');
    assert.ok(L.CATALOG.some(c => c.id === L.FAMILY_DEFAULT[f.k]), f.k + ' default exists in the catalog');
  });
});
test('dateMonthIndex counts whole months from the start of the window', () => {
  assert.strictEqual(L.dateMonthIndex('2026-10-20', 2026, 9), 0);
  assert.strictEqual(L.dateMonthIndex('2026-12-01', 2026, 9), 2);
  assert.strictEqual(L.dateMonthIndex('2027-02', 2026, 9), 4);
  assert.strictEqual(L.dateMonthIndex('2027-10-01', 2026, 9), 12);
  assert.strictEqual(L.dateMonthIndex('2026-08-30', 2026, 9), -2);
  assert.strictEqual(L.dateMonthIndex('soon', 2026, 9), null);
  assert.strictEqual(L.dateMonthIndex(null, 2026, 9), null);
});

// ---------- design tokens ----------
function tokenBlocks() {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const grab = (start) => { const i = css.indexOf(start); if (i < 0) throw new Error('block ' + start); const j = css.indexOf('}', i); return css.slice(i, j); };
  const vars = block => { const o = {}; block.replace(/--([a-z0-9-]+):\s*([^;]+);/g, (m, k, v) => { o[k] = v.trim(); }); return o; };
  return { light: vars(grab(':root{')), darkMedia: vars(grab(':root:not([data-theme="light"]){')), darkForced: vars(grab(':root[data-theme="dark"]{')) };
}
const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (a, b, t) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
test('tokens: the dark blocks define exactly the same names as each other, and as the light block where it matters', () => {
  const T = tokenBlocks();
  assert.deepStrictEqual(T.darkMedia, T.darkForced, 'prefers-color-scheme dark and data-theme dark must match');
  for (let i = 0; i < 10; i++) { assert.ok(T.light['svc' + i], 'light svc' + i); assert.ok(T.darkMedia['svc' + i], 'dark svc' + i); }
  assert.ok(T.light.oncount && T.darkMedia.oncount);
});
test('tokens: every service colour reaches 3:1 on its surface and on the "off" timeline cell, in both themes, and the badge text reaches 4.5:1', () => {
  const T = tokenBlocks();
  [['light', T.light], ['dark', T.darkMedia]].forEach(([name, t]) => {
    const off = mix(t.surface, t.line, 0.5);
    for (let i = 0; i < 10; i++) {
      assert.ok(ratio(t['svc' + i], t.surface) >= 3, name + ' svc' + i + ' on surface ' + ratio(t['svc' + i], t.surface).toFixed(2));
      assert.ok(ratio(t['svc' + i], off) >= 3, name + ' svc' + i + ' on off cell ' + ratio(t['svc' + i], off).toFixed(2));
    }
    assert.ok(ratio(t.oncount, t.pink) >= 4.5, name + ' badge text ' + ratio(t.oncount, t.pink).toFixed(2));
  });
});
test('layout source: the timeline no longer forces a width wider than a phone, and the dropdown spans the add bar', () => {
  assert.ok(!/\.gantt\{[^}]*min-width/.test(html));
  assert.ok(/\.qadd\{position:relative/.test(html));
  assert.ok(/\.sugg\{position:absolute;left:0;right:0;top:50px/.test(html));
});

// ---------- tiers: a higher tier includes the lower ones ----------
test('planner: a covered tier is free in months its covering tier is active', () => {
  const ult = { id: 'gp-ult', name: 'Ultimate', price: 22.99, hours: 10, earliest: 0, covers: ['gp-ess', 'gp-prem', 'gp-pc'] };
  const ess = { id: 'gp-ess', name: 'Essential', price: 9.99, hours: 10, earliest: 0 };
  const grid = [[10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [10, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]];
  assert.strictEqual(L.planMonthCost([ult, ess], grid, 0), 22.99);
  assert.strictEqual(L.planMonthCost([ult, ess], grid, 1), 9.99);
  assert.strictEqual(L.isCovered([ult, ess], grid, 1, 0), true);
  assert.strictEqual(L.isCovered([ult, ess], grid, 0, 0), false, 'covering never runs the other way');
  assert.strictEqual(L.planMonthCost([ult, ess], grid, 2), 0);
});
test('planner: with room for both, it plays a basic-tier game inside the top-tier month instead of paying twice', () => {
  const r = L.plan([
    { id: 'gp-ult', name: 'Ultimate', price: 22.99, hours: 20, earliest: 0, covers: ['gp-ess'] },
    { id: 'gp-ess', name: 'Essential', price: 9.99, hours: 10, earliest: 0 },
  ], 30);
  assert.strictEqual(r.unfinished, 0);
  assert.ok(Math.abs(r.cost - 22.99) < 1e-9, 'one Ultimate month covers both: ' + r.cost);
});
test('planner: live games are watched in their own month or missed, before anything else', () => {
  // a season on one service from month 2 to month 5, 6 hours a month; a long show on another service that is cheaper to binge
  const season = { id: 's', name: 'Sports', price: 10, chunks: [2, 3, 4, 5].map(m => ({ hours: 6, earliest: m, live: true })), hours: 24 };
  const show = { id: 't', name: 'Show', price: 12, earliest: 0, hours: 40 };
  const r = L.plan([season, show], 20);
  assert.strictEqual(r.unfinished, 0);
  assert.deepStrictEqual(r.grid[0].map(h => Math.round(h)), [0, 0, 6, 6, 6, 6, 0, 0, 0, 0, 0, 0], 'paid every month of the season, never before or after');
  // live hours cannot wait for a later month: with no free time left over, games are missed (unfinished), not moved
  const tight = L.plan([{ id: 's', name: 'Sports', price: 10, chunks: [{ hours: 30, earliest: 1, live: true }], hours: 30 }], 20);
  assert.strictEqual(Math.round(tight.unfinished), 10);
  assert.deepStrictEqual(tight.grid[0].map(h => Math.round(h)), [0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});
test('statement import: a country with the day first reads 03/04 as April 3; Spanish month names', () => {
  const csv = 'Date,Description,Amount\n03/04/2026,NETFLIX.COM,-7.99\n03/05/2026,NETFLIX.COM,-7.99\n03/06/2026,NETFLIX.COM,-7.99\n';
  const us = L.analyzeStatement(csv, L.CATALOG), gb = L.analyzeStatement(csv, L.CATALOG, { dmy: true });
  const last = r => new Date(r.found.find(f => f.key === 'netflix').last).toISOString().slice(0, 10);
  assert.strictEqual(last(us), '2026-03-06', 'US: month first');
  assert.strictEqual(last(gb), '2026-06-03', 'day first');
  const es = L.analyzeStatement('Fecha,Concepto,Importe\n15 ene 2026,NETFLIX MX,-19.99\n15 feb 2026,NETFLIX MX,-19.99\n15 abr 2026,NETFLIX MX,-19.99\n', L.CATALOG, { dmy: true });
  assert.ok(es.ok && es.found.some(f => f.key === 'netflix'), 'ene, feb and abr are read');
});
test('planner: services from different families still add up', () => {
  const r = L.plan([
    { id: 'gp-ult', name: 'Ultimate', price: 22.99, hours: 10, earliest: 0, covers: ['gp-ess'] },
    { id: 'ps-ess', name: 'PS Essential', price: 10.99, hours: 10, earliest: 0 },
  ], 20);
  assert.ok(Math.abs(r.cost - (22.99 + 10.99)) < 1e-9, String(r.cost));
});

test('planner: one plan that covers a mix is charged instead of the mix, only when it is cheaper', () => {
  const ult = { id: 'gp-ult', name: 'Ultimate', price: 22.99, covers: ['gp-prem', 'gp-ess', 'gp-pc'] };
  const svc = (id, price, hours) => ({ id, name: id, price, hours, earliest: 0, fam: 'gamepass', bundles: [ult] });
  const both = [[10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]];
  const mc = L.monthCosts([svc('gp-prem', 14.99, 10), svc('gp-pc', 13.99, 10)], both, 0);
  assert.strictEqual(mc.cost, 22.99);
  assert.strictEqual(mc.bundle.gamepass.id, 'gp-ult');
  assert.strictEqual(L.planMonthCost([svc('gp-prem', 14.99, 10), svc('gp-pc', 13.99, 10)].map(s => Object.assign(s, { bundles: undefined })), both, 0), 28.98, 'without bundles it is the plain sum');
  assert.ok(Math.abs(L.plan([svc('gp-prem', 14.99, 20), svc('gp-pc', 13.99, 20)], 40).cost - 22.99) < 1e-9, 'both fit in one Ultimate month');
  assert.ok(Math.abs(L.plan([svc('gp-prem', 14.99, 200), svc('gp-pc', 13.99, 200)], 40).cost - 144.9) < 1e-9, 'one after the other beats ten months of Ultimate');
  assert.strictEqual(L.monthCosts([svc('gp-ess', 9.99, 10)], [[10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], 0).cost, 9.99, 'a single cheap plan is never upgraded');
});
test('catalog: every price is verified (no estimates), and each plan only includes cheaper plans of its own family', () => {
  L.CATALOG.forEach(c => assert.ok(!c.est, c.id + ' is still an estimate'));
  L.CATALOG.forEach(c => (c.covers || []).forEach(id => {
    const low = L.CATALOG.find(x => x.id === id);
    assert.ok(low, c.id + ' covers unknown ' + id);
    assert.ok(low.price < c.price, c.id + ' should cost more than ' + id);
    assert.strictEqual(L.tvFamilyOfService(id), L.tvFamilyOfService(c.id), id + ' and ' + c.id + ' are one family');
  }));
  L.FAMILIES.forEach(f => f.tiers.forEach(id => assert.ok(L.CATALOG.some(c => c.id === id), f.k + ' lists unknown tier ' + id)));
  assert.strictEqual(L.CATALOG.find(c => c.id === 'gp-ult').price, 22.99);
  assert.deepStrictEqual(L.CATALOG.find(c => c.id === 'gp-ult').covers.slice().sort(), ['gp-ess', 'gp-pc', 'gp-prem']);
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
