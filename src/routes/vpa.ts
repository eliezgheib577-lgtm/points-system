import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { query } from "../lib/db.js";
import { requireAuth, requireRole } from "../auth/session.js";
import { html } from "../lib/html.js";
import { page } from "../views/layout.js";
import { csrfField, emptyState, note, statusPill, tile, who } from "../views/components.js";
import { currentTerm } from "../domain/core.js";
import { approveSubmission, checkSubmission, getRows, getSubmission, returnToLo, type RowDecision } from "../domain/submissions.js";
import { formatDate, timeAgo } from "../lib/text.js";

export const vpaRoutes = Router();
const vpa = [requireAuth, requireRole("vpa", "admin")];

interface QueueRow {
  id: number; ref: string; title: string; event_date: string | null; standing_committee: string | null;
  lc_code: string; author_name: string; submitted_at: string; rows: number; proposed: number;
}

async function queue(): Promise<QueueRow[]> {
  return query<QueueRow>(
    `select s.id, s.ref, s.title, s.event_date, s.standing_committee, c.code as lc_code,
            u.display_name as author_name, s.submitted_at,
            (select count(*) from submission_rows r where r.submission_id = s.id)::int as rows,
            coalesce((select sum(r.proposed_points) from submission_rows r where r.submission_id = s.id), 0)::int as proposed
       from submissions s
       join local_committees c on c.id = s.lc_id
       join users u on u.id = s.created_by
      where s.status in ('pending','under_review')
      order by s.submitted_at asc`,
  );
}

async function ledgerTotals() {
  const [totals] = await query<{ carried: number; earned: number; total: number; members: number; events: number }>(
    `select coalesce(sum(points) filter (where kind = 'opening_balance'), 0)::int as carried,
            coalesce(sum(points) filter (where kind <> 'opening_balance'), 0)::int as earned,
            coalesce(sum(points), 0)::int as total,
            count(distinct member_id)::int as members,
            count(distinct submission_id)::int as events
       from ledger_entries`,
  );
  return totals ?? { carried: 0, earned: 0, total: 0, members: 0, events: 0 };
}

export async function vpaOverview(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const [pending, totals, term] = await Promise.all([queue(), ledgerTotals(), currentTerm()]);
  const oldest = pending[0];
  const rowsWaiting = pending.reduce((sum, row) => sum + row.rows, 0);

  res.send(page({
    user, csrf: req.csrfToken ?? "", title: "Overview", currentPath: "/", termLabel: term.name,
    counts: { "Pending review": pending.length },
  }, html`
    <div class="page-head"><div>
      <h1>${pending.length === 0 ? "Nothing waiting on you" : `${pending.length} submission${pending.length === 1 ? "" : "s"} waiting on you`}</h1>
      <p>${oldest
        ? `The oldest has been waiting ${timeAgo(oldest.submitted_at)}. Reviewing one takes a couple of minutes.`
        : "Every submission sent so far has been decided."}</p>
    </div><div class="spacer"></div>
    ${pending.length > 0 ? html`<a class="btn pri sm" href="/review" style="text-decoration:none">Start reviewing →</a>` : ""}</div>

    <div class="grid g4" style="margin-bottom:16px">
      ${tile("Pending", pending.length, pending.length > 0 ? "awaiting your call" : "all clear", pending.length > 0)}
      ${tile("Rows to review", rowsWaiting, `${pending.reduce((s, r) => s + r.proposed, 0)} proposed pts`)}
      ${tile("Approved points", totals.total, `${totals.members} members credited`)}
      ${tile("Carried forward", totals.carried, "from the old workbook")}
    </div>

    ${pending.length === 0
      ? emptyState("The queue is empty", "When a Local Officer sends a submission it appears here.")
      : html`<div class="card">
          <div class="card-h"><h3>Waiting for you</h3><div class="spacer"></div>
            <a href="/review">See the full queue →</a></div>
          <div class="scroll-x">${queueTable(pending.slice(0, 5))}</div>
        </div>`}`));
}

function queueTable(rows: QueueRow[]) {
  return html`<table>
    <thead><tr><th>Event</th><th>LC</th><th>Submitted by</th><th>Waiting</th>
      <th class="num">Rows</th><th class="num">Proposed</th><th></th></tr></thead>
    <tbody>${rows.map((row) => html`<tr>
      <td><b>${row.title}</b><div class="sub">${formatDate(row.event_date)}${row.standing_committee ? ` · ${row.standing_committee}` : ""}</div></td>
      <td>${row.lc_code}</td>
      <td>${row.author_name}</td>
      <td><span class="pill ${timeAgoDays(row.submitted_at) >= 5 ? "ret" : timeAgoDays(row.submitted_at) >= 2 ? "pend" : "flat"}">${timeAgo(row.submitted_at)}</span></td>
      <td class="num">${row.rows}</td>
      <td class="num mono">${row.proposed}</td>
      <td><a href="/review/${row.id}"><b>Review</b></a></td>
    </tr>`)}</tbody></table>`;
}

function timeAgoDays(value: string): number {
  return (Date.now() - new Date(value).getTime()) / 86_400_000;
}

vpaRoutes.get("/review", ...vpa, async (req, res) => {
  const user = req.user!;
  const [pending, term] = await Promise.all([queue(), currentTerm()]);
  res.send(page({
    user, csrf: req.csrfToken ?? "", title: "Pending review", currentPath: "/review", termLabel: term.name,
    counts: { "Pending review": pending.length },
  }, html`
    <div class="page-head"><div>
      <h1>${pending.length} waiting on you</h1>
      <p>Oldest first. Approve the whole thing in one click, or change it row by row.</p></div></div>
    ${pending.length === 0
      ? emptyState("Nothing to review", "The queue is empty — every submission has been decided.")
      : html`<div class="card"><div class="scroll-x">${queueTable(pending)}</div></div>`}`));
});

export async function vpaSubmissionsList(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const term = await currentTerm();
  const rows = await query<QueueRow & { status: string; approved: number }>(
    `select s.id, s.ref, s.title, s.event_date, s.standing_committee, s.status, c.code as lc_code,
            u.display_name as author_name, s.submitted_at,
            (select count(*) from submission_rows r where r.submission_id = s.id)::int as rows,
            coalesce((select sum(r.proposed_points) from submission_rows r where r.submission_id = s.id), 0)::int as proposed,
            coalesce((select sum(l.points) from ledger_entries l where l.submission_id = s.id), 0)::int as approved
       from submissions s
       join local_committees c on c.id = s.lc_id
       join users u on u.id = s.created_by
      order by s.id desc limit 200`,
  );
  res.send(page({
    user, csrf: req.csrfToken ?? "", title: "All submissions", currentPath: "/submissions", termLabel: term.name,
  }, html`
    <div class="page-head"><div><h1>All submissions</h1>
      <p>Every event logged this term, whatever its state.</p></div></div>
    ${rows.length === 0 ? emptyState("Nothing yet", "Submissions appear here as LOs send them.") : html`
    <div class="card"><div class="scroll-x"><table>
      <thead><tr><th>Reference</th><th>Event</th><th>LC</th><th>Date</th>
        <th class="num">Rows</th><th class="num">Approved</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map((row) => html`<tr>
        <td class="mono">${row.ref}</td>
        <td><b>${row.title}</b></td>
        <td>${row.lc_code}</td>
        <td>${formatDate(row.event_date)}</td>
        <td class="num">${row.rows}</td>
        <td class="num">${row.status === "approved" ? html`<b>${row.approved}</b>` : html`<span class="sub">—</span>`}</td>
        <td>${statusPill(row.status)}</td>
        <td><a href="${row.status === "pending" || row.status === "under_review" ? `/review/${row.id}` : `/submissions/${row.id}`}">Open</a></td>
      </tr>`)}</tbody></table></div></div>`}`));
}

vpaRoutes.get("/review/:id", ...vpa, async (req, res) => {
  const user = req.user!;
  const submission = await getSubmission(Number(req.params.id));
  if (!submission) return res.status(404).send("No such submission.");
  if (submission.status === "draft") return res.status(409).send("That submission has not been sent yet.");
  const [rows, term] = await Promise.all([getRows(submission.id), currentTerm()]);
  const problems = await checkSubmission(submission, rows);
  const proposed = rows.reduce((sum, row) => sum + row.proposed_points, 0);
  const decided = submission.status === "approved";

  res.send(page({
    user, csrf: req.csrfToken ?? "", title: "Review", currentPath: "/review", termLabel: term.name, wide: true,
    crumb: html`Pending review / <b class="mono">${submission.ref}</b>`,
  }, html`
    <div class="page-head"><div>
      <h1>${submission.title}</h1>
      <p>LC ${submission.lc_code} · ${formatDate(submission.event_date)} · ${submission.location ?? "—"}
         · submitted by ${submission.author_name} ${submission.submitted_at ? `${timeAgo(submission.submitted_at)} ago` : ""}
         · <span class="mono">${submission.ref}</span></p>
      <div class="flowbar" style="margin-top:9px">
        <span class="n on">Draft</span>→<span class="n on">Sent</span>→
        <span class="n ${decided ? "on" : "now"}">Under review</span>→
        <span class="n ${decided ? "on" : ""}">Approved</span></div>
    </div><div class="spacer"></div>
    ${submission.standing_committee ? html`<span class="pill tag">${submission.standing_committee}</span>` : ""}</div>

    ${submission.lo_note ? html`<div style="margin-bottom:14px">${note("info",
      html`<b>Note from ${submission.author_name?.split(" ")[0] ?? "the LO"} —</b> “${submission.lo_note}”`)}</div>` : ""}

    <div class="row" style="align-items:flex-start">
      <div style="flex:2.3;min-width:0;display:flex;flex-direction:column;gap:14px">
        <!-- One form per action: a form nested inside another is dropped by the
             browser, which silently breaks whichever button ends up orphaned. -->
        <form method="post" action="/review/${submission.id}/approve"
              style="display:flex;flex-direction:column;gap:14px">
          ${csrfField(req.csrfToken ?? "")}
          <div class="card">
            <div class="card-h"><h3>Rows</h3><span class="pill flat">${rows.length}</span><div class="spacer"></div>
              <small>Change a figure and say why — the reason is kept in the audit log</small></div>
            <div class="scroll-x"><table>
              <thead><tr><th style="min-width:168px">Volunteer</th><th style="min-width:230px">Role / effort</th>
                <th class="num">Proposed</th><th class="num" style="width:104px">Approved</th>
                <th style="width:230px">Your note</th><th style="width:88px">Row</th></tr></thead>
              <tbody>${rows.map((row) => {
                const outside = row.proposed_points < row.min_points || row.proposed_points > row.max_points;
                return html`<tr${outside ? html` style="background:var(--flag-row)"` : ""}>
                  <td>${who(row.full_name, `${row.lemsic_id ?? "—"}${row.study_year ? ` · ${row.study_year}` : ""}`)}</td>
                  <td>${row.category_label}
                    <div class="sub">${row.hours ? `${row.hours} h · ` : ""}${row.effort_note ?? ""}</div>
                    ${outside ? html`<div class="sub" style="color:var(--amber)">! band ${row.min_points}–${row.max_points}</div>` : ""}</td>
                  <td class="num mono">${row.proposed_points}</td>
                  <td class="num"><input class="pts" type="number" min="0" max="${row.max_points}"
                      name="points_${row.id}"
                      value="${row.approved_points ?? Math.min(row.proposed_points, row.max_points)}"
                      ${decided ? html`disabled` : ""}>
                    ${row.approved_points === null && row.proposed_points > row.max_points
                      ? html`<div class="sub" style="color:var(--amber)">capped at band max</div>` : ""}</td>
                  <td><input class="cellinp" name="note_${row.id}" maxlength="200"
                      value="${row.vpa_note ?? ""}" placeholder="only if you changed it" ${decided ? html`disabled` : ""}></td>
                  <td><label class="sub" style="display:flex;align-items:center;gap:6px">
                    <input type="checkbox" name="reject_${row.id}" ${row.state === "rejected" ? html`checked` : ""} ${decided ? html`disabled` : ""}> reject</label></td>
                </tr>`;
              })}</tbody>
            </table></div>
            <div class="pad" style="border-top:1px solid var(--line);background:var(--surface-2);display:flex;align-items:center;gap:14px;border-radius:0 0 var(--r) var(--r)">
              <span class="sub">${rows.length} rows</span><div class="spacer"></div>
              <span class="sub">Proposed <b class="mono">${proposed}</b></span>
            </div>
          </div>

          ${decided
            ? note("good", `Approved ${formatDate(submission.decided_at)} — ${rows.reduce((s, r) => s + (r.approved_points ?? 0), 0)} pts went to the ledger.`)
            : html`<div class="card"><div class="card-b" style="display:flex;flex-direction:column;gap:12px">
                <div class="field"><label for="vpa_note">Note on this decision (optional)</label>
                  <input class="inp" id="vpa_note" name="vpa_note" maxlength="500"
                    placeholder="Kept for the record; the LO does not see figures."></div>
                <button class="btn pri" type="submit" style="justify-content:center;padding:11px">
                  ✓ Approve &amp; write to the ledger</button>
              </div></div>`}
        </form>

        ${decided ? "" : html`<form method="post" action="/review/${submission.id}/return" class="card">
          ${csrfField(req.csrfToken ?? "")}
          <div class="card-h"><h3>Send it back instead</h3></div>
          <div class="card-b" style="display:flex;flex-direction:column;gap:10px">
            <div class="field"><label for="reason">Why — the LO reads this *</label>
              <input class="inp" id="reason" name="reason" maxlength="500" required
                placeholder="Two volunteers are listed as OC coordinator; the rubric allows one."></div>
            <button class="btn danger" type="submit" style="justify-content:center">↩ Return to the LO</button>
          </div>
        </form>`}
      </div>

      <div style="flex:1;min-width:262px;display:flex;flex-direction:column;gap:14px">
          <div class="card"><div class="card-h"><h3>Integrity checks</h3></div>
            <div class="card-b" style="display:flex;flex-direction:column;gap:9px">
              ${problems.length === 0 ? note("good", "Nothing flagged on this submission.") : ""}
              ${problems.map((p) => note(p.level === "error" ? "warn" : "info", p.message))}
            </div></div>
          <div class="card"><div class="card-h"><h3>What approving does</h3></div>
            <div class="card-b"><span class="sub">Writes one ledger entry per row that earns points.
              Entries can never be edited afterwards — a mistake is fixed by a correction entry,
              so the history stays intact.</span></div></div>
      </div>
    </div>`));
});

vpaRoutes.post("/review/:id/approve", ...vpa, async (req, res) => {
  const user = req.user!;
  const id = Number(req.params.id);
  const rows = await getRows(id);
  const body = req.body as Record<string, string>;
  const decisions: RowDecision[] = rows.map((row) => {
    const rejected = body[`reject_${row.id}`] !== undefined;
    const parsed = z.coerce.number().int().min(0).max(999).safeParse(body[`points_${row.id}`]);
    const points = parsed.success ? parsed.data : row.proposed_points;
    return {
      rowId: row.id,
      points: rejected ? 0 : points,
      state: rejected ? "rejected" : points === row.proposed_points ? "kept" : "edited",
      note: (body[`note_${row.id}`] ?? "").trim() || null,
    };
  });
  try {
    const result = await approveSubmission({
      submissionId: id, vpaUserId: user.id, decisions,
      vpaNote: (body.vpa_note ?? "").trim() || null,
    });
    res.redirect(`/review?approved=${encodeURIComponent(String(result.approvedTotal))}`);
  } catch (error) {
    res.status(400).send((error as Error).message);
  }
});

vpaRoutes.post("/review/:id/return", ...vpa, async (req, res) => {
  const user = req.user!;
  const reason = typeof req.body.reason === "string" ? req.body.reason : "";
  try {
    await returnToLo(Number(req.params.id), user.id, reason);
    res.redirect("/review");
  } catch (error) {
    res.status(400).send((error as Error).message);
  }
});

vpaRoutes.get("/points", ...vpa, async (req, res) => {
  const user = req.user!;
  const view = typeof req.query.view === "string" ? req.query.view : "ledger";
  const [totals, term] = await Promise.all([ledgerTotals(), currentTerm()]);

  const tabs = html`<div class="tabs">
    ${[["ledger", "Ledger"], ["member", "By member"], ["lc", "By LC"]].map(([key, label]) =>
      html`<a class="tab${view === key ? " on" : ""}" href="/points?view=${key}" style="text-decoration:none">${label}</a>`)}
  </div>`;

  let body = html``;
  if (view === "member") {
    const members = await query<{ full_name: string; lemsic_id: string | null; lc_code: string;
      carried: number; earned: number; total: number }>(
      `select m.full_name, m.lemsic_id, c.code as lc_code,
              coalesce(sum(l.points) filter (where l.kind = 'opening_balance'), 0)::int as carried,
              coalesce(sum(l.points) filter (where l.kind <> 'opening_balance'), 0)::int as earned,
              coalesce(sum(l.points), 0)::int as total
         from members m join local_committees c on c.id = m.lc_id
         left join ledger_entries l on l.member_id = m.id
        group by m.id, m.full_name, m.lemsic_id, c.code
       having coalesce(sum(l.points), 0) <> 0
        order by total desc limit 200`);
    body = html`<div class="scroll-x"><table>
      <thead><tr><th>Member</th><th>LC</th><th class="num">Carried forward</th>
        <th class="num">This term</th><th class="num">Total</th></tr></thead>
      <tbody>${members.map((m) => html`<tr>
        <td>${who(m.full_name, m.lemsic_id)}</td><td>${m.lc_code}</td>
        <td class="num mono">${m.carried}</td>
        <td class="num mono" style="color:var(--accent-2)">${m.earned >= 0 ? "+" : ""}${m.earned}</td>
        <td class="num"><b>${m.total}</b></td></tr>`)}</tbody></table></div>`;
  } else if (view === "lc") {
    const committees = await query<{ code: string; name: string; members: number; carried: number; earned: number; total: number }>(
      `select c.code, c.name, count(distinct l.member_id)::int as members,
              coalesce(sum(l.points) filter (where l.kind = 'opening_balance'), 0)::int as carried,
              coalesce(sum(l.points) filter (where l.kind <> 'opening_balance'), 0)::int as earned,
              coalesce(sum(l.points), 0)::int as total
         from local_committees c left join ledger_entries l on l.lc_id = c.id
        group by c.id, c.code, c.name order by total desc`);
    body = html`<div class="scroll-x"><table>
      <thead><tr><th>Local committee</th><th class="num">Members credited</th>
        <th class="num">Carried</th><th class="num">This term</th><th class="num">Total</th></tr></thead>
      <tbody>${committees.map((c) => html`<tr>
        <td><b>LC ${c.code}</b><div class="sub">${c.name}</div></td>
        <td class="num">${c.members}</td><td class="num mono">${c.carried}</td>
        <td class="num mono">${c.earned}</td><td class="num"><b>${c.total}</b></td></tr>`)}</tbody></table></div>`;
  } else {
    const entries = await query<{ id: number; full_name: string; lemsic_id: string | null; lc_code: string;
      kind: string; points: number; reason: string; created_at: string; approver: string | null }>(
      `select l.id, m.full_name, m.lemsic_id, c.code as lc_code, l.kind, l.points, l.reason,
              l.created_at, u.display_name as approver
         from ledger_entries l
         join members m on m.id = l.member_id
         join local_committees c on c.id = l.lc_id
    left join users u on u.id = l.approved_by
        order by l.id desc limit 200`);
    body = entries.length === 0
      ? html`<div class="card-b"><span class="sub">The ledger is empty. It fills as you approve submissions.</span></div>`
      : html`<div class="scroll-x"><table>
        <thead><tr><th>Entry</th><th>Member</th><th>Reason</th><th>LC</th>
          <th class="num">Pts</th><th>Approved by</th><th>When</th></tr></thead>
        <tbody>${entries.map((e) => html`<tr${e.points < 0 ? html` style="background:var(--red-soft)"` : e.kind === "opening_balance" ? html` style="background:var(--blue-soft)"` : ""}>
          <td class="mono">#${String(e.id).padStart(4, "0")}</td>
          <td>${who(e.full_name, e.lemsic_id)}</td>
          <td>${e.reason}${e.kind === "opening_balance" ? html`<div class="sub">Opening balance</div>` : ""}</td>
          <td>${e.lc_code}</td>
          <td class="num"><b style="${e.points < 0 ? "color:var(--red)" : ""}">${e.points > 0 ? "+" : ""}${e.points}</b></td>
          <td class="sub">${e.approver ?? "—"}</td>
          <td class="sub">${timeAgo(e.created_at)} ago</td></tr>`)}</tbody></table></div>`;
  }

  res.send(page({
    user, csrf: req.csrfToken ?? "", title: "Points sheet", currentPath: "/points", termLabel: term.name, wide: true,
  }, html`
    <div class="page-head"><div><h1>Live points sheet</h1>
      <p>Every row came from an approved submission or an import. Nothing is typed in directly —
         corrections are new, signed entries, so the history never changes underneath you.</p></div></div>
    <div class="grid g4" style="margin-bottom:16px">
      ${tile("Grand total", totals.total, "all members")}
      ${tile("Carried forward", totals.carried, "from the old workbook")}
      ${tile("Earned in app", totals.earned, `${totals.events} approved events`)}
      ${tile("Members credited", totals.members, "with points this term")}
    </div>
    <div class="card">${tabs}${body}</div>`));
});

vpaRoutes.get("/members", ...vpa, async (req, res) => {
  const user = req.user!;
  const term = await currentTerm();
  const members = await query<{ id: number; full_name: string; lemsic_id: string | null; lc_code: string;
    study_year: string | null; status: string; total: number; events: number }>(
    `select m.id, m.full_name, m.lemsic_id, m.study_year, m.status, c.code as lc_code,
            coalesce(sum(l.points), 0)::int as total,
            count(distinct l.submission_id)::int as events
       from members m join local_committees c on c.id = m.lc_id
       left join ledger_entries l on l.member_id = m.id
      group by m.id, c.code order by m.full_name limit 500`);
  res.send(page({
    user, csrf: req.csrfToken ?? "", title: "Members", currentPath: "/members", termLabel: term.name,
  }, html`
    <div class="page-head"><div><h1>Member registry</h1>
      <p>${members.length} people on the books. One profile per person is what keeps the totals honest.</p></div></div>
    <div class="card"><div class="scroll-x"><table>
      <thead><tr><th>Member</th><th>LC</th><th>Year</th><th>Status</th>
        <th class="num">Events</th><th class="num">Points</th></tr></thead>
      <tbody>${members.map((m) => html`<tr>
        <td>${who(m.full_name, m.lemsic_id)}</td><td>${m.lc_code}</td>
        <td class="sub">${m.study_year ?? "—"}</td>
        <td><span class="pill ${m.status === "active" ? "ok" : "flat"}">${m.status}</span></td>
        <td class="num">${m.events}</td><td class="num"><b>${m.total}</b></td></tr>`)}</tbody>
    </table></div></div>`));
});

vpaRoutes.get("/audit", ...vpa, async (req, res) => {
  const user = req.user!;
  const term = await currentTerm();
  const entries = await query<{ at: string; action: string; summary: string | null; actor: string | null }>(
    `select a.at, a.action, a.summary, u.display_name as actor
       from audit_log a left join users u on u.id = a.actor_id
      order by a.id desc limit 200`);
  res.send(page({
    user, csrf: req.csrfToken ?? "", title: "Audit log", currentPath: "/audit", termLabel: term.name,
  }, html`
    <div class="page-head"><div><h1>Audit log</h1>
      <p>Who did what, in order. Nothing here can be edited.</p></div></div>
    <div class="card"><div class="scroll-x"><table>
      <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
      <tbody>${entries.map((e) => html`<tr>
        <td class="sub">${timeAgo(e.at)} ago</td>
        <td>${e.actor ?? html`<span class="sub">—</span>`}</td>
        <td><span class="pill flat">${e.action}</span></td>
        <td class="sub">${e.summary ?? "—"}</td></tr>`)}</tbody>
    </table></div></div>`));
});

/** Phase-2 member view: their own points, nothing else. */
export async function memberHome(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const term = await currentTerm();
  const entries = await query<{ reason: string; points: number; created_at: string; kind: string }>(
    `select reason, points, created_at, kind from ledger_entries
      where member_id = $1 order by id desc limit 100`, [user.member_id]);
  const total = entries.reduce((sum, entry) => sum + entry.points, 0);
  res.send(page({
    user, csrf: req.csrfToken ?? "", title: "My points", currentPath: "/", termLabel: term.name,
  }, html`
    <div class="page-head"><div><h1>${total} points this term</h1>
      <p>Updated the moment the VPA approves a submission you were part of.</p></div></div>
    ${entries.length === 0
      ? emptyState("No points yet", "Points appear here once your LO submits an event and the VPA approves it.")
      : html`<div class="card"><div class="scroll-x"><table>
        <thead><tr><th>Activity</th><th class="num">Points</th><th>When</th></tr></thead>
        <tbody>${entries.map((e) => html`<tr>
          <td>${e.reason}</td><td class="num"><b>${e.points > 0 ? "+" : ""}${e.points}</b></td>
          <td class="sub">${timeAgo(e.created_at)} ago</td></tr>`)}</tbody>
      </table></div></div>`}`));
}
