# 本地存储键迁移与清理策略：全面安全审计

**作者：Manus AI**  
**审计日期：2026-08-18**  
**范围：`pnpm audit:storage` 识别的 124 个键/键模式、21 个动态键模式，以及认证、同步、组切换、快照、导出、导入、备份和清理路径。**

> 本审计仅分析源代码、存储键清单、数据类型和读写边界；没有读取、导出或披露任何设备中的实际业务数据或凭据。

## 1. 审计结论

当前策略方向正确：已将凭据、业务数据、偏好和诊断数据划分为 S0–S3，且 `SYNC_KEYS` 不包含 `app_session_token` 或 `cf.sync.deviceToken`。但是，**策略尚未完全落地为受强制执行的代码约束**。最重要的剩余问题是 Web `deviceToken` 的持久化、Snapshot V1 的明文自动复制与共享导出、以及尚未实现的注册表/TTL/密钥管理门禁。

| 等级 | 结论 | 状态 | 必须动作 |
|---|---|---|---|
| P0 | Web `recoveryTicket` 曾写入 AsyncStorage。 | **已修复**：只存在于当前页面内存，刷新后安全阻断。 | 保持回归测试；不重新引入持久化降级。 |
| P0 | Web `cf.sync.deviceToken` 仍可写入 AsyncStorage。 | **未修复**。 | 改为 HttpOnly、Secure、SameSite 服务端会话，或只在当前内存保持短期票据。 |
| P1 | Snapshot V1 在启动时将 `SYNC_KEYS` 复制到 AsyncStorage，业务内容为明文；`simpleHash()` 不是密码学校验。 | **已准确标注，尚未迁移**。 | 接入原生 AES-GCM Provider 后迁移至 V2；V1 只读、受控淘汰。 |
| P1 | 原生端高敏感业务数据仍分散于 AsyncStorage 明文 JSON，且导出文件为明文 JSON。 | **未修复**。 | 先加密人事/薪资/供应商金融数据，再扩展到月报与库存成本；明文导出须显式确认。 |
| P1 | `manus-runtime-user-info` 在 Web localStorage 中包含身份展示信息。 | **未修复**。 | 最小化为非敏感显示字段，身份由服务端 Cookie 会话获取。 |
| P2 | 21 个动态键模式未被注册表统一治理；当前 `audit:storage` 能发现但不能阻断违规。 | **未修复**。 | 建立注册表、键模式清单和 CI 差异门禁。 |
| P2 | 组切换会话、同步日志、诊断及迁移标志尚无统一 TTL/清理执行器。 | **未修复**。 | 以注册表驱动定时清理；启动、登出、离组和版本退役均触发。 |

## 2. 已验证的安全边界

### 2.1 已修复：Web 恢复票据不再落盘

`cf.sync.groupSwitchTicket.{switchId}` 在 Web 不再写入 AsyncStorage/localStorage，而只保留在当前 JavaScript 页面生命周期的内存中。刷新、关闭页面或崩溃后票据丢失，恢复操作必须安全失败并由用户重新发起；这牺牲了 Web 冷启动自动恢复能力，以换取不保存高敏感授权物的安全边界。

原生端仍使用 SecureStore 保存小型票据。SecureStore 是凭据存储，不可用作业务数据库。[1]

### 2.2 认证和同步白名单的正向检查

`app_session_token` 的原生端后端为 SecureStore，且同步/快照白名单未包含会话 token 或设备 token。这个隔离应保持为硬性 CI 断言，而不是仅凭人工约定。

`Snapshot V2` 契约已将 `app_session_token`、`manus-runtime-user-info` 和**全部** `cf.sync.*` 命名空间列为排除项；这避免了后续新增的同步身份字段绕过窄匹配规则进入业务快照。

## 3. 发现的高风险路径

### 3.1 Web deviceToken：剩余 P0

`cf.sync.deviceToken` 是设备授权物。即使它不在快照或同步白名单中，只要 Web 后端仍通过 AsyncStorage 回退持久化，该 token 就可被同源脚本、浏览器本地数据导出、XSS 或共用设备会话读取。它必须从“客户端长期 token”改为“服务端受 Cookie 保护的会话”或“页面内存短期 token”。

**验收条件**：`pnpm audit:storage` 不再将任何 Web 凭据记录为 AsyncStorage/localStorage；测试覆盖刷新后不能恢复 token、服务端拒绝缺失 Cookie 的同步请求、登出/离组立即失效。

### 3.2 Snapshot V1：明文复制与错误完整性假设

`createSnapshot()` 在启动时读取 `SYNC_KEYS` 并写入 `backup.snapshot.{0..6}`。当前快照包含人工、薪资、供应商、经营、库存等业务数据；`simpleHash()` 只是非密码学校验值，攻击者可以同时修改 payload 与校验值，不能提供防篡改或保密性。

审计已修正源文件中的名称与注释：V1 被明确标识为“本地明文快照”，不得再称作加密备份。V2 必须在写入前以 AES-256-GCM 认证加密，并在 tag 验证失败时完全拒绝恢复。Android 官方推荐 AES-256 GCM；Apple CryptoKit 的 AES.GCM 和 Expo Crypto 都支持认证附加数据（AAD）。[2] [3] [4]

### 3.3 业务数据与明文导出

薪资、人事、银行账户、供应商联系方式、采购、月报、备用金、库存成本等大对象目前为 AsyncStorage 中的 JSON。这些对象不应迁入 SecureStore（容量和用途不匹配），但应在原生端进入受平台密钥保护的加密文件/数据库层。

`exportSnapshotToFile()` 与 `exportCurrentDataToFile()` 生成的 JSON 是有意的用户可移植导出，但当前没有“含高敏感字段”的显示确认、分类摘要或导出后清理提示。该路径不属于静默泄露，却需要 UI 明示：**导出文件未加密，用户必须自行选择可信分享目标**。长期目标是提供单独的密码/恢复密钥包装导出格式，不能复用本机 V2 设备密钥。

### 3.4 动态键、TTL 与删除责任

当前有 21 个动态键模式，包括快照分片、书籍章节、同步时间戳、角色设置和通用持久化 Hook。审计脚本能列出它们，但没有可机器验证的 owner、分类、版本、TTL、同步资格和删除事件。

这造成两个风险：新动态键可能绕过敏感性判断；迁移标志、诊断、分片和失败状态可能永久残留。特别是 `cf.sync.groupSwitchSession.v1` 虽不含恢复票据，仍含跨组关联信息，应强制 24 小时 TTL；`sync.log.v1` 与切换诊断应遵循 7 天或 200 条上限。

## 4. 策略修订：必须执行的治理规则

### 4.1 注册表先于读写

在引入任何新增存储键前，必须登记以下记录；未登记则 CI 失败。

```ts
type StorageEntry = {
  key: string | { pattern: RegExp; example: string };
  owner: string;
  classification: "S0-public" | "S1-business" | "S2-credential" | "S3-diagnostic";
  backend: "async" | "native-encrypted" | "secure-store" | "web-server-session";
  schemaVersion: number;
  sync: "none" | "business";
  backup: "none" | "v2-encrypted";
  ttlMs?: number;
  purgeOn: Array<"logout" | "leave-group" | "switch-complete" | "startup-ttl" | "version-retirement">;
  validator: (raw: unknown) => boolean;
};
```

注册表应成为 `SYNC_KEYS`、备份包含列表、清理执行器和 `audit:storage` 的唯一来源；禁止四处维护字符串数组。

### 4.2 版本迁移规则

1. 新版本写入**新键**，例如 `labor.employees.v2` 或新的加密容器；运行时不长期读取旧键。
2. 迁移读取前先使用旧 schema validator；不合法数据隔离并记录无敏感错误码，禁止猜测性补字段。
3. 新值写入后必须重新读取、解密/验证、进行新 schema validator 校验；成功才标记迁移完成。
4. 旧键保留仅限一个明确发布窗口；窗口结束后删除旧键、迁移标志、兼容代码与专属测试。
5. 任何 S2 凭据键都不参与迁移、同步、备份或导出；凭据只重新认证或重新注册。

### 4.3 清理规则

| 类别 | 最大保留 | 清理机制 |
|---|---|---|
| Web 内存恢复票据 | 当前页面生命周期 | 完成、取消、报错、刷新、关闭均清除。 |
| 原生恢复票据 | 10 分钟 | 读取前检查 `expiresAt`；到期立即删除 SecureStore 项。 |
| 组切换会话 | 24 小时 | 每次启动、恢复、完成、取消、离组触发清理。 |
| 同步日志/诊断 | 7 天或 200 条 | 写入时裁剪；启动时 TTL sweep；只保留错误码与匿名标识。 |
| V1 快照 | V2 验证稳定后的一个发布窗口 | 用户确认或到期后批量删除 V1 槽位、分片、元数据和 `simpleHash` 代码。 |
| V2 快照 | 7 槽、每槽 30 天 | 覆盖、离组、数据清除或 key rotation 过期时删除密文和元数据。 |
| 高敏感业务数据 | 用户可见业务保留期 | 用户数据清除、离组、合规删除、版本退役；删除操作记录不含 payload 的审计事件。 |

### 4.4 备份、同步与导出规则

- 备份名单只能由注册表中 `backup: "v2-encrypted"` 的 S1 项生成。
- 同步名单只能由注册表中 `sync: "business"` 的 S1 项生成。
- S2 凭据及全部 `cf.sync.*` 永不进入快照、导出和同步 payload。
- 明文 JSON 导出在 V2 上线前必须标注敏感性，显示分类摘要与用户确认；V2 上线后提供独立的、用户输入密码/恢复密钥保护的可移植导出格式。
- 恢复不得逐键部分写入。V2 恢复先在临时区域验证完整 payload，再以受控事务/写入屏障切换；认证失败、键不可用或 schema 不合法时保持当前业务数据不变。

## 5. 实施优先级

| 顺序 | 工作 | 退出标准 |
|---|---|---|
| 1 | 删除 Web `deviceToken` 的 AsyncStorage 回退，接入 HttpOnly 服务端会话。 | 本地存储审计不出现 Web 凭据落盘。 |
| 2 | 实现原生 AES-GCM Provider；接入 Snapshot V2 的真实 seal/open。 | iOS/Android 真机通过 tag/AAD/错误 key/锁屏测试。 |
| 3 | 双写 V1/V2、只读验证 V2；补齐原子恢复写入屏障。 | 连续两个发布周期无真实 V2 解密失败。 |
| 4 | 建立 Storage Registry 和 CI 策略门禁。 | 新键、动态键、同步/备份名单均自动比对。 |
| 5 | 先迁移薪资/人事、供应商金融数据；再迁移月报、备用金与库存成本。 | AsyncStorage 不再承载 S1 高敏感明文。 |
| 6 | 淘汰 V1 快照、旧导出表述与 `simpleHash`。 | 运行时只读 V2；无兼容层。 |

## 6. 持续验证

每次提交涉及存储时运行：

```bash
pnpm audit:storage
pnpm check
pnpm test
```

CI 还应执行以下规则：凭据不得落入 AsyncStorage/localStorage；S2 不得进入同步/备份/导出；动态键必须匹配注册表模式；日志不得含 token、ticket、authorization、完整用户对象或完整服务端响应；V2 必须通过 nonce/tag/AAD/篡改/错误 key/轮换/离组删除测试。

## 参考资料

[1] [Expo SecureStore Documentation](https://docs.expo.dev/versions/latest/sdk/securestore/)  
[2] [Android Developers — Cryptography](https://developer.android.com/privacy-and-security/cryptography)  
[3] [Apple CryptoKit — AES.GCM](https://developer.apple.com/documentation/cryptokit/aes/gcm)  
[4] [Expo Crypto Documentation](https://docs.expo.dev/versions/latest/sdk/crypto/)  
[5] [React Native Security](https://reactnative.dev/docs/security)  
[6] [OWASP MASVS — Storage](https://mas.owasp.org/MASVS/05-MASVS-STORAGE/)
