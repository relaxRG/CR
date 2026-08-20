import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  formatArchiveMonthLabel,
  appendRawExcelArchiveEntries,
  getArchiveEntryId,
  getExcelExtension,
  getNextRawExcelRevision,
  getRawExcelArchiveRelativePath,
  getRawExcelExportFilename,
  groupRawExcelArchiveEntries,
  RawExcelArchiveEntry,
  RawExcelArchiveGroup,
  RawExcelArchiveInput,
  normalizeRawExcelArchiveEntries,
  RAW_EXCEL_ARCHIVE_DIRECTORY,
  RAW_EXCEL_ARCHIVE_STORAGE_KEY,
} from "./raw-excel-archive";

interface RawExcelArchiveStore {
  entries: RawExcelArchiveEntry[];
  groups: RawExcelArchiveGroup[];
  ready: boolean;
  archiveFiles: (params: {
    month: string;
    monthLabel?: string;
    files: RawExcelArchiveInput[];
  }) => Promise<void>;
  deleteFile: (id: string) => Promise<void>;
  getFilesForMonth: (month: string) => RawExcelArchiveEntry[];
  getAllMonths: () => RawExcelArchiveGroup[];
  exportFile: (entry: RawExcelArchiveEntry) => Promise<void>;
}

const RawExcelArchiveContext = createContext<RawExcelArchiveStore>({
  entries: [],
  groups: [],
  ready: false,
  archiveFiles: async () => {},
  deleteFile: async () => {},
  getFilesForMonth: () => [],
  getAllMonths: () => [],
  exportFile: async () => {},
});

function getArchiveRootDirectory(): string {
  const root = FileSystem.documentDirectory;
  if (!root) throw new Error("当前平台无法访问应用文件归档目录");
  return root;
}

function estimateBase64Size(base64: string): number {
  const clean = base64.replace(/\s/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

async function ensureDirectory(uri: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
  }
}

async function safelyDelete(uri: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(uri);
  if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
}

/**
 * 每次确认导入都追加保存原始 Excel 版本。
 * 原始文件本体保存在 App Documents；AsyncStorage 只保存索引，避免大 Base64 挤占 KV 容量。
 */
export function RawExcelArchiveProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<RawExcelArchiveEntry[]>([]);
  const entriesRef = useRef<RawExcelArchiveEntry[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(RAW_EXCEL_ARCHIVE_STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as RawExcelArchiveEntry[];
        if (Array.isArray(parsed)) {
          const normalized = normalizeRawExcelArchiveEntries(parsed);
          entriesRef.current = normalized;
          setEntries(normalized);
        }
      })
      .catch((error) => console.warn("[RawExcelArchive] 加载归档索引失败", error))
      .finally(() => setReady(true));
  }, []);

  const persist = useCallback((next: RawExcelArchiveEntry[]) => {
    entriesRef.current = next;
    setEntries(next);
    return AsyncStorage.setItem(RAW_EXCEL_ARCHIVE_STORAGE_KEY, JSON.stringify(next));
  }, []);

  const archiveFiles = useCallback(async ({
    month,
    monthLabel,
    files,
  }: {
    month: string;
    monthLabel?: string;
    files: RawExcelArchiveInput[];
  }) => {
    const usableFiles = files.filter((file) => file.base64.length > 0);
    if (usableFiles.length === 0) return;

    const root = getArchiveRootDirectory();
    const stagingDirectory = `${root}${RAW_EXCEL_ARCHIVE_DIRECTORY}/.staging-${Date.now()}-${Math.random().toString(36).slice(2)}/`;
    await ensureDirectory(stagingDirectory);

    try {
      const incoming: RawExcelArchiveEntry[] = [];
      const stagedUris = new Map<string, string>();
      for (const file of usableFiles) {
        const revision = getNextRawExcelRevision([...entriesRef.current, ...incoming], month, file.fileType);
        const relativePath = getRawExcelArchiveRelativePath(month, file.fileType, revision, file.filename);
        const stagedName = `${file.fileType}-${revision}${getExcelExtension(file.filename)}`;
        const stagedUri = `${stagingDirectory}${stagedName}`;
        await FileSystem.writeAsStringAsync(stagedUri, file.base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const entry: RawExcelArchiveEntry = {
          id: getArchiveEntryId(month, file.fileType, revision),
          month,
          monthLabel: monthLabel || formatArchiveMonthLabel(month),
          fileType: file.fileType,
          revision,
          filename: file.filename,
          uri: `${root}${relativePath}`,
          sizeBytes: estimateBase64Size(file.base64),
          archivedAt: new Date().toISOString(),
        };
        incoming.push(entry);
        stagedUris.set(entry.id, stagedUri);
      }

      for (const entry of incoming) {
        await ensureDirectory(`${root}${RAW_EXCEL_ARCHIVE_DIRECTORY}/${month}/${entry.fileType}/`);
        await FileSystem.moveAsync({ from: stagedUris.get(entry.id)!, to: entry.uri });
      }

      await persist(appendRawExcelArchiveEntries(entriesRef.current, incoming));
    } finally {
      await safelyDelete(stagingDirectory).catch(() => undefined);
    }
  }, [persist]);

  const deleteFile = useCallback(async (id: string) => {
    const target = entriesRef.current.find((entry) => entry.id === id);
    if (!target) return;
    await safelyDelete(target.uri);
    await persist(entriesRef.current.filter((entry) => entry.id !== id));
  }, [persist]);

  const getFilesForMonth = useCallback((month: string) => (
    entriesRef.current.filter((entry) => entry.month === month)
  ), []);

  const getAllMonths = useCallback(() => groupRawExcelArchiveEntries(entriesRef.current), []);

  const exportFile = useCallback(async (entry: RawExcelArchiveEntry) => {
    const sourceInfo = await FileSystem.getInfoAsync(entry.uri);
    if (!sourceInfo.exists) {
      throw new Error("归档原文件已不存在。请重新导入该月此类报表后再导出。");
    }
    const cacheDirectory = FileSystem.cacheDirectory;
    if (!cacheDirectory) throw new Error("当前平台无法创建导出文件");
    const exportUri = `${cacheDirectory}${getRawExcelExportFilename(entry)}`;
    await safelyDelete(exportUri);
    await FileSystem.copyAsync({ from: entry.uri, to: exportUri });

    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) throw new Error("当前设备不支持文件分享或保存");
    await Sharing.shareAsync(exportUri, {
      mimeType: entry.filename.toLowerCase().endsWith(".xls")
        ? "application/vnd.ms-excel"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      UTI: entry.filename.toLowerCase().endsWith(".xls")
        ? "com.microsoft.excel.xls"
        : "com.microsoft.excel.xlsx",
      dialogTitle: `导出 ${getRawExcelExportFilename(entry)}`,
    });
  }, []);

  const groups = groupRawExcelArchiveEntries(entries);

  return (
    <RawExcelArchiveContext.Provider value={{
      entries,
      groups,
      ready,
      archiveFiles,
      deleteFile,
      getFilesForMonth,
      getAllMonths,
      exportFile,
    }}>
      {children}
    </RawExcelArchiveContext.Provider>
  );
}

export function useRawExcelArchiveStore() {
  return useContext(RawExcelArchiveContext);
}
