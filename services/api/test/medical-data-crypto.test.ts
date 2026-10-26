import { describe, expect, it } from "vitest";
import {
  MedicalDataCrypto,
  documentAdditionalData,
  messageAdditionalData,
  parseMedicalDataKeys
} from "../src/medical-data-crypto.js";

const primaryKey = "a".repeat(64);
const previousKey = "b".repeat(64);

describe("medical-data encryption", () => {
  it("encrypts and decrypts versioned message and document payloads", () => {
    const crypto = MedicalDataCrypto.fromConfiguration(`active:${primaryKey}`);
    const text = crypto.encryptText("synthetic message", messageAdditionalData("conversation", "message", "sender"));
    const bytes = crypto.encryptBytes(Buffer.from("%PDF-1.7\nsynthetic"), documentAdditionalData("storage", "application/pdf"));

    expect(text).toMatch(/^shc1\.active\./);
    expect(bytes.toString()).toMatch(/^shc1\.active\./);
    expect(crypto.decryptText(text, messageAdditionalData("conversation", "message", "sender"), true)).toBe("synthetic message");
    expect(crypto.decryptBytes(bytes, documentAdditionalData("storage", "application/pdf")).toString()).toBe("%PDF-1.7\nsynthetic");
    expect(text).not.toContain("synthetic message");
    expect(bytes.toString()).not.toContain("%PDF-1.7");
  });

  it("keeps the maximum valid Unicode message envelope within the database limit", () => {
    const crypto = MedicalDataCrypto.fromConfiguration(`active:${primaryKey}`);
    const body = "🙂".repeat(4000);
    const encrypted = crypto.encryptText(body, messageAdditionalData("conversation", "message", "sender"));
    expect(encrypted.length).toBeLessThanOrEqual(30000);
    expect(crypto.decryptText(encrypted, messageAdditionalData("conversation", "message", "sender"), true)).toBe(body);
  });

  it("uses unique nonces and authenticates both ciphertext and record context", () => {
    const crypto = MedicalDataCrypto.fromConfiguration(`active:${primaryKey}`);
    const aad = messageAdditionalData("conversation", "message", "sender");
    const first = crypto.encryptText("same body", aad);
    const second = crypto.encryptText("same body", aad);
    expect(first).not.toBe(second);
    expect(() => crypto.decryptText(first, `${aad}-changed`, true)).toThrow("could not be authenticated");
    const pieces = first.split(".");
    pieces[4] = `${pieces[4]![0] === "A" ? "B" : "A"}${pieces[4]!.slice(1)}`;
    expect(() => crypto.decryptText(pieces.join("."), aad, true)).toThrow("could not be authenticated");
  });

  it("supports key IDs for rotation while preserving legacy plaintext reads", () => {
    const oldCrypto = MedicalDataCrypto.fromConfiguration(`old:${previousKey}`);
    const aad = documentAdditionalData("storage", "application/pdf");
    const oldPayload = oldCrypto.encryptBytes(Buffer.from("legacy fixture"), aad);
    const rotating = MedicalDataCrypto.fromConfiguration(`active:${primaryKey},old:${previousKey}`);

    expect(rotating.decryptBytes(oldPayload, aad).toString()).toBe("legacy fixture");
    expect(rotating.keyIdFor(oldPayload)).toBe("old");
    expect(rotating.decryptText("legacy plaintext", "unused", false)).toBe("legacy plaintext");
    expect(() => MedicalDataCrypto.fromConfiguration(`bad:${primaryKey}`).decryptBytes(oldPayload, aad))
      .toThrow("could not be authenticated");
  });

  it("rejects malformed and duplicate encryption key entries", () => {
    expect(() => parseMedicalDataKeys("invalid")).toThrow("Invalid MEDICAL_DATA_ENCRYPTION_KEYS");
    expect(() => parseMedicalDataKeys(`same:${primaryKey},same:${previousKey}`))
      .toThrow("Invalid MEDICAL_DATA_ENCRYPTION_KEYS");
    expect(() => parseMedicalDataKeys(`first:${primaryKey},second:${primaryKey.toUpperCase()}`))
      .toThrow("Invalid MEDICAL_DATA_ENCRYPTION_KEYS");
    expect(() => parseMedicalDataKeys("key:short")).toThrow("Invalid MEDICAL_DATA_ENCRYPTION_KEYS");
  });
});
