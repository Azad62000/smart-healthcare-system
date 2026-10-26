import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertMedicalDataMigrationApplied,
  encryptDocumentBatches,
  encryptMessageBatches,
  report,
  rotateDocumentBatches,
  rotateMessageBatches,
  resumeDocumentCleanup,
  type DocumentRow
} from "../scripts/encrypt-medical-data.js";
import { createMigration } from "../scripts/migration-runner.js";
import {
  documentAdditionalData,
  MedicalDataCrypto,
  messageAdditionalData
} from "../src/medical-data-crypto.js";

const messageId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const storageKey = "33333333-3333-4333-8333-333333333333";
const patientId = "44444444-4444-4444-8444-444444444444";
const conversationId = "55555555-5555-4555-8555-555555555555";
const crypto = MedicalDataCrypto.fromConfiguration(`test:${"a".repeat(64)}`);
const rotatingCrypto = MedicalDataCrypto.fromConfiguration(`new:${"b".repeat(64)},old:${"c".repeat(64)}`);
const oldCrypto = MedicalDataCrypto.fromConfiguration(`old:${"c".repeat(64)}`);
const tempDirectories: string[] = [];

class MigrationDatabase {
  messages = [{
    id: messageId,
    sequence: "1",
    conversation_id: conversationId,
    sender_user_id: patientId,
    body: "Synthetic legacy message",
    encryption_version: 0
  }];
  documents: DocumentRow[] = [{
    id: documentId,
    storage_key: storageKey,
    media_type: "application/pdf",
    storage_format: "legacy-plaintext",
    deleted_at: null
  }];
  statements: string[] = [];
  failDocumentUpdateOnce = false;

  async query<T>(sql: string, values: unknown[] = []) {
    this.statements.push(sql);
    if (sql.startsWith("SELECT count(*) FILTER")) {
      return { rows: [{ legacy: String(this.messages.filter((row) => row.encryption_version === 0).length), encrypted: String(this.messages.filter((row) => row.encryption_version === 1).length) }] as T[], rowCount: 1 };
    }
    if (sql.startsWith("SELECT storage_format AS format")) {
      return { rows: [{ format: "legacy-plaintext", deleted: false, count: String(this.documents.length) }] as T[], rowCount: 1 };
    }
    if (sql.startsWith("SELECT id,storage_key,media_type,storage_format,deleted_at")) {
      const threshold = String(values[0] ?? "");
      const format = sql.includes("storage_format='aes-256-gcm-v1'") ? "aes-256-gcm-v1" : "legacy-plaintext";
      const rows = this.documents.filter((row) => row.storage_format === format && row.id > threshold)
        .slice(0, Number(values[1] ?? 100));
      return { rows: rows as T[], rowCount: rows.length };
    }
    if (sql.startsWith("UPDATE appointment_documents")) {
      if (this.failDocumentUpdateOnce) {
        this.failDocumentUpdateOnce = false;
        throw new Error("synthetic interrupted metadata update");
      }
      const row = this.documents.find((item) => item.id === values[0]);
      if (row && row.storage_format === "legacy-plaintext") row.storage_format = "aes-256-gcm-v1";
      return { rows: [] as T[], rowCount: row ? 1 : 0 };
    }
    throw new Error(`Unexpected test SQL: ${sql}`);
  }

  async connect() {
    return {
      query: async <T>(sql: string, values: unknown[] = []) => {
        this.statements.push(sql);
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] as T[], rowCount: 0 };
        if (sql.startsWith("SELECT id,sequence::text,conversation_id,sender_user_id,body")) {
          const rows = this.messages.filter((row) => row.encryption_version === 1 &&
            row.body.split(".")[1] !== values[0] && Number(row.sequence) > Number(values[1]))
            .slice(0, Number(values[2]));
          return { rows: rows as T[], rowCount: rows.length };
        }
        if (sql.startsWith("SELECT id,conversation_id,sender_user_id,body")) {
          const rows = this.messages.filter((row) => row.encryption_version === 0).slice(0, Number(values[0]));
          return { rows: rows as T[], rowCount: rows.length };
        }
        if (sql.startsWith("UPDATE care_messages")) {
          const row = this.messages.find((item) => item.id === values[0]);
          if (row) {
            row.body = String(values[1]);
            if (sql.includes("encryption_version=1 WHERE")) row.encryption_version = 1;
          }
          return { rows: [] as T[], rowCount: row ? 1 : 0 };
        }
        throw new Error(`Unexpected test SQL: ${sql}`);
      },
      release() {}
    };
  }

  asPool(): Pool {
    return this as unknown as Pool;
  }
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("medical-data migration utility", () => {
  it("requires the current migration 016 checksum in the version ledger", async () => {
    const sql = await readFile(new URL("../migrations/016_medical_data_encryption.sql", import.meta.url), "utf8");
    const checksum = createMigration("016_medical_data_encryption.sql", sql).checksum;
    const pool = {
      query: async () => ({ rows: [{ checksum }] })
    } as unknown as Pool;

    await expect(assertMedicalDataMigrationApplied(pool)).resolves.toBeUndefined();
    const stalePool = {
      query: async () => ({ rows: [{ checksum: "0".repeat(64) }] })
    } as unknown as Pool;
    await expect(assertMedicalDataMigrationApplied(stalePool)).rejects.toThrow("Migration 016 is not recorded");
  });

  it("keeps report-only mode read-only", async () => {
    const database = new MigrationDatabase();
    const output: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        output.push(String(chunk));
        callback();
      }
    });

    await report(database.asPool(), true, stream);

    expect(database.statements.every((statement) => statement.trimStart().startsWith("SELECT"))).toBe(true);
    expect(database.messages[0]?.encryption_version).toBe(0);
    expect(database.documents[0]?.storage_format).toBe("legacy-plaintext");
    expect(output.join("")).toContain("Report-only mode");
    expect(output.join("")).toContain("Document counts are metadata-only");
  });

  it("encrypts legacy messages in bounded batches and is idempotent", async () => {
    const database = new MigrationDatabase();

    expect(await encryptMessageBatches(database.asPool(), crypto, 1)).toBe(1);
    expect(database.messages[0]?.encryption_version).toBe(1);
    expect(database.messages[0]?.body).toMatch(/^shc1\.test\./);
    expect(database.messages[0]?.body).not.toContain("Synthetic legacy message");
    expect(crypto.decryptText(
      database.messages[0]!.body,
      messageAdditionalData(conversationId, messageId, patientId),
      true
    )).toBe("Synthetic legacy message");
    expect(await encryptMessageBatches(database.asPool(), crypto, 1)).toBe(0);
  });

  it("rotates old message and document key IDs without changing plaintext", async () => {
    const database = new MigrationDatabase();
    const messageAad = messageAdditionalData(conversationId, messageId, patientId);
    database.messages[0]!.body = oldCrypto.encryptText("Synthetic rotating message", messageAad);
    database.messages[0]!.encryption_version = 1;
    const directory = await mkdtemp(join(tmpdir(), "medical-rotation-"));
    tempDirectories.push(directory);
    const documentBytes = Buffer.from("%PDF-1.7\nSynthetic rotating document");
    const documentAad = documentAdditionalData(storageKey, "application/pdf");
    database.documents[0]!.storage_format = "aes-256-gcm-v1";
    await writeFile(join(directory, `${storageKey}.enc`), oldCrypto.encryptBytes(documentBytes, documentAad), { mode: 0o600 });

    expect(await rotateMessageBatches(database.asPool(), rotatingCrypto, 1)).toBe(1);
    expect(rotatingCrypto.keyIdFor(database.messages[0]!.body)).toBe("new");
    expect(rotatingCrypto.decryptText(database.messages[0]!.body, messageAad, true)).toBe("Synthetic rotating message");
    expect(await rotateDocumentBatches(database.asPool(), rotatingCrypto, directory, 1)).toBe(1);
    const rotatedDocument = await readFile(join(directory, `${storageKey}.enc`));
    expect(rotatingCrypto.keyIdFor(rotatedDocument)).toBe("new");
    expect(rotatingCrypto.decryptBytes(rotatedDocument, documentAad)).toEqual(documentBytes);
  });

  it("resumes an interrupted document conversion and removes plaintext only after verification", async () => {
    const database = new MigrationDatabase();
    const directory = await mkdtemp(join(tmpdir(), "medical-migration-"));
    tempDirectories.push(directory);
    const plaintext = Buffer.from("%PDF-1.7\nSynthetic legacy document");
    const plaintextPath = join(directory, `${storageKey}.pdf`);
    const encryptedPath = join(directory, `${storageKey}.enc`);
    await writeFile(plaintextPath, plaintext, { mode: 0o600 });
    database.failDocumentUpdateOnce = true;

    await expect(encryptDocumentBatches(database.asPool(), crypto, directory, 1)).rejects.toThrow("synthetic interrupted");
    expect(database.documents[0]?.storage_format).toBe("legacy-plaintext");
    expect(await readFile(plaintextPath)).toEqual(plaintext);
    expect((await readFile(encryptedPath)).toString()).toMatch(/^shc1\.test\./);

    expect(await encryptDocumentBatches(database.asPool(), crypto, directory, 1)).toBe(1);
    expect(database.documents[0]?.storage_format).toBe("aes-256-gcm-v1");
    expect(await readFile(plaintextPath).catch(() => undefined)).toBeUndefined();
    const encrypted = await readFile(encryptedPath);
    expect(crypto.decryptBytes(encrypted, documentAdditionalData(storageKey, "application/pdf"))).toEqual(plaintext);
    expect(await encryptDocumentBatches(database.asPool(), crypto, directory, 1)).toBe(0);
  });

  it("cleans up a plaintext sibling left after metadata was switched", async () => {
    const database = new MigrationDatabase();
    const directory = await mkdtemp(join(tmpdir(), "medical-migration-cleanup-"));
    tempDirectories.push(directory);
    const plaintext = Buffer.from("%PDF-1.7\nSynthetic fixture");
    const aad = documentAdditionalData(storageKey, "application/pdf");
    await writeFile(join(directory, `${storageKey}.pdf`), plaintext, { mode: 0o600 });
    await writeFile(join(directory, `${storageKey}.enc`), crypto.encryptBytes(plaintext, aad), { mode: 0o600 });
    database.documents[0]!.storage_format = "aes-256-gcm-v1";

    expect(await resumeDocumentCleanup(database.asPool(), crypto, directory, 1)).toBe(1);
    expect(await readFile(join(directory, `${storageKey}.pdf`)).catch(() => undefined)).toBeUndefined();
    expect(crypto.decryptBytes(await readFile(join(directory, `${storageKey}.enc`)), aad)).toEqual(plaintext);
    expect(await resumeDocumentCleanup(database.asPool(), crypto, directory, 1)).toBe(0);
  });
});
