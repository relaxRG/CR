#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const sourcePath = path.resolve("components/providers/StoreFeatureProviders.tsx");
const source = fs.readFileSync(sourcePath, "utf8");
const providerNames = [...source.matchAll(/<([A-Za-z][A-Za-z0-9]+Provider)(?:\s|>)/g)].map((match) => match[1]);
const counts = Object.fromEntries([...new Set(providerNames)].sort().map((name) => [name, providerNames.filter((value) => value === name).length]));
const duplicatedProviders = Object.entries(counts).filter(([, count]) => count !== 1).map(([name]) => name);

const report = {
  schemaVersion: 1,
  source: path.relative(process.cwd(), sourcePath),
  currentArchitecture: "single_store_feature_boundary",
  subBoundaryInstances: {
    report: false,
    labor: false,
    petty: false,
    inventory: false,
    shop: false,
  },
  providerCounts: counts,
  duplicatedProviders,
  instanceIsolation: duplicatedProviders.length === 0,
  implicitCouplingRisk: "所有门店事实仍在同一 StoreFeatureProviders 树中常驻装配；尚未形成五个运行时子边界，因此不存在跨子边界双实例，但存在跨顶级 Tab 的加载与内存耦合。",
  migrationRequirement: "实施 StoreTabBoundary 后，每个事实 Provider 必须只出现在共享内核或一个子边界；报表跨域数据必须经只读物化视图访问。",
};

console.log(JSON.stringify(report, null, 2));
if (duplicatedProviders.length) process.exit(1);
