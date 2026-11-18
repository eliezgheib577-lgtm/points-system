import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pool, query } from "../src/lib/db.js";
import {
  approveSubmission, checkSubmission, createDraft, getRows, getSubmission, returnToLo, sendToVpa,
} from "../src/domain/submissions.js";
import { addRow, resetDatabase, type Fixture } from "./fixtures.js";

let fx: Fixture;

async function draftWithRows(points: Array<[string, string, number]>) {
  const submission = await createDraft({
    userId: fx.loId, lcId: fx.lcId, title: "World Diabetes Day Screening",
    eventDate: "2026-11-14", location: "Hamra", standingCommittee: "SCOPH",
    activityType: "Campaign / Screening", durationLabel: "Full day", description: "Screening",
  });
  for (const [member, category, value] of points) {
    await addRow(submission.id, fx.members[member]!, fx.categories[category]!, value);
  }
  return submission;
}

before(async () => { fx = await resetDatabase(); });
after(async () => { await pool.end(); });

describe("the ledger is append-only", () => {
  it("refuses to update an entry", async () => {
    fx = await resetDatabase();
    const submission = await draftWithRows([["Lea Khoury", "oc_member", 8]]);
    await sendToVpa(submission.id, fx.loId, null);
    await approveSubmission({ submissionId: submission.id, vpaUserId: fx.vpaId, decisions: [], vpaNote: null });

    await assert.rejects(
      () => query("update ledger_entries set points = 999"),
      /append-only/,
      "updating a ledger entry should be impossible, not merely discouraged",
    );
  });

  it("refuses to delete an entry", async () => {
    await assert.rejects(() => query("delete from ledger_entries"), /append-only/);
  });

  it("pays a submission row exactly once", async () => {
    fx = await resetDatabase();
    const submission = await draftWithRows([["Lea Khoury", "oc_member", 8]]);
    await sendToVpa(submission.id, fx.loId, null);
    await approveSubmission({ submissionId: submission.id, vpaUserId: fx.vpaId, decisions: [], vpaNote: null });

    await assert.rejects(
      () => approveSubmission({ submissionId: submission.id, vpaUserId: fx.vpaId, decisions: [], vpaNote: null }),
      /already approved/i,
      "approving twice would double every member's points",
    );
    const entries = await query("select 1 from ledger_entries");
    assert.equal(entries.length, 1);
  });
});

describe("what the LO may send", () => {
  it("blocks an empty submission", async () => {
    fx = await resetDatabase();
    const submission = await draftWithRows([]);
    const problems = await checkSubmission(submission, await getRows(submission.id));
    assert.ok(problems.some((p) => p.level === "error" && /at least one volunteer/i.test(p.message)));
  });

  it("flags points outside the band without blocking the send", async () => {
    fx = await resetDatabase();
    const submission = await draftWithRows([["Lea Khoury", "volunteer_half", 7]]);
    const problems = await checkSubmission(submission, await getRows(submission.id));
    const band = problems.find((p) => /allows 2–4/.test(p.message));
    assert.ok(band, "an out-of-band figure should be flagged");
    assert.equal(band!.level, "warning", "flagging is right; blocking would push LOs to mislabel the category");
    await sendToVpa(submission.id, fx.loId, "Covered an extra shift");
    assert.equal((await getSubmission(submission.id))!.status, "pending");
  });

  it("blocks a second OC coordinator, because the rubric allows one", async () => {
    fx = await resetDatabase();
    const submission = await draftWithRows([
      ["Lea Khoury", "oc_coordinator", 12],
      ["Karim Nassar", "oc_coordinator", 12],
    ]);
    const problems = await checkSubmission(submission, await getRows(submission.id));
    assert.ok(problems.some((p) => p.level === "error" && /Only 1/.test(p.message)));
    await assert.rejects(() => sendToVpa(submission.id, fx.loId, null), /problems/i);
  });

  it("refuses the same volunteer twice on one event", async () => {
    fx = await resetDatabase();
    const submission = await draftWithRows([["Lea Khoury", "oc_member", 8]]);
    await assert.rejects(
      () => addRow(submission.id, fx.members["Lea Khoury"]!, fx.categories.volunteer_half!, 3),
      /duplicate key/,
    );
  });

  it("warns when a member is already credited for that date elsewhere", async () => {
    fx = await resetDatabase();
    const first = await draftWithRows([["Lea Khoury", "oc_member", 8]]);
    await sendToVpa(first.id, fx.loId, null);
    const second = await draftWithRows([["Lea Khoury", "volunteer_half", 3]]);
    const problems = await checkSubmission(second, await getRows(second.id));
    assert.ok(problems.some((p) => p.level === "warning" && /already credited/.test(p.message)));
  });
});

describe("what approving writes", () => {
  it("writes one entry per paid row and honours the VPA's adjustment", async () => {
    fx = await resetDatabase();
    const submission = await draftWithRows([
      ["Lea Khoury", "oc_coordinator", 12],
      ["Karim Nassar", "oc_member", 8],
      ["Maya Saad", "volunteer_half", 7],
    ]);
    await sendToVpa(submission.id, fx.loId, null);
    const rows = await getRows(submission.id);
    const maya = rows.find((r) => r.full_name === "Maya Saad")!;

    const result = await approveSubmission({
      submissionId: submission.id, vpaUserId: fx.vpaId, vpaNote: null,
      decisions: [{ rowId: maya.id, points: 4, state: "edited", note: "Band max." }],
    });

    assert.equal(result.entriesWritten, 3);
    assert.equal(result.approvedTotal, 24, "12 + 8 + 4, not the 27 proposed");
    const entries = await query<{ points: number }>("select points from ledger_entries order by points");
    assert.deepEqual(entries.map((e) => e.points), [4, 8, 12]);
  });

  it("writes nothing for a rejected row", async () => {
    fx = await resetDatabase();
    const submission = await draftWithRows([
      ["Lea Khoury", "oc_member", 8],
      ["Karim Nassar", "volunteer_half", 2],
    ]);
    await sendToVpa(submission.id, fx.loId, null);
    const rows = await getRows(submission.id);
    const karim = rows.find((r) => r.full_name === "Karim Nassar")!;

    const result = await approveSubmission({
      submissionId: submission.id, vpaUserId: fx.vpaId, vpaNote: null,
      decisions: [{ rowId: karim.id, points: 0, state: "rejected", note: "Attendance only." }],
    });

    assert.equal(result.entriesWritten, 1);
    const paid = await query<{ member_id: number }>("select member_id from ledger_entries");
    assert.equal(paid.length, 1);
    assert.notEqual(paid[0]!.member_id, fx.members["Karim Nassar"]);
  });

  it("will not award above the rubric's ceiling", async () => {
    fx = await resetDatabase();
    const submission = await draftWithRows([["Lea Khoury", "volunteer_half", 3]]);
    await sendToVpa(submission.id, fx.loId, null);
    const [row] = await getRows(submission.id);
    await assert.rejects(
      () => approveSubmission({
        submissionId: submission.id, vpaUserId: fx.vpaId, vpaNote: null,
        decisions: [{ rowId: row!.id, points: 40, state: "edited", note: null }],
      }),
      /tops out at 4/,
    );
    assert.equal((await query("select 1 from ledger_entries")).length, 0, "a refused approval writes nothing");
  });

  it("cannot approve a draft that was never sent", async () => {
    fx = await resetDatabase();
    const submission = await draftWithRows([["Lea Khoury", "oc_member", 8]]);
    await assert.rejects(
      () => approveSubmission({ submissionId: submission.id, vpaUserId: fx.vpaId, decisions: [], vpaNote: null }),
      /not been sent/i,
    );
  });
});

describe("returning to the LO", () => {
  it("demands a reason", async () => {
    fx = await resetDatabase();
    const submission = await draftWithRows([["Lea Khoury", "oc_member", 8]]);
    await sendToVpa(submission.id, fx.loId, null);
    await assert.rejects(() => returnToLo(submission.id, fx.vpaId, "   "), /say why/i);
  });

  it("puts it back in the LO's hands with the reason attached", async () => {
    fx = await resetDatabase();
    const submission = await draftWithRows([["Lea Khoury", "oc_member", 8]]);
    await sendToVpa(submission.id, fx.loId, null);
    await returnToLo(submission.id, fx.vpaId, "Two coordinators listed.");
    const after = (await getSubmission(submission.id))!;
    assert.equal(after.status, "returned");
    assert.equal(after.vpa_note, "Two coordinators listed.");
    assert.equal((await query("select 1 from ledger_entries")).length, 0);
  });
});
