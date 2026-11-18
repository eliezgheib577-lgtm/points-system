import type { PoolClient } from "pg";
import { one, query, tx } from "../lib/db.js";
import { audit, currentTerm, liveRubricId, rubricCategories } from "./core.js";

export interface SubmissionRow {
  id: number; member_id: number; category_id: number; hours: string | null;
  effort_note: string | null; proposed_points: number; approved_points: number | null;
  state: "proposed" | "kept" | "edited" | "rejected"; vpa_note: string | null;
  full_name: string; lemsic_id: string | null; study_year: string | null;
  category_key: string; category_label: string; min_points: number; max_points: number;
  lo_can_exceed: boolean; max_per_event: number | null;
}

export interface Submission {
  id: number; ref: string; term_id: number; lc_id: number; rubric_version_id: number;
  created_by: number; title: string; event_date: string | null; location: string | null;
  standing_committee: string | null; activity_type: string | null; duration_label: string | null;
  description: string | null; status: "draft" | "pending" | "under_review" | "approved" | "returned";
  lo_note: string | null; vpa_note: string | null; submitted_at: string | null;
  decided_at: string | null; decided_by: number | null; created_at: string;
  lc_code?: string; lc_name?: string; author_name?: string;
}

export async function getSubmission(id: number): Promise<Submission | undefined> {
  return one<Submission>(
    `select s.*, c.code as lc_code, c.name as lc_name, u.display_name as author_name
       from submissions s
       join local_committees c on c.id = s.lc_id
       join users u on u.id = s.created_by
      where s.id = $1`,
    [id],
  );
}

export async function getRows(submissionId: number): Promise<SubmissionRow[]> {
  return query<SubmissionRow>(
    `select r.id, r.member_id, r.category_id, r.hours, r.effort_note, r.proposed_points,
            r.approved_points, r.state, r.vpa_note,
            m.full_name, m.lemsic_id, m.study_year,
            rc.key as category_key, rc.label as category_label,
            rc.min_points, rc.max_points, rc.lo_can_exceed, rc.max_per_event
       from submission_rows r
       join members m on m.id = r.member_id
       join rubric_categories rc on rc.id = r.category_id
      where r.submission_id = $1
      order by r.sort_order, r.id`,
    [submissionId],
  );
}

export async function createDraft(input: {
  userId: number; lcId: number; title: string; eventDate: string | null; location: string | null;
  standingCommittee: string | null; activityType: string | null; durationLabel: string | null;
  description: string | null;
}): Promise<Submission> {
  const term = await currentTerm();
  const rubricVersionId = await liveRubricId();
  return tx(async (client) => {
    const inserted = await client.query<{ id: number }>(
      `insert into submissions
         (ref, term_id, lc_id, rubric_version_id, created_by, title, event_date, location,
          standing_committee, activity_type, duration_label, description)
       values ('pending', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [term.id, input.lcId, rubricVersionId, input.userId, input.title, input.eventDate,
       input.location, input.standingCommittee, input.activityType, input.durationLabel,
       input.description],
    );
    const id = inserted.rows[0]!.id;
    const year = new Date().getFullYear();
    const ref = `SUB-${year}-${String(id).padStart(4, "0")}`;
    const updated = await client.query<Submission>(
      "update submissions set ref = $1 where id = $2 returning *", [ref, id],
    );
    return updated.rows[0]!;
  });
}

export interface Problem { level: "error" | "warning"; message: string }

/**
 * Everything that must be true before the VPA should ever see this. Errors block
 * sending; warnings are shown to the LO and passed on to the VPA as flags.
 */
export async function checkSubmission(submission: Submission, rows: SubmissionRow[]): Promise<Problem[]> {
  const problems: Problem[] = [];

  if (!submission.title?.trim()) problems.push({ level: "error", message: "The event needs a name." });
  if (!submission.event_date) problems.push({ level: "error", message: "The event needs a date." });
  if (!submission.location?.trim()) problems.push({ level: "error", message: "The event needs a location." });
  if (rows.length === 0) problems.push({ level: "error", message: "Add at least one volunteer." });

  if (submission.event_date && new Date(submission.event_date) > new Date()) {
    problems.push({ level: "error", message: "The event date is in the future." });
  }

  // Points outside the rubric band. This is a flag, never a block: the LO should
  // be able to report what actually happened and let the VPA judge it. Blocking
  // here would only teach people to pick whichever category fits the number.
  for (const row of rows) {
    if (row.lo_can_exceed) continue;
    if (row.proposed_points < row.min_points || row.proposed_points > row.max_points) {
      problems.push({
        level: "warning",
        message: `${row.full_name}: “${row.category_label}” allows ${row.min_points}–${row.max_points} pts, you entered ${row.proposed_points}. Explain it in your note or the VPA will likely adjust it.`,
      });
    }
  }

  // Category limits, e.g. one OC coordinator per event.
  const perCategory = new Map<number, { count: number; row: SubmissionRow }>();
  for (const row of rows) {
    const seen = perCategory.get(row.category_id);
    perCategory.set(row.category_id, { count: (seen?.count ?? 0) + 1, row });
  }
  for (const { count, row } of perCategory.values()) {
    if (row.max_per_event != null && count > row.max_per_event) {
      problems.push({
        level: "error",
        message: `Only ${row.max_per_event} “${row.category_label}” allowed per event — you listed ${count}.`,
      });
    }
  }

  // The same person credited twice for the same day, across submissions.
  if (submission.event_date && rows.length > 0) {
    const clashes = await query<{ full_name: string; ref: string }>(
      `select distinct m.full_name, s2.ref
         from submission_rows r2
         join submissions s2 on s2.id = r2.submission_id
         join members m on m.id = r2.member_id
        where s2.id <> $1 and s2.event_date = $2
          and s2.status in ('pending','under_review','approved')
          and r2.member_id = any($3::int[])`,
      [submission.id, submission.event_date, rows.map((r) => r.member_id)],
    );
    for (const clash of clashes) {
      problems.push({
        level: "warning",
        message: `${clash.full_name} is already credited for ${submission.event_date} on ${clash.ref}.`,
      });
    }
  }

  return problems;
}

export async function sendToVpa(submissionId: number, userId: number, loNote: string | null): Promise<void> {
  const submission = await getSubmission(submissionId);
  if (!submission) throw new Error("No such submission.");
  if (submission.status !== "draft" && submission.status !== "returned") {
    throw new Error("Only a draft or a returned submission can be sent.");
  }
  const rows = await getRows(submissionId);
  const problems = await checkSubmission(submission, rows);
  if (problems.some((p) => p.level === "error")) {
    throw new Error("This submission still has problems that must be fixed first.");
  }
  await query(
    `update submissions set status = 'pending', submitted_at = now(), lo_note = $2,
            vpa_note = null, updated_at = now() where id = $1`,
    [submissionId, loNote],
  );
  await audit({
    actorId: userId, action: "submission.sent", entityType: "submission", entityId: submissionId,
    summary: `${submission.ref} sent to the VPA with ${rows.length} rows`,
  });
}

export interface RowDecision { rowId: number; points: number; state: "kept" | "edited" | "rejected"; note: string | null }

/**
 * Approve a submission: write the VPA's decision onto each row and append one
 * ledger entry per row that earned points. The ledger is append-only, so this is
 * the single moment a point comes into existence.
 */
export async function approveSubmission(input: {
  submissionId: number; vpaUserId: number; decisions: RowDecision[]; vpaNote: string | null;
}): Promise<{ approvedTotal: number; entriesWritten: number }> {
  return tx(async (client) => {
    const submission = (await client.query<Submission>(
      "select * from submissions where id = $1 for update", [input.submissionId],
    )).rows[0];
    if (!submission) throw new Error("No such submission.");
    if (submission.status === "approved") throw new Error("That submission is already approved.");
    if (submission.status === "draft") throw new Error("A draft has not been sent yet.");

    const categories = await rubricCategories(submission.rubric_version_id);
    const byId = new Map(categories.map((c) => [c.id, c]));
    const rows = (await client.query<{ id: number; member_id: number; category_id: number; proposed_points: number }>(
      "select id, member_id, category_id, proposed_points from submission_rows where submission_id = $1",
      [input.submissionId],
    )).rows;
    const decisionFor = new Map(input.decisions.map((d) => [d.rowId, d]));

    let approvedTotal = 0;
    let entriesWritten = 0;

    for (const row of rows) {
      const decision = decisionFor.get(row.id) ?? {
        rowId: row.id, points: row.proposed_points, state: "kept" as const, note: null,
      };
      const category = byId.get(row.category_id);
      if (!category) throw new Error("A row points at a category outside this submission's rubric version.");
      if (decision.state !== "rejected") {
        if (decision.points < 0) throw new Error("Points cannot be negative.");
        if (decision.points > category.max_points) {
          throw new Error(`${category.label} tops out at ${category.max_points} points.`);
        }
      }
      const points = decision.state === "rejected" ? 0 : decision.points;
      const state = decision.state === "rejected"
        ? "rejected"
        : points === row.proposed_points ? "kept" : "edited";

      await client.query(
        "update submission_rows set approved_points = $2, state = $3, vpa_note = $4 where id = $1",
        [row.id, points, state, decision.note],
      );

      if (points > 0) {
        await client.query(
          `insert into ledger_entries
             (term_id, member_id, lc_id, kind, points, reason, submission_id, submission_row_id,
              category_key, approved_by)
           values ($1, $2, $3, 'award', $4, $5, $6, $7, $8, $9)`,
          [submission.term_id, row.member_id, submission.lc_id, points,
           `${submission.title} — ${category.label}`, submission.id, row.id, category.key,
           input.vpaUserId],
        );
        entriesWritten += 1;
        approvedTotal += points;
      }
    }

    await client.query(
      `update submissions set status = 'approved', decided_at = now(), decided_by = $2,
              vpa_note = $3, updated_at = now() where id = $1`,
      [input.submissionId, input.vpaUserId, input.vpaNote],
    );
    await client.query(
      `insert into audit_log (actor_id, action, entity_type, entity_id, summary, details)
       values ($1, 'submission.approved', 'submission', $2, $3, $4)`,
      [input.vpaUserId, String(input.submissionId),
       `${submission.ref} approved for ${approvedTotal} pts across ${entriesWritten} members`,
       JSON.stringify({ decisions: input.decisions })],
    );

    return { approvedTotal, entriesWritten };
  });
}

export async function returnToLo(submissionId: number, vpaUserId: number, reason: string): Promise<void> {
  if (!reason.trim()) throw new Error("Say why you are sending it back — the LO sees this.");
  const updated = await query<{ ref: string }>(
    `update submissions set status = 'returned', vpa_note = $2, decided_at = now(),
            decided_by = $3, updated_at = now()
      where id = $1 and status in ('pending','under_review') returning ref`,
    [submissionId, reason, vpaUserId],
  );
  if (updated.length === 0) throw new Error("That submission is not waiting for review.");
  await audit({
    actorId: vpaUserId, action: "submission.returned", entityType: "submission",
    entityId: submissionId, summary: `${updated[0]!.ref} returned to the LO`, details: { reason },
  });
}

export async function deleteRow(submissionId: number, rowId: number): Promise<void> {
  await query(
    `delete from submission_rows r using submissions s
      where r.id = $1 and r.submission_id = s.id and s.id = $2
        and s.status in ('draft','returned')`,
    [rowId, submissionId],
  );
}

export type { PoolClient };
