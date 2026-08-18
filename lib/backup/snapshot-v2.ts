export const SNAPSHOT_V2_SCHEMA_VERSION = 2 as const;

export type SnapshotV1 = {
  createdAt: number;
  hash: string;
  data: Record<string, string | null>;
};

export type SnapshotV2Manifest = {
  keyCount: number;
  includedKeys: string[];
  excludedCredentialKeys: string[];
};

export type EncryptedSnapshotV2 = {
  schemaVersion: typeof SNAPSHOT_V2_SCHEMA_VERSION;
  createdAt: number;
  /** V2必须绑定其镜像V1的时间与哈希，防止旧App后来覆盖同一V1槽位。 */
  source: Pick<SnapshotV1, "createdAt" | "hash">;
  keyId: string;
  nonce: string;
  ciphertext: string;
  authenticationTag: string;
  manifest: SnapshotV2Manifest;
};

/**
 * 平台密码学实现必须由原生受审查的 AES-GCM 提供器注入。
 * 本模块不自行实现密码算法，也不保存密钥。
 */
export type SnapshotV2Crypto = {
  keyId: string;
  encrypt: (plaintext: string, associatedData: string) => Promise<{
    nonce: string;
    ciphertext: string;
    authenticationTag: string;
  }>;
  decrypt: (input: {
    nonce: string;
    ciphertext: string;
    authenticationTag: string;
    associatedData: string;
  }) => Promise<string>;
};

/**
 * 正式原生提供器的解析与轮换边界。
 * getByKeyId 允许新活动密钥继续读取旧快照；retireKey 只能在本地快照不再引用该key后调用。
 */
export type SnapshotV2KeyResolver = {
  getActive: () => Promise<SnapshotV2Crypto>;
  getByKeyId: (keyId: string) => Promise<SnapshotV2Crypto | null>;
  rotateKey: () => Promise<{ previousKeyId: string; keyId: string }>;
  retireKey: (keyId: string) => Promise<void>;
};

/** 原生桥接实现此接口；密钥字节永远不离开Keychain/Android Keystore。 */
export type NativeSnapshotV2KeyProvider = {
  getActive: () => Promise<SnapshotV2Crypto>;
  getByKeyId: (keyId: string) => Promise<SnapshotV2Crypto | null>;
  createNext: () => Promise<SnapshotV2Crypto>;
  deleteKey: (keyId: string) => Promise<void>;
};

/**
 * 可轮换解析器的通用实现。真正的密钥创建/删除由原生桥接提供，
 * 此处仅维持活动key身份和拒绝删除当前活动key的安全边界。
 */
export function createNativeSnapshotV2KeyResolver(provider: NativeSnapshotV2KeyProvider): SnapshotV2KeyResolver {
  let activeKeyId: string | null = null;

  async function active(): Promise<SnapshotV2Crypto> {
    const crypto = await provider.getActive();
    activeKeyId = crypto.keyId;
    return crypto;
  }

  return {
    getActive: active,
    getByKeyId: async (keyId) => {
      const crypto = await provider.getByKeyId(keyId);
      return crypto?.keyId === keyId ? crypto : null;
    },
    rotateKey: async () => {
      const previous = await active();
      const next = await provider.createNext();
      if (!next.keyId || next.keyId === previous.keyId) throw new Error("SNAPSHOT_V2_KEY_ROTATION_INVALID");
      activeKeyId = next.keyId;
      return { previousKeyId: previous.keyId, keyId: next.keyId };
    },
    retireKey: async (keyId) => {
      if (!activeKeyId) await active();
      if (keyId === activeKeyId) throw new Error("SNAPSHOT_V2_ACTIVE_KEY_RETIRE_FORBIDDEN");
      await provider.deleteKey(keyId);
    },
  };
}

/** 为现有单密钥提供器提供安全兼容适配；不支持轮换或删除。 */
export function createStaticSnapshotV2KeyResolver(crypto: SnapshotV2Crypto): SnapshotV2KeyResolver {
  return {
    getActive: async () => crypto,
    getByKeyId: async (keyId) => keyId === crypto.keyId ? crypto : null,
    rotateKey: async () => { throw new Error("SNAPSHOT_V2_KEY_ROTATION_UNAVAILABLE"); },
    retireKey: async () => { throw new Error("SNAPSHOT_V2_KEY_RETIRE_UNAVAILABLE"); },
  };
}

const CREDENTIAL_KEY_PATTERNS = [
  /^app_session_token$/,
  /^manus-runtime-user-info$/,
  /^cf\.sync\./,
] as const;

export function associatedDataForSnapshotV2(source: Pick<SnapshotV1, "createdAt" | "hash">): string {
  return `cocktail-r:snapshot:v2:${source.createdAt}:${source.hash}`;
}

export function isSnapshotCredentialKey(key: string): boolean {
  return CREDENTIAL_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function splitSnapshotPayload(data: Record<string, string | null>): {
  payload: Record<string, string | null>;
  excludedCredentialKeys: string[];
} {
  const payload: Record<string, string | null> = {};
  const excludedCredentialKeys: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (isSnapshotCredentialKey(key)) {
      excludedCredentialKeys.push(key);
      continue;
    }
    payload[key] = value;
  }

  return { payload, excludedCredentialKeys: excludedCredentialKeys.sort() };
}

function sameSortedValues(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateSnapshotV2Envelope(snapshot: EncryptedSnapshotV2): void {
  if (snapshot.schemaVersion !== SNAPSHOT_V2_SCHEMA_VERSION
    || !snapshot.source
    || snapshot.source.createdAt !== snapshot.createdAt
    || !snapshot.source.hash
    || !snapshot.keyId
    || !snapshot.nonce
    || !snapshot.authenticationTag) {
    throw new Error("SNAPSHOT_V2_SCHEMA_INVALID");
  }
  if (snapshot.manifest.excludedCredentialKeys.some((key) => !isSnapshotCredentialKey(key))) {
    throw new Error("SNAPSHOT_V2_MANIFEST_INVALID");
  }
}

export async function migrateSnapshotV1ToEncryptedV2(
  snapshot: SnapshotV1,
  crypto: SnapshotV2Crypto,
): Promise<EncryptedSnapshotV2> {
  const { payload, excludedCredentialKeys } = splitSnapshotPayload(snapshot.data);
  const includedKeys = Object.keys(payload).sort();
  const encrypted = await crypto.encrypt(JSON.stringify(payload), associatedDataForSnapshotV2(snapshot));

  return {
    schemaVersion: SNAPSHOT_V2_SCHEMA_VERSION,
    createdAt: snapshot.createdAt,
    source: { createdAt: snapshot.createdAt, hash: snapshot.hash },
    keyId: crypto.keyId,
    nonce: encrypted.nonce,
    ciphertext: encrypted.ciphertext,
    authenticationTag: encrypted.authenticationTag,
    manifest: {
      keyCount: includedKeys.length,
      includedKeys,
      excludedCredentialKeys,
    },
  };
}

export async function decryptSnapshotV2(
  snapshot: EncryptedSnapshotV2,
  crypto: SnapshotV2Crypto,
): Promise<Record<string, string | null>> {
  validateSnapshotV2Envelope(snapshot);
  if (snapshot.keyId !== crypto.keyId) throw new Error("SNAPSHOT_V2_KEY_UNAVAILABLE");

  const plaintext = await crypto.decrypt({
    nonce: snapshot.nonce,
    ciphertext: snapshot.ciphertext,
    authenticationTag: snapshot.authenticationTag,
    associatedData: associatedDataForSnapshotV2(snapshot.source),
  });
  const parsed = JSON.parse(plaintext) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("SNAPSHOT_V2_PAYLOAD_INVALID");
  }

  const data = parsed as Record<string, string | null>;
  const includedKeys = Object.keys(data).sort();
  if (Object.keys(data).some(isSnapshotCredentialKey)
    || snapshot.manifest.keyCount !== includedKeys.length
    || !sameSortedValues(snapshot.manifest.includedKeys, includedKeys)) {
    throw new Error("SNAPSHOT_V2_MANIFEST_INVALID");
  }
  return data;
}
