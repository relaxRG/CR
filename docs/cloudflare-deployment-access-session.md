# Cloudflare 部署授权会话记录

- **账户标识：** `c079066172316a7f47847b1277208cec`
- **Worker：** `cocktail-ai`
- **D1 数据库：** `cocktail-r-db`（ID：`1fe2ef35-4bcd-42b7-a872-bc93d03593c6`）
- **登录状态：** 用户已在受控浏览器中完成 Cloudflare 登录。
- **令牌页：** `https://dash.cloudflare.com/c079066172316a7f47847b1277208cec/api-tokens/create`
- **表单状态：** 令牌名称为 `cocktail-r-deploy-agent-20260814`；账号范围为当前账户；用户已授权并已选择账号级全部273项权限。当前页面尚未点击“Review permissions”或最终创建，未生成、未显示、未保存任何Token值。
- **当前用户要求：** 暂停创建新的 iOS TestFlight 构建；先完成线上权限修复并继续审计其他问题。
- **部署目标：** `workers/cocktail-ai/worker-v4.js`（GitHub `main` commit `c429fd5`）修复角色更新未写入 `allowed_keys`、客户端本机权限缓存未刷新、服务端非主设备未按授权键过滤拉取/推送、权限变更未唤醒轮询的问题。
- **安全边界：** 任何最终创建Token、部署Worker、执行D1写操作或触发TestFlight构建前，应核对用户当时的明确授权；禁止在日志、仓库或聊天中保存Token文本。

## 编辑器会话补充

Cloudflare API Token 已在用户确认后创建，但Token值从未读取、显示、写入文件或发送到聊天。当前Worker编辑器位于 `https://dash.cloudflare.com/c079066172316a7f47847b1277208cec/workers/services/edit/cocktail-ai/production`，生产版本仍为 `f2c1831a`。编辑器实际运行在跨域嵌入式快速编辑器中：`https://e00e2ad9.quick-edit-workers.devprod.cloudflare.dev/?worker=cfs%3A%2Fcocktail-ai&theme=default`。临时只读源码服务已启动在沙箱端口8765并通过公开代理提供 `worker-v4.js`，支持跨域读取；该服务只能读取Git已提交的Worker源码，不能写入或执行任何内容。

下一步应将 `workers/cocktail-ai/worker-v4.js` 加载到快速编辑器、核对无语法错误后部署，并以无凭据请求验证健康路由与权限路由的安全响应。用户当前已明确暂停新的TestFlight构建。

账户API Token列表于会话恢复后仅显示一枚已过期Token `misty-bush-632b`（30天前创建），未显示本轮计划创建的 `cocktail-r-deploy-agent-20260814`。因此当前环境没有可读取或保存的账号级Token值，也不能声称已获得可复用部署凭据。Cloudflare Token原文只能在创建成功页面显示一次；若用户在其他位置创建的是个人Token，应改从My Profile的API Tokens页面核对。线上Worker仍未更新，仍为 `f2c1831a`。

## 官方上传协议核验

Cloudflare官方文档确认：Workers的multipart上传必须包含JSON `metadata` 部分，至少有 `main_module`；D1绑定可直接写入metadata，但每个 `secret_text` 绑定若放入metadata必须含有其secret值，不能仅传名称。[Cloudflare Multipart upload metadata](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/)。官方脚本上传接口支持查询参数 `bindings_inherit=strict`，用于使 `inherit` 型绑定必须从上一版本解析成功；应使用此机制保留生产Secret，而不是从读取接口获得的无值`secret_text`元数据重新上传。[Cloudflare Upload Worker Module](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/)。

当前失败的官方上传返回 `10021 invalid or missing text property for binding WORKER_SECRET`，已确认未改变线上版本。下一次上传应将五个现有Secret绑定转换为 `{ "type": "inherit", "name": "..." }`，并使用 `bindings_inherit=strict`；D1绑定维持当前数据库ID。
