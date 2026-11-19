/**
 * End-to-end: the VPA issues an account; first sign-in forces a new password; reset, switch-off and brute-force behave.
 *
 * Needs a running server and a freshly seeded database — `npm run test:e2e`
 * does both seeds; start the server yourself first with `npm run dev`.
 * Sign-in limits are held in the server's memory, so restart it if you run
 * this suite several times inside fifteen minutes.
 */
const { chromium } = require('playwright');
const path = require('path');
const SHOT=process.env.E2E_SHOTS || path.join(__dirname,'..','..','docs','screens');
const BASE=process.env.E2E_BASE || 'http://localhost:3000';
const fail=[]; const check=(l,c)=>{console.log((c?'  ok   ':'  FAIL ')+l); if(!c) fail.push(l);};

async function signIn(page,user,pw){
  await page.goto(BASE+'/login');
  await page.fill('#username',user); await page.fill('#password',pw);
  await page.click('form[action="/login"] button[type=submit]');
  await page.waitForLoadState('networkidle');
}
const pin = () => addEventListener('DOMContentLoaded',()=>document.querySelectorAll('.topbar').forEach(e=>e.style.position='static'));

(async () => {
  const b = await chromium.launch();
  const vpaCtx = await b.newContext({ viewport:{width:1440,height:900}, deviceScaleFactor:2 });
  const vpa = await vpaCtx.newPage(); await vpa.addInitScript(pin);

  console.log('\n— who can reach it —');
  const loCtx0 = await b.newContext(); const lo0 = await loCtx0.newPage();
  await signIn(lo0,'lo.aub','lemsic-demo-2026');
  check('an LO is refused /accounts', (await lo0.goto(BASE+'/accounts')).status()===403);
  await loCtx0.close();

  await signIn(vpa,'vpa','lemsic-demo-2026');
  check('the VPA reaches /accounts', (await vpa.goto(BASE+'/accounts')).status()===200);
  await vpa.screenshot({path:`${SHOT}/14-accounts.png`, fullPage:true});

  console.log('\n— issuing —');
  await vpa.fill('#display_name','Perla Gemayel');
  await vpa.fill('#username','lo.balamand');
  await vpa.selectOption('#role','lo');
  const balamand = await vpa.$$eval('#lc_id option',o=>o.find(x=>x.textContent.includes('Balamand')).value);
  await vpa.selectOption('#lc_id',balamand);
  await vpa.click('form[action="/accounts"] button[type=submit]');
  await vpa.waitForLoadState('networkidle');
  const oneTime = (await vpa.textContent('#slip-pass')).trim();
  check(`credential slip shows a one-time password (${oneTime})`, /^[a-z]+-[a-z]+-[a-z]+-\d{4}$/.test(oneTime));
  check('slip includes a ready-to-send message', (await vpa.textContent('#slip-message')).includes(oneTime));
  await vpa.screenshot({path:`${SHOT}/15-credential-slip.png`, fullPage:true});

  const stored = require('child_process').execSync(
    `psql "${process.env.DATABASE_URL}" -tAc "select password_hash from users where username='lo.balamand'"`).toString().trim();
  check('the password is stored only as a bcrypt hash', stored.startsWith('$2') && !stored.includes(oneTime));

  await vpa.goto(BASE+'/accounts');
  await vpa.fill('#display_name','Someone Else'); await vpa.fill('#username','lo.balamand');
  await vpa.selectOption('#lc_id',balamand);
  await vpa.click('form[action="/accounts"] button[type=submit]'); await vpa.waitForLoadState('networkidle');
  check('a taken username is refused', (await vpa.textContent('body')).includes('already taken'));

  await vpa.goto(BASE+'/accounts');
  await vpa.fill('#display_name','No Committee'); await vpa.fill('#username','lo.nowhere');
  await vpa.selectOption('#role','lo');
  await vpa.click('form[action="/accounts"] button[type=submit]'); await vpa.waitForLoadState('networkidle');
  check('an LO with no committee is refused', (await vpa.textContent('body')).includes('has to belong to a committee'));

  console.log('\n— first sign-in —');
  const loCtx = await b.newContext({ viewport:{width:1440,height:900}, deviceScaleFactor:2 });
  const lo = await loCtx.newPage();
  await signIn(lo,'lo.balamand',oneTime);
  check('first sign-in lands on the password screen', lo.url().endsWith('/password'));
  await lo.screenshot({path:`${SHOT}/16-first-sign-in.png`, fullPage:true});
  await lo.goto(BASE+'/');
  check('they cannot skip it by going to the dashboard', lo.url().endsWith('/password'));
  await lo.fill('#current',oneTime); await lo.fill('#next','short');
  const shortOk = await lo.$eval('#next', el => el.checkValidity());
  check('a short new password is rejected', !shortOk);
  await lo.fill('#next','balamand-blood-drive-2026');
  await lo.click('form[action="/password"] button[type=submit]'); await lo.waitForLoadState('networkidle');
  check('after choosing a password they reach their dashboard', (await lo.textContent('h1')).includes('Welcome back, Perla'));
  check('…scoped to their own committee', (await lo.textContent('body')).includes('LC Balamand'));

  const oldCtx = await b.newContext(); const old = await oldCtx.newPage();
  await signIn(old,'lo.balamand',oneTime);
  check('the one-time password stops working once replaced', old.url().includes('/login'));
  await oldCtx.close();

  console.log('\n— reset —');
  await vpa.goto(BASE+'/accounts');
  const row = vpa.locator('tr', { hasText: 'lo.balamand' });
  await row.locator('form[action$="/reset"] button').click(); await vpa.waitForLoadState('networkidle');
  const second = (await vpa.textContent('#slip-pass')).trim();
  check('a reset issues a different password', second !== oneTime && /^[a-z]+-[a-z]+-[a-z]+-\d{4}$/.test(second));
  await lo.goto(BASE+'/');
  check('a reset signs them out of the session they had', lo.url().includes('/login'));
  await signIn(lo,'lo.balamand','balamand-blood-drive-2026');
  check('their own password stops working after a reset', lo.url().includes('/login'));
  await signIn(lo,'lo.balamand',second);
  check('the reset password works and forces a change again', lo.url().endsWith('/password'));

  console.log('\n— switching off —');
  await vpa.goto(BASE+'/accounts');
  const own = vpa.locator('tr', { hasText: /^.*\bvpa\b/ }).filter({ hasText: 'Yara Dagher' });
  check('there is no switch-off button on your own row', (await own.locator('form[action$="/active"]').count())===0);
  const selfId = require('child_process').execSync(
    `psql "${process.env.DATABASE_URL}" -tAc "select id from users where username='vpa'"`).toString().trim();
  const csrf = await vpa.$eval('input[name=_csrf]', el => el.value);
  const selfOff = await vpa.request.post(`${BASE}/accounts/${selfId}/active`, { form: { _csrf: csrf, active: 'false' } });
  check(`and posting it anyway is refused (HTTP ${selfOff.status()})`, selfOff.status()===400);

  await vpa.goto(BASE+'/accounts');
  await vpa.locator('tr', { hasText: 'lo.balamand' }).locator('form[action$="/active"] button').click();
  await vpa.waitForLoadState('networkidle');
  await lo.goto(BASE+'/');
  check('switching an account off ends its session', lo.url().includes('/login'));
  await signIn(lo,'lo.balamand',second);
  check('a switched-off account cannot sign in', lo.url().includes('/login'));

  await vpa.goto(BASE+'/accounts');
  await vpa.locator('tr', { hasText: 'LC AUB' }).filter({ hasText: 'American University' })
    .locator('form[action$="/active"] button').click();
  await vpa.waitForLoadState('networkidle');
  check('a committee with active officers cannot be archived', (await vpa.textContent('body')).includes('Switch off that committee'));

  console.log('\n— brute force —');
  const bf = await (await b.newContext()).newPage();
  let status = 0;
  for (let i=0;i<10;i++){ await signIn(bf,'lo.usj','wrong-guess-'+i); }
  const r = await bf.goto(BASE+'/login');
  await bf.fill('#username','lo.usj'); await bf.fill('#password','lemsic-demo-2026');
  const [resp] = await Promise.all([ bf.waitForResponse(x=>x.url().endsWith('/login') && x.request().method()==='POST'),
                                     bf.click('form[action="/login"] button[type=submit]') ]);
  status = resp.status();
  check(`after 10 wrong guesses even the right password is held off (HTTP ${status})`, status===429);
  check('…and the message says how long to wait', (await bf.textContent('body')).includes('Try again in'));
  await bf.screenshot({path:`${SHOT}/17-throttled.png`});

  const audit = require('child_process').execSync(
    `psql "${process.env.DATABASE_URL}" -tAc "select string_agg(distinct action, ',') from audit_log"`).toString();
  for (const a of ['account.created','account.password_reset','account.disabled','login.failed','login.throttled','password.changed'])
    check(`audit log records ${a}`, audit.includes(a));

  await vpa.goto(BASE+'/audit');
  await vpa.screenshot({path:`${SHOT}/18-audit-accounts.png`, fullPage:true});

  await b.close();
  console.log('\n'+(fail.length?`${fail.length} FAILED:\n - `+fail.join('\n - '):'ALL CHECKS PASSED'));
  process.exit(fail.length?1:0);
})();
