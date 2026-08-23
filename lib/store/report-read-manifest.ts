import { useSyncExternalStore } from "react";
import { FEATURE_CONTRACTS } from "@/lib/sync/feature-contract";
import type { SyncStorageKey } from "@/lib/sync/engine";

export const STORE_REPORT_MODEL_ID = "store.report" as const;
export type ReportReadModelId = string;

export type ReportReadSegmentManifest = Readonly<{
  id: string;
  ownerFeatureId: string;
  storageKeys: readonly SyncStorageKey[];
  decoderVersion: number;
}>;

export type ReportReadManifest = Readonly<{
  id: string;
  modelId: ReportReadModelId;
  version: number;
  segments: readonly ReportReadSegmentManifest[];
}>;

export type SignedReportReadManifest = Readonly<{
  keyId: string;
  signature: string;
  manifest: ReportReadManifest;
}>;

export type ReportReadManifestVerifier = (payload: string, signature: string, keyId: string) => boolean;

export type ReportReadRevisionManifest = Readonly<{
  storageKeys: readonly SyncStorageKey[];
  revisionNamespace: string;
}>;

export type ResolvedReportReadManifest = ReportReadRevisionManifest & Readonly<{
  modelId: ReportReadModelId;
  manifestIds: readonly string[];
}>;

const KEY_OWNER = new Map<SyncStorageKey, string>();
for (const contract of FEATURE_CONTRACTS) {
  if (contract.sync !== "shared") continue;
  for (const key of contract.storageKeys) {
    if (KEY_OWNER.has(key)) throw new Error(`REPORT_MANIFEST_DUPLICATE_SYNC_OWNER:${key}`);
    KEY_OWNER.set(key, contract.id);
  }
}

const CORE_SEGMENTS = [
  { id: "accounts-revenue", ownerFeatureId: "accounts.workspace", storageKeys: ["store.revenue.v1"], decoderVersion: 1 },
  { id: "petty-cash", ownerFeatureId: "petty.cash", storageKeys: ["store.petty.v1", "store.petty_labor_links.v1"], decoderVersion: 1 },
  { id: "labor-employees", ownerFeatureId: "labor.employees", storageKeys: ["labor_employees_v1", "labor_dept_order_v1"], decoderVersion: 1 },
  { id: "labor-payroll", ownerFeatureId: "payroll.workspace", storageKeys: ["labor_payslips_v1"], decoderVersion: 1 },
  { id: "labor-schedule", ownerFeatureId: "labor.schedule", storageKeys: ["labor_shifts_v1"], decoderVersion: 1 },
  { id: "spirits-purchases", ownerFeatureId: "inventory.spirits", storageKeys: ["spirits.purchases.v3", "spirits.suppliers.v1"], decoderVersion: 1 },
  { id: "food-purchases", ownerFeatureId: "inventory.food", storageKeys: ["food.purchases.v1"], decoderVersion: 1 },
  { id: "wine-purchases", ownerFeatureId: "wine.inventory", storageKeys: ["wine.snapshots.v2", "wine.manual_purchases.v1"], decoderVersion: 1 },
] as const satisfies readonly ReportReadSegmentManifest[];

/** 第一阶段内置清单：storageKeys 与旧固定12键严格等价。 */
export const BUILTIN_STORE_REPORT_MANIFEST: ReportReadManifest = Object.freeze({
  id: "store.report.builtin",
  modelId: STORE_REPORT_MODEL_ID,
  version: 1,
  segments: Object.freeze(CORE_SEGMENTS.map((segment) => Object.freeze({ ...segment, storageKeys: Object.freeze([...segment.storageKeys]) }))),
});

function stableManifestPayload(manifest: ReportReadManifest): string {
  return JSON.stringify({
    id: manifest.id,
    modelId: manifest.modelId,
    version: manifest.version,
    segments: [...manifest.segments].sort((left, right) => left.id.localeCompare(right.id)).map((segment) => ({
      id: segment.id,
      ownerFeatureId: segment.ownerFeatureId,
      decoderVersion: segment.decoderVersion,
      storageKeys: [...segment.storageKeys].sort(),
    })),
  });
}

function validateManifest(manifest: ReportReadManifest): void {
  if (!manifest.id || !manifest.modelId || !Number.isInteger(manifest.version) || manifest.version < 1) {
    throw new Error("REPORT_MANIFEST_INVALID_HEADER");
  }
  const segmentIds = new Set<string>();
  const keys = new Set<SyncStorageKey>();
  for (const segment of manifest.segments) {
    if (!segment.id || segmentIds.has(segment.id) || !Number.isInteger(segment.decoderVersion) || segment.decoderVersion < 1) {
      throw new Error("REPORT_MANIFEST_INVALID_SEGMENT");
    }
    segmentIds.add(segment.id);
    if (segment.storageKeys.length === 0) throw new Error("REPORT_MANIFEST_EMPTY_SEGMENT");
    for (const key of segment.storageKeys) {
      const owner = KEY_OWNER.get(key);
      if (!owner) throw new Error(`REPORT_MANIFEST_UNKNOWN_STORAGE_KEY:${key}`);
      if (owner !== segment.ownerFeatureId) throw new Error(`REPORT_MANIFEST_OWNER_MISMATCH:${key}`);
      if (keys.has(key)) throw new Error(`REPORT_MANIFEST_DUPLICATE_STORAGE_KEY:${key}`);
      keys.add(key);
    }
  }
}

export function resolveReportReadManifest(manifests: readonly ReportReadManifest[], modelId: ReportReadModelId = STORE_REPORT_MODEL_ID): ResolvedReportReadManifest {
  const selected = manifests.filter((manifest) => manifest.modelId === modelId);
  const manifestIds = new Set<string>();
  const keys = new Set<SyncStorageKey>();
  const namespaceParts: string[] = [];
  for (const manifest of selected) {
    validateManifest(manifest);
    if (manifestIds.has(manifest.id)) throw new Error(`REPORT_MANIFEST_DUPLICATE_ID:${manifest.id}`);
    manifestIds.add(manifest.id);
    for (const segment of manifest.segments) {
      for (const key of segment.storageKeys) {
        if (keys.has(key)) throw new Error(`REPORT_MANIFEST_DUPLICATE_STORAGE_KEY:${key}`);
        keys.add(key);
      }
    }
    namespaceParts.push(stableManifestPayload(manifest));
  }
  return Object.freeze({
    modelId,
    storageKeys: Object.freeze([...keys].sort()),
    revisionNamespace: namespaceParts.sort().join("|"),
    manifestIds: Object.freeze([...manifestIds].sort()),
  });
}

export function createReportReadManifestRegistry(options: Readonly<{
  builtins?: readonly ReportReadManifest[];
  pluginAllowlist?: readonly string[];
  verifyPluginSignature?: ReportReadManifestVerifier;
}> = {}) {
  const builtins = new Map<string, ReportReadManifest>();
  const plugins = new Map<string, ReportReadManifest>();
  const listeners = new Map<ReportReadModelId, Set<() => void>>();
  const snapshots = new Map<ReportReadModelId, ResolvedReportReadManifest>();
  const allowlist = new Set(options.pluginAllowlist ?? []);
  const verifier = options.verifyPluginSignature;
  for (const manifest of options.builtins ?? [BUILTIN_STORE_REPORT_MANIFEST]) {
    validateManifest(manifest);
    if (builtins.has(manifest.id)) throw new Error(`REPORT_MANIFEST_DUPLICATE_ID:${manifest.id}`);
    builtins.set(manifest.id, manifest);
  }
  const allManifests = () => [...builtins.values(), ...plugins.values()];
  const snapshot = (modelId: ReportReadModelId = STORE_REPORT_MODEL_ID) => {
    const cached = snapshots.get(modelId);
    if (cached) return cached;
    const next = resolveReportReadManifest(allManifests(), modelId);
    snapshots.set(modelId, next);
    return next;
  };
  const commit = (modelId: ReportReadModelId) => {
    snapshots.set(modelId, resolveReportReadManifest(allManifests(), modelId));
    listeners.get(modelId)?.forEach((listener) => listener());
  };
  const assertUniqueId = (id: string) => {
    if (builtins.has(id) || plugins.has(id)) throw new Error(`REPORT_MANIFEST_DUPLICATE_ID:${id}`);
  };
  return Object.freeze({
    snapshot,
    subscribe(modelId: ReportReadModelId, listener: () => void) {
      const modelListeners = listeners.get(modelId) ?? new Set<() => void>();
      modelListeners.add(listener);
      listeners.set(modelId, modelListeners);
      return () => {
        modelListeners.delete(listener);
        if (modelListeners.size === 0) listeners.delete(modelId);
      };
    },
    registerBuiltinExtension(manifest: ReportReadManifest): void {
      validateManifest(manifest);
      assertUniqueId(manifest.id);
      resolveReportReadManifest([...allManifests(), manifest], manifest.modelId);
      builtins.set(manifest.id, manifest);
      commit(manifest.modelId);
    },
    registerSignedPlugin(envelope: SignedReportReadManifest): void {
      if (!allowlist.has(envelope.keyId)) throw new Error(`REPORT_PLUGIN_KEY_NOT_ALLOWLISTED:${envelope.keyId}`);
      if (!verifier || !verifier(stableManifestPayload(envelope.manifest), envelope.signature, envelope.keyId)) {
        throw new Error("REPORT_PLUGIN_SIGNATURE_INVALID");
      }
      validateManifest(envelope.manifest);
      assertUniqueId(envelope.manifest.id);
      resolveReportReadManifest([...allManifests(), envelope.manifest], envelope.manifest.modelId);
      plugins.set(envelope.manifest.id, envelope.manifest);
      commit(envelope.manifest.modelId);
    },
    unregisterPlugin(manifestId: string): void {
      const manifest = plugins.get(manifestId);
      if (!manifest) return;
      plugins.delete(manifestId);
      commit(manifest.modelId);
    },
  });
}

export const storeReportReadManifestRegistry = createReportReadManifestRegistry();

export function useStoreReportReadManifest(): ResolvedReportReadManifest {
  return useSyncExternalStore(
    (listener) => storeReportReadManifestRegistry.subscribe(STORE_REPORT_MODEL_ID, listener),
    () => storeReportReadManifestRegistry.snapshot(STORE_REPORT_MODEL_ID),
    () => storeReportReadManifestRegistry.snapshot(STORE_REPORT_MODEL_ID),
  );
}
