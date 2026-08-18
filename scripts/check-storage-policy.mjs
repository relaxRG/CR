import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const schemaPath = join(root, "docs/local-storage-schema.json");
const registryPath = join(root, "docs/local-storage-registry.json");
const errors = [];

if (!existsSync(schemaPath) || !existsSync(registryPath)) {
  throw new Error("STORAGE_POLICY_ARTIFACT_MISSING: 先运行 pnpm audit:storage && pnpm generate:storage-registry");
}

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const id = (record) => `${record.backend}|${record.key}`;
const schemaIds = new Set(schema.records.map(id));
const registryIds = new Set(registry.entries.map(id));

for (const record of schema.records) {
  if (!registryIds.has(id(record))) errors.push(`STORAGE_KEY_UNREGISTERED: ${id(record)}`);
}
for (const entry of registry.entries) {
  if (!schemaIds.has(id(entry))) errors.push(`STORAGE_REGISTRY_STALE: ${id(entry)}`);
}

for (const entry of registry.entries) {
  const isCredential = entry.classification === "S2-credential";
  if (isCredential && ["AsyncStorage", "localStorage"].includes(entry.backend)) {
    errors.push(`STORAGE_CREDENTIAL_BACKEND_UNSAFE: ${id(entry)}`);
  }
  if (entry.dynamic && (!entry.ownerFiles?.length || !entry.purgeOn?.length)) {
    errors.push(`STORAGE_DYNAMIC_KEY_GOVERNANCE_MISSING: ${id(entry)}`);
  }
}

const source = [
  "lib/cf-sync/client.ts",
  "lib/cf-sync/group-switch.ts",
  "lib/backup/snapshot-v2.ts",
].map((path) => readFileSync(join(root, path), "utf8")).join("\n");

for (const forbidden of [
  "AsyncStorage.setItem(DEVICE_TOKEN_KEY",
  "localStorage.setItem(DEVICE_TOKEN_KEY",
  "AsyncStorage.setItem(ticketKey(switchId), ticket)",
]) {
  if (source.includes(forbidden)) errors.push(`STORAGE_FORBIDDEN_PERSISTENCE: ${forbidden}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, storageKeys: schema.records.length, dynamicKeys: registry.dynamicEntryCount }, null, 2));
