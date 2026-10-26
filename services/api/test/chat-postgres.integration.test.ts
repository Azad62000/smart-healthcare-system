import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { PostgresChatRepository } from "../src/chat/repository.js";
import type { PublicUser } from "../src/auth/repository.js";
import { MedicalDataCrypto } from "../src/medical-data-crypto.js";

const enabled = process.env.RUN_DATABASE_CHAT_TESTS === "true";
const integration = enabled ? describe : describe.skip;

integration("PostgreSQL doctor-patient messaging", () => {
  let pool: Pool;
  let repository: PostgresChatRepository;
  let patient: PublicUser;
  let doctor: PublicUser;
  let doctorId: string;
  let conversationId: string;

  beforeAll(async () => {
    const connectionString = process.env.CHAT_DATABASE_URL ?? config.DATABASE_URL;
    const databaseUrl = new URL(connectionString);
    if (config.NODE_ENV === "production" ||
        !["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname) ||
        databaseUrl.pathname !== "/smart_healthcare") {
      throw new Error(`Messaging DB guard rejected environment=${config.NODE_ENV}, host=${databaseUrl.hostname}, database=${databaseUrl.pathname.slice(1)}.`);
    }
    pool = new Pool({ connectionString });
    repository = new PostgresChatRepository(
      pool,
      MedicalDataCrypto.fromConfiguration(config.MEDICAL_DATA_ENCRYPTION_KEYS)
    );
    const suffix = randomUUID();
    const patientEmail = `chat-patient-${suffix}@example.test`;
    const doctorEmail = `chat-doctor-${suffix}@example.test`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const patientUser = await client.query<{ id: string }>(
        "INSERT INTO users(email,password_hash,role,email_verified) VALUES($1,'synthetic-test-hash','Patient',true) RETURNING id",
        [patientEmail]
      );
      const doctorUser = await client.query<{ id: string }>(
        "INSERT INTO users(email,password_hash,role,email_verified) VALUES($1,'synthetic-test-hash','Doctor',true) RETURNING id",
        [doctorEmail]
      );
      patient = { id: patientUser.rows[0]!.id, email: patientEmail, role: "Patient", status: "active" };
      doctor = { id: doctorUser.rows[0]!.id, email: doctorEmail, role: "Doctor", status: "active" };
      await client.query(
        `INSERT INTO patients(user_id,given_name,family_name,date_of_birth,phone)
         VALUES($1,'Synthetic','Messaging Patient','1990-01-01','5550000000')`,
        [patient.id]
      );
      const doctorProfile = await client.query<{ id: string }>(
        `INSERT INTO doctors(user_id,given_name,family_name,specialization,approval_status)
         VALUES($1,'Synthetic','Messaging Doctor','Family Medicine','approved') RETURNING id`,
        [doctor.id]
      );
      doctorId = doctorProfile.rows[0]!.id;
      const appointment = await client.query<{ id: string }>(
        `INSERT INTO appointments(patient_id,doctor_id,starts_at,ends_at,status,created_by)
         VALUES($1,$2,now()-interval '2 hours',now()-interval '1 hour','completed',$1)
         RETURNING id`,
        [patient.id, doctorId]
      );
      await client.query("COMMIT");
      const conversations = await repository.listConversations(patient, "synthetic-setup");
      conversationId = conversations.find((item) => item.doctorId === doctorId)?.id ?? "";
      if (!conversationId || !appointment.rows[0]?.id) throw new Error("Synthetic messaging conversation was not created.");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (!pool) return;
    if (patient?.id && doctorId) {
      await pool.query("DELETE FROM care_conversations WHERE patient_id=$1 AND doctor_id=$2", [patient.id, doctorId]);
      await pool.query("DELETE FROM appointments WHERE patient_id=$1 AND doctor_id=$2", [patient.id, doctorId]);
      await pool.query("DELETE FROM patients WHERE user_id=$1", [patient.id]);
      await pool.query("DELETE FROM doctors WHERE id=$1", [doctorId]);
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[patient.id, doctor.id]]);
    }
    await pool.end();
  });

  it("persists, deduplicates, paginates and authorizes messages against the real schema", async () => {
    const clientMessageId = randomUUID();
    const message = { conversationId, clientMessageId, body: "Synthetic secure follow-up" };
    const first = await repository.sendMessage(patient, message, "synthetic-send");
    const retry = await repository.sendMessage(patient, message, "synthetic-retry");
    expect(first.duplicate).toBe(false);
    expect(retry.duplicate).toBe(true);
    expect(retry.message.id).toBe(first.message.id);
    const persisted = await pool.query<{ body: string; encryption_version: number }>(
      "SELECT body,encryption_version FROM care_messages WHERE id=$1",
      [first.message.id]
    );
    expect(persisted.rows[0]?.encryption_version).toBe(1);
    expect(persisted.rows[0]?.body).toMatch(/^shc1\./);
    expect(persisted.rows[0]?.body).not.toContain(message.body);
    const doctorPage = await repository.listMessages(doctor, conversationId, undefined, 1, "synthetic-history");
    expect(doctorPage.messages.map((item) => item.body)).toEqual([message.body]);
    expect(await repository.authorizeConversation(patient, conversationId)).toBe(true);
    expect(await repository.authorizeConversation({
      id: randomUUID(), email: "unrelated@example.test", role: "Patient", status: "active"
    }, conversationId)).toBe(false);
    await expect(repository.listMessages({
      id: randomUUID(), email: "unrelated@example.test", role: "Patient", status: "active"
    }, conversationId, undefined, 10, "synthetic-unauthorized-history")).rejects.toMatchObject({ statusCode: 404 });
    expect(await repository.markRead(doctor, conversationId, "synthetic-read")).toBe(first.message.sequence);
    const legacyBody = "Synthetic legacy message";
    const legacyMessageId = randomUUID();
    await pool.query(
      `INSERT INTO care_messages(id,conversation_id,sender_user_id,client_message_id,body,encryption_version)
       VALUES($1,$2,$3,$4,$5,0)`,
      [legacyMessageId, conversationId, patient.id, randomUUID(), legacyBody]
    );
    const legacyHistory = await repository.listMessages(doctor, conversationId, undefined, 1, "synthetic-legacy-history");
    expect(legacyHistory.messages[0]?.body).toBe(legacyBody);

    const encryptedBody = persisted.rows[0]!.body;
    const tampered = encryptedBody.split(".");
    tampered[4] = `${tampered[4]![0] === "A" ? "B" : "A"}${tampered[4]!.slice(1)}`;
    await pool.query("UPDATE care_messages SET body=$2 WHERE id=$1", [first.message.id, tampered.join(".")]);
    try {
      await expect(repository.listMessages(doctor, conversationId, undefined, 100, "synthetic-tampered-history"))
        .rejects.toThrow("could not be authenticated");
    } finally {
      await pool.query("UPDATE care_messages SET body=$2 WHERE id=$1", [first.message.id, encryptedBody]);
    }
    const audit = await pool.query<{ count: string }>(
      "SELECT count(*)::text FROM care_conversation_access_events WHERE conversation_id=$1 AND actor_user_id=ANY($2::uuid[])",
      [conversationId, [patient.id, doctor.id]]
    );
    expect(Number(audit.rows[0]!.count)).toBeGreaterThanOrEqual(4);
    const leakedMessageBody = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM care_conversation_access_events event
       WHERE event.request_id=$1 AND to_jsonb(event)::text LIKE $2`,
      ["synthetic-send", "%Synthetic secure follow-up%"]
    );
    expect(leakedMessageBody.rows[0]!.count).toBe("0");
  });
});
