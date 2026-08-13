# H5 导出稳定性与 Worker 日志安全审计

**作者：Manus AI**  
**审计范围：** H5 静态导出、两套 Chromium 端到端脚本、`pdfjs-dist` PDF 解析链路、Cloudflare Worker 的控制台日志与同步认证错误码。  
**结论：** 已移除导致 H5 导出子进程被终止的本地 PDF Worker 静态编译路径；两套 H5 端到端脚本均改为专用测试标签页并有 CDP 超时保护；Worker 已上线固定脱敏诊断码。线上历史原始日志当前不可读取，因为 Worker 设置未启用持久化可观测性且没有 Tail Consumer。

## 1. 根因与修复

| 问题 | 根因 | 已实施修复 | 防回归边界 |
|---|---|---|---|
| `pdfjs-dist` 编译子进程收到 `SIGTERM` | `lib/import/extract.ts` 的两个 PDF 流程静态可解析地动态导入 `pdf.worker.entry`。Metro 因此需要转换约 2 MB 的 legacy Worker，Expo 导出使用的转换子进程在受限环境中被终止。 | 删除两个 `pdf.worker.entry` 导入；只动态导入主 PDF 库，并配置与锁定版本 `2.16.105` 一致的浏览器按需 Worker URL。 | `tests/pdf-web-export-stability.test.ts` 断言不存在真实本地 Worker 导入，且 CDN Worker 版本与 `package.json` 一致。 |
| H5 端到端回归可能接管登录页面或无限等待 | 两个脚本均选择 CDP 返回的第一个浏览器页面；页面可能是用户的 Cloudflare 登录页。CDP 请求没有超时。 | 两个脚本都用 DevTools `PUT /json/new?about:blank` 创建专用测试页，并为每个 CDP 请求设置 15 秒上限。 | 任意挂起会显式返回 `CDP_TIMEOUT:<method>`；测试导航只发生在专用空白页。 |
| Worker 日志可能包含上游异常正文或业务敏感值 | AI/OCR 回退、初始化和定时任务曾直接写入 `e.message`、余额金额或邮件发送结果。上游错误正文可能包含供应商诊断信息。 | 改为固定诊断码，如 `DEEPSEEK_FALLBACK`、`PRIMARY_MODEL_FALLBACK`、`BALANCE_CHECK_FAILED`。 | `tests/worker-log-redaction.test.ts` 禁止控制台日志引用 `.message` / `.stack` 或含令牌、配对码、设备令牌、余额的插值。 |

> Cloudflare 的 Worker 多部分上传要求 `metadata` 指明入口与绑定；本轮部署以 `bindings_inherit=strict` 上传，保留 D1 与所有 Secret 绑定，不读取或重写秘密值。[1] [2]

## 2. 受影响逻辑与清理结果

| 逻辑/引擎 | 旧行为 | 新行为 | 旧路径状态 |
|---|---|---|---|
| Web PDF 文本提取 | 强制加载本地 fake Worker。 | 主库按需加载，浏览器从同版本 Worker URL 加载 Worker。 | 两处 `pdf.worker.entry` 导入已删除。 |
| Web PDF OCR 渲染 | 与文本提取重复导入本地 Worker。 | 复用单一 `loadWebPdfJs()` 配置。 | 重复路径已删除。 |
| 排班纠错 H5 E2E | 选择第一个浏览器目标，可能影响用户页面。 | 创建独立的 `about:blank` 目标。 | `getPageTarget()` 已删除。 |
| 主题热切换 H5 E2E | 同样选择第一个浏览器目标，无请求超时。 | 使用独立目标与 15 秒 CDP 超时。 | 对称旧实现已删除。 |
| Worker AI/OCR/Cron 日志 | 原样写入异常消息、余额或通知状态。 | 仅写入固定、有限的诊断码。 | 原始消息/数值日志已删除。 |
| 同步切组认证日志 | 需可诊断失效成员资格，又不能记录设备身份。 | 仅记录 `hasDeviceId` 布尔值和固定错误码；D1 审计表只存切换 ID、事件、错误码和时间。 | 未记录设备令牌、配对码、完整设备 ID 或同步内容。 |

## 3. 线上日志与错误码脱敏审计

通过 Cloudflare 官方 Settings API 的只读检查，线上 Worker 返回 `observability: null` 且 `tail_consumers: []`。因此不存在可导出的历史持久化 Worker 原始日志；这避免了追溯性日志泄露，但也意味着生产故障只能通过脱敏诊断码、D1 切组事件与指标定位。

| 通道 | 允许保留 | 明确禁止 | 当前状态 |
|---|---|---|---|
| HTTP 错误响应 | 稳定错误码，如 `SOURCE_MEMBERSHIP_UNAVAILABLE`、`PAIR_CODE_UNAVAILABLE`、`DEVICE_AUTH_UNAUTHORIZED`。 | 原始异常、SQL、设备令牌、配对码、请求体。 | 已符合。 |
| Worker 控制台 | 固定事件码、布尔存在性、不可逆状态。 | `error.message`、`error.stack`、供应商正文、余额、邮件接收方、令牌。 | 已符合并由测试锁定。 |
| D1 `group_switch_events` | 切换 ID、事件、错误码、时间。 | 恢复票据明文、设备令牌、配对码、同步条目内容。 | 已符合。 |
| 客户端切组诊断 | 阶段、稳定错误码、不可逆的组提示。 | 密钥、配对码、完整身份、业务数据。 | 已符合。 |

线上只读核验结果如下：健康接口返回 `200` 及 `version: v4`；无凭据快照返回 `401 {"error":"Unauthorized"}`；线上部署内容中未发现任何 `console.*(e.message|e.stack)` 匹配，且已发现新的固定脱敏码。

## 4. 验证结果

| 验证项 | 结果 | 说明 |
|---|---:|---|
| Vitest | 通过 | 完整回归包含 PDF 导出与 Worker 日志脱敏护栏。 |
| TypeScript | 通过 | `pnpm check` 零错误。 |
| Worker 语法 | 通过 | `node --check workers/cocktail-ai/worker-v4.js`。 |
| 跨组故障注入 | 通过 | 5 项 SQLite/D1 关系模型测试，包括恢复加入不得泄漏 A 组数据。 |
| H5 排班纠错 E2E | 通过 | 静态导出成功；375/390/430pt、桌面缩放、月报状态、库存抽屉和筛选标签均通过。 |
| H5 主题热切换 E2E | 通过 | 375pt 下浅色→深色→浅色无需重载，且无横向溢出。 |
| 线上 Worker 健康核验 | 通过 | 最新脚本成功上传，健康与受保护接口状态符合预期。 |

## 5. 开发规范

后续涉及高体积 Web-only 库、浏览器自动化或错误日志时，必须遵守以下规则。

1. **导出边界。** 大型 Worker、WASM、PDF/OCR 引擎不得以可静态分析的本地入口直接导入通用模块；应使用按平台隔离模块或同版本、可控的浏览器 Worker 地址，并为入口大小与导出成功增加测试。
2. **浏览器隔离。** 自动化测试永远不得选择“第一个浏览器页面”；必须新建专用空白页面，所有 CDP 请求必须有超时和 `finally` 清理。
3. **错误码优先。** 对外响应和日志只能使用稳定错误码；错误码与用户文案映射在客户端完成。禁止将上游的 `message`、`stack` 或请求体传入日志、HTTP 响应和持久化审计表。
4. **部署继承。** Worker 代码上传必须使用严格绑定继承；先读取绑定元数据，上传后只读核验入口、保护接口和日志护栏，禁止复制或打印 Secret 值。
5. **横向修复。** 修复某一个 CDP、PDF 或认证入口时，必须搜索所有同类实现，统一迁移并删除旧实现，不保留“临时兼容”分支。

## References

[1]: https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/ "Cloudflare API — Upload Worker Module"
[2]: https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/ "Cloudflare Workers — Multipart upload metadata"
