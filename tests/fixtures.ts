import { query, tx } from "../src/lib/db.js";
import { hashPassword } from "../src/auth/passwords.js";
import { normalizeName } from "../src/lib/text.js";

export interface Fixture {
  termId: number; lcId: number; otherLcId: number; rubricId: number;
  vpaId: number; loId: number; categories: Record<string, number>; members: Record<string, number>;
}

/** Rebuilds a small, known world before each test. */
export async function resetDatabase(): Promise<Fixture> {
  return tx(async (client) => {
    await client.query(`truncate audit_log, sync_runs, excel_connections, ledger_entries,
      attachments, submission_rows, submissions, import_batches, sessions, users,
      member_aliases, members, rubric_categories, rubric_versions, terms, local_committees
      restart identity cascade`);

    const lc = await client.query<{ id: number }>(
      "insert into local_committees (code, name) values ('AUB','American University of Beirut') returning id");
    const other = await client.query<{ id: number }>(
      "insert into local_committees (code, name) values ('USJ','Universite Saint-Joseph') returning id");
    const term = await client.query<{ id: number }>(
      "insert into terms (name, starts_on, status) values ('Test term','2026-09-01','open') returning id");
    const rubric = await client.query<{ id: number }>(
      "insert into rubric_versions (version, is_live) values (1, true) returning id");

    const categories: Record<string, number> = {};
    const rows: Array<[string, string, number, number, number, number | null, boolean]> = [
      // key, label, default, min, max, maxPerEvent, loCanExceed
      ["volunteer_half", "Volunteer — half day", 3, 2, 4, null, false],
      ["oc_member", "OC member", 8, 6, 10, null, false],
      ["oc_coordinator", "OC coordinator", 12, 10, 15, 1, false],
      ["design", "Design / social media", 3, 2, 5, null, true],
    ];
    let order = 0;
    for (const [key, label, def, min, max, maxPerEvent, canExceed] of rows) {
      const inserted = await client.query<{ id: number }>(
        `insert into rubric_categories (rubric_version_id, key, label, default_points, min_points,
           max_points, max_per_event, lo_can_exceed, sort_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [rubric.rows[0]!.id, key, label, def, min, max, maxPerEvent, canExceed, order++]);
      categories[key] = inserted.rows[0]!.id;
    }

    const members: Record<string, number> = {};
    for (const [name, id] of [["Lea Khoury", "LEM-1"], ["Karim Nassar", "LEM-2"], ["Maya Saad", "LEM-3"]] as const) {
      const inserted = await client.query<{ id: number }>(
        `insert into members (lemsic_id, full_name, normalized_name, lc_id)
         values ($1,$2,$3,$4) returning id`,
        [id, name, normalizeName(name), lc.rows[0]!.id]);
      members[name] = inserted.rows[0]!.id;
    }

    const hash = await hashPassword("test-password-123");
    const vpa = await client.query<{ id: number }>(
      `insert into users (username, password_hash, display_name, role, must_change_password)
       values ('vpa', $1, 'Test VPA', 'vpa', false) returning id`, [hash]);
    const lo = await client.query<{ id: number }>(
      `insert into users (username, password_hash, display_name, role, lc_id, must_change_password)
       values ('lo', $1, 'Test LO', 'lo', $2, false) returning id`, [hash, lc.rows[0]!.id]);

    return {
      termId: term.rows[0]!.id, lcId: lc.rows[0]!.id, otherLcId: other.rows[0]!.id,
      rubricId: rubric.rows[0]!.id, vpaId: vpa.rows[0]!.id, loId: lo.rows[0]!.id,
      categories, members,
    };
  });
}

export async function addRow(submissionId: number, memberId: number, categoryId: number, points: number): Promise<number> {
  const rows = await query<{ id: number }>(
    `insert into submission_rows (submission_id, member_id, category_id, proposed_points)
     values ($1,$2,$3,$4) returning id`, [submissionId, memberId, categoryId, points]);
  return rows[0]!.id;
}
