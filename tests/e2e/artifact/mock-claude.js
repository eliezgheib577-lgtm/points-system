// A stand-in for the claude.ai host: db + user + downloads, enforcing the same
// rules the real platform will, backed by localStorage so several tabs share it.
(function () {
  const RULES = window.__RULES__;
  const params = new URLSearchParams(location.search);
  const as = params.get("as");
  if (!as) return;                                   // no ?as= → behave like a plain browser (demo mode)
  const PEOPLE = { owner: ["u_owner", "owner", "Yara Dagher"], lo1: ["u_lo1", "admin", "Rami Haddad"], lo2: ["u_lo2", "admin", "Dana Ayoub"], outsider: ["u_out", "view", "Visiting Student"] };
  const [uid, level, name] = PEOPLE[as];
  const RANK = { view: 0, interact: 1, admin: 2, owner: 3 };
  const KEY = "mockdb";
  const load = () => JSON.parse(localStorage.getItem(KEY) || "{}");
  const store = (d) => localStorage.setItem(KEY, JSON.stringify(d));
  function required(path, op) {
    const segs = path.split("/");
    let general = null, generalLen = -1, self = null;
    for (const r of RULES) {
      const rs = r.path === "" ? [] : r.path.split("/");
      if (rs.length > segs.length) continue;
      let match = true;
      for (let i = 0; i < rs.length; i++) {
        if (rs[i] === "{self}") { if (segs[i] !== uid) match = false; }
        else if (rs[i] !== segs[i]) match = false;
      }
      if (!match) continue;
      if (rs.includes("{self}")) self = r;
      else if (rs.length > generalLen) { general = r; generalLen = rs.length; }
    }
    const need = RANK[general[op]];
    return self ? Math.min(need, RANK[self[op]]) : need;   // own subtree: whichever gives more
  }
  const can = (path, op) => RANK[level] >= required(path, op);
  window.__mockLog = [];
  const deny = (path, op) => { window.__mockLog.push(op + " DENIED " + path); return Promise.reject({ code: "invalid_argument", message: op + " not allowed" }); };
  const parent = (p) => p.split("/").slice(0, -1).join("/");
  const watchers = new Set();
  function fire() { watchers.forEach((w) => w()); }
  window.addEventListener("storage", (e) => { if (e.key === KEY) fire(); });
  const snapDoc = (p) => { const d = load(); const ok = can(p, "read") && d[p]; return { id: p.split("/").pop(), exists: !!ok, data: () => (ok ? JSON.parse(JSON.stringify(d[p])) : undefined), metadata: { fromCache: false, hasPendingWrites: false } }; };
  const snapColl = (c) => { const d = load(); const docs = Object.keys(d).filter((p) => parent(p) === c && can(p, "read")).sort().map(snapDoc); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }; };
  function docRef(p) {
    return {
      id: p.split("/").pop(), path: p,
      get: async () => snapDoc(p),
      set: async (data) => { if (!can(p, "write")) return deny(p, "write"); JSON.stringify(data); const d = load(); d[p] = JSON.parse(JSON.stringify(data)); store(d); setTimeout(fire, 0); },
      update: async (data) => { if (!can(p, "write")) return deny(p, "write"); const d = load(); if (!d[p]) return Promise.reject({ code: "invalid_argument", message: "missing" }); d[p] = Object.assign(d[p], JSON.parse(JSON.stringify(data))); store(d); setTimeout(fire, 0); },
      delete: async () => { if (!can(p, "write")) return deny(p, "write"); const d = load(); delete d[p]; store(d); setTimeout(fire, 0); },
      onSnapshot: (next) => { const w = () => next(snapDoc(p)); watchers.add(w); setTimeout(w, 0); return () => watchers.delete(w); },
      collection: (c) => collRef(p + "/" + c),
    };
  }
  function collRef(c) { return { path: c, doc: (id) => docRef(c + "/" + (id || Math.random().toString(36).slice(2))), onSnapshot: (next) => { const w = () => next(snapColl(c)); watchers.add(w); setTimeout(w, 0); return () => watchers.delete(w); }, get: async () => snapColl(c) }; }
  const db = { doc: docRef, collection: collRef };
  const user = {
    id: async () => uid, isOwner: async () => level === "owner", canEdit: async () => RANK[level] >= 2, can: async () => null,
    me: async () => ({ id: uid, name, isOwner: level === "owner", canEdit: RANK[level] >= 2, email: null, avatarUrl: "", color: "#888" }),
    profiles: async (ids) => Object.fromEntries([].concat(ids).map((i) => [i, { id: i, name: (Object.values(PEOPLE).find((x) => x[0] === i) || [])[2] || "", avatarUrl: "", color: "#888", email: null, isMe: i === uid, guest: false }])),
  };
  window.__saved = [];
  const downloads = { save: async ({ filename, data }) => { window.__saved.push({ filename, size: data.byteLength || data.length }); return { status: "saved" }; } };
  const caps = { db, user, downloads };
  window.claude = { use: (n) => new Promise((res) => setTimeout(() => res(caps[n] || null), 20)) };
  window.__mockSeed = (docs) => { store(Object.assign(load(), docs)); fire(); };   // stands in for ArtifactData writes
})();
