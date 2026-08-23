# 门店店铺/备用金子边界与 iOS 性能 CI 实施设计

## 一、目标与不变量

本设计将门店顶级 Tab 进一步分为 `shop` 与 `petty` 两个子边界，但不复制任何业务事实。每一份可写数据只能由一个 Provider 实例拥有；跨域页面只能读取投影，不能通过投影修改事实。现有 URL、月份、归档门禁、同步键与业务组隔离均保持不变。

| 子边界 | 唯一可写事实 | 允许读取的外部投影 | 禁止行为 |
|---|---|---|---|
| `shop` | 杯具、餐具、日用品、设备库存及其月结 | 全局月份、只读库存名称索引 | 在店铺域创建烈酒、配方或人力的第二实例 |
| `petty` | 备用金流水、备用金分类、备用金—人力/库存关联、备用金月结 | 员工与库存的只读名称索引 | 通过只读索引写入员工、库存或其他域事实 |

## 二、建议新增的子边界组件

以下代码是下一阶段应加入的目标组件。它只负责装配唯一事实拥有者，不在组件内做跨域数据复制。

```tsx
// components/providers/StoreTabBoundary.tsx
import type { ReactNode } from "react";
import { StoreShopProviders } from "@/components/providers/StoreShopProviders";
import { StorePettyProviders } from "@/components/providers/StorePettyProviders";
import { StoreInventoryProviders } from "@/components/providers/StoreInventoryProviders";
import { StoreLaborProviders } from "@/components/providers/StoreLaborProviders";
import { StoreReportProviders } from "@/components/providers/StoreReportProviders";

export type StoreMainTab = "report" | "labor" | "petty" | "inventory" | "shop";

const providerByTab: Record<StoreMainTab, (props: { children: ReactNode }) => JSX.Element> = {
  report: StoreReportProviders,
  labor: StoreLaborProviders,
  petty: StorePettyProviders,
  inventory: StoreInventoryProviders,
  shop: StoreShopProviders,
};

export function StoreTabBoundary({ tab, children }: { tab: StoreMainTab; children: ReactNode }) {
  const Providers = providerByTab[tab];
  return <Providers>{children}</Providers>;
}
```

`StoreShopProviders` 只包裹四类店铺库存事实；`StorePettyProviders` 只包裹备用金事实及备用金关联事实。`StoreFeatureProviders` 在迁移完成后仅保留不应按 Tab 卸载的门店共享 UI 壳，不再重复装配这些可写事实。

```tsx
// components/providers/StoreShopProviders.tsx
import type { ReactNode } from "react";
import { GlasswareInventoryProvider } from "@/lib/glassware/inventory-store";
import { TablewareInventoryProvider } from "@/lib/tableware/inventory-store";
import { SuppliesInventoryProvider } from "@/lib/supplies/inventory-store";
import { EquipmentInventoryProvider } from "@/lib/equipment/inventory-store";

export function StoreShopProviders({ children }: { children: ReactNode }) {
  return (
    <GlasswareInventoryProvider>
      <TablewareInventoryProvider>
        <SuppliesInventoryProvider>
          <EquipmentInventoryProvider>{children}</EquipmentInventoryProvider>
        </SuppliesInventoryProvider>
      </TablewareInventoryProvider>
    </GlasswareInventoryProvider>
  );
}
```

```tsx
// components/providers/StorePettyProviders.tsx
import type { ReactNode } from "react";
import { PettyCashProvider } from "@/lib/store/petty-store";
import { PettyCategoryProvider } from "@/lib/store/petty-category-store";
import { PettyLaborLinkProvider } from "@/lib/store/petty-labor-link-store";
import { PettyInventoryLinkProvider } from "@/lib/store/petty-inventory-link-store";

export function StorePettyProviders({ children }: { children: ReactNode }) {
  return (
    <PettyCashProvider>
      <PettyCategoryProvider>
        <PettyLaborLinkProvider>
          <PettyInventoryLinkProvider>{children}</PettyInventoryLinkProvider>
        </PettyLaborLinkProvider>
      </PettyCategoryProvider>
    </PettyCashProvider>
  );
}
```

具体 Provider 的导出名称应以迁移时实际文件导出为准；不得同时保留旧 `StoreFeatureProviders` 包裹，否则会产生两份状态实例。

## 三、备用金跨域只读物化视图

备用金需要显示员工和库存的名称、归档状态或关联摘要，但不应拥有这些外部事实。推荐由根层唯一同步/存储读取能力在切换至备用金时生成只读快照。

```tsx
// lib/store/petty-reference-read-model.ts
export interface PettyReferenceReadModel {
  version: string;
  employeeNameById: ReadonlyMap<string, string>;
  inventoryNameById: ReadonlyMap<string, string>;
}

export function buildPettyReferenceReadModel(input: {
  employees: readonly { id: string; code: string; realName?: string }[];
  inventoryItems: readonly { id: string; name: string }[];
}): PettyReferenceReadModel {
  return {
    version: `${input.employees.length}:${input.inventoryItems.length}`,
    employeeNameById: new Map(input.employees.map((employee) => [employee.id, employee.realName || employee.code])),
    inventoryNameById: new Map(input.inventoryItems.map((item) => [item.id, item.name])),
  };
}
```

`StorePettyReadModelProvider` 应仅暴露名称、状态摘要和稳定 ID。新增、编辑或删除备用金记录仍只调用 `usePettyCashStore()` 的 `addRecord`、`updateRecord`、`deleteRecord`；若用户点击关联员工/库存详情，则导航到拥有该事实的页面，而非在备用金域写外部事实。

## 四、实施步骤与旧代码退役

| 顺序 | 改动 | 必须删除或替换的旧实现 | 验证 |
|---|---|---|---|
| 1 | 增加 `StoreTabBoundary`，保持现有 `StoreFeatureProviders` 不变。 | 无。 | 单元测试路径映射和 Provider 唯一实例。 |
| 2 | 迁移 `shop`：四类库存 Provider 移入 `StoreShopProviders`。 | 从旧门店全栈 Provider 移除四类库存装配。 | 店铺 Tab、四类详情、月结、同步重载与回退深链。 |
| 3 | 迁移 `petty`：备用金及三个关联 Provider 移入 `StorePettyProviders`。 | 从旧门店全栈 Provider 移除备用金装配。 | 账本、日历、统计、导入、归档、关联跳转和离线恢复。 |
| 4 | 接入只读投影。 | 删除备用金域中任何直接创建员工/库存 Provider 的兼容代码。 | 同步后名称更新、链接失效、权限门禁和无二次状态实例。 |
| 5 | 最后才迁移库存、人力与报表。 | 不保留同时挂载的新旧 Provider。 | 全局月份、报表聚合、导入、跨 Tab 往返与移动压力测试。 |

## 五、已实施的排班大字体回退

以下实现已位于 `components/labor/LaborWorkspaceScreen.tsx`。默认字体缩放下选人器是 44px 固定单行，启用 `getItemLayout`；字体缩放超过 1.15 时返回 `undefined`，使 FlatList 使用自然测量高度。

```tsx
const { fontScale } = useWindowDimensions();
const employeePickerRowHeight = fontScale <= 1.15 ? 44 : undefined;

<FlatList
  data={allDeptEmployees}
  keyExtractor={(employee) => employee.id}
  style={{ maxHeight: 360 }}
  initialNumToRender={16}
  maxToRenderPerBatch={12}
  windowSize={5}
  removeClippedSubviews={Platform.OS !== "web"}
  getItemLayout={employeePickerRowHeight
    ? (_, index) => ({
        length: employeePickerRowHeight,
        offset: employeePickerRowHeight * index,
        index,
      })
    : undefined}
  renderItem={({ item: employee }) => (
    <TouchableOpacity style={{ minHeight: 44, height: employeePickerRowHeight }}>
      {/* 原有选择行内容 */}
    </TouchableOpacity>
  )}
/>
```

## 六、iOS 性能阈值配置与 CI 逻辑

阈值配置文件为 `scripts/ci/ios-performance-thresholds.json`。候选构建必须与基线在同一设备型号、iOS 大版本和性能模式上运行；每个场景至少采样 5 次；比较每个指标的 P95。候选 P95 必须同时满足相对容忍度和绝对上限：

```text
allowed(metric) = min(
  baselineP95(metric) × (1 + tolerance(metric)),
  absoluteLimit(metric)
)
```

默认容忍度：启动与交互就绪 15%，内存 12%，滚动 P95 12%，100ms 以上卡顿数 20%，图片上传内存 12%。库存长列表、排班选人器和 4K 图片上传具有更严格的场景绝对上限。设备型号、iOS 大版本或性能模式不一致时直接失败，不允许跨设备比较。

运行命令：

```bash
IOS_WORKSPACE=ios/CocktailR.xcworkspace \
IOS_SCHEME=CocktailRPerformance \
IOS_DESTINATION='platform=iOS,name=CI iPhone' \
PERFORMANCE_BASELINE=performance-baselines/ios-iphone15-ios18.json \
IOS_METRICS_NORMALIZER=./scripts/ci/normalize-xcresult-performance.sh \
./scripts/ci/run-ios-performance.sh
```

`IOS_METRICS_NORMALIZER` 必须把 Xcode 版本相关的 `.xcresult` 输出归一化为候选 JSON；阈值校验器不直接假设原始 `xcresult` 的不稳定结构。性能测试仅使用无业务含义的合成账户、长列表夹具和测试图片，禁止读取或上传真实门店数据。
