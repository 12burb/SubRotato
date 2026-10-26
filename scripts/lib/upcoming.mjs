// Pure logic for the weekly release-date refresh. No file or network access in here except through
// the fetcher you pass in, so everything is unit-testable. Node 20+, zero dependencies.

export const KINDS = ['tv', 'movie', 'game', 'sport'];
export const CONFIDENCE = ['confirmed', 'unconfirmed', 'rumored'];
export const SERVICES = ['netflix', 'disney', 'hulu', 'max', 'peacock', 'apple', 'paramount', 'crunchy', 'prime', 'viki', 'kocowa', 'vix', 'britbox', 'acorn', 'gamepass', 'psplus'];
// Tier ids from the app's catalog (public/app.html). A test keeps this list identical to it.
export const CATALOG_IDS = ['gp-ess', 'gp-prem', 'gp-ult', 'gp-pc', 'ps-ess', 'ps-extra', 'ps-prem', 'nf-ads', 'nf-std', 'nf-prem', 'disney', 'disney-prem', 'hulu', 'hulu-noads', 'max', 'max-std', 'max-prem', 'peacock', 'peacock-plus', 'apple', 'paramount', 'paramount-prem', 'crunchy', 'crunchy-mega', 'crunchy-ult', 'prime', 'prime-noads', 'amazon-prime', 'amazon-prime-noads', 'viki', 'viki-plus', 'kocowa', 'kocowa-prem', 'vix', 'vix-noads', 'britbox', 'acorn'];
const ITEM_KEYS = ['id', 'title', 'kind', 'anime', 'indie', 'origin', 'service', 'channel', 'platforms', 'subs', 'subsNote', 'subsNoteEs', 'date', 'confidence', 'hours', 'hoursSource', 'episodes', 'release', 'firstDrop', 'perWeek', 'finale', 'season', 'tvmazeId', 'sport', 'ends', 'gamesPerWeek', 'gameHours', 'source', 'checked'];
const TOP_KEYS = ['checked', 'items', 'skip'];

const CHANNELS = [
  [/^netflix$/i, 'netflix'],
  [/^disney(\+|\s*plus)$/i, 'disney'],
  [/^(hulu|fxx?)$/i, 'hulu'],                           // FX shows stream on Hulu
  [/^(hbo\s*max|max|hbo)$/i, 'max'],
  [/^peacock$/i, 'peacock'],
  [/^apple\s*tv(\+|\s*plus)?$/i, 'apple'],
  [/^paramount(\+|\s*plus)$/i, 'paramount'],
  [/^crunchyroll$/i, 'crunchy'],
  [/^(prime\s*video|amazon\s*prime\s*video|amazon\s*freevee|freevee)$/i, 'prime'],
  [/^(rakuten\s*)?viki$/i, 'viki'],
  [/^kocowa\+?$/i, 'kocowa'],
  [/^vix\+?$/i, 'vix'],
  [/^britbox$/i, 'britbox'],
  [/^acorn\s*tv$/i, 'acorn'],
];
// Where a show or movie was made (the app tags it: Korean TV is a K-drama). "American" is allowed but never tagged.
export const ORIGINS = ['Korean', 'Japanese', 'Chinese', 'Taiwanese', 'Thai', 'Filipino', 'Indonesian', 'Indian', 'Turkish', 'Israeli', 'Spanish', 'Mexican', 'Colombian', 'Argentine', 'Chilean', 'Brazilian', 'British', 'Irish', 'French', 'German', 'Italian', 'Nordic', 'Dutch', 'Belgian', 'Polish', 'Nigerian', 'South African', 'Australian', 'New Zealand', 'Canadian', 'American'];
// a TVMaze language in Spanish, for the Spanish note ("Serie nueva, en francés")
const LANGUAGE_ES = { Spanish: 'español', Portuguese: 'portugués', French: 'francés', German: 'alemán', Italian: 'italiano', Korean: 'coreano', Japanese: 'japonés', Chinese: 'chino', Mandarin: 'mandarín', Cantonese: 'cantonés', Thai: 'tailandés', Turkish: 'turco', Hebrew: 'hebreo', Arabic: 'árabe', Polish: 'polaco', Danish: 'danés', Swedish: 'sueco', Norwegian: 'noruego', Finnish: 'finlandés', Icelandic: 'islandés', Dutch: 'neerlandés', Russian: 'ruso', Ukrainian: 'ucraniano', Greek: 'griego', Hindi: 'hindi', Tamil: 'tamil', Telugu: 'telugu', Malayalam: 'malayalam', Kannada: 'canarés', Marathi: 'maratí', Bengali: 'bengalí', Punjabi: 'panyabí', Tagalog: 'tagalo', Filipino: 'filipino', Indonesian: 'indonesio', Vietnamese: 'vietnamita', Malay: 'malayo', Czech: 'checo', Hungarian: 'húngaro', Romanian: 'rumano' };
const BY_LANGUAGE = { Korean: 'Korean', Japanese: 'Japanese', Thai: 'Thai', Turkish: 'Turkish', Hebrew: 'Israeli', German: 'German', Italian: 'Italian', Polish: 'Polish', Danish: 'Nordic', Swedish: 'Nordic', Norwegian: 'Nordic', Finnish: 'Nordic', Icelandic: 'Nordic', Tagalog: 'Filipino', Filipino: 'Filipino', Indonesian: 'Indonesian', Hindi: 'Indian', Tamil: 'Indian', Telugu: 'Indian', Malayalam: 'Indian', Kannada: 'Indian', Marathi: 'Indian', Bengali: 'Indian', Punjabi: 'Indian' };
const BY_COUNTRY = { KR: 'Korean', JP: 'Japanese', CN: 'Chinese', HK: 'Chinese', TW: 'Taiwanese', TH: 'Thai', PH: 'Filipino', ID: 'Indonesian', IN: 'Indian', TR: 'Turkish', IL: 'Israeli', ES: 'Spanish', MX: 'Mexican', CO: 'Colombian', AR: 'Argentine', CL: 'Chilean', BR: 'Brazilian', GB: 'British', IE: 'Irish', FR: 'French', DE: 'German', IT: 'Italian', DK: 'Nordic', SE: 'Nordic', NO: 'Nordic', FI: 'Nordic', IS: 'Nordic', NL: 'Dutch', BE: 'Belgian', PL: 'Polish', NG: 'Nigerian', ZA: 'South African', AU: 'Australian', NZ: 'New Zealand', CA: 'Canadian' };
// A lookup by a name TVMaze sent: only the table's own entries, so "constructor" or "__proto__" finds nothing.
const own = (table, k) => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(table, k) ? table[k] : null);
// A TVMaze show's origin, when it was not made in the US: its channel's country first, then its language, but only a
// language spoken mainly in one place (Spanish, Portuguese, Chinese, French or Dutch could be several: a person decides).
export function originOf(sh) {
  const c = sh && ((sh.network && sh.network.country && sh.network.country.code) || (sh.webChannel && sh.webChannel.country && sh.webChannel.country.code));
  if (c && c !== 'US' && own(BY_COUNTRY, c)) return own(BY_COUNTRY, c);
  return own(BY_LANGUAGE, sh && sh.language);   // a US channel (ViX is one) can still carry a Korean show
}
export function channelToService(name) {
  const n = String(name || '').trim();
  for (const [re, id] of CHANNELS) if (re.test(n)) return id;
  return null;
}

/* ---------- dates ---------- */
const DAY = 86400000;
// 'YYYY-MM-DD' or 'YYYY-MM' (month precision). Returns {ms, month} or null. Rejects impossible dates.
export function parseDate(s) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(s || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = m[3] ? +m[3] : 1;
  if (mo < 1 || mo > 12 || y < 2000 || y > 2100) return null;
  const ms = Date.UTC(y, mo - 1, d), c = new Date(ms);
  if (c.getUTCFullYear() !== y || c.getUTCMonth() !== mo - 1 || c.getUTCDate() !== d) return null;
  return { ms, month: !m[3] };
}
// The last day an item could plausibly come out: the day itself, or the end of the month for month-only dates.
export function dueMs(date) {
  const p = parseDate(date);
  if (!p) return null;
  if (!p.month) return p.ms;
  const d = new Date(p.ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
}
export const daysBetween = (aMs, bMs) => Math.round((bMs - aMs) / DAY);
const todayMs = today => parseDate(today).ms;

/* ---------- outside text ---------- */
// Names come from TVMaze and Wikipedia (anyone can edit them) or from a hand edit. A text field may not hold markup
// (< or >), a control character (line breaks included, and U+2028 or U+2029), a direction control that can flip how
// the text reads (U+202A-202E, U+2066-2069; the report strips them, so a reviewer would not see one) or more than 200
// characters. The app escapes what it shows anyway; this keeps the data file, the report and the logs clean too.
export const TEXT_KEYS = ['title', 'channel', 'subsNote', 'subsNoteEs', 'sport'];
export const unsafe = s => typeof s === 'string' && (/[<>\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(s) || s.length > 200);
// A name needs at least one letter or digit, in any script: one made only of invisible or punctuation characters is no name.
const named = s => /[\p{L}\p{N}]/u.test(s);
// Outside text in the report, which becomes a pull request or issue body and is printed to the Actions log: one line
// in a code span, at most 200 characters, so a name cannot add a heading, a link, an @mention, a #reference, a closing
// keyword, an image or a workflow command (a log line that starts with "::", or the old form "##[" anywhere in it).
export const md = s => {
  const t = [...String(s == null ? '' : s).replace(/[\u202a-\u202e\u2066-\u2069]/g, '').replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/`/g, "'").replace(/##\[/g, '## [').trim()].slice(0, 200).join('');
  return '`' + (t || ' ') + '`';
};
// For an error message: a value from the file, quoted on one line. JSON writes "##[" (an old workflow command) as
// "##" plus the escape for "[", which reads back as the same text.
const quote = v => JSON.stringify(String(v)).slice(0, 80).replace(/##\[/g, '##\\u005b');

/* ---------- validation ---------- */
export function validateData(data) {
  const errs = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ['top level must be an object'];
  Object.keys(data).forEach(k => { if (!TOP_KEYS.includes(k)) errs.push('unknown top-level key ' + quote(k)); });
  if (!parseDate(data.checked) || parseDate(data.checked).month) errs.push('"checked" must be YYYY-MM-DD');
  // skip: titles (or "tvmaze:<id>") a person said no to, so discovery stops adding or suggesting them
  if ('skip' in data && !(Array.isArray(data.skip) && data.skip.every(x => typeof x === 'string' && x.trim()))) errs.push('"skip" must be a list of titles or "tvmaze:<id>"');
  if (!Array.isArray(data.items)) return errs.concat('"items" must be an array');
  const seen = new Set();
  data.items.forEach((it, i) => {
    const w = 'items[' + i + ']' + (it && it.id ? ' (' + (typeof it.id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(it.id) ? it.id : quote(it.id)) + ')' : '');
    if (!it || typeof it !== 'object' || Array.isArray(it)) { errs.push(w + ': must be an object'); return; }
    Object.keys(it).forEach(k => { if (!ITEM_KEYS.includes(k)) errs.push(w + ': unknown key ' + quote(k)); });
    if (typeof it.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(it.id)) errs.push(w + ': id must be a lowercase slug');
    else if (seen.has(it.id)) errs.push(w + ': duplicate id');
    else seen.add(it.id);
    if (typeof it.title !== 'string' || !it.title.trim()) errs.push(w + ': title is required');
    TEXT_KEYS.forEach(k => { if (unsafe(it[k])) errs.push(w + ': ' + k + ' has markup (< or >), a control character or a line break, or is over 200 characters'); });
    if (Array.isArray(it.platforms) && it.platforms.some(unsafe)) errs.push(w + ': platforms has a name with markup, a control character or over 200 characters');
    if (!KINDS.includes(it.kind)) errs.push(w + ': kind must be one of ' + KINDS.join(', '));
    if (!parseDate(it.date)) errs.push(w + ': date must be a real YYYY-MM-DD or YYYY-MM');
    if (!CONFIDENCE.includes(it.confidence)) errs.push(w + ': confidence must be one of ' + CONFIDENCE.join(', '));
    if (!parseDate(it.checked) || parseDate(it.checked).month) errs.push(w + ': checked must be YYYY-MM-DD');
    if ('service' in it && it.service !== null && !SERVICES.includes(it.service)) errs.push(w + ': unknown service ' + quote(it.service));
    if ('channel' in it && it.channel !== null && typeof it.channel !== 'string') errs.push(w + ': channel must be a string or null');
    if ('platforms' in it && !(Array.isArray(it.platforms) && it.platforms.every(p => typeof p === 'string' && p))) errs.push(w + ': platforms must be a list of names');
    if ('hours' in it && it.hours !== null && !(typeof it.hours === 'number' && it.hours > 0 && it.hours <= 999)) errs.push(w + ': hours must be null or a number from 0 to 999');
    // where a game's hours came from: a URL and what it counts ("HowLongToBeat, Main + Extras"), so the number can be checked again
    if ('hoursSource' in it && !(typeof it.hoursSource === 'string' && it.hoursSource.trim())) errs.push(w + ': hoursSource must be a short note or URL');
    if ('hoursSource' in it && !(typeof it.hours === 'number' && it.hours > 0)) errs.push(w + ': hoursSource needs hours');
    // a season's release pattern: how many episodes, all at once or weekly, how many come on day one and how many a week after
    if ('episodes' in it && !(Number.isInteger(it.episodes) && it.episodes > 0 && it.episodes <= 200)) errs.push(w + ': episodes must be a whole number from 1 to 200');
    if ('release' in it && !['all', 'weekly'].includes(it.release)) errs.push(w + ': release must be "all" or "weekly"');
    if ('firstDrop' in it && !(Number.isInteger(it.firstDrop) && it.firstDrop > 0 && it.release === 'weekly' && (!it.episodes || it.firstDrop <= it.episodes))) errs.push(w + ': firstDrop is how many weekly episodes come on day one (at most episodes)');
    if ('perWeek' in it && !(Number.isInteger(it.perWeek) && it.perWeek > 0 && it.perWeek <= 7 && it.release === 'weekly')) errs.push(w + ': perWeek is how many weekly episodes come each week after day one (1 to 7)');
    // finale: the announced last episode, only when the weeks are uneven (2, 2, 2, 1, 1); check it when the date moves (the app ignores one that is not after the premiere)
    const fd = 'finale' in it ? parseDate(it.finale) : null;
    if ('finale' in it && !(fd && !fd.month && it.release === 'weekly' && it.episodes > 0)) errs.push(w + ': finale is the last episode\'s real date (YYYY-MM-DD) of a weekly season with episodes');
    if (it.release === 'weekly' && 'tvmazeId' in it && !('season' in it)) errs.push(w + ': a weekly show with a tvmazeId needs season, so only that season\'s dates are used');
    if (('episodes' in it || 'release' in it || 'firstDrop' in it || 'perWeek' in it || 'finale' in it) && it.kind !== 'tv') errs.push(w + ': episodes, release, firstDrop, perWeek and finale only apply to kind "tv"');
    if ('anime' in it && !(it.anime === true && (it.kind === 'tv' || it.kind === 'movie'))) errs.push(w + ': anime is true on an anime show or movie; leave it out otherwise');
    // indie: a game from an independent studio, self-published or with an indie label, or ID@Xbox / PlayStation Indies
    if ('indie' in it && !(it.indie === true && it.kind === 'game')) errs.push(w + ': indie is true on an indie game; leave it out otherwise');
    if ('origin' in it && !(ORIGINS.includes(it.origin) && (it.kind === 'tv' || it.kind === 'movie'))) errs.push(w + ': origin is where a show or movie was made, one of: ' + ORIGINS.join(', '));
    if ('season' in it && !(Number.isInteger(it.season) && it.season > 0)) errs.push(w + ': season must be a positive whole number');
    if ('tvmazeId' in it && !(Number.isInteger(it.tvmazeId) && it.tvmazeId > 0)) errs.push(w + ': tvmazeId must be a positive whole number');
    if ('tvmazeId' in it && it.kind !== 'tv') errs.push(w + ': tvmazeId only applies to kind "tv"');
    if ('season' in it && !('tvmazeId' in it)) errs.push(w + ': season needs a tvmazeId');
    if ('source' in it && typeof it.source !== 'string') errs.push(w + ': source must be a string');
    // subs: the lowest tier of each subscription that includes it at launch; [] means buy only
    if ('subs' in it && !(Array.isArray(it.subs) && it.subs.every(x => CATALOG_IDS.includes(x)) && new Set(it.subs).size === it.subs.length)) errs.push(w + ': subs must be a list of distinct catalog tier ids (' + CATALOG_IDS.join(', ') + ')');
    if ('subsNote' in it && typeof it.subsNote !== 'string') errs.push(w + ': subsNote must be a string');
    if ('subsNoteEs' in it && !(typeof it.subsNoteEs === 'string' && it.subsNoteEs.trim() && typeof it.subsNote === 'string')) errs.push(w + ': subsNoteEs is subsNote in Spanish (needs subsNote)');
    // a sports season: the first and last game on that service, games a week for one fan, and hours a game
    const ed = 'ends' in it ? parseDate(it.ends) : null, sd = parseDate(it.date);
    if (it.kind === 'sport') {
      if (!(sd && !sd.month)) errs.push(w + ': a sports season needs date, its first game (YYYY-MM-DD)');
      if (!(ed && !ed.month && sd && ed.ms >= sd.ms)) errs.push(w + ': a sports season needs ends, its last game (YYYY-MM-DD, not before date)');
      if (!(typeof it.gamesPerWeek === 'number' && it.gamesPerWeek > 0 && it.gamesPerWeek <= 14)) errs.push(w + ': gamesPerWeek is how many games a fan watches in a normal week (more than 0, at most 14)');
      if (!(typeof it.gameHours === 'number' && it.gameHours >= 0.5 && it.gameHours <= 8)) errs.push(w + ': gameHours is how long one game runs (0.5 to 8)');
      if (!(typeof it.sport === 'string' && it.sport.trim())) errs.push(w + ': sport is the kind of sport, such as Soccer');
      if (!(Array.isArray(it.subs) && it.subs.length)) errs.push(w + ': a sports season needs subs, the services it streams on');
    } else if ('sport' in it || 'ends' in it || 'gamesPerWeek' in it || 'gameHours' in it) errs.push(w + ': sport, ends, gamesPerWeek and gameHours only apply to kind "sport"');
  });
  return errs;
}

// Stable key order and no undefined values, so weekly diffs only show real changes.
export function normalizeItem(it) {
  const o = {};
  ITEM_KEYS.forEach(k => { if (it[k] !== undefined) o[k] = it[k]; });
  return o;
}
export function normalizeData(d) {
  const o = { checked: d.checked, items: d.items.map(normalizeItem) };
  if (Array.isArray(d.skip)) o.skip = d.skip.slice();
  return o;
}
// The skip list as two lookups: TVMaze ids and loose title keys.
function skipSets(skip) {
  const ids = new Set(), titles = new Set();
  (Array.isArray(skip) ? skip : []).forEach(x => { const m = /^tvmaze:(\d+)$/i.exec(String(x).trim()); if (m) ids.add(+m[1]); else titles.add(titleKey(x)); });
  return { ids, titles };
}
// Two-space JSON with short lists kept on one line, e.g. "platforms": ["PS5", "PC"].
export const stringify = d => JSON.stringify(normalizeData(d), null, 2)
  .replace(/\[\n([^\[\]]*?)\n\s*\]/g, (m, inner) => '[' + inner.split(/,\n\s*/).map(s => s.trim()).join(', ') + ']') + '\n';

/* ---------- flags for things a script cannot verify ---------- */
// Returns at most one flag per item: the most urgent one.
export function classify(item, today, opts) {
  const o = Object.assign({ soonDays: 30, staleDays: 21, recheckAfterDays: 7 }, opts);
  const t = todayMs(today), due = dueMs(whenOf(item, t)), seen = daysBetween(parseDate(item.checked).ms, t);
  const out = daysBetween(t, due);
  const last = whenOf(item, t) !== item.date, days = n => n + ' day' + (n === 1 ? '' : 's');   // a season under way: its last game
  if (out < 0) return { code: 'past', message: last ? 'The last game was ' + days(-out) + ' ago. Add the next season, or let it go.' : 'The date has passed (' + days(-out) + ' ago). Confirm it came out, then keep it a few weeks or remove it.' };
  if (out <= o.soonDays && seen > o.recheckAfterDays) return { code: 'recheck-soon', message: (last ? 'Last game in ' : 'Due in ') + days(out) + ' and last checked ' + seen + ' days ago. Re-confirm the date.' };
  if (seen > o.staleDays) return { code: 'stale', message: 'Last checked ' + seen + ' days ago.' };
  return null;
}

// The date that matters: a sports season under way is judged by its last game, everything else by its date.
export const whenOf = (it, t) => it.kind === 'sport' && typeof it.ends === 'string' && parseDate(it.ends) && dueMs(it.date) <= t ? it.ends : it.date;

// Items whose date ended more than graceDays ago are dropped from the file.
export function pruneExpired(items, today, graceDays = 30) {
  const t = todayMs(today), kept = [], removed = [];
  items.forEach(it => (daysBetween(dueMs(whenOf(it, t)), t) > graceDays ? removed : kept).push(it));
  return { kept, removed };
}

/* ---------- TVMaze ---------- */
export function tvmazeUrl(id, base = 'https://api.tvmaze.com') { return base + '/shows/' + id + '?embed=episodes'; }

// `show` is the /shows/:id?embed=episodes response. Returns {item, changes[]} without touching the input.
export function mergeTvmaze(item, show, today) {
  const next = Object.assign({}, item), changes = [];
  const set = (k, v, label) => {
    const before = next[k];
    if (JSON.stringify(before) === JSON.stringify(v)) return;
    next[k] = v;
    changes.push(label + ': ' + (before == null ? 'none' : before) + ' -> ' + (v == null ? 'none' : v));
  };
  const all = (show && show._embedded && show._embedded.episodes) || [];
  let eps = all;
  if (item.season) eps = eps.filter(e => e.season === item.season);
  const dayOk = d => { const p = parseDate(d); return !!p && !p.month; };   // a real air day, as isoDay in app.html
  const air = eps.map(e => e.airdate).filter(dayOk).sort();
  const first = air[0] || (!item.season && show && parseDate(show.premiered) ? show.premiered : null);
  // A date only counts as confirmed when TVMaze has one; a season it has not dated keeps the label it had.
  // TVMaze calls every unaired series "In Development", so a date a person confirmed stays confirmed
  // while TVMaze shows the same date; a different date from TVMaze is only unconfirmed.
  if (first) {
    const dev = !!show && /^(In Development|To Be Determined)$/.test(show.status || '');
    const keep = dev && item.confidence === 'confirmed' && item.date === first;
    set('date', first, 'date');
    if (!keep) set('confidence', dev ? 'unconfirmed' : 'confirmed', 'confidence');
  }

  // A channel we do not cover never clears a service someone set (a show can air on one channel and stream on another).
  // A channel name with markup or a line break is never copied: one vandal edit on TVMaze must not fail the run.
  const channel = (show && ((show.webChannel && show.webChannel.name) || (show.network && show.network.name))) || null;
  const svc = channelToService(channel);
  if (typeof channel === 'string' && channel && !unsafe(channel) && (svc || !item.service)) { set('channel', channel, 'channel'); set('service', svc, 'service'); }

  // Hours only when every episode has a known length, so a half-empty list never lowers the total, and not
  // while the season may still grow: TVMaze often lists only the first few episodes, or only the aired ones. We
  // judge the item's season, or the newest one. It grows while episodes are still to come; one that aired in the
  // last two weeks may grow too, unless the show ended or a later season is listed. While it grows it needs 4
  // episodes, as many as the season before, and the announced count; with no count, 2 or more listed ahead, or
  // every episode out on one day (a binge drop). (tvSummary in app.html uses the same rule.)
  const fallback = show && (show.averageRuntime || show.runtime) || 0;
  const cs = item.season || eps.reduce((m, e) => Math.max(m, Number.isInteger(e.season) ? e.season : 0), 0);
  const cur = item.season ? eps : eps.filter(e => e.season === cs), curAir = cur.map(e => e.airdate).filter(dayOk).sort();
  const toCome = cur.filter(e => !dayOk(e.airdate) || e.airdate >= today).length;
  const prev = cs > 1 ? all.filter(e => e.season === cs - 1).length : 0;
  const quiet = new Date(Date.parse(today + 'T00:00:00Z') - 14 * 86400000).toISOString().slice(0, 10);
  const growing = toCome > 0 || (curAir.length > 0 && curAir[curAir.length - 1] >= quiet && !(show && show.status === 'Ended') && !(cs > 0 && all.some(e => e.season > cs)));
  const oneDay = cur.length > 1 && curAir.length === cur.length && curAir[0] === curAir[curAir.length - 1];
  const expected = Number.isInteger(item.episodes) ? item.episodes : 0;
  const partial = growing && (cur.length < 4 || cur.length < prev || (expected > 0 ? cur.length < expected : !oneDay && toCome < 2));
  if (eps.length && !partial && eps.every(e => e.runtime || fallback)) {
    const min = eps.reduce((a, e) => a + (e.runtime || fallback), 0);
    set('hours', Math.round(min / 60 * 10) / 10, 'hours');
  }
  next.checked = today;
  return { item: next, changes };
}

/* ---------- discovery: new titles worth listing ---------- */
// The cheapest plan of each streaming service (the app's FAMILY_DEFAULT; a test keeps them equal).
export const LOWEST_TIER = { netflix: 'nf-ads', disney: 'disney', hulu: 'hulu', max: 'max', peacock: 'peacock', apple: 'apple', paramount: 'paramount', crunchy: 'crunchy', prime: 'prime', viki: 'viki', kocowa: 'kocowa', vix: 'vix', britbox: 'britbox', acorn: 'acorn' };
export const slugify = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
// Titles compare loosely: case, accents, punctuation and a leading "The" do not matter.
export const titleKey = s => slugify(s).replace(/^the-/, '');
function freshId(base, ids) { let id = base, n = 2; while (ids.has(id)) id = base + '-' + n++; ids.add(id); return id; }

export function tvScheduleUrl(base = 'https://api.tvmaze.com') { return base + '/schedule/full'; }
// Nobody turns on a subscription for these.
const SKIP_TV_TYPES = ['Talk Show', 'News', 'Sports', 'Game Show', 'Award Show', 'Panel Show', 'Variety'];

// schedule: TVMaze /schedule/full, every future episode TVMaze knows (one request for all of it).
// Returns ready-to-list items for season premieres on the services we cover, within `days`, in the
// listed languages, at or above `minWeight` (TVMaze's 0-100 popularity), most popular first. A show
// that is already listed (by TVMaze id or by title) is skipped. Hours come from the season's own
// episodes in the schedule when every length is known.
export function discoverTv(schedule, items, today, opts) {
  const o = Object.assign({ days: 90, minWeight: 95, max: 6, maxAnime: 3, maxWorld: 3, languages: ['English'] }, opts);
  const t = todayMs(today), list = Array.isArray(schedule) ? schedule : [];
  const sk = skipSets(o.skip);
  const haveShow = new Set(items.filter(i => i.tvmazeId).map(i => i.tvmazeId).concat([...sk.ids]));
  const haveTitle = new Set(items.filter(i => !i.tvmazeId).map(i => titleKey(i.title)).concat([...sk.titles]));   // a listed show with an id is matched by its id: two shows can share a name
  const ids = new Set(items.map(i => i.id));
  const bySeason = new Map();                          // "showId:season" -> that season's episodes
  list.forEach(e => {
    const sh = e && e._embedded && e._embedded.show;
    if (!sh || !Number.isInteger(sh.id) || !Number.isInteger(e.season)) return;
    const k = sh.id + ':' + e.season;
    if (!bySeason.has(k)) bySeason.set(k, []);
    bySeason.get(k).push(e);
  });
  const picks = [], seen = new Set();
  list.forEach(e => {
    const sh = e && e._embedded && e._embedded.show;
    if (!sh || !Number.isInteger(sh.id) || e.number !== 1 || !Number.isInteger(e.season) || (e.type && e.type !== 'regular')) return;
    const p = parseDate(e.airdate);
    if (!p || p.month) return;
    const d = daysBetween(t, p.ms);
    if (d < 0 || d > o.days) return;
    const channel = (sh.webChannel && sh.webChannel.name) || (sh.network && sh.network.name) || '';
    const service = channelToService(channel);
    if (!service || !LOWEST_TIER[service]) return;
    // The name on one line. A name, channel or language with markup, a control character or over 200 characters
    // is skipped, so one vandal edit on TVMaze never fails the run. So is a name with no letter or digit.
    if (typeof sh.name !== 'string') return;
    const name = sh.name.replace(/\s+/g, ' ').trim();
    if (!named(name) || unsafe(name) || unsafe(channel) || unsafe(sh.language)) return;
    const anime = sh.language === 'Japanese' && sh.type === 'Animation';   // anime: listed when TVMaze names a service we cover (often Crunchyroll or Netflix)
    const origin = anime ? null : originOf(sh);   // made outside the US: tagged (Korean TV shows as a K-drama)
    const world = !anime && !!sh.language && !(o.languages || []).includes(sh.language) && sh.type === 'Scripted';   // a non-English drama or comedy on a service we cover (not reality: a Korean game show is no K-drama): its own cap
    if (o.languages && o.languages.length && !o.languages.includes(sh.language) && !anime && !world) return;
    if (SKIP_TV_TYPES.includes(sh.type)) return;
    if (!((+sh.weight || 0) >= o.minWeight)) return;
    if (haveShow.has(sh.id) || haveTitle.has(titleKey(sh.name)) || seen.has(sh.id)) return;
    seen.add(sh.id);
    picks.push({ e, sh, name, channel, service, anime, world, origin });
  });
  picks.sort((a, b) => (+b.sh.weight || 0) - (+a.sh.weight || 0) || (a.e.airdate < b.e.airdate ? -1 : a.e.airdate > b.e.airdate ? 1 : 0));
  const one = ps => { const t = new Set(); return ps.filter(p => { const k = titleKey(p.sh.name); if (t.has(k)) return false; t.add(k); return true; }); };   // two shows with one name: list one
  const top = one(one(picks.filter(p => !p.anime && !p.world)).slice(0, o.max).concat(one(picks.filter(p => p.anime)).slice(0, o.maxAnime), one(picks.filter(p => p.world)).slice(0, o.maxWorld)));
  return top.map(({ e, sh, name, channel, service, anime, world, origin }) => {
    const eps = bySeason.get(sh.id + ':' + e.season) || [e];
    const fb = +sh.averageRuntime || +sh.runtime || 0;
    // With only a premiere or two listed, a sum would badly undercount the season, so leave hours to the app's default.
    // An anime cour is often listed a few episodes at a time, so its hours wait for the weekly check.
    const hours = !anime && eps.length >= 4 && eps.every(x => +x.runtime || fb) ? Math.round(eps.reduce((a, x) => a + (+x.runtime || fb), 0) / 60 * 10) / 10 : null;
    const note = (e.season > 1 ? 'Season ' + e.season : 'New series') + (world && !origin ? ', in ' + sh.language : '');   // where it was made is for a person to set
    const noteEs = (e.season > 1 ? 'Temporada ' + e.season : 'Serie nueva') + (world && !origin ? ', en ' + (own(LANGUAGE_ES, sh.language) || sh.language) : '');
    // TVMaze's own page for the show: its address only when it is exactly that, otherwise built from the id
    const page = 'https://www.tvmaze.com/shows/' + sh.id;
    return {
      id: freshId(slugify(sh.name + (e.season > 1 ? ' season ' + e.season : '')), ids),
      title: name, kind: 'tv', ...(anime ? { anime: true } : {}), ...(origin ? { origin } : {}), service, channel, subs: [LOWEST_TIER[service]], subsNote: note, subsNoteEs: noteEs,
      date: e.airdate, confidence: /^(In Development|To Be Determined)$/.test(sh.status || '') ? 'unconfirmed' : 'confirmed',
      hours: hours > 0 ? hours : null, season: e.season, tvmazeId: sh.id,
      source: typeof sh.url === 'string' && sh.url.startsWith(page) && /^(?:\/[a-z0-9-]*)?$/i.test(sh.url.slice(page.length)) ? sh.url : page,
      checked: today,
    };
  }).filter(it => !validateData({ checked: today, items: [it] }).length);   // a note that came out too long, season 0, a runtime that makes hours over 999: left out rather than fail the run
}

// Wikipedia keeps a list of original films per streaming service. They are the only free, keyless,
// script-friendly film source (Netflix's site blocks bots; JustWatch's terms forbid scraping; TMDB,
// Trakt and OMDb need keys). Coverage is good for Netflix and thin elsewhere, so films are suggested
// to a person, never added automatically.
export const WIKI_FILM_PAGES = [
  ['netflix', 'List of Netflix original films (since 2026)'],
  ['disney', 'List of Disney+ original films'],
  ['hulu', 'List of Hulu original films'],
  ['max', 'List of HBO Max original films'],
  ['peacock', 'List of Peacock original films'],
  ['apple', 'List of Apple TV original films'],
  ['paramount', 'List of Paramount+ original films'],
];
export function wikiParseUrl(page, base = 'https://en.wikipedia.org') {
  return base + '/w/api.php?action=parse&prop=wikitext&format=json&formatversion=2&redirects=1&page=' + encodeURIComponent(page);
}
export function wikiPageUrl(page) { return 'https://en.wikipedia.org/wiki/' + encodeURIComponent(page.replace(/ /g, '_')).replace(/%2B/g, '+'); }

const MONTH_NUM = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const iso = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
// Anyone can edit Wikipedia, so every pattern here takes time in step with the text's length. A pattern that scans
// ahead for a closing mark (</ref>, -->, ]], }}, >) from each of many openings that never close would take time
// that grows with the square of the length: a few hundred kB would stall the weekly run for minutes.
// cut() drops each open...close span, left to right, like /open[\s\S]*?close/g, in one pass.
function cut(s, open, close) {
  let out = '', i = 0;
  for (;;) {
    open.lastIndex = i;
    const a = open.exec(s);
    if (!a) break;
    close.lastIndex = a.index + a[0].length;
    const b = close.exec(s);
    if (!b) break;                                      // no close after this opening: none after a later one either
    out += s.slice(i, a.index);
    i = b.index + b[0].length;
  }
  return out + s.slice(i);
}
const REF_OPEN = /<ref/gi, REF_CLOSE = /<\/ref>/gi, NOTE_OPEN = /<!--/g, NOTE_CLOSE = /-->/g;
const noRefs = s => cut(cut(String(s || '').replace(/<ref[^<>]*\/>/gi, ''), REF_OPEN, REF_CLOSE), NOTE_OPEN, NOTE_CLOSE);
// {{sort|key|shown}} -> shown (the shown part stops at the next {{sort|, so an unclosed one cannot scan the whole text)
const SORT = /\{\{sort\|[^|}]*\|((?:(?!\{\{sort\|)[^}])*)\}\}/gi;
function wikiPlain(s) {
  return noRefs(s)
    .replace(SORT, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^\][|]*\|)?([^\][]+)\]\]/g, '$1')
    .replace(/'{2,}/g, '').replace(/<[^<>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
// "{{sort|117|1 h 57 min}}", "1 h 57 min" or "117 minutes" -> 117
function wikiMinutes(s) {
  const t = String(s || '');
  let m = /\{\{sort\|(\d{2,3})\|/i.exec(t);
  if (m) return +m[1];
  m = /(\d)\s*h(?:ours?|rs?)?\.?\s*(\d{1,2})\s*m/i.exec(t);
  if (m) return +m[1] * 60 + +m[2];
  m = /(\d{2,3})\s*(?:min|minutes)\b/i.exec(t);
  return m ? +m[1] : 0;
}
// Citation access dates live inside <ref> tags, and sort keys ({{dts|...|format=hide}}, data-sort-value,
// {{sort|key|shown}}) are invisible, so all of those go before any date is read: "Late 2026" is not Dec 31.
// Each {{...}} is read once and dropped when it says format=hide. One pattern that did both took seconds on 100 kB:
// after an unclosed "{{" it scanned ahead again from every "|format=hide".
const HIDDEN = /\|\s*format\s*=\s*hide/i;
function wikiDate(s) {
  const t = noRefs(s)
    .replace(/\{\{([^{}]*)\}\}/g, (m, x) => (HIDDEN.test(x) ? '' : m))
    .replace(/data-sort-value\s*=\s*("[^"]*"|'[^']*'|[^\s|]+)/gi, '')
    .replace(SORT, '$1');
  let m = /\{\{\s*(?:dts|start date|film date)\s*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})/i.exec(t);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})\b/i.exec(t);
  if (m) return iso(+m[3], MONTH_NUM[m[1].toLowerCase()], +m[2]);
  m = /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i.exec(t);
  if (m) return iso(+m[3], MONTH_NUM[m[2].toLowerCase()], +m[1]);
  return null;
}
// Wikitext of a list page -> [{title, date, hours, language}] for table rows that carry a full date.
// Tables differ from page to page, so this reads them loosely: a header row names the columns when it
// can, and otherwise the title is the first cell and the date is the first full date in the row.
// Stand-up sets, concerts, specials and documentaries are listed too; people rotate for films.
const NOT_A_FILM = /stand-?up|special|concert|documentar|docuseries|short film|shorts\b/i;
const MAX_COLS = 40, MAX_SPAN = 100;
// The last "== Heading ==" line, read by hand: the pattern /^={2,}\s*(.*?)\s*={2,}\s*$/m took seconds on one line of
// 400 "=" signs and an "x", and minutes on a longer one.
const lastHeading = s => {
  const lines = String(s).split(/[\n\r\u2028\u2029]/);
  for (let k = lines.length - 1; k >= 0; k--) {
    const l = lines[k].trimEnd();
    if (l.length < 4 || !l.startsWith('==') || !l.endsWith('==')) continue;
    let a = 0, b = l.length;
    while (a < b && l[a] === '=') a++;
    while (b > a && l[b - 1] === '=') b--;
    return l.slice(a, b).trim();
  }
  return null;
};
export function parseWikiFilmRows(wikitext) {
  const out = [];
  const parts = ('\n' + String(wikitext || '')).split(/\n\{\|/);
  let heading = lastHeading(parts[0]) || '';
  parts.slice(1).forEach(table => {
    const [body, ...after] = table.split(/\n\|\}/);
    const section = heading;
    heading = lastHeading(after.join('\n|}')) || heading;      // the heading for the next table, if one follows
    if (NOT_A_FILM.test(section)) return;
    const rows = body.split(/\n\|-[^\n]*/);
    const head = (rows[0] + '\n' + (rows[1] || '')).split('\n').filter(l => /^!/.test(l)).flatMap(l => l.slice(1).split('!!'))
      .map(h => wikiPlain(h.includes('|') && !/\[\[/.test(h.split('|')[0]) ? h.slice(h.indexOf('|') + 1) : h).toLowerCase());
    const col = re => head.findIndex(h => re.test(h));
    const ci = { title: col(/title|film/), date: col(/release|premiere|date/), runtime: col(/runtime|length/), language: col(/language/), genre: col(/genre/) };
    // column -> {text, left}: a cell with rowspan fills the rows below. A row is read up to MAX_COLS columns and a
    // rowspan up to MAX_SPAN rows (film lists use about 8 columns and spans of a few rows), so one very wide row or a huge rowspan cannot
    // make every later row long: a 430 kB table of that shape took 88 s.
    const carry = [];
    rows.forEach(r => {
      const lines = r.split('\n').filter(l => /^[|!]/.test(l) && !/^\|[+}]/.test(l) && !/^\{\|/.test(l));
      if (!lines.length || lines.every(l => /^!/.test(l) && !/''/.test(l))) return;      // header row
      const raw = lines.flatMap(l => l.slice(1).split(/\|\||!!/)).slice(0, MAX_COLS).map(c => {
        const bar = c.indexOf('|');                     // "style=... | value": drop cell attributes
        const attr = bar > 0 && !/\[\[|\{\{/.test(c.slice(0, bar)) ? c.slice(0, bar) : '';
        return { text: attr ? c.slice(bar + 1) : c, span: Math.min(MAX_SPAN, +((/rowspan\s*=\s*["']?(\d+)/i.exec(attr) || [])[1] || 1)) };
      });
      const cells = [];
      for (let c = 0, k = 0; c < MAX_COLS && (k < raw.length || c < carry.length); c++) {
        const cy = carry[c];
        if (cy && cy.left > 0) { cells.push(cy.text); cy.left--; continue; }
        if (k >= raw.length) { cells.push(''); continue; }
        const x = raw[k++];
        cells.push(x.text);
        carry[c] = x.span > 1 ? { text: x.text, left: x.span - 1 } : null;
      }
      const cell = i => (i >= 0 && i < cells.length ? cells[i] : '');
      const titleRaw = ci.title >= 0 ? cell(ci.title) : (cells.find(c => /''/.test(c)) || cells[0] || '');
      const title = wikiPlain(titleRaw).replace(/\s*\((?:\d{4} )?film\)$/i, '');
      const date = wikiDate(ci.date >= 0 ? cell(ci.date) : '') || wikiDate(cells.join(' | '));
      if (!title || !date || title.length > 120) return;
      if (ci.genre >= 0 && NOT_A_FILM.test(wikiPlain(cell(ci.genre)))) return;
      const mins = wikiMinutes(noRefs(ci.runtime >= 0 ? cell(ci.runtime) : ''));
      out.push({ title, date, hours: mins >= 40 && mins <= 300 ? Math.round(mins / 60 * 10) / 10 : null, language: ci.language >= 0 ? wikiPlain(cell(ci.language)) : null });
    });
  });
  return out;
}

const CHANNEL_NAME = { netflix: 'Netflix', disney: 'Disney+', hulu: 'Hulu', max: 'HBO Max', peacock: 'Peacock', apple: 'Apple TV', paramount: 'Paramount+', crunchy: 'Crunchyroll', prime: 'Prime Video', viki: 'Viki', kocowa: 'KOCOWA+', vix: 'ViX', britbox: 'BritBox', acorn: 'Acorn TV' };
// pages: [{service, page, rows}] from parseWikiFilmRows. Returns films dated from today to `days` ahead
// that the list does not have yet, as ready-to-paste items (unconfirmed until a person checks them).
export function discoverMovies(pages, items, today, opts) {
  const o = Object.assign({ days: 180, max: 15, languages: ['English'] }, opts);
  const t = todayMs(today), haveTitle = new Set(items.map(i => titleKey(i.title)).concat([...skipSets(o.skip).titles])), ids = new Set(items.map(i => i.id)), out = [];
  (pages || []).forEach(pg => (pg.rows || []).forEach(r => {
    const p = parseDate(r.date);
    if (!p || p.month) return;
    const d = daysBetween(t, p.ms);
    if (d < 0 || d > o.days) return;
    if (o.languages && o.languages.length && r.language && !o.languages.some(l => r.language.toLowerCase().includes(l.toLowerCase()))) return;
    if (typeof r.title !== 'string' || unsafe(r.title) || !named(r.title)) return;   // markup, a control character or no letter in a Wikipedia title: not suggested
    const k = titleKey(r.title);
    if (!k || haveTitle.has(k)) return;
    haveTitle.add(k);
    out.push({
      id: freshId(slugify(r.title), ids), title: r.title, kind: 'movie', service: pg.service, channel: CHANNEL_NAME[pg.service] || null,
      subs: [LOWEST_TIER[pg.service]], date: r.date, confidence: 'unconfirmed', hours: r.hours || null,
      source: wikiPageUrl(pg.page), checked: today,
    });
  }));
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out.slice(0, o.max);
}

/* ---------- polite fetching ---------- */
export class BudgetError extends Error {}
export function createFetcher(opts) {
  const o = Object.assign({
    fetchFn: globalThis.fetch, sleep: ms => new Promise(r => setTimeout(r, ms)), now: () => Date.now(),
    minGapMs: 600, retryWaitSec: 5, maxRequests: 140, timeoutMs: 15000, userAgent: 'sub-rotator-refresh/1.0 (weekly release-date check)',
  }, opts);
  let last = 0, count = 0;
  async function get(url, opt) {
    const timeoutMs = (opt && opt.timeoutMs) || o.timeoutMs;   // the full TVMaze schedule is ~15 MB, so it gets longer
    for (let attempt = 0; attempt < 2; attempt++) {
      if (count >= o.maxRequests) throw new BudgetError('request budget of ' + o.maxRequests + ' reached');
      const wait = last + o.minGapMs - o.now();
      if (wait > 0) await o.sleep(wait);
      last = o.now(); count++;
      let res;
      try {
        res = await o.fetchFn(url, { headers: { accept: 'application/json', 'user-agent': o.userAgent }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        if (attempt === 0) { await o.sleep(2000); continue; }
        throw e;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt === 0) { await o.sleep(Math.min(20, +res.headers.get('retry-after') || o.retryWaitSec) * 1000); continue; }
        return { status: res.status, json: null };
      }
      return { status: res.status, json: res.ok ? await res.json() : null };
    }
  }
  return { get, get count() { return count; } };
}

/* ---------- report ---------- */
// Every outside string (titles, notes, channels, messages, reasons, addresses) goes through md(). A date or an
// origin that is already in its checked form is printed as it is; anything else is quoted the same way.
export function renderReport(r) {
  const day = s => (typeof s === 'string' && parseDate(s) ? s : md(s));
  const from = s => (ORIGINS.includes(s) ? s : md(s));
  const page = i => (Number.isInteger(i.tvmazeId) && i.tvmazeId > 0 ? 'https://www.tvmaze.com/shows/' + i.tvmazeId : md(i.source));
  const reqs = Number.isInteger(r.requests) ? r.requests : 0;
  const L = ['# Weekly release-date check (' + day(r.today) + ')', ''];
  if (r.changes.length) {
    L.push('## Changed', '');
    r.changes.forEach(c => { L.push('- **' + md(c.title) + '**'); c.notes.forEach(n => L.push('  - ' + md(n))); });
    L.push('');
  }
  const added = r.added || [], ideas = r.ideas || [];
  if (added.length) {
    L.push('## Added: new seasons from TVMaze', '', 'Popular season premieres on the services we cover. Check the plan each one needs before merging. To drop one for good, delete it and put its title in `skip`.', '');
    added.forEach(i => L.push('- **' + md(i.title) + '** (' + (i.anime ? 'Anime, ' : '') + (i.origin ? from(i.origin) + ', ' : '') + md(i.subsNote) + ', ' + md(i.channel) + ', ' + day(i.date) + ') ' + page(i)));
    L.push('');
  }
  if (r.removed.length) {
    L.push('## Removed (came out, or the season ended, more than 30 days ago)', '');
    r.removed.forEach(i => L.push('- ' + md(i.title) + ' (' + (i.kind === 'sport' && i.ends ? 'last game ' + day(i.ends) : day(i.date)) + ')'));
    L.push('');
  }
  if (ideas.length) {
    L.push('## Movies to consider', '', 'Listed on Wikipedia but not in `public/upcoming.json`. Not added: confirm the date and the service, then paste the ones worth listing. Put the title of any you do not want in `skip` and it will not come back.', '');
    ideas.forEach(i => L.push('- [ ] **' + md(i.title) + '** (' + md(i.channel) + ', ' + day(i.date) + ')'));
    // One JSON object a line: JSON escapes line breaks, so nothing in it can start a line and close the code block.
    // The separators, direction marks and "##[" (an old workflow command) that JSON leaves as they are get escaped
    // too: still valid JSON, with the same values ("##[" only occurs inside a string).
    const json = i => JSON.stringify(normalizeItem(i)).replace(/[\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).replace(/##\[/g, '##\\u005b');
    L.push('', '<details><summary>Ready-to-paste JSON</summary>', '', '```json', ideas.map(json).join(',\n'), '```', '', '</details>', '');
  }
  if (r.flags.length) {
    L.push('## Needs a human look', '', 'No source can check these automatically. Confirm each date, then update `checked` in `public/upcoming.json`.', '');
    r.flags.forEach(f => L.push('- [ ] **' + md(f.title) + '** (' + day(f.date) + '): ' + md(f.message)));
    L.push('');
  }
  if (r.unchecked.length) {
    L.push('## Could not check', '');
    r.unchecked.forEach(u => L.push('- ' + md(u.title) + ': ' + md(u.reason)));
    L.push('');
  }
  if (!r.changes.length && !r.removed.length && !r.flags.length && !r.unchecked.length && !added.length && !ideas.length) L.push('Nothing changed.', '');
  L.push('_' + reqs + ' request' + (reqs === 1 ? '' : 's') + (r.wiki ? ' to TVMaze and Wikipedia' : ' to TVMaze') + '. TV data from TVMaze (CC BY-SA 4.0)' + (r.wiki ? '; film lists from Wikipedia (CC BY-SA 4.0)' : '') + '._', '');
  return L.join('\n');
}
