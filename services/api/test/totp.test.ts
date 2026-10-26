import { describe, expect, it } from "vitest";
import {
  createRecoveryCodes,
  createTotpCode,
  decryptTotpSecret,
  encryptTotpSecret,
  hashRecoveryCode,
  verifyTotpCode
} from "../src/auth/totp.js";

describe("Admin TOTP helpers", () => {
  it("matches the RFC 6238 SHA-1 test vector", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(createTotpCode(secret, 59_000).code).toBe("287082");
    expect(verifyTotpCode(secret, "287082", 59_000)).toBe(1);
    expect(verifyTotpCode(secret, "287083", 59_000)).toBeUndefined();
  });

  it("encrypts TOTP seeds with authenticated encryption and generates one-time recovery codes", () => {
    const key = Buffer.from("a".repeat(64), "hex");
    const encrypted = encryptTotpSecret("JBSWY3DPEHPK3PXP", key);
    expect(decryptTotpSecret(encrypted, key)).toBe("JBSWY3DPEHPK3PXP");
    expect(() => decryptTotpSecret(encrypted, Buffer.alloc(32, 1))).toThrow();
    const recoveryCodes = createRecoveryCodes();
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    expect(hashRecoveryCode(recoveryCodes[0]!)).toBe(hashRecoveryCode(recoveryCodes[0]!.replaceAll("-", "").toLowerCase()));
  });
});
