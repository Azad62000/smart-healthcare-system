import { chmod, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Pool } from "pg";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "../src/config.js";
import { clinicalDataAdditionalData, documentAdditionalData, MedicalDataCrypto, messageAdditionalData } from "../src/medical-data-crypto.js";
import type { DocumentMediaType } from "../src/documents/types.js";
import { createMigration, schemaAndMedicalDataLockId } from "./migration-runner.js";

const crypto = MedicalDataCrypto.fromConfiguration(config.MEDICAL_DATA_ENCRYPTION_KEYS);
const args = new Set(process.argv.slice(2));
const batchArg = process.argv.slice(2).find((arg) => arg.startsWith("--batch-size="));
const batchSize = batchArg ? Number(batchArg.slice("--batch-size=".length)) : 100;
const apply = args.has("--apply");
const rotate = args.has("--rotate");
const allowProduction = args.has("--allow-production");
const confirmBackup = args.has("--confirm-backup");
const extensions: Record<DocumentMediaType, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png"
};
const directory = resolve(config.DOCUMENT_STORAGE_DIR ?? ".private-documents");
const apiDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

class SafeMigrationError extends Error {}

interface MessageRow {
  id: string;
  sequence: string;
  conversation_id: string;
  sender_user_id: string;
  body: string;
}

interface RecordRow { id: string; patient_id: string; doctor_id: string; note: string; diagnosis: string | null; }
interface PrescriptionRow { id: string; patient_id: string; doctor_id: string; medication_name: string; dosage: string; route: string; frequency: string; duration_days: number; instructions: string | null; }
interface DraftRow { appointment_id: string; patient_id: string; doctor_id: string; summary: string; symptoms: string | null; observations: string | null; assessment: string | null; follow_up: string | null; internal_notes: string | null; }

export interface DocumentRow {
  id: string;
  storage_key: string;
  media_type: DocumentMediaType;
  storage_format: "legacy-plaintext" | "aes-256-gcm-v1";
  deleted_at: Date | null;
}

function validateOptions() {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new SafeMigrationError("--batch-size must be an integer between 1 and 1000.");
  }
  if (args.has("--help")) {
    process.stdout.write("Usage: npm run medical-data:encrypt -w @healthcare/api [-- --batch-size=100] [--rotate] [--apply --confirm-backup [--allow-production]]\n");
    process.exit(0);
  }
  if (apply && !confirmBackup) {
    throw new SafeMigrationError("Applying encryption requires --confirm-backup after a verified database and private-file backup.");
  }
  if (apply && config.NODE_ENV === "production" && !allowProduction) {
    throw new SafeMigrationError("Production conversion requires the additional --allow-production acknowledgement.");
  }
  if (!apply && (allowProduction || confirmBackup)) {
    throw new SafeMigrationError("Acknowledgement flags are valid only with --apply.");
  }
}

function assertLocalDatabase() {
  const database = new URL(config.DATABASE_URL);
  if (config.NODE_ENV === "production" && allowProduction) return;
  if (config.NODE_ENV !== "development") {
    throw new SafeMigrationError("Applying migration is restricted to development unless both production acknowledgements are supplied.");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(database.hostname) ||
      database.pathname !== "/smart_healthcare") {
    throw new SafeMigrationError("Medical-data migration is restricted to the local smart_healthcare database unless explicitly acknowledged for production.");
  }
}

export async function assertMedicalDataMigrationApplied(pool: Pool): Promise<void> {
  for (const filename of ["016_medical_data_encryption.sql", "022_clinical_data_encryption.sql"]) {
    const migration = createMigration(filename, await readFile(join(apiDirectory, "migrations", filename), "utf8"));
    const { rows } = await pool.query<{ checksum: string }>("SELECT checksum FROM public.app_schema_migrations WHERE filename=$1", [filename]);
    if (rows[0]?.checksum !== migration.checksum) {
      throw new SafeMigrationError(`Migration ${filename.slice(0, 3)} is not recorded with the current checksum; run the reviewed schema migration process first.`);
    }
  }
}

export async function report(pool: Pool, dryRun = !apply, output: NodeJS.WritableStream = process.stdout) {
  const [messages, documents, records, prescriptions, drafts] = await Promise.all([
    pool.query<{ legacy: string; encrypted: string }>(
      `SELECT count(*) FILTER (WHERE encryption_version=0)::text AS legacy,
              count(*) FILTER (WHERE encryption_version=1)::text AS encrypted
       FROM care_messages`
    ),
    pool.query<{ format: string; deleted: boolean; count: string }>(
      `SELECT storage_format AS format,(deleted_at IS NOT NULL) AS deleted,count(*)::text AS count
       FROM appointment_documents GROUP BY storage_format,(deleted_at IS NOT NULL)`
    ),
    pool.query<{ legacy: string; encrypted: string }>("SELECT count(*) FILTER (WHERE encryption_version=0)::text AS legacy,count(*) FILTER (WHERE encryption_version=1)::text AS encrypted FROM consultation_records"),
    pool.query<{ legacy: string; encrypted: string }>("SELECT count(*) FILTER (WHERE encryption_version=0)::text AS legacy,count(*) FILTER (WHERE encryption_version=1)::text AS encrypted FROM prescriptions"),
    pool.query<{ legacy: string; encrypted: string }>("SELECT count(*) FILTER (WHERE encryption_version=0)::text AS legacy,count(*) FILTER (WHERE encryption_version=1)::text AS encrypted FROM consultation_note_drafts")
  ]);
  output.write(`Messages: ${messages.rows[0]?.legacy ?? "0"} plaintext, ${messages.rows[0]?.encrypted ?? "0"} encrypted.\n`);
  output.write(`Clinical records: ${records.rows[0]?.legacy ?? "0"} plaintext, ${records.rows[0]?.encrypted ?? "0"} encrypted.\n`);
  output.write(`Prescriptions: ${prescriptions.rows[0]?.legacy ?? "0"} plaintext, ${prescriptions.rows[0]?.encrypted ?? "0"} encrypted.\n`);
  output.write(`Consultation drafts: ${drafts.rows[0]?.legacy ?? "0"} plaintext, ${drafts.rows[0]?.encrypted ?? "0"} encrypted.\n`);
  const totals = new Map<string, number>();
  for (const row of documents.rows) {
    const key = `${row.format}${row.deleted ? " (soft-deleted)" : ""}`;
    totals.set(key, Number(row.count));
  }
  output.write(`Documents: ${[...totals.entries()].map(([format, count]) => `${count} ${format}`).join(", ") || "0 records"}.\n`);
  output.write("Document counts are metadata-only; file existence and contents were not checked.\n");
  if (rotate) {
    const oldMessages = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM care_messages WHERE encryption_version=1 AND split_part(body,'.',2)<>$1",
      [crypto.activeKeyId]
    );
    const oldRecords = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM consultation_records WHERE encryption_version=1 AND split_part(note,'.',2)<>$1", [crypto.activeKeyId]);
    const oldPrescriptions = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM prescriptions WHERE encryption_version=1 AND split_part(medication_name,'.',2)<>$1", [crypto.activeKeyId]);
    const oldDrafts = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM consultation_note_drafts WHERE encryption_version=1 AND split_part(summary,'.',2)<>$1", [crypto.activeKeyId]);
    let oldDocuments = 0;
    let verifiedDocuments = 0;
    let cursor = "";
    while (true) {
      const { rows } = await pool.query<DocumentRow>(
        `SELECT id,storage_key,media_type,storage_format,deleted_at FROM appointment_documents
         WHERE storage_format='aes-256-gcm-v1' AND id::text>$1 ORDER BY id LIMIT $2`,
        [cursor, batchSize]
      );
      if (!rows.length) break;
      for (const row of rows) {
        cursor = row.id;
        try {
          const content = await readFile(`${directory}/${row.storage_key}.enc`);
          crypto.decryptBytes(content, documentAdditionalData(row.storage_key, row.media_type));
          verifiedDocuments += 1;
          if (crypto.keyIdFor(content) !== crypto.activeKeyId) oldDocuments += 1;
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT" && row.deleted_at)) {
            throw new SafeMigrationError("Could not inspect encrypted document key versions.");
          }
        }
      }
    }
    output.write(
      `Rotation candidates by key ID: ${oldMessages.rows[0]?.count ?? "0"} messages, ${oldRecords.rows[0]?.count ?? "0"} records, ` +
      `${oldPrescriptions.rows[0]?.count ?? "0"} prescriptions, ${oldDrafts.rows[0]?.count ?? "0"} consultation drafts, ${oldDocuments} documents using non-active keys; ` +
      `${verifiedDocuments} encrypted document files authenticated.\n`
    );
  }
  if (dryRun) output.write("Report-only mode: no database rows or files were changed.\n");
}

export async function encryptMessageBatches(pool: Pool, encryption = crypto, size = batchSize) {
  let converted = 0;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<MessageRow>(
        `SELECT id,conversation_id,sender_user_id,body FROM care_messages
         WHERE encryption_version=0 ORDER BY sequence LIMIT $1 FOR UPDATE`,
        [size]
      );
      if (!rows.length) {
        await client.query("COMMIT");
        break;
      }
      for (const row of rows) {
        const body = encryption.encryptText(row.body, messageAdditionalData(row.conversation_id, row.id, row.sender_user_id));
        await client.query(
          "UPDATE care_messages SET body=$2,encryption_version=1 WHERE id=$1 AND encryption_version=0",
          [row.id, body]
        );
      }
      await client.query("COMMIT");
      converted += rows.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return converted;
}

export async function rotateMessageBatches(pool: Pool, encryption = crypto, size = batchSize) {
  let converted = 0;
  let cursor = "0";
  while (true) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<MessageRow>(
        `SELECT id,sequence::text,conversation_id,sender_user_id,body FROM care_messages
         WHERE encryption_version=1 AND split_part(body,'.',2)<>$1 AND sequence>$2
         ORDER BY sequence LIMIT $3 FOR UPDATE`,
        [encryption.activeKeyId, cursor, size]
      );
      if (!rows.length) {
        await client.query("COMMIT");
        break;
      }
      for (const row of rows) {
        cursor = row.sequence;
        const aad = messageAdditionalData(row.conversation_id, row.id, row.sender_user_id);
        const plaintext = encryption.decryptText(row.body, aad, true);
        const encrypted = encryption.encryptText(plaintext, aad);
        await client.query(
          "UPDATE care_messages SET body=$2 WHERE id=$1 AND encryption_version=1",
          [row.id, encrypted]
        );
      }
      await client.query("COMMIT");
      converted += rows.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return converted;
}

export async function encryptClinicalDataBatches(pool: Pool, encryption = crypto, size = batchSize) {
  let recordsConverted = 0;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<RecordRow>(
        "SELECT id,patient_id,doctor_id,note,diagnosis FROM consultation_records WHERE encryption_version=0 ORDER BY id LIMIT $1 FOR UPDATE",
        [size]
      );
      if (!rows.length) { await client.query("COMMIT"); break; }
      for (const row of rows) {
        const payload = encryption.encryptText(JSON.stringify({ note: row.note, diagnosis: row.diagnosis }), clinicalDataAdditionalData("record", row.id, row.patient_id, row.doctor_id));
        await client.query("UPDATE consultation_records SET note=$2,diagnosis=NULL,encryption_version=1 WHERE id=$1 AND encryption_version=0", [row.id, payload]);
      }
      await client.query("COMMIT");
      recordsConverted += rows.length;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  let prescriptionsConverted = 0;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<PrescriptionRow>(
        `SELECT id,patient_id,doctor_id,medication_name,dosage,route,frequency,duration_days,instructions
         FROM prescriptions WHERE encryption_version=0 ORDER BY id LIMIT $1 FOR UPDATE`, [size]
      );
      if (!rows.length) { await client.query("COMMIT"); break; }
      for (const row of rows) {
        const payload = encryption.encryptText(JSON.stringify({ medicationName: row.medication_name, dosage: row.dosage, route: row.route, frequency: row.frequency, durationDays: row.duration_days, instructions: row.instructions }), clinicalDataAdditionalData("prescription", row.id, row.patient_id, row.doctor_id));
        await client.query("UPDATE prescriptions SET medication_name=$2,dosage='encrypted',route='encrypted',frequency='encrypted',duration_days=1,instructions=NULL,encryption_version=1 WHERE id=$1 AND encryption_version=0", [row.id, payload]);
      }
      await client.query("COMMIT");
      prescriptionsConverted += rows.length;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  let draftsConverted = 0;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<DraftRow>(
        `SELECT appointment_id,patient_id,doctor_id,summary,symptoms,observations,assessment,follow_up,internal_notes
         FROM consultation_note_drafts WHERE encryption_version=0 ORDER BY appointment_id LIMIT $1 FOR UPDATE`, [size]
      );
      if (!rows.length) { await client.query("COMMIT"); break; }
      for (const row of rows) {
        const payload = encryption.encryptText(JSON.stringify({ summary: row.summary, symptoms: row.symptoms, observations: row.observations, assessment: row.assessment, followUp: row.follow_up, internalNotes: row.internal_notes }), clinicalDataAdditionalData("consultation-draft", row.appointment_id, row.patient_id, row.doctor_id));
        await client.query("UPDATE consultation_note_drafts SET summary=$2,symptoms=NULL,observations=NULL,assessment=NULL,follow_up=NULL,internal_notes=NULL,encryption_version=1 WHERE appointment_id=$1 AND encryption_version=0", [row.appointment_id, payload]);
      }
      await client.query("COMMIT");
      draftsConverted += rows.length;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  return { records: recordsConverted, prescriptions: prescriptionsConverted, drafts: draftsConverted };
}

export async function rotateClinicalDataBatches(pool: Pool, encryption = crypto, size = batchSize) {
  let rotatedRecords = 0;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<RecordRow>("SELECT id,patient_id,doctor_id,note,diagnosis FROM consultation_records WHERE encryption_version=1 AND split_part(note,'.',2)<>$1 ORDER BY id LIMIT $2 FOR UPDATE", [encryption.activeKeyId, size]);
      if (!rows.length) { await client.query("COMMIT"); break; }
      for (const row of rows) {
        const aad = clinicalDataAdditionalData("record", row.id, row.patient_id, row.doctor_id);
        const value = JSON.parse(encryption.decryptText(row.note, aad, true)) as { note: string; diagnosis: string | null };
        await client.query("UPDATE consultation_records SET note=$2 WHERE id=$1", [row.id, encryption.encryptText(JSON.stringify(value), aad)]);
      }
      await client.query("COMMIT");
      rotatedRecords += rows.length;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  let rotatedPrescriptions = 0;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<PrescriptionRow>("SELECT id,patient_id,doctor_id,medication_name,dosage,route,frequency,duration_days,instructions FROM prescriptions WHERE encryption_version=1 AND split_part(medication_name,'.',2)<>$1 ORDER BY id LIMIT $2 FOR UPDATE", [encryption.activeKeyId, size]);
      if (!rows.length) { await client.query("COMMIT"); break; }
      for (const row of rows) {
        const aad = clinicalDataAdditionalData("prescription", row.id, row.patient_id, row.doctor_id);
        const value = JSON.parse(encryption.decryptText(row.medication_name, aad, true));
        await client.query("UPDATE prescriptions SET medication_name=$2 WHERE id=$1", [row.id, encryption.encryptText(JSON.stringify(value), aad)]);
      }
      await client.query("COMMIT");
      rotatedPrescriptions += rows.length;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  let rotatedDrafts = 0;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<DraftRow>("SELECT appointment_id,patient_id,doctor_id,summary,symptoms,observations,assessment,follow_up,internal_notes FROM consultation_note_drafts WHERE encryption_version=1 AND split_part(summary,'.',2)<>$1 ORDER BY appointment_id LIMIT $2 FOR UPDATE", [encryption.activeKeyId, size]);
      if (!rows.length) { await client.query("COMMIT"); break; }
      for (const row of rows) {
        const aad = clinicalDataAdditionalData("consultation-draft", row.appointment_id, row.patient_id, row.doctor_id);
        const value = JSON.parse(encryption.decryptText(row.summary, aad, true));
        await client.query("UPDATE consultation_note_drafts SET summary=$2 WHERE appointment_id=$1", [row.appointment_id, encryption.encryptText(JSON.stringify(value), aad)]);
      }
      await client.query("COMMIT");
      rotatedDrafts += rows.length;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  return { records: rotatedRecords, prescriptions: rotatedPrescriptions, drafts: rotatedDrafts };
}

export async function convertDocument(
  pool: Pool,
  row: DocumentRow,
  encryption = crypto,
  documentDirectory = directory
) {
  if (!/^[0-9a-f-]{36}$/i.test(row.storage_key)) throw new SafeMigrationError("Invalid document storage key in metadata.");
  const plaintextPath = `${documentDirectory}/${row.storage_key}${extensions[row.media_type]}`;
  const encryptedPath = `${documentDirectory}/${row.storage_key}.enc`;
  const temporaryPath = `${encryptedPath}.migrating`;
  let plaintext: Buffer;
  try {
    plaintext = await readFile(plaintextPath);
  } catch (error) {
    if (row.deleted_at && error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw new SafeMigrationError("A referenced legacy document file is unavailable; conversion stopped without changing its metadata.");
  }
  const aad = documentAdditionalData(row.storage_key, row.media_type);
  const encrypted = encryption.encryptBytes(plaintext, aad);
  if (!encryption.decryptBytes(encrypted, aad).equals(plaintext)) {
    throw new SafeMigrationError("Encrypted document verification failed; conversion stopped.");
  }
  await rm(temporaryPath, { force: true });
  try {
    await writeFile(temporaryPath, encrypted, { flag: "wx", mode: 0o600 });
    await rename(temporaryPath, encryptedPath);
    await chmod(encryptedPath, 0o600);
    const updated = await pool.query(
      "UPDATE appointment_documents SET storage_format='aes-256-gcm-v1' WHERE id=$1 AND storage_format='legacy-plaintext'",
      [row.id]
    );
    if (updated.rowCount !== 1) throw new SafeMigrationError("Document metadata changed during conversion; the legacy file was preserved.");
    await rm(plaintextPath, { force: true });
    return true;
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function resumeDocumentCleanup(pool: Pool, encryption = crypto, documentDirectory = directory, size = batchSize) {
  let cleaned = 0;
  let cursor = "";
  while (true) {
    const { rows } = await pool.query<DocumentRow>(
      `SELECT id,storage_key,media_type,storage_format,deleted_at FROM appointment_documents
       WHERE storage_format='aes-256-gcm-v1' AND id::text>$1 ORDER BY id LIMIT $2`,
      [cursor, size]
    );
    if (!rows.length) break;
    for (const row of rows) {
      cursor = row.id;
      const oldPath = `${documentDirectory}/${row.storage_key}${extensions[row.media_type]}`;
      let legacyExists = true;
      try {
        await stat(oldPath);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") legacyExists = false;
        else throw new SafeMigrationError("Legacy document file could not be checked for cleanup.");
      }
      if (!legacyExists) continue;
      try {
        const encryptedBytes = await readFile(`${documentDirectory}/${row.storage_key}.enc`);
        encryption.decryptBytes(encryptedBytes, documentAdditionalData(row.storage_key, row.media_type));
        await rm(oldPath);
        cleaned += 1;
      } catch (error) {
        throw new SafeMigrationError("Encrypted document verification or legacy-file cleanup failed.");
      }
    }
  }
  return cleaned;
}

export async function encryptDocumentBatches(
  pool: Pool,
  encryption = crypto,
  documentDirectory = directory,
  size = batchSize
) {
  let converted = 0;
  let cursor = "";
  while (true) {
    const { rows } = await pool.query<DocumentRow>(
      `SELECT id,storage_key,media_type,storage_format,deleted_at FROM appointment_documents
       WHERE storage_format='legacy-plaintext' AND id::text>$1 ORDER BY id LIMIT $2`,
      [cursor, size]
    );
    if (!rows.length) break;
    for (const row of rows) {
      cursor = row.id;
      if (await convertDocument(pool, row, encryption, documentDirectory)) converted += 1;
    }
  }
  return converted;
}

export async function rotateDocumentBatches(
  pool: Pool,
  encryption = crypto,
  documentDirectory = directory,
  size = batchSize
) {
  let rotated = 0;
  let cursor = "";
  while (true) {
    const { rows } = await pool.query<DocumentRow>(
      `SELECT id,storage_key,media_type,storage_format,deleted_at FROM appointment_documents
       WHERE storage_format='aes-256-gcm-v1' AND id::text>$1 ORDER BY id LIMIT $2`,
      [cursor, size]
    );
    if (!rows.length) break;
    for (const row of rows) {
      cursor = row.id;
      const path = `${documentDirectory}/${row.storage_key}.enc`;
      const tempPath = `${path}.rotating`;
      let existing: Buffer;
      try { existing = await readFile(path); }
      catch (error) {
        if (row.deleted_at && error instanceof Error && "code" in error && error.code === "ENOENT") continue;
        throw new SafeMigrationError("A referenced encrypted document is unavailable; rotation stopped.");
      }
      if (encryption.keyIdFor(existing) === encryption.activeKeyId) continue;
      const aad = documentAdditionalData(row.storage_key, row.media_type);
      const plaintext = encryption.decryptBytes(existing, aad);
      const replacement = encryption.encryptBytes(plaintext, aad);
      if (!encryption.decryptBytes(replacement, aad).equals(plaintext)) {
        throw new SafeMigrationError("Rotated document verification failed.");
      }
      await rm(tempPath, { force: true });
      try {
        await writeFile(tempPath, replacement, { flag: "wx", mode: 0o600 });
        await rename(tempPath, path);
        await chmod(path, 0o600);
      } catch (error) {
        await rm(tempPath, { force: true });
        throw error;
      }
      rotated += 1;
    }
  }
  return rotated;
}

async function main() {
  validateOptions();
  if (apply) assertLocalDatabase();
  const pool = new Pool({ connectionString: config.DATABASE_URL, max: 2 });
  const lock = await pool.connect();
  try {
    const lockResult = await lock.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS locked",
      [schemaAndMedicalDataLockId]
    );
    if (!lockResult.rows[0]?.locked) throw new SafeMigrationError("Another medical-data migration is already running.");
    await assertMedicalDataMigrationApplied(pool);
    await report(pool);
    if (!apply) return;
    if (rotate) {
      const messages = await rotateMessageBatches(pool);
      const clinical = await rotateClinicalDataBatches(pool);
      const documents = await rotateDocumentBatches(pool);
      process.stdout.write(`Rotated ${messages} messages, ${clinical.records} records, ${clinical.prescriptions} prescriptions, ${clinical.drafts} consultation drafts, and ${documents} documents to active key ${crypto.activeKeyId}.\n`);
      return;
    }
    const messages = await encryptMessageBatches(pool);
    const clinical = await encryptClinicalDataBatches(pool);
    const documents = await encryptDocumentBatches(pool);
    const cleanedDocuments = await resumeDocumentCleanup(pool);
    process.stdout.write(`Converted ${messages} messages, ${clinical.records} records, ${clinical.prescriptions} prescriptions, ${clinical.drafts} consultation drafts, and ${documents} documents; removed ${cleanedDocuments} verified legacy document files.\n`);
  } finally {
    await lock.query("SELECT pg_advisory_unlock($1::bigint)", [schemaAndMedicalDataLockId]);
    lock.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "";
    const message = error instanceof SafeMigrationError ? error.message
      : code ? `Operation failed with code ${code}; diagnostic details were withheld.`
      : "Operation failed; diagnostic details were withheld to avoid logging medical data.";
    process.stderr.write(`Medical-data encryption command failed: ${message}\n`);
    process.exitCode = 1;
  });
}
