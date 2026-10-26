import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg, { type PoolClient } from "pg";
import { config } from "../src/config.js";
import { applyMigrations, baselineMigrations, createMigration } from "./migration-runner.js";

const apiDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDirectory = join(apiDirectory, "migrations");
const seedsDirectory = join(apiDirectory, "seeds");
const command = process.argv[2];
const commandArgs = process.argv.slice(3);

function assertLocalDemoDatabase() {
  const databaseName = new URL(config.DATABASE_URL).pathname.replace(/^\/+/, "");
  if (config.NODE_ENV !== "development" || databaseName !== "smart_healthcare") {
    throw new Error("Demo seed/reset is restricted to NODE_ENV=development and database smart_healthcare.");
  }
}

async function runSqlFile(client: PoolClient, filePath: string) {
  const sql = await readFile(filePath, "utf8");
  await client.query(sql);
}

function optionValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return commandArgs.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function validateCommandArgs(): void {
  const validArgs = command === "migrate"
    ? commandArgs.every((arg) => arg.startsWith("--target="))
    : command === "baseline"
      ? commandArgs.every((arg) => arg.startsWith("--through=") || arg === "--confirm-reviewed-schema")
      : commandArgs.length === 0;
  const targetOptions = commandArgs.filter((arg) => arg.startsWith("--target="));
  const throughOptions = commandArgs.filter((arg) => arg.startsWith("--through="));
  if (!validArgs || targetOptions.length > 1 || throughOptions.length > 1) {
    throw new Error("Invalid database command options; see the command usage for supported flags.");
  }
}

async function main() {
  if (!new Set(["migrate", "baseline", "seed-demo", "reset-demo"]).has(command ?? "")) {
    throw new Error(
      "Usage: npm run db:migrate -w @healthcare/api [-- --target=NNN_name.sql] | " +
      "npm run db:baseline -w @healthcare/api -- --through=NNN_name.sql --confirm-reviewed-schema | " +
      "npm run demo:seed | npm run demo:reset -w @healthcare/api"
    );
  }
  validateCommandArgs();
  if (command === "seed-demo" || command === "reset-demo") assertLocalDemoDatabase();

  const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 1 });
  try {
    if (command === "migrate" || command === "baseline") {
      const files = (await readdir(migrationsDirectory))
        .filter((file) => /^\d{3}_[a-z0-9_-]+\.sql$/.test(file))
        .sort();
      const migrations = await Promise.all(files.map(async (filename) =>
        createMigration(filename, await readFile(join(migrationsDirectory, filename), "utf8"))
      ));
      const completed = command === "migrate"
        ? await applyMigrations(pool, migrations, optionValue("target"))
        : await baselineMigrations(
          pool,
          migrations,
          optionValue("through") ?? "",
          commandArgs.includes("--confirm-reviewed-schema")
        );
      for (const filename of completed) {
        process.stdout.write(`${command === "baseline" ? "Baselined" : "Applied"} ${filename}\n`);
      }
      if (!completed.length) process.stdout.write("No pending migrations.\n");
    } else {
      const client = await pool.connect();
      try {
        if (command === "reset-demo") await runSqlFile(client, join(seedsDirectory, "reset_local_demo.sql"));
        await runSqlFile(client, join(seedsDirectory, "local_demo.sql"));
        process.stdout.write(command === "reset-demo" ? "Local demo data reset and reseeded.\n" : "Local demo data seeded.\n");
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message.trim() : "";
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "";
  const safeSummary = message || (code ? `PostgreSQL reported ${code}.` : "The configured PostgreSQL database could not be reached or rejected the command.");
  process.stderr.write(`Database command failed: ${safeSummary}\n`);
  process.exitCode = 1;
});
