import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { one, query } from "../lib/db.js";
import { requireAuth, requireRole } from "../auth/session.js";
import { html } from "../lib/html.js";
import { page } from "../views/layout.js";
import { csrfField, emptyState, note, statusPill, tile, who } from "../views/components.js";
import { currentTerm, liveRubric } from "../domain/core.js";
import {
  checkSubmission, createDraft, deleteRow, getRows, getSubmission, sendToVpa,
} from "../domain/submissions.js";
import { formatDate } from "../lib/text.js";

export const loRoutes = Router();
const lo = [requireAuth, requireRole("lo")];

/** Submissions an LO may touch: their committee's, never anyone else's. */
async function committeeSubmissions(lcId: number, status?: string) {
  return query<{
    id: number; ref: string; title: string; location: string | null; event_date: string | null;
    standing_committee: string | null; status: string; volunteers: number;
  }>(
    `select s.id, s.ref, s.title, s.location, s.event_date, s.standing_committee, s.status,
            (select count(*) from submission_rows r where r.submission_id = s.id)::int as volunteers
       from submissions s
      where s.lc_id = $1 ${status ? "and s.status = $2" : ""}
      order by coalesce(s.event_date, current_date) desc, s.id desc`,
    status ? [lcId, status] : [lcId],
  );
}

export async function loDashboard(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const term = await currentTerm();
  const rows = await committeeSubmissions(user.lc_id!);
  const counts = {
    draft: rows.filter((r) => r.status === "draft").length,
    pending: rows.filter((r) => r.status === "pending" || r.status === "under_review").length,
    returned: rows.filter((r) => r.status === "returned").length,
    sent: rows.filter((r) => r.status !== "draft").length,
  };
  const returned = rows.filter((r) => r.status === "returned");
  const returnedDetail = returned.length > 0
    ? await one<{ vpa_note: string | null }>("select vpa_note from submissions where id = $1", [returned[0]!.id])
    : undefined;

  res.send(page({
    user, csrf: req.csrfToken ?? "", title: "Dashboard", currentPath: "/", termLabel: term.name,
    counts: { "Returned to me": counts.returned || 0, "My submissions": rows.length },
    topbarExtra: html`<a class="btn pri sm" href="/submissions/new" style="text-decoration:none">＋ New submission</a>`,
  }, html`
    <div class="page-head"><div>
      <h1>Welcome back, ${user.display_name.split(" ")[0]}</h1>
      <p>${counts.returned > 0
          ? `${counts.returned} submission${counts.returned === 1 ? " came" : "s came"} back with comments`
          : "Nothing needs fixing"}${counts.pending > 0 ? ` and ${counts.pending} ${counts.pending === 1 ? "is" : "are"} still with the VPA` : ""}.
        Everything you send is reviewed by the VPA before it counts.</p>
    </div></div>

    <div class="grid g4" style="margin-bottom:16px">
      ${tile("Drafts", counts.draft, "not sent yet")}
      ${tile("Pending VPA", counts.pending, counts.pending > 0 ? "with the VPA" : "nothing waiting", counts.pending > 0)}
      ${tile("Returned to you", counts.returned, counts.returned > 0 ? "needs a fix" : "all clear")}
      ${tile("Sent this term", counts.sent, term.name)}
    </div>

    ${returned.length > 0 && returnedDetail?.vpa_note ? html`<div style="margin-bottom:16px">${note("warn", html`
      <b>Action needed —</b> “${returned[0]!.title}” was returned by the VPA:
      <i>“${returnedDetail.vpa_note}”</i>
      <a href="/submissions/${returned[0]!.id}/edit">Open &amp; fix →</a>`)}</div>` : ""}

    ${rows.length === 0
      ? emptyState("No submissions yet", "Start with the event you most recently ran — it takes about two minutes.")
      : html`<div class="card">
      <div class="card-h"><h3>My submissions</h3><div class="spacer"></div>
        <span class="sub">LC ${user.lc_code}</span></div>
      <div class="scroll-x"><table>
        <thead><tr><th>Event</th><th>Date</th><th>Committee</th><th class="num">Volunteers</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.map((row) => html`<tr>
          <td><b>${row.title}</b>${row.location ? html`<div class="sub">${row.location}</div>` : ""}</td>
          <td>${formatDate(row.event_date)}</td>
          <td>${row.standing_committee ? html`<span class="pill tag">${row.standing_committee}</span>` : html`<span class="sub">—</span>`}</td>
          <td class="num">${row.volunteers}</td>
          <td>${statusPill(row.status)}</td>
          <td><a href="${row.status === "draft" || row.status === "returned" ? `/submissions/${row.id}/edit` : `/submissions/${row.id}`}">
            ${row.status === "draft" ? "Continue" : row.status === "returned" ? "Fix" : "View"}</a></td>
        </tr>`)}</tbody>
      </table></div>
      <div class="pad" style="border-top:1px solid var(--line);background:var(--surface-2);border-radius:0 0 var(--r) var(--r)">
        <div class="note info" style="border:0;background:transparent;padding:0"><span class="ic">🔒</span>
        <span>Point totals, member balances and the points sheet are held by the VPA — your own points included.
        You'll see whether a submission was approved, never the figures it ended up with.</span></div>
      </div>
    </div>`}`));
}

export async function loSubmissionsList(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await committeeSubmissions(user.lc_id!, status);
  const term = await currentTerm();
  res.send(page({
    user, csrf: req.csrfToken ?? "", title: status === "returned" ? "Returned to me" : "My submissions",
    currentPath: status === "returned" ? "/submissions?status=returned" : "/submissions", termLabel: term.name,
  }, html`
    <div class="page-head"><div>
      <h1>${status === "returned" ? "Returned to you" : "Submissions from LC " + user.lc_code}</h1>
      <p>${status === "returned"
        ? "The VPA sent these back with a comment. Fix what they mention and send again."
        : "Everything your committee has logged this term, newest first."}</p>
    </div><div class="spacer"></div>
    <a class="btn pri sm" href="/submissions/new" style="text-decoration:none">＋ New submission</a></div>
    ${rows.length === 0 ? emptyState("Nothing here", "When you send a submission it shows up in this list.") : html`
    <div class="card"><div class="scroll-x"><table>
      <thead><tr><th>Reference</th><th>Event</th><th>Date</th><th class="num">Volunteers</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map((row) => html`<tr>
        <td class="mono">${row.ref}</td>
        <td><b>${row.title}</b></td>
        <td>${formatDate(row.event_date)}</td>
        <td class="num">${row.volunteers}</td>
        <td>${statusPill(row.status)}</td>
        <td><a href="${row.status === "draft" || row.status === "returned" ? `/submissions/${row.id}/edit` : `/submissions/${row.id}`}">Open</a></td>
      </tr>`)}</tbody></table></div></div>`}`));
}

loRoutes.get("/submissions/new", ...lo, async (req, res) => {
  const user = req.user!;
  const term = await currentTerm();
  res.send(page({
    user, csrf: req.csrfToken ?? "", title: "New submission", currentPath: "/submissions/new", termLabel: term.name,
  }, html`
    <div class="steps">
      <div class="step on"><span class="n">1</span><b>Event details</b></div><div class="step-line"></div>
      <div class="step"><span class="n">2</span><b>Volunteers &amp; points</b></div><div class="step-line"></div>
      <div class="step"><span class="n">3</span><b>Review &amp; send</b></div>
    </div>
    <div class="page-head"><div><h1>Event details</h1>
      <p>Describe the activity once. This becomes the record attached to every point you propose.</p></div></div>
    <form method="post" action="/submissions" class="card" style="max-width:720px">
      ${csrfField(req.csrfToken ?? "")}
      <div class="card-b" style="display:flex;flex-direction:column;gap:15px">
        <div class="field"><label for="title">Event name *</label>
          <input class="inp" id="title" name="title" required maxlength="160" placeholder="World Diabetes Day Screening Campaign"></div>
        <div class="grid g3">
          <div class="field"><label for="event_date">Date *</label>
            <input class="inp" id="event_date" name="event_date" type="date" required></div>
          <div class="field"><label for="duration_label">Duration</label>
            <select class="inp" id="duration_label" name="duration_label">
              <option value="">—</option><option>Half day (up to 4 h)</option>
              <option>Full day (over 4 h)</option><option>Multi-day</option><option>Online</option></select></div>
          <div class="field"><label>Local committee</label>
            <div class="inp" style="background:var(--surface-2);color:var(--muted)">LC ${user.lc_code} 🔒</div></div>
        </div>
        <div class="grid g2">
          <div class="field"><label for="location">Location *</label>
            <input class="inp" id="location" name="location" required maxlength="160" placeholder="Hamra Public Square, Beirut"></div>
          <div class="field"><label for="standing_committee">Standing committee *</label>
            <select class="inp" id="standing_committee" name="standing_committee" required>
              <option value="">Choose…</option>
              ${["SCOPH", "SCORA", "SCORP", "SCOME", "SCOPE", "SCORE", "Internal", "PR & Media"]
                .map((sc) => html`<option>${sc}</option>`)}</select></div>
        </div>
        <div class="field"><label for="activity_type">Activity type</label>
          <select class="inp" id="activity_type" name="activity_type">
            <option value="">—</option>
            ${["Campaign / Screening", "Workshop / Training", "School visit", "Conference / GA",
               "Fundraiser", "Social", "Webinar", "Other"].map((t) => html`<option>${t}</option>`)}</select></div>
        <div class="field"><label for="description">Short description *</label>
          <textarea class="inp" id="description" name="description" required rows="3"
            placeholder="What happened, and how many people it reached."></textarea></div>
      </div>
      <div class="pad" style="border-top:1px solid var(--line);display:flex;gap:10px;justify-content:flex-end">
        <a class="btn" href="/" style="text-decoration:none">Cancel</a>
        <button class="btn pri" type="submit">Next: volunteers →</button>
      </div>
    </form>`));
});

const eventSchema = z.object({
  title: z.string().trim().min(1).max(160),
  event_date: z.string().trim().min(1),
  location: z.string().trim().min(1).max(160),
  standing_committee: z.string().trim().max(40).optional().default(""),
  activity_type: z.string().trim().max(60).optional().default(""),
  duration_label: z.string().trim().max(60).optional().default(""),
  description: z.string().trim().max(4000).optional().default(""),
});

loRoutes.post("/submissions", ...lo, async (req, res) => {
  const user = req.user!;
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).send("Fill in the event name, date and location.");
  const draft = await createDraft({
    userId: user.id, lcId: user.lc_id!, title: parsed.data.title,
    eventDate: parsed.data.event_date, location: parsed.data.location,
    standingCommittee: parsed.data.standing_committee || null,
    activityType: parsed.data.activity_type || null,
    durationLabel: parsed.data.duration_label || null,
    description: parsed.data.description || null,
  });
  res.redirect(`/submissions/${draft.id}/edit`);
});

/** The rows editor: step 2 of the wizard, and where a returned submission is fixed. */
loRoutes.get("/submissions/:id/edit", ...lo, async (req, res) => {
  const user = req.user!;
  const submission = await getSubmission(Number(req.params.id));
  if (!submission || submission.lc_id !== user.lc_id) return res.status(404).send("No such submission.");
  if (submission.status !== "draft" && submission.status !== "returned") {
    return res.redirect(`/submissions/${submission.id}`);
  }
  const [rows, rubric, members, term] = await Promise.all([
    getRows(submission.id),
    liveRubric(),
    query<{ id: number; full_name: string; lemsic_id: string | null }>(
      `select id, full_name, lemsic_id from members
        where lc_id = $1 and status = 'active' order by full_name`, [user.lc_id]),
    currentTerm(),
  ]);
  const problems = await checkSubmission(submission, rows);
  const total = rows.reduce((sum, row) => sum + row.proposed_points, 0);

  res.send(page({
    user, csrf: req.csrfToken ?? "", title: "Volunteers & points",
    crumb: html`New submission / <b>Volunteers &amp; points</b>`,
    currentPath: "/submissions/new", termLabel: term.name,
    topbarExtra: html`<a class="btn sm" href="/submissions/${submission.id}/review" style="text-decoration:none">Next: review →</a>`,
  }, html`
    <div class="steps">
      <div class="step done"><span class="n">✓</span><b>Event details</b></div><div class="step-line"></div>
      <div class="step on"><span class="n">2</span><b>Volunteers &amp; points</b></div><div class="step-line"></div>
      <div class="step"><span class="n">3</span><b>Review &amp; send</b></div>
    </div>
    <div class="page-head"><div><h1>Who worked on this?</h1>
      <p><b>${submission.title}</b> · ${formatDate(submission.event_date)} · ${submission.location}
         · <span class="mono">${submission.ref}</span></p></div></div>

    ${submission.status === "returned" && submission.vpa_note
      ? html`<div style="margin-bottom:14px">${note("warn", html`<b>The VPA sent this back —</b> “${submission.vpa_note}”`)}</div>`
      : ""}

    <div class="row" style="align-items:flex-start">
      <div style="flex:2.2;min-width:0;display:flex;flex-direction:column;gap:14px">
        <form method="post" action="/submissions/${submission.id}/rows" class="card">
          ${csrfField(req.csrfToken ?? "")}
          <div class="card-h"><h3>Add a volunteer</h3><div class="spacer"></div>
            <small>Pick from your committee's members — the picker shows no points</small></div>
          <div class="card-b" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
            <div class="field" style="flex:1.6;min-width:190px"><label for="member_id">Member</label>
              <select class="inp" id="member_id" name="member_id" required>
                <option value="">Choose a member…</option>
                ${members.map((m) => html`<option value="${m.id}">${m.full_name}${m.lemsic_id ? ` · ${m.lemsic_id}` : ""}</option>`)}
              </select></div>
            <div class="field" style="flex:1.3;min-width:180px"><label for="category_id">Role / effort</label>
              <select class="inp" id="category_id" name="category_id" required
                      data-defaults="${rubric.categories.map((c) => `${c.id}:${c.default_points}`).join(",")}">
                <option value="">From the rubric…</option>
                ${rubric.categories.map((c) => html`<option value="${c.id}">${c.label} (${c.min_points}–${c.max_points})</option>`)}
              </select></div>
            <div class="field" style="width:84px"><label for="hours">Hours</label>
              <input class="inp" id="hours" name="hours" type="number" step="0.5" min="0" max="99"></div>
            <div class="field" style="width:92px"><label for="proposed_points">Points</label>
              <input class="inp" id="proposed_points" name="proposed_points" type="number" min="0" max="99" required></div>
            <div class="field" style="flex:2;min-width:200px"><label for="effort_note">What they did</label>
              <input class="inp" id="effort_note" name="effort_note" maxlength="200" placeholder="Screening station 2, ~70 participants"></div>
            <button class="btn pri" type="submit">＋ Add row</button>
          </div>
        </form>

        <div class="card">
          <div class="card-h"><h3>Volunteers on this event</h3><span class="pill flat">${rows.length} rows</span></div>
          ${rows.length === 0
            ? html`<div class="card-b"><span class="sub">No one added yet. Use the form above — every volunteer needs a row.</span></div>`
            : html`<div class="scroll-x"><table>
            <thead><tr><th>Volunteer</th><th>Role / effort</th><th class="num">Hrs</th><th>Effort note</th><th class="num">Points</th><th></th></tr></thead>
            <tbody>${rows.map((row) => {
              const outside = row.proposed_points < row.min_points || row.proposed_points > row.max_points;
              return html`<tr${outside ? html` style="background:var(--flag-row)"` : ""}>
                <td>${who(row.full_name, row.lemsic_id)}</td>
                <td>${row.category_label}
                  ${outside ? html`<div class="sub" style="color:var(--amber)">! band ${row.min_points}–${row.max_points}</div>` : ""}</td>
                <td class="num">${row.hours ?? "—"}</td>
                <td class="sub">${row.effort_note ?? "—"}</td>
                <td class="num"><b>${row.proposed_points}</b></td>
                <td><form method="post" action="/submissions/${submission.id}/rows/${row.id}/delete" style="margin:0">
                  ${csrfField(req.csrfToken ?? "")}
                  <button class="btn ghost sm" type="submit" title="Remove this row">✕</button></form></td>
              </tr>`;
            })}</tbody></table></div>`}
          <div class="pad" style="border-top:1px solid var(--line);display:flex;align-items:center;gap:12px;background:var(--surface-2);border-radius:0 0 var(--r) var(--r)">
            <span class="sub">${rows.length} ${rows.length === 1 ? "volunteer" : "volunteers"}</span>
            <div class="spacer"></div>
            <span style="font-size:13px"><span class="sub">Total proposed</span>
              <b style="font-size:17px;font-variant-numeric:tabular-nums"> ${total}</b> <span class="sub">pts</span></span>
          </div>
        </div>

        ${problems.filter((p) => p.level === "error").map((p) => note("warn", p.message))}
        ${problems.filter((p) => p.level === "warning").map((p) => note("warn", p.message))}

        <div style="display:flex;gap:10px;justify-content:flex-end">
          <a class="btn" href="/" style="text-decoration:none">Save &amp; close</a>
          <a class="btn pri" href="/submissions/${submission.id}/review" style="text-decoration:none">Next: review →</a>
        </div>
      </div>

      <div style="flex:1;min-width:250px;display:flex;flex-direction:column;gap:14px">
        <div class="card"><div class="card-h"><h3>Points rubric</h3><div class="spacer"></div>
          <small>v${rubric.version}</small></div>
          <table><tbody>${rubric.categories.map((c) => html`<tr>
            <td>${c.label}${c.requires ? html`<div class="sub">needs ${c.requires}</div>` : ""}</td>
            <td class="num mono">${c.min_points}–${c.max_points}</td></tr>`)}</tbody></table>
        </div>
        <div class="card"><div class="card-h"><h3>Automatic checks</h3></div>
          <div class="card-b" style="display:flex;flex-direction:column;gap:9px">
            ${problems.length === 0
              ? html`<div class="sub">✓ Nothing flagged</div>`
              : problems.map((p) => html`<div class="sub" style="color:${p.level === "error" ? "var(--red)" : "var(--amber)"}">
                  ${p.level === "error" ? "✕" : "!"} ${p.message}</div>`)}
            <div class="sub">✓ No duplicate volunteer in this event</div>
          </div></div>
      </div>
    </div>
    <script>
      // Pre-fill the points box with the rubric default when a category is picked.
      (function () {
        var category = document.getElementById("category_id");
        var points = document.getElementById("proposed_points");
        if (!category || !points) return;
        var defaults = {};
        (category.getAttribute("data-defaults") || "").split(",").forEach(function (pair) {
          var bits = pair.split(":"); if (bits.length === 2) defaults[bits[0]] = bits[1];
        });
        category.addEventListener("change", function () {
          if (defaults[category.value] !== undefined) points.value = defaults[category.value];
        });
      })();
    </script>`));
});

const rowSchema = z.object({
  member_id: z.coerce.number().int().positive(),
  category_id: z.coerce.number().int().positive(),
  hours: z.string().optional(),
  proposed_points: z.coerce.number().int().min(0).max(99),
  effort_note: z.string().trim().max(200).optional().default(""),
});

loRoutes.post("/submissions/:id/rows", ...lo, async (req, res) => {
  const user = req.user!;
  const submission = await getSubmission(Number(req.params.id));
  if (!submission || submission.lc_id !== user.lc_id) return res.status(404).send("No such submission.");
  if (submission.status !== "draft" && submission.status !== "returned") {
    return res.status(409).send("This submission is locked — it is already with the VPA.");
  }
  const parsed = rowSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).send("Choose a member, a role and a number of points.");

  // The member must belong to this LO's own committee.
  const member = await one<{ id: number }>(
    "select id from members where id = $1 and lc_id = $2", [parsed.data.member_id, user.lc_id]);
  if (!member) return res.status(400).send("That member is not in your committee.");

  const category = await one<{ id: number }>(
    "select id from rubric_categories where id = $1 and rubric_version_id = $2",
    [parsed.data.category_id, submission.rubric_version_id]);
  if (!category) return res.status(400).send("That role is not in the rubric this submission uses.");

  try {
    await query(
      `insert into submission_rows
         (submission_id, member_id, category_id, hours, effort_note, proposed_points, sort_order)
       values ($1, $2, $3, $4, $5, $6, (select coalesce(max(sort_order), 0) + 1 from submission_rows where submission_id = $1))`,
      [submission.id, parsed.data.member_id, parsed.data.category_id,
       parsed.data.hours ? Number(parsed.data.hours) : null,
       parsed.data.effort_note || null, parsed.data.proposed_points],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return res.status(400).send("That member is already on this event — edit their row instead of adding a second one.");
    }
    throw error;
  }
  res.redirect(`/submissions/${submission.id}/edit`);
});

loRoutes.post("/submissions/:id/rows/:rowId/delete", ...lo, async (req, res) => {
  const user = req.user!;
  const submission = await getSubmission(Number(req.params.id));
  if (!submission || submission.lc_id !== user.lc_id) return res.status(404).send("No such submission.");
  await deleteRow(submission.id, Number(req.params.rowId));
  res.redirect(`/submissions/${submission.id}/edit`);
});

loRoutes.get("/submissions/:id/review", ...lo, async (req, res) => {
  const user = req.user!;
  const submission = await getSubmission(Number(req.params.id));
  if (!submission || submission.lc_id !== user.lc_id) return res.status(404).send("No such submission.");
  const [rows, term] = await Promise.all([getRows(submission.id), currentTerm()]);
  const problems = await checkSubmission(submission, rows);
  const blocking = problems.filter((p) => p.level === "error");
  const total = rows.reduce((sum, row) => sum + row.proposed_points, 0);

  const byRole = new Map<string, { count: number; total: number }>();
  for (const row of rows) {
    const seen = byRole.get(row.category_label) ?? { count: 0, total: 0 };
    byRole.set(row.category_label, { count: seen.count + 1, total: seen.total + row.proposed_points });
  }

  res.send(page({
    user, csrf: req.csrfToken ?? "", title: "Review & send",
    crumb: html`New submission / <b>Review &amp; send</b>`,
    currentPath: "/submissions/new", termLabel: term.name,
  }, html`
    <div class="steps">
      <div class="step done"><span class="n">✓</span><b>Event details</b></div><div class="step-line"></div>
      <div class="step done"><span class="n">✓</span><b>Volunteers &amp; points</b></div><div class="step-line"></div>
      <div class="step on"><span class="n">3</span><b>Review &amp; send</b></div>
    </div>
    <div class="page-head"><div><h1>Review before sending</h1>
      <p>Once sent, the submission locks. The VPA can change it; you can't.</p></div></div>
    <div class="row" style="align-items:flex-start">
      <div style="flex:1.7;min-width:0;display:flex;flex-direction:column;gap:14px">
        <div class="card">
          <div class="card-h"><h3>${submission.title}</h3><div class="spacer"></div>
            ${submission.standing_committee ? html`<span class="pill tag">${submission.standing_committee}</span>` : ""}</div>
          <div class="card-b grid g4" style="gap:16px">
            <div class="kv"><span class="k">Reference</span><span class="v mono">${submission.ref}</span></div>
            <div class="kv"><span class="k">Date</span><span class="v">${formatDate(submission.event_date)}</span></div>
            <div class="kv"><span class="k">Location</span><span class="v">${submission.location}</span></div>
            <div class="kv"><span class="k">Committee</span><span class="v">LC ${submission.lc_code}</span></div>
            <div class="kv"><span class="k">Volunteers</span><span class="v">${rows.length}</span></div>
            <div class="kv"><span class="k">Points proposed</span><span class="v">${total}</span></div>
          </div>
        </div>
        <div class="card"><div class="card-h"><h3>Breakdown by role</h3></div>
          <table><thead><tr><th>Role / effort</th><th class="num">People</th><th class="num">Subtotal</th></tr></thead>
            <tbody>${[...byRole.entries()].map(([label, stat]) => html`<tr>
              <td>${label}</td><td class="num">${stat.count}</td><td class="num">${stat.total}</td></tr>`)}</tbody></table>
          <div class="pad" style="background:var(--surface-2);border-top:1px solid var(--line);display:flex;align-items:center;border-radius:0 0 var(--r) var(--r)">
            <b>Total proposed</b><div class="spacer"></div><b style="font-size:17px">${total} pts</b></div>
        </div>
      </div>
      <div style="flex:1;min-width:260px;display:flex;flex-direction:column;gap:14px">
        <div class="card"><div class="card-h"><h3>Pre-flight checks</h3></div>
          <div class="card-b" style="display:flex;flex-direction:column;gap:10px">
            ${problems.length === 0 ? note("good", "Everything checks out.") : ""}
            ${problems.map((p) => note(p.level === "error" ? "warn" : "warn", p.message))}
          </div></div>
        <form method="post" action="/submissions/${submission.id}/send" class="card">
          ${csrfField(req.csrfToken ?? "")}
          <div class="card-h"><h3>Send to the VPA</h3></div>
          <div class="card-b" style="display:flex;flex-direction:column;gap:12px">
            <div class="field"><label for="lo_note">Note to the VPA (optional)</label>
              <textarea class="inp" id="lo_note" name="lo_note" rows="3" maxlength="1000"
                placeholder="Anything that explains an unusual row.">${submission.lo_note ?? ""}</textarea></div>
            ${blocking.length > 0
              ? note("warn", `Fix ${blocking.length} problem${blocking.length === 1 ? "" : "s"} above before you can send.`)
              : ""}
            <button class="btn pri" type="submit" style="justify-content:center"
              ${blocking.length > 0 ? html`disabled` : ""}>Send to VPA →</button>
            <a class="btn" href="/submissions/${submission.id}/edit" style="text-decoration:none;justify-content:center">← Back to volunteers</a>
          </div>
        </form>
      </div>
    </div>`));
});

loRoutes.post("/submissions/:id/send", ...lo, async (req, res) => {
  const user = req.user!;
  const submission = await getSubmission(Number(req.params.id));
  if (!submission || submission.lc_id !== user.lc_id) return res.status(404).send("No such submission.");
  const loNote = typeof req.body.lo_note === "string" ? req.body.lo_note.trim() || null : null;
  try {
    await sendToVpa(submission.id, user.id, loNote);
  } catch (error) {
    return res.status(400).send((error as Error).message);
  }
  res.redirect(`/submissions/${submission.id}?sent=1`);
});
