/**
 * 5-minute internship watcher on Google Apps Script (free; replaces the GitHub cron, which never fires
 * for this account). Same rules as watcher.py: new, active, US/remote SWE / mobile / product-eng / PM
 * internships (Summer/Winter/Spring/Fall 2027) at companies in companies.txt -> ntfy phone push.
 *
 * Setup (once): Project Settings -> Script properties -> add NTFY_TOPIC (same value as the GitHub secret).
 * Then run setup() once from the editor and approve the permission prompt (external requests only).
 *
 * Quota notes: the 13 MB listings feed is fetched with If-None-Match, so unchanged feeds return 304 in
 * milliseconds. Seen ids are kept only for postings younger than MAX_AGE_DAYS + 2 (a few hundred ids).
 */
var LISTINGS = 'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json';
var COMPANIES = 'https://raw.githubusercontent.com/daniel3606/internship-watcher/main/companies.txt';
var TERMS = ['Summer 2027', 'Winter 2027', 'Spring 2027', 'Fall 2027'];
var CATS = ['Software', 'Software Engineering', 'Product', 'Product Management'];
var REQ = /(software|swe|engineer|developer|ios|android|mobile|full[- ]?stack|front[- ]?end|back[- ]?end|web|product manag|\bapm\b|associate product|product engineer)/i;
var EXCL = /\b(phd|ph\.d|mba|hardware|firmware|embedded|asic|fpga|mechanical|electrical|manufacturing|test engineer|quality|process engineer|chemical|civil|controls|systems engineer|design engineer|it support|help ?desk|sales|marketing|recruit|finance|accounting|legal)\b/i;
var US = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' ');
var MAX_PUSH = 8;
var MAX_AGE_DAYS = 7;

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('watch').timeBased().everyMinutes(5).create();
  watch();   // first run seeds silently
  push_('Internship watcher (Apps Script) is on', 'Checks every 5 minutes.', 'https://github.com/SimplifyJobs/Summer2027-Internships');
}

function norm_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

function props_() { return PropertiesService.getScriptProperties(); }

function loadSeen_() {
  var p = props_(), n = Number(p.getProperty('SEEN_CHUNKS') || 0), out = {};
  for (var i = 0; i < n; i++) {
    var part = JSON.parse(p.getProperty('SEEN_' + i) || '{}');
    for (var k in part) out[k] = part[k];
  }
  return { map: out, seeded: p.getProperty('SEEDED') === '1' };
}

function saveSeen_(map) {
  var p = props_(), keys = Object.keys(map), chunks = [], cur = {}, size = 2;
  keys.forEach(function (k) {
    var add = k.length + 16;
    if (size + add > 8500) { chunks.push(cur); cur = {}; size = 2; }
    cur[k] = map[k]; size += add;
  });
  chunks.push(cur);
  var old = Number(p.getProperty('SEEN_CHUNKS') || 0);
  chunks.forEach(function (c, i) { p.setProperty('SEEN_' + i, JSON.stringify(c)); });
  for (var j = chunks.length; j < old; j++) p.deleteProperty('SEEN_' + j);
  p.setProperty('SEEN_CHUNKS', String(chunks.length));
}

function fetchIfChanged_(url, key) {
  var p = props_(), etag = p.getProperty('ETAG_' + key);
  var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: etag ? { 'If-None-Match': etag } : {} });
  if (r.getResponseCode() === 304) return null;
  if (r.getResponseCode() !== 200) throw new Error(key + ' HTTP ' + r.getResponseCode());
  var h = r.getHeaders();
  return { text: r.getContentText(), etag: h['ETag'] || h['Etag'] || h['etag'] || '' };
}

function companies_() {
  var p = props_(), got = fetchIfChanged_(COMPANIES, 'COMPANIES');
  if (got) {
    var list = got.text.split('\n').map(function (l) { return l.trim(); })
      .filter(function (l) { return l && l.charAt(0) !== '#'; }).map(norm_);
    p.setProperty('COMPANY_LIST', JSON.stringify(list));
    if (got.etag) p.setProperty('ETAG_COMPANIES', got.etag);
  }
  return JSON.parse(p.getProperty('COMPANY_LIST') || '[]');
}

function tierOk_(company, tiers) {
  var c = norm_(company);
  return tiers.some(function (t) { return c === t || c.indexOf(t + ' ') === 0; });
}

function isUs_(locs) {
  if (!locs || !locs.length) return true;
  return locs.some(function (l) {
    if (/remote/i.test(l) && !/canada|uk|india|europe|emea|apac|mexico|brazil/i.test(l)) return true;
    var parts = l.split(',').map(function (s) { return s.trim(); });
    if (parts.length >= 2 && parts[1].length <= 3 && US.indexOf(parts[1].slice(0, 2).toUpperCase()) >= 0) return true;
    return /\b(USA|United States|US)\b/.test(l);
  });
}

function push_(title, body, url) {
  var topic = props_().getProperty('NTFY_TOPIC');
  if (!topic) throw new Error('Script property NTFY_TOPIC is missing');
  var headers = { Title: title.replace(/[^\x20-\x7E]/g, ''), Priority: 'high', Tags: 'briefcase' };
  if (url) headers.Click = url;
  var r = UrlFetchApp.fetch('https://ntfy.sh/' + encodeURIComponent(topic),
    { method: 'post', payload: body, headers: headers, muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) throw new Error('ntfy HTTP ' + r.getResponseCode());
}

function watch() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;            // a previous run is still going
  try {
    var got = fetchIfChanged_(LISTINGS, 'LISTINGS');
    if (!got) return;                          // feed unchanged since last run
    var data = JSON.parse(got.text);
    var tiers = companies_();
    var st = loadSeen_(), seen = st.map, first = !st.seeded;
    var now = Date.now() / 1000, keepAfter = now - (MAX_AGE_DAYS + 2) * 86400;
    var hits = [];
    data.forEach(function (x) {
      if ((x.date_posted || 0) < keepAfter || seen[x.id]) return;
      seen[x.id] = Math.round(x.date_posted || now);
      if (first) return;
      if (!(x.active && x.is_visible !== false)) return;
      if (CATS.indexOf(x.category) < 0 || !(x.terms || []).some(function (t) { return TERMS.indexOf(t) >= 0; })) return;
      if (now - (x.date_posted || 0) > MAX_AGE_DAYS * 86400) return;
      var t = x.title || '';
      if (EXCL.test(t) || !REQ.test(t) || !isUs_(x.locations)) return;
      if (!tierOk_(x.company_name, tiers)) return;
      hits.push(x);
    });
    var failed = 0;
    hits.slice(0, MAX_PUSH).forEach(function (x) {
      var title = (x.company_name + ' - ' + x.title).slice(0, 120);
      var body = (x.terms || []).join(', ') + ' | ' + (x.locations || []).slice(0, 2).join(', ') + '\nTap to open the posting.';
      try { push_(title, body, x.url); } catch (e) { delete seen[x.id]; failed++; }   // retried next run
    });
    if (hits.length > MAX_PUSH) {
      try { push_('+' + (hits.length - MAX_PUSH) + ' more SPAN-tier postings', 'Check SimplifyJobs Summer2027-Internships.',
                  'https://github.com/SimplifyJobs/Summer2027-Internships'); }
      catch (e) { hits.slice(MAX_PUSH).forEach(function (x) { delete seen[x.id]; }); failed++; }
    }
    Object.keys(seen).forEach(function (k) { if (seen[k] < keepAfter) delete seen[k]; });
    saveSeen_(seen);
    props_().setProperty('SEEDED', '1');
    if (got.etag && !failed) props_().setProperty('ETAG_LISTINGS', got.etag);   // on failure, re-read next run
    props_().setProperty('LAST_RUN', new Date().toISOString() + ' hits=' + hits.length + ' failed=' + failed);
  } finally {
    lock.releaseLock();
  }
}
