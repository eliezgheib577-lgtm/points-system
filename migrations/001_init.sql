-- LeMSIC points platform — initial schema.
--
-- Two ideas drive this design:
--   1. The ledger is append-only. Points are never edited or deleted; a mistake
--      is fixed by writing a reversing entry. Balances are therefore always a
--      sum over history, and history never changes under anyone.
--   2. Roles are enforced in the data, not just the UI. Local Officers submit;
--      only the VPA ever reads totals.

begin;

create type user_role          as enum ('lo', 'vpa', 'admin', 'member');
create type submission_status  as enum ('draft', 'pending', 'under_review', 'approved', 'returned');
create type row_state          as enum ('proposed', 'kept', 'edited', 'rejected');
create type ledger_kind        as enum ('opening_balance', 'award', 'correction');
create type term_status        as enum ('open', 'closed');
create type member_status      as enum ('active', 'alumni', 'inactive');
create type import_mode        as enum ('opening_balance', 'full_history');

-- ---------------------------------------------------------------- committees
create table local_committees (
  id          serial primary key,
  code        text not null unique,          -- AUB, USJ, LAU ...
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- --------------------------------------------------------------------- terms
create table terms (
  id          serial primary key,
  name        text not null unique,          -- "2026-2027 - Semester 1"
  starts_on   date not null,
  ends_on     date,
  status      term_status not null default 'open',
  closed_at   timestamptz,
  created_at  timestamptz not null default now()
);
-- At most one term collects points at a time.
create unique index terms_one_open on terms ((status)) where status = 'open';

-- ------------------------------------------------------------------- members
-- A member is a person who can earn points. Distinct from a user, who can log
-- in: most members never get an account, and an LO account is not a member.
create table members (
  id              serial primary key,
  lemsic_id       text unique,
  full_name       text not null,
  normalized_name text not null,             -- casefolded, accent-stripped, for matching
  lc_id           integer not null references local_committees(id),
  study_year      text,
  email           text,
  status          member_status not null default 'active',
  created_at      timestamptz not null default now(),
  created_by      integer
);
create index members_lc on members (lc_id);
create index members_normalized on members (normalized_name);

-- Remembers that "L. Khoury" means Lea Khoury, so a name cleaned up once during
-- import does not come back as a duplicate the next time an LO types it.
create table member_aliases (
  id              serial primary key,
  member_id       integer not null references members(id) on delete cascade,
  alias_normalized text not null,
  source          text not null default 'import',
  created_at      timestamptz not null default now(),
  unique (alias_normalized, member_id)
);
create index member_aliases_lookup on member_aliases (alias_normalized);

-- --------------------------------------------------------------------- users
create table users (
  id                   serial primary key,
  username             text not null unique,
  password_hash        text not null,
  display_name         text not null,
  role                 user_role not null,
  lc_id                integer references local_committees(id),
  member_id            integer references members(id),
  active               boolean not null default true,
  must_change_password boolean not null default true,
  created_at           timestamptz not null default now(),
  created_by           integer references users(id),
  last_login_at        timestamptz,
  -- An LO always belongs to exactly one local committee; the VPA belongs to none.
  constraint lo_has_committee check (role <> 'lo' or lc_id is not null),
  constraint member_user_has_member check (role <> 'member' or member_id is not null)
);

create table sessions (
  id          text primary key,              -- random 256-bit token, hex
  user_id     integer not null references users(id) on delete cascade,
  csrf_token  text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  user_agent  text,
  ip          text
);
create index sessions_user on sessions (user_id);

-- -------------------------------------------------------------------- rubric
-- The rubric is data. Changing it publishes a new version; entries approved
-- earlier keep pointing at the version they were judged under.
create table rubric_versions (
  id           serial primary key,
  version      integer not null unique,
  notes        text,
  is_live      boolean not null default false,
  published_at timestamptz not null default now(),
  published_by integer references users(id)
);
create unique index rubric_one_live on rubric_versions ((is_live)) where is_live;

create table rubric_categories (
  id                serial primary key,
  rubric_version_id integer not null references rubric_versions(id) on delete cascade,
  key               text not null,
  label             text not null,
  description       text,
  default_points    integer not null,
  min_points        integer not null,
  max_points        integer not null,
  requires          text,                    -- "Attendance proof", "Session title" ...
  max_per_event     integer,                 -- e.g. one OC coordinator per event
  lo_can_exceed     boolean not null default false,
  sort_order        integer not null default 0,
  unique (rubric_version_id, key),
  constraint band_sane check (min_points <= default_points and default_points <= max_points and min_points >= 0)
);

-- --------------------------------------------------------------- submissions
-- One submission is one event plus the people who worked on it.
create table submissions (
  id                 serial primary key,
  ref                text not null unique,   -- SUB-2026-0147
  term_id            integer not null references terms(id),
  lc_id              integer not null references local_committees(id),
  rubric_version_id  integer not null references rubric_versions(id),
  created_by         integer not null references users(id),
  title              text not null,
  event_date         date,
  location           text,
  standing_committee text,
  activity_type      text,
  duration_label     text,
  description        text,
  status             submission_status not null default 'draft',
  lo_note            text,                   -- LO's note to the VPA
  vpa_note           text,                   -- reason shown to the LO when returned
  submitted_at       timestamptz,
  decided_at         timestamptz,
  decided_by         integer references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index submissions_status on submissions (status);
create index submissions_lc on submissions (lc_id);
create index submissions_creator on submissions (created_by);

create table submission_rows (
  id              serial primary key,
  submission_id   integer not null references submissions(id) on delete cascade,
  member_id       integer not null references members(id),
  category_id     integer not null references rubric_categories(id),
  hours           numeric(5,1),
  effort_note     text,
  proposed_points integer not null,
  approved_points integer,                   -- null until the VPA decides
  state           row_state not null default 'proposed',
  vpa_note        text,
  sort_order      integer not null default 0,
  -- The same person cannot appear twice on one event.
  unique (submission_id, member_id),
  constraint points_not_negative check (proposed_points >= 0 and (approved_points is null or approved_points >= 0))
);
create index submission_rows_submission on submission_rows (submission_id);
create index submission_rows_member on submission_rows (member_id);

create table attachments (
  id            serial primary key,
  submission_id integer not null references submissions(id) on delete cascade,
  filename      text not null,
  content_type  text,
  byte_size     integer,
  storage_key   text not null,
  uploaded_by   integer not null references users(id),
  uploaded_at   timestamptz not null default now()
);

-- ------------------------------------------------------------------- imports
create table import_batches (
  id            serial primary key,
  ref           text not null unique,        -- IMP-2026-01
  filename      text not null,
  file_sha256   text not null,               -- so the same file cannot be imported twice unnoticed
  mode          import_mode not null,
  row_count     integer not null default 0,
  total_points  integer not null default 0,
  storage_key   text,
  uploaded_by   integer not null references users(id),
  applied_at    timestamptz,
  reversed_at   timestamptz,
  reversed_by   integer references users(id),
  created_at    timestamptz not null default now()
);
create unique index import_batches_file on import_batches (file_sha256) where reversed_at is null;

-- -------------------------------------------------------------------- ledger
-- Append-only. Every point a member holds is a row here, and the only way to
-- take points back is to add a reversing row.
create table ledger_entries (
  id               bigserial primary key,
  term_id          integer not null references terms(id),
  member_id        integer not null references members(id),
  lc_id            integer not null references local_committees(id),
  kind             ledger_kind not null,
  points           integer not null,         -- negative for corrections
  reason           text not null,
  submission_id    integer references submissions(id),
  submission_row_id integer references submission_rows(id),
  import_batch_id  integer references import_batches(id),
  category_key     text,
  reverses_entry_id bigint references ledger_entries(id),
  approved_by      integer references users(id),
  created_at       timestamptz not null default now()
);
create index ledger_member on ledger_entries (member_id);
create index ledger_term on ledger_entries (term_id);
create index ledger_submission on ledger_entries (submission_id);
create index ledger_batch on ledger_entries (import_batch_id);
-- A submission row is paid exactly once.
create unique index ledger_one_per_row on ledger_entries (submission_row_id)
  where submission_row_id is not null and kind = 'award';

create or replace function ledger_is_append_only() returns trigger
language plpgsql as $$
begin
  raise exception
    'ledger_entries is append-only: % is not allowed. Write a reversing entry instead.', tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger ledger_no_update before update on ledger_entries
  for each row execute function ledger_is_append_only();
create trigger ledger_no_delete before delete on ledger_entries
  for each row execute function ledger_is_append_only();

-- ----------------------------------------------------------------- audit log
create table audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor_id    integer references users(id),
  action      text not null,                 -- 'submission.approved', 'rubric.published' ...
  entity_type text,
  entity_id   text,
  summary     text,
  details     jsonb,
  ip          text
);
create index audit_at on audit_log (at desc);
create index audit_entity on audit_log (entity_type, entity_id);

-- --------------------------------------------------------------- excel sync
create table excel_connections (
  id            serial primary key,
  account_label text not null,
  drive_id      text,
  item_id       text,
  folder_path   text,
  file_name     text not null,
  status        text not null default 'disconnected',
  connected_by  integer references users(id),
  connected_at  timestamptz,
  last_sync_at  timestamptz,
  last_error    text
);

create table sync_runs (
  id            bigserial primary key,
  connection_id integer references excel_connections(id) on delete cascade,
  trigger       text not null,               -- 'approval' | 'hourly' | 'manual'
  status        text not null,               -- 'ok' | 'retrying' | 'failed'
  rows_written  integer,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  error         text
);
create index sync_runs_recent on sync_runs (started_at desc);

-- ------------------------------------------------------------------- balance
-- Convenience view: what each member holds, split the way the UI shows it.
create view member_balances as
select
  m.id   as member_id,
  m.full_name,
  m.lemsic_id,
  m.lc_id,
  l.term_id,
  coalesce(sum(l.points) filter (where l.kind = 'opening_balance'), 0) as carried_forward,
  coalesce(sum(l.points) filter (where l.kind <> 'opening_balance'), 0) as earned_in_app,
  coalesce(sum(l.points), 0) as total
from members m
left join ledger_entries l on l.member_id = m.id
group by m.id, m.full_name, m.lemsic_id, m.lc_id, l.term_id;

commit;
