import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { PublicUser } from "../auth/repository.js";
import { ApiRequestError } from "../request-error.js";
import { MedicalDataCrypto, messageAdditionalData } from "../medical-data-crypto.js";
import type { ChatAccessAction, ChatConversation, ChatMessage, ChatRepository, MessagePage, SendMessageInput } from "./types.js";

interface ConversationRow {
  id: string;
  patient_id: string;
  doctor_id: string;
  participant_id: string;
  participant_name: string;
  specialization: string;
  unread_count: string;
  updated_at: Date;
  last_message_id: string | null;
  last_message_sequence: string | null;
  last_message_sender_id: string | null;
  last_message_sender_role: "Patient" | "Doctor" | null;
  last_message_sender_name: string | null;
  last_message_body: string | null;
  last_message_encryption_version: number | null;
  last_message_created_at: Date | null;
}

interface MessageRow {
  id: string;
  sequence: string;
  conversation_id: string;
  sender_user_id: string;
  sender_role: "Patient" | "Doctor";
  sender_name: string;
  body: string;
  encryption_version: number;
  created_at: Date;
}

const conversationSelect = `
  SELECT c.id,c.patient_id,c.doctor_id,
    CASE WHEN $2='Patient' THEN d.user_id ELSE p.user_id END AS participant_id,
    CASE WHEN $2='Patient' THEN d.given_name || ' ' || d.family_name
         ELSE p.given_name || ' ' || p.family_name END AS participant_name,
    d.specialization,
    COALESCE((SELECT count(*) FROM care_messages unread
      WHERE unread.conversation_id=c.id AND unread.sender_user_id<>$1
        AND unread.sequence>COALESCE(read_state.last_read_sequence,0)),0)::text AS unread_count,
    COALESCE(last_message.created_at,c.updated_at) AS updated_at,
    last_message.id AS last_message_id,last_message.sequence::text AS last_message_sequence,
    last_message.sender_user_id AS last_message_sender_id,
    last_message.sender_role AS last_message_sender_role,
    last_message.sender_name AS last_message_sender_name,
    last_message.body AS last_message_body,last_message.encryption_version AS last_message_encryption_version,
    last_message.created_at AS last_message_created_at
  FROM care_conversations c
  JOIN patients p ON p.user_id=c.patient_id
  JOIN doctors d ON d.id=c.doctor_id
  LEFT JOIN care_conversation_reads read_state
    ON read_state.conversation_id=c.id AND read_state.user_id=$1
  LEFT JOIN LATERAL (
    SELECT m.id,m.sequence,m.sender_user_id,u.role AS sender_role,
      CASE WHEN u.role='Doctor' THEN sender_doctor.given_name || ' ' || sender_doctor.family_name
           ELSE sender_patient.given_name || ' ' || sender_patient.family_name END AS sender_name,
      m.body,m.encryption_version,m.created_at
    FROM care_messages m
    JOIN users u ON u.id=m.sender_user_id
    LEFT JOIN doctors sender_doctor ON sender_doctor.user_id=u.id
    LEFT JOIN patients sender_patient ON sender_patient.user_id=u.id
    WHERE m.conversation_id=c.id ORDER BY m.sequence DESC LIMIT 1
  ) last_message ON true
`;

function mapMessage(row: MessageRow, crypto: MedicalDataCrypto): ChatMessage {
  return {
    id: row.id,
    sequence: Number(row.sequence),
    conversationId: row.conversation_id,
    senderId: row.sender_user_id,
    senderRole: row.sender_role,
    senderName: row.sender_name,
    body: crypto.decryptText(row.body, messageAdditionalData(row.conversation_id, row.id, row.sender_user_id), row.encryption_version === 1),
    createdAt: row.created_at.toISOString()
  };
}

function mapConversation(row: ConversationRow, crypto: MedicalDataCrypto): ChatConversation {
  const lastMessage = row.last_message_id && row.last_message_sequence && row.last_message_sender_id &&
    row.last_message_sender_role && row.last_message_sender_name && row.last_message_body && row.last_message_created_at
    ? {
        id: row.last_message_id,
        sequence: Number(row.last_message_sequence),
        conversationId: row.id,
        senderId: row.last_message_sender_id,
        senderRole: row.last_message_sender_role,
        senderName: row.last_message_sender_name,
        body: crypto.decryptText(
          row.last_message_body,
          messageAdditionalData(row.id, row.last_message_id, row.last_message_sender_id),
          row.last_message_encryption_version === 1
        ),
        createdAt: row.last_message_created_at.toISOString()
      }
    : null;
  return {
    id: row.id,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    participantId: row.participant_id,
    participantName: row.participant_name,
    specialization: row.specialization,
    lastMessage,
    unreadCount: Number(row.unread_count),
    updatedAt: row.updated_at.toISOString()
  };
}

export class PostgresChatRepository implements ChatRepository {
  constructor(private readonly db: Pool, private readonly crypto: MedicalDataCrypto) {}

  private async materializeConversations(user: PublicUser, db: Pool | PoolClient = this.db): Promise<void> {
    if (user.role === "Patient") {
      await db.query(
        `INSERT INTO care_conversations(patient_id,doctor_id)
         SELECT DISTINCT a.patient_id,a.doctor_id FROM appointments a
         WHERE a.patient_id=$1 AND a.status IN ('confirmed','completed')
         ON CONFLICT (patient_id,doctor_id) DO NOTHING`,
        [user.id]
      );
    } else if (user.role === "Doctor") {
      await db.query(
        `INSERT INTO care_conversations(patient_id,doctor_id)
         SELECT DISTINCT a.patient_id,a.doctor_id FROM appointments a
         JOIN doctors d ON d.id=a.doctor_id
         WHERE d.user_id=$1 AND a.status IN ('confirmed','completed')
         ON CONFLICT (patient_id,doctor_id) DO NOTHING`,
        [user.id]
      );
    } else {
      throw new ApiRequestError(403, "FORBIDDEN", "Administrators cannot access patient conversations.");
    }
  }

  private async audit(db: Pool | PoolClient, user: PublicUser, conversationId: string, action: ChatAccessAction, requestId: string) {
    await db.query(
      "INSERT INTO care_conversation_access_events(conversation_id,actor_user_id,action,request_id) VALUES($1,$2,$3,$4)",
      [conversationId, user.id, action, requestId]
    );
  }

  async auditAccess(user: PublicUser, conversationId: string, action: "subscribe", requestId: string) {
    if (!await this.authorizeConversation(user, conversationId)) {
      throw new ApiRequestError(404, "CONVERSATION_NOT_FOUND", "Conversation was not found.");
    }
    await this.audit(this.db, user, conversationId, action, requestId);
  }

  async listConversations(user: PublicUser, requestId: string): Promise<ChatConversation[]> {
    await this.materializeConversations(user);
    const filter = user.role === "Patient" ? "c.patient_id=$1" : "d.user_id=$1";
    const { rows } = await this.db.query<ConversationRow>(
      `${conversationSelect}
       WHERE ${filter} AND EXISTS (
         SELECT 1 FROM appointments a
         WHERE a.patient_id=c.patient_id AND a.doctor_id=c.doctor_id
           AND a.status IN ('confirmed','completed')
       )
       ORDER BY COALESCE(last_message.created_at,c.updated_at) DESC`,
      [user.id, user.role]
    );
    if (rows.length) {
      await this.db.query(
        `INSERT INTO care_conversation_access_events(actor_user_id,conversation_id,action,request_id)
         SELECT $1,ids.conversation_id,'list',$3 FROM unnest($2::uuid[]) AS ids(conversation_id)`,
        [user.id, rows.map((row) => row.id), requestId]
      );
    }
    return rows.map((row) => mapConversation(row, this.crypto));
  }

  private async authorizedConversation(db: Pool | PoolClient, user: PublicUser, conversationId: string, lock = false) {
    const roleFilter = user.role === "Patient" ? "c.patient_id=$2" : "d.user_id=$2";
    const { rows } = await db.query<{ id: string }>(
      `SELECT c.id FROM care_conversations c
       JOIN doctors d ON d.id=c.doctor_id
       WHERE c.id=$1 AND ${roleFilter}
         AND EXISTS (
           SELECT 1 FROM appointments a
           WHERE a.patient_id=c.patient_id AND a.doctor_id=c.doctor_id
             AND a.status IN ('confirmed','completed')
           ${lock ? "FOR SHARE" : ""}
         )
       ${lock ? "FOR SHARE OF c" : ""}`,
      [conversationId, user.id]
    );
    return rows[0];
  }

  async authorizeConversation(user: PublicUser, conversationId: string): Promise<boolean> {
    if (user.role !== "Patient" && user.role !== "Doctor") return false;
    return Boolean(await this.authorizedConversation(this.db, user, conversationId));
  }

  async listMessages(user: PublicUser, conversationId: string, before: number | undefined, limit: number, requestId: string): Promise<MessagePage> {
    if (!await this.authorizeConversation(user, conversationId)) {
      throw new ApiRequestError(404, "CONVERSATION_NOT_FOUND", "Conversation was not found.");
    }
    const { rows } = await this.db.query<MessageRow>(
      `SELECT m.id,m.sequence::text,m.conversation_id,m.sender_user_id,u.role AS sender_role,
        CASE WHEN u.role='Doctor' THEN d.given_name || ' ' || d.family_name
             ELSE p.given_name || ' ' || p.family_name END AS sender_name,
        m.body,m.encryption_version,m.created_at
       FROM care_messages m
       JOIN users u ON u.id=m.sender_user_id
       LEFT JOIN doctors d ON d.user_id=u.id
       LEFT JOIN patients p ON p.user_id=u.id
       WHERE m.conversation_id=$1 AND ($2::bigint IS NULL OR m.sequence<$2)
       ORDER BY m.sequence DESC LIMIT $3`,
      [conversationId, before ?? null, limit + 1]
    );
    await this.audit(this.db, user, conversationId, "history", requestId);
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit).reverse();
    return {
      messages: pageRows.map((row) => mapMessage(row, this.crypto)),
      nextCursor: hasMore && pageRows.length ? Number(pageRows[0]!.sequence) : null,
      hasMore
    };
  }

  async sendMessage(user: PublicUser, input: SendMessageInput, requestId: string): Promise<{ message: ChatMessage; duplicate: boolean }> {
    if (user.role !== "Patient" && user.role !== "Doctor") {
      throw new ApiRequestError(403, "FORBIDDEN", "Administrators cannot send patient messages.");
    }
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      if (!await this.authorizedConversation(client, user, input.conversationId, true)) {
        throw new ApiRequestError(404, "CONVERSATION_NOT_FOUND", "Conversation was not found.");
      }
      const messageId = randomUUID();
      const encryptedBody = this.crypto.encryptText(input.body, messageAdditionalData(input.conversationId, messageId, user.id));
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO care_messages(id,conversation_id,sender_user_id,client_message_id,body,encryption_version)
         VALUES($1,$2,$3,$4,$5,1)
         ON CONFLICT (conversation_id,sender_user_id,client_message_id) DO NOTHING
         RETURNING id`,
        [messageId, input.conversationId, user.id, input.clientMessageId, encryptedBody]
      );
      const duplicate = inserted.rows.length === 0;
      const messageQuery = `SELECT m.id,m.sequence::text,m.conversation_id,m.sender_user_id,m.client_message_id,m.body,m.encryption_version,
          u.role AS sender_role,
          CASE WHEN u.role='Doctor' THEN d.given_name || ' ' || d.family_name
               ELSE p.given_name || ' ' || p.family_name END AS sender_name,
          m.created_at
         FROM care_messages m JOIN users u ON u.id=m.sender_user_id
         LEFT JOIN doctors d ON d.user_id=u.id
         LEFT JOIN patients p ON p.user_id=u.id`;
      const row = inserted.rows[0]
        ? (await client.query<MessageRow>(`${messageQuery} WHERE m.id=$1`, [inserted.rows[0].id])).rows[0]
        : (await client.query<MessageRow & { client_message_id: string }>(
          `${messageQuery}
           WHERE m.conversation_id=$1 AND m.sender_user_id=$2 AND m.client_message_id=$3`,
          [input.conversationId, user.id, input.clientMessageId]
        )).rows[0];
      if (duplicate && row && this.crypto.decryptText(
        row.body,
        messageAdditionalData(row.conversation_id, row.id, row.sender_user_id),
        row.encryption_version === 1
      ) !== input.body) {
        throw new ApiRequestError(409, "IDEMPOTENCY_KEY_REUSED", "This message retry key was already used for different content.");
      }
      await client.query("UPDATE care_conversations SET updated_at=now() WHERE id=$1", [input.conversationId]);
      await client.query(
        `INSERT INTO care_conversation_reads(conversation_id,user_id,last_read_sequence)
         VALUES($1,$2,$3) ON CONFLICT(conversation_id,user_id) DO UPDATE
         SET last_read_sequence=GREATEST(care_conversation_reads.last_read_sequence,EXCLUDED.last_read_sequence),
             updated_at=now()`,
        [input.conversationId, user.id, row!.sequence]
      );
      await this.audit(client, user, input.conversationId, "send", requestId);
      await client.query("COMMIT");
      return { message: mapMessage(row!, this.crypto), duplicate };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markRead(user: PublicUser, conversationId: string, requestId: string): Promise<number> {
    if (user.role !== "Patient" && user.role !== "Doctor") {
      throw new ApiRequestError(403, "FORBIDDEN", "Administrators cannot access patient conversations.");
    }
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      if (!await this.authorizedConversation(client, user, conversationId, true)) {
        throw new ApiRequestError(404, "CONVERSATION_NOT_FOUND", "Conversation was not found.");
      }
      const { rows } = await client.query<{ last_read_sequence: string }>(
        `INSERT INTO care_conversation_reads(conversation_id,user_id,last_read_sequence)
         VALUES($1,$2,COALESCE((SELECT max(sequence) FROM care_messages WHERE conversation_id=$1),0))
         ON CONFLICT(conversation_id,user_id) DO UPDATE SET
           last_read_sequence=GREATEST(care_conversation_reads.last_read_sequence,
             COALESCE((SELECT max(sequence) FROM care_messages WHERE conversation_id=$1),0)),
           updated_at=now()
         RETURNING last_read_sequence::text`,
        [conversationId, user.id]
      );
      await this.audit(client, user, conversationId, "read", requestId);
      await client.query("COMMIT");
      return Number(rows[0]!.last_read_sequence);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
