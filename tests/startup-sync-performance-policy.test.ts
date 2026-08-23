import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("启动与同步性能护栏", () => {
  it("首次同步对全部业务键仅批量读取一次快照，而不是在预扫描与主循环逐键跨桥读取", () => {
    const engine = read("lib/sync/engine.ts");
    const runInitialSync = engine.slice(engine.indexOf("export async function runInitialSync"), engine.indexOf("export async function triggerStoreReload"));
    expect(engine).toContain("async function readLocalSyncSnapshot()");
    expect(engine).toContain("AsyncStorage.multiGet(keys)");
    expect(engine).toContain("const pairs = await AsyncStorage.multiGet([...SYNC_KEYS])");
    expect(runInitialSync).toContain("const localSnapshot = await readLocalSyncSnapshot()");
    expect(runInitialSync).not.toContain("await AsyncStorage.getItem(key)");
    expect(runInitialSync).toContain("if (pullWrites.length > 0) await AsyncStorage.multiSet(pullWrites)");
  });

  it("根布局把退役迁移安排在首轮交互完成后串行执行，不再在首屏并行竞争 I/O", () => {
    const layout = read("app/_layout.tsx");
    expect(layout).toContain("InteractionManager.runAfterInteractions");
    expect(layout).toContain("await cleanEmptyShiftEntries()");
    expect(layout).toContain("await cleanMonthlyFixedSalary()");
    expect(layout).toContain("await cleanLegacyBusinessMonthKeys()");
    expect(layout).toContain("const result = await purgeRetiredBookLibrary()");
    expect(layout).not.toContain("cleanEmptyShiftEntries().then");
  });

  it("同步、自动备份和照片扫描均让出当前动画与手势，避免前台恢复直接阻塞用户交互", () => {
    const provider = read("lib/cf-sync/provider.tsx");
    expect(provider).toContain('import { Alert, AppState, InteractionManager, Platform } from "react-native"');
    expect(provider).toContain("const startup = InteractionManager.runAfterInteractions");
    expect(provider).toContain("void createSnapshot()");
    expect(provider).toContain("startAutoBackup(activeSession.session.device.name)");
    expect(provider).toContain("void syncPhotos()");
  });
});
