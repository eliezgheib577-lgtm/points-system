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
const SHEETJS = process.env.SHEETJS_PATH || '';
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
  const config = `window.LEMSIC_FIREBASE = ${JSON.stringify({ apiKey: KEY, authDomain: `${PROJECT}.firebaseapp.com`, projectId: PROJECT, emulator: { auth: AUTH, host: '127.0.0.1', firestorePort: 8080 } })};`;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/firebase-config.js')) { res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end(config); }
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
  check('setup loaded: seven committees with their LO logins', (await vpa.locator('.col-main tbody tr').count()) === 7 && lcs.includes('lo.uob'));
  await vpa.screenshot({ path: `${SHOTS}/31-site-committees.png`, fullPage: true });
  await nav(vpa, 'Members');
  for (const [n, id] of [['Lea Khoury', 'LEM-2341'], ['Karim Nassar', 'LEM-2502'], ['Maya Saad', 'LEM-2488']]) {
    await vpa.fill('input[name="name"]', n); await vpa.fill('input[name="lemsicId"]', id);
    await vpa.selectOption('form[data-submit="addMember"] select[name="lc"]', 'AUB');
    await vpa.click('form[data-submit="addMember"] button[type=submit]'); await settle(vpa, 700);
  }
  check('three members added', (await vpa.locator('.col-main tbody tr').count()) === 3);

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
  for (const [m, c, pts] of [['Lea Khoury', 'OC coordinator', 12], ['Maya Saad', 'Volunteer — half day', 6]]) {
    await pick(lo, 'form[data-submit="addRow"] select[name="member"]', m);
    await pick(lo, 'form[data-submit="addRow"] select[name="cat"]', c);
    await lo.fill('form[data-submit="addRow"] input[name="pts"]', String(pts));
    await lo.click('form[data-submit="addRow"] button[type=submit]'); await settle(lo, 700);
  }
  await lo.screenshot({ path: `${SHOTS}/32-site-lo-edit.png`, fullPage: true });
  await lo.fill('textarea[name="loNote"]', 'Maya covered two shifts.');
  await lo.click('form[data-submit="send"] button[type=submit]'); await settle(lo, 1000);
  check('LO sends it', (await text(lo)).includes('Pending VPA'));
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
  await vpa.screenshot({ path: `${SHOTS}/33-site-review.png`, fullPage: true });
  await vpa.click('form[data-submit="approve"] button[type=submit]'); await settle(vpa, 1500);
  await nav(vpa, 'Points sheet');
  const sheet = await text(vpa);
  check('approved: 12 + 4 = 16 on the books', sheet.includes('+12') && sheet.includes('+4') && /grand total\s*16\b/i.test(sheet));
  await vpa.screenshot({ path: `${SHOTS}/34-site-ledger.png`, fullPage: true });
  if (SHEETJS) {
    const [dl] = await Promise.all([vpa.waitForEvent('download', { timeout: 15000 }), vpa.click('button[data-act="exportXlsx"]')]);
    const file = await dl.path(); const size = fs.statSync(file).size;
    check(`Excel workbook downloads (${dl.suggestedFilename()}, ${size} bytes)`, /\.xlsx$/.test(dl.suggestedFilename()) && size > 1000);
  } else console.log('  skip  Excel download (set SHEETJS_PATH)');
  check(`the VPA screens never hit a refusal (${(await errors(vpa)).length})`, (await errors(vpa)).length === 0);

  await lo.reload(); await lo.waitForSelector('.shell'); await settle(lo, 1000);
  await nav(lo, 'Dashboard'); await settle(lo, 600);
  const loAfter = await text(lo);
  check('the avatar reads as the position (no stray “·”)', (await lo.innerText('.side-foot .avatar')).trim() === 'LA');
  check('the LO sees “Approved” and no figures', loAfter.includes('Approved') && !loAfter.includes('+12') && !/\b16\b/.test(loAfter));

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
