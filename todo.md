# Project TODO

## 核心功能（已完成）
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
