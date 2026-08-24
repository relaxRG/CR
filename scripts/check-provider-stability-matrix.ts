import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { PROVIDER_STABILITY_MATRIX } from "../lib/stability/provider-stability-matrix";

const root = process.cwd();
const fail = (message: string): never => {
  console.error(`[provider-stability] ${message}`);
  process.exit(1);
};

const resolve = (path: string) => join(root, path);
const read = (path: string) => readFileSync(resolve(path), "utf8");
const assertFile = (owner: string, path: string, kind: string) => {
  if (!existsSync(resolve(path))) fail(`${owner}: ${kind}不存在：${path}`);
};

const ids = new Set<string>();
const sources = new Set<string>();
const testOwners = new Map<string, string[]>();
let runtimeCoverage = 0;
let contractCoverage = 0;

for (const entry of PROVIDER_STABILITY_MATRIX) {
  if (!/^[a-z][a-z0-9_.-]+$/.test(entry.id)) fail(`${entry.id}: ID必须是稳定的小写标识`);
  if (ids.has(entry.id)) fail(`${entry.id}: 重复的Provider Stability Matrix ID`);
  ids.add(entry.id);
  if (!entry.label.trim()) fail(`${entry.id}: 缺少可读名称`);
  if (sources.has(entry.source)) fail(`${entry.id}: 源文件被多个Matrix条目重复拥有：${entry.source}`);
  sources.add(entry.source);

  assertFile(entry.id, entry.source, "Provider源文件");
  const source = read(entry.source);
  if (!entry.requiredMarkers.length) fail(`${entry.id}: 至少声明一个稳定性源代码不变量`);
  for (const marker of entry.requiredMarkers) {
    if (!source.includes(marker)) fail(`${entry.id}: Provider源文件缺少必要稳定性标记 ${JSON.stringify(marker)}`);
  }

  if (!entry.runtimeTests.length) fail(`${entry.id}: 缺少真实运行时覆盖测试`);
  if (!entry.contractTests.length) fail(`${entry.id}: 缺少源码契约覆盖测试`);
  runtimeCoverage += entry.runtimeTests.length;
  contractCoverage += entry.contractTests.length;

  for (const testPath of [...entry.runtimeTests, ...entry.contractTests]) {
    assertFile(entry.id, testPath, "稳定性测试");
    testOwners.set(testPath, [...(testOwners.get(testPath) ?? []), entry.id]);
  }
}

// Provider边界目录是核心装配面：新增边界组件必须同时进入Matrix，不能绕过CI门禁。
const providerBoundaryDir = resolve("components/providers");
for (const file of readdirSync(providerBoundaryDir).filter((name) => name.endsWith(".tsx"))) {
  const sourcePath = relative(root, join(providerBoundaryDir, file));
  if (!sources.has(sourcePath)) fail(`未登记的Provider边界：${sourcePath}；请加入 PROVIDER_STABILITY_MATRIX 并声明测试覆盖`);
}

// A Matrix test may cover multiple providers, but every listed test must be explicitly shared by its owners.
for (const [testPath, owners] of testOwners) {
  if (!owners.length) fail(`孤立稳定性测试：${testPath}`);
}

const criticalCount = PROVIDER_STABILITY_MATRIX.filter((entry) => entry.tier === "critical").length;
console.log(`[provider-stability] 通过：${PROVIDER_STABILITY_MATRIX.length} 个核心Provider（${criticalCount} 个关键事实源），${runtimeCoverage} 条运行时覆盖、${contractCoverage} 条源码契约覆盖。`);
