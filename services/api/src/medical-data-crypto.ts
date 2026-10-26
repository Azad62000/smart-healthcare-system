import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const envelopePrefix = "shc1";

export function messageAdditionalData(conversationId: string, messageId: string, senderUserId: string): string {
  return `smart-healthcare|message|v1|${conversationId}|${messageId}|${senderUserId}`;
}

export function documentAdditionalData(storageKey: string, mediaType: string): string {
  return `smart-healthcare|document|v1|${storageKey}|${mediaType}`;
}

export interface MedicalDataKey {
  id: string;
  key: Buffer;
}

export function parseMedicalDataKeys(value: string): MedicalDataKey[] {
  const entries = value.split(",").map((entry) => entry.trim());
  const ids = new Set<string>();
  const keyMaterials = new Set<string>();
  const keys = entries.map((entry) => {
    const separator = entry.indexOf(":");
    const id = entry.slice(0, separator);
    const encodedKey = entry.slice(separator + 1);
    if (separator < 1 || !/^[A-Za-z0-9_-]{1,32}$/.test(id) ||
        !/^[a-fA-F0-9]{64}$/.test(encodedKey) || ids.has(id) || keyMaterials.has(encodedKey.toLowerCase())) {
      throw new Error("Invalid MEDICAL_DATA_ENCRYPTION_KEYS configuration.");
    }
    ids.add(id);
    keyMaterials.add(encodedKey.toLowerCase());
    return { id, key: Buffer.from(encodedKey, "hex") };
  });
  if (!keys.length) throw new Error("Invalid MEDICAL_DATA_ENCRYPTION_KEYS configuration.");
  return keys;
}

export class MedicalDataCrypto {
  private readonly keysById: Map<string, Buffer>;
  private readonly activeKey: MedicalDataKey;

  constructor(keys: MedicalDataKey[]) {
    if (!keys.length || new Set(keys.map((entry) => entry.id)).size !== keys.length ||
        keys.some((entry) => !/^[A-Za-z0-9_-]{1,32}$/.test(entry.id) || entry.key.length !== 32)) {
      throw new Error("Invalid medical-data encryption keyring.");
    }
    this.activeKey = keys[0]!;
    this.keysById = new Map(keys.map(({ id, key }) => [id, key]));
  }

  static fromConfiguration(value: string): MedicalDataCrypto {
    return new MedicalDataCrypto(parseMedicalDataKeys(value));
  }

  get activeKeyId(): string {
    return this.activeKey.id;
  }

  encryptText(plaintext: string, additionalData: string): string {
    return this.encode(Buffer.from(plaintext, "utf8"), additionalData).toString("utf8");
  }

  decryptText(value: string, additionalData: string, encrypted = value.startsWith(`${envelopePrefix}.`)): string {
    if (!encrypted) return value;
    return this.decode(Buffer.from(value, "utf8"), additionalData).toString("utf8");
  }

  encryptBytes(plaintext: Buffer, additionalData: string): Buffer {
    return this.encode(plaintext, additionalData);
  }

  decryptBytes(value: Buffer, additionalData: string): Buffer {
    return this.decode(value, additionalData);
  }

  keyIdFor(value: string | Buffer): string | undefined {
    const encoded = Buffer.isBuffer(value) ? value.toString("utf8") : value;
    if (!encoded.startsWith(`${envelopePrefix}.`)) return undefined;
    return encoded.split(".", 5)[1];
  }

  private encode(plaintext: Buffer, additionalData: string): Buffer {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.activeKey.key, nonce);
    cipher.setAAD(Buffer.from(additionalData, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.from([
      envelopePrefix,
      this.activeKey.id,
      nonce.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url")
    ].join("."), "utf8");
  }

  private decode(envelope: Buffer, additionalData: string): Buffer {
    const [version, keyId, nonceValue, tagValue, ciphertextValue, ...extra] = envelope.toString("utf8").split(".");
    const key = keyId ? this.keysById.get(keyId) : undefined;
    if (version !== envelopePrefix || !key || !nonceValue || !tagValue || ciphertextValue === undefined ||
        extra.length || !/^[A-Za-z0-9_-]{16}$/.test(nonceValue) ||
        !/^[A-Za-z0-9_-]{22}$/.test(tagValue) ||
        !/^[A-Za-z0-9_-]*$/.test(ciphertextValue)) {
      throw new Error("Medical data could not be authenticated.");
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonceValue, "base64url"));
      decipher.setAAD(Buffer.from(additionalData, "utf8"));
      decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextValue, "base64url")),
        decipher.final()
      ]);
    } catch {
      throw new Error("Medical data could not be authenticated.");
    }
  }
}
