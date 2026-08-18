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

const CREDENTIAL_KEY_PATTERNS = [
  /^app_session_token$/,
  /^manus-runtime-user-info$/,
  /^cf\.sync\./,
] as const;

function associatedData(createdAt: number): string {
  return `cocktail-r:snapshot:v2:${createdAt}`;
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

export async function migrateSnapshotV1ToEncryptedV2(
  snapshot: SnapshotV1,
  crypto: SnapshotV2Crypto,
): Promise<EncryptedSnapshotV2> {
  const { payload, excludedCredentialKeys } = splitSnapshotPayload(snapshot.data);
  const includedKeys = Object.keys(payload).sort();
  const encrypted = await crypto.encrypt(JSON.stringify(payload), associatedData(snapshot.createdAt));

  return {
    schemaVersion: SNAPSHOT_V2_SCHEMA_VERSION,
    createdAt: snapshot.createdAt,
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
  if (snapshot.schemaVersion !== SNAPSHOT_V2_SCHEMA_VERSION) {
    throw new Error("SNAPSHOT_V2_SCHEMA_INVALID");
  }
  if (snapshot.keyId !== crypto.keyId) {
    throw new Error("SNAPSHOT_V2_KEY_UNAVAILABLE");
  }
  if (snapshot.manifest.excludedCredentialKeys.some(isSnapshotCredentialKey) === false && snapshot.manifest.excludedCredentialKeys.length > 0) {
    throw new Error("SNAPSHOT_V2_MANIFEST_INVALID");
  }

  const plaintext = await crypto.decrypt({
    nonce: snapshot.nonce,
    ciphertext: snapshot.ciphertext,
    authenticationTag: snapshot.authenticationTag,
    associatedData: associatedData(snapshot.createdAt),
  });
  const parsed = JSON.parse(plaintext) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("SNAPSHOT_V2_PAYLOAD_INVALID");
  }

  const data = parsed as Record<string, string | null>;
  for (const key of Object.keys(data)) {
    if (isSnapshotCredentialKey(key)) throw new Error("SNAPSHOT_V2_CREDENTIAL_INCLUDED");
  }
  return data;
}
