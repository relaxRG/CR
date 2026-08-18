import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
    multiGet: vi.fn(async (keys: string[]) => keys.map((key) => [key, storage.get(key) ?? null])),
    multiSet: vi.fn(async (pairs: readonly [string, string][]) => { pairs.forEach(([key, value]) => storage.set(key, value)); }),
    multiRemove: vi.fn(async (keys: string[]) => { keys.forEach((key) => storage.delete(key)); }),
  },
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-file-system/legacy", () => ({}));
vi.mock("expo-sharing", () => ({}));

import {
  configureSnapshotV2Crypto,
  createSnapshot,
  readSnapshot,
  retireVerifiedV1Snapshots,
  restoreFromSnapshot,
  verifySnapshot,
} from "@/lib/backup/local-backup";
import type { SnapshotV2Crypto } from "@/lib/backup/snapshot-v2";

function fakeCrypto(keyId = "native-test-key"): SnapshotV2Crypto {
  const tagFor = (plaintext: string, nonce: string, associatedData: string) => `${keyId}:${nonce}:${associatedData}:${plaintext.length}`;
  return {
    keyId,
    async encrypt(plaintext, associatedData) {
      const nonce = "nonce-12bytes";
      return {
        nonce,
        ciphertext: Buffer.from(plaintext, "utf8").toString("base64"),
        authenticationTag: tagFor(plaintext, nonce, associatedData),
      };
    },
    async decrypt({ nonce, ciphertext, authenticationTag, associatedData }) {
      const plaintext = Buffer.from(ciphertext, "base64").toString("utf8");
      if (authenticationTag !== tagFor(plaintext, nonce, associatedData)) throw new Error("SNAPSHOT_V2_AUTHENTICATION_FAILED");
      return plaintext;
    },
  };
}

describe("Snapshot V1→V2 双写与明文淘汰", () => {
  beforeEach(() => {
    storage.clear();
    configureSnapshotV2Crypto(fakeCrypto());
  });

  it("在原生提供器可用时双写V1/V2，并只在V2认证验证后开启V1淘汰窗口", async () => {
    storage.set("labor_employees_v1", JSON.stringify([{ id: "employee-1", name: "王琪" }]));
    const meta = await createSnapshot();
    const slot = 0;
    const slotMeta = meta.slots[slot];

    expect(slotMeta?.v2State).toBe("verified");
    expect(slotMeta?.v1RetireAt).toBeGreaterThan(slotMeta?.createdAt ?? 0);
    expect(storage.get("backup.snapshot.0")).toBeTruthy();
    expect(storage.get("backup.snapshot.v2.0")).toBeTruthy();
    expect(await verifySnapshot(slot)).toBe(true);
    await expect(readSnapshot(slot)).resolves.toMatchObject({
      data: { labor_employees_v1: storage.get("labor_employees_v1") },
    });
  });

  it("V2认证失败时拒绝恢复且绝不回退写入V1业务数据", async () => {
    storage.set("labor_employees_v1", JSON.stringify([{ id: "employee-a" }]));
    await createSnapshot();
    storage.set("labor_employees_v1", JSON.stringify([{ id: "current-data" }]));
    const encrypted = JSON.parse(storage.get("backup.snapshot.v2.0") ?? "{}");
    encrypted.authenticationTag = "tampered";
    storage.set("backup.snapshot.v2.0", JSON.stringify(encrypted));

    await expect(restoreFromSnapshot(0)).rejects.toThrow("SNAPSHOT_V2_AUTHENTICATION_FAILED");
    expect(storage.get("labor_employees_v1")).toContain("current-data");
  });

  it("仅在V2已验证且30天窗口结束后删除V1明文，同时保持V2可恢复", async () => {
    storage.set("labor_employees_v1", JSON.stringify([{ id: "employee-b" }]));
    const meta = await createSnapshot();
    const retireAt = meta.slots[0]?.v1RetireAt;
    expect(retireAt).toBeTypeOf("number");

    await expect(retireVerifiedV1Snapshots((retireAt ?? 0) + 1)).resolves.toBe(1);
    expect(storage.get("backup.snapshot.0")).toBeUndefined();
    expect(storage.get("backup.snapshot.v2.0")).toBeTruthy();
    await expect(readSnapshot(0)).resolves.toMatchObject({
      data: { labor_employees_v1: storage.get("labor_employees_v1") },
    });
  });
});
