import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const schemaPath = join(root, "docs/local-storage-schema.json");
const outputPath = join(root, "docs/local-storage-registry.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

function ownerFiles(record) {
  return [...new Set(record.calls.map((call) => call.file))].sort();
}

/**
 * 静态审计器无法求值的 SecureStore 参数必须归一为可读的凭据模式，
 * 不能以 `key`、`ticketKey(switchId` 等弱标识进入注册表。
 */
function normalizeRecord(record) {
  const owners = ownerFiles(record);
  if (record.backend !== "SecureStore") return { key: record.key, status: record.status, owners };

  if (owners.includes("lib/cf-sync/client.ts") && record.key === "key") {
    return { key: "cf.sync.{deviceId|groupId|deviceName}", status: "pattern", owners };
  }
  if (owners.includes("lib/cf-sync/group-switch.ts") && record.key.startsWith("ticketKey(")) {
    return { key: "cf.sync.groupSwitchTicket.{switchId}", status: "pattern", owners };
  }
  return { key: record.key, status: record.status, owners };
}

function classify(key, backend) {
  if (/^app_session_token$/.test(key)) return "S2-credential";
  if (backend === "SecureStore" && /^manus-runtime-user-info$/.test(key)) return "S2-credential";
  if (/^cf\.sync\.(deviceToken|groupSwitchTicket\.|\{deviceId\|groupId\|deviceName\})/.test(key)) return "S2-credential";
  if (/^(cf\.sync\.|sync\.|backup\.)/.test(key)) return "S3-diagnostic";
  if (/^manus-runtime-user-info$/.test(key)) return "S1-business";
  if (/^(sync\.|backup\.|.*(?:labor|salary|payslip|employee|supplier|purchase|monthly|report|petty|spirits|wine|food|inventory))/i.test(key)) return "S1-business";
  if (/log|diagnostic|timestamp|lastPulled|dirty|migration/i.test(key)) return "S3-diagnostic";
  return "S0-public";
}

function lifecycle(classification) {
  if (classification === "S2-credential") return ["logout", "leave-group", "switch-complete"];
  if (classification === "S3-diagnostic") return ["startup-ttl", "leave-group"];
  if (classification === "S1-business") return ["leave-group", "version-retirement"];
  return ["version-retirement"];
}

const entries = schema.records
  .map((record) => {
    const normalized = normalizeRecord(record);
    const classification = classify(normalized.key, record.backend);
    return {
      backend: record.backend,
      key: normalized.key,
      status: normalized.status,
      classification,
      ownerFiles: normalized.owners,
      operations: [...new Set(record.calls.map((call) => call.operation))].sort(),
      dynamic: normalized.status !== "resolved",
      purgeOn: lifecycle(classification),
    };
  })
  .sort((a, b) => `${a.backend}|${a.key}`.localeCompare(`${b.backend}|${b.key}`));

const registry = {
  version: 2,
  generatedFrom: "docs/local-storage-schema.json",
  entryCount: entries.length,
  dynamicEntryCount: entries.filter((entry) => entry.dynamic).length,
  entries,
};

writeFileSync(outputPath, `${JSON.stringify(registry, null, 2)}\n`);
console.log(JSON.stringify({ registry: outputPath, entryCount: registry.entryCount, dynamicEntryCount: registry.dynamicEntryCount }, null, 2));
