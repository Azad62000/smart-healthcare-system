import type { PublicUser } from "../auth/repository.js";

export interface ChatConversation {
  id: string;
  patientId: string;
  doctorId: string;
  participantId: string;
  participantName: string;
  specialization: string;
  lastMessage: ChatMessage | null;
  unreadCount: number;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sequence: number;
  conversationId: string;
  senderId: string;
  senderRole: "Patient" | "Doctor";
  senderName: string;
  body: string;
  createdAt: string;
}

export interface MessagePage {
  messages: ChatMessage[];
  nextCursor: number | null;
  hasMore: boolean;
}

export interface SendMessageInput {
  conversationId: string;
  clientMessageId: string;
  body: string;
  appointmentId?: string;
}

export type ChatAccessAction = "list" | "history" | "send" | "read" | "subscribe";

export interface ChatRepository {
  listConversations(user: PublicUser, requestId: string): Promise<ChatConversation[]>;
  getAppointmentConversation(user: PublicUser, appointmentId: string, requestId: string): Promise<ChatConversation>;
  authorizeConversation(user: PublicUser, conversationId: string, appointmentId?: string): Promise<boolean>;
  listMessages(user: PublicUser, conversationId: string, before: number | undefined, limit: number, requestId: string, appointmentId?: string): Promise<MessagePage>;
  sendMessage(user: PublicUser, input: SendMessageInput, requestId: string): Promise<{ message: ChatMessage; duplicate: boolean }>;
  markRead(user: PublicUser, conversationId: string, requestId: string, appointmentId?: string): Promise<number>;
  auditAccess(user: PublicUser, conversationId: string, action: "subscribe", requestId: string, appointmentId?: string): Promise<void>;
}
