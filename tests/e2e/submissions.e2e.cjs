/**
 * End-to-end: an LO logs an event and six volunteers, sends it; the VPA adjusts one row and approves; the ledger holds exactly what was approved.
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
const PW='lemsic-demo-2026';
const fail=[];
const check=(label,cond)=>{ console.log((cond?'  ok   ':'  FAIL ')+label); if(!cond) fail.push(label); };

async function login(page,user){
  await page.goto(BASE+'/login');
  await page.fill('#username',user); await page.fill('#password',PW);
  await page.click('form[action="/login"] button[type=submit]');
  await page.waitForLoadState('networkidle');
}
async function selectByPrefix(page,sel,prefix){
  const value = await page.$$eval(sel+' option',(opts,p)=>{
    const o=opts.find(o=>o.textContent.trim().startsWith(p)); return o?o.value:null; },prefix);
  if(!value) throw new Error('no option starting with "'+prefix+'" in '+sel);
  await page.selectOption(sel,value);
}

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport:{width:1440,height:900}, deviceScaleFactor:2 });
  // position:sticky paints at the scroll offset in a full-page capture, landing
  // the topbar in the middle of the image. Pin it for screenshots only.
  await page.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('.topbar').forEach(el => { el.style.position = 'static'; });
    });
  });
  page.on('pageerror', e => fail.push('JS error: '+e.message));

  await page.goto(BASE+'/login');
  await page.screenshot({path:`${SHOT}/01-login.png`, fullPage:true});

  console.log('\n— Local Officer —');
  await login(page,'lo.aub');
  check('LO lands on their dashboard',(await page.textContent('h1')).includes('Welcome back'));

  await page.goto(BASE+'/submissions/new');
  await page.fill('#title','World Diabetes Day Screening Campaign');
  await page.fill('#event_date','2026-11-14');
  await page.fill('#location','Hamra Public Square, Beirut');
  await page.selectOption('#standing_committee','SCOPH');
  await page.selectOption('#activity_type','Campaign / Screening');
  await page.selectOption('#duration_label','Full day (over 4 h)');
  await page.fill('#description','Free blood-glucose and BMI screening with referral slips. 240 people screened across 8 hours.');
  await page.screenshot({path:`${SHOT}/03-lo-new-event.png`, fullPage:true});
  await page.click('form[action="/submissions"] button[type=submit]');
  await page.waitForLoadState('networkidle');
  check('draft created, on the rows editor', page.url().includes('/edit'));
  const base = page.url().replace(/\/edit.*$/,'');

  const rows=[
    ['Lea Khoury','OC coordinator',10,12,'Led planning, permits and scheduling'],
    ['Karim Nassar','OC member',8,8,'Logistics and equipment, on site all day'],
    ['Maya Saad','Trainer / facilitator',4,10,'Ran the glucometer training'],
    ['Jad Mansour','Volunteer — full day',8,5,'Screening station 2, ~70 participants'],
    ['Tala Fares','Design / social media',3,3,'Poster, 3 stories, recap reel'],
    ['Omar Chehab','Volunteer — half day',4,7,'Referral slips and data entry'],
  ];
  for (const [member,role,hours,pts,what] of rows){
    await selectByPrefix(page,'#member_id',member);
    await selectByPrefix(page,'#category_id',role);
    await page.fill('#hours',String(hours));
    await page.fill('#proposed_points',String(pts));
    await page.fill('#effort_note',what);
    await page.click('form[action$="/rows"] button[type=submit]');
    await page.waitForLoadState('networkidle');
  }
  check('six rows listed', (await page.locator('.card table tbody tr').count())>=6);
  const editBody = await page.textContent('body');
  check('band warning raised for 7 pts in a 2–4 category', editBody.includes('allows 2–4 pts'));
  await page.screenshot({path:`${SHOT}/04-lo-volunteers.png`, fullPage:true});

  await selectByPrefix(page,'#member_id','Lea Khoury');
  await selectByPrefix(page,'#category_id','OC member');
  await page.fill('#proposed_points','8');
  await page.click('form[action$="/rows"] button[type=submit]');
  await page.waitForLoadState('networkidle');
  check('same volunteer twice is refused',(await page.textContent('body')).includes('already on this event'));

  await page.goto(base+'/review');
  await page.screenshot({path:`${SHOT}/05-lo-review.png`, fullPage:true});
  await page.fill('#lo_note','Omar covered an extra unplanned shift when a volunteer dropped out.');
  await page.click('form[action$="/send"] button[type=submit]');
  await page.waitForLoadState('networkidle');
  check('submission sent to the VPA',(await page.textContent('body')).includes('Sent to the VPA'));
  const loDetail = await page.textContent('body');
  check('LO detail shows no figures', loDetail.includes('held by the VPA') && !/Approved\s+\d/.test(loDetail));
  await page.screenshot({path:`${SHOT}/06-lo-sent.png`, fullPage:true});

  await page.goto(BASE+'/');
  await page.screenshot({path:`${SHOT}/02-lo-dashboard.png`, fullPage:true});
  const dash = await page.textContent('body');
  check('LO dashboard shows no points column', !dash.includes('Points awarded'));

  for (const path of ['/points','/review','/members','/audit']){
    const r = await page.goto(BASE+path);
    check(`LO blocked from ${path} (HTTP ${r.status()})`, r.status()===403);
  }

  console.log('\n— VPA —');
  await page.context().clearCookies();
  await login(page,'vpa');
  check('VPA lands on the overview',(await page.textContent('h1')).includes('waiting on you'));
  await page.screenshot({path:`${SHOT}/07-vpa-overview.png`, fullPage:true});
  await page.goto(BASE+'/review');
  await page.screenshot({path:`${SHOT}/08-vpa-queue.png`, fullPage:true});
  await page.click('.card tbody tr a');
  await page.waitForLoadState('networkidle');
  check('review screen carries the LO note',(await page.textContent('body')).includes('extra unplanned shift'));

  const names = await page.locator('tbody .who b').allTextContents();
  const idx = names.findIndex(n=>n.includes('Omar'));
  const omarInput = page.locator('input.pts').nth(idx);
  const rowId = (await omarInput.getAttribute('name')).split('_')[1];
  await omarInput.fill('4');
  await page.fill(`input[name="note_${rowId}"]`,'Extra shift credited at band max (4). Use “full day” next time.');
  await page.screenshot({path:`${SHOT}/09-vpa-review.png`, fullPage:true});
  await page.click('button:has-text("Approve")');
  await page.waitForLoadState('networkidle');
  check('approved and returned to the queue', page.url().includes('/review'));

  await page.goto(BASE+'/points');
  const ledger = await page.textContent('body');
  check('ledger wrote one entry per paid row',(await page.locator('.card tbody tr').count())===6);
  check('the adjusted row landed as 4, not 7', ledger.includes('+4') && !ledger.includes('+7'));
  check('total reflects the adjustment (12+8+10+5+3+4=42)', ledger.includes('42'));
  await page.screenshot({path:`${SHOT}/10-vpa-points-ledger.png`, fullPage:true});
  await page.goto(BASE+'/points?view=member');
  await page.screenshot({path:`${SHOT}/11-vpa-points-by-member.png`, fullPage:true});
  await page.goto(BASE+'/audit');
  await page.screenshot({path:`${SHOT}/12-vpa-audit.png`, fullPage:true});

  console.log('\n— Member —');
  await page.context().clearCookies();
  await login(page,'member.lea');
  check('member sees their own total',(await page.textContent('h1')).includes('points this term'));
  await page.screenshot({path:`${SHOT}/13-member.png`, fullPage:true});

  await b.close();
  console.log('\n'+(fail.length?`${fail.length} FAILED:\n - `+fail.join('\n - '):'ALL CHECKS PASSED'));
  process.exit(fail.length?1:0);
})();
