import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  applyMigrations,
  baselineMigrations,
  createMigration,
  type Migration
} from "../scripts/migration-runner.js";

class MigrationPool {
  ledgerExists = false;
  schemaNonEmpty = false;
  schemaColumns = new Set(["users.email", "auth_sessions.expires_at"]);
  legacyConstraintDefinition = "CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000)))";
  preflightColumns = new Set([
    "care_messages.body",
    "appointment_documents.storage_key",
    "appointment_documents.media_type"
  ]);
  applied: Array<{ filename: string; checksum: string }> = [];
  executedSql: string[] = [];
  failSql: string | undefined;
  private lockTail: Promise<void> = Promise.resolve();

  asPool(): Pick<Pool, "connect"> {
    return this as unknown as Pick<Pool, "connect">;
  }

  async connect() {
    let releaseLock: (() => void) | undefined;
    let snapshot: { applied: Array<{ filename: string; checksum: string }>; executed: string[] } | undefined;
    return {
      query: async <T>(sql: string, values: unknown[] = []) => {
        if (sql.includes("pg_advisory_lock")) {
          const previous = this.lockTail;
          this.lockTail = new Promise<void>((resolve) => { releaseLock = resolve; });
          await previous;
          return { rows: [] as T[] };
        }
        if (sql.includes("pg_advisory_unlock")) {
          releaseLock?.();
          return { rows: [] as T[] };
        }
        if (sql.includes("to_regclass")) {
          return { rows: [{ ledger: this.ledgerExists ? "app_schema_migrations" : null }] as T[] };
        }
        if (sql.includes("FROM pg_class")) {
          return { rows: [{ count: this.schemaNonEmpty ? "2" : "0" }] as T[] };
        }
        if (sql.includes("table_name='app_schema_migrations'")) {
          return {
            rows: [
              { column_name: "filename", data_type: "text", is_nullable: "NO" },
              { column_name: "checksum", data_type: "text", is_nullable: "NO" },
              { column_name: "applied_at", data_type: "timestamp with time zone", is_nullable: "NO" }
            ] as T[]
          };
        }
        if (sql.includes("table_name IN ('care_messages','appointment_documents')")) {
          return {
            rows: [...this.preflightColumns].map((key) => {
              const [table_name, column_name] = key.split(".");
              const data_type = column_name === "storage_key" ? "uuid" : "text";
              return { table_name, column_name, data_type, is_nullable: "NO" };
            }) as T[]
          };
        }
        if (sql.startsWith("SELECT table_name,column_name")) {
          return {
            rows: [...this.schemaColumns].map((key) => {
              const [table_name, column_name] = key.split(".");
              return { table_name, column_name };
            }) as T[]
          };
        }
        if (sql.startsWith("SELECT pg_get_constraintdef")) {
          return { rows: [{ definition: this.legacyConstraintDefinition }] as T[] };
        }
        if (sql.includes("conname='care_messages_body_length_check'")) return { rows: [{ exists: false }] as T[] };
        if (sql.includes("FROM pg_constraint")) {
          return sql.includes("pg_get_constraintdef")
            ? { rows: [{ exists: true }] as T[] }
            : { rows: [] as T[] };
        }
        if (sql.startsWith("CREATE TABLE")) {
          this.ledgerExists = true;
          return { rows: [] as T[] };
        }
        if (sql.startsWith("SELECT filename,checksum")) {
          return { rows: [...this.applied].sort((left, right) => left.filename.localeCompare(right.filename)) as T[] };
        }
        if (sql === "BEGIN") {
          snapshot = {
            applied: this.applied.map((entry) => ({ ...entry })),
            executed: [...this.executedSql]
          };
          return { rows: [] as T[] };
        }
        if (sql === "ROLLBACK") {
          if (snapshot) {
            this.applied = snapshot.applied;
            this.executedSql = snapshot.executed;
          }
          return { rows: [] as T[] };
        }
        if (sql === "COMMIT") return { rows: [] as T[] };
        if (sql.startsWith("INSERT INTO public.app_schema_migrations")) {
          this.applied.push({ filename: String(values[0]), checksum: String(values[1]) });
          return { rows: [] as T[] };
        }
        if (sql.includes("FAIL_MIGRATION")) throw new Error("synthetic migration failure");
        this.executedSql.push(sql);
        return { rows: [] as T[] };
      },
      release() {}
    };
  }
}

const migration = (filename: string, sql: string): Migration => createMigration(filename, sql);

describe("tracked database migrations", () => {
  it("applies each migration once and records its checksum", async () => {
    const pool = new MigrationPool();
    const migrations = [
      migration("001_auth.sql", "CREATE USERS"),
      migration("002_patients.sql", "CREATE PATIENTS")
    ];

    expect(await applyMigrations(pool.asPool(), migrations)).toEqual(["001_auth.sql", "002_patients.sql"]);
    expect(await applyMigrations(pool.asPool(), migrations)).toEqual([]);
    expect(pool.executedSql).toEqual(["CREATE USERS", "CREATE PATIENTS"]);
    expect(pool.applied.map((entry) => entry.filename)).toEqual(["001_auth.sql", "002_patients.sql"]);
    expect(pool.applied[0]?.checksum).toBe(migrations[0]?.checksum);
  });

  it("rolls back a failed migration without recording it", async () => {
    const pool = new MigrationPool();
    const migrations = [
      migration("001_auth.sql", "CREATE USERS"),
      migration("002_patients.sql", "FAIL_MIGRATION")
    ];

    await expect(applyMigrations(pool.asPool(), migrations)).rejects.toThrow("synthetic migration failure");
    expect(pool.applied.map((entry) => entry.filename)).toEqual(["001_auth.sql"]);
    expect(pool.executedSql).toEqual(["CREATE USERS"]);
  });

  it("serializes concurrent runners so a migration executes only once", async () => {
    const pool = new MigrationPool();
    const migrations = [migration("001_auth.sql", "CREATE USERS")];

    const results = await Promise.all([
      applyMigrations(pool.asPool(), migrations),
      applyMigrations(pool.asPool(), migrations)
    ]);

    expect(results.flat()).toEqual(["001_auth.sql"]);
    expect(pool.executedSql).toEqual(["CREATE USERS"]);
  });

  it("refuses to run against a populated database without a reviewed baseline", async () => {
    const pool = new MigrationPool();
    pool.schemaNonEmpty = true;

    await expect(applyMigrations(
      pool.asPool(),
      [migration("001_auth.sql", "CREATE USERS")]
    )).rejects.toThrow("no migration ledger");
    expect(pool.ledgerExists).toBe(false);
    expect(pool.executedSql).toEqual([]);
  });

  it("baselines only a reviewed, schema-verified prefix on a non-empty database", async () => {
    const pool = new MigrationPool();
    pool.schemaNonEmpty = true;
    const migrations = [migration("001_auth.sql", "CREATE USERS")];

    await expect(baselineMigrations(pool.asPool(), migrations, "001_auth.sql", false))
      .rejects.toThrow("--confirm-reviewed-schema");
    expect(pool.ledgerExists).toBe(false);

    const result = await baselineMigrations(pool.asPool(), migrations, "001_auth.sql", true);
    expect(result).toEqual(["001_auth.sql"]);
    expect(pool.applied.map((entry) => entry.filename)).toEqual(["001_auth.sql"]);
    expect(pool.executedSql).toEqual([]);
  });

  it("refuses to baseline when required schema markers are missing", async () => {
    const pool = new MigrationPool();
    pool.schemaNonEmpty = true;
    pool.schemaColumns.delete("users.email");

    await expect(baselineMigrations(
      pool.asPool(),
      [migration("001_auth.sql", "CREATE USERS")],
      "001_auth.sql",
      true
    )).rejects.toThrow("users.email");
    expect(pool.ledgerExists).toBe(false);
  });

  it("executes migration 010's reserved demo verification update only once", async () => {
    const migrationSql = await readFile(new URL("../migrations/010_auth_providers_and_recovery.sql", import.meta.url), "utf8");
    const demoSeed = await readFile(new URL("../seeds/local_demo.sql", import.meta.url), "utf8");
    const pool = new MigrationPool();
    const authMigration = migration("010_auth_providers_and_recovery.sql", migrationSql);

    await applyMigrations(pool.asPool(), [authMigration]);
    await applyMigrations(pool.asPool(), [authMigration]);

    expect(pool.executedSql.filter((sql) => /UPDATE\s+users/i.test(sql))).toHaveLength(1);
    expect(demoSeed).toMatch(/INSERT INTO users[\s\S]*email_verified[\s\S]*true/i);
    expect(demoSeed).toMatch(/ON CONFLICT \(id\) DO UPDATE SET[\s\S]*email_verified = EXCLUDED\.email_verified/i);
  });

  it("preflights migration 016 against its expected base schema", async () => {
    const pool = new MigrationPool();
    const sql = await readFile(new URL("../migrations/016_medical_data_encryption.sql", import.meta.url), "utf8");
    const migration016 = migration("016_medical_data_encryption.sql", sql);

    expect(await applyMigrations(pool.asPool(), [migration016])).toEqual(["016_medical_data_encryption.sql"]);
    expect(pool.applied[0]?.filename).toBe("016_medical_data_encryption.sql");

    const unexpected = new MigrationPool();
    unexpected.preflightColumns.add("care_messages.encryption_version");
    await expect(applyMigrations(unexpected.asPool(), [migration016]))
      .rejects.toThrow("already exist without a matching ledger entry");
    expect(unexpected.applied).toEqual([]);
    expect(unexpected.executedSql).toEqual([]);
  });

  it("refuses migration 016 when the legacy message constraint differs from expectation", async () => {
    const pool = new MigrationPool();
    const sql = await readFile(new URL("../migrations/016_medical_data_encryption.sql", import.meta.url), "utf8");
    const migration016 = migration("016_medical_data_encryption.sql", sql);
    pool.legacyConstraintDefinition = "CHECK (char_length(body) <= 5000)";

    await expect(applyMigrations(pool.asPool(), [migration016]))
      .rejects.toThrow("expected care_messages_body_check");
    expect(pool.applied).toEqual([]);
    expect(pool.executedSql).toEqual([]);
  });
});
