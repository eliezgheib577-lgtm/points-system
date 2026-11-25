/**
 * End-to-end test of the published Artifact (artifact/lemsic-points.html).
 *
 * Runs the page twice: as a plain browser (demo mode), and against a stand-in for
 * the claude.ai host (tests/e2e/artifact/mock-claude.js) that enforces the same
 * access rules the real platform will (artifact/db-rules.json), with three people
 * sharing one database: the owner (VPA), an LO invited as Editor, and a view-only
 * visitor. It fails if any screen tries something the rules forbid.
 *
 *   python3 mockups/build-artifact.py && node tests/e2e/artifact/artifact.e2e.cjs
 *
 * The Excel export loads SheetJS from cdnjs; point SHEETJS_PATH at a local copy of
 * xlsx@0.18.5's dist/xlsx.full.min.js to test it offline (the check is skipped otherwise).
 */
const { chromium } = require('playwright');
const fs = require('fs');
let BASE = '';
const path = require('path');
const http = require('http');
const ROOT = path.join(__dirname, '..', '..', '..');
const SHEETJS = process.env.SHEETJS_PATH || path.join(ROOT, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js');
const os = require('os');
const OLD_SHEET = require('../fixtures/old-sheet.cjs')(path.join(os.tmpdir(), 'lemsic-old-points-' + process.pid + '.xlsx'));
const SHOTS = process.env.E2E_SHOTS || path.join(ROOT, 'docs', 'screens');
const SEED = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifact', 'live-seed.json'), 'utf8')).docs;
const fail = []; const check = (l, c) => { console.log((c ? '  ok   ' : '  FAIL ') + l); if (!c) fail.push(l); };
const settle = (p) => p.waitForTimeout(250);

async function open(ctx, as) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => fail.push(`JS error (${as || 'demo'}): ${e.message}`));
  if (SHEETJS) await p.route('**/xlsx.full.min.js', (r) => r.fulfill({ path: SHEETJS, contentType: 'application/javascript' }));
  await p.goto(BASE + (as ? `?as=${as}` : ''));
  await p.waitForFunction(() => document.querySelector('.shell') || /nearly in|Waiting for the VPA/.test(document.body.innerText), null, { timeout: 15000 });
  await settle(p);
  return p;
}
async function pick(p, sel, prefix) {
  const v = await p.$$eval(sel + ' option', (o, x) => { const m = o.find((e) => e.textContent.trim().startsWith(x)); return m ? m.value : null; }, prefix);
  if (!v) throw new Error(`no option "${prefix}" in ${sel}`);
  await p.selectOption(sel, v);
}
const text = (p) => p.innerText('body');
const nav = async (p, label) => { await p.click(`.side button.nav:has-text("${label}")`); await settle(p); };
async function addRow(p, member, cat, pts, note) {
  const f = 'form[data-submit="addRow"]';
  // Members are found by typing: part of the name, then click the match.
  if (await p.isVisible(`${f} button[data-act="unpickMember"]`)) await p.click(`${f} button[data-act="unpickMember"]`);
  await p.fill(`${f} input[data-picker]`, member);
  await p.click(`${f} .pickopt:has-text("${member}")`); await p.waitForSelector(`${f} .picked`);
  await pick(p, `${f} select[name="cat"]`, cat);
  if (pts != null) await p.fill(`${f} input[name="pts"]`, String(pts));
  if (note) await p.fill(`${f} input[name="note"]`, note);
  await p.click(`${f} button[type=submit]`); await settle(p);
}
async function newEvent(p, title, date, where) {
  await p.click('.side button.nav:has-text("New submission")'); await settle(p);
  await p.fill('input[name="title"]', title); await p.fill('input[name="date"]', date); await p.fill('input[name="location"]', where);
  await p.selectOption('form[data-submit="createDraft"] select[name="sc"]', 'SCOPH');
  await p.click('form[data-submit="createDraft"] button[type=submit]');
  await p.waitForSelector('form[data-submit="addRow"]'); await settle(p);
}

function harness() {
  const page = fs.readFileSync(path.join(ROOT, 'artifact', 'lemsic-points.html'), 'utf8');
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifact', 'db-rules.json'), 'utf8')).rules;
  const mock = fs.readFileSync(path.join(__dirname, 'mock-claude.js'), 'utf8');
  return '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
    + 'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>'
    + `<script>window.__RULES__=${JSON.stringify(rules)};</script><script>${mock}</script>` + page + '</body></html>';
}

(async () => {
  const html = harness();
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}/`;
  const b = await chromium.launch();

  console.log('\n— demo mode (no host, anyone with the link) —');
  const dctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const d = await open(dctx);
  check('opens in demo mode', await d.isVisible('.modechip.demo'));
  check('as an LO by default, with a returned submission flagged', (await text(d)).includes('Action needed'));
  await d.screenshot({ path: `${SHOTS}/20-artifact-demo-lo.png`, fullPage: true });
  await d.click('button.linkbtn:has-text("Open & fix")'); await settle(d);
  check('the rule breach blocks sending', await d.isDisabled('form[data-submit="send"] button[type=submit]'));
  const karim = d.locator('tr', { hasText: 'Karim Nassar' }).locator('button[data-act="delRow"]');
  await karim.click(); await settle(d);
  check('removing the second coordinator unblocks it', !(await d.isDisabled('form[data-submit="send"] button[type=submit]')));
  await d.click('form[data-submit="send"] button[type=submit]'); await settle(d);
  check('resent to the VPA', (await text(d)).includes('Pending VPA'));
  await newEvent(d, 'Hand Hygiene Workshop', '2026-11-16', 'AUB Medical Hall');
  await addRow(d, 'Hani Khalil', 'Trainer / facilitator', null, 'Ran both sessions');
  check('rubric default fills the points box', (await text(d)).includes('Hani Khalil') && (await d.locator('tr', { hasText: 'Hani Khalil' }).innerText()).includes('10'));
  await addRow(d, 'Nour Abou Jaoude', 'Volunteer — half day', 3, 'Registration');
  await d.screenshot({ path: `${SHOTS}/21-artifact-demo-edit.png`, fullPage: true });
  await d.click('form[data-submit="send"] button[type=submit]'); await settle(d);
  const loText = await text(d);
  check('LO never sees a points sheet in the nav', !(await d.isVisible('.side button.nav:has-text("Points sheet")')));
  check('LO detail shows the lock note, not figures', loText.includes('held by the VPA') && !/Approved \d/.test(loText));
  await d.click('.seg button:has-text("VPA")'); await settle(d);
  check('switching to VPA shows four waiting', (await d.innerText('h1')).includes('4 submissions'));
  await nav(d, 'Pending review');
  await d.locator('tr', { hasText: 'World Diabetes Day' }).locator('button:has-text("Review")').click(); await settle(d);
  const omar = d.locator('tr', { hasText: 'Omar Chehab' });
  check('the out-of-band row opens capped at the band max', (await omar.locator('input.pts').inputValue()) === '4');
  await omar.locator('input.cellinp').fill('Extra shift credited at band max.');
  await d.screenshot({ path: `${SHOTS}/22-artifact-demo-review.png`, fullPage: true });
  await d.click('form[data-submit="approve"] button[type=submit]'); await settle(d);
  await nav(d, 'Points sheet');
  const sheet = await text(d);
  check('approval reached the ledger as +4 for Omar', sheet.includes('Omar Chehab') && /\+4/.test(sheet));
  await d.screenshot({ path: `${SHOTS}/23-artifact-demo-ledger.png`, fullPage: true });
  await d.click('button.linkbtn:has-text("Start the demo over")'); await settle(d);
  await d.click('.seg button:has-text("LO")'); await settle(d);
  check('reset puts the demo back where it started', (await text(d)).includes('Action needed'));
  await dctx.close();

  console.log('\n— live mode, one shared database, three people —');
  const lctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const owner = await open(lctx, 'owner');
  await owner.evaluate(() => localStorage.removeItem('mockdb'));
  await owner.reload(); await owner.waitForSelector('.shell'); await settle(owner);
  check('owner is the VPA, live', await owner.isVisible('.modechip.live') && (await text(owner)).includes('Nothing waiting on you'));
  check('an empty space tells the VPA what is missing', (await text(owner)).includes('no committees or rubric yet'));
  await owner.evaluate((docs) => window.__mockSeed(docs), SEED); await settle(owner);
  check('starting setup arrives live without a reload', !(await text(owner)).includes('no committees or rubric yet'));
  await nav(owner, 'Members');
  for (const [n, id] of [['Lea Khoury', 'LEM-2341'], ['Karim Nassar', 'LEM-2502'], ['Maya Saad', 'LEM-2488']]) {
    await owner.fill('input[name="name"]', n); await owner.fill('input[name="lemsicId"]', id);
    await owner.selectOption('form[data-submit="addMember"] select[name="lc"]', 'AUB');
    await owner.click('form[data-submit="addMember"] button[type=submit]'); await settle(owner);
  }
  check('three members in the registry', (await owner.locator('.col-main tbody tr').count()) === 3);
  await owner.fill('input[name="name"]', 'lea khoury'); await owner.selectOption('form[data-submit="addMember"] select[name="lc"]', 'AUB');
  await owner.click('form[data-submit="addMember"] button[type=submit]'); await settle(owner);
  check('the same person twice is refused', (await text(owner)).includes('already in the registry'));

  const lo = await open(lctx, 'lo1');
  check('a new LO lands on the request screen', (await text(lo)).includes('nearly in'));
  await lo.selectOption('select[name="lc"]', 'AUB');
  await lo.click('form[data-submit="requestAccess"] button[type=submit]'); await settle(lo);
  check('their request is waiting', (await text(lo)).includes('Waiting for the VPA'));
  await owner.bringToFront(); await nav(owner, 'Access & LCs'); await settle(owner);
  check('the VPA sees the request by name', (await text(owner)).includes('Rami Haddad'));
  await owner.screenshot({ path: `${SHOTS}/24-artifact-live-access.png`, fullPage: true });
  await owner.click('button[data-act="approveReq"]'); await settle(owner);
  await lo.bringToFront(); await lo.waitForSelector('.shell', { timeout: 5000 }).catch(() => {}); await settle(lo);
  check('approval reaches the LO live, no reload', (await text(lo)).includes('Welcome back, Rami'));

  await newEvent(lo, 'Blood Pressure Screening', '2026-11-15', 'Bliss Street, Beirut');
  await addRow(lo, 'Lea Khoury', 'OC coordinator', 12, 'Ran the stall');
  await addRow(lo, 'Maya Saad', 'Volunteer — half day', 6, 'Covered two shifts');
  await lo.fill('textarea[name="loNote"]', 'Maya covered for someone who was ill.');
  await lo.click('form[data-submit="send"] button[type=submit]'); await settle(lo);
  check('LO sends it', (await text(lo)).includes('Pending VPA'));
  const peek = await lo.evaluate(async () => {
    const db = await window.claude.use('db');
    const [l, dcs, a, r, others] = await Promise.all([db.collection('ledger').get(), db.collection('decisions').get(), db.collection('audit').get(), db.collection('roster').get(), db.collection('subs/u_owner/items').get()]);
    return { ledger: l.size, decisions: dcs.size, audit: a.size, rosterIds: r.docs.map((x) => x.id), others: others.size, denied: window.__mockLog.slice() };
  });
  check('rules hide the ledger, decisions and audit from the LO', peek.ledger + peek.decisions + peek.audit === 0);
  check(`…and other people's roster entries and submissions (roster seen: ${JSON.stringify(peek.rosterIds)}, others: ${peek.others})`, peek.rosterIds.every((id) => id === 'u_lo1') && peek.others === 0);
  check(`the LO screens never attempted anything the rules forbid (${peek.denied.length} denials)`, peek.denied.length === 0);

  await owner.bringToFront(); await nav(owner, 'Pending review');
  check('the submission is in the VPA queue', (await text(owner)).includes('Blood Pressure Screening'));
  await owner.locator('tr', { hasText: 'Blood Pressure Screening' }).locator('button:has-text("Review")').click(); await settle(owner);
  await owner.locator('tr', { hasText: 'Maya Saad' }).locator('input.cellinp').fill('Two shifts — band max is 4.');
  await owner.screenshot({ path: `${SHOTS}/25-artifact-live-review.png`, fullPage: true });
  await owner.click('form[data-submit="approve"] button[type=submit]'); await settle(owner);
  await nav(owner, 'Points sheet');
  const live = await text(owner);
  check(`approved live: 12 + 4 = 16 on the books (${(live.match(/grand total\s*\d+/i) || ['?'])[0].replace(/\s+/g, ' ')})`, live.includes('+12') && live.includes('+4') && /grand total\s*16\b/i.test(live));
  if (SHEETJS) {
  await owner.click('button[data-act="exportXlsx"]'); await owner.waitForTimeout(1500);
  const saved = await owner.evaluate(() => window.__saved);
  check(`Excel workbook offered for download (${saved[0] ? saved[0].filename + ', ' + saved[0].size + ' bytes' : 'nothing'})`, saved.length === 1 && /\.xlsx$/.test(saved[0].filename) && saved[0].size > 1000);
  } else console.log('  skip  Excel export (set SHEETJS_PATH to test it offline)');
  await owner.screenshot({ path: `${SHOTS}/26-artifact-live-ledger.png`, fullPage: true });

  console.log('\n— importing the old sheet —');
  await nav(owner, 'Import old sheet');
  await owner.setInputFiles('input[data-act-file="importFile"]', OLD_SHEET); await owner.waitForTimeout(1200);
  check('it finds the TOTALS sheet and the headings on row 3', (await owner.inputValue('input[data-imp="header"]')) === '3' && (await text(owner)).includes('Student Name'));
  await owner.screenshot({ path: `${SHOTS}/28-artifact-import-columns.png`, fullPage: true });
  await owner.click('button[data-act="impMatch"]'); await settle(owner);
  const twin = owner.locator('tr', { hasText: 'L. Khoury' }).locator('select[data-imp="dec"]');
  check('“L. Khoury” is matched to Lea Khoury for checking', (await twin.locator('option:checked').innerText()).startsWith('Lea Khoury'));
  const typo = owner.locator('tr', { hasText: 'Karim Nasar' }).locator('select[data-imp="dec"]');
  check('the typo “Karim Nasar” is matched to Karim Nassar', (await typo.locator('option:checked').innerText()).startsWith('Karim Nassar'));
  check('the row with no points is left out and said so', (await text(owner)).includes('1 row has a name but no readable points'));
  check('import is held until the unknown university gets a committee', await owner.isDisabled('button[data-act="impApply"]'));
  await owner.selectOption('select[data-imp="defaultLc"]', 'BAU'); await settle(owner);
  check('then it offers 8 balances worth 450 points', (await owner.innerText('button[data-act="impApply"]')).includes('8 starting balances (450 pts)'));
  await owner.screenshot({ path: `${SHOTS}/29-artifact-import-names.png`, fullPage: true });
  await owner.click('button[data-act="impApply"]'); await owner.waitForSelector('text=Imported.', { timeout: 15000 }); await settle(owner);
  await nav(owner, 'Points sheet');
  check('carried forward is 450 and the grand total 466', /carried forward\s*450\b/i.test(await text(owner)) && /grand total\s*466\b/i.test(await text(owner)));
  await owner.click('button[data-view="member"]'); await settle(owner);
  const leaRow = await owner.locator('tr', { hasText: 'Lea Khoury' }).innerText();
  check('Lea carries 96 (84 + the 12 written as “L. Khoury”) on top of her 12 this term', /96/.test(leaRow) && /\b108\b/.test(leaRow));
  await nav(owner, 'Members');
  check('six new members joined the registry, Perla under UOB', (await owner.locator('.col-main tbody tr').count()) === 9 && (await owner.locator('tr', { hasText: 'Perla Gemayel' }).innerText()).includes('UOB'));
  await nav(owner, 'Import old sheet');
  await owner.click('button[data-act="impReset"]'); await settle(owner);
  await owner.setInputFiles('input[data-act-file="importFile"]', OLD_SHEET); await owner.waitForTimeout(1200);
  check('the same file a second time is refused', (await text(owner)).includes('was already imported'));
  await owner.click('button[data-act="impReset"]'); await settle(owner);
  await owner.click('button[data-act="impUndo"]'); await settle(owner);
  check('undo asks for a second click', (await owner.innerText('button[data-act="impUndo"]')).includes('Really undo'));
  await owner.click('button[data-act="impUndo"]'); await settle(owner, 1200);
  await nav(owner, 'Points sheet');
  check('after undo the grand total is back to 16, with the history kept', /grand total\s*16\b/i.test(await text(owner)) && (await text(owner)).includes('Undo of IMP-'));

  await lo.bringToFront(); await settle(lo);
  const loAfter = await text(lo);
  check('the LO sees “Approved” and no figures, and no import', loAfter.includes('Approved') && !loAfter.includes('+12') && !loAfter.includes('Import old sheet'));

  await owner.bringToFront();
  await owner.click('.seg button:has-text("Preview as LO")'); await settle(owner);
  check('the owner can preview the LO screens', (await text(owner)).includes('Previewing the LO screens'));
  await owner.click('.seg button:has-text("VPA")'); await settle(owner);
  const ownerDenied = await owner.evaluate(() => window.__mockLog.slice());
  check(`the VPA screens never hit a rule either (${ownerDenied.length} denials)`, ownerDenied.length === 0);

  // Testing only: the owner wipes the test copy and starts again.
  await nav(owner, 'Overview');
  check('the test copy has a reset, locked until you type RESET', await owner.isVisible('text=Reset this test copy') && await owner.isDisabled('button[data-act="resetTest"]'));
  await owner.fill('input[name="confirm"][data-form="reset_test"]', 'reset'); await settle(owner, 200);
  await owner.click('button[data-act="resetTest"]'); await owner.waitForSelector('text=This test copy is empty', { timeout: 30000 }); await settle(owner, 1200);
  check('reset: everything is gone and the starting setup is offered again', await owner.isVisible('button[data-act="loadSetup"]') && /grand total\s*0\b/i.test(await (async () => { await nav(owner, 'Points sheet'); return text(owner); })()));
  await nav(owner, 'Members');
  check('…no members left', (await text(owner)).includes('No members yet'));
  await nav(owner, 'Access & LCs');
  check('…but the approved Local Officer still has access', (await owner.locator('.card', { hasText: 'Local Officers' }).first().innerText()).includes('1'));

  const out = await open(lctx, 'outsider');
  check('a view-only visitor is told to ask for an Editor invite', (await text(out)).includes('invite you as an Editor'));
  await out.click('button[data-act="openDemo"]'); await settle(out);
  check('…and can still try the demo', await out.isVisible('.modechip.demo'));

  const phone = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await phone.goto(BASE); await phone.waitForSelector('.shell'); await settle(phone);
  const ov = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`phone width: no sideways scroll (${ov}px), section bar shown`, ov <= 0 && await phone.isVisible('.mnav'));
  await phone.screenshot({ path: `${SHOTS}/27-artifact-phone.png`, fullPage: true });

  const dark = await b.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  await dark.goto(BASE); await dark.waitForSelector('.shell'); await settle(dark);
  const bg = await dark.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(`dark mode follows the system (${bg})`, bg === 'rgb(18, 19, 20)');

  await b.close(); server.close();
  console.log('\n' + (fail.length ? `${fail.length} FAILED:\n - ` + fail.join('\n - ') : 'ALL CHECKS PASSED'));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message.split('\n')[0]); process.exit(2); });
