import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export interface Migration {
  filename: string;
  sql: string;
  checksum: string;
}

interface AppliedMigration {
  filename: string;
  checksum: string;
}

export const schemaAndMedicalDataLockId = 780244211;
const ledgerTable = "public.app_schema_migrations";

const baselineMarkers: Record<string, Array<[string, string]>> = {
  "001_auth.sql": [["users", "email"], ["auth_sessions", "expires_at"]],
  "002_patients.sql": [["patients", "user_id"]],
  "003_doctors.sql": [["doctors", "approval_status"]],
  "004_appointments.sql": [["appointments", "status"]],
  "005_health_records.sql": [["consultation_records", "note"]],
  "006_notifications.sql": [["notifications", "event_key"]],
  "007_prescriptions.sql": [["prescriptions", "medication_name"]],
  "008_admin_audit.sql": [["admin_audit_events", "action"]],
  "009_admin_totp_mfa.sql": [["admin_mfa", "secret_encrypted"], ["auth_sessions", "mfa_verified"]],
  "010_auth_providers_and_recovery.sql": [["auth_identities", "provider"], ["users", "email_verified"]],
  "011_telemedicine.sql": [["teleconsultations", "room_name"]],
  "012_persistent_messaging.sql": [["care_messages", "body"], ["care_conversations", "id"]],
  "013_messaging_access_audit.sql": [["care_conversation_access_events", "action"]],
  "014_demo_doctors_and_private_documents.sql": [["appointment_documents", "storage_key"], ["doctors", "synthetic_dataset_id"]],
  "015_auth_login_rate_limits.sql": [["auth_login_attempt_limits", "bucket_hash"]],
  "016_medical_data_encryption.sql": [["care_messages", "encryption_version"], ["appointment_documents", "storage_format"]]
};

export function createMigration(filename: string, sql: string): Migration {
  return { filename, sql, checksum: createHash("sha256").update(sql, "utf8").digest("hex") };
}

function validateMigrationFiles(migrations: Migration[]): void {
  const filenames = new Set<string>();
  for (const migration of migrations) {
    if (!/^\d{3}_[a-z0-9_-]+\.sql$/.test(migration.filename) ||
        filenames.has(migration.filename) || !baselineMarkers[migration.filename]) {
      throw new Error("Migration files must be unique, numbered, and have a historical-baseline marker check.");
    }
    const expected = createMigration(migration.filename, migration.sql).checksum;
    if (migration.checksum !== expected) throw new Error(`Migration checksum is invalid for ${migration.filename}.`);
    filenames.add(migration.filename);
  }
  const ordered = [...migrations].sort((left, right) => left.filename.localeCompare(right.filename));
  if (ordered.some((migration, index) => migration.filename !== migrations[index]?.filename)) {
    throw new Error("Migration files must be supplied in filename order.");
  }
}

async function lock(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_lock($1::bigint)", [schemaAndMedicalDataLockId]);
}

async function unlock(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_unlock($1::bigint)", [schemaAndMedicalDataLockId]);
}

async function migrationLedgerExists(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ ledger: string | null }>(
    "SELECT to_regclass($1) AS ledger",
    [ledgerTable]
  );
  return result.rows[0]?.ledger !== null && result.rows[0]?.ledger !== undefined;
}

async function publicObjectCount(client: PoolClient): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')`
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function createLedger(client: PoolClient): Promise<void> {
  await client.query(
    `CREATE TABLE ${ledgerTable} (
       filename text PRIMARY KEY,
       checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
       applied_at timestamptz NOT NULL DEFAULT now()
     )`
  );
}

async function validateLedgerSchema(client: PoolClient): Promise<void> {
  const { rows } = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(
    `SELECT column_name,data_type,is_nullable FROM information_schema.columns
     WHERE table_schema='public' AND table_name='app_schema_migrations'`
  );
  const columns = new Map(rows.map((row) => [row.column_name, row]));
  const valid = [
    ["filename", "text"],
    ["checksum", "text"],
    ["applied_at", "timestamp with time zone"]
  ].every(([name, type]) => {
    const column = columns.get(name!);
    return column?.data_type === type && column.is_nullable === "NO";
  });
  const primaryKey = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid='public.app_schema_migrations'::regclass AND contype='p'
         AND pg_get_constraintdef(oid)='PRIMARY KEY (filename)'
     ) AS exists`
  );
  if (!valid || !primaryKey.rows[0]?.exists) {
    throw new Error("The migration ledger schema is unexpected; manual review is required.");
  }
}

async function readAppliedMigrations(client: PoolClient): Promise<AppliedMigration[]> {
  const { rows } = await client.query<AppliedMigration>(
    `SELECT filename,checksum FROM ${ledgerTable} ORDER BY filename`
  );
  return rows;
}

function validateAppliedHistory(applied: AppliedMigration[], migrations: Migration[]): number {
  const byFilename = new Map(migrations.map((migration, index) => [migration.filename, { migration, index }]));
  let lastIndex = -1;
  for (const entry of applied) {
    const known = byFilename.get(entry.filename);
    if (!known) throw new Error(`Database migration history contains an unknown migration: ${entry.filename}.`);
    if (known.index !== lastIndex + 1) {
      throw new Error("Database migration history is not a contiguous prefix; manual review is required.");
    }
    if (entry.checksum !== known.migration.checksum) {
      throw new Error(`Applied migration checksum differs from the source file: ${entry.filename}.`);
    }
    lastIndex = known.index;
  }
  return lastIndex;
}

async function ensureLedger(client: PoolClient): Promise<void> {
  if (await migrationLedgerExists(client)) return;
  if (await publicObjectCount(client) !== 0) {
    throw new Error(
      "This database has application objects but no migration ledger. Review its schema and use the documented db:baseline procedure; no migrations were run."
    );
  }
  await createLedger(client);
}

async function verifyBaselineSchema(client: PoolClient, migrations: Migration[], throughIndex: number): Promise<void> {
  const { rows } = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name,column_name FROM information_schema.columns
     WHERE table_schema='public'`
  );
  const columns = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = migrations.slice(0, throughIndex + 1).flatMap((migration) =>
    (baselineMarkers[migration.filename] ?? []).filter(([table, column]) => !columns.has(`${table}.${column}`))
      .map(([table, column]) => `${table}.${column}`)
  );
  if (missing.length) {
    throw new Error(`Baseline schema checks failed; missing expected columns: ${missing.join(", ")}.`);
  }
  const laterMarkers = migrations.slice(throughIndex + 1).flatMap((migration) =>
    (baselineMarkers[migration.filename] ?? []).filter(([table, column]) => columns.has(`${table}.${column}`))
      .map(([table, column]) => `${table}.${column}`)
  );
  if (laterMarkers.length) {
    throw new Error(`Baseline target is older than the detected schema markers: ${laterMarkers.join(", ")}.`);
  }
  if (migrations[throughIndex]?.filename === "016_medical_data_encryption.sql") {
    const constraint = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conrelid='care_messages'::regclass AND conname='care_messages_body_length_check'
       ) AS exists`
    );
    if (!constraint.rows[0]?.exists) {
      throw new Error("Baseline schema checks failed; care_messages_body_length_check is missing.");
    }
  }
}

async function preflightMigration(client: PoolClient, migration: Migration): Promise<void> {
  if (migration.filename !== "016_medical_data_encryption.sql") return;
  const { rows } = await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>(
    `SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns
     WHERE table_schema='public' AND table_name IN ('care_messages','appointment_documents')`
  );
  const columns = new Map(rows.map((row) => [`${row.table_name}.${row.column_name}`, row]));
  for (const [key, type] of [
    ["care_messages.body", "text"],
    ["appointment_documents.storage_key", "uuid"],
    ["appointment_documents.media_type", "text"]
  ]) {
    const column = columns.get(key!);
    if (column?.data_type !== type || column.is_nullable !== "NO") {
      throw new Error(`Migration 016 prerequisites are not satisfied: expected ${key} with type ${type} and NOT NULL.`);
    }
  }
  if (columns.has("care_messages.encryption_version") || columns.has("appointment_documents.storage_format")) {
    throw new Error("Migration 016 columns already exist without a matching ledger entry; manual schema review is required.");
  }
  const legacyConstraint = await client.query<{ definition: string }>(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
     WHERE conrelid='public.care_messages'::regclass AND conname='care_messages_body_check'`
  );
  const normalizedConstraint = legacyConstraint.rows[0]?.definition
    .replace(/[\s()]/g, "")
    .toLowerCase();
  if (legacyConstraint.rows.length !== 1 ||
      normalizedConstraint !== "checkchar_lengthbody>=1andchar_lengthbody<=4000") {
    throw new Error("Migration 016 expected care_messages_body_check for 1..4000 characters; manual schema review is required.");
  }
  const newConstraint = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid='public.care_messages'::regclass AND conname='care_messages_body_length_check'
     ) AS exists`
  );
  if (newConstraint.rows[0]?.exists) {
    throw new Error("Migration 016 constraint already exists without a matching ledger entry; manual schema review is required.");
  }
}

export async function baselineMigrations(
  pool: Pick<Pool, "connect">,
  migrations: Migration[],
  throughFilename: string,
  confirmReviewedSchema: boolean
): Promise<string[]> {
  validateMigrationFiles(migrations);
  if (!confirmReviewedSchema) {
    throw new Error("Baseline requires --confirm-reviewed-schema after comparing the live schema with a disposable reference database.");
  }
  const throughIndex = migrations.findIndex((migration) => migration.filename === throughFilename);
  if (throughIndex < 0) throw new Error(`Unknown baseline target: ${throughFilename}.`);
  const client = await pool.connect();
  let locked = false;
  try {
    await lock(client);
    locked = true;
    if (await migrationLedgerExists(client)) {
      throw new Error("A migration ledger already exists; baseline is only for databases without migration history.");
    }
    if (await publicObjectCount(client) === 0) {
      throw new Error("An empty database must use db:migrate, not the historical baseline command.");
    }
    await verifyBaselineSchema(client, migrations, throughIndex);
    await client.query("BEGIN");
    try {
      await createLedger(client);
      for (const migration of migrations.slice(0, throughIndex + 1)) {
        await client.query(
          `INSERT INTO ${ledgerTable}(filename,checksum) VALUES($1,$2)`,
          [migration.filename, migration.checksum]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    return migrations.slice(0, throughIndex + 1).map((migration) => migration.filename);
  } finally {
    try {
      if (locked) await unlock(client);
    } finally {
      client.release();
    }
  }
}

export async function applyMigrations(
  pool: Pick<Pool, "connect">,
  migrations: Migration[],
  targetFilename?: string
): Promise<string[]> {
  validateMigrationFiles(migrations);
  const targetIndex = targetFilename === undefined
    ? migrations.length - 1
    : migrations.findIndex((migration) => migration.filename === targetFilename);
  if (targetIndex < 0) throw new Error(`Unknown migration target: ${targetFilename}.`);

  const client = await pool.connect();
  let locked = false;
  try {
    await lock(client);
    locked = true;
    await ensureLedger(client);
    await validateLedgerSchema(client);
    const applied = await readAppliedMigrations(client);
    if (!applied.length && await publicObjectCount(client) > 1) {
      throw new Error("The migration ledger is empty but application objects exist; use the reviewed baseline procedure.");
    }
    const lastAppliedIndex = validateAppliedHistory(applied, migrations);
    if (lastAppliedIndex > targetIndex) {
      throw new Error("Migration target is earlier than the database's latest applied migration.");
    }

    const completed: string[] = [];
    for (const migration of migrations.slice(lastAppliedIndex + 1, targetIndex + 1)) {
      await client.query("BEGIN");
      try {
        await preflightMigration(client, migration);
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO ${ledgerTable}(filename,checksum) VALUES($1,$2)`,
          [migration.filename, migration.checksum]
        );
        await client.query("COMMIT");
        completed.push(migration.filename);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return completed;
  } finally {
    try {
      if (locked) await unlock(client);
    } finally {
      client.release();
    }
  }
}
