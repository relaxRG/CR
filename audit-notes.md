# Cocktail R 全面审计笔记（2026-07-20）

## Phase 1 全局扫描结果

### 基础健康
- 代码规模：57,496 行（app/lib/components/server/shared/hooks）
- TypeScript：0 错误
- Vitest：35 通过 / 1 跳过（7 个文件）
- 乱码：无 U+FFFD 替换字符，无 BOM 异常编码
- TODO/FIXME/HACK：0 处
- @ts-ignore：0 处

### 大文件 Top（行数）
- app/book-reader.tsx 2900
- app/recipe-form.tsx 2437
- server/routers.ts 2105（Manus server，客户端已不依赖）
- app/book-import.tsx 1924
- app/(tabs)/bottles.tsx 1675
- app/(tabs)/homemade.tsx 1581
- app/recipe/[id].tsx 1412
- app/homemade-form.tsx 1282
- app/(tabs)/menu.tsx 1206
- app/bottle-form.tsx 1192
- app/tags.tsx 1185
- app/(tabs)/shopping.tsx 1149
- app/(tabs)/recipes.tsx 1111

### 发现的死代码/冗余
1. **lib/_core/auth.ts — 0 引用（死文件）**，且含 15 处 console.log
2. components/parallax-scroll-view.tsx — 0 引用（模板遗留）
3. components/hello-wave.tsx — 0 引用（模板遗留）
4. components/external-link.tsx — 0 引用（模板遗留）
5. components/ui/collapsible.tsx — 0 引用（模板遗留）
6. app/dev/theme-lab.tsx — 0 页面入口（开发工具页，可保留或删）
7. lib/theme-provider.tsx:64 — console.log(value, themeVariables) 调试残留（每次主题切换打印）
8. server/ 目录（routers.ts 2105 行等）— 客户端 0 引用（AI 已迁移 CF Worker v3），仅 Web 预览/dev 用
9. console.log 残留 17 处：lib/_core/auth.ts 15 处（死文件）、lib/_core/manus-runtime.ts 1 处、lib/theme-provider.tsx 1 处

### 路由完整性
- 所有 router.push 目标均有对应文件 ✓
- prep-sections.tsx 无 "/prep-sections" 跳转入口（疑似死页面，交互已被 prep-taxonomy-manager.tsx 组件替代）
- compare.tsx 有入口（homemade/recipes/recipe-group-card）✓
- lab/compare 有入口（lab/[id]）✓
- Tab 结构：4 个可见 Tab（酒单/酒库/书库/我的）+ 5 个隐藏路由（bottles/homemade/menu/shopping/recipes 作为嵌套子屏）

### 架构说明
- 酒单 Tab = index.tsx 容器（酒单/研发/门店 pill 切换，门店内含 门店酒单/采购清单）
- 酒库 Tab = library.tsx 容器（酒款 bottles / 自制 homemade）
- 书库 Tab = books.tsx（EPUB/PDF 书籍导入+阅读）
- 我的 Tab = me.tsx（数据总览/功能入口/同步与数据/语言）
- AI 全部走 CF Worker v3（cocktail-ai.kikikong2017.workers.dev），DeepSeek 主力 + Workers AI 降级
- 同步：CF D1 云同步（设备配对/角色权限/LWW 冲突守卫/前台激活自动同步60s节流）
- i18n：中英双语 694 键

## 待办（Phase 3 修复项）

### 同步覆盖缺口（云同步 SYNC_KEYS 未包含）
- `card.tag.settings.v2`（卡片标签显示设置）— 不同步，换设备后需重新配置（可接受/低危）
- `cocktail.reader.settings.v1.{id}` / `cocktail.reader.highlights.v1.{id}`（阅读器设置+高亮书签，按书 ID 动态键）— 不同步（书籍本体 cocktail.books.v1 同步，但阅读进度/书签不同步）
- `quick.recipes.v1`（快速筛选）、`recipes.tab.v1` 等 UI 状态 — 合理不同步
- 照片文件（photoUris 本地 file:// 路径）— 云同步只同步 JSON，照片文件不上传，换设备后照片丢失（中危，需用户知晓）

- [ ] 删除 lib/_core/auth.ts（死文件，先确认无动态引用）
- [ ] 删除 components/parallax-scroll-view.tsx、hello-wave.tsx、external-link.tsx、ui/collapsible.tsx（先确认）
- [ ] 移除 lib/theme-provider.tsx:64 console.log
- [ ] 评估 app/prep-sections.tsx 是否删除（无入口）
- [ ] 评估 app/dev/theme-lab.tsx 是否删除

## EAS Build 57 状态

## 后端链路健康（2026-07-20 实测）
- CF Worker 在线：`/api/ai/enrich-bottle` 正常返回参数校验错误（服务活着）✓
- `/api/sync/pull` 未注册设备返回 401 Unauthorized（鉴权正常）✓
- `/api/balance` GET 返回空（可能需要鉴权头，客户端仅用于余额显示，低危）
- 客户端 9 条设备/同步路由 + `/api/ai/*` 智能路由（smart-router，带超时+重试）

## Phase 2 界面顺序审查（实测代码行号）

### me.tsx（我的）
大标题 → 数据总览 → 功能入口（标签管理/批量导入/卡片标签/书籍导入/冰块成本）→ 数据管理&设备同步（数据管理入口/云端同步状态/设备管理 或 创建·加入同步组）→ 语言设置 ✓ 符合用户最新要求

### recipe/[id].tsx（配方详情）
Header → Variant/研发回链 → Meta → Rating → 配料(502) → 装饰(577) → 步骤(651) → 风味(681) → 笔记(729) → 故事(742) → 来源(752) → SourceRef(787) → 成本(877) → 结构公式(1150) → 成品照片(1176) → 照片Modal ✓ 符合用户要求（步骤在装饰后、成本/结构在来源后）

### homemade/[id].tsx（自制详情）
Header → 标签分区 → Rating → …内容… → 成本(366，在来源后) ✓

### bottle/[id].tsx（酒款详情）
Header → 标签分区 → 开瓶标签 → Rating → 风味标签 → 故事 → 风格描述 → 深度资料 → 双语描述 → 关联推理

### recipe-form.tsx（配方编辑）
智能导入条 → 双语名称 → AI补全 → 分类 → 基酒 → Codex家族 → Variant → 饮用时长 → 场合 → 风味标签 → 手法 → 强度 → 杯型 → 冰型 → 配料 → 装饰 → 步骤(2188) → 风味三段式 → 笔记 → 故事 → 来源 → SourceRef → 保存

### 空 onPress 检查
recipes.tsx:971 的 onPress={() => {}} 是 Modal 内容区阻止冒泡的标准手法，非 bug ✓

- Cloud PC 上 eas build 报错 "Found config at metro.config.js that could not be loaded with Node.js"（eas-cli 20.5.1 本地配置解析问题），待解决：可能需升级 eas-cli 到 21.x
- 最新 commit：295f230（照片导入 iOS ph:// 修复 + Modal 全屏预览）
- buildNumber 已被 EAS remote 递增到 61（多次失败尝试），实际 TestFlight 最新为 build 56
