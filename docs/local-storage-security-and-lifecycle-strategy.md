# 本地存储安全审计与长期版本迁移清理策略

**作者：Manus AI**  
**审计基线：2026-08-18**  
**范围：Cocktail R 生产源代码中的 AsyncStorage、expo-secure-store、Web localStorage、动态键模式，以及本地备份与同步白名单。**

> 本审计只分析源代码、类型和键清单；**未读取、导出或披露任何用户设备中的实际存储值**。键数量与分类以 `pnpm audit:storage` 生成的 `docs/local-storage-schema.json` 为准。

## 1. 执行结论

当前审计识别 **124 个本地存储键或键模式**，其中 **21 项为动态表达式**。原生端认证会话与设备身份主要使用 `expo-secure-store`；Web 端组切换恢复票据已改为仅存于当前页面内存，但同步设备令牌仍可能回退到未加密的 AsyncStorage。与此同时，员工、薪资、预支、银行账户、供应商联系方式、经营报表和库存成本等业务数据存放在 AsyncStorage，并会进入本地快照与受控同步范围。

React Native 官方将 AsyncStorage 定义为未加密键值存储，明确不应用于令牌或秘密；Expo SecureStore 则使用 Android Keystore 加密的 SharedPreferences 与 iOS Keychain，适合存放小型敏感凭据。[1] [2] 因而本项目的主要风险并不是“所有键都必须加密”，而是**必须将凭据、临时授权物和高敏感业务数据与低敏感 UI 偏好分层处理**。

| 风险级别 | 当前结论 | 处理优先级 |
|---|---|---|
| P0 | 认证模块曾将令牌前缀和完整用户对象写入 console；本次已移除敏感日志内容。 | 已修复，持续测试 |
| P0 | Web 端 `cf.sync.deviceToken` 仍可能写入 AsyncStorage，属于可授权秘密；`recoveryTicket` 已改为仅内存保存。 | 下一安全迭代必须处理 deviceToken |
| P1 | 员工、薪资、银行账户、供应商联系方式和经营数据在 AsyncStorage 中以明文 JSON 保存，并会被本地快照复制。 | 设计完成后分阶段迁移 |
| P1 | 本地快照注释称“加密”，实际只使用 `simpleHash()` 完整性指纹，不提供保密性。 | 文档已纠正；迁移时改为加密容器 |
| P2 | 业务快照、同步日志、诊断与动态键缺少统一 TTL、分类元数据、版本登记和删除责任。 | 纳入统一注册表和生命周期治理 |

## 2. 当前键分类与风险边界

### 2.1 凭据、会话与授权恢复物

| 键或模式 | 当前后端 | 数据性质 | 风险判定 | 目标状态 |
|---|---|---|---|---|
| `app_session_token` | 原生 SecureStore；Web Cookie 会话 | 认证令牌 | 原生符合用途；禁止出现在 AsyncStorage、备份、日志和同步白名单。 | 原生 SecureStore；Web 仅 HttpOnly、Secure、SameSite Cookie |
| `manus-runtime-user-info` | 原生 SecureStore；Web localStorage | 用户 ID、OpenID、姓名、邮箱、登录方式 | Web localStorage 对脚本注入和共用浏览器暴露面更大。 | Web 仅保存最小化的非敏感展示信息，认证身份由服务端 Cookie 获取 |
| `cf.sync.deviceToken` | 原生 SecureStore；Web AsyncStorage | 同步设备授权令牌 | Web 明文持久化为 P0 风险。 | 原生 SecureStore；Web 改为 HttpOnly 会话或短期内存令牌 |
| `cf.sync.deviceId`、`groupId`、`deviceRole`、`allowedKeys`、`deviceName` | 原生 SecureStore；Web AsyncStorage | 设备身份与权限范围 | 虽不都是秘密，但组合后可增加权限篡改、隐私关联和诊断泄露风险。 | 身份由服务端验证；客户端仅保留最小非秘密显示元数据 |
| `cf.sync.groupSwitchTicket.{switchId}` | 原生 SecureStore；Web 当前页面内存 | 组切换恢复票据 | 可用于恢复切换，属于临时高敏感授权物。 | Web 不落盘票据；刷新后安全阻断并重新发起切换；原生 SecureStore + 10 分钟 TTL |
| `cf.sync.groupSwitchSession.v1` | AsyncStorage | 切换状态、设备/组标识、错误码 | 不含票据，但含跨组关联信息。 | 保留状态最小集；使用短 TTL，完成或失败终态立即清除 |

### 2.2 高敏感业务数据

以下键不直接承载认证秘密，但内容可能包含个人信息、金融信息、工资和经营数据。OWASP 将未受适当保护地在设备保存此类数据视为不安全数据存储风险。[3]

| 键族 | 代表键 | 可能包含的敏感字段 | 当前传播范围 | 目标存储类别 |
|---|---|---|---|---|
| 人工与薪资 | `labor_employees_v1`、`labor_payslips_v1`、`labor_salary_advances.v1`、`labor_month_close_archives_v1` 等 | 姓名、电话、证件号、银行卡、基本工资、补贴、预支、考勤 | AsyncStorage、同步白名单、本地快照 | **受保护业务数据** |
| 供应商与采购 | `spirits.suppliers.v1`、`spirits.purchases.v3`、`food.purchases.v1`、`supplier.match.memory.v1` | 联系人、电话、微信、地址、银行名称/账号、采购金额 | AsyncStorage、部分同步/快照 | **受保护业务数据** |
| 报表与资金 | `monthly_reports_v1`、`monthly_summary.*`、`period_analysis.*`、`store.revenue.v1`、`store.petty.v1` | 营收、成本、收款、备用金、经营分析、对账信息 | AsyncStorage、同步白名单、本地快照 | **受保护业务数据** |
| 设备与经营资料 | `equipment.inventory.v1`、库存、菜单、配方、图片上传集合 | 设备资产、库存、配方、照片同步状态 | AsyncStorage、部分同步/快照 | **业务数据** |

### 2.3 低敏感配置与可重建数据

语言、主题、分类、样式、最近使用单位、浏览器布局、库存显示配置、税收/配方分类、迁移完成标志、同步时间戳等不应进入 SecureStore。它们可继续使用 AsyncStorage，但必须有明确 owner、版本号、默认值和清除路径。

| 类别 | 示例 | 规则 |
|---|---|---|
| UI 与语言偏好 | `app.lang.v1`、`cocktail.prefs.v1`、`cocktail_recent_units` | AsyncStorage；可清除；默认值可重建 |
| 分类与模板 | `bottles.taxonomy.*`、`schedule.shift_templates.v1` | AsyncStorage；版本化；与业务数据分开备份 |
| 运行时元数据 | `sync.lastPulledAt`、`sync.dirtyKeys.pending`、`sync.ts.{key}` | AsyncStorage；设置 TTL；不得包含业务 payload 或凭据 |
| 诊断记录 | `sync.log.v1`、`cf.sync.switchDiagnostics.v1` | AsyncStorage；仅错误码、事件名、时间与匿名 ID；不得记录 token、票据、姓名、完整响应体 |

### 2.4 备份与同步边界

`SYNC_KEYS` 白名单包含人工、薪资、供应商、采购、库存和月报等业务键，但不包含 `app_session_token` 或 `cf.sync.deviceToken`。这降低了认证令牌被同步或快照复制的风险；但快照仍会复制大量高敏感经营数据。

`lib/backup/local-backup.ts` 当前使用 `simpleHash()` 生成校验值。该函数仅可用于发现意外变更，**不是加密、不是签名，也不能保护快照保密性**。未来不得再将此路径称为“本地加密备份”，直至使用经审查的加密容器实现。

## 3. 已完成的即时修复

本次审计已修改 `lib/_core/auth.ts`：

1. 不再输出会话令牌的任何前缀。
2. 不再输出完整用户对象。
3. 日志仅保留“令牌存在/不存在”与操作结果等非敏感状态。

后续测试必须断言认证、同步和备份日志中不包含 token、ticket、password、authorization header、完整用户对象或完整服务端响应。React Native 官方同样提醒，敏感信息可能因持久化整个状态树或发送到监控服务而被意外暴露。[1]

## 4. 目标存储分层模型

| 层级 | 允许的数据 | 后端与控制 | 严禁内容 |
|---|---|---|---|
| S0：公开/可重建 | UI 偏好、分类、展示顺序、非个人化缓存 | AsyncStorage | 凭据、个人资料、金融与薪资数据 |
| S1：业务数据 | 库存、报表、菜单、供应商、员工与薪资 | 受审查的应用层加密数据库或加密文件层；密钥只在原生安全存储中保存 | token、恢复票据、服务端密钥 |
| S2：凭据与授权物 | 会话 token、设备 token、恢复票据、私钥引用 | 原生 SecureStore；Web HttpOnly Cookie / 服务端会话 | 业务大对象、快照、历史日志 |
| S3：诊断与生命周期元数据 | 匿名事件、版本、时间戳、迁移进度 | AsyncStorage，短 TTL，严格字段白名单 | payload、联系方式、金额明细、秘密 |

> SecureStore 适合小型键值凭据，不应成为业务数据库。Expo 文档说明其在 Android 与 iOS 上依赖平台安全存储，同时提醒其持久化行为因平台而异，不能作为不可替代业务数据的唯一事实来源。[2]

## 5. 长期版本迁移策略

### 5.1 建立单一存储注册表

新增 `lib/storage/registry.ts`，使每个键在代码中唯一登记。每条记录必须包含以下字段：

```ts
type StorageClassification = "public" | "business" | "credential" | "diagnostic";

type StorageRegistryEntry = {
  key: string;
  owner: string;
  classification: StorageClassification;
  backend: "async" | "encrypted-business" | "secure" | "web-session";
  schemaVersion: number;
  sync: "none" | "business";
  backup: "none" | "encrypted";
  ttlDays?: number;
  purgeOn: Array<"logout" | "leave-group" | "uninstall" | "version-retirement">;
  validator: (value: unknown) => boolean;
};
```

`pnpm audit:storage` 必须与注册表比对：新增的读写键没有注册表记录、敏感键落入 AsyncStorage、凭据键加入 `SYNC_KEYS` 或备份白名单、日志键没有 TTL 时，CI 应失败。

### 5.2 版本信封与显式迁移

所有 S1/S3 新键使用统一信封，而不是依赖隐式字段兼容：

```ts
type StoredEnvelope<T> = {
  schemaVersion: number;
  writtenAt: number;
  expiresAt?: number;
  payload: T;
};
```

迁移必须遵循“**一次性、可验证、无运行时兼容层**”原则：

1. 发布新版本时，读取旧键并使用旧版本专属 validator 验证；无效数据直接隔离并报告错误码，不做猜测性修复。
2. 将结果写入新版本键（例如 `labor.employees.v2`），重新读取并用新 validator 验证。
3. 验证成功后切换活动版本；保留旧键仅用于受控回滚窗口。
4. 回滚窗口结束或用户确认后，批量删除旧键、旧迁移标志、旧测试和旧实现。
5. 运行时只读取当前版本；不得保留“加载时自动补字段、自动改数值”的长期兼容代码。

这与当前项目已采用的“废弃代码立即删除”原则一致，也避免旧格式在日常加载时重新污染当前状态。

### 5.3 凭据与授权物迁移

| 项目 | 目标方案 | 截止条件 |
|---|---|---|
| Web `deviceToken` | 改为服务端 HttpOnly、Secure、SameSite Cookie，或仅存在于页面内存的短期令牌；不得落入 AsyncStorage/localStorage。 | `audit:storage` 不再识别 Web 凭据写入 AsyncStorage |
| Web `recoveryTicket` | 已改为仅当前页面内存；刷新或关闭后安全阻断并要求重新发起切换。后续可升级为服务端 Cookie 会话恢复。 | 浏览器持久化中不存在票据 |
| 原生凭据 | 保持 SecureStore，配置适当可访问级别；注销、离组、设备撤销与令牌过期时显式删除。 | 单元测试覆盖四类清除事件 |
| 用户展示信息 | Web 端最小化存储，避免邮箱/OpenID；Native 保留在 SecureStore，退出时删除。 | 仅保留渲染必要字段 |

### 5.4 业务数据加密与备份迁移

业务数据不应简单迁入 SecureStore，因为其容量与用途均不适合大对象。目标方案应采用**经过审查的原生加密数据库或加密文件层**；加密密钥由 SecureStore/Keychain/Keystore 管理，业务 payload 使用认证加密（AEAD）并包含版本、nonce、key ID 和认证标签。禁止自行实现自定义密码算法或将密钥与密文放在同一 AsyncStorage 键中。

本地快照的目标格式：

```ts
type EncryptedSnapshotV2 = {
  schemaVersion: 2;
  createdAt: number;
  keyId: string;
  nonce: string;
  ciphertext: string;
  authenticationTag: string;
  manifest: { keyCount: number; classifications: string[] };
};
```

快照只包含注册表中 `backup: "encrypted"` 的业务键，永不包含 S2 凭据；默认保留 7 个循环槽位，但每个快照应有最大容量、创建失败清理、完整性验证和过期策略。加密迁移完成前，应在 UI 与文档中准确称为“本地快照”，不得称为“加密备份”。

### 5.5 清理与保留策略

| 数据类别 | 默认保留 | 清理触发器 | 说明 |
|---|---|---|---|
| 认证 token、设备 token、恢复票据 | 会话/令牌生命周期 | 登出、离组、设备撤销、到期、切换完成 | 凭据绝不进入备份或同步 |
| 组切换会话 | 最多 24 小时 | 完成、明确取消、不可恢复错误、TTL 到期 | 恢复票据独立 10 分钟 TTL |
| 同步日志与诊断 | 7 天或 200 条，以先到者为准 | TTL、手动诊断清理、离组 | 只记录脱敏错误码和元数据 |
| 本地快照 | 7 个循环槽位且每槽不超过 30 天 | 新快照覆盖、用户清除、离组 | 迁移后必须加密 |
| UI 偏好与分类缓存 | 无固定 TTL | 重置设置、版本退役 | 可从默认值重建 |
| 业务财务与人事数据 | 业务保留期，不自动删除 | 用户数据清除、离组、合规删除、版本退役 | 删除前必须明确确认并生成审计事件 |
| 迁移标志 | 单次迁移完成后不超过一个发布周期 | 验证新版本稳定后 | 不应长期积累“已迁移”键 |

## 6. 落地里程碑与验收标准

| 阶段 | 工作内容 | 验收标准 |
|---|---|---|
| A：立即 | 保持本次日志脱敏；为认证与同步编写日志泄露测试。 | 测试中无 token/user object 输出；`grep` 无 token 前缀日志 |
| B：下一安全迭代 | 消除 Web AsyncStorage 中的 `deviceToken`；`recoveryTicket` 已完成内存化，后续可引入服务端 Cookie 会话恢复。 | 浏览器持久化中不存在授权秘密 |
| C：存储注册表 | 落地 `storage-registry.ts`、CI 比对与敏感性分类。 | 新增键未登记时 CI 失败；同步/备份白名单来自注册表 |
| D：业务加密试点 | 先迁移人事薪资与供应商银行账户；再扩展到月报和快照。 | 密钥不在 AsyncStorage；业务 payload 不可被明文读取 |
| E：快照 V2 | 使用加密容器和显式版本信封；停止将旧 `simpleHash` 作为“加密”表述。 | 快照不含凭据；认证加密验证失败时拒绝恢复 |
| F：治理常态化 | 每次发布运行审计、版本检查、过期键清除与渗透测试。 | 版本、TTL、owner、清除路径可追溯 |

## 7. 持续验证清单

1. 每次修改任何存储调用后运行 `pnpm audit:storage`，并提交更新的 Markdown 与 JSON 清单。
2. 新增键前必须选择分类、owner、后端、版本、同步/备份资格、TTL 和清除事件。
3. CI 需要检查：凭据不得写入 AsyncStorage/localStorage；`SYNC_KEYS`/备份不含 S2；日志中不含 token/ticket/authorization；动态键有稳定前缀和注册表模式。
4. 每个 S1/S2 键至少拥有：正常读写、无效结构拒绝、版本迁移、过期清除、登出/离组清除与备份排除测试。
5. 每次 TestFlight 发布前，在真实 iOS 与 Android 设备上检查登出、卸载重装、切组恢复和离线快照清除行为；尤其注意 iOS Keychain 可能跨同 Bundle ID 的卸载重装保留。[2]

## 参考资料

[1] [React Native Security — Async Storage and Secure Storage](https://reactnative.dev/docs/security)  
[2] [Expo SecureStore Documentation](https://docs.expo.dev/versions/latest/sdk/securestore/)  
[3] [OWASP MASVS — Storage](https://mas.owasp.org/MASVS/05-MASVS-STORAGE/)
