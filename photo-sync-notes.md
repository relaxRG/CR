# 成品照片云同步实施笔记（2026-07-20）

## 关键信息（来自 AGENTS.md on Cloud PC /mnt/8nvfg1b9jri3knper5bqadk6a/ubuntu/AGENTS.md）
- Worker: cocktail-ai.kikikong2017.workers.dev
- Worker 脚本: Cloud PC `~/cf-worker-deploy/worker.js`（最新，含 Workers AI 降级、Build57 patch）
- 部署命令: `cd ~/cf-worker-deploy && CLOUDFLARE_API_TOKEN=cfut_1YCQlb1uK1Zil8Df8HhDMH8ulL9pfFL7DXgkIgYB0b44e0de wrangler deploy --no-bundle`
- D1: cocktail-r-db (1fe2ef35-4bcd-42b7-a872-bc93d03593c6)
- Account ID: c079066172316a7f47847b1277208cec
- wrangler.toml: `~/cf-worker-deploy/wrangler.toml`（[ai] binding + D1 + cron）
- wrangler 3.114.17 已装在 Cloud PC
- EXPO_TOKEN: x_5a1Tebvrgg5bHFMcdBmkjHj5IutY-4zBRfzpHs
- Cloud PC session 前缀: cloud-pc-8nvfg1b9:{sessionId}

## 客户端现状
- 照片存 `${documentDirectory}recipe-photos/` 目录，文件名 `{recipeId}_{ts}.{ext}`
- Recipe.photoUris: string[]（必填数组），lib/recipes/photo.ts persistPhoto/deletePhoto
- 同步引擎 lib/sync/engine.ts：SYNC_KEYS JSON 键值同步，照片文件不上传
- 客户端同步 API：lib/cf-sync/*（provider.tsx），smart-router lib/api/smart-router.ts（CF_WORKER_URL from expo extra）
- recipe/[id].tsx 内 handlePickPhoto → ImageManipulator 压缩到 1600px JPEG0.8 → persistPhoto

## 设计方案（无 R2 权限风险 → 用 D1 base64 存储）
照片已压缩（1600px JPEG 0.8 ≈ 200-400KB），D1 单行上限 ~2MB，可存 base64（~1.33x）。
- 新表 photos: (group_id, photo_id TEXT PK, recipe_id, data_base64 TEXT, content_type, size, client_updated_at, deleted)
- photo_id = 文件名（recipeId_ts.ext），全组唯一
- API:
  - POST /api/photos/upload {photoId, recipeId, dataBase64, contentType} (device token 鉴权)
  - POST /api/photos/list {since} → [{photoId, recipeId, size, clientUpdatedAt, deleted}]
  - POST /api/photos/download {photoId} → {dataBase64, contentType}
  - POST /api/photos/delete {photoId}
- 客户端 lib/sync/photo-sync.ts：
  - uploadPendingPhotos(): 扫描本地 photoUris → 未上传（AsyncStorage 记录 uploaded set）→ base64 读取 → upload
  - downloadMissingPhotos(): list → 本地缺失的 → download → 写入 PHOTO_DIR（同名文件）→ 修复 photoUris 路径（documentDirectory 前缀在设备间不同！需按文件名匹配）
  - 关键：photoUris 存的是绝对路径 file:///...documentDirectory 不同设备不同 → 下载后需将 recipe.photoUris 中的路径重写为本机路径（按文件名尾段匹配）
- 挂到 performSync 流程后（provider.tsx），非阻塞
- i18n：新增少量键（照片同步状态，可选）

## 实施进度（2026-07-20）
- [x] Worker 端 4 条照片 API 已部署（Version 15360e4f-33b2-4a3c-a5d0-aee3e79be21e），带 ensurePhotosTable 自动建表，验证 401 正常
  - patch 脚本：Cloud PC ~/cf-worker-deploy/patch-worker-photos.py，备份 worker.js.bak-photos
  - 注意：CF token 对 D1 REST API 无权限（7403），只能 wrangler deploy；建表靠 Worker 内 ensurePhotosTable
- [x] 客户端 lib/sync/photo-sync.ts 创建（syncPhotos / deleteCloudPhoto）
- [x] provider.tsx performSync 成功后 void syncPhotos()，下载/修复后 triggerStoreReload()
- [ ] store.tsx deleteRecipePhoto 接入 deleteCloudPhoto
- [ ] 遮挡修复：homemade.tsx 多选操作栏被 Tab 栏遮挡、bottles.tsx(酒库) FAB 与 Tab 栏重叠（用户截图报告）
- [ ] vitest photo-sync 测试 + checkpoint

## 其他关键信息
- 客户端鉴权头: X-Device-Id / X-Device-Token（lib/cf-sync/client.ts cfFetch）
- recipes 持久化 key: cocktail.recipes；store.tsx deleteRecipePhoto 在 38 行
- EAS Build 57 未触发成功：Cloud PC eas-cli 20.5.1 + Node22 读 metro.config.js 报错（待处理）
- EXPO_TOKEN: x_5a1Tebvrgg5bHFMcdBmkjHj5IutY-4zBRfzpHs

## FAB/多选操作栏统一修复排查（2026-07-20）
### 现状
- FloatingTabBar（components/floating-tab-bar.tsx）: 浮岛式，`bottom: max(insets.bottom,8)+8`，container 高约 56（paddingV 6 + tab 内容），左右 16。总占用 ≈ insets.bottom+8+8+56 ≈ 106（iPhone带Home条 insets.bottom=34 → 顶到约 106px）
- 导出常量 FLOATING_TAB_BOTTOM_OFFSET = 90（floating-tab-bar.tsx:82）
- 共享组件已存在：components/fab.tsx（Fab, bottom 默认 90）、components/bulk-action-bar.tsx（BulkActionBar bottom:0 全宽贴底 ← **被 Tab 栏遮挡的根因**）
### 问题清单
1. BulkActionBar（bottles/homemade/recipes 共用）: `position:absolute; bottom:0` 全宽贴底栏，被浮岛 Tab 栏盖住 → 需改成浮岛式卡片，bottom = tab栏顶部 + 12
2. bottles.tsx:1222 / homemade.tsx:945 / recipes.tsx:832 FAB: `bottom: insets.bottom+72` 仍与 Tab 栏重叠（Tab 栏顶 ≈ insets.bottom+16+56=insets.bottom+72，正好贴着，视觉重叠）→ 统一 bottom = insets.bottom + 16 + 56 + 16 = insets.bottom + 88
3. menu.tsx:1084 FAB `bottom:20` 完全被遮 → 同上统一
4. menu.tsx batchBar 是顶部工具栏（borderBottom, 在页面顶部）不遮挡，无需改位置
5. 四页自绘 fab styles 重复，未用共享 Fab 组件（可后续统一，本次先统一 bottom 值）
### 方案
- floating-tab-bar.tsx 导出 TAB_BAR_SAFE_GAP 计算函数或常量：`FAB_BOTTOM = insets.bottom + 88`、`BULK_BAR_BOTTOM = insets.bottom + 80`（浮岛栏顶部 insets.bottom+72，再留 8-16 间距）
- BulkActionBar 改浮岛卡片样式：left/right 16、borderRadius 20、borderWidth hairline、shadow 同 Tab 栏、bottom 动态传入

### 修复进度（2026-07-20 22:08）
- ✅ floating-tab-bar.tsx: 新增 tabBarTop()/fabBottom()/bulkBarBottom() 帮助函数
- ✅ bulk-action-bar.tsx: BulkActionBar 改浮岛卡片（left/right 16, borderRadius 20, shadow, bottom=bulkBarBottom(insets.bottom)）
- ✅ bottles/homemade/recipes.tsx: FAB bottom → fabBottom(insets.bottom)，import 已修复（homemade 曾错位插入 import 已修正）
- ✅ menu.tsx: FAB bottom:20 → fabBottom(insets.bottom)，import 已加
- ✅ tsc 0 errors（22:08）
- 待办: 重启 dev server 清除 Metro 缓存错误 → 截图验证 → checkpoint → 触发 EAS Build 57（Cloud PC eas-cli 与 Node22 兼容问题待解决：npm i -g eas-cli@latest）
- 照片同步客户端已完成（lib/sync/photo-sync.ts + provider.tsx 挂载 + store.tsx deleteRecipePhoto 云端删除），Worker photos API 已部署验证
