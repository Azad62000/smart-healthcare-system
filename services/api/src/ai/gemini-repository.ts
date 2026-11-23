import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ApiRequestError } from "../request-error.js";
import { geminiChatAdditionalData, MedicalDataCrypto } from "../medical-data-crypto.js";

export type GeminiChatRole = "user" | "assistant";
export interface GeminiChatMessage { id: string; role: GeminiChatRole; content: string; createdAt: string }
export interface GeminiConversation { id: string; createdAt: string; updatedAt: string; preview: string | null }

export interface GeminiChatRepository {
  listConversations(patientId: string): Promise<GeminiConversation[]>;
  listMessages(patientId: string, conversationId: string, limit: number): Promise<GeminiChatMessage[]>;
  recentMessages(patientId: string, conversationId: string | undefined, limit: number): Promise<GeminiChatMessage[]>;
  saveExchange(patientId: string, conversationId: string | undefined, userContent: string, reply: string): Promise<{ conversationId: string; messages: GeminiChatMessage[] }>;
  deleteConversation(patientId: string, conversationId: string): Promise<void>;
}

interface MessageRow { id: string; conversation_id: string; role: GeminiChatRole; content: string; created_at: Date }

export class PostgresGeminiChatRepository implements GeminiChatRepository {
  constructor(private readonly db: Pool, private readonly crypto: MedicalDataCrypto) {}

  private mapMessage(row: MessageRow, patientId: string): GeminiChatMessage {
    return {
      id: row.id, role: row.role,
      content: this.crypto.decryptText(row.content, geminiChatAdditionalData(row.conversation_id, row.id, patientId)),
      createdAt: row.created_at.toISOString()
    };
  }

  async listConversations(patientId: string): Promise<GeminiConversation[]> {
    const { rows } = await this.db.query<{ id: string; created_at: Date; updated_at: Date; message_id: string | null; content: string | null }>(
      `SELECT c.id,c.created_at,c.updated_at,m.id AS message_id,m.content
       FROM gemini_conversations c
       LEFT JOIN LATERAL (SELECT id,content FROM gemini_messages WHERE conversation_id=c.id ORDER BY sequence DESC LIMIT 1) m ON true
       WHERE c.patient_user_id=$1 ORDER BY c.updated_at DESC LIMIT 50`, [patientId]
    );
    return rows.map((row) => ({
      id: row.id, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
      preview: row.message_id && row.content ? this.crypto.decryptText(row.content, geminiChatAdditionalData(row.id, row.message_id, patientId)).slice(0, 160) : null
    }));
  }

  async listMessages(patientId: string, conversationId: string, limit: number): Promise<GeminiChatMessage[]> {
    await this.assertOwner(patientId, conversationId);
    const { rows } = await this.db.query<MessageRow>(
      `SELECT m.id,m.conversation_id,m.role,m.content,m.created_at FROM gemini_messages m
       JOIN gemini_conversations c ON c.id=m.conversation_id
       WHERE c.patient_user_id=$1 AND c.id=$2 ORDER BY m.sequence DESC LIMIT $3`, [patientId, conversationId, limit]
    );
    return rows.reverse().map((row) => this.mapMessage(row, patientId));
  }

  async recentMessages(patientId: string, conversationId: string | undefined, limit: number): Promise<GeminiChatMessage[]> {
    if (!conversationId) return [];
    await this.assertOwner(patientId, conversationId);
    const { rows } = await this.db.query<MessageRow>(
      `SELECT m.id,m.conversation_id,m.role,m.content,m.created_at FROM gemini_messages m
       JOIN gemini_conversations c ON c.id=m.conversation_id
       WHERE c.patient_user_id=$1 AND c.id=$2 ORDER BY m.sequence DESC LIMIT $3`, [patientId, conversationId, limit]
    );
    return rows.reverse().map((row) => this.mapMessage(row, patientId));
  }

  private async assertOwner(patientId: string, conversationId: string): Promise<void> {
    const { rowCount } = await this.db.query("SELECT 1 FROM gemini_conversations WHERE patient_user_id=$1 AND id=$2", [patientId, conversationId]);
    if (rowCount !== 1) throw new ApiRequestError(404, "GEMINI_CONVERSATION_NOT_FOUND", "Conversation was not found.");
  }

  async saveExchange(patientId: string, conversationId: string | undefined, userContent: string, reply: string) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const id = conversationId ?? randomUUID();
      if (conversationId) {
        const { rowCount } = await client.query("SELECT id FROM gemini_conversations WHERE id=$1 AND patient_user_id=$2 FOR UPDATE", [id, patientId]);
        if (rowCount !== 1) throw new ApiRequestError(404, "GEMINI_CONVERSATION_NOT_FOUND", "Conversation was not found.");
      } else {
        await client.query("INSERT INTO gemini_conversations(id,patient_user_id) VALUES($1,$2)", [id, patientId]);
      }
      const messages = [
        await this.insertMessage(client, patientId, id, "user", userContent),
        await this.insertMessage(client, patientId, id, "assistant", reply)
      ];
      await client.query("UPDATE gemini_conversations SET updated_at=now() WHERE id=$1", [id]);
      await client.query("COMMIT");
      return { conversationId: id, messages };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  private async insertMessage(client: PoolClient, patientId: string, conversationId: string, role: GeminiChatRole, content: string): Promise<GeminiChatMessage> {
    const id = randomUUID();
    const encrypted = this.crypto.encryptText(content, geminiChatAdditionalData(conversationId, id, patientId));
    const { rows } = await client.query<MessageRow>(
      `INSERT INTO gemini_messages(id,conversation_id,role,content) VALUES($1,$2,$3,$4)
       RETURNING id,conversation_id,role,content,created_at`, [id, conversationId, role, encrypted]
    );
    return this.mapMessage(rows[0]!, patientId);
  }

  async deleteConversation(patientId: string, conversationId: string): Promise<void> {
    const { rowCount } = await this.db.query("DELETE FROM gemini_conversations WHERE patient_user_id=$1 AND id=$2", [patientId, conversationId]);
    if (rowCount !== 1) throw new ApiRequestError(404, "GEMINI_CONVERSATION_NOT_FOUND", "Conversation was not found.");
  }
}
