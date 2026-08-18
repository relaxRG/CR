import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { createSnapshot } from "@/lib/backup/local-backup";
import {
  beginGroupSwitchWriteBarrier,
  cancelPreparedGroupSwitch as releasePreparedGroupSwitchBarrier,
  completeGroupSwitchWriteBarrier,
  hydrateTargetGroupSnapshot,
  retainGroupSwitchRecoveryBarrier,
  triggerStoreReload,
} from "@/lib/sync/engine";
import {
  cancelPreparedGroupSwitch as cancelPreparedGroupSwitchOnServer,
  commitGroupSwitch,
  getDeviceInfo,
  getGroupSwitchStatus,
  getSyncDevicePlatform,
  prepareGroupSwitch,
  pullCompleteTargetSnapshot,
  recoverJoinWithCode,
  saveDeviceInfo,
  type DeviceInfo,
  type GroupSwitchPreparation,
} from "./client";
import { appendGroupSwitchDiagnostic } from "./switch-diagnostics";

const SESSION_KEY = "cf.sync.groupSwitchSession.v1";
const TICKET_KEY_PREFIX = "cf.sync.groupSwitchTicket.";
const SNAPSHOT_SLOT_COUNT = 7;

/**
 * Web端恢复票据只允许在当前页面生命周期内存中存在。
 * 浏览器刷新或关闭后必须安全失败并要求用户重新发起切换，绝不写入 AsyncStorage/localStorage。
 */
const webRecoveryTickets = new Map<string, string>();

export type GroupSwitchMode = "prepared" | "committed" | "hydrating" | "error";

export type PersistedGroupSwitchSession = {
  version: 1;
  switchId: string;
  mode: GroupSwitchMode;
  source: Pick<DeviceInfo, "deviceId" | "groupId" | "deviceName">;
  targetGroupId: string;
  localSnapshotSlot: number;
  writeEpoch: number;
  createdAt: number;
  lastErrorCode?: string;
  /** 来源成员资格已失效时的显式恢复加入；无恢复票据，冷启动只允许目标水合或安全释放。 */
  flow?: "atomic" | "recovery-join";
};

export type GroupSwitchRuntime = {
  /** 停止旧成员令牌下的实时轮询、通知和延迟任务。 */
  stopSourceRealtime: () => void;
  /** 将当前Provider内存成员资格切换至Worker返回的新资格。 */
  setActiveMembership: (membership: DeviceInfo) => void;
  /** 目标照片仅下载/修复；实现不得上传本机旧组文件。 */
  syncTargetPhotosReadOnly: () => Promise<void>;
  /** 只有完整水合成功后才注册普通推送函数。 */
  createTargetPush: (membership: DeviceInfo) => (entries: { storageKey: string; value: string; clientUpdatedAt: number }[]) => Promise<unknown>;
};

function ticketKey(switchId: string): string {
  return `${TICKET_KEY_PREFIX}${switchId}`;
}

async function saveTicket(switchId: string, ticket: string): Promise<void> {
  if (Platform.OS === "web") {
    webRecoveryTickets.set(switchId, ticket);
    return;
  }
  await SecureStore.setItemAsync(ticketKey(switchId), ticket);
}

async function readTicket(switchId: string): Promise<string | null> {
  if (Platform.OS === "web") return webRecoveryTickets.get(switchId) ?? null;
  return SecureStore.getItemAsync(ticketKey(switchId));
}

async function clearTicket(switchId: string): Promise<void> {
  if (Platform.OS === "web") {
    webRecoveryTickets.delete(switchId);
    return;
  }
  await SecureStore.deleteItemAsync(ticketKey(switchId));
}

async function saveSession(session: PersistedGroupSwitchSession): Promise<void> {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

async function clearSession(session: PersistedGroupSwitchSession): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(SESSION_KEY),
    clearTicket(session.switchId),
  ]);
}

export async function getPendingGroupSwitchSession(): Promise<PersistedGroupSwitchSession | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as PersistedGroupSwitchSession;
    if (value.version !== 1 || !value.switchId || !value.targetGroupId) return null;
    return value;
  } catch {
    return null;
  }
}

function errorCode(error: unknown): string {
  if (error instanceof Error) {
    return error.message.match(/[A-Z][A-Z0-9_]{2,}/)?.[0] ?? "SWITCH_OPERATION_FAILED";
  }
  return "SWITCH_OPERATION_FAILED";
}

async function hydrateCommittedSwitch(
  session: PersistedGroupSwitchSession,
  membership: DeviceInfo,
  runtime: GroupSwitchRuntime,
): Promise<void> {
  await saveDeviceInfo(membership);
  runtime.setActiveMembership(membership);
  await appendGroupSwitchDiagnostic({
    event: "target_snapshot_requested",
    switchId: session.switchId,
    sourceGroupId: session.source.groupId,
    targetGroupId: membership.groupId,
  });

  const snapshot = await pullCompleteTargetSnapshot(membership);
  await appendGroupSwitchDiagnostic({
    event: "target_hydration_started",
    switchId: session.switchId,
    sourceGroupId: session.source.groupId,
    targetGroupId: membership.groupId,
  });
  await hydrateTargetGroupSnapshot(snapshot, membership.groupId, session.writeEpoch);
  await saveSession({ ...session, mode: "hydrating" });

  // Store在全部键替换完成前保留旧内存状态，必须只重载一次。
  triggerStoreReload();
  await runtime.syncTargetPhotosReadOnly();
  completeGroupSwitchWriteBarrier(session.writeEpoch, runtime.createTargetPush(membership));
  await clearSession(session);
  await appendGroupSwitchDiagnostic({
    event: "target_hydration_completed",
    switchId: session.switchId,
    sourceGroupId: session.source.groupId,
    targetGroupId: membership.groupId,
  });
}

/**
 * 正常路径：预检 -> 本地加密快照 -> 屏障 -> Worker原子提交 -> 目标完整仅拉取替换。
 * 此函数绝不调用普通LWW首轮同步，也不会推送本机旧组数据。
 */
export async function switchToAnotherGroup(
  input: { code: string; switchId: string; handoffDeviceId?: string },
  runtime: GroupSwitchRuntime,
): Promise<void> {
  const source = await getDeviceInfo();
  if (!source) throw new Error("SYNC_GROUP_NOT_ACTIVE");
  let preparation: GroupSwitchPreparation | null = null;
  let session: PersistedGroupSwitchSession | null = null;

  try {
    // 快照先于任何服务端准备动作，避免强退时留下本机无法恢复的准备票据。
    const snapshotMeta = await createSnapshot();
    const localSnapshotSlot = (snapshotMeta.currentSlot + SNAPSHOT_SLOT_COUNT - 1) % SNAPSHOT_SLOT_COUNT;
    preparation = await prepareGroupSwitch({
      ...input,
      deviceName: source.deviceName,
      platform: getSyncDevicePlatform(),
    });
    await appendGroupSwitchDiagnostic({
      event: "switch_prepared",
      switchId: input.switchId,
      sourceGroupId: source.groupId,
      targetGroupId: preparation.target.groupId,
    });

    const writeEpoch = await beginGroupSwitchWriteBarrier(input.switchId);
    runtime.stopSourceRealtime();
    session = {
      version: 1,
      switchId: preparation.switchId,
      mode: "prepared",
      source: { deviceId: source.deviceId, groupId: source.groupId, deviceName: source.deviceName },
      targetGroupId: preparation.target.groupId,
      localSnapshotSlot,
      writeEpoch,
      createdAt: Date.now(),
    };
    await Promise.all([saveSession(session), saveTicket(session.switchId, preparation.recoveryTicket)]);
    await appendGroupSwitchDiagnostic({
      event: "write_barrier_enabled",
      switchId: session.switchId,
      sourceGroupId: source.groupId,
      targetGroupId: session.targetGroupId,
    });

    const committed = await commitGroupSwitch({
      switchId: session.switchId,
      recoveryTicket: preparation.recoveryTicket,
    });
    if (committed.state !== "committed") throw new Error("SWITCH_NOT_COMMITTED");
    session = { ...session, mode: "committed" };
    await saveSession(session);
    await appendGroupSwitchDiagnostic({
      event: "switch_committed",
      switchId: session.switchId,
      sourceGroupId: source.groupId,
      targetGroupId: committed.membership.groupId,
    });
    await hydrateCommittedSwitch(session, committed.membership, runtime);
  } catch (error) {
    const code = errorCode(error);
    if (session) {
      await saveSession({ ...session, mode: "error", lastErrorCode: code });
      await retainGroupSwitchRecoveryBarrier(session.writeEpoch, code);
      await appendGroupSwitchDiagnostic({
        event: "target_hydration_failed",
        switchId: session.switchId,
        sourceGroupId: session.source.groupId,
        targetGroupId: session.targetGroupId,
        errorCode: code,
        retryable: true,
      });
    } else if (preparation) {
      await appendGroupSwitchDiagnostic({
        event: "switch_prepare_failed",
        switchId: preparation.switchId,
        sourceGroupId: source.groupId,
        targetGroupId: preparation.target.groupId,
        errorCode: code,
        retryable: true,
      });
    } else {
      // 来源认证失败发生在服务端准备前，也必须留下脱敏的稳定错误码，便于判断是否显示恢复加入。
      await appendGroupSwitchDiagnostic({
        event: "switch_prepare_failed",
        switchId: input.switchId,
        sourceGroupId: source.groupId,
        errorCode: code,
        retryable: code !== "SOURCE_MEMBERSHIP_UNAVAILABLE",
      });
    }
    throw error;
  }
}

/**
 * 来源成员资格已失效后的显式恢复加入。调用者必须在UI二次确认后执行；
 * 这不是普通切组的自动降级，任何网络或5xx错误均不会进入本流程。
 */
export async function recoverJoinAfterUnavailableSource(
  code: string,
  runtime: GroupSwitchRuntime,
): Promise<void> {
  const source = await getDeviceInfo();
  if (!source) throw new Error("SYNC_GROUP_NOT_ACTIVE");
  const switchId = `recovery-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const snapshotMeta = await createSnapshot();
  const localSnapshotSlot = (snapshotMeta.currentSlot + SNAPSHOT_SLOT_COUNT - 1) % SNAPSHOT_SLOT_COUNT;
  const writeEpoch = await beginGroupSwitchWriteBarrier(switchId);
  runtime.stopSourceRealtime();
  let session: PersistedGroupSwitchSession = {
    version: 1,
    switchId,
    mode: "prepared",
    flow: "recovery-join",
    source: { deviceId: source.deviceId, groupId: source.groupId, deviceName: source.deviceName },
    // 占位值仅在recover-join API返回前使用；冷启动会回到安全本地模式而不是推送旧键。
    targetGroupId: "pending",
    localSnapshotSlot,
    writeEpoch,
    createdAt: Date.now(),
  };
  await saveSession(session);
  await appendGroupSwitchDiagnostic({
    event: "recovery_join_started",
    switchId,
    sourceGroupId: source.groupId,
  });
  try {
    const membership = await recoverJoinWithCode({ code });
    // 先持久化目标身份，再更新事务状态：强退后只能以目标令牌继续完整水合。
    await saveDeviceInfo(membership);
    runtime.setActiveMembership(membership);
    session = { ...session, mode: "committed", targetGroupId: membership.groupId };
    await saveSession(session);
    await appendGroupSwitchDiagnostic({
      event: "recovery_join_committed",
      switchId,
      sourceGroupId: source.groupId,
      targetGroupId: membership.groupId,
    });
    await hydrateCommittedSwitch(session, membership, runtime);
  } catch (error) {
    const codeValue = errorCode(error);
    await saveSession({ ...session, mode: "error", lastErrorCode: codeValue });
    await retainGroupSwitchRecoveryBarrier(writeEpoch, codeValue);
    await appendGroupSwitchDiagnostic({
      event: "recovery_join_failed",
      switchId,
      sourceGroupId: source.groupId,
      errorCode: codeValue,
      retryable: true,
    });
    throw error;
  }
}

/**
 * 冷启动恢复：已提交只会向前完成目标水合；未提交才允许释放屏障并恢复原组。
 */
export async function recoverPendingGroupSwitch(
  runtime: GroupSwitchRuntime,
): Promise<"none" | "source-resumed" | "target-recovered" | "blocked"> {
  const session = await getPendingGroupSwitchSession();
  if (!session) return "none";
  const epoch = await beginGroupSwitchWriteBarrier(session.switchId);
  if (session.flow === "recovery-join") {
    runtime.stopSourceRealtime();
    const current = await getDeviceInfo();
    // API成功后身份已落盘：只能继续目标组完整水合，绝不回到旧组推送。
    if (current && current.groupId !== session.source.groupId && session.targetGroupId !== "pending") {
      try {
        await hydrateCommittedSwitch({ ...session, writeEpoch: epoch }, current, runtime);
        return "target-recovered";
      } catch (error) {
        const code = errorCode(error);
        await saveSession({ ...session, mode: "error", writeEpoch: epoch, lastErrorCode: code });
        await retainGroupSwitchRecoveryBarrier(epoch, code);
        return "blocked";
      }
    }
    // API尚未成功时没有目标身份；释放屏障回到本地模式，允许用户重新显式确认恢复加入。
    if (current?.groupId === session.source.groupId) {
      releasePreparedGroupSwitchBarrier(epoch, runtime.createTargetPush(current));
      await clearSession(session);
      return "source-resumed";
    }
    await retainGroupSwitchRecoveryBarrier(epoch, "RECOVERY_JOIN_STATE_UNKNOWN");
    return "blocked";
  }
  const ticket = await readTicket(session.switchId);
  if (!ticket) return "blocked";
  const recoverySession = { ...session, writeEpoch: epoch };
  await saveSession(recoverySession);
  runtime.stopSourceRealtime();

  try {
    await appendGroupSwitchDiagnostic({
      event: "switch_recovery_started",
      switchId: recoverySession.switchId,
      sourceGroupId: recoverySession.source.groupId,
      targetGroupId: recoverySession.targetGroupId,
    });
    const status = await getGroupSwitchStatus({ switchId: recoverySession.switchId, recoveryTicket: ticket });
    if (status.state === "prepared" || status.state === "cancelled") {
      if (status.state === "prepared") await cancelPreparedGroupSwitchOnServer({ switchId: recoverySession.switchId, recoveryTicket: ticket });
      const source = await getDeviceInfo();
      if (!source || source.groupId !== recoverySession.source.groupId) throw new Error("SOURCE_MEMBERSHIP_UNAVAILABLE");
      releasePreparedGroupSwitchBarrier(epoch, runtime.createTargetPush(source));
      await clearSession(recoverySession);
      await appendGroupSwitchDiagnostic({
        event: "source_resumed",
        switchId: recoverySession.switchId,
        sourceGroupId: recoverySession.source.groupId,
      });
      return "source-resumed";
    }
    if (status.state !== "committed") throw new Error("SWITCH_STATUS_UNEXPECTED");
    await hydrateCommittedSwitch(recoverySession, status.membership, runtime);
    await appendGroupSwitchDiagnostic({
      event: "switch_recovery_completed",
      switchId: recoverySession.switchId,
      sourceGroupId: recoverySession.source.groupId,
      targetGroupId: status.membership.groupId,
    });
    return "target-recovered";
  } catch (error) {
    const code = errorCode(error);
    await saveSession({ ...recoverySession, mode: "error", lastErrorCode: code });
    await retainGroupSwitchRecoveryBarrier(epoch, code);
    await appendGroupSwitchDiagnostic({
      event: "switch_recovery_failed",
      switchId: recoverySession.switchId,
      sourceGroupId: recoverySession.source.groupId,
      targetGroupId: recoverySession.targetGroupId,
      errorCode: code,
      retryable: true,
    });
    return "blocked";
  }
}

export { SESSION_KEY };
