/**
 * End-to-end test of the GitHub Pages build (docs/index.html) on Google's emulators:
 * the real Firebase SDK, the real Auth service and the real Firestore rules engine.
 *
 *   npm run test:site
 *
 * The SDK files are served from node_modules/firebase in place of Google's CDN — they
 * are the same build. Set SHEETJS_PATH to a local xlsx@0.18.5 dist/xlsx.full.min.js to
 * include the Excel download (skipped otherwise).
 */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..', '..', '..');
const SHOTS = process.env.E2E_SHOTS || path.join(ROOT, 'docs', 'screens');
const SHEETJS = process.env.SHEETJS_PATH || path.join(ROOT, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js');
const MS = require('../fixtures/fake-microsoft.cjs');
const WORKBOOK = MS.createWorkbook();
const OLD_SHEET = require('../fixtures/old-sheet.cjs')(path.join(require('os').tmpdir(), 'lemsic-old-points-site-' + process.pid + '.xlsx'));
const RUBRIC = require('../fixtures/rubric.cjs')(path.join(require('os').tmpdir(), 'lemsic-rubric-site-' + process.pid + '.xlsx'));
const MEMBER_LIST = require('../fixtures/member-list.cjs')(path.join(require('os').tmpdir(), 'lemsic-members-site-' + process.pid + '.xlsx'));
const PROJECT = 'demo-lemsic', KEY = 'fake-api-key', PW = 'test-password-2026';
const AUTH = 'http://127.0.0.1:9099', FS = 'http://127.0.0.1:8080';
const fail = []; const check = (l, c) => { console.log((c ? '  ok   ' : '  FAIL ') + l); if (!c) fail.push(l); };
const settle = (p, ms = 400) => p.waitForTimeout(ms);

async function resetEmulators() {
  await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  for (const user of ['vpa', 'lo.aub', 'lo.usj', 'treasurer']) {
    const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${user}@lemsic-points.app`, password: PW, returnSecureToken: true }),
    });
    if (!r.ok) throw new Error('could not create ' + user + ': ' + await r.text());
  }
}

function serve() {
  const index = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
  const config = `window.LEMSIC_FIREBASE = ${JSON.stringify({ apiKey: KEY, authDomain: `${PROJECT}.firebaseapp.com`, projectId: PROJECT, emulator: { auth: AUTH, host: '127.0.0.1', firestorePort: 8080 } })};\nwindow.LEMSIC_MICROSOFT = { clientId: 'test-client-id', tenantId: 'test-tenant' };`;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/site-settings.js')) { res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end(config); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(index);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

async function open(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => fail.push('JS error: ' + e.message));
  await p.route('https://www.gstatic.com/firebasejs/10.12.2/*', (r) => r.fulfill({
    path: path.join(ROOT, 'node_modules', 'firebase', path.basename(new URL(r.request().url()).pathname)),
    contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' },
  }));
  await MS.install(p, WORKBOOK);
  if (SHEETJS) await p.route('**/xlsx.full.min.js', (r) => r.fulfill({ path: SHEETJS, contentType: 'application/javascript' }));
  await p.goto(base);
  await p.waitForFunction(() => document.querySelector('.authbox, .shell') || /isn't one of/.test(document.body.innerText), null, { timeout: 20000 });
  return p;
}
async function signIn(p, user, pw) {
  await p.fill('#si-u', user); await p.fill('#si-p', pw);
  await p.click('form[data-submit="signIn"] button[type=submit]');
  await p.waitForFunction(() => document.querySelector('.shell') || /don't match|isn't one of/.test(document.body.innerText), null, { timeout: 15000 });
  await settle(p);
}
async function pick(p, sel, prefix) {
  const v = await p.$$eval(sel + ' option', (o, x) => { const m = o.find((e) => e.textContent.trim().startsWith(x)); return m ? m.value : null; }, prefix);
  if (!v) throw new Error(`no option "${prefix}" in ${sel}`);
  await p.selectOption(sel, v);
}
/** Type into a member search box, then click the match whose name is `name` (or press Enter for the top one). */
async function chooseMember(p, form, typed, name, how = 'click') {
  const box = `${form} input[data-picker]`;
  if (await p.isVisible(`${form} button[data-act="unpickMember"]`)) { await p.click(`${form} button[data-act="unpickMember"]`); }
  await p.fill(box, typed);
  await p.waitForSelector(`${form} .pickopt:has-text("${name}")`, { timeout: 5000 });
  if (how === 'enter') await p.press(box, 'Enter'); else await p.click(`${form} .pickopt:has-text("${name}")`);
  await p.waitForSelector(`${form} .picked:has-text("${name}")`, { timeout: 5000 });
}
const nav = async (p, label) => { await p.click(`.side button.nav:has-text("${label}")`); await settle(p); };
const text = (p) => p.innerText('body');
const errors = (p) => p.evaluate(() => (window.__lemsicErrors || []).slice());

(async () => {
  await resetEmulators();
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const b = await chromium.launch();

  console.log('\n— signing in —');
  const vpa = await open(b, base);
  check('signed out: the sign-in page', await vpa.isVisible('form[data-submit="signIn"]'));
  await vpa.screenshot({ path: `${SHOTS}/30-site-sign-in.png`, fullPage: true });
  await signIn(vpa, 'vpa', 'wrong-password');
  check('a wrong password is refused', (await text(vpa)).includes("don't match"));
  await signIn(vpa, 'vpa', PW);
  check('vpa signs in as the VPA', await vpa.isVisible('.side button.nav:has-text("Points sheet")'));
  check('an empty database offers the starting setup', await vpa.isVisible('button[data-act="loadSetup"]'));
  await vpa.click('button[data-act="loadSetup"]'); await settle(vpa, 1500);
  await nav(vpa, 'Committees');
  const lcs = await text(vpa);
  check('setup loaded: eight committees with their LO logins, SGUB included', (await vpa.locator('.col-main tbody tr').count()) === 8 && lcs.includes('lo.uob') && lcs.includes('lo.sgub'));
  await vpa.screenshot({ path: `${SHOTS}/31-site-committees.png`, fullPage: true });
  await nav(vpa, 'Members');
  for (const [n, id, lc] of [['Lea Khoury', 'LEM-2341', 'AUB'], ['Karim Nassar', 'LEM-2502', 'AUB'], ['Maya Saad', 'LEM-2488', 'AUB'], ['Omar Fakih', 'LEM-3107', 'USJ']]) {
    await vpa.fill('input[name="name"]', n); await vpa.fill('input[name="lemsicId"]', id);
    await vpa.selectOption('form[data-submit="addMember"] select[name="lc"]', lc);
    await vpa.click('form[data-submit="addMember"] button[type=submit]'); await settle(vpa, 700);
  }
  check('four members added, one of them in LC USJ', (await vpa.locator('.col-main tbody tr').count()) === 4);
  await vpa.fill('input[name="name"]', 'Someone Else'); await vpa.fill('input[name="lemsicId"]', 'lem 2341');
  await vpa.selectOption('form[data-submit="addMember"] select[name="lc"]', 'LAU');
  await vpa.click('form[data-submit="addMember"] button[type=submit]'); await settle(vpa, 700);
  check('a LeMSIC ID can only belong to one person, however it is typed', (await text(vpa)).includes('LEM-2341 already belongs to Lea Khoury') || (await text(vpa)).includes('lem 2341 already belongs to Lea Khoury'));
  await vpa.fill('input[name="name"]', ''); await vpa.fill('input[name="lemsicId"]', '');
  await vpa.fill('input[data-live="members-table"]', 'nassar');
  check('the member list can be searched', (await vpa.locator('#members-table tbody tr').count()) === 1 && (await vpa.innerText('#members-table')).includes('Karim Nassar'));
  await vpa.fill('input[data-live="members-table"]', '');

  console.log('\n— a Local Officer —');
  const lo = await open(b, base);
  await signIn(lo, 'lo.aub', PW);
  check('lo.aub lands on LC AUB', (await lo.innerText('h1')).includes('LC AUB'));
  check('…with no points sheet anywhere in the navigation', !(await lo.isVisible('.side button.nav:has-text("Points sheet")')));
  await lo.click('.side button.nav:has-text("New submission")'); await settle(lo);
  await lo.fill('input[name="title"]', 'Blood Pressure Screening'); await lo.fill('input[name="date"]', '2026-11-15');
  await lo.fill('input[name="location"]', 'Bliss Street, Beirut');
  await lo.click('form[data-submit="createDraft"] button[type=submit]');
  await lo.waitForSelector('form[data-submit="addRow"]', { timeout: 10000 }); await settle(lo);
  const ROW = 'form[data-submit="addRow"]';
  await lo.fill(`${ROW} input[data-picker]`, 'khuory');
  await lo.waitForSelector(`${ROW} .pickopt`);
  check('the search finds a name typed with a typo (“khuory” → Lea Khoury)', (await lo.innerText(`${ROW} .pickopt.on`)).includes('Lea Khoury'));
  await lo.fill(`${ROW} input[data-picker]`, 'lem-3107');
  await lo.waitForSelector(`${ROW} .pickopt:has-text("Omar Fakih")`);
  check('…and a member of another LC by their LeMSIC ID, marked with their LC', (await lo.innerText(`${ROW} .pickopt.on`)).includes('LC USJ'));
  await lo.fill(`${ROW} input[data-picker]`, 'zzzz');
  check('…and says so when nobody matches', (await lo.innerText(`${ROW} .picklist`)).includes('No member matches'));
  check('…without ever showing points', !/\bpts\b|points/i.test(await lo.innerText(`${ROW} .picklist`)));
  for (const [typed, m, c, pts, how] of [['khuory', 'Lea Khoury', 'OC coordinator', 12, 'click'], ['2488', 'Maya Saad', 'Volunteer — half day', 6, 'enter'], ['LEM-3107', 'Omar Fakih', 'Volunteer — half day', 3, 'click']]) {
    await chooseMember(lo, ROW, typed, m, how);
    await pick(lo, `${ROW} select[name="cat"]`, c);
    await lo.fill(`${ROW} input[name="pts"]`, String(pts));
    await lo.click(`${ROW} button[type=submit]`); await settle(lo, 700);
  }
  check('three volunteers added, Enter picking the top match', (await lo.locator('tr', { hasText: 'Maya Saad' }).count()) === 1 && (await lo.locator('.col-main table tbody tr').count()) === 3);
  check('the volunteer from LC USJ is labelled with their LC', (await lo.locator('tr', { hasText: 'Omar Fakih' }).innerText()).includes('LC USJ'));
  await lo.fill(`${ROW} input[data-picker]`, 'lea');
  check('someone already on the event can\'t be added twice', await lo.isDisabled(`${ROW} .pickopt:has-text("Lea Khoury")`));
  await lo.fill(`${ROW} input[data-picker]`, '');
  await lo.screenshot({ path: `${SHOTS}/32-site-lo-edit.png`, fullPage: true });
  await lo.fill('textarea[name="loNote"]', 'Maya covered two shifts.');
  await lo.click('form[data-submit="send"] button[type=submit]'); await settle(lo, 1000);
  check('LO sends it', (await text(lo)).includes('Pending VPA'));
  await lo.click('button[data-act="recallSub"]'); await settle(lo);
  check('taking it back asks for a second click', (await lo.innerText('button[data-act="recallSub"]')).includes('Really'));
  await lo.click('button[data-act="recallSub"]'); await settle(lo, 1200);
  check('the LO takes it back before the VPA decides: a draft again, editable', await lo.isVisible('form[data-submit="addRow"]') && (await lo.locator('.col-main table tbody tr').count()) === 3);
  await lo.click('form[data-submit="send"] button[type=submit]'); await settle(lo, 1000);
  check('…and sends it again', (await text(lo)).includes('Pending VPA'));
  const peek = await lo.evaluate(async () => {
    const A = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    const F = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const db = F.getFirestore(A.getApp());
    const tryRead = async (fn) => { try { await fn(); return 'read'; } catch (e) { return e.code; } };
    return {
      ledger: await tryRead(() => F.getDocs(F.collection(db, 'ledger'))),
      other: await tryRead(() => F.getDocs(F.collection(db, 'subs/lo.usj/items'))),
      award: await tryRead(() => F.setDoc(F.doc(db, 'ledger/sneaky'), { pts: 99, kind: 'award', memberId: 'x' })),
    };
  });
  check(`the database refuses the LO the ledger (${peek.ledger}), others' work (${peek.other}) and awarding (${peek.award})`,
    peek.ledger === 'permission-denied' && peek.other === 'permission-denied' && peek.award === 'permission-denied');
  check(`the LO screens never touched anything forbidden (${(await errors(lo)).length} refusals)`, (await errors(lo)).length === 0);

  console.log('\n— the VPA decides —');
  await nav(vpa, 'Pending review');
  check('the submission is in the queue, from “LO · AUB”', (await text(vpa)).includes('Blood Pressure Screening') && (await text(vpa)).includes('LO · AUB'));
  await vpa.locator('tr', { hasText: 'Blood Pressure Screening' }).locator('button:has-text("Review")').click(); await settle(vpa);
  check('the out-of-band row opens capped at 4', (await vpa.locator('tr', { hasText: 'Maya Saad' }).locator('input.pts').inputValue()) === '4');
  check('the VPA is told one volunteer is from another LC', (await text(vpa)).includes('1 volunteer is from another LC (LC USJ)'));
  await vpa.screenshot({ path: `${SHOTS}/33-site-review.png`, fullPage: true });
  await vpa.click('form[data-submit="approve"] button[type=submit]'); await settle(vpa, 1500);
  await nav(vpa, 'Points sheet');
  const sheet = await text(vpa);
  check('approved: 12 + 4 + 3 = 19 on the books', sheet.includes('+12') && sheet.includes('+4') && sheet.includes('+3') && /grand total\s*19\b/i.test(sheet));
  await vpa.click('button[data-act="go"][data-view="lc"]'); await settle(vpa);
  const usjRow = await vpa.locator('tr', { hasText: 'LC USJ' }).innerText().catch(() => '');
  check(`Omar's 3 points count for his own LC, USJ, not the LC that ran the event (${usjRow.replace(/\s+/g, ' ').trim()})`, /\b3\s*$/.test(usjRow.trim()));
  await vpa.click('button[data-act="go"][data-view="ledger"]'); await settle(vpa);
  await nav(vpa, 'All submissions');
  await vpa.locator('tr', { hasText: 'Blood Pressure Screening' }).locator('button:has-text("Open")').click(); await settle(vpa);
  await vpa.click('button[data-act="undoApproval"]'); await settle(vpa); await vpa.click('button[data-act="undoApproval"]'); await settle(vpa, 2000);
  check('the VPA undoes an approval: it is back in the review queue', await vpa.isVisible('form[data-submit="approve"]'));
  await nav(vpa, 'Points sheet');
  const undone = await text(vpa);
  check('…and the points are taken back with minus entries, nothing deleted (grand total 0)', /grand total\s*0\b/i.test(undone) && undone.includes('Approval undone') && undone.includes('+12'));
  await nav(vpa, 'Pending review');
  await vpa.locator('tr', { hasText: 'Blood Pressure Screening' }).locator('button:has-text("Review")').click(); await settle(vpa);
  await vpa.click('form[data-submit="approve"] button[type=submit]'); await settle(vpa, 1500);
  await nav(vpa, 'Points sheet');
  check('approving it again pays once, not twice (grand total 19)', /grand total\s*19\b/i.test(await text(vpa)));
  await vpa.screenshot({ path: `${SHOTS}/34-site-ledger.png`, fullPage: true });
  if (SHEETJS) {
    const [dl] = await Promise.all([vpa.waitForEvent('download', { timeout: 15000 }), vpa.click('button[data-act="exportXlsx"]')]);
    const file = await dl.path(); const size = fs.statSync(file).size;
    check(`Excel workbook downloads (${dl.suggestedFilename()}, ${size} bytes)`, /\.xlsx$/.test(dl.suggestedFilename()) && size > 1000);
  } else console.log('  skip  Excel download (set SHEETJS_PATH)');
  console.log('\n— importing the old sheet —');
  await nav(vpa, 'Import old sheet');
  await vpa.setInputFiles('input[data-act-file="importFile"]', OLD_SHEET); await vpa.waitForTimeout(1500);
  await vpa.click('button[data-act="impMatch"]'); await settle(vpa);
  await vpa.selectOption('select[data-imp="defaultLc"]', 'BAU'); await settle(vpa);
  check('8 starting balances worth 450 points, as in the claude.ai build', (await vpa.innerText('button[data-act="impApply"]')).includes('8 starting balances (450 pts)'));
  await vpa.click('button[data-act="impApply"]'); await vpa.waitForSelector('text=Imported.', { timeout: 30000 }); await settle(vpa, 800);
  await nav(vpa, 'Points sheet');
  check('the database took it: carried forward 450, grand total 469', /carried forward\s*450\b/i.test(await text(vpa)) && /grand total\s*469\b/i.test(await text(vpa)));
  await nav(vpa, 'Import old sheet');
  await vpa.click('button[data-act="impReset"]'); await settle(vpa);
  await vpa.click('button[data-act="impUndo"]'); await settle(vpa); await vpa.click('button[data-act="impUndo"]'); await settle(vpa, 2000);
  await nav(vpa, 'Points sheet');
  check('undo works without deleting anything: grand total back to 19', /grand total\s*19\b/i.test(await text(vpa)) && (await text(vpa)).includes('Undo of IMP-'));
  console.log('\n— keeping the Excel workbook up to date —');
  const xl = (name) => (WORKBOOK.sheets.find((x) => x.name === name) || { cells: [] }).cells;
  await nav(vpa, 'Excel');
  check('Excel starts disconnected, offering Microsoft sign-in', await vpa.isVisible('button[data-act="msConnect"]'));
  await vpa.click('button[data-act="msConnect"]'); await settle(vpa, 600);
  check('signed in to Microsoft 365', (await text(vpa)).includes('vpa@lemsic.org'));
  const redirect = await vpa.evaluate(() => window.__msalConfig && window.__msalConfig.auth.redirectUri);
  check(`the pop-up returns to the blank page next to the site (${redirect})`, /\/ms-redirect\.html$/.test(redirect || ''));
  await vpa.fill('#xl-link', MS.LINK); await vpa.click('form[data-submit="xlLink"] button[type=submit]'); await settle(vpa, 2500);
  check('the pasted SharePoint link is found and connected', (await text(vpa)).includes('LeMSIC Points.xlsx') && await vpa.isVisible('button[data-act="xlSync"]'));
  const rejected = WORKBOOK.calls.filter((c) => c.startsWith('REJECTED'));
  check(`every call matched the documented API (${rejected.length} rejected${rejected.length ? ': ' + rejected[0] : ''})`, rejected.length === 0);
  check('the app’s three sheets were created and filled', ['Totals by member', 'Ledger', 'By LC'].every((n) => xl(n).length > 1) && xl('Ledger')[0][0] === 'Date');
  check('your own “VPA notes” sheet is untouched', JSON.stringify(xl('VPA notes')) === JSON.stringify([['My own notes'], ['Keep this']]));
  const owned = WORKBOOK.sheets.filter((x) => ['Totals by member', 'Ledger', 'By LC'].includes(x.name));
  check('the app’s sheets are locked against accidental typing; yours is not', owned.every((x) => x.protected) && !WORKBOOK.sheets.find((x) => x.name === 'VPA notes').protected);
  check(`the shared file says when it was last updated (“${(xl('Totals by member')[1] || [])[7]}”)`, xl('Totals by member')[0][7] === 'Last updated' && /LeMSIC Points$/.test((xl('Totals by member')[1] || [])[7] || ''));
  const leaTotal = () => { const r = xl('Totals by member').find((row) => row[0] === 'Lea Khoury'); return r ? r[5] : null; };
  check(`Lea's total in Excel matches the app (${leaTotal()})`, leaTotal() === 12);
  const omarXl = xl('Ledger').find((row) => row[1] === 'Omar Fakih') || [];
  check(`Excel's ledger shows Omar under LC USJ, from an event run by LC AUB (${omarXl[3]}, ${omarXl[8]})`, omarXl[3] === 'USJ' && omarXl[8] === 'LC AUB');
  check('Excel\'s By LC sheet credits USJ with Omar\'s 3', (xl('By LC').find((row) => row[0] === 'USJ') || [])[4] === 3);
  await vpa.screenshot({ path: `${SHOTS}/35-site-excel.png`, fullPage: true });
  await nav(vpa, 'Points sheet');
  await chooseMember(vpa, 'form[data-submit="correction"]', 'Lea', 'Lea Khoury');
  await vpa.fill('form[data-submit="correction"] input[name="pts"]', '5'); await vpa.fill('form[data-submit="correction"] input[name="reason"]', 'Late credit for the poster');
  await vpa.click('form[data-submit="correction"] button[type=submit]'); await settle(vpa, 2500);
  check(`a correction reaches Excel by itself (Lea now ${leaTotal()})`, leaTotal() === 17);
  WORKBOOK.lockNext = true;
  await vpa.fill('form[data-submit="correction"] input[name="pts"]', '-2'); await vpa.fill('form[data-submit="correction"] input[name="reason"]', 'Double-counted shift');
  await chooseMember(vpa, 'form[data-submit="correction"]', 'LEM-2341', 'Lea Khoury', 'enter');
  await vpa.click('form[data-submit="correction"] button[type=submit]'); await settle(vpa, 2500);
  await nav(vpa, 'Excel');
  check('a locked workbook is reported, not silently missed', (await text(vpa)).includes('locked by someone editing it'));
  await vpa.click('button[data-act="xlSync"]'); await settle(vpa, 2500);
  check(`“Update now” catches up once it's free (Lea ${leaTotal()})`, leaTotal() === 15 && !(await text(vpa)).includes('needs attention'));

  // The VPA works on another device that has never signed in to Microsoft.
  const phoneVpa = await open(b, base);
  await signIn(phoneVpa, 'vpa', PW);
  await nav(phoneVpa, 'Points sheet');
  const phoneCorrection = async (pts, why) => {
    await chooseMember(phoneVpa, 'form[data-submit="correction"]', 'lea k', 'Lea Khoury');
    await phoneVpa.fill('form[data-submit="correction"] input[name="pts"]', String(pts)); await phoneVpa.fill('form[data-submit="correction"] input[name="reason"]', why);
    await phoneVpa.click('form[data-submit="correction"] button[type=submit]');
  };
  await phoneCorrection(3, 'Approved from a phone'); await settle(phoneVpa, 4500);
  check(`while a signed-in device has the site open, a change made on the phone reaches Excel within seconds (Lea ${leaTotal()})`, leaTotal() === 18);

  await vpa.goto('about:blank');                       // nobody signed in to Microsoft has the site open now
  await phoneCorrection(1, 'Another from the phone'); await settle(phoneVpa, 2500);
  check(`with no signed-in device open, Excel waits (Lea still ${leaTotal()})`, leaTotal() === 18);
  check('…and the phone says the workbook is behind', (await phoneVpa.innerText('.topbar')).includes('Excel: behind'));
  await vpa.goto(base); await vpa.waitForSelector('.shell'); await settle(vpa, 4500);
  check(`opening the site on the signed-in device catches it up by itself (Lea ${leaTotal()})`, leaTotal() === 19);
  check('…and the badge goes back to “Excel ✓”', (await vpa.innerText('.topbar')).includes('Excel ✓'));
  await nav(vpa, 'Points sheet');
  const lastCorr = vpa.locator('tr', { hasText: 'Another from the phone' }).locator('button[data-act="undoCorrection"]');
  await lastCorr.click(); await settle(vpa); await lastCorr.click(); await settle(vpa, 3000);
  check(`a correction made by mistake is undone with a minus entry, and Excel follows (Lea ${leaTotal()})`, leaTotal() === 18 && (await text(vpa)).includes('Undo of a correction'));
  check('…and can\'t be undone twice', (await vpa.locator('tr', { hasText: 'Another from the phone' }).filter({ hasNotText: 'Undo of' }).innerText()).includes('undone'));
  await phoneVpa.context().close();

  console.log('\n— uploading the member list —');
  await nav(vpa, 'Members');
  await vpa.setInputFiles('input[data-act-file="memberFile"]', MEMBER_LIST); await vpa.waitForSelector('button[data-act="memberListApply"]', { timeout: 15000 }); await settle(vpa);
  const preview = await vpa.innerText('.col-side');
  const picked = async (k) => vpa.$eval(`select[data-ml="col.${k}"]`, (e) => e.selectedOptions[0].textContent);
  check(`the right columns are found: ${await picked('name')}, ${await picked('id')}, ${await picked('lc')}`, (await picked('name')).includes('Full Name') && (await picked('id')).includes('ID_to_email') && (await picked('lc')).includes('Local Commitee'));
  check('…not the phone number or the standing committee', !preview.includes('+961') && !preview.includes('SCOPH'));
  check('…and the first rows are shown as they will be read', /Lea Khoury\s*LEM-2341\s*LC AUB/.test(preview));
  check('preview: 3 new, 1 ID filled in, 3 already here, 2 skipped', /3 new members/.test(preview) && /1 already here get/.test(preview) && /3 already in the registry/.test(preview) && /2 skipped/.test(preview));
  check('…a spelling variant is recognised as the same person (Karim Nasar → Karim Nassar)', preview.includes('Karim Nasar → Karim Nassar'));
  check('…and the skipped rows say why', preview.includes('listed twice in this file') && preview.includes('“Harvard” isn\'t one of the LCs'));
  await vpa.click('button[data-act="memberListApply"]'); await vpa.waitForSelector('text=3 members added', { timeout: 20000 }); await settle(vpa, 800);
  const members = await vpa.innerText('#members-table');
  check('the new members are in the registry, their LCs read from “LeMSIC-LAU”, “University of Balamand” and “Beirut Arab Uni”', /Jad Mansour[\s\S]*?LAU/.test(members) && /Tala Hamdan[\s\S]*?UOB/.test(members) && /Rita Salameh[\s\S]*?BAU/.test(members));
  const stored = await vpa.evaluate(async () => {
    const A = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    const F = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    return (await F.getDocs(F.collection(F.getFirestore(A.getApp()), 'members'))).docs.map((d) => JSON.stringify(d.data())).join('\n');
  });
  check('phone numbers are never stored (LOs can read the member list)', !/961|phone/i.test(stored));
  check('…and Nour got her LeMSIC ID', /Nour Abou Jaoude\s*LEM-4005/.test(members));
  await vpa.setInputFiles('input[data-act-file="memberFile"]', MEMBER_LIST); await vpa.waitForSelector('button[data-act="memberListApply"]', { timeout: 15000 }); await settle(vpa);
  check('uploading the same list again adds nobody', /0 new members/.test(await vpa.innerText('.col-side')) && await vpa.isDisabled('button[data-act="memberListApply"]'));
  await vpa.click('button[data-act="memberListCancel"]'); await settle(vpa);
  check('the upload is listed, with an Undo', (await vpa.innerText('.col-side')).includes('Uploads so far') && await vpa.isVisible('button[data-act="memberUploadUndo"]'));
  await vpa.click('button[data-act="memberUploadUndo"]'); await settle(vpa); await vpa.click('button[data-act="memberUploadUndo"]'); await settle(vpa, 2500);
  const afterUndo = await vpa.innerText('#members-table');
  check('undoing the upload removes who it added and clears the ID it filled in', !afterUndo.includes('Jad Mansour') && !afterUndo.includes('Rita Salameh') && !afterUndo.includes('LEM-4005') && afterUndo.includes('Nour Abou Jaoude') && afterUndo.includes('Lea Khoury'));
  check('…and it shows as undone', (await vpa.innerText('.col-side')).includes('undone'));
  // A member list uploaded before uploads could be undone carries no record: it can still be undone.
  await vpa.evaluate(async () => {
    const A = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    const F = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const db = F.getFirestore(A.getApp());
    for (const [id, name, phone] of [['old1', 'Old Upload One', '70123456'], ['old2', 'Old Upload Two', '71123456']])
      await F.setDoc(F.doc(db, 'members/' + id), { name, norm: name.toLowerCase(), lemsicId: phone, lc: 'LAU', year: null, status: 'active', createdAt: 1, via: 'member list' });
  });
  await settle(vpa, 1000);
  check('an earlier upload with no record is listed too', (await vpa.innerText('.col-side')).includes('Earlier upload'));
  await vpa.locator('tr', { hasText: 'Earlier upload' }).locator('button[data-act="memberUploadUndo"]').click(); await settle(vpa);
  await vpa.locator('tr', { hasText: 'Earlier upload' }).locator('button[data-act="memberUploadUndo"]').click(); await settle(vpa, 2000);
  check('…and undoing it removes those members (and their phone numbers)', !(await vpa.innerText('#members-table')).includes('Old Upload'));
  await vpa.fill('input[name="name"]', 'Typo Persn'); await vpa.fill('input[name="lemsicId"]', 'LEM-9999');
  await vpa.selectOption('form[data-submit="addMember"] select[name="lc"]', 'LU');
  await vpa.click('form[data-submit="addMember"] button[type=submit]'); await settle(vpa, 800);
  await vpa.locator('#members-table tr', { hasText: 'Typo Persn' }).locator('button[data-act="editMember"]').click(); await settle(vpa);
  await vpa.fill('form[data-submit="saveMember"] input[name="name"]', 'Typo Person');
  await vpa.selectOption('form[data-submit="saveMember"] select[name="lc"]', 'LAU');
  await vpa.click('form[data-submit="saveMember"] button[type=submit]'); await settle(vpa, 800);
  check('a member can be edited: name and LC fixed', /Typo Person\s*LEM-9999\s*LAU/.test(await vpa.innerText('#members-table')));
  await vpa.locator('#members-table tr', { hasText: 'Typo Person' }).locator('button[data-act="editMember"]').click(); await settle(vpa);
  await vpa.click('button[data-act="deleteMember"]'); await settle(vpa); await vpa.click('button[data-act="deleteMember"]'); await settle(vpa, 1000);
  check('…and deleted while they have no points', !(await vpa.innerText('#members-table')).includes('Typo Person'));
  await vpa.locator('#members-table tr', { hasText: 'Lea Khoury' }).locator('button[data-act="editMember"]').click(); await settle(vpa);
  check('someone with points can\'t be deleted — only edited or marked alumni', !(await vpa.isVisible('button[data-act="deleteMember"]')) && (await vpa.innerText('form[data-submit="saveMember"]')).includes("can't be deleted"));
  await vpa.click('button[data-act="editMemberClose"]'); await settle(vpa);

  // Clearing members: re-upload the list, then clear everyone who can go, then undo it.
  await vpa.setInputFiles('input[data-act-file="memberFile"]', MEMBER_LIST); await vpa.waitForSelector('button[data-act="memberListApply"]', { timeout: 15000 }); await settle(vpa);
  await vpa.click('button[data-act="memberListApply"]'); await vpa.waitForSelector('text=3 members added', { timeout: 20000 }); await settle(vpa, 800);
  const total = await vpa.locator('#members-table tbody tr').count();
  await vpa.selectOption('select#cm-l', 'LAU'); await settle(vpa);
  check('clearing one LC counts only that LC (Jad Mansour, LAU)', (await vpa.innerText('button[data-act="clearMembers"]')).includes('Remove 1 member'));
  await vpa.selectOption('select#cm-l', ''); await settle(vpa);
  const clearCard = await vpa.locator('.card', { hasText: 'Clear members' }).innerText();
  check(`clearing everyone removes the 3 with no points and keeps the ${total - 3} who have points or are on a submission`, clearCard.includes('Remove 3 members') && clearCard.includes(`${total - 3} stay`));
  await vpa.click('button[data-act="clearMembers"]'); await settle(vpa);
  check('clearing asks for a second click', (await vpa.innerText('button[data-act="clearMembers"]')).includes('Really'));
  await vpa.click('button[data-act="clearMembers"]'); await vpa.waitForSelector('text=3 members removed', { timeout: 20000 }); await settle(vpa, 800);
  const cleared = await vpa.innerText('#members-table');
  check('cleared: the 3 are gone, everyone with points stays', (await vpa.locator('#members-table tbody tr').count()) === total - 3 && !cleared.includes('Jad Mansour') && cleared.includes('Lea Khoury') && cleared.includes('Omar Fakih'));
  await vpa.click('button[data-act="undoClear"]'); await settle(vpa); await vpa.click('button[data-act="undoClear"]'); await vpa.waitForSelector('text=3 members back', { timeout: 20000 }); await settle(vpa, 800);
  check('undoing the clear brings the same 3 back', (await vpa.locator('#members-table tbody tr').count()) === total && (await vpa.innerText('#members-table')).includes('Jad Mansour'));
  await nav(vpa, 'Import old sheet');
  check('clears and uploads never show up as old-sheet imports', !(await vpa.innerText('body')).includes('CLR-') && !(await vpa.innerText('body')).includes('UPL-'));
  await nav(vpa, 'Members');

  console.log('\n— uploading a rubric —');
  await nav(vpa, 'Rubric & rules');
  await vpa.setInputFiles('input[data-act-file="rubricFile"]', RUBRIC); await vpa.waitForSelector('button[data-act="rubricApply"]', { timeout: 15000 }); await settle(vpa);
  const rcol = async (k) => vpa.$eval(`select[data-rl="col.${k}"]`, (e) => e.selectedOptions[0].textContent);
  check(`its columns are found under the title: ${await rcol('group')}, ${await rcol('label')}, ${await rcol('pts')}`, (await rcol('group')).includes('Sheet') && (await rcol('label')).includes('Type') && (await rcol('pts')).includes('Points'));
  const rprev = await vpa.locator('.card', { hasText: 'Upload a rubric' }).innerText();
  check('preview: 5 categories in 3 sections, 2 rows skipped and why', /5 categories\s*in 3 sections/.test(rprev) && /2 rows skipped/.test(rprev) && rprev.includes("isn't a whole number") && rprev.includes('listed twice'));
  check('…the 2 placeholder categories already used are retired, the other 7 removed', /7 will be removed, 2 retired/.test(rprev));
  await vpa.click('button[data-act="rubricApply"]'); await vpa.waitForSelector('text=Rubric updated', { timeout: 15000 }); await settle(vpa, 800);
  const rub = await vpa.innerText('.content');
  const labels = () => vpa.$$eval('input[name="label"][data-form^="rb_"]', (els) => els.map((e) => e.value));
  const after = await labels();
  check('the rubric now has its sections, and the retired ones sit apart at the bottom', /ACTIVITY[\s\S]*CB[\s\S]*POSITION[\s\S]*RETIRED/i.test(rub) && after.includes('NatOC Coordinator') && after.includes('OC coordinator') && !after.includes('Participant / attendee') && after.indexOf('OC coordinator') > after.indexOf('LO'));
  await nav(lo, 'New submission');
  await lo.fill('input[name="title"]', 'Rubric check'); await lo.fill('input[name="date"]', '2026-11-16'); await lo.fill('input[name="location"]', 'Online');
  await lo.click('form[data-submit="createDraft"] button[type=submit]'); await lo.waitForSelector('form[data-submit="addRow"]'); await settle(lo, 600);
  const groupsSeen = await lo.$$eval('select[name="cat"] optgroup', (g) => g.map((x) => x.label));
  check(`the LO picks a type by section (${groupsSeen.join(', ')}), never a retired one`, groupsSeen.join(',') === 'Activity,CB,Position' && !(await lo.innerText('select[name="cat"]')).includes('OC coordinator'));
  await pick(lo, 'form[data-submit="addRow"] select[name="cat"]', 'LocOC Coordinator');
  check('…and the fixed points fill themselves in (15)', (await lo.inputValue('form[data-submit="addRow"] input[name="pts"]')) === '15');
  await lo.click('button[data-act="delDraft"]'); await settle(lo, 800);
  await vpa.click('button[data-act="rubricUndo"]'); await settle(vpa); await vpa.click('button[data-act="rubricUndo"]'); await vpa.waitForSelector('text=Rubric upload undone', { timeout: 15000 }); await settle(vpa, 800);
  const back = await labels();
  check(`undoing the upload puts the old rubric back exactly (${back.length} categories)`, back.length === 9 && back.includes('Participant / attendee') && !back.includes('NatOC Coordinator') && !/RETIRED —/i.test(await vpa.innerText('.content')));
  check(`the VPA screens never hit a refusal (${(await errors(vpa)).length})`, (await errors(vpa)).length === 0);

  await lo.reload(); await lo.waitForSelector('.shell'); await settle(lo, 1000);
  await nav(lo, 'Dashboard'); await settle(lo, 600);
  const loAfter = await text(lo);
  check('the avatar reads as the position (no stray “·”)', (await lo.innerText('.side-foot .avatar')).trim() === 'LA');
  check('the LO sees “Approved” and no figures', loAfter.includes('Approved') && !loAfter.includes('+12') && !/\b19\b/.test(loAfter));

  console.log('\n— everyone else —');
  const odd = await open(b, base);
  await signIn(odd, 'treasurer', PW);
  check('a login that is not a position gets nothing', (await text(odd)).includes("isn't one of LeMSIC's positions"));
  await odd.click('button[data-act="signOut"]'); await odd.waitForSelector('form[data-submit="signIn"]', { timeout: 10000 });
  check('signing out returns to the sign-in page', true);
  const phone = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone.route('https://www.gstatic.com/firebasejs/10.12.2/*', (r) => r.fulfill({ path: path.join(ROOT, 'node_modules', 'firebase', path.basename(new URL(r.request().url()).pathname)), contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } }));
  await phone.goto(base); await phone.waitForSelector('form[data-submit="signIn"]');
  const ov = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`sign-in fits a phone (${ov}px sideways)`, ov <= 0);

  await b.close(); server.close();
  console.log('\n' + (fail.length ? `${fail.length} FAILED:\n - ` + fail.join('\n - ') : 'ALL CHECKS PASSED'));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message.split('\n')[0]); process.exit(2); });
