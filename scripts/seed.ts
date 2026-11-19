/**
 * Seeds a working demo: committees, a term, the rubric, a VPA and two LOs, and a
 * member registry. Safe to re-run — it clears and rebuilds everything, so never
 * point it at a database holding real points.
 */
import { pool, query, tx } from "../src/lib/db.js";
import { hashPassword } from "../src/auth/passwords.js";
import { normalizeName } from "../src/lib/text.js";

const COMMITTEES = [
  ["AUB", "American University of Beirut"],
  ["USJ", "Université Saint-Joseph"],
  ["LAU", "Lebanese American University"],
  ["BAU", "Beirut Arab University"],
  ["LU", "Lebanese University"],
  ["UOB", "University of Balamand"],
  ["USEK", "Holy Spirit University of Kaslik"],
] as const;

const RUBRIC = [
  ["participant", "Participant / attendee", "Attended, no task assigned", 1, 0, 2, null, null, false],
  ["volunteer_half", "Volunteer — half day", "Up to 4 h on site", 3, 2, 4, "Attendance proof", null, false],
  ["volunteer_full", "Volunteer — full day", "More than 4 h on site", 5, 4, 6, "Attendance proof", null, false],
  ["design", "Design / social media", "Posters, reels, coverage", 3, 2, 5, "Link or file", null, true],
  ["logistics", "Logistics & procurement", "Supplies, transport, venue", 4, 3, 6, null, null, false],
  ["report", "Report / documentation", "Activity report, data entry", 4, 3, 6, "Document", null, false],
  ["oc_member", "OC member", "Organising committee", 8, 6, 10, null, null, false],
  ["trainer", "Trainer / facilitator", "Delivered a session", 10, 8, 12, "Session title", null, true],
  ["oc_coordinator", "OC coordinator", "Leads the organising committee", 12, 10, 15, null, 1, false],
] as const;

const MEMBERS: Array<[string, string, string, string]> = [
  ["Lea Khoury", "LEM-2341", "AUB", "Med 3"],
  ["Karim Nassar", "LEM-2502", "AUB", "Med 2"],
  ["Maya Saad", "LEM-2488", "AUB", "Med 4"],
  ["Jad Mansour", "LEM-2611", "AUB", "Med 2"],
  ["Nour Abou Jaoude", "LEM-2377", "AUB", "Med 3"],
  ["Tala Fares", "LEM-2690", "AUB", "Med 1"],
  ["Omar Chehab", "LEM-2745", "AUB", "Med 1"],
  ["Hani Khalil", "LEM-2801", "AUB", "Med 1"],
  ["Rami Haddad", "LEM-2190", "AUB", "Med 4"],
  ["Elias Rizk", "LEM-2015", "USJ", "Med 6"],
  ["Yara Doumit", "LEM-2061", "USJ", "Med 3"],
  ["Perla Gemayel", "LEM-2456", "UOB", "Med 4"],
  ["Hadi Zein", "LEM-2104", "LU", "Med 5"],
  ["Sara Itani", "LEM-2233", "BAU", "Med 2"],
  ["Dana Ayoub", "LEM-2309", "LAU", "Med 3"],
];

const DEV_PASSWORD = "lemsic-demo-2026";

await tx(async (client) => {
  await client.query(`truncate audit_log, sync_runs, excel_connections, ledger_entries,
    attachments, submission_rows, submissions, import_batches, sessions, users,
    member_aliases, members, rubric_categories, rubric_versions, terms, local_committees
    restart identity cascade`);

  for (const [code, name] of COMMITTEES) {
    await client.query("insert into local_committees (code, name) values ($1, $2)", [code, name]);
  }

  await client.query(
    "insert into terms (name, starts_on, status) values ($1, $2, 'open')",
    ["2026–2027 · Semester 1", "2026-09-01"],
  );

  const rubric = await client.query<{ id: number }>(
    `insert into rubric_versions (version, notes, is_live) values (1, $1, true) returning id`,
    ["Seeded starting rubric — the VPA should check these bands against LeMSIC's own table."],
  );
  const rubricId = rubric.rows[0]!.id;
  let order = 0;
  for (const [key, label, description, def, min, max, requires, maxPerEvent, canExceed] of RUBRIC) {
    await client.query(
      `insert into rubric_categories (rubric_version_id, key, label, description, default_points,
         min_points, max_points, requires, max_per_event, lo_can_exceed, sort_order)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [rubricId, key, label, description, def, min, max, requires, maxPerEvent, canExceed, order++],
    );
  }

  const lcIds = new Map<string, number>();
  for (const row of (await client.query<{ id: number; code: string }>("select id, code from local_committees")).rows) {
    lcIds.set(row.code, row.id);
  }

  const memberIds = new Map<string, number>();
  for (const [name, lemsicId, lc, year] of MEMBERS) {
    const inserted = await client.query<{ id: number }>(
      `insert into members (lemsic_id, full_name, normalized_name, lc_id, study_year)
       values ($1,$2,$3,$4,$5) returning id`,
      [lemsicId, name, normalizeName(name), lcIds.get(lc)!, year],
    );
    memberIds.set(name, inserted.rows[0]!.id);
  }

  const hash = await hashPassword(DEV_PASSWORD);
  await client.query(
    `insert into users (username, password_hash, display_name, role, lc_id, must_change_password)
     values ('vpa', $1, 'Yara Dagher', 'vpa', null, false)`, [hash]);
  await client.query(
    `insert into users (username, password_hash, display_name, role, lc_id, must_change_password)
     values ('lo.aub', $1, 'Rami Haddad', 'lo', $2, false)`, [hash, lcIds.get("AUB")]);
  await client.query(
    `insert into users (username, password_hash, display_name, role, lc_id, must_change_password)
     values ('lo.usj', $1, 'Elias Rizk', 'lo', $2, false)`, [hash, lcIds.get("USJ")]);
  await client.query(
    `insert into users (username, password_hash, display_name, role, member_id, must_change_password)
     values ('member.lea', $1, 'Lea Khoury', 'member', $2, false)`, [hash, memberIds.get("Lea Khoury")]);
});

console.log(`seeded: ${COMMITTEES.length} committees, ${RUBRIC.length} rubric categories, ${MEMBERS.length} members`);
console.log(`accounts: vpa / lo.aub / lo.usj / member.lea — all with password “${DEV_PASSWORD}”`);
await pool.end();
