import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SYNC_KEYS } from "@/lib/sync/engine";
import { FEATURE_CONTRACTS } from "@/lib/sync/feature-contract";
import { STORAGE_POLICY } from "@/lib/sync/capabilities";
import { LOCAL_ONLY_BUSINESS_STORAGE_BOUNDARIES } from "@/lib/sync/local-business-storage-boundaries";
import { RETIRED_LOCAL_BUSINESS_KEYS } from "@/lib/data/fresh-business-baseline";

const root = process.cwd();
const registry = JSON.parse(readFileSync(join(root, "docs/local-storage-registry.json"), "utf8")) as {
  entries: Array<{ backend: string; key: string; classification: string; status: string }>;
};

const syncKeys = new Set<string>(SYNC_KEYS);
const retiredKeys = new Set<string>(RETIRED_LOCAL_BUSINESS_KEYS);
const localBoundaryKeys = new Set<string>(Object.keys(LOCAL_ONLY_BUSINESS_STORAGE_BOUNDARIES));
const contractOwners = new Map<string, string[]>();
for (const contract of FEATURE_CONTRACTS) {
  for (const key of contract.storageKeys) {
    contractOwners.set(key, [...(contractOwners.get(key) ?? []), contract.id]);
  }
}

const errors: string[] = [];
for (const entry of registry.entries) {
  if (entry.backend !== "AsyncStorage" || entry.classification !== "S1-business" || entry.status !== "resolved") continue;
  const key = entry.key;
  if (retiredKeys.has(key) || localBoundaryKeys.has(key)) continue;
  if (!syncKeys.has(key)) {
    errors.push(`BUSINESS_KEY_NOT_SYNCED: ${key}`);
    continue;
  }
  const owners = contractOwners.get(key) ?? [];
  if (owners.length !== 1) errors.push(`BUSINESS_KEY_CONTRACT_OWNER_INVALID: ${key} (${owners.join(",") || "none"})`);
  if (!(key in STORAGE_POLICY)) errors.push(`BUSINESS_KEY_POLICY_MISSING: ${key}`);
}

for (const key of localBoundaryKeys) {
  if (syncKeys.has(key)) errors.push(`LOCAL_BUSINESS_KEY_MUST_NOT_SYNC: ${key}`);
  if (retiredKeys.has(key)) errors.push(`LOCAL_BUSINESS_KEY_CANNOT_BE_RETIRED: ${key}`);
}

for (const key of syncKeys) {
  const owners = contractOwners.get(key) ?? [];
  if (owners.length !== 1) errors.push(`SYNC_KEY_CONTRACT_OWNER_INVALID: ${key} (${owners.join(",") || "none"})`);
  if (!(key in STORAGE_POLICY)) errors.push(`SYNC_KEY_POLICY_MISSING: ${key}`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  syncedBusinessKeys: [...syncKeys].filter((key) => key in STORAGE_POLICY).length,
  localBusinessExceptions: [...localBoundaryKeys].sort(),
}, null, 2));
