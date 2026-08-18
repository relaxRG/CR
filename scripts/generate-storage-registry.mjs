import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const schemaPath = join(root, "docs/local-storage-schema.json");
const outputPath = join(root, "docs/local-storage-registry.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

function classify(key) {
  if (/^app_session_token$/.test(key)) return "S2-credential";
  if (/^cf\.sync\.(deviceToken|groupSwitchTicket\.)/.test(key)) return "S2-credential";
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
  .map((record) => ({
    backend: record.backend,
    key: record.key,
    status: record.status,
    classification: classify(record.key),
    ownerFiles: [...new Set(record.calls.map((call) => call.file))].sort(),
    operations: [...new Set(record.calls.map((call) => call.operation))].sort(),
    dynamic: record.status !== "resolved",
    purgeOn: lifecycle(classify(record.key)),
  }))
  .sort((a, b) => `${a.backend}|${a.key}`.localeCompare(`${b.backend}|${b.key}`));

const registry = {
  version: 1,
  generatedFrom: "docs/local-storage-schema.json",
  entryCount: entries.length,
  dynamicEntryCount: entries.filter((entry) => entry.dynamic).length,
  entries,
};

writeFileSync(outputPath, `${JSON.stringify(registry, null, 2)}\n`);
console.log(JSON.stringify({ registry: outputPath, entryCount: registry.entryCount, dynamicEntryCount: registry.dynamicEntryCount }, null, 2));
