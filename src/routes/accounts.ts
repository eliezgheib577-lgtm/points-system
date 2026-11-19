import { Router, type Request } from "express";
import { z } from "zod";
import { one, query } from "../lib/db.js";
import { requireAuth, requireRole } from "../auth/session.js";
import { generatePassword, hashPassword } from "../auth/passwords.js";
import { html, type Html } from "../lib/html.js";
import { page } from "../views/layout.js";
import { csrfField, note, statusPill, tile, who } from "../views/components.js";
import { audit, currentTerm } from "../domain/core.js";
import { timeAgo } from "../lib/text.js";

export const accountRoutes = Router();
const vpa = [requireAuth, requireRole("vpa", "admin")];
const ROLE_LABEL: Record<string, string> = { lo: "LO", vpa: "VPA", admin: "Admin", member: "Member" };

interface AccountRow {
  id: number; username: string; display_name: string; role: string; active: boolean;
  must_change_password: boolean; last_login_at: string | null; lc_code: string | null;
  member_name: string | null; created_at: string;
}

async function accounts(): Promise<AccountRow[]> {
  return query<AccountRow>(
    `select u.id, u.username, u.display_name, u.role, u.active, u.must_change_password,
            u.last_login_at, u.created_at, c.code as lc_code, m.full_name as member_name
       from users u
  left join local_committees c on c.id = u.lc_id
  left join members m on m.id = u.member_id
      order by u.active desc, u.role, u.username`,
  );
}

/**
 * Shown once, straight from the POST — the password is hashed on the way into
 * the database and exists nowhere else, so if this page is closed the only way
 * forward is another reset.
 */
function credentialSlip(req: Request, options: {
  username: string; password: string; displayName: string; role: string; heading: string;
}): string {
  return page({
    user: req.user!, csrf: req.csrfToken ?? "", title: "Credentials",
    currentPath: "/accounts", crumb: html`Accounts / <b>Credentials</b>`,
  }, html`
    <div class="page-head"><div><h1>${options.heading}</h1>
      <p>This password is shown once and is not stored anywhere in readable form.
         Send it now — if you lose it, issue a reset rather than guessing.</p></div></div>

    <div class="row" style="align-items:flex-start">
      <div style="flex:1.3;min-width:0;display:flex;flex-direction:column;gap:14px">
        <div class="card">
          <div class="card-h"><h3>${options.displayName}</h3><div class="spacer"></div>
            <span class="pill flat">${options.role}</span></div>
          <div class="card-b" style="display:flex;flex-direction:column;gap:14px">
            <div class="field"><label>Username</label>
              <div class="inp mono" id="slip-user" style="font-size:15px">${options.username}</div></div>
            <div class="field"><label>One-time password</label>
              <div class="inp mono" id="slip-pass" style="font-size:17px;letter-spacing:.02em;
                   background:var(--accent-soft);border-color:var(--good-line)">${options.password}</div></div>
            <button class="btn" type="button" id="copy-both">Copy both</button>
            <span class="hint" id="copy-said"></span>
          </div>
        </div>
        ${note("info", html`They will be asked to choose their own password the first time they sign in.
          Until they do, this is the only way into the account.`)}
        <div style="display:flex;gap:10px">
          <a class="btn pri" href="/accounts" style="text-decoration:none">Done</a>
        </div>
      </div>
      <div style="flex:1;min-width:260px">
        <div class="card"><div class="card-h"><h3>Message you can send</h3></div>
          <div class="card-b">
            <div class="inp" id="slip-message" style="min-height:120px;line-height:1.55;font-size:13px">Hi ${options.displayName.split(" ")[0]}, here are your LeMSIC Points details. Username: ${options.username} — password: ${options.password}. Sign in and it will ask you to pick your own password straight away. Don't forward this message on.</div>
            <button class="btn sm" type="button" id="copy-message" style="margin-top:10px">Copy message</button>
          </div></div>
      </div>
    </div>
    <script>
      function copy(text, said) {
        navigator.clipboard.writeText(text).then(function () {
          document.getElementById(said).textContent = "Copied.";
        }, function () {
          document.getElementById(said).textContent = "Couldn't copy — select the text by hand.";
        });
      }
      document.getElementById("copy-both").addEventListener("click", function () {
        copy(document.getElementById("slip-user").textContent.trim() + " / " +
             document.getElementById("slip-pass").textContent.trim(), "copy-said");
      });
      document.getElementById("copy-message").addEventListener("click", function () {
        copy(document.getElementById("slip-message").textContent.trim(), "copy-said");
      });
    </script>`);
}

accountRoutes.get("/accounts", ...vpa, async (req, res) => {
  const user = req.user!;
  const [rows, committees, unlinkedMembers, term] = await Promise.all([
    accounts(),
    query<{ id: number; code: string; name: string; active: boolean; members: number; officers: number }>(
      `select c.id, c.code, c.name, c.active,
              (select count(*) from members m where m.lc_id = c.id)::int as members,
              (select count(*) from users u where u.lc_id = c.id and u.role = 'lo' and u.active)::int as officers
         from local_committees c order by c.code`),
    query<{ id: number; full_name: string; lc_code: string }>(
      `select m.id, m.full_name, c.code as lc_code from members m
         join local_committees c on c.id = m.lc_id
        where not exists (select 1 from users u where u.member_id = m.id)
        order by m.full_name limit 300`),
    currentTerm(),
  ]);

  const active = rows.filter((row) => row.active);
  const uncovered = committees.filter((c) => c.active && c.officers === 0);
  const neverSignedIn = active.filter((row) => row.last_login_at === null).length;

  res.send(page({
    user, csrf: req.csrfToken ?? "", title: "Accounts & LCs", currentPath: "/accounts",
    termLabel: term.name, wide: true,
  }, html`
    <div class="page-head"><div><h1>Accounts &amp; local committees</h1>
      <p>You issue every account by hand — there is no sign-up. Passwords are one-time:
         whoever receives one is made to replace it before they can do anything.</p></div></div>

    <div class="grid g4" style="margin-bottom:16px">
      ${tile("Active accounts", active.length, `${rows.length - active.length} switched off`)}
      ${tile("Local Officers", active.filter((r) => r.role === "lo").length, uncovered.length === 0 ? "every committee has one" : `${uncovered.length} committee${uncovered.length === 1 ? " has" : "s have"} none`, uncovered.length > 0)}
      ${tile("Never signed in", neverSignedIn, neverSignedIn > 0 ? "credentials may not have arrived" : "everyone is in", neverSignedIn > 0)}
      ${tile("Committees", committees.filter((c) => c.active).length, `${committees.length} on the books`)}
    </div>

    <div class="row" style="align-items:flex-start">
      <div style="flex:1.75;min-width:0;display:flex;flex-direction:column;gap:14px">
        <div class="card">
          <div class="card-h"><h3>Accounts</h3><span class="pill flat">${rows.length}</span></div>
          <div class="scroll-x"><table>
            <thead><tr><th>Person</th><th>Username</th><th>Role</th>
              <th>Last signed in</th><th></th></tr></thead>
            <tbody>${rows.map((row) => html`<tr${row.active ? "" : html` style="opacity:.55"`}>
              <td>${who(row.display_name, row.active ? null : "switched off")}</td>
              <td class="mono">${row.username}</td>
              <td><span class="pill ${row.role === "vpa" || row.role === "admin" ? "ok" : row.role === "lo" ? "mod" : "flat"}">${ROLE_LABEL[row.role] ?? row.role}</span>
                <div class="sub" style="white-space:nowrap">${row.lc_code ? `LC ${row.lc_code}` : row.member_name ? row.member_name : "National"}</div></td>
              <td class="sub">${row.last_login_at ? timeAgo(row.last_login_at) : "never"}
                ${row.must_change_password ? html`<div><span class="pill pend">one-time password</span></div>` : ""}</td>
              <td><div style="display:flex;gap:6px;justify-content:flex-end">
                <form method="post" action="/accounts/${row.id}/reset" style="margin:0">
                  ${csrfField(req.csrfToken ?? "")}
                  <button class="btn sm" type="submit" title="Issue a new one-time password and sign them out">New password</button></form>
                ${row.id === user.id ? "" : html`<form method="post" action="/accounts/${row.id}/active" style="margin:0">
                  ${csrfField(req.csrfToken ?? "")}
                  <input type="hidden" name="active" value="${row.active ? "false" : "true"}">
                  <button class="btn sm ${row.active ? "danger" : ""}" type="submit">${row.active ? "Switch off" : "Switch on"}</button></form>`}
              </div></td>
            </tr>`)}</tbody>
          </table></div>
        </div>

        <div class="card">
          <div class="card-h"><h3>Local committees</h3><div class="spacer"></div>
            <small>An LO account needs a committee to belong to</small></div>
          <div class="scroll-x"><table>
            <thead><tr><th>Code</th><th>Name</th><th class="num">Members</th>
              <th class="num">Officers</th><th>State</th><th></th></tr></thead>
            <tbody>${committees.map((c) => html`<tr${c.active ? "" : html` style="opacity:.55"`}>
              <td><b>LC ${c.code}</b></td><td class="sub">${c.name}</td>
              <td class="num">${c.members}</td>
              <td class="num">${c.officers === 0 ? html`<span class="pill pend">none</span>` : c.officers}</td>
              <td><span class="pill ${c.active ? "ok" : "flat"}">${c.active ? "active" : "archived"}</span></td>
              <td style="text-align:right"><form method="post" action="/committees/${c.id}/active" style="margin:0">
                ${csrfField(req.csrfToken ?? "")}
                <input type="hidden" name="active" value="${c.active ? "false" : "true"}">
                <button class="btn sm" type="submit">${c.active ? "Archive" : "Restore"}</button></form></td>
            </tr>`)}</tbody>
          </table></div>
        </div>
      </div>

      <div style="flex:1;min-width:290px;display:flex;flex-direction:column;gap:14px">
        <form method="post" action="/accounts" class="card">
          ${csrfField(req.csrfToken ?? "")}
          <div class="card-h"><h3>Issue an account</h3></div>
          <div class="card-b" style="display:flex;flex-direction:column;gap:13px">
            <div class="field"><label for="display_name">Their name *</label>
              <input class="inp" id="display_name" name="display_name" required maxlength="80"
                placeholder="As they write it"></div>
            <div class="field"><label for="username">Username *</label>
              <input class="inp mono" id="username" name="username" required maxlength="40"
                pattern="[a-z0-9._-]{3,40}" placeholder="e.g. lo.usek">
              <span class="hint">Lower case, digits, dot, dash or underscore. They can't change it.</span></div>
            <div class="field"><label for="role">Role *</label>
              <select class="inp" id="role" name="role" required>
                <option value="lo">Local Officer — submits for one committee</option>
                <option value="vpa">VPA — reviews and approves everything</option>
                <option value="member">Member — sees only their own points</option>
              </select></div>
            <div class="field"><label for="lc_id">Committee <span class="hint">(Local Officers)</span></label>
              <select class="inp" id="lc_id" name="lc_id">
                <option value="">—</option>
                ${committees.filter((c) => c.active).map((c) => html`<option value="${c.id}">LC ${c.code} — ${c.name}</option>`)}
              </select></div>
            <div class="field"><label for="member_id">Member <span class="hint">(member accounts)</span></label>
              <select class="inp" id="member_id" name="member_id">
                <option value="">—</option>
                ${unlinkedMembers.map((m) => html`<option value="${m.id}">${m.full_name} · ${m.lc_code}</option>`)}
              </select></div>
            <button class="btn pri" type="submit" style="justify-content:center">Create &amp; show password</button>
            <span class="hint">The password appears once on the next screen.</span>
          </div>
        </form>

        <form method="post" action="/committees" class="card">
          ${csrfField(req.csrfToken ?? "")}
          <div class="card-h"><h3>Add a committee</h3></div>
          <div class="card-b" style="display:flex;flex-direction:column;gap:12px">
            <div class="field"><label for="code">Short code *</label>
              <input class="inp" id="code" name="code" required maxlength="16" placeholder="USEK"></div>
            <div class="field"><label for="name">Full name *</label>
              <input class="inp" id="name" name="name" required maxlength="120"
                placeholder="Holy Spirit University of Kaslik"></div>
            <button class="btn" type="submit" style="justify-content:center">Add committee</button>
          </div>
        </form>
      </div>
    </div>`));
});

const newAccount = z.object({
  display_name: z.string().trim().min(1).max(80),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/,
    "Usernames use lower case letters, digits, dot, dash or underscore."),
  role: z.enum(["lo", "vpa", "member"]),
  lc_id: z.string().optional(),
  member_id: z.string().optional(),
});

function problem(req: Request, message: string): string {
  return page({
    user: req.user!, csrf: req.csrfToken ?? "", title: "Accounts", currentPath: "/accounts",
  }, html`
    <div class="page-head"><div><h1>That didn't work</h1></div></div>
    <div style="max-width:560px;display:flex;flex-direction:column;gap:14px">
      ${note("warn", message)}
      <div><a class="btn" href="/accounts" style="text-decoration:none">Back to accounts</a></div>
    </div>`);
}

accountRoutes.post("/accounts", ...vpa, async (req, res) => {
  const parsed = newAccount.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).send(problem(req, parsed.error.issues[0]?.message ?? "Check the form and try again."));
  }
  const { display_name, username, role } = parsed.data;
  const lcId = parsed.data.lc_id ? Number(parsed.data.lc_id) : null;
  const memberId = parsed.data.member_id ? Number(parsed.data.member_id) : null;

  if (role === "lo" && !lcId) return res.status(400).send(problem(req, "A Local Officer has to belong to a committee — pick one."));
  if (role === "member" && !memberId) return res.status(400).send(problem(req, "A member account has to point at someone in the registry."));

  const taken = await one("select 1 from users where lower(username) = $1", [username]);
  if (taken) return res.status(400).send(problem(req, `The username “${username}” is already taken.`));

  const password = generatePassword();
  const inserted = await query<{ id: number }>(
    `insert into users (username, password_hash, display_name, role, lc_id, member_id,
                        must_change_password, created_by)
     values ($1,$2,$3,$4,$5,$6,true,$7) returning id`,
    [username, await hashPassword(password), display_name, role,
     role === "lo" ? lcId : null, role === "member" ? memberId : null, req.user!.id],
  );
  await audit({
    actorId: req.user!.id, action: "account.created", entityType: "user", entityId: inserted[0]!.id,
    summary: `Issued a ${role.toUpperCase()} account for ${display_name} (${username})`, ip: req.ip ?? null,
  });

  res.send(credentialSlip(req, {
    username, password, displayName: display_name, role: role.toUpperCase(),
    heading: "Account created",
  }));
});

accountRoutes.post("/accounts/:id/reset", ...vpa, async (req, res) => {
  const id = Number(req.params.id);
  const target = await one<{ username: string; display_name: string; role: string; active: boolean }>(
    "select username, display_name, role, active from users where id = $1", [id]);
  if (!target) return res.status(404).send(problem(req, "No such account."));

  const password = generatePassword();
  await query(
    `update users set password_hash = $2, must_change_password = true where id = $1`,
    [id, await hashPassword(password)]);
  // Any session they already had stops working, in case the reset is because
  // someone else got hold of the account.
  await query("delete from sessions where user_id = $1", [id]);
  await audit({
    actorId: req.user!.id, action: "account.password_reset", entityType: "user", entityId: id,
    summary: `Reset the password for ${target.display_name} (${target.username}) and signed them out`,
    ip: req.ip ?? null,
  });

  res.send(credentialSlip(req, {
    username: target.username, password, displayName: target.display_name,
    role: target.role.toUpperCase(), heading: "New password issued",
  }));
});

accountRoutes.post("/accounts/:id/active", ...vpa, async (req, res) => {
  const id = Number(req.params.id);
  const wantActive = req.body.active === "true";
  if (id === req.user!.id) {
    return res.status(400).send(problem(req, "You can't switch off your own account."));
  }
  const target = await one<{ display_name: string; username: string; role: string }>(
    "select display_name, username, role from users where id = $1", [id]);
  if (!target) return res.status(404).send(problem(req, "No such account."));

  if (!wantActive && (target.role === "vpa" || target.role === "admin")) {
    const remaining = await one<{ count: string }>(
      `select count(*) from users where active and role in ('vpa','admin') and id <> $1`, [id]);
    if (Number(remaining?.count ?? 0) === 0) {
      return res.status(400).send(problem(req,
        "That is the last account that can approve points. Issue another VPA account before switching this one off."));
    }
  }

  await query("update users set active = $2 where id = $1", [id, wantActive]);
  if (!wantActive) await query("delete from sessions where user_id = $1", [id]);
  await audit({
    actorId: req.user!.id, action: wantActive ? "account.enabled" : "account.disabled",
    entityType: "user", entityId: id,
    summary: `${wantActive ? "Switched on" : "Switched off"} ${target.display_name} (${target.username})`,
    ip: req.ip ?? null,
  });
  res.redirect("/accounts");
});

accountRoutes.post("/committees", ...vpa, async (req, res) => {
  const parsed = z.object({
    code: z.string().trim().min(1).max(16),
    name: z.string().trim().min(1).max(120),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).send(problem(req, "A committee needs a short code and a full name."));

  const taken = await one("select 1 from local_committees where lower(code) = lower($1)", [parsed.data.code]);
  if (taken) return res.status(400).send(problem(req, `LC ${parsed.data.code} already exists.`));

  await query("insert into local_committees (code, name) values ($1, $2)", [parsed.data.code, parsed.data.name]);
  await audit({
    actorId: req.user!.id, action: "committee.created", entityType: "local_committee",
    summary: `Added LC ${parsed.data.code} — ${parsed.data.name}`, ip: req.ip ?? null,
  });
  res.redirect("/accounts");
});

accountRoutes.post("/committees/:id/active", ...vpa, async (req, res) => {
  const id = Number(req.params.id);
  const wantActive = req.body.active === "true";
  if (!wantActive) {
    const officers = await one<{ count: string }>(
      "select count(*) from users where lc_id = $1 and role = 'lo' and active", [id]);
    if (Number(officers?.count ?? 0) > 0) {
      return res.status(400).send(problem(req,
        "Switch off that committee's Local Officer accounts first — archiving it would leave them signing in with nowhere to submit."));
    }
  }
  await query("update local_committees set active = $2 where id = $1", [id, wantActive]);
  await audit({
    actorId: req.user!.id, action: wantActive ? "committee.restored" : "committee.archived",
    entityType: "local_committee", entityId: id, ip: req.ip ?? null,
  });
  res.redirect("/accounts");
});

export type { Html };
