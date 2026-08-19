import {
  CAPABILITY_ACTIONS,
  CAPABILITY_RESOURCES,
  STORAGE_POLICY,
  type Capability,
} from "../lib/sync/capabilities";
import { FEATURE_CONTRACTS } from "../lib/sync/feature-contract";
import { SYNC_KEYS } from "../lib/sync/engine";

const fail = (message: string): never => {
  console.error(`[feature-contract] ${message}`);
  process.exit(1);
};

const resources = new Set<string>(CAPABILITY_RESOURCES);
const actions = new Set<string>(CAPABILITY_ACTIONS);
const contractIds = new Set<string>();
const coveredResources = new Set<string>();
const coveredStorageKeys = new Set<string>();

for (const contract of FEATURE_CONTRACTS) {
  if (!/^[a-z][a-z0-9_.-]+$/.test(contract.id)) fail(`${contract.id}: id 必须使用稳定的小写标识`);
  if (contractIds.has(contract.id)) fail(`${contract.id}: 重复功能契约 ID`);
  contractIds.add(contract.id);

  if (!contract.label.trim()) fail(`${contract.id}: 缺少用户可读名称`);
  if (!resources.has(contract.resource)) fail(`${contract.id}: 未注册资源 ${contract.resource}`);
  coveredResources.add(contract.resource);

  const declaredActions = Object.entries(contract.actions);
  if (!declaredActions.length) fail(`${contract.id}: 至少声明一个用户动作`);
  if (!("open" in contract.actions)) fail(`${contract.id}: 必须声明 open 查看动作`);

  for (const [actionName, capability] of declaredActions) {
    const [resource, action] = (capability as Capability).split(".");
    if (resource !== contract.resource || !actions.has(action)) {
      fail(`${contract.id}.${actionName}: ${capability} 不属于资源 ${contract.resource}`);
    }
  }

  for (const actionName of contract.offline.requiresOnlineActions) {
    if (!(actionName in contract.actions)) fail(`${contract.id}: 离线规则引用了未声明动作 ${actionName}`);
  }
  if (contract.offline.allowDraftEdits && !("edit" in contract.actions)) {
    fail(`${contract.id}: allowDraftEdits=true 但未声明 edit 动作`);
  }

  if (contract.sync === "shared") {
    if (!contract.storageKeys.length) fail(`${contract.id}: 共享功能必须声明至少一个同步键`);
    for (const key of contract.storageKeys) {
      if (!(key in STORAGE_POLICY)) fail(`${contract.id}: 同步键 ${key} 未注册 STORAGE_POLICY`);
      if (coveredStorageKeys.has(key)) fail(`${contract.id}: 同步键 ${key} 被多个功能契约重复归属`);
      coveredStorageKeys.add(key);
    }
  } else if (contract.storageKeys.length) {
    fail(`${contract.id}: local_only 功能不得声明共享同步键`);
  }
}

for (const resource of CAPABILITY_RESOURCES) {
  if (!coveredResources.has(resource)) fail(`资源 ${resource} 没有 FEATURE_CONTRACTS 接入声明`);
}
for (const key of SYNC_KEYS) {
  if (!coveredStorageKeys.has(key)) fail(`同步键 ${key} 没有业务功能契约归属`);
}

console.log(`[feature-contract] 通过：${FEATURE_CONTRACTS.length} 个功能、${coveredResources.size} 个资源、${coveredStorageKeys.size} 个同步键均已完整声明。`);
