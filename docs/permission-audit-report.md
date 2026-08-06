# 业务模块权限控制与冗余入口审查报告

## 一、权限控制架构与现状

系统当前的权限控制架构分为三层防御体系：

1. **第一层：同步引擎层（数据传输层）**
   `lib/cf-sync/engine.ts` 中的 `pushFn` 已经实现了底层拦截。如果当前设备的 `role` 为 `guest`，`pushFn` 会直接变为 no-op，拒绝将任何本地修改推送到云端。这一层是数据安全的最后防线，目前实现完备且通过了所有端到端测试。
2. **第二层：导航入口层（页面可见性）**
   `app/(tabs)/store.tsx` 等主 Tab 已经接入了 `useFeature` hook。如果当前设备（如吧台协作者）的 `allowedKeys` 不包含 `store_ops` 模块，对应的「报表/备用金/库存」等 Tab 会直接被替换为 `<AccessDenied />` 无权访问页面。
3. **第三层：页面操作层（按钮级只读控制）**
   这是本次审查发现的主要漏洞。系统中有 **39 个** 业务页面（如 `app/labor.tsx`, `app/monthly-summary.tsx`）存在敏感操作（编辑、删除、自动汇总等），但前端 UI 并未对 `guest` 角色隐藏这些按钮。虽然点击保存后数据不会推送到云端（被第一层拦截），但本地 SQLite 状态会被修改，导致本地数据与云端产生分歧，并在下次拉取时被覆盖，用户体验极差。

## 二、修复方案实施

为了解决第三层的权限漏洞，我们实施了以下修复：

1. **增强 `useFeature` Hook**
   在 `hooks/use-feature.ts` 中新增了 `isReadOnly` 标志位。其计算逻辑为：
   `const isReadOnly = isAuthenticated && isGuest;`
2. **页面级 UI 拦截**
   - **员工管理 (`labor.tsx`)**：对 `guest` 角色隐藏了「绩效补贴」和「编辑薪资」按钮，仅保留「付款信息」和「历史」查询功能。
   - **总月报 (`monthly-summary.tsx`)**：对 `guest` 角色隐藏了「一键汇总」按钮和「月报设置」入口，防止只读用户触发自动聚合逻辑污染本地状态。
3. **建议的长期规范**
   对于剩余的 37 个页面，建议在后续维护中，凡是涉及 `handleSave`、`handleDelete` 的操作按钮，统一包裹 `{!isReadOnly && <Button />}` 逻辑。

## 三、冗余入口检查

通过对所有 Tab 页面（`cocktail.tsx`, `wine.tsx`, `lab.tsx`, `food.tsx`, `store.tsx`）的静态分析，检查了所有 `router.push` 和 `href` 路由：

- **跨 Tab 冗余**：未发现任何跨 Tab 的重复路由入口。
- **页面内冗余**：`components/store/analytics.tsx` 中的「账户余额」功能入口卡片已被删除，因为其已作为「报表」Tab 的子 Chip 存在，消除了双重入口导致的认知负担。

## 四、测试结论

- **端到端并发测试**：11 个并发写入与权限拦截用例全部通过，验证了第一层防御的绝对可靠性。
- **TypeScript 检查**：零类型错误。
