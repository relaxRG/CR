import type { ReportReadRefreshTicket } from "@/lib/store/report-read-refresh-controller";
import type { StoreReportFacts } from "@/lib/store/report-read-model";
import type { ReportReadRevisionManifest } from "@/lib/store/report-read-manifest";

export type ReportSnapshotStorage = Readonly<{
  multiGet: (keys: readonly string[]) => Promise<readonly [string, string | null][]>;
}>;

export type ConsistentReportSnapshot<T extends StoreReportFacts> = Readonly<{
  facts: T | null;
  revision: string;
  attempts: number;
  unchanged: boolean;
}>;

type TicketGuard = Readonly<{
  isCurrent: (ticket: ReportReadRefreshTicket) => boolean;
}>;

function revisionKeys(manifest: ReportReadRevisionManifest): readonly string[] {
  return manifest.storageKeys.map((key) => `sync.ts.${key}`);
}

export function reportRevisionVector(manifest: ReportReadRevisionManifest, rows: readonly [string, string | null][]): string {
  const values = new Map(rows);
  return `${manifest.revisionNamespace}:${[...manifest.storageKeys]
    .sort()
    .map((key) => `${key}=${values.get(`sync.ts.${key}`) ?? "0"}`)
    .join("|")}`;
}

/**
 * 两次读取 revision 防止跨键快照混合；generation ticket 防止过期边界提交。
 * AsyncStorage 无法真实取消，调用方必须将 null 视为“不得提交”。
 */
export async function loadConsistentReportSnapshot<T extends StoreReportFacts>(options: Readonly<{
  storage: ReportSnapshotStorage;
  manifest: ReportReadRevisionManifest;
  ticket: ReportReadRefreshTicket;
  guard: TicketGuard;
  decode: (snapshot: ReadonlyMap<string, string | null>) => T;
  committedRevision?: string | null;
  maxAttempts?: number;
}>): Promise<ConsistentReportSnapshot<T> | null> {
  const attempts = options.maxAttempts ?? 2;
  const keys = [...options.manifest.storageKeys];
  const revisions = revisionKeys(options.manifest);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const beforeRows = await options.storage.multiGet(revisions);
    if (!options.guard.isCurrent(options.ticket)) return null;
    const before = reportRevisionVector(options.manifest, beforeRows);
    if (options.committedRevision === before) {
      const afterRows = await options.storage.multiGet(revisions);
      if (!options.guard.isCurrent(options.ticket)) return null;
      const after = reportRevisionVector(options.manifest, afterRows);
      if (before === after) return Object.freeze({ facts: null, revision: after, attempts: attempt, unchanged: true });
      continue;
    }

    const factRows = await options.storage.multiGet(keys);
    if (!options.guard.isCurrent(options.ticket)) return null;

    const afterRows = await options.storage.multiGet(revisions);
    if (!options.guard.isCurrent(options.ticket)) return null;
    const after = reportRevisionVector(options.manifest, afterRows);
    if (before !== after) continue;

    const facts = options.decode(new Map(factRows));
    if (!options.guard.isCurrent(options.ticket)) return null;
    return Object.freeze({ facts, revision: after, attempts: attempt, unchanged: false });
  }
  return null;
}
