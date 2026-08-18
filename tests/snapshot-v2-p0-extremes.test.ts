import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();
let failV2ChunkWrite = false;

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      if (failV2ChunkWrite && key === "backup.snapshot.v2.0.chunk.0") {
        failV2ChunkWrite = false;
        throw new Error("INTERRUPTED_V2_CHUNK_WRITE");
      }
      storage.set(key, value);
    }),
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
  getSnapshotMeta,
  readSnapshot,
  recoverPendingSnapshotRestore,
  retireVerifiedV1Snapshots,
} from "@/lib/backup/local-backup";
import {
  createNativeSnapshotV2KeyResolver,
  decryptSnapshotV2,
  migrateSnapshotV1ToEncryptedV2,
  type NativeSnapshotV2KeyProvider,
  type SnapshotV2Crypto,
} from "@/lib/backup/snapshot-v2";

function crypto(keyId = "native-key-a"): SnapshotV2Crypto {
  const tag = (plaintext: string, nonce: string, aad: string) => `${keyId}|${nonce}|${aad}|${plaintext.length}`;
  return {
    keyId,
    async encrypt(plaintext, associatedData) {
      const nonce = "nonce-12bytes";
      return {
        nonce,
        ciphertext: Buffer.from(plaintext, "utf8").toString("base64"),
        authenticationTag: tag(plaintext, nonce, associatedData),
      };
    },
    async decrypt({ nonce, ciphertext, authenticationTag, associatedData }) {
      const plaintext = Buffer.from(ciphertext, "base64").toString("utf8");
      if (authenticationTag !== tag(plaintext, nonce, associatedData)) throw new Error("SNAPSHOT_V2_AUTHENTICATION_FAILED");
      return plaintext;
    },
  };
}

describe("Snapshot V1/V2 P0 极端场景", () => {
  beforeEach(() => {
    storage.clear();
    failV2ChunkWrite = false;
    configureSnapshotV2Crypto(crypto());
  });

  it("旧App覆盖镜像V1元数据后拒绝陈旧V2，且绝不回退读取它", async () => {
    storage.set("labor_employees_v1", JSON.stringify([{ id: "old" }]));
    await createSnapshot();
    const meta = JSON.parse(storage.get("backup.meta") ?? "{}");
    storage.set("labor_employees_v1", JSON.stringify([{ id: "old-app-new-write" }]));
    meta.slots[0].createdAt += 1;
    meta.slots[0].hash = "old-app-overwrite";
    storage.set("backup.meta", JSON.stringify(meta));

    await expect(readSnapshot(0)).rejects.toThrow("SNAPSHOT_V2_MIRROR_STALE");
  });

  it("V2分片写入中断时保留可读V1、清理V2并且不启动淘汰窗口", async () => {
    storage.set("labor_employees_v1", JSON.stringify({ payload: "x".repeat(1_600_000) }));
    failV2ChunkWrite = true;
    const meta = await createSnapshot();

    expect(meta.slots[0]?.v2State).toBe("failed");
    expect(meta.slots[0]?.v1RetireAt).toBeUndefined();
    expect(storage.get("backup.snapshot.v2.0")).toBeUndefined();
    await expect(readSnapshot(0)).resolves.toMatchObject({ data: { labor_employees_v1: expect.any(String) } });
  });

  it("篡改V1镜像哈希（AAD）或nonce都会被AEAD认证拒绝", async () => {
    const source = { createdAt: 100, hash: "source-hash", data: { "labor_employees_v1": "[]" } };
    const encrypted = await migrateSnapshotV1ToEncryptedV2(source, crypto());

    await expect(decryptSnapshotV2({ ...encrypted, source: { ...encrypted.source, hash: "tampered-aad" } }, crypto()))
      .rejects.toThrow("SNAPSHOT_V2_AUTHENTICATION_FAILED");
    await expect(decryptSnapshotV2({ ...encrypted, nonce: "tampered-nonce" }, crypto()))
      .rejects.toThrow("SNAPSHOT_V2_AUTHENTICATION_FAILED");
  });

  it("V2缺失或认证失败时淘汰器保留V1明文快照", async () => {
    storage.set("labor_employees_v1", "[]");
    const meta = await createSnapshot();
    const retireAt = meta.slots[0]?.v1RetireAt ?? 0;
    storage.delete("backup.snapshot.v2.0");

    await expect(retireVerifiedV1Snapshots(retireAt + 1)).resolves.toBe(0);
    expect(storage.get("backup.snapshot.0")).toBeTruthy();
  });

  it("崩溃遗留恢复日志会还原删除前值、删除临时新增值并清理日志", async () => {
    storage.set("labor_employees_v1", "current-corrupted");
    storage.set("cocktail.recipes", "newly-written");
    storage.set("backup.restore.journal.v1", JSON.stringify({
      slot: 0,
      before: { "labor_employees_v1": "before-restore", "cocktail.recipes": null },
    }));

    await expect(recoverPendingSnapshotRestore()).resolves.toBe(true);
    expect(storage.get("labor_employees_v1")).toBe("before-restore");
    expect(storage.get("cocktail.recipes")).toBeUndefined();
    expect(storage.get("backup.restore.journal.v1")).toBeUndefined();
  });

  it("解析器轮换后仍可读取旧key，并拒绝删除活动key", async () => {
    const keyA = crypto("key-a");
    const keyB = crypto("key-b");
    let active = keyA;
    const deleted: string[] = [];
    const provider: NativeSnapshotV2KeyProvider = {
      getActive: async () => active,
      getByKeyId: async (keyId) => keyId === "key-a" ? keyA : keyId === "key-b" ? keyB : null,
      createNext: async () => { active = keyB; return keyB; },
      deleteKey: async (keyId) => { deleted.push(keyId); },
    };
    const resolver = createNativeSnapshotV2KeyResolver(provider);

    await expect(resolver.rotateKey()).resolves.toEqual({ previousKeyId: "key-a", keyId: "key-b" });
    await expect(resolver.getByKeyId("key-a")).resolves.toMatchObject({ keyId: "key-a" });
    await expect(resolver.retireKey("key-b")).rejects.toThrow("SNAPSHOT_V2_ACTIVE_KEY_RETIRE_FORBIDDEN");
    await resolver.retireKey("key-a");
    expect(deleted).toEqual(["key-a"]);
  });
});
