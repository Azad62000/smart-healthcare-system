import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const periodSeconds = 30;

export function createTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function createTotpCode(secret: string, time = Date.now()): { code: string; step: number } {
  const step = Math.floor(time / 1000 / periodSeconds);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return { code: String(binary % 1_000_000).padStart(6, "0"), step };
}

export function verifyTotpCode(secret: string, code: string, time = Date.now()): number | undefined {
  const currentStep = Math.floor(time / 1000 / periodSeconds);
  for (const step of [currentStep - 1, currentStep, currentStep + 1]) {
    if (step < 0) continue;
    const expected = createTotpCode(secret, step * periodSeconds * 1000).code;
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return step;
  }
  return undefined;
}

export function createRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => randomBytes(12).toString("hex").toUpperCase().match(/.{1,4}/g)!.join("-"));
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.replaceAll("-", "").toUpperCase()).digest("hex");
}

export function encryptTotpSecret(secret: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptTotpSecret(encrypted: string, key: Buffer): string {
  const [ivEncoded, tagEncoded, ciphertextEncoded] = encrypted.split(".");
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded) throw new Error("Invalid encrypted Admin MFA secret.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivEncoded, "base64url"));
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, "base64url")), decipher.final()]).toString("utf8");
}

export function createOtpAuthUri(email: string, secret: string): string {
  const issuer = "Smart Healthcare";
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${periodSeconds}`;
}

function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(value: string): Buffer {
  let bits = 0;
  let accumulator = 0;
  const output: number[] = [];
  for (const character of value.toUpperCase().replaceAll("=", "")) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("Invalid TOTP secret.");
    accumulator = (accumulator << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      output.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}
