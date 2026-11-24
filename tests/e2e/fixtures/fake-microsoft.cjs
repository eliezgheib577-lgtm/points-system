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

function createWorkbook() {
  return {
    item: { id: 'item-1', name: 'LeMSIC Points.xlsx', parentReference: { driveId: 'drive-1', id: 'folder-1' }, webUrl: LINK },
    files: {}, // what's been saved in the workbook's folder, by path below it
    sheets: [{ id: '{sheet-notes}', name: 'VPA notes', cells: [['My own notes'], ['Keep this']] }],
    sessions: new Set(), calls: [], lockNext: false,
  };
}

async function install(page, wb) {
  await page.route('https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.28.1/**', (r) => r.fulfill({ body: fakeMsal, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } }));
  await page.route('https://graph.microsoft.com/v1.0/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = decodeURIComponent(url.pathname.replace(/^\/v1\.0/, ''));
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: body == null ? '' : JSON.stringify(body) });
    const bad = (msg) => { wb.calls.push('REJECTED ' + req.method() + ' ' + path + ' — ' + msg); return json(400, { error: { message: msg } }); };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (req.headers()['authorization'] !== 'Bearer ' + TOKEN) return json(401, { error: { message: 'no token' } });
    wb.calls.push(req.method() + ' ' + path);

    if (req.method() === 'GET' && path.startsWith('/shares/')) {
      const id = path.split('/')[2];
      const expected = 'u!' + Buffer.from(LINK).toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
      return id === expected ? json(200, wb.item) : json(404, { error: { message: 'Item not found' } });
    }
    if (req.method() === 'PUT' && path === '/me/drive/root:/LeMSIC Points/LeMSIC Points.xlsx:/content') {
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
      return json(200, { address: `${sheet.name}!A1${rows && cols ? ':' + letter(cols - 1) + rows : ''}` });
    }
    const rm = /^range\(address='([A-Z0-9:]+)'\)(\/clear)?$/.exec(op);
    if (!rm) return bad('unknown range call ' + op);
    if (sheet.protected) return bad('cannot change a protected sheet');
    const { c1, r1, c2, r2 } = parse(rm[1]);
    if (rm[2]) {
      if (JSON.parse(req.postData()).applyTo !== 'Contents') return bad('clear should only clear contents');
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (sheet.cells[r]) sheet.cells[r][c] = '';
      sheet.cells = sheet.cells.filter((row) => row.some((v) => v !== '' && v != null));
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
    }
    if (req.method() !== 'PATCH') return bad('ranges are written with PATCH');
    const values = JSON.parse(req.postData()).values;
    if (values.length !== r2 - r1 + 1 || values.some((row) => row.length !== c2 - c1 + 1)) return bad(`values are ${values.length}×${values[0] && values[0].length}, range ${rm[1]} is ${r2 - r1 + 1}×${c2 - c1 + 1}`);
    values.forEach((row, i) => { sheet.cells[r1 + i] = sheet.cells[r1 + i] || []; row.forEach((v, j) => { sheet.cells[r1 + i][c1 + j] = v; }); });
    return json(200, { address: `${sheet.name}!${rm[1]}` });
  });
}

module.exports = { LINK, install, createWorkbook };
