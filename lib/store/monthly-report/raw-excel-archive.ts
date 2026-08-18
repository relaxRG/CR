import { REPORT_FILE_TYPE_LABELS, ReportFileType } from "./dish-analysis-types";

export const RAW_EXCEL_ARCHIVE_STORAGE_KEY = "monthly_report.raw_excel_archive.v1";
export const RAW_EXCEL_ARCHIVE_DIRECTORY = "monthly-report-raw-excel-v1";

export interface RawExcelArchiveEntry {
  /** 稳定标识：月份、分类与导入序号共同组成。 */
  id: string;
  /** 业务月份，例如 2026-07。 */
  month: string;
  /** 展示月份，例如 2026年7月。 */
  monthLabel: string;
  /** 已识别的报表分类。 */
  fileType: ReportFileType;
  /** 同一月份、同一分类的第几次确认导入，从 1 开始。 */
  revision: number;
  /** 用户上传时的原始文件名，仅供追溯。 */
  filename: string;
  /** App 沙盒 Documents 内的文件 URI；不把大文件 Base64 写进 AsyncStorage。 */
  uri: string;
  /** 原始文件字节数。 */
  sizeBytes: number;
  /** 已归档时间（ISO 8601）。 */
  archivedAt: string;
}

export interface RawExcelArchiveInput {
  filename: string;
  base64: string;
  fileType: ReportFileType;
}

export interface RawExcelArchiveGroup {
  month: string;
  monthLabel: string;
  files: RawExcelArchiveEntry[];
}

function parseMonth(month: string): { year: number; value: number } | null {
  const matched = /^(\d{4})-(\d{2})$/.exec(month);
  if (!matched) return null;
  const year = Number(matched[1]);
  const value = Number(matched[2]);
  if (!Number.isInteger(year) || value < 1 || value > 12) return null;
  return { year, value };
}

export function formatArchiveMonthLabel(month: string): string {
  const parsed = parseMonth(month);
  return parsed ? `${parsed.year}年${parsed.value}月` : month;
}

export function getExcelExtension(filename: string): ".xlsx" | ".xls" {
  return /\.xls$/i.test(filename) ? ".xls" : ".xlsx";
}

export function getArchiveEntryId(month: string, fileType: ReportFileType, revision: number): string {
  return `${month}:${fileType}:${revision}`;
}

export function getRawExcelArchiveRelativePath(
  month: string,
  fileType: ReportFileType,
  revision: number,
  filename: string,
): string {
  return `${RAW_EXCEL_ARCHIVE_DIRECTORY}/${month}/${fileType}/${revision}${getExcelExtension(filename)}`;
}

export function getRawExcelExportFilename(entry: Pick<RawExcelArchiveEntry, "month" | "fileType" | "filename" | "revision">): string {
  const label = REPORT_FILE_TYPE_LABELS[entry.fileType] ?? "未识别报表";
  const suffix = entry.revision > 1 ? `_第${entry.revision}次导入` : "";
  return `${formatArchiveMonthLabel(entry.month)}_${label}${suffix}${getExcelExtension(entry.filename)}`;
}

export function formatRawExcelSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "0 KB";
  if (sizeBytes < 1024 * 1024) return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 在载入旧索引时补齐导入序号，保证升级后仍可导出已归档文件。 */
export function normalizeRawExcelArchiveEntries(entries: RawExcelArchiveEntry[]): RawExcelArchiveEntry[] {
  const sequence = new Map<string, number>();
  return [...entries]
    .sort((left, right) => left.archivedAt.localeCompare(right.archivedAt))
    .map((entry) => {
      const key = `${entry.month}:${entry.fileType}`;
      const nextRevision = Math.max(sequence.get(key) ?? 0, Number(entry.revision) || 0) + (entry.revision ? 0 : 1);
      const revision = Number(entry.revision) > 0 ? Number(entry.revision) : nextRevision;
      sequence.set(key, Math.max(sequence.get(key) ?? 0, revision));
      return {
        ...entry,
        revision,
        id: entry.id || getArchiveEntryId(entry.month, entry.fileType, revision),
      };
    })
    .sort((left, right) => {
      if (left.month !== right.month) return right.month.localeCompare(left.month);
      if (left.fileType !== right.fileType) return left.fileType.localeCompare(right.fileType);
      return right.revision - left.revision;
    });
}

/** 追加新的已确认导入文件，绝不覆盖同月已归档源文件。 */
export function appendRawExcelArchiveEntries(
  current: RawExcelArchiveEntry[],
  incoming: RawExcelArchiveEntry[],
): RawExcelArchiveEntry[] {
  return normalizeRawExcelArchiveEntries([...current, ...incoming]);
}

export function getNextRawExcelRevision(
  current: RawExcelArchiveEntry[],
  month: string,
  fileType: ReportFileType,
): number {
  const currentRevision = current
    .filter((entry) => entry.month === month && entry.fileType === fileType)
    .reduce((maximum, entry) => Math.max(maximum, Number(entry.revision) || 0), 0);
  return currentRevision + 1;
}

export function groupRawExcelArchiveEntries(entries: RawExcelArchiveEntry[]): RawExcelArchiveGroup[] {
  const groups = new Map<string, RawExcelArchiveGroup>();
  for (const entry of entries) {
    const existing = groups.get(entry.month);
    if (existing) {
      existing.files.push(entry);
      continue;
    }
    groups.set(entry.month, {
      month: entry.month,
      monthLabel: entry.monthLabel || formatArchiveMonthLabel(entry.month),
      files: [entry],
    });
  }
  return [...groups.values()]
    .sort((left, right) => right.month.localeCompare(left.month))
    .map((group) => ({
      ...group,
      files: [...group.files].sort((left, right) => {
        if (left.fileType !== right.fileType) return left.fileType.localeCompare(right.fileType);
        return right.revision - left.revision;
      }),
    }));
}
