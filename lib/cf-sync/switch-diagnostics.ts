import AsyncStorage from "@react-native-async-storage/async-storage";

const DIAGNOSTIC_KEY = "cf.sync.switchDiagnostics.v1";
const MAX_ENTRIES = 120;

export type GroupSwitchDiagnosticEvent =
  | "switch_prepared"
  | "switch_prepare_failed"
  | "write_barrier_enabled"
  | "switch_committed"
  | "switch_commit_uncertain"
  | "target_snapshot_requested"
  | "target_snapshot_rejected"
  | "target_hydration_started"
  | "target_hydration_completed"
  | "target_hydration_failed"
  | "switch_recovery_started"
  | "switch_recovery_completed"
  | "switch_recovery_failed"
  | "source_resumed"
  | "local_recovery_completed"
  | "recovery_join_started"
  | "recovery_join_committed"
  | "recovery_join_failed";

export type GroupSwitchDiagnostic = {
  at: number;
  event: GroupSwitchDiagnosticEvent;
  switchId: string;
  /** 仅保存不可逆哈希的短提示，禁止保存完整群组ID、令牌、配对码或业务内容。 */
  sourceGroupHint?: string;
  targetGroupHint?: string;
  /** 稳定的错误分类代码；禁止直接保存服务端正文、JSON或业务数据。 */
  errorCode?: string;
  retryable?: boolean;
};

function redactIdentifier(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `g:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normaliseErrorCode(error: unknown): string {
  if (error instanceof Error) {
    const code = error.message.match(/[A-Z][A-Z0-9_]{2,}/)?.[0];
    return code ?? "SWITCH_OPERATION_FAILED";
  }
  return "SWITCH_OPERATION_FAILED";
}

export async function appendGroupSwitchDiagnostic(input: {
  event: GroupSwitchDiagnosticEvent;
  switchId: string;
  sourceGroupId?: string;
  targetGroupId?: string;
  error?: unknown;
  errorCode?: string;
  retryable?: boolean;
}): Promise<void> {
  const entry: GroupSwitchDiagnostic = {
    at: Date.now(),
    event: input.event,
    switchId: input.switchId,
    sourceGroupHint: redactIdentifier(input.sourceGroupId),
    targetGroupHint: redactIdentifier(input.targetGroupId),
    errorCode: input.errorCode ?? (input.error ? normaliseErrorCode(input.error) : undefined),
    retryable: input.retryable,
  };

  try {
    const raw = await AsyncStorage.getItem(DIAGNOSTIC_KEY);
    const entries: GroupSwitchDiagnostic[] = raw ? JSON.parse(raw) : [];
    entries.unshift(entry);
    if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
    await AsyncStorage.setItem(DIAGNOSTIC_KEY, JSON.stringify(entries));
  } catch {
    // 日志失败不得影响切换安全边界或恢复流程。
  }
}

export async function getGroupSwitchDiagnostics(): Promise<GroupSwitchDiagnostic[]> {
  try {
    const raw = await AsyncStorage.getItem(DIAGNOSTIC_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export { DIAGNOSTIC_KEY };
