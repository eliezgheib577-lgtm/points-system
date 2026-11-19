import { Router } from "express";
import { requireAuth } from "../auth/session.js";
import { html } from "../lib/html.js";
import { page } from "../views/layout.js";
import { note, statusPill, who } from "../views/components.js";
import { currentTerm, liveRubric } from "../domain/core.js";
import { getRows, getSubmission } from "../domain/submissions.js";
import { formatDate, timeAgo } from "../lib/text.js";
import { loDashboard, loSubmissionsList } from "./lo.js";
import { memberHome, vpaOverview, vpaSubmissionsList } from "./vpa.js";

export const sharedRoutes = Router();

sharedRoutes.get("/", requireAuth, async (req, res) => {
  const role = req.user!.role;
  if (role === "lo") return loDashboard(req, res);
  if (role === "member") return memberHome(req, res);
  return vpaOverview(req, res);
});

sharedRoutes.get("/submissions", requireAuth, async (req, res) => {
  if (req.user!.role === "lo") return loSubmissionsList(req, res);
  return vpaSubmissionsList(req, res);
});

sharedRoutes.get("/rubric", requireAuth, async (req, res) => {
  const user = req.user!;
  const [rubric, term] = await Promise.all([liveRubric(), currentTerm()]);
  res.send(page({
    user, csrf: req.csrfToken ?? "", title: "Points rubric", currentPath: "/rubric", termLabel: term.name,
  }, html`
    <div class="page-head"><div><h1>Points rubric</h1>
      <p>Version ${rubric.version}, the one in force today. Every submission records the version it was
         judged under, so changing the rubric never rewrites past decisions.</p></div></div>
    <div class="card" style="max-width:860px">
      <div class="card-h"><h3>Effort categories</h3><div class="spacer"></div>
        <span class="pill flat">v${rubric.version} · live</span></div>
      <div class="scroll-x"><table>
        <thead><tr><th>Category</th><th class="num">Suggested</th><th class="num">Band</th><th>Requires</th></tr></thead>
        <tbody>${rubric.categories.map((c) => html`<tr>
          <td><b>${c.label}</b>${c.description ? html`<div class="sub">${c.description}</div>` : ""}
            ${c.max_per_event ? html`<div class="sub">max ${c.max_per_event} per event</div>` : ""}</td>
          <td class="num mono">${c.default_points}</td>
          <td class="num mono">${c.min_points}–${c.max_points}</td>
          <td class="sub">${c.requires ?? "—"}</td></tr>`)}</tbody>
      </table></div>
    </div>`));
});

/** Read-only view of one submission. An LO sees status; only the VPA sees figures. */
sharedRoutes.get("/submissions/:id", requireAuth, async (req, res) => {
  const user = req.user!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).send("No such submission.");
  const submission = await getSubmission(id);
  if (!submission) return res.status(404).send("No such submission.");

  const isVpa = user.role === "vpa" || user.role === "admin";
  if (!isVpa && submission.lc_id !== user.lc_id) return res.status(404).send("No such submission.");

  const [rows, term] = await Promise.all([getRows(submission.id), currentTerm()]);
  const justSent = req.query.sent === "1";
  const approvedTotal = rows.reduce((sum, row) => sum + (row.approved_points ?? 0), 0);

  res.send(page({
    user, csrf: req.csrfToken ?? "", title: submission.title,
    crumb: html`Submissions / <b class="mono">${submission.ref}</b>`,
    currentPath: "/submissions", termLabel: term.name,
    topbarExtra: isVpa && (submission.status === "pending" || submission.status === "under_review")
      ? html`<a class="btn pri sm" href="/review/${submission.id}" style="text-decoration:none">Review →</a>` : undefined,
  }, html`
    ${justSent ? html`<div style="margin-bottom:14px">${note("good", html`
      Sent to the VPA. It is locked now — you'll see the status change here when they decide.`)}</div>` : ""}

    <div class="page-head"><div>
      <h1>${submission.title}</h1>
      <p>LC ${submission.lc_code} · ${formatDate(submission.event_date)} · ${submission.location ?? "—"}
         · submitted by ${submission.author_name}
         ${submission.submitted_at ? html` · ${timeAgo(submission.submitted_at)}` : ""}</p>
    </div><div class="spacer"></div>${statusPill(submission.status)}</div>

    ${submission.status === "returned" && submission.vpa_note
      ? html`<div style="margin-bottom:14px">${note("warn", html`<b>Returned —</b> “${submission.vpa_note}”`)}</div>` : ""}
    ${submission.lo_note
      ? html`<div style="margin-bottom:14px">${note("info", html`<b>Note from the LO —</b> “${submission.lo_note}”`)}</div>` : ""}

    <div class="card">
      <div class="card-h"><h3>Volunteers</h3><span class="pill flat">${rows.length}</span></div>
      <div class="scroll-x"><table>
        <thead><tr><th>Volunteer</th><th>Role / effort</th><th class="num">Hrs</th><th>Effort note</th>
          ${isVpa ? html`<th class="num">Proposed</th><th class="num">Approved</th>` : ""}</tr></thead>
        <tbody>${rows.map((row) => html`<tr>
          <td>${who(row.full_name, row.lemsic_id)}</td>
          <td>${row.category_label}</td>
          <td class="num">${row.hours ?? "—"}</td>
          <td class="sub">${row.effort_note ?? "—"}</td>
          ${isVpa ? html`<td class="num mono">${row.proposed_points}</td>
            <td class="num">${row.approved_points === null ? html`<span class="sub">—</span>` : html`<b>${row.approved_points}</b>`}</td>` : ""}
        </tr>`)}</tbody>
      </table></div>
      ${isVpa ? html`<div class="pad" style="border-top:1px solid var(--line);background:var(--surface-2);display:flex;border-radius:0 0 var(--r) var(--r)">
        <span class="sub">Proposed ${rows.reduce((s, r) => s + r.proposed_points, 0)} pts</span>
        <div class="spacer"></div>
        ${submission.status === "approved" ? html`<b>Approved ${approvedTotal} pts</b>` : html`<span class="sub">Not decided yet</span>`}
      </div>` : html`<div class="pad" style="border-top:1px solid var(--line);background:var(--surface-2);border-radius:0 0 var(--r) var(--r)">
        <div class="note info" style="border:0;background:transparent;padding:0"><span class="ic">🔒</span>
        <span>The figures this ended up with are held by the VPA.</span></div></div>`}
    </div>`));
});
