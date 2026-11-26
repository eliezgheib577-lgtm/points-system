/**
 * A stand-in for Microsoft 365 in browser tests: a fake MSAL (sign-in) and a fake
 * Microsoft Graph that keeps one workbook in memory and implements the handful of
 * Excel calls the app makes, the way Microsoft documents them. It is strict on
 * purpose: a missing session header, a bad token, or values that don't fit the
 * range they are written to all fail the request, so a wrong call fails the test.
 *
 * This checks the app's calls against the documented API — not against Microsoft
 * itself, which these tests cannot reach.
 */
const LINK = 'https://lemsic.sharepoint.com/:x:/s/vpa/EabcDEFghiJKL';
const TOKEN = 'fake-graph-token';

const fakeMsal = `window.msal = { PublicClientApplication: class {
  constructor(cfg) { window.__msalConfig = cfg; }
  async initialize() {} async handleRedirectPromise() { return null; }
  getAllAccounts() { return localStorage.getItem('fakeMsal') ? [{ username: 'vpa@lemsic.org', name: 'LeMSIC VPA' }] : []; }
  async loginPopup() { localStorage.setItem('fakeMsal', '1'); return { account: this.getAllAccounts()[0] }; }
  async acquireTokenSilent() { if (!localStorage.getItem('fakeMsal')) throw new Error('interaction_required'); return { accessToken: '${TOKEN}' }; }
  async acquireTokenPopup() { localStorage.setItem('fakeMsal', '1'); return { accessToken: '${TOKEN}' }; }
} };`;

const col = (s) => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const letter = (i) => { let out = ''; let n = i + 1; while (n > 0) { const m = (n - 1) % 26; out = String.fromCharCode(65 + m) + out; n = Math.floor((n - 1) / 26); } return out; };
function parse(addr) {
  const [a, b] = addr.split(':'); const p = (x) => { const m = /^([A-Z]+)(\d+)$/.exec(x); return [col(m[1]), Number(m[2]) - 1]; };
  const [c1, r1] = p(a); const [c2, r2] = b ? p(b) : [c1, r1];
  return { c1, r1, c2, r2 };
}

function createWorkbook(opts = {}) {
  return {
    link: opts.link || LINK,
    item: opts.item || { id: 'item-1', name: 'LeMSIC Points.xlsx', parentReference: { driveId: 'drive-1', id: 'folder-1' }, webUrl: LINK },
    files: {}, // what's been saved in the workbook's folder, by path below it
    sheets: opts.sheets || [{ id: '{sheet-notes}', name: 'VPA notes', cells: [['My own notes'], ['Keep this']] }],
    sessions: new Set(), calls: [], lockNext: false,
  };
}

async function install(page, ...books) {
  await page.route('https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.28.1/**', (r) => r.fulfill({ body: fakeMsal, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } }));
  await page.route('https://graph.microsoft.com/v1.0/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = decodeURIComponent(url.pathname.replace(/^\/v1\.0/, ''));
    // Which workbook a call is about: by its sharing link, its item or the folder it's in.
    const shareOf = (link) => 'u!' + Buffer.from(link).toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
    const wb = books.find((b) => path.startsWith('/shares/') && path.split('/')[2] === shareOf(b.link))
      || books.find((b) => path.startsWith(`/drives/${b.item.parentReference.driveId}/items/${b.item.id}`) || path.startsWith(`/drives/${b.item.parentReference.driveId}/items/${b.item.parentReference.id}:`))
      || books.find((b) => path === `/me/drive/root:/LeMSIC Points/${b.item.name}:/content`)
      || books[0];
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: body == null ? '' : JSON.stringify(body) });
    const bad = (msg) => { wb.calls.push('REJECTED ' + req.method() + ' ' + path + ' — ' + msg); return json(400, { error: { message: msg } }); };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (req.headers()['authorization'] !== 'Bearer ' + TOKEN) return json(401, { error: { message: 'no token' } });
    wb.calls.push(req.method() + ' ' + path);

    if (req.method() === 'GET' && path.startsWith('/shares/')) {
      return path.split('/')[2] === shareOf(wb.link) ? json(200, wb.item) : json(404, { error: { message: 'Item not found' } });
    }
    if (req.method() === 'PUT' && path.startsWith('/me/drive/root:/LeMSIC Points/') && path.endsWith(':/content')) {
      const name = path.slice('/me/drive/root:/LeMSIC Points/'.length, -':/content'.length);
      if (name !== wb.item.name) return bad('uploaded ' + name + ', which no workbook here is called');
      // A workbook someone uploads must never overwrite one that's there: a clash gets a new name.
      if (name !== 'LeMSIC Points.xlsx' && url.searchParams.get('@microsoft.graph.conflictBehavior') !== 'rename') return bad('an upload must not overwrite: use @microsoft.graph.conflictBehavior=rename');
      wb.uploaded = req.postDataBuffer() ? req.postDataBuffer().length : 0;
      return json(201, wb.item);
    }
    // The workbook's own record (to find its folder), and files by path in that folder (the daily backups).
    if (req.method() === 'GET' && path === `/drives/${wb.item.parentReference.driveId}/items/${wb.item.id}`) return json(200, wb.item);
    const inFolder = `/drives/${wb.item.parentReference.driveId}/items/${wb.item.parentReference.id}:/`;
    if (path.startsWith(inFolder)) {
      const rel = path.slice(inFolder.length);
      if (req.method() === 'GET' && !rel.endsWith(':/content')) return wb.files[rel] ? json(200, { id: 'f-' + rel, name: rel.split('/').pop() }) : json(404, { error: { code: 'itemNotFound', message: 'The resource could not be found.' } });
      if (req.method() === 'PUT' && rel.endsWith(':/content')) {
        const name = rel.slice(0, -':/content'.length);
        if (!/^LeMSIC Points backups\/LeMSIC Points backup \d{4}-\d{2}-\d{2}\.json$/.test(name)) return bad('unexpected upload ' + name);
        wb.files[name] = req.postDataBuffer().toString('utf8');
        return json(201, { id: 'f-' + name, name: name.split('/').pop() });
      }
      return bad('unknown folder call');
    }
    const base = `/drives/${wb.item.parentReference.driveId}/items/${wb.item.id}/workbook`;
    if (!path.startsWith(base)) return bad('unknown path');
    const rest = path.slice(base.length);
    if (rest === '/createSession') {
      if (wb.lockNext) { wb.lockNext = false; return json(423, { error: { message: 'The resource you are attempting to access is locked' } }); }
      const id = 'session-' + (wb.sessions.size + 1); wb.sessions.add(id); return json(201, { id, persistChanges: true });
    }
    const session = req.headers()['workbook-session-id'];
    if (!wb.sessions.has(session)) return bad('missing or unknown workbook-session-id');
    if (rest === '/closeSession') { wb.sessions.delete(session); return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }); }
    if (rest === '/worksheets' && req.method() === 'GET') return json(200, { value: wb.sheets.map(({ id, name }) => ({ id, name })) });
    if (rest === '/worksheets/add') {
      const name = JSON.parse(req.postData()).name;
      if (wb.sheets.some((x) => x.name === name)) return bad('sheet already exists');
      const sheet = { id: '{sheet-' + name.replace(/\W/g, '') + '}', name, cells: [] }; wb.sheets.push(sheet);
      return json(201, { id: sheet.id, name });
    }
    const m = /^\/worksheets\/([^/]+)\/(.+)$/.exec(rest);
    if (!m) return bad('unknown workbook call ' + rest);
    const sheet = wb.sheets.find((x) => x.id === m[1]);
    if (!sheet) return bad('no such sheet ' + m[1]);
    const op = m[2];
    if (op === 'protection' && req.method() === 'GET') return json(200, { protected: !!sheet.protected, options: {} });
    if (op === 'protection/protect') { if (sheet.protected) return bad('sheet is already protected'); sheet.protected = true; return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }); }
    if (op === 'protection/unprotect') { sheet.protected = false; return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }); }
    if (op.startsWith('usedRange(valuesOnly=true)')) {
      const rows = sheet.cells.length, cols = Math.max(0, ...sheet.cells.map((r) => r.length));
      const out = { address: `${sheet.name}!A1${rows && cols ? ':' + letter(cols - 1) + rows : ''}` };
      if (/values/.test(url.searchParams.get('$select') || '')) out.values = sheet.cells.map((r) => Array.from({ length: cols }, (_, i) => (r[i] == null ? '' : r[i])));
      return json(200, out);
    }
    const rm = /^range\(address='([A-Z0-9:]+)'\)(\/.*)?$/.exec(op);
    if (!rm) return bad('unknown range call ' + op);
    const { c1, r1, c2, r2 } = parse(rm[1]);
    const sub = rm[2] || '';
    const done = () => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
    if (req.method() === 'GET' && !sub) {
      if ((url.searchParams.get('$select') || '') !== 'formulas') return bad('read a range with $select=formulas');
      return json(200, { formulas: Array.from({ length: r2 - r1 + 1 }, (_, i) => Array.from({ length: c2 - c1 + 1 }, (_, j) => ((sheet.cells[r1 + i] || [])[c1 + j] ?? ''))) });
    }
    if (sheet.protected) return bad('cannot change a protected sheet');
    sheet.formats = sheet.formats || [];
    if (sub === '/delete') {
      if (req.method() !== 'POST' || JSON.parse(req.postData()).shift !== 'Up') return bad('rows are deleted with POST {shift: "Up"}');
      sheet.cells.splice(r1, r2 - r1 + 1); return done();
    }
    if (sub === '/format/autofitRows') { if (req.method() !== 'POST') return bad('autofitRows is a POST'); return done(); }
    const fm = /^\/format(\/font|\/fill|\/borders\/(EdgeTop|EdgeBottom|EdgeLeft|EdgeRight|InsideVertical|InsideHorizontal))?$/.exec(sub);
    if (fm) {
      if (req.method() !== 'PATCH') return bad('formats are set with PATCH');
      const body = JSON.parse(req.postData()), kind = fm[1] ? (fm[2] ? 'borders' : fm[1].slice(1)) : 'format';
      const allowed = { format: ['verticalAlignment', 'horizontalAlignment', 'wrapText'], font: ['name', 'size', 'bold', 'color'], fill: ['color'], borders: ['style', 'color', 'weight'] }[kind];
      const extra = Object.keys(body).filter((k) => !allowed.includes(k));
      if (extra.length) return bad(`${kind} has no ${extra.join(', ')}`);
      if (fm[2] === 'InsideHorizontal' && r1 === r2) return bad('InsideHorizontal on a single row');
      sheet.formats.push(Object.assign({ address: rm[1], kind, side: fm[2] || null }, body));
      return done();
    }
    if (sub && sub !== '/clear') return bad('unknown range op ' + sub);
    if (sub) {
      if (JSON.parse(req.postData()).applyTo !== 'Contents') return bad('clear should only clear contents');
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (sheet.cells[r]) sheet.cells[r][c] = '';
      sheet.cells = sheet.cells.filter((row) => row.some((v) => v !== '' && v != null));
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
    }
    if (req.method() !== 'PATCH') return bad('ranges are written with PATCH');
    const body = JSON.parse(req.postData());
    const fits = (g) => g.length === r2 - r1 + 1 && g.every((row) => row.length === c2 - c1 + 1);
    if (body.numberFormat) { if (!fits(body.numberFormat)) return bad('numberFormat is the wrong size'); sheet.formats.push({ address: rm[1], kind: 'numberFormat', value: body.numberFormat[0][0] }); }
    const grid = body.values || body.formulas;
    if (grid) {
      if (!fits(grid)) return bad(`values are ${grid.length}×${grid[0] && grid[0].length}, range ${rm[1]} is ${r2 - r1 + 1}×${c2 - c1 + 1}`);
      // Like Excel: a leading apostrophe keeps a value as text and isn't stored.
      grid.forEach((row, i) => { sheet.cells[r1 + i] = sheet.cells[r1 + i] || []; row.forEach((v, j) => { sheet.cells[r1 + i][c1 + j] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v; }); });
    }
    if (!grid && !body.numberFormat) return bad('nothing to write');
    return json(200, { address: `${sheet.name}!${rm[1]}` });
  });
}

// A small copy of LeMSIC's master sheet: a Points Log, the Mastersheet, one tab per LC, the
// outgoing members, and a tab of the VPA's own that the site must never touch.
const MASTER_LINK = 'https://lemsic.sharepoint.com/:x:/s/vpa/EmasterSHEET';
function createMasterWorkbook() {
  const total = (r) => `=SUMIFS('Points Log'!$K:$K,'Points Log'!$B:$B,$A${r})-IF(COUNTIF('Outgoings 2025-26'!$A:$A,$A${r})>0,SUMIFS('Points Log'!$K:$K,'Points Log'!$B:$B,$A${r},'Points Log'!$D:$D,"<>2026-27"),0)`;
  const counted = (r) => `=IF(J${r}="Yes",I${r},0)`;
  const lcHead = ['Full Name', 'LeMSIC ID', 'Points History', 'Total', 'Notes'];
  const sheet = (name, cells) => ({ id: '{m-' + name.replace(/\W/g, '') + '}', name, cells });
  const log = [['Key', 'Person', 'LC', 'Term', 'Date', 'Event', 'Activity / Role', 'Name as Written in Source', 'Points (as submitted)', 'Counted?', 'Counted Points', 'Source File', 'Flags'],
    ['P0001', 'Lea Khoury', 'AUB', '2025-26', '23/12/2025', 'Christmas of Care (SGUB)', 'Attended live event/session', 'Lea Khoury', 5, 'Yes', counted(2), 'Christmas of Care.xlsx', ''],
    ['P0001', 'Lea Khoury', 'AUB', 'Before 2025-26', 'Before 2025-26', "Points Sheet 'All entries' (before 2025-26)", 'Points Sheet entry', 'lea khoury', 50, 'Yes', counted(3), 'Points Sheet.xlsx', ''],
    ['P0001', 'Lea Khoury', 'AUB', 'Before 2025-26', 'Before 2025-26', "Points Sheet 'All entries' (before 2025-26)", 'Points Sheet entry', 'lea khoury', 34, 'Yes', counted(4), 'Points Sheet.xlsx', ''],
    ['P0002', 'Karim Nassar', 'AUB', '2025-26', 'Nov 2025', 'National Team Retreat', 'Attended online event/session', 'Karim Nassar', 24, 'Yes', counted(5), 'Retreat.xlsx', ''],
    ['P0007', 'Old Member', 'Unassigned', 'Before 2025-26', 'Before 2025-26', "Points Sheet 'All entries' (before 2025-26)", 'Points Sheet entry', 'old member', 10, 'Yes', counted(6), 'Points Sheet.xlsx', '']];
  return createWorkbook({
    link: MASTER_LINK,
    item: { id: 'item-master', name: 'LeMSIC Points Master Sheet.xlsx', parentReference: { driveId: 'drive-1', id: 'folder-master' }, webUrl: MASTER_LINK },
    sheets: [
      sheet('Mastersheet', [['Full Name', 'LeMSIC ID', 'LC', 'Total'], ['Lea Khoury', 'LEM-2341', 'AUB', total(2)], ['Karim Nassar', '', 'AUB', total(3)], ['Old Member', 'S2020001', 'Unassigned', total(4)]]),
      sheet('AUB', [lcHead, ['Lea Khoury', 'LEM-2341', "[25-26] Christmas of Care (SGUB) - Attended live event/session: 5\n[Before 25-26] Points Sheet 'All entries': 84 (2 entries)", total(2), 'Old note'],
        ['Karim Nassar', '', '[25-26] National Team Retreat - Attended online event/session: 24  (deducted)', total(3), '']]),
      ...['BAU', 'LAU', 'LU', 'SGUB', 'UOB', 'USEK', 'USJ'].map((n) => sheet(n, [lcHead])),
      sheet('Unassigned LC', [lcHead, ['Old Member', 'S2020001', "[Before 25-26] Points Sheet 'All entries': 10 (1 entry)", total(2), 'Not in LeMSIC membership sheet; LC unknown.']]),
      sheet('Outgoings 2025-26', [['Full Name', 'LeMSIC ID', 'LC', 'Exchange', 'Source', 'Points Before Deduction', 'Points Deducted', 'Points After Deduction', 'Deducted Entries', 'Notes', 'Key'], ['Karim Nassar', '', 'AUB', 'SCOPE', 'Outgoings.docx', '', '', '', '', '', 'P0002']]),
      sheet('Review', [['#', 'Category', 'Item'], [1, 'Missing files', 'Keep this exactly']]),
      sheet('Points Log', log),
    ],
  });
}

module.exports = { LINK, MASTER_LINK, install, createWorkbook, createMasterWorkbook };
