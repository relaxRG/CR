# cocktail R — AGENTS.md

> 本文件供 AI Agent（Manus）在每次会话开始时优先阅读，了解项目现状、开发规范和关键约定。

## 项目概览

| 字段 | 值 |
|------|-----|
| 项目名 | cocktail R |
| 技术栈 | Expo (React Native) + TypeScript + NativeWind + Drizzle |
| Bundle ID | `com.app.cocktailrecipes` |
| 当前 Build | **139**（app.config.ts `buildNumber`） |
| EAS Project ID | `3ab89cc0-c646-4fb8-bceb-ba24204a8811` |
| EAS Owner | `rgsds-team` |
| App Store Connect App ID | `6788653669` |
| GitHub 仓库 | `relaxRG/CR` |
| CF Worker URL | `https://cocktail-ai.kikikong2017.workers.dev` |

## 当前状态（2026-08-11）

- **代码质量**：TypeScript 0 错误，vitest 624/625 通过（1 skipped）
- **最新 commit**：`c694523` — "docs: API 金额字段精度注释 + 生产监控大盘配置"
- **待触发**：EAS Build 57（代码已完成，等待 Apple 凭证文件就位后触发）

## 关键文件索引

| 文件 | 职责 |
|------|------|
| `app.config.ts` | Expo 应用配置（Bundle ID、buildNumber、插件） |
| `eas.json` | EAS Build/Submit 配置（凭证路径、ASC API Key） |
| `credentials.json` | 本地 iOS 凭证映射（profile + p12 路径） |
| `todo.md` | 全量功能待办清单（按 Build 分组） |
| `TASK_CONTEXT.md` | 最新 Build 的任务上下文和已修复问题 |
| `.manus-worknotes.md` | AI 工作笔记（历史决策记录） |
| `.manus-worknotes-build57.md` | Build 57 专项工作笔记 |
| `docs/testflight-upload-guide.md` | TestFlight 上传完整指南 |
| `scripts/trigger-eas-build.sh` | EAS Build 触发脚本 |
| `lib/cf-sync/provider.tsx` | 云同步引擎（AppState 前台同步、LWW 冲突策略） |
| `app/device-manager.tsx` | 设备管理页（同步组短码、配对码、危险操作） |
| `lib/recipes/smart-link.ts` | 智能链接引擎（配料→酒款/自制品匹配） |
| `lib/bottles/style-normalize.ts` | 酒款风格归一化（AI 补全→taxonomy 映射） |
| `lib/import/apple-books.ts` | Apple Books 摘录解析（Bug 9 修复） |

## 架构说明

### Tab 结构
- **研发 Tab** (`index.tsx`)：酒单 / 研发实验室 / 门店（含门店酒单/采购清单）
- **资料库 Tab** (`library.tsx`)：酒款库 / 自制库
- **书库 Tab** (`books.tsx`)：EPUB/PDF 导入 + 阅读器
- **我的 Tab** (`me.tsx`)：数据总览 / 功能入口 / 同步与数据 / 语言

### 云同步架构
```
客户端 AsyncStorage
    ↓ cfPush（推送本地变更）
Cloudflare Worker D1（SQLite）
    ↓ cfPull（增量拉取，支持 since 参数）
客户端 LWW 合并（client_updated_at 新者胜）
```
- AppState 前台激活自动同步（60s 节流）
- 实时推送：WebSocket 智能轮询（ws-sync.ts）

### 考勤/薪资数据流
```
shifts（排班）→ calcFromShifts() → MonthlyAttendance → buildPaySlipDraft() → PaySlip → UI
```

## 开发规范（必读）

1. **持久化数据必须显式归零**：业务数据清空时，必须主动重算并写入存储，不能跳过写入
2. **单一数据源原则**：排班→考勤→薪资单，禁止在 UI 层重复计算
3. **自动同步 useEffect 依赖数组必须完整**：包含 `shifts`、`currentMonth`、`employees`、`advances`
4. **废弃代码立即删除**：不留注释占位符，历史由 Git 保存
5. **TypeScript 零错误**：每次提交前必须 `pnpm check` 通过
6. **vitest 全绿**：每次提交前必须 `pnpm test` 通过

## TestFlight 上传前置条件

需要以下文件放置在 `~/.apple-creds/` 目录：

| 文件名 | 说明 |
|--------|------|
| `AuthKey_SS7N6Q2U48.p8` | App Store Connect API Key |
| `profile_eas.mobileprovision` | iOS Distribution Provisioning Profile |
| `distribution_eas.p12` | Distribution Certificate（密码见 credentials.json） |

触发命令：
```bash
cd ~/cocktail-r
export EXPO_TOKEN=<你的 Expo 访问令牌>
bash scripts/trigger-eas-build.sh --submit
```

> 详见 `docs/testflight-upload-guide.md`

## 已知缺口（不阻塞发布）

- 阅读器书签/进度不参与云同步
- 照片文件不上传云端（仅本地路径同步）
- 卡片标签设置不同步
- 标签管理系统升级（CategoryGroup 分组功能）部分待完成
- 虚拟条目机制重构（阶段 2-4）待完成
