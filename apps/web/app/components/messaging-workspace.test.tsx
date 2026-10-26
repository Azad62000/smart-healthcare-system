import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MessagingWorkspace } from "./messaging-workspace";

const { socket, io } = vi.hoisted(() => {
  const eventHandlers = new Map<string, (payload?: unknown) => void>();
  const socket = {
    connected: false,
    on: vi.fn((event: string, handler: (payload?: unknown) => void) => eventHandlers.set(event, handler)),
    emit: vi.fn(),
    disconnect: vi.fn(),
    timeout: vi.fn(() => ({ emit: vi.fn() })),
    eventHandlers
  };
  return { socket, io: vi.fn(() => socket) };
});

vi.mock("socket.io-client", () => ({ io }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const conversation = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  participantId: "doctor-user",
  participantName: "Synthetic Doctor",
  specialization: "Family Medicine",
  lastMessage: null,
  unreadCount: 0
};

describe("messaging workspace", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    socket.connected = false;
    socket.on.mockClear();
    socket.emit.mockClear();
    socket.disconnect.mockClear();
    io.mockClear();
    socket.eventHandlers.clear();
    vi.stubGlobal("crypto", { randomUUID: () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
  });

  it("loads the authorized conversation and sends through the API while realtime is offline", async () => {
    const storedMessages: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ data: { user: { id: "patient-user", role: "Patient" } } }) });
      if (url.endsWith("/api/v1/chat/conversations")) return Promise.resolve({ ok: true, json: async () => ({ data: { conversations: [{ ...conversation, lastMessage: storedMessages.at(-1) ?? null }] } }) });
      if (url.includes("/messages?")) return Promise.resolve({ ok: true, json: async () => ({ data: { messages: storedMessages, nextCursor: null, hasMore: false } }) });
      if (url.endsWith("/read")) return Promise.resolve({ ok: true, json: async () => ({ data: { lastReadSequence: 0 } }) });
      if (url.endsWith("/messages") && init?.method === "POST") {
        const payload = JSON.parse(String(init.body));
        const message = {
          id: "message-1", sequence: 1, conversationId: conversation.id, senderId: "patient-user",
          senderRole: "Patient", senderName: "Synthetic Patient", body: payload.message,
          createdAt: "2026-10-23T10:00:00.000Z"
        };
        storedMessages.push(message);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              message,
              duplicate: false
            }
          })
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MessagingWorkspace expectedRole="Patient" />);
    expect(await screen.findByRole("heading", { name: "Dr. Synthetic Doctor" })).toBeTruthy();
    expect(screen.getByText("You are offline. Conversation history remains available; messages will use the secure API fallback.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "  Hello care team  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findAllByText("Hello care team")).toHaveLength(2);
    expect(await screen.findByText("Message delivered.")).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:4000/api/v1/chat/conversations/${conversation.id}/messages`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ clientMessageId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", message: "Hello care team" })
      })
    ));
    const connectHandler = socket.eventHandlers.get("connect");
    expect(connectHandler).toBeTruthy();
    socket.connected = true;
    connectHandler?.();
    connectHandler?.();
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/messages?")).length).toBe(2));
    expect(await screen.findAllByText("Hello care team")).toHaveLength(2);
  });
});
