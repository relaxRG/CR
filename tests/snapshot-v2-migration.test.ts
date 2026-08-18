import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decryptSnapshotV2,
  migrateSnapshotV1ToEncryptedV2,
  type SnapshotV2Crypto,
} from "@/lib/backup/snapshot-v2";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cryptoProvider(keyId = "device-key-2026-08"): SnapshotV2Crypto {
  return {
    keyId,
    async encrypt(plaintext, associatedData) {
      const nonce = "test-nonce";
      return {
        nonce,
        ciphertext: Buffer.from(plaintext, "utf8").toString("base64"),
        authenticationTag: hash(`${keyId}|${nonce}|${associatedData}|${plaintext}`),
      };
    },
    async decrypt({ nonce, ciphertext, authenticationTag, associatedData }) {
      const plaintext = Buffer.from(ciphertext, "base64").toString("utf8");
      if (authenticationTag !== hash(`${keyId}|${nonce}|${associatedData}|${plaintext}`)) {
        throw new Error("SNAPSHOT_V2_AUTHENTICATION_FAILED");
      }
      return plaintext;
    },
  };
}

const legacySnapshot = {
  createdAt: 1_786_090_000_000,
  hash: "legacy-hash-is-not-encryption",
  data: {
    "labor_employees_v1": JSON.stringify([{ id: "employee-1", name: "王琪", bankAccount: "6222" }]),
    "monthly_reports_v1": JSON.stringify([{ month: "2026-07", revenue: 282933.28 }]),
    "app_session_token": "session-secret",
    "cf.sync.deviceToken": "device-secret",
    "cf.sync.allowedKeys": JSON.stringify(["labor_employees_v1"]),
    "cf.sync.groupSwitchTicket.switch-a-b": "recovery-secret",
  },
};

describe("Snapshot V2 加密迁移", () => {
  it("迁移时加密业务快照，并永久排除会话、设备和恢复凭据", async () => {
    const encrypted = await migrateSnapshotV1ToEncryptedV2(legacySnapshot, cryptoProvider());

    expect(encrypted.schemaVersion).toBe(2);
    expect(encrypted.keyId).toBe("device-key-2026-08");
    expect(encrypted.manifest.includedKeys).toEqual(["labor_employees_v1", "monthly_reports_v1"]);
    expect(encrypted.manifest.excludedCredentialKeys).toEqual([
      "app_session_token",
      "cf.sync.allowedKeys",
      "cf.sync.deviceToken",
      "cf.sync.groupSwitchTicket.switch-a-b",
    ]);
    expect(encrypted.ciphertext).not.toContain("session-secret");
    expect(encrypted.ciphertext).not.toContain("device-secret");
    expect(encrypted.ciphertext).not.toContain("recovery-secret");
  });

  it("仅使用同一密钥和未被篡改的认证标签才能还原业务数据", async () => {
    const crypto = cryptoProvider();
    const encrypted = await migrateSnapshotV1ToEncryptedV2(legacySnapshot, crypto);

    await expect(decryptSnapshotV2(encrypted, crypto)).resolves.toEqual({
      "labor_employees_v1": legacySnapshot.data["labor_employees_v1"],
      "monthly_reports_v1": legacySnapshot.data["monthly_reports_v1"],
    });
    await expect(decryptSnapshotV2({ ...encrypted, ciphertext: Buffer.from("tampered", "utf8").toString("base64") }, crypto))
      .rejects.toThrow("SNAPSHOT_V2_AUTHENTICATION_FAILED");
    await expect(decryptSnapshotV2(encrypted, cryptoProvider("another-device-key")))
      .rejects.toThrow("SNAPSHOT_V2_KEY_UNAVAILABLE");
  });

  it("拒绝错误版本、伪造凭据排除清单和解密后重新混入的凭据", async () => {
    const crypto = cryptoProvider();
    const encrypted = await migrateSnapshotV1ToEncryptedV2(legacySnapshot, crypto);

    await expect(decryptSnapshotV2({ ...encrypted, schemaVersion: 3 as 2 }, crypto))
      .rejects.toThrow("SNAPSHOT_V2_SCHEMA_INVALID");
    await expect(decryptSnapshotV2({
      ...encrypted,
      manifest: { ...encrypted.manifest, excludedCredentialKeys: ["labor_employees_v1"] },
    }, crypto)).rejects.toThrow("SNAPSHOT_V2_MANIFEST_INVALID");
  });

  it("Web组切换票据不再写入AsyncStorage或localStorage", () => {
    const source = readFileSync("lib/cf-sync/group-switch.ts", "utf8");
    expect(source).toContain("const webRecoveryTickets = new Map<string, string>()");
    expect(source).toContain("webRecoveryTickets.set(switchId, ticket)");
    expect(source).not.toContain("AsyncStorage.setItem(ticketKey(switchId), ticket)");
    expect(source).not.toContain("AsyncStorage.getItem(ticketKey(switchId))");
  });
});
