import { one, query } from "../lib/db.js";

export interface Term { id: number; name: string; status: string; starts_on: string }
export interface RubricCategory {
  id: number; key: string; label: string; description: string | null;
  default_points: number; min_points: number; max_points: number;
  requires: string | null; max_per_event: number | null; lo_can_exceed: boolean; sort_order: number;
}

export async function currentTerm(): Promise<Term> {
  const term = await one<Term>("select id, name, status, starts_on from terms where status = 'open'");
  if (!term) throw new Error("No open term. The VPA needs to open one before points can be collected.");
  return term;
}

export async function liveRubricId(): Promise<number> {
  const row = await one<{ id: number }>("select id from rubric_versions where is_live");
  if (!row) throw new Error("No live rubric version.");
  return row.id;
}

export async function rubricCategories(rubricVersionId: number): Promise<RubricCategory[]> {
  return query<RubricCategory>(
    `select id, key, label, description, default_points, min_points, max_points,
            requires, max_per_event, lo_can_exceed, sort_order
       from rubric_categories where rubric_version_id = $1 order by sort_order, id`,
    [rubricVersionId],
  );
}

export async function liveRubric(): Promise<{ id: number; version: number; categories: RubricCategory[] }> {
  const version = await one<{ id: number; version: number }>(
    "select id, version from rubric_versions where is_live",
  );
  if (!version) throw new Error("No live rubric version.");
  return { ...version, categories: await rubricCategories(version.id) };
}

export async function audit(entry: {
  actorId: number | null; action: string; entityType?: string; entityId?: string | number;
  summary?: string; details?: unknown; ip?: string | null;
}): Promise<void> {
  await query(
    `insert into audit_log (actor_id, action, entity_type, entity_id, summary, details, ip)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [entry.actorId, entry.action, entry.entityType ?? null,
     entry.entityId != null ? String(entry.entityId) : null,
     entry.summary ?? null, entry.details ? JSON.stringify(entry.details) : null, entry.ip ?? null],
  );
}
