import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query } from "../src/lib/db.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

await query(`create table if not exists schema_migrations (
  filename text primary key, applied_at timestamptz not null default now())`);

const applied = new Set((await query<{ filename: string }>("select filename from schema_migrations"))
  .map((row) => row.filename));
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

let count = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const sql = await readFile(path.join(dir, file), "utf8");
  console.log(`applying ${file}`);
  await query(sql);
  await query("insert into schema_migrations (filename) values ($1)", [file]);
  count += 1;
}
console.log(count === 0 ? "nothing to apply — schema is current" : `${count} migration(s) applied`);
await pool.end();
