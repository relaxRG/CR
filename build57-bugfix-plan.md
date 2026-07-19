# Build 57 升级方案（五个问题 · 根因分析与严谨修复方案）

本文档为 Build 56 反馈的三个原有 Bug 加上本次新增两个问题的**完整升级方案**。所有问题均已完成代码级根因定位（客户端 cocktail-r 仓库 + 云电脑上的 Cloudflare Worker 源码），**尚未修改任何代码**，待您确认后按序实施。

| # | 问题 | 严重度 | 根因层 | 改动面 |
|---|------|--------|--------|--------|
| 1 | 配方装饰条目点击跳转错乱 | 中 | 客户端智能链接 | 小（2 文件） |
| 2 | 自制库点"脱水菠萝"直接打开编辑表单 | 中 | 客户端列表入口 | 小（1-2 文件） |
| 3 | 书内图片显示为问号 | 高 | iOS WKWebView 安全策略 | 极小（1 处条件） |
| 4 | AI 识别补全未自动填充风格 Style | 中 | Worker 与客户端风格值域不一致 | 中（客户端 + Worker） |
| 5 | Mac 端更新未同步到手机 | 高 | 同步架构三处缺陷 | 中（客户端 + Worker） |

---

## 问题 1 + 2：装饰条目点击打开「编辑酒款」表单（同一根因链）

### 根因

应用中存在一类特殊条目：在「编辑酒款」表单里把**所属库**设为「自制库」的酒款（数据上是 `Bottle`，带 `libraryOverride: 'homemade'` 标记，例如"脱水菠萝"）。这类条目在自制库列表中以"虚拟自制品"（`bottle-override-{id}`）形式展示，但它**没有任何入口通向详情页**：

| 入口 | 当前行为 | 代码位置 |
|------|---------|---------|
| 自制库列表点击该条目 | 直接打开 `/bottle-form` 编辑表单 | `homemade.tsx` 第 1323 行 |
| 配方详情页装饰行点击 | 智能链接 auto 模式**主动排除**这类酒款，匹配不到本尊，可能模糊匹配到其它同名条目或无链接 | `smart-link.ts` 第 79 行 |

`bottle/[id].tsx` 详情页本身没有任何重定向逻辑，是正常的。问题全部出在入口层。

### 升级方案（相比上一版的强化点以 ★ 标注）

1. **自制库列表点击改跳酒款详情页**（homemade.tsx）：虚拟条目点击时 `router.push("/bottle/{id}")`；编辑入口收敛到详情页右上角铅笔按钮，与普通酒款交互完全一致。
2. **智能链接放开排除**（smart-link.ts）：auto 模式允许匹配 `libraryOverride='homemade'` 的酒款，装饰行"脱水菠萝"恢复可点击 → 跳酒款详情页。
3. ★ **匹配优先级细化**：当同名条目同时存在于真实自制库（prep）与 override 酒款时，优先精确名称匹配、再按"自制品 > override 酒款 > 普通酒款"的层级取链接，避免同名歧义（此前方案未覆盖该边界）。
4. ★ **详情页归属徽章**（bottle/[id].tsx）：对 override 条目显示「自制库」徽章，并在徽章旁提供"在自制库中查看"的轻量入口，双向可达。
5. ★ **回归测试**：为 smart-link 新增 vitest 用例——override 酒款可匹配、同名 prep 优先、成本引擎（smart-cost.ts 已有 `bottle-override-` 回退逻辑）计价不回归。

### 风险评估

改动 1、4 为纯展示/跳转层，无数据影响。改动 2、3 触及智能成本估算与自动入库共用的匹配函数，将以测试用例锁定行为：成本仍按酒款价格计算（`smart-cost.ts` 对 `bottle-override-` 已有专门回退），自动入库（auto-add）不会因放开匹配而重复建条目。

---

## 问题 3：书内图片显示为问号占位符

### 根因

Build 56 的 P3 性能优化把 iOS/Android 的章节图片从 base64 内联改为 `file://` 直读（`book-reader.tsx` 第 953 行）。但阅读器 WebView 采用 **HTML 字符串 + baseUrl** 方式加载（第 602 行 `source={{ html, baseUrl }}`），iOS 的 WKWebView 在这种加载模式下，`allowingReadAccessToURL` / `allowFileAccessFromFileURLs` 均不生效（它们只对 `loadFileURL` 模式有效），所有 `file://` 子资源被安全策略拦截 → 真机图片全部显示为问号。Android 的 WebView 无此限制。

### 升级方案

1. **平台分流**：第 953 行条件由 `iOS || Android` 收敛为**仅 Android** 走 `file://` 快路径；iOS 恢复 `inlineImagesAsBase64`（Build 55 的成熟路径，函数完整保留且带章节 LRU 缓存，重复翻阅零重复编码）。
2. ★ **iOS base64 内联加并发上限与体积保护**：单章图片按顺序编码、超大图（>2MB）先经 `expo-image-manipulator` 压缩再内联，避免超长章节内存峰值（原方案未包含，属于严谨性补强）。
3. ★ **失败兜底**：单张图片读取失败时以占位样式显示"图片加载失败"而非破坏整章渲染。

### 风险评估

iOS 图多章节首次加载略慢于 file:// 方案，但换来的是确定性正确；Android、Web 路径不变。

---

## 问题 4（新增）：AI 识别补全未自动填充风格 Style

### 根因（三方值域不一致 + 服务端抹空）

以截图中的 "Banks Five Island Rum" 为例，链路上有两处断点：

1. **Worker 端白名单抹空**：Cloudflare Worker 的 `enrich-bottle` 路由维护了一份 `BOTTLE_STYLES_MAP`（worker.js 第 189 行），并对 AI 返回的 style 做严格白名单校验——不在列表中就**直接置为空字符串**（第 621-629 行）。
2. **值域与客户端不一致**：Worker 的朗姆风格列表是 `["White/Blanco", "Gold/Oro", "Dark/Añejo", …]`，而客户端 `taxonomy.tsx` 的风格 chip 值是 `["White / Light", "Gold", "Aged / Añejo", "Dark / Black", …]`。即使 AI 返回了 Worker 认可的值（如 `White/Blanco`），传回客户端后 chip 的选中判断 `style === d.name`（bottle-form.tsx 第 898 行）也永远不成立——风格既不亮 chip，字段面板里也常因被抹空而根本不出现。

也就是说：**AI 大概率识别出了风格，但被服务端校验抹掉，或被客户端值域不匹配"吞掉"了**。

### 升级方案

1. **单一事实源**：以客户端 `taxonomy.tsx` 的风格定义（`name` 值域）为唯一标准，重新生成 Worker 的 `BOTTLE_STYLES_MAP`，并让 prompt 中的候选列表直接引用同一份数据，三方（prompt 候选 → Worker 校验 → 客户端 chip）值域完全一致。
2. **Worker 校验由"抹空"改为"归一化"**：AI 返回值不在白名单时，先做模糊映射（忽略大小写、空格、斜杠差异，及常见别名如 `White/Blanco → White / Light`），映射失败才置空；同时保留原始值放入 `styleRaw` 字段供客户端落入自定义输入框，绝不丢信息。
3. **客户端兜底映射**：`applyField` 应用 style 时对照当前分类的 taxonomy 再做一次归一化；命中则 chip 正常点亮，未命中则填入"或自行填写风格"输入框，两条路都有明确去处。
4. ★ **回归测试**：vitest 覆盖归一化函数（大小写/斜杠/别名/未知值四类用例）；Worker 侧改动经 `wrangler deploy` 后用 curl 实测 "Banks Five Island Rum"、"Tanqueray No.10" 等样例验证 style 非空且在客户端值域内。

### 风险评估

Worker 改动会使 KV 缓存中的旧 enrich 结果（1h TTL）短暂返回旧值域，归一化兜底在客户端也有一层，双保险。拍瓶识别（OCR 路由）返回的 style 同样经过该归一化，一并受益。

---

## 问题 5（新增）：Mac 端更新未同步到手机

### 根因（同步架构三处缺陷，均已在源码中确认）

| # | 缺陷 | 位置 | 后果 |
|---|------|------|------|
| A | **拉取只在 App 冷启动时执行一次**：`performSync` 仅在 Provider mount 时调用，无前台激活监听、无周期拉取 | `lib/cf-sync/provider.tsx` 第 172-182 行 | iOS App 常驻后台数天不重启 → 手机**永远**看不到 Mac 之后的更新。这是最可能直接命中您现象的根因 |
| B | **服务端 push 无时间戳守卫**：`INSERT OR REPLACE` 直接覆盖，不比较 `client_updated_at` | Worker `handleSyncPush` | 旧数据可以覆盖新数据——手机若在未拉取的情况下改动并 push 整键（如 `cocktail.bottles` 是一个整体 JSON 键），会把 Mac 的新内容顶掉 |
| C | **设备组隔离风险**：`/api/device/register` 每次注册都创建全新 groupId；Mac 端若从未用配对码加入手机所在组（或浏览器缓存清空后自动重新注册），两台设备各在一组，数据**从架构上就不互通** | Worker `handleDeviceRegister` + `client.ts getOrCreateDevice` | 同步看似正常（无报错）但两边各写各的 |

注：由于当前 Cloudflare API Token 无 D1 读取权限，无法直接查库确认您两台设备是否同组；方案中包含让 App 自己把组信息透出的改动，实施后即可自查。

### 升级方案（按缺陷逐项对应）

1. **前台激活自动拉取（对应 A）**：在 SyncProvider 中加 `AppState` 监听，App 回到前台且距上次同步超过 60 秒时自动执行增量拉取（利用 Worker `sync/pull` 已支持但客户端从未使用的 `since` 参数，只拉变化键），合并后触发 store reload，界面即时刷新。手动兜底：设备管理页已有的「立即同步」按钮保持全量同步。
2. **服务端 LWW 守卫（对应 B）**：`handleSyncPush` 改为 `INSERT ... ON CONFLICT DO UPDATE ... WHERE excluded.client_updated_at > sync_data.client_updated_at`，时间戳更新者才能写入，从根上杜绝旧盖新。
3. **同步组自检与可视化（对应 C）**：设备管理页顶部显示当前**同步组短码**与组内设备列表来源提示；当组内只有本机一台设备时显示醒目提示"此设备未与其他设备配对，数据不会互通"，并引导走配对码流程。这样您打开 Mac 与手机的设备管理页，比对短码即可立刻确认是否同组。
4. ★ **同步状态透明化**：设备管理页显示"上次拉取时间 / 上次推送时间 / 待推送脏键数"，问题再出现时可自诊断。
5. ★ **回归测试**：engine 增量合并逻辑的 vitest 用例（远端新→覆盖本地、本地新→上传、tombstone 处理）；Worker LWW 用 curl 双设备模拟验证。

### 排查建议（实施后请您配合验证一次）

升级后请在 Mac 与手机分别打开「设备管理」页：若两边组短码不一致，说明此前 Mac 一直在独立组（缺陷 C 命中），需在手机上生成配对码、Mac 输入加入；加入时会走初始合并，两边数据按时间戳择新合并，不会丢失。

---

## 实施顺序与验收标准

1. 问题 3（1 处条件 + 压缩保护，独立无耦合）
2. 问题 1+2（列表跳详情 → 智能链接放开 + 优先级 → 徽章）
3. 问题 4（taxonomy 单一事实源 → Worker 归一化部署 → 客户端兜底）
4. 问题 5（AppState 增量拉取 → Worker LWW 守卫部署 → 设备管理页自检 UI）
5. 验收：`tsc --noEmit` 0 错误、`vitest run` 全部通过、Worker curl 实测通过 → 保存 checkpoint
6. **Build 57 触发与 TestFlight 提交等您单独指令**

涉及 Cloudflare Worker 的两处改动（问题 4、5）将在云电脑 `~/cf-worker-deploy` 修改并用 wrangler 部署，部署前后各做一次 curl 冒烟验证，不影响现网 AI 补全可用性。
