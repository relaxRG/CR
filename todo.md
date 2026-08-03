# Project TODO

## 核心功能（已完成）
- [x] Build 96：实时推送同步（ws-sync.ts 智能轮询 + provider.tsx 接入 + 推送后通知 + 增量 pull）
- [x] 从 GitHub 仓库 relaxRG/cocktail-recipes 完整迁移代码
- [x] 安装所有依赖（react-native-draggable-flatlist、fflate、mammoth、pdfjs-dist 等）
- [x] 主题配色：iOS 系统色（systemBlue、系统灰阶背景）+ 深色模式适配
- [x] 数据层：Recipe/Category/Tag 类型、AsyncStorage 持久化、Context Provider
- [x] Tab 导航：酒单、酒库、书库、我的、menu
- [x] 酒单首页：搜索框、多维筛选面板、配方卡片列表、排序、空状态
- [x] 新建/编辑配方表单（动态配料行、分类选择、烈度/方法选择、AI 补全）
- [x] 配方详情页（配料、步骤、收藏、编辑、删除、成本估算、结构公式）
- [x] 标签管理页（分类/基酒/杯型/风味/场合/时长，增删改排序）
- [x] 收藏功能（卡片/详情星标 + 首页筛选）
- [x] 评分系统（1-10 星，列表展示，滑动手势评分）
- [x] 酒库（基酒库/酒款库/原材料库三分组，搜索筛选，参考价）
- [x] 酒款详情页（完整信息展示，AI 联网补全）
- [x] 成本估算引擎（智能匹配酒库/自制库，单位换算，冰块成本）
- [x] 自制原料库（糖浆/浸渍/发酵等，含酒精/无酒精分组，成本估算）
- [x] 粘贴智能导入（解析配方/酒款/自制品文本，中英双语）
- [x] 批量导入（PDF/Excel/Word 文件解析，批量创建）
- [x] 书库（EPUB/PDF 导入，阅读器，AI 扫描提取配方）
- [x] 研发实验室（项目管理，批次迭代，多版本对比，定稿转正）
- [x] 门店酒单（MenuProvider，独立菜单管理）
- [x] 云端同步（登录后自动同步，离线兜底，冲突策略）
- [x] 双语支持（中/英界面语言切换，全局词典）
- [x] 同名折叠（多版本配方/自制品折叠展示）
- [x] 对比分析（任意 2-6 项配方/自制品并排对比）
- [x] 滑动手势（左滑编辑/删除，右滑评分/做过）
- [x] 长按拖拽排序（酒单/酒库/自制库）
- [x] 批量操作（多选删除/批量改标签）
- [x] 经典变体识别引擎（60+ 经典锚点，自动判定变体归属）
- [x] Codex 家族识别（六大母配方，智能识别+手动修改）
- [x] ABV 自动计算（含摇和/搅拌稀释，匹配酒库酒精度）
- [x] 结构分析引擎（自动识别配料结构角色，生成结构公式）
- [x] 冰块成本体系（款式/规格/价格，自动计入配方成本）
- [x] 拍照/相册智能识别导入（多模态 LLM，三库通用）
- [x] 离线降级提示（网络状态检测，AI 功能离线提示）
- [x] 应用图标（简洁扁平马天尼杯，单色白色风格）
- [x] TypeScript 零错误编译

## 待完成
- [ ] 书籍卡片滑动操作（删除、分享、标记已读）

## Build 55 三大问题修复（2026-07-19）
### 云同步完整修复（D1 从未真正工作过）
- [x] CF Worker initDB：自动建表 + ALTER TABLE 迁移（补 owner_device_id/device_id/token/platform/is_active 列，建 sync_tombstones/kv_cache/balance_history/ai_usage_log 表）
- [x] CF Worker register/pair：尊重客户端传入 deviceId；响应同时返回 token + deviceToken
- [x] CF Worker pull：响应字段改驼峰（storageKey/clientUpdatedAt），匹配客户端期望
- [x] CF Worker list：返回映射字段（id/isCurrentDevice），匹配 RemoteDevice 类型
- [x] CF Worker verifyDevice：d.id → d.device_id SQL 修复
- [x] CF Worker balance：响应加 checkedAt 字段
- [x] Worker E2E 全链路验证 30/30 通过（双设备互通、配对码防重用、坏 token 拒绝、余额 9.68 CNY）
- [x] 临时 debug/schema 端点已移除并重新部署（Version 63df4c0c）
- [x] provider.tsx：performSync 管道提取 + 注册失败自动重试（指数退避 30s~10min，最多8次）
- [x] provider.tsx：暴露 retrySync/syncError 到 context
- [x] device-manager.tsx：「立即同步」按钮 + combinedError 错误可见
### iCloud 通道诚实化
- [x] device-manager.tsx：「iCloud Drive」改名「本机文档备份/Local Documents」，注明随 iCloud 整机备份
### 照片选择修复
- [x] recipe/[id].tsx：expo-image-manipulator 压缩（最大1600px/JPEG 0.8/统一 .jpg），消除扩展名缺陷
- [x] recipe/[id].tsx：iOS PHPicker 免相册权限（仅 Android 请求）；失败 Alert 可见（新增 i18n 键）
- [x] photo.ts persistPhoto：扩展名正则防御性提取，无法识别回退 jpg
### 余额查询修复
- [x] device-manager.tsx：/api/balance/check → /api/balance（原 404）
### 工程
- [x] vitest.config.ts：@/ 别名解析修复（19 单测全部通过，此前 2 个套件加载失败）
- [x] TypeScript 零错误

## 基酒标签体系重构（2026-07-12）
- [x] BASE_SPIRITS 扩展到 12 个：新增梅斯卡尔、卡沙萨、皮斯科（基于 IBA 官方配方和专业文献）
- [x] TAG_NAME_DICT 添加新基酒的英文映射
- [x] store.tsx 迁移逻辑：已有用户自动注入缺失的新基酒标签
- [x] server/routers.ts enrichRecipe：默认基酒列表更新为 12 个，支持 ingredientsWithAmounts 传参
- [x] server/routers.ts：多基酒等量时用逗号分隔返回，isMultiBaseSpirit 字段
- [x] recipe-form.tsx：新增 MultiSpiritChipGroup 组件支持多选基酒
- [x] recipe-form.tsx：AI 补全传入 ingredientsWithAmounts 用量数据
- [x] recipe-form.tsx：置信度 UI（高=绿色/中=橙色/低=红色边框 + AI 标签）
- [x] recipe-form.tsx：低置信度显示提示横幅，不自动选中
- [x] recipe-form.tsx：高置信度自动选中，用户可手动修改后清除 AI 标记
- [x] icon-symbol.tsx：添加 info.circle 和 exclamationmark.triangle 图标映射
- [ ] 字体选择（系统字体/衬线字体/无衬线字体）
- [ ] 书籍分类与标签
- [ ] 书籍笔记与高亮功能
- [ ] 书籍统计数据
- [ ] 拖拽导入书籍
- [ ] 批量导入多个书籍文件
- [ ] 批量导入多个书籍文件

## 门店酒单重构（2026-07-12）
## 门店模块全面重构（2026-07-12）
### 数据层
- [x] lib/menu/store.tsx：新增 ungroupedEntries 无分组配方支持
- [x] lib/menu/store.tsx：新增 BATCH_SET_PRICE 批量定价 action
- [x] lib/menu/store.tsx：新增无分组相关 action（ADD_UNGROUPED_ENTRY / REMOVE_UNGROUPED_ENTRY / SET_UNGROUPED_PRICE）
- [x] lib/menu/store.tsx：MenuEntry.available 改为在售/停售语义，新加入默认停售
  - [x] lib/shopping/store.tsx：新建采购清单数据 store（ShoppingItem/OnlineLink/OfflineNote）
### 门店酒单页（app/(tabs)/menu.tsx）
  - [x] 使用 RecipeCard 卡片化展示配方
  - [x] 每张卡片：在售/停售状态点 + 售价 + 利润率（成本来自 estimateRecipeCostSmart）
  - [x] 批量操作：多选 → 批量上架/下架/定价/移除
  - [x] 无分组配方直接加入酒单（分组可选）
  - [x] 新加入配方默认停售
### 采购清单页（app/(tabs)/shopping.tsx）
  - [x] 自动聚合所有「在售」配方的原材料
  - [x] 与酒库（烈酒/原材料）智能匹配，标注「已有」
  - [x] 与自制库智能匹配，自制品单独分区
  - [x] 同一原材料跨配方合并，显示关联配方列表
  - [x] 两大渠道分类：网络采购（URL+平台名）和酒商采购（备注）
  - [x] Linking.openURL 跳转网络购买链接
  - [x] 已采购标记（持久化）
  - [x] 手动添加额外采购项
### 主容器（app/(tabs)/index.tsx）
  - [x] Tab 名称「门店酒单」→「门店」
  - [x] 门店内部 Segmented Control：门店酒单 / 采购清单
  - [x] 接入 shopping.tsx 子页面
  - [x] 副标题更新（显示在售数量/待采购数量）
### i18n 和其他
  - [x] lib/i18n/translations.ts：新增 shopping.* 翻译键
  - [x] lib/i18n/translations.ts：更新 menu.* 翻译键（改名/新增）
- [x] TypeScript 零错误

## 书库导入分类准确性修复（2026-07-12）
- [x] detect.ts：扩展 PREP_NAME_RE 关键词（smoked/infused/wash/gum syrup/demerara 等 30+ 新词）
- [x] detect.ts：新增 classifyCandidateKindEnhanced（名称+配料+步骤+章节标题综合判断，返回置信度）
- [x] book-import.tsx：修复重复检测分库隔离（recipe/prep 各自独立 Set，不再互相误判）
- [x] book-import.tsx：所有扫描路径（localScan/runAiScan/proceedToConfirm）统一使用增强分类
- [x] book-import.tsx：confirm phase UI 显示彩色分类标签（→配方库/→自制库）
- [x] book-import.tsx：kind switcher 改为「🍸 配方库 / 🧪 自制库」更直观
- [x] TypeScript 零错误
## 书库阅读器全面修复（2026-07-12）
### extract.ts 修复
- [x] 封面检测增强：支持 meta name=cover、guide 元素、修复路径拼接
- [x] HTML 实体解码：书名/作者/章节标题正确显示（& → &、&amp; → &）
- [x] 章节 HTML 图片路径重写为绝对 file:// 路径（文件系统模式）
### book-reader.tsx 重构
- [x] 修复 baseUrl：正确传递 file:// 前缀目录路径给 WebView
- [x] 图片限高 CSS（max-height: 45vh + object-fit: contain）防止大图撑破分页
- [x] 图片点击全屏查看器（Modal + 双指缩放）
- [x] 书内链接拦截跳转（onShouldStartLoadWithRequest → 解析章节+锚点 → 跳转）
- [x] 准确页码显示（CSS columns 计算 + 全书累计章节进度）
- [x] 章节间水平滑动动画（withTiming 过渡）
### books.tsx 修复
- [x] 封面图片 onError 回退到图标（不再显示空白）
- [x] 书名 HTML 实体解码（书库列表正确显示书名）
### book-import.tsx 增强（AI 提取流程）
- [x] 导入成功后不跳走，留在段落阅读界面继续选取
- [x] 已导入段落显示绿色背景 + ✓ 已导入徽章，禁止重复选取
- [x] Header 副标题显示累计导入数量
- [x] 导入成功后底部显示 toast 提示「继续选取更多」
- [x] 底部新增「完成阅读，返回书库」按钮（有导入记录时显示）
- [x] 点击完成弹出汇总 Alert（继续阅读 / 返回书库）
- [x] TypeScript 零错误

## 书库阅读器 Apple Books 风格优化（2026-07-12）
- [x] 阅读设置持久化（字体大小/行距/主题/字体族/边距存入 AsyncStorage）
- [x] 字体族选择（衬线 Georgia / 无衬线 System / 等宽 Courier）
- [x] 边距自定义（窄 12px / 中 20px / 宽 32px）
- [x] 字体间距（letter-spacing 紧凑/标准/宽松）
- [x] 新增米黄纸质主题（#F8F0E3 背景 + #3D2B1F 文字）
- [x] 进度条可拖拽跳转章节（PanResponder + 拇指指示器）
- [x] 顶部状态栏 Apple Books 风格（左侧页码 + 中间灰色书名）
- [x] 目录 UI 升级（Apple Books 风格：封面缩略图+当前章节/总章节+章节序号）
- [x] 高亮系统（长按选中文字 → 3色高亮菜单 → 保存到 AsyncStorage）
- [x] 高亮在阅读时自动渲染（注入 CSS 高亮样式，章节切换后恢复）
- [x] 设置面板新增字号 A-/A+ 控制（含 Aa 预览文字）

## AI 补全系统全面升级（2026-07-13）

### Bug 修复（优先级：高）
- [x] Bug A：bottles.tsx 批量补全 catch 块加入本地 KB 离线降级
- [x] Bug B：recipe-form.tsx 单条 AI 补全升级为 deepAnalyzeRecipe（强模型）
- [x] Bug C：recipe-form.tsx 离线时改为内联提示，不弹 Alert
- [x] Bug D：homemade-form.tsx 离线时加说明文字，不只是禁用按钮

### 知识库扩充（优先级：高）
- [x] 离线知识库扩充：新增 144 条（日本威士忌、精酿金酒、台湾威士忌、中国精酿白酒等），共 261 条
- [ ] 书库索引持久化：导入时预建关键词倒排索引，查询 O(1)
- [x] 多语言双语补全：AI 补全结果同时返回中英文双语描述（notesEn/storyEn 字段）

### 用户体验升级（优先级：高）
- [ ] 置信度显示：bottle-form AI 建议面板顶部显示 high/medium/low 徽章
- [ ] 置信度显示：bottles.tsx 批量补全每条结果显示置信度
- [x] 一键应用高置信度：AI 建议面板加"应用全部高置信度字段"按钮（bottles.tsx）
- [ ] 书库引用溯源：AI 参考书库内容时显示"参考来源：《书名》第 X 章"
- [ ] AI 补全历史记录：酒款详情页显示"AI 补全于 YYYY-MM-DD，置信度：高"
- [ ] 批量补全优先级排序：按缺失字段最多的酒款优先处理

## 新增功能（2026-07-13 第二批）
- [x] 批量补全优先级排序：按缺失字段数量降序排列，优先处理信息最不完整的酒款
- [x] TF-IDF 向量语义搜索：离线知识库支持语义相似度查询（"苦味调味剂"→"苦精"，跨语言匹配）
- [x] 实时爬取补全：联网时从 TheCocktailDB + Wikipedia 获取冷门酒款数据作为 LLM prompt 上下文

### 服务器端升级（优先级：中）
- [x] 热门酒款结果缓存：服务器内存缓存热门酒款补全结果（1小时 TTL，<100ms 命中）
- [ ] 并发批量补全：批量补全改为并发 3 条同时处理，速度提升 3 倍
- [ ] 向量语义搜索（Embedding）：知识库建立向量索引，支持语义相似度查询
- [ ] 实时爬取补全：冷门酒款从 Distiller/Master of Malt/Whiskybase 爬取数据

### 高阶 AI 功能（优先级：中）
- [x] 跨酒款关联推理：补全时分析酒库已有酒款，推断替代/搭配关系（substituteFor/pairsWith 字段）
- [x] 配方与酒款双向 AI 联动：补全新酒时自动扫描配方库，底部显示相关配方列表

### 长期规划（优先级：低）
- [ ] 离线本地 AI（Core ML）：iOS 上运行 Phi-3 Mini / Gemma 2B，完全离线 AI 推理
- [ ] 个性化 AI 模型：记录用户口味偏好和历史修正，注入 prompt 个性化补全
- [ ] 协作知识库：用户确认补全后可贡献到公共知识库（众包模式）
- [ ] 知识库自动更新：app 启动时静默拉取最新知识库版本（差量更新）
- [ ] 图片识别批量补全：批量补全支持从相册选图，每张图对应一款酒

## 方案 C+ 5D 智能三通道同步架构（2026-07-14）
- [x] Cloudflare Worker v2 部署（设备配对 + 权限系统 + 云同步 API）
- [x] Cloudflare D1 数据库建表（8张表：device_groups/devices/pair_codes/sync_data 等）
- [x] 多角色权限系统（owner/collaborator/guest，allowedKeys 字段级控制）
- [x] CF SyncProvider 替换 OAuth 登录（lib/cf-sync/provider.tsx）
- [x] 设备管理页面（app/device-manager.tsx）+ 配对码页面（app/pair-device.tsx）
- [x] DeepSeek 余额 Cron（每天17:00北京时间，< ¥5 发邮件至 326978666@qq.com）
- [x] 本地加密备份通道（lib/backup/local-backup.ts：3快照循环，djb2哈希校验）
- [x] iCloud Drive 自动备份（lib/backup/icloud-backup.ts：5分钟增量，7版本循环）
- [x] 设备管理页面升级（同步状态脉冲动画 + DeepSeek余额进度条 + 三通道备份状态面板）
- [x] sync/engine.ts bug 修复（并发 flush 竞争、时间戳边界条件、内存泄漏）
- [x] CRDT 字段级冲突合并引擎（lib/sync/crdt.ts：LWW per field，数组元素级合并，tombstone）
- [x] 智能调度器（lib/sync/scheduler.ts：离线队列+断线重连+指数退避+三通道协调）
- [ ] scheduler.ts 集成到 cf-sync/provider.tsx（替换现有 pushFn/pullFn 调用）
- [ ] 触发 EAS Build #33（需要新 Expo Token）

## 方案 Y 清理与功能改进（2026-07-14）
- [x] 删除 Waldorf 自动 seeding（lib/recipes/store.tsx + lib/bottles/store.tsx）
- [x] 删除 recipes.tsx 和 homemade.tsx 中的「导入示例」按钮
- [x] 修复 data-manager.tsx 导出 Bug（cacheFile.write 缺少 await）
- [x] data-manager 新增「重置为出厂状态」功能（AsyncStorage.clear，危险操作区）
- [x] device-manager 设为主设备 UI 改进（方案 A：快捷「设为主设备」橙色按钮）
- [x] me.tsx 退出同步组选项改进（方案 B：新增「退出并清除数据」选项）
- [x] icon-symbol.tsx 新增 arrow.counterclockwise → restore 映射

## 智能链接系统升级与 Bug 修复（2026-07-15）
- [x] 升级 lib/suggest.ts：source 区分 spirits/bottles/materials/homemade 四库
- [x] 升级 recipe-form.tsx 和 homemade-form.tsx 建议列表：四库不同颜色标签
- [x] 升级 smart-link.ts：SmartLink 新增 matchConfidence（exact/fuzzy）字段
- [x] 方案 D：精确匹配自动链接，模糊匹配显示建议（可接受/忽略），已链接可断开
- [x] Bug 1 修复：删除成分行时清理 dismissedLinks/acceptedLinks 状态
- [x] Bug 2 修复：编辑模式打开时预填 dismissedLinks，避免弹出干扰提示
- [x] Bug 3 修复：suggestIngredients 传入 useBottleTaxonomy().groupOf 动态分组 resolver
- [x] Bug 4 修复：Ingredient 类型新增 linkedBottleId/linkedPrepId，接受模糊链接写入数据，成本计算优先使用链接 ID
- [x] Bug 5 修复：英文文案区分酒库（Bar Stock）和自制库（Homemade）来源

## 配料表单交互优化（2026-07-16）
- [x] recipe-form.tsx：为配料列表添加长按拖拽排序能力（NestableScrollContainer + NestableDraggableFlatList，左侧拖拽手柄）
- [x] homemade-form.tsx：为配料列表添加长按拖拽排序能力（NestableScrollContainer + NestableDraggableFlatList，左侧拖拽手柄）
- [x] 清理 recipe-form.tsx / homemade-form.tsx 中重复的 amount 输入框遗留代码

## 「开瓶易失效」手动开关功能（2026-07-15）
- [x] lib/bottles/types.ts：Bottle 接口新增 perishableOnOpen?: boolean 字段（undefined=自动，true/false=手动覆盖）
- [x] lib/recipes/smart-cost.ts：isPerishableWholeBottle() 优先读取 bottle.perishableOnOpen，未设置时回退关键词逻辑
- [x] app/bottle-form.tsx：新增 perishableOnOpen state + Toggle 开关 UI（价格字段下方，备注字段上方）
- [x] app/bottle-form.tsx：Toggle 显示自动推断默认值，用户可手动覆盖或「重置为自动」
- [x] app/bottle/[id].tsx：详情页标签行显示「开瓶易失效」chip（手动设置=橙色，自动推断=灰色，手动关闭=「不易失效·手动」）
- [x] lib/i18n/translations.ts：新增 bform.perishable / bform.perishable.hint.auto/on/off 翻译键
- [x] TypeScript 零错误

## 四大功能升级（2026-07-15 第二批）
- [x] 需求 1：自制库装饰分区（garnish）——装饰专属字段（garnishUnit/batchYield/batchCost/costPerUnit/shelfLifeKey/prepMethod）、7 子分类、批次成本折算、homemade-form.tsx 表单 UI、store 迁移支持
- [x] 需求 2：配方编辑手动选库——Ingredient 新增 preferredSource 字段，成分行库选择器（自动/基酒/酒款/原材料/自制），smart-link.ts 按库过滤，随配方持久化
- [x] 需求 3：卡片复制——三库（配方/酒款/自制）长按弹出复制 Alert，生成「名称（副本）」条目
- [x] 需求 4：库归属手动选择——Bottle 新增 libraryOverride/homemadeGroup/homemadeType，bottle-form.tsx 顶部「所属库」选择器，酒款库过滤已归属条目，自制库聚合显示虚拟 prep 并标注「来自酒款库」，smart-link.ts 联动

## Garnish 功能完善（2026-07-18）
- [x] Garnish tab 静态分类 chip：无条目时也显示全部装饰分类（homemade.tsx）
- [x] 条目跨分组移动：长按菜单新增"移动到…"选项（homemade.tsx）
- [x] 条目跨分组移动：左滑新增"移动"按钮（homemade.tsx）
- [x] Recipe 详情页 Garnish 区域智能链接：逐项渲染可点击链接（recipe/[id].tsx）
- [x] Recipe 详情页 Garnish 区域智能链接：逐项渲染可点击链接（recipe/[id].tsx）

## 漏洞修复（2026-07-18 第二批）
- [x] Bug 1：Garnish tab 快捷筛选状态共享 non_alcoholic tab（quickSelNa）→ 新增独立 quickSelGarnish 状态（quick.homemade.garnish.v1）
- [x] Bug 2：recipe/[id].tsx 未使用的 garnishDisplayText 导入 → 已清理
- [x] Bug 3：recipe/[id].tsx Garnish 渲染中 part.name 空值无防护 → 添加 if (!part.name) continue 守卫
- [x] Bug 4：migrateSectionsV2 自定义分区迁移时未保留 garnish group 值 → 补充 garnish 判断条件
- [x] Bug 5：classifyPrepGroup 无法识别装饰类关键词（返回 non_alcoholic）→ 新增 GARNISH_HINTS 常量，装饰/garnish/脱水等关键词正确归为 garnish 分组

## 中英文混用修复（2026-07-18 第三批）
- [x] SELECT UNIT 面板 COUNT/FUZZY 单位双语化（getUnitPresetGroups(lang)）
- [x] 新增 unitDisplayLabel(unit, lang) 函数，内部中文存储键转换为当前语言显示标签
- [x] recipe-form.tsx / homemade-form.tsx 单位按钮显示使用 unitDisplayLabel
- [x] NON_LIQUID_RE 新增英文计件单位识别（pc/pcs/to taste/a pinch 等）

## 解析与 Garnish 标签修复（2026-07-19）
- [x] Bug 1：splitPrepIngredientLine 无法解析 "Zest of ¼ pomelo" 等 "X of ¼ Y" 模式 → 新增 OF_FRAC_RE 预处理，提取数量并还原完整名称
- [x] Bug 2：Garnish 分组在 Library 中没有任何类型标签（老用户 v2Flag 已设置，加载时直接使用旧数据，缺少新增的 garnish sections）→ 修复 store.tsx 加载逻辑，已迁移用户也始终合并最新默认 sections

## AI 补全名称字段修复（2026-07-19）
- [x] CF Worker enrich-recipe：新增 suggestedNameZh/suggestedNameEn 字段（ZH/EN 双语 prompt，明确指引 AI 何时填写名称）
- [x] CF Worker deep-analyze-recipe：同步添加 suggestedNameZh/suggestedNameEn 字段
- [x] recipe-form.tsx aiResult 类型：新增 suggestedNameZh?/suggestedNameEn? 字段
- [x] recipe-form.tsx buildAiFields：当 suggestedNameZh/suggestedNameEn 非空时，加入 AI 建议面板（中文名/英文名）
- [x] recipe-form.tsx applyField：key=nameZh/nameEn 时写入 name/nameEn state
- [x] recipe-form.tsx undoSnapshot：新增 nameZh/nameEn 字段，undo 时同步还原名称
- [x] smart-router.ts enrichRecipe/deepAnalyzeRecipe 返回类型：新增 suggestedNameZh?/suggestedNameEn? 字段
- [x] TypeScript 零错误

## AI 补全按钮名称提示（2026-07-19）
- [x] recipe-form.tsx：AI 补全按钮上方动态显示提示文字——只填中文名时显示「✦ 点击可获取英文名建议」，只填英文名时显示「✦ 点击可获取中文名建议」，双语支持，双名均填或均空时不显示

## 配方详情页成品照片功能（2026-07-19）
- [x] lib/recipes/types.ts：Recipe 接口新增 photoUri?: string 字段（后升级为 photoUris: string[]），normalizeRecipe 默认 []，兼容旧单照片数据迁移
- [x] lib/recipes/store.tsx：新增 updateRecipePhoto(id, action, uri)（add/remove 双模式）、removeRecipePhoto(id, uri)，deleteRecipe/deleteRecipes 自动清理所有 photoUris 文件
- [x] app/recipe/[id].tsx：多照片 Section（最多5张），横向 ScrollView 展示，每张照片独立删除按钮，添加按钮（相机/相册），空状态虚线占位区
- [x] lib/i18n/translations.ts：新增 detail.photo.* 翻译键（add/change/delete/title/takePhoto/chooseLibrary/cancel/delete.confirm.title/delete.confirm.msg）
- [x] lib/recipes/seed.ts：mk 函数参数类型新增 photoUris?: string[]，return 对象默认 photoUris: []
- [x] Workers AI 降级：CF Worker 新增 @cf/meta/llama-3.3-70b-instruct-fp8-fast 作为 DeepSeek 失败时的免费降级方案
- [x] TypeScript 零错误
- [x] lib/recipes/photo.ts：新建照片工具函数（deletePhoto）
- [x] lib/i18n/translations.ts：新增 detail.photo.* 翻译键（中英双语）
- [x] app/recipe/[id].tsx：详情页最下方添加成品照片 Section（拍照/相册选择/删除）
- [x] 权限处理：相机/相册权限被拒时弹出 Alert 引导去系统设置（Linking.openSettings）
- [x] iOS 兼容：选照片后立即复制到 documentDirectory，避免 ph:// URI 失效
- [x] 照片压缩：quality: 0.75，避免原图 4K 占用内存
- [x] TypeScript 零错误

## 详情页视觉升级（Build 55 一同发布，暂不 EAS Build）
- [x] theme.config.js / theme.config.d.ts：添加 aiAccent 淡紫 token（#9F7AEA / #B794F4）
- [x] recipe/[id].tsx：标签放大（text-xs→text-sm, px-3 py-1.5, gap 8）
- [x] recipe/[id].tsx：风味标签独立成排（第一排分类/时长/场合，第二排风味）
- [x] recipe/[id].tsx：智能链接去蓝（配料/装饰/成本/冰块行：黑字+灰箭头+淡紫✦+0.5透明度按压）
- [x] homemade/[id].tsx：配料智能链接同规则去蓝（副标题灰、sparkles淡紫、箭头灰）
- [x] codex-family-badge.tsx：去蓝（灰边框+深灰semibold+surface背景+灰ⓘ13px，尺寸与标签一致）
- [x] variant-badge.tsx：变体归属行去蓝（黑字+灰图标+灰箭头，经典绿色保留）
- [x] lab-origin-badge.tsx：硬编码紫改为 aiAccent token，箭头灰
- [x] SourceConfidenceBadge：确认使用语义色（绿/橙/红），无蓝色，无需改动
- [x] 蓝色白名单保留：收藏星、成本总价、联网补全按钮、编辑按钮、Notes背景
- [x] TypeScript 0 错误 + vitest 19/19 通过
- [x] 截图预览验证（标签分排、去蓝、徽章统一均符合预期）
- [x] checkpoint

## 阅读器深度优化（诊断完成，待用户确认后实施）
- [x] P0: 频闪根因修复（章节加载 effect 依赖 book 引用 → 改为 book.id）
- [x] P0: 进度条拖动防抖（松手才跳章，拖动中不重载）
- [x] P0: 书签持久化到书籍元数据
- [x] P1: 点击左右边缘 25% 区域翻页热区
- [x] P1: 底部箭头按钮改为翻页语义（章首/尾自动切章）
- [x] P1: 键盘方向键翻页（Mac/外接键盘）
- [x] P2: 宽屏（≥900px）自动双页对开 + 单/双页设置开关
- [x] P2: 正文行长上限 42em + 页脚页码重构 + 顶栏信息优化
- [x] P3: 滑动翻页动画（多页章节跟手）
- [x] P3: 相邻章节预载（跨章无缝）
- [x] P3: 图片加载优化（baseUrl 直读替代 base64 内联）
- [x] P3: 内链锚点跳转 + 高亮注入改为 onLoadEnd 驱动
- [x] P3: currentPage/currentPageInChapter 状态合并 + lastPage 恢复

## 阅读器升级 v2 增补（复审后，待用户确认）
- [x] P0: topBar 改 absolute overlay，根治工具栏挤压/异动阅读区
- [x] P1: 翻页引擎改 transform（替代 scrollLeft，消除亚像素误差）
- [x] P1: 点击热区改 WebView 内 JS 坐标分区（不遮挡文本选择/链接）
- [x] P1: 键盘监听改 WebView 内 keydown + postMessage
- [x] P2: 双态 chrome（窄屏浮动阅读菜单钮 / 宽屏顶栏 overlay + 悬浮翻页箭头）
- [x] P2: 跳转返回按钮（目录/书签/滑块跳转后显示「返回第 N 页」）
- [x] P3: 跨章末帧淡变防白屏（预载 + 旧帧保留）

## 用户决议（2026-07-19）：P0+P1+P2+P3 一次做完
- [x] 双击加书签：不做（用户明确不要）
- [x] 双页触发宽度 900px（按 iOS 图书规格）
- [x] 翻页动画：slide 滑动（iOS 16 图书默认规格）
- [x] 完成后暂不触发 EAS Build，先 checkpoint 交付验证
- [x] EAS Build 56 触发并提交 TestFlight（build dc8ca4d9，submission 178ed821，FINISHED）
## Build 57 修复（2026-07-20，方案经用户确认，全部完成）
- [x] Bug 1: 装饰行智能链接——auto 模式放开 libraryOverride='homemade' 排除，同名 prep 精确优先（smart-link.ts + vitest 回归）
- [x] Bug 2: 自制库虚拟条目点击改跳酒款详情页（homemade.tsx）；详情页加「自制库›」归属徽章（bottle/[id].tsx）
- [x] Bug 3: 书内图片问号——iOS 回归 base64 内联（WKWebView html+baseUrl 不认 file://），仅 Android 走 file:// 快路径；>2MB 大图自动压缩 + 失败灰色占位（book-reader.tsx）
- [x] Bug 4: AI 风格补全——Worker BOTTLE_STYLES_MAP 重建为客户端 taxonomy 值域 + normalizeBottleStyle 模糊归一化 + styleRaw 保留（已部署 Version 4eb6f355，curl 验证 Banks→Gold、Tanqueray→London Dry）；客户端 lib/bottles/style-normalize.ts 兜底映射（bottle-form.tsx + vitest 6 用例）
- [x] Bug 5: Mac→手机同步——前台激活自动同步（AppState/visibilitychange，60s 节流，provider.tsx）；cfPull 支持 since 增量；Worker push 加 LWW 时间戳守卫（ON CONFLICT WHERE 新者胜，已部署）；设备管理页显示同步组短码 + 单设备配对引导
- [x] EAS Build 57 触发（本次 Build）
## UI 改动补充（Build 57 随附）
- [x] 改动①: me.tsx 将同步卡片 + 数据管理入口合并到功能入口区块下方
- [x] 改动④: 结构公式卡片移到成本卡片后面
- [x] 改动⑤: 成品照片固定在详情页底部
- [x] 改动⑥: 风味描述强制三段（核心基调/风味演变/整体质感）
- [x] 改动⑦: bottles.tsx 卡片宽度与自制库/酒单统一（paddingHorizontal: 20）
- [x] 改动⑧: bottles.tsx 删除自动显示 Banner（已移入多选）
- [x] 改动⑨: FAB 底部距离修复（bottles/homemade/recipes 均已 insets.bottom + 72）
- [x] 改动⑩: recipe/[id].tsx garnish 和 source 文字添加 selectable
- [x] TypeScript 0 错误，35 项测试通过
## 底部遮挡修复 & 退出同步组迁移（Build 57 随附）
- [x] me.tsx paddingBottom 40 → 90 + insets.bottom（FloatingTabBar 遮挡修复）
- [x] books.tsx paddingBottom 120 → 90 + insets.bottom（添加 useSafeAreaInsets）
- [x] device-manager.tsx paddingBottom 48 → 48 + insets.bottom（添加 useSafeAreaInsets）
- [x] 退出同步组/退出并清除数据从 me.tsx 移入 device-manager.tsx 底部危险区
- [x] 退出同步组/退出并清除文字改为普通前景色（非红色），图标背景改为 #8E8E93（系统灰）
- [x] me.tsx 清理不再使用的 Alert、AsyncStorage、logout import
- [x] Bug 6: 成品照片区 iOS 占比过大（固定在 ScrollView 外常驻底部，移入滚动区 + 缩略图化）
- [x] Bug 7: 配方照片点击浮层查看原图（详情页上方浮层，点击任意处关闭）
- [x] Bug 8: 建议链接酒库提示点"忽略"后仍强行自动链接（linkDismissed 持久化，表单三按钮+详情页+成本+自动入库全链路尊重）
- [x] Bug 9: iOS 无法识别 Apple Books"摘录来自…"引用来源格式（本地正则解析书名/作者→sourceRef，剥离尾注后发 AI）
- [x] UI: 标签管理页参考截图重构（彩色 chip 墙 + 可折叠分组 + 添加抽屉与颜色选择器）
- [x] UI: 卡片标签显示页与标签管理页风格统一
- [x] UI: 颜色选择器升级为 iOS 系统风格（网格/光谱/滑块+Hex + 常用色收藏）

## 全 App UI/UX 系统性升级（2026-07-20 用户确认全做）
- [x] STEP1: 建立 9 个共享组件（IOSColorPicker/AppCard/SearchBar/LargeTitle/FloatingTabBar/Fab/EmptyState/DangerRow/TagChipWall）
- [x] P0: me.tsx 危险操作移入 device-manager.tsx 底部危险区，改 DangerRow 样式
- [x] P0: bottles.tsx 霸屏双按钮 Banner 改为筛选行胶囊 + 底部抽屉
- [x] P0: homemade.tsx 补全 Banner 改为同款胶囊 + 抽屉，搜索框换 SearchBar
- [x] P1: 浮岛式底部 Tab 栏（FloatingTabBar），各页底部 padding 适配
- [x] P1: 四个 Tab 首屏 LargeTitle 统一 34px
- [x] P1: 全部列表卡片换 AppCard（去边框、圆角 20、轻阴影）
- [x] P1: 配方/书库/购物清单搜索框换 SearchBar
- [x] P1: FAB 三处合并为统一 Fab 组件
- [x] P1: device-manager/data-manager 危险红收敛为 DangerRow
- [x] 专项A: tags.tsx 重构为彩色 chip 墙 + 可折叠分组 + 添加抽屉
- [x] 专项A: card-tag-settings.tsx 同步对齐新视觉
- [x] 专项B: color-picker.tsx 升级为 iOS 三模式（网格/光谱/滑块+Hex + 常用色）
- [x] P2: 空状态 EmptyState 接入（酒单/配方/酒库/书库）
- [x] P2: 详情页分组卡片 AppCard 质感
- [x] P2: 表单页圆角与间距对齐 radius.control
- [x] P2: 按压反馈统一（列表卡片 opacity 0.7，主按钮 scale 0.97）
- [x] FINAL: TypeScript 0 错误 + 35 项测试通过 + 全局设计规范检查 + 截图走查
- [x] FINAL: TypeScript 0 错误 + 35 项测试通过 + 全局设计规范检查 + 截图走查
## 第三阶段视觉升级（2026-07-20 继续）
- [x] 详情页步骤改为蓝色圆形序号列表（直径26，蓝色底白字）
- [x] 详情页装饰移到步骤前面
- [x] 详情页结构公式在最底部
- [x] 编辑页（recipe-form.tsx）步骤序号改为灰色（#E5E7EB 底 #6B7280 文字）
- [x] 编辑页装饰/步骤顺序对调（装饰先、步骤后）
- [x] homemade-form.tsx 步骤序号同步改为灰色
- [x] 详情页装饰改为小胶囊 chip 样式（有链接蓝底可点击）
- [x] 配料分量列固定宽度 60px 右对齐
- [x] recipe-form.tsx 表单区块标题统一为 13px 全大写灰色 + letterSpacing 0.4
- [x] homemade-form.tsx fieldLabel 标题统一为 13px 全大写灰色 + letterSpacing 0.4
- [x] TypeScript 0 错误，35 项测试全部通过

## 全面代码审计（2026-07-20）
- [x] 全局扫描：TypeScript 0 错误、35 测试通过、无乱码（U+FFFD/BOM）、无 TODO/FIXME 残留
- [x] 路由完整性：所有 router.push 目标均有对应文件
- [x] 清理死文件：lib/_core/auth.ts、components/parallax-scroll-view.tsx、hello-wave.tsx、external-link.tsx、ui/collapsible.tsx、app/prep-sections.tsx（无入口死页面）
- [x] 移除 lib/theme-provider.tsx 调试 console.log（每次渲染打印主题变量）
- [x] 后端链路实测：CF Worker AI 路由在线、sync/pull 鉴权正常（401 未注册设备）
- [ ] 已知缺口：阅读器书签/进度不参与云同步；照片文件不上传云端（仅本地路径同步）；卡片标签设置不同步
- [ ] EAS Build 57 触发（Cloud PC eas build 报 metro.config.js 无法加载，疑似 eas-cli 20.5.1 与 Node 22 兼容问题，待升级 eas-cli 重试）

## Build 57 收尾：FAB/多选栏统一浮岛 + 照片云端同步（2026-07-20）
- [x] floating-tab-bar.tsx 新增 tabBarTop()/fabBottom()/bulkBarBottom() 统一布局帮助函数
- [x] bottles/homemade/recipes/menu 四页 FAB bottom 统一改用 fabBottom(insets.bottom)，不再被浮岛 Tab 栏遮挡
- [x] BulkActionBar 组件改为浮岛卡片样式（left/right 16、borderRadius 20、shadow、bulkBarBottom 定位）
- [x] menu.tsx 自定义 batchBar 从顶部条改为底部浮岛卡片（与 BulkActionBar 风格一致）
- [x] 照片云端同步：lib/sync/photo-sync.ts（上传/下载/photoUris 重写）+ provider.tsx performSync 后非阻塞挂载 + store.tsx deleteRecipePhoto 云端删除
- [x] CF Worker 照片 API 4 条路由部署验证（upload/list/download/delete，鉴权 401 正常）
- [x] TypeScript 0 错误，vitest 35 通过
- [ ] 触发 EAS Build 57 并提交 TestFlight（Cloud PC 先升级 eas-cli）

## 标签管理系统升级（2026-07-20 确认）
- [ ] 数据层：types.ts 新增 CategoryGroup 接口、Category 加 groupId、TagGroup/TagItem 加 locked 字段
- [ ] 数据层：store.tsx 新增 categoryGroups state + CRUD + 持久化
- [ ] 数据层：store.tsx flavor 默认三分组初始化（基础味觉/香气特征/口感维度）
- [ ] 数据层：store.tsx 老用户升级迁移（flavor 标签自动分配分组）
- [ ] 数据层：store.tsx 锁定功能（locked 标签/分组不可删除）
- [ ] UI：tags.tsx 分类 category 支持分组 UI（CategoryGroup）
- [ ] UI：tags.tsx spirit/glass/flavor 启用 groupedBlocks + GroupCard 渲染
- [ ] UI：tags.tsx flavor 分组固定三个（不可增减），分组名可改
- [ ] UI：tags.tsx 锁定/解锁按钮（标签和分组）
- [ ] 颜色同步：recipe-tag-renderer.tsx baseSpirit 颜色改为从 tags 读取
- [ ] 颜色同步：recipe-form.tsx flavor chip 颜色改为从 tags 读取
- [ ] 颜色同步：recipe/[id].tsx flavor chip 颜色改为从 tags 读取
- [ ] i18n：新增 lock/unlock/categoryGroup 相关翻译 key
- [ ] icon-symbol.tsx：新增 lock.open.fill 图标映射

## 标签管理系统升级（2026-07-20）

- [x] 风味标签三个固定分组：基础味觉 / 香气特征 / 口感维度（不可增减，可改名）
- [x] 分类/基酒/杯型/风味 标签颜色全局同步（recipe-form、recipe/[id]、recipe-tag-renderer）
- [x] 分类/基酒/杯型/风味 全部支持分组功能（GroupCard + CategoryGroupCard）
- [x] 分组名字可以更改（GroupCard 内改名 UI）
- [x] 锁定功能：分组锁定/解锁（ellipsis 按钮）
- [x] 锁定功能：标签锁定/解锁（编辑抽屉内 lock 按钮）
- [x] 锁定的分组和标签不能被删除（confirmDelete/confirmDeleteGroup 检查）
- [x] flavor 老用户迁移：自动分配三个默认分组
- [x] CategoryGroup 接口新增（types.ts + store.tsx）
- [x] icon-symbol.tsx 添加 lock.open.fill 图标映射

## Build 65 iOS 闪退修复（2026-07-20）
- [x] 根因：tags.tsx 跨分组拖拽中，render 期间 React.createRef 导致 ref 身份不稳定，拖拽时 refreshGroupLayouts 对可能已卸载的 native view 调用 measure，iOS release 模式下 crash
- [x] 临时修复：禁用 DraggableChip 手势（disabled 固定为 true），移除 GroupCard 中 onLayout 内的 measure 调用，消除 iOS crash 根因
- [x] TypeScript 0 错误，vitest 全部通过
- [ ] 后续：用 onLayout event.nativeEvent.layout + ScrollView scrollOffset 重新实现稳定的跨分组拖拽（不依赖 measure）

## 标签管理深度修复（2026-07-20）
- [x] P0 iOS measure crash：彻底移除 refreshGroupLayouts 和 measure 调用，GroupCard 不再持有 native ref
- [x] P1 Hooks 规则违反：将 renderCategoryGroupCard 提取为真正的 CategoryGroupCard React 组件（移出主屏函数体）
- [x] P2 新增分组表单触发逻辑：添加 showAddTagGroup state，修复 section 切换时重置表单，修复 TagGroup 表单显示条件
- [x] P3 跨分组拖拽：彻底删除 DraggableChip 组件、拖拽 state、拖拽回调、groupLayoutMap，移除 GroupCard 拖拽 props
- [x] P4 自制分区三态切换：分区 group 标签支持 alcoholic → non_alcoholic → garnish 三态循环，颜色区分（warning/success/primary）
- [x] P5 自制分区双语重命名：分区和类型的新增/编辑均改为双字段（中文 + 英文），handler 同时写入两个语言字段
- [x] P7 setTagGroup kind 校验：目标分组不存在或 kind 不匹配时不执行赋值，防止跨 kind 数据污染
- [x] TypeScript 0 错误，Metro bundler 正常
## 酒单迁移到资料库（2026-07-20）
- [x] library.tsx：添加「酒单」子页（三段式 Segmented：酒单/酒库/自制库），改名为「资料库」
- [x] index.tsx：移除「酒单」子页，只保留研发/门店两个子页，大标题改为「研发」
- [x] i18n：tab.library 改为「资料库」，新增 tab.lab 翻译 key（研发/R&D）
- [x] _layout.tsx：index tab 标签改为「研发」，图标改为 flask；library tab 图标改为 wineglass
- [x] TypeScript 0 错误

## 原料库全面升级（2026-07-21）
- [x] 原材料库改名为原料库（translations.ts 全局替换，内部 key 不变）
- [x] 原料库编辑页价格区重写：三模式 UI（按毫升/按克/按件数）+ 按件多 chip（个/听/罐/瓶/袋/盒）+ 实时单位成本预览 + 保存时自动同步 volume 字段
- [x] 修复自制库成本引擎 Bug：matchMaterialBottle + estimatePrepCost 优先读 packQty+packUnit，回退到 volume 解析
- [x] 原料库详情页新增单位成本展示行（每ml/每g/每件）

## 自制库家族折叠（方案 A）

- [x] types.ts 新增 sourceFamilyKey + variantLabel 字段，normalizePrep 兼容
- [x] match.ts 新增 extractVariantHint + matchPrep 同名变体精细匹配
- [x] smart-link.ts 新增 variantHint 感知逻辑，exactPrep/smartLinkDisplayName 支持变体区分
- [x] grouping.ts 新增 groupPrepsByFamily 函数（家族折叠 + 同名折叠统一入口）
- [x] homemade.tsx 列表页：家族折叠 rows 组装 + PrepGroupRow 展示「X 种形态」徽章 + 展开行显示 variantLabel
- [x] homemade-form.tsx 装饰分区：新增原料家族 + 变体标签输入框，save payload 持久化
- [x] translations.ts 新增 group.variants 翻译键

## 自制库成本与 AI 补全全面升级（2026-07-21）
- [x] lib/units.ts 新增 YIELD_UNIT_PRESET_GROUPS 产量专用单位组（液体/重量/计件/批次）
- [x] lib/homemade/cost.ts 引擎升级：新增 costPer100g、costPerPiece、yieldDimension 三维度
- [x] server/routers.ts enrichHomemade prompt 升级：全字段覆盖（中英文名、产量、步骤、家族key、变体标签）
- [x] lib/api/smart-router.ts 客户端类型定义同步升级
- [x] homemade-form.tsx 产量区重构：自由文本改为 UnitPickerSheet 选择器
- [x] homemade-form.tsx 成本区升级：实时预览单位成本（液体/重量/计件三维度）
- [x] homemade-form.tsx AI 回填升级：新增中英文名、步骤、产量、家族key、变体标签全字段回填
  - [x] app/homemade/[id].tsx 详情页成本卡片：根据 yieldDimension 自动切换展示维度

## 配方编辑页建议列表 Bug 修复（方案四：双重保护）（2026-07-21）
- [x] Bug 1：配料行 onBlur 加 pressingIngSuggestRef 检查，防止建议列表被 onBlur 抢先关闭
- [x] Bug 2：装饰行 onBlur 加 pressingGarnishSuggestRef 检查，同等修复
- [x] Bug 3：pickSuggestion 加 setFocusedIng(null)，选中后立即关闭建议列表
- [x] Bug 4：suggestRow 样式加 minHeight: 44，扩大点击热区
- [x] Bug 5：updateIngredient name 分支加 setPickedIng 清除，避免状态歧义
  - [x] 配料行/装饰行建议 Pressable 改为 onPressIn/onPressOut/onPress 三件套
  - [x] TypeScript 0 错误

## 自制库编辑页 + 研发批次编辑页建议列表 Bug 修复（2026-07-21）
- [x] homemade-form.tsx：同等应用方案四（双重保护），修复配料行建议列表无法点击的 5 个 Bug
- [x] batch-form.tsx：同等应用方案四（双重保护），修复配料行建议列表无法点击的 5 个 Bug
- [x] TypeScript 0 错误

## 虚拟条目机制重构（四阶段）

- [x] 阶段1：自制库编辑页加风味标签 UI（FLAVOR_TAGS chip 选择器）+ 详情页展示风味标签区块
 - [ ] 阶段2：HomemadePrep 加 unitCost/unitCostUnit 字段 + 更新成本计算逻辑
 - [ ] 阶段3：实现跨 store 迁移函数（含配方 id 替换 + 成本字段写入 + 原子性保护）
 - [ ] 阶段4：历史数据清理入口 UI（带备份提示的批量迁移）+ bottle-form.tsx 改为真正迁移

## 库移动 Bug 修复（2026-07-21）
- [x] Bug 1：homemade.tsx 虚拟条目（bottle-override-*）删除静默失败 → confirmDelete 区分虚拟/真实，虚拟条目调用 deleteBottle
- [x] Bug 2：homemade.tsx 虚拟条目移动按钮被隐藏 → 移除隐藏条件，虚拟条目移动调用 updateBottle({homemadeGroup})
- [x] Bug 3：homemade.tsx 批量删除不处理虚拟条目 → 分离 virtualIds/realIds，分别调用 deleteBottles/deletePreps
- [x] Bug 4：bottle-form.tsx homemadeGroup 默认值错误 → 新建时根据分类（果蔬/香料与草本/花卉）推断 garnish，切换到自制库时同步推断
- [x] Bug 5：homemade-form.tsx 迁移到酒库时不更新配方引用 → 迁移后遍历所有配方，清除 linkedPrepId 引用

## 自制库原料识别系统全面强化（层次1+层次2）（2026-07-21）
- [x] 层次1（规则层）：lib/homemade/types.ts 升级 LEADING_QTY_RE 正则，支持 oz/tsp/tbsp 等单位词，添加 UNIT_ONLY_RE fallback
- [x] 层次2（AI prompt 层）：server/routers.ts bulkItemSchema.prepIngredients 从 string[] 改为 {name,amount}[]
- [x] 层次2（AI prompt 层）：server/routers.ts bulk import prompt 中 prepIngredients 格式改为结构化 JSON
- [x] 层次2（AI prompt 层）：server/routers.ts enrichHomemade input schema ingredients 改为 {name,amount}[]
- [x] 层次2（AI prompt 层）：server/routers.ts enrichHomemade prompt 添加 prepIngredients 输出字段
- [x] 层次2（AI prompt 层）：server/routers.ts enrichHomemade return 添加 prepIngredients 字段
- [x] 同步更新 shared/client-types.ts：BulkImportItem.prepIngredients 类型从 string[] 改为 {name,amount}[]
- [x] 同步更新 lib/api/smart-router.ts：enrichHomemade 参数/返回类型 + bulkImportExtract 类型
- [x] 同步更新 app/homemade-form.tsx：enrichHomemade 调用传结构化 ingredients，回填 prepIngredients
- [x] 同步更新 app/(tabs)/homemade.tsx：enrichHomemade 调用直接传 {name,amount}[]
- [x] 同步更新 app/bulk-import.tsx：移除 parseIngStr 转换逻辑，直接使用服务端结构化数据
- [x] TypeScript 0 错误

## 自制库原料用量单位标准化（层次3）（2026-07-21）
- [x] lib/homemade/types.ts 新增 normalizeIngredientAmount(amount, name?) 函数
  - 液体单位 → ml：oz(30)/tsp(5)/tbsp(15)/dash(0.9)/drop(0.05)/shot(45)/cup(240)/pint(480)/cl/dl/L/dsp/scsp/rinse/splash
  - 重量单位 → g：kg/mg/lb/斤/两/钱/stone/tonne
  - oz 歧义：通过 isLiquidContext(name+amount) 自动判断液体(→ml) vs 固体(→g)
  - 计数/比例/模糊单位（个/片/枝/parts/pinch/适量等）原样保留
  - 数字格式：整数不加小数点，小数保留1位（如 2.7ml、0.5ml）
- [x] lib/homemade/types.ts splitPrepIngredientLine 所有 return 路径调用 normalizeIngredientAmount
- [x] TypeScript 0 错误

## 2026-07-21 Bug 修复 + AI 补全统一

- [x] Bug1: dismissedLinks ID 与 ingRows ID 不匹配（使用 initialIngRowsRef 共享 ID）
- [x] Bug2: removeIngRow 不清理 pickedIng/ingSourceMap（同步清理）
- [x] Bug3: 末尾孤立 import YIELD_UNIT_PRESET_GROUPS（已删除）
- [x] Bug4: auto 按钮永不激活（修复 isActive 逻辑）
- [x] Bug5: story/styleDesc/usageNotes 条件渲染（改为始终渲染，带 placeholder）
- [x] Bug6: SmartImportBar 不填 yieldQty/yieldUnit（解析 prepYield 并填充结构化字段）
- [x] Bug7: isGarnishType 与 selectedGroup 不同步（统一使用 selectedGroup === "garnish"）
- [x] AI 补全升级：自制库 AI 补全统一为建议面板模式（aiResult/aiToggles/undoSnapshot + buildAiFields + applyField + applyAiResult + undoAiApply）
- [x] AI 建议面板 UI：可信度徽章、全选/只填空白/全不选、逐字段 toggle、应用/忽略、Undo toast

- [x] 方案A：自制库实时成本估算面板（debounce+循环引用防护+Map索引+折叠明细+手动覆盖+来源标注，处理全部7个风险）

## Bug 修复 - 多设备同步

- [x] 修复：RecipeProvider 缺少 registerStoreReload 回调，导致同步后标签/分类消失
- [x] 修复：SYNC_KEYS 缺少 cocktail.categoryGroups，分类分组不参与同步
- [x] 修复：runInitialSync 合并策略边界条件，本地有数据无时间戳时不被云端覆盖

## 同步功能全面加固（Build 76）

- [x] 修复：bottles/store.tsx 缺少 registerStoreReload，同步后酒款数据不刷新
- [x] 修复：bottles/taxonomy.tsx 缺少 registerStoreReload，同步后分类体系不刷新
- [x] 修复：homemade/store.tsx 缺少 registerStoreReload，同步后自制库数据不刷新
- [x] 修复：lab/store.tsx 缺少 registerStoreReload，同步后研发项目数据不刷新
- [x] 升级：engine.ts 添加同步前自动备份（backupLocalData）
- [x] 升级：engine.ts 添加备份恢复功能（restoreFromBackup）
- [x] 升级：engine.ts 添加同步日志（appendLog / getSyncLog，最多50条）
- [x] 升级：engine.ts 添加 initSyncState 初始化备份和日志状态
- [x] UI：me.tsx 添加「立即备份」按钮（橙色）
- [x] UI：me.tsx 添加「恢复备份」按钮（红色，有备份时显示）
- [x] UI：me.tsx 添加「同步日志」入口（绿色）
- [x] 新增：app/sync-log.tsx 同步日志详情页
- [x] 新增：icon-symbol.tsx 添加备份/恢复/日志图标映射

## Build 77 - 同步冲突提示 + 备份导出文件

- [x] 同步冲突检测：60秒内双端修改同一键时弹出 Alert 让用户选择保留哪一方
- [x] 冲突解决函数 resolveConflict：支持保留本机或采用云端，并推送结果
- [x] STORAGE_KEY_LABELS：冲突弹框显示用户可读的数据名称（配方库、标签、门店酒单等）
- [x] exportCurrentDataToFile：将当前所有数据导出为 JSON 文件，通过系统分享面板保存到 Files
- [x] exportSnapshotToFile：将指定快照槽位导出为 JSON 文件
- [x] importFromJsonFile：从 JSON 文件导入数据恢复备份
- [x] 「我的」页面新增「导出备份文件」按钮（紫色图标）
- [x] sync-log.tsx 新增 conflict 类型显示（橙色）

## Build 78 - 备份文件导入功能

- [x] 「我的」页面新增「从文件导入备份」按钮（橙色图标）
- [x] 使用 expo-document-picker 选择 JSON 文件（仅显示 JSON 类型）
- [x] 使用 expo-file-system 读取文件内容
- [x] 预检：验证 appId 是否为 cocktail-r，防止导入错误文件
- [x] 确认弹框：显示备份时间、数据条目数，提示不可撤销
- [x] 导入后自动调用 triggerStoreReload() 刷新所有 store 内存状态
- [x] 导入成功提示：显示恢复条目数，提示重启 App
- [x] 导入中状态：按钮显示「导入中…」并禁用，防止重复操作
- [x] Build 97：Worker 端 /api/sync/notify + /api/sync/check 端点上线（group_ts 表 + D1 持久化）+ 客户端节流优化（30s 内不重复通知）

## Build 102 - 大架构升级

### Phase A: Tab 框架重构 + 现有功能迁移
- [ ] 更新翻译键（tab.cocktail/wine/lab/food/store）
- [ ] 重构 _layout.tsx：5个新 Tab（鸡尾酒/葡萄酒/研发/餐食/门店）
- [ ] 新建 app/(tabs)/cocktail.tsx（原 library.tsx 改名迁移）
- [ ] 新建 app/(tabs)/lab.tsx（原 index.tsx 研发部分 + 书库整合）
- [ ] 重构 app/(tabs)/store.tsx（门店 Tab，含我的入口）
- [ ] 「我的」改为独立页面入口（门店顶部右上角图标）
- [ ] icon-symbol.tsx 添加 fork.knife 等新图标映射

### Phase B: 葡萄酒模块
- [ ] 新建 lib/wine/types.ts（WineBottle 数据类型）
- [ ] 新建 lib/wine/store.tsx（独立 AsyncStorage，键 wine.bottles.v1）
- [ ] 新建 app/(tabs)/wine.tsx（葡萄酒 Tab 主页面）
- [ ] 新建 app/wine-form.tsx（葡萄酒录入/编辑表单）
- [ ] 新建 app/wine/[id].tsx（葡萄酒详情页）
- [ ] 添加 wine.bottles.v1 到 SYNC_KEYS

### Phase C: 餐食模块
- [ ] 新建 lib/food/types.ts（FoodItem + FoodIngredient 类型）
- [ ] 新建 lib/food/menu-store.tsx（菜单 store，键 food.menu.v1）
- [ ] 新建 lib/food/ingredient-store.tsx（原料库 store，键 food.ingredients.v1）
- [ ] 新建 app/(tabs)/food.tsx（餐食 Tab 主页面）
- [ ] 新建 app/food-form.tsx（菜品录入/编辑）
- [ ] 新建 app/food-ingredient-form.tsx（食材录入/编辑）
- [ ] 添加 food.* 到 SYNC_KEYS

### Phase D: 研发模块升级
- [ ] 新建 lib/lab/plan-store.tsx（计划清单 store，键 lab.plan.v1）
- [ ] 新建 app/lab/plan.tsx（计划清单页面：鸡尾酒/餐食 计划产品+采购）
- [ ] 重构 lab Tab：计划清单 / 研发计划 / 书库 三段切换

### Phase E: 门店模块升级
- [ ] 新建 lib/store/revenue-store.tsx（营业状况，键 store.revenue.v1）
- [ ] 新建 lib/store/petty-store.tsx（备用金 A-N，键 store.petty.v1）
- [ ] 新建 lib/store/inventory-store.tsx（进销存，键 store.inventory.v1）
- [ ] 新建 app/store/revenue.tsx（营业状况页面）
- [ ] 新建 app/store/petty.tsx（备用金记录页面，A-N 分类）
- [ ] 新建 app/store/analytics.tsx（经营分析页面）
- [ ] 新建 app/store/inventory.tsx（进销存页面）
- [ ] 门店在售清单升级（引用三模块数据）
- [ ] 门店采购清单升级（供应商+自购链接）

---

## Build 121 — 同步引擎 v2.0 全面升级（2026-08-03）

### ✅ P0 数据安全修复（核心）
- [x] `flushDirtyKeys` 加锁：`initialSync` 完成前禁止任何推送，防止旧设备/空设备覆盖云端新数据
- [x] 空设备安全拉取：`localTs=0` 时无条件拉取云端，绝不推送本地空数据
- [x] `localTs=0` 推送守卫：无时间戳的键在 `flushDirtyKeys` 中跳过推送，重新入队
- [x] `SYNC_KEYS` 扩展：新增 26 个键，覆盖葡萄酒/餐食/人工成本/月度报表/备用金/营业状况/套餐/经营分析/预支记录

### ✅ P1 合并策略升级
- [x] 字段级合并：同一条记录两端修改不同字段时各自保留（LWW per field）
- [x] `ID_LIST_KEYS` 扩展：新增 8 个模块（葡萄酒/餐食/计划/员工/薪资/供应商/货款）
- [x] 新建 `lib/sync/record-history.ts`：配方/酒款/自制品最近 5 个版本历史

### ✅ P1 各模块 Store 补全
- [x] `lib/labor/store.tsx`：`usePersisted` hook 升级，5 个键全部接入同步
- [x] `lib/labor/advance-store.tsx`：预支记录接入同步
- [x] `lib/wine/store.tsx`：快照键和手动进货键接入同步
- [x] `lib/store/monthly-summary/store.tsx`：4 个键全部通知同步引擎
- [x] `lib/store/monthly-report/store.tsx`：接入同步
- [x] `lib/store/period-analysis/store.tsx`：settings 键补全
- [x] `lib/menu/package-store.tsx`：套餐接入同步
- [x] `lib/food/ingredient-store.tsx`：采购记录键接入同步

### ✅ P1 备份系统升级
- [x] 本地快照：3 → 7 个循环（向后兼容自动扩展）
- [x] 备份摘要：扩展为全模块统计（葡萄酒/餐食/人工/月报等）
- [x] 分片存储：>1.5MB 自动分片，防 AsyncStorage 2MB 上限

### ✅ P1 冲突处理升级
- [x] 冲突弹框显示数据预览（本机 N 条 vs 云端 M 条）
- [x] 自动推荐：时间更新且数据更多的版本标注「✓推荐」
- [x] 剩余冲突数量提示
- [x] `STORAGE_KEY_LABELS` 补全 26 个新模块标签

### ✅ P2 同步日志升级
- [x] 日志上限：50 → 200 条
- [x] `sync-log.tsx` 实时刷新：订阅 `subscribeSyncState`，同步时自动更新
