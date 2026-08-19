import fs from "node:fs";
import path from "node:path";

const root = "/home/ubuntu/cocktail-r-build";
const source = fs.readFileSync(path.join(root, "lib/sync/capabilities.ts"), "utf8");

function readStringArray(name) {
  const match = source.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`));
  if (!match) throw new Error(`Missing ${name} declaration`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function readBusinessTabResources() {
  const match = source.match(/export const BUSINESS_TAB_RESOURCES[\s\S]*?= \{([\s\S]*?)\n\} as const;/);
  if (!match) throw new Error("Missing BUSINESS_TAB_RESOURCES declaration");
  const entries = [...match[1].matchAll(/^\s{2}(\w+):\s*\[([\s\S]*?)\],/gm)];
  const map = Object.fromEntries(entries.map(([, tab, values]) => [
    tab,
    [...values.matchAll(/"([^"]+)"/g)].map((item) => item[1]),
  ]));
  if (Object.keys(map).length !== 5) throw new Error(`Expected 5 business tabs, found ${Object.keys(map).length}`);
  return map;
}

const actions = readStringArray("CAPABILITY_ACTIONS");
const resources = readStringArray("CAPABILITY_RESOURCES");
const tabs = readStringArray("BUSINESS_TABS");
const tabResources = readBusinessTabResources();
const resourceTab = Object.fromEntries(
  Object.entries(tabResources).flatMap(([tab, tabResourceList]) => tabResourceList.map((resource) => [resource, tab])),
);
const map = {};
const pattern = /^\s+"([^"]+)":\s+policy\("([^"]+)",\s*(?:"([^"]+)"|null)\),/gm;
for (const match of source.matchAll(pattern)) {
  const [, key, read, write] = match;
  map[key] = [read, write ?? null];
}
if (Object.keys(map).length < 80) throw new Error(`Expected at least 80 storage policies, found ${Object.keys(map).length}`);

const output = [
  "// Generated from lib/sync/capabilities.ts by scripts/generate-device-policy-v2-worker-map.mjs.",
  "// Do not edit manually; regenerate whenever capabilities or storage policy changes.",
  `const V2_ACTIONS = ${JSON.stringify(actions)};`,
  `const V2_RESOURCES = ${JSON.stringify(resources)};`,
  `const V2_BUSINESS_TABS = ${JSON.stringify(tabs)};`,
  `const V2_BUSINESS_TAB_RESOURCES = ${JSON.stringify(tabResources)};`,
  `const V2_RESOURCE_TAB = ${JSON.stringify(resourceTab)};`,
  "const V2_ALL_CAPABILITIES = V2_RESOURCES.flatMap((resource) => V2_ACTIONS.map((action) => `${resource}.${action}`));",
  "const V2_CAPABILITY_SET = new Set(V2_ALL_CAPABILITIES);",
  "const V2_TAB_GRANT_SET = new Set(V2_BUSINESS_TABS.map((tab) => `${tab}.access`));",
  `const V2_STORAGE_CAPABILITY = ${JSON.stringify(map, null, 2)};`,
  "",
].join("\n");
fs.writeFileSync(path.join(root, "workers/cocktail-ai/device-policy-v2.generated.js"), output);
console.log(`Generated ${tabs.length} business tabs, ${resources.length} resources, ${actions.length} actions and ${Object.keys(map).length} storage policies.`);
