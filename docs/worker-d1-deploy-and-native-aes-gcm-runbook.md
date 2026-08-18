# Worker D1 部署、原生 AES-GCM 对接与 Snapshot 测试审计运行手册

> **适用版本：** Git `main` 的 `0b6e7bc` 及以后版本。  
> **部署对象：** Worker `cocktail-ai`、D1 数据库 `cocktail-r-db`、本地文件 `workers/cocktail-ai/worker-v4.js`。  
> **原则：** 先验证、再迁移、后部署；任何生产操作均不读取或打印 API Token、设备令牌、配对码或业务快照。

## 1. 上线前核验与 D1 迁移命令

当前 Worker 使用 `DB`、`AI`、`CACHE` 三类绑定，并依赖若干 Dashboard 中的变量和 Secrets。因此，**不得**在没有完整 Wrangler 配置的情况下直接执行裸 `wrangler deploy`；否则可能覆盖非变量类绑定。Cloudflare 也将配置文件视为 Worker 配置的来源，并说明 `keep_vars` 只保留 Dashboard 变量，不能替代显式资源绑定配置。[1]

先在项目根目录运行以下只读核验。此步骤不会修改 D1 或 Worker：

```bash
cd /home/ubuntu/cocktail-r-build

pnpm check
pnpm test -- --reporter=dot
pnpm ci:storage
node --check workers/cocktail-ai/worker-v4.js

# 登录后仅读取D1数据库元信息；不会导出或读取业务表数据。
pnpm dlx wrangler d1 info cocktail-r-db --json
```

在 Cloudflare Dashboard 的 Worker **Settings → Bindings** 中抄录现有绑定，至少包含 `DB` 对应的 D1 `cocktail-r-db` 数据库 ID、`AI` 绑定和 `CACHE` 的真实资源类型/ID。随后在 `workers/cocktail-ai/` 创建**仅包含真实 ID、绝不包含 API Token 或业务数据**的 `wrangler.jsonc`。下方配置是结构模板，尖括号必须替换为 Dashboard 中已存在的真实绑定，不应擅自创建新资源。

```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "cocktail-ai",
  "main": "worker-v4.js",
  "compatibility_date": "2026-08-18",
  "keep_vars": true,
  "workers_dev": true,
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "cocktail-r-db",
      "database_id": "<从Dashboard复制的现有D1数据库ID>",
      "migrations_dir": "migrations"
    }
  ],
  "ai": { "binding": "AI" },
  "kv_namespaces": [
    {
      "binding": "CACHE",
      "id": "<从Dashboard复制的现有CACHE资源ID>"
    }
  ]
}
```

配置审阅无误后，先检查远程未应用迁移，再执行仅新增会话表和索引的 SQL。Cloudflare 的 D1 命令支持将 `.sql` 文件直接作用于远程数据库；标准迁移系统会记录应用状态并在失败时回滚本次迁移。[2] [3]

```bash
cd /home/ubuntu/cocktail-r-build/workers/cocktail-ai

# 读取远程迁移状态；无写入。
pnpm dlx wrangler d1 migrations list cocktail-r-db \
  --remote \
  --config wrangler.jsonc

# 方式 A：对当前仓库已有单个迁移文件执行。首次部署建议使用，便于精确控制范围。
pnpm dlx wrangler d1 execute cocktail-r-db \
  --remote \
  --file migrations/20260818_web_device_sessions.sql \
  --config wrangler.jsonc

# 只读核验：应返回 web_device_sessions 与 web_device_memory_tickets 两张表。
pnpm dlx wrangler d1 execute cocktail-r-db \
  --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('web_device_sessions','web_device_memory_tickets') ORDER BY name;" \
  --config wrangler.jsonc
```

迁移完成并核验两张表存在后，再部署 Worker。命令使用配置文件而非裸参数，从而保留显式的 D1、AI、CACHE 绑定；`keep_vars` 同时保留 Dashboard 已配置的变量。[1]

```bash
cd /home/ubuntu/cocktail-r-build/workers/cocktail-ai
pnpm dlx wrangler deploy --config wrangler.jsonc

# 部署后的无凭据健康检查：不发送设备身份或业务数据。
curl --fail --silent --show-error \
  https://cocktail-ai.kikikong2017.workers.dev/health

# 未授权保护检查：必须是401，而不能返回同步数据。
curl --silent --show-error --output /tmp/cocktail-sync-status.json \
  --write-out "%{http_code}\n" \
  https://cocktail-ai.kikikong2017.workers.dev/api/sync/snapshot
```

预期健康响应包含 `status: "ok"` 和 `version: "v4"`。第二个请求必须输出 `401`。若迁移失败，停止在 D1 阶段，不部署 Worker；若部署后鉴权或健康检查异常，在 Cloudflare **Deployments / Versions** 回滚到已知稳定版本。代码回滚不会删除已创建的两个空会话表，也不应删除或改写任何业务表。

## 2. 正式原生 AES-GCM 提供器对接方案

正式实现应以原生密码学 API 为唯一加密实现：iOS 使用 CryptoKit `AES.GCM`，Android 使用 Android Keystore 生成的 `AES/GCM/NoPadding` 密钥。两平台都应让密钥留在系统安全存储中，JavaScript 只接触 `keyId`、nonce、ciphertext、认证标签及错误码；绝不传递、记录或序列化原始 AES 密钥。[4] [5]

| 层级 | 责任 | 不允许的行为 |
|---|---|---|
| TypeScript `SnapshotV2Crypto` | 传入 UTF-8 plaintext/AAD，接收 Base64 nonce、ciphertext、tag；将确定性错误映射为业务错误。 | 生成密钥、保存密钥字节、自行实现 AES、复用 nonce。 |
| iOS Expo Module | 用 Keychain `WhenUnlockedThisDeviceOnly` 保存 32-byte 对称密钥材料或引用；以 CryptoKit AES-GCM 执行加解密。 | 将密钥放入 UserDefaults、AsyncStorage、iCloud Keychain 或 JS 返回值。 |
| Android Expo Module | 使用 Android Keystore alias `cocktail.snapshot.v2.<keyId>` 创建 AES-256 GCM key。 | 导出 Keystore key、使用固定 IV、将 key 放入 SharedPreferences。 |
| Snapshot 生命周期 | 创建 V1 后立刻生成 V2、读取 V2 后解密验证、30 天后淘汰 V1。 | V2 认证失败时回退到 V1，或在 V2 未验证时删除 V1。 |

建议将当前单密钥 `SnapshotV2Crypto` 扩展为可轮换的解析器。现有 `EncryptedSnapshotV2.keyId` 已为该设计保留字段，但当前 `decryptSnapshotV2` 只接受一个固定密钥实例，不能在密钥轮换后解密旧快照。

```ts
export type NativeAesGcmResult = {
  nonceBase64: string;              // 固定12 bytes
  ciphertextBase64: string;
  authenticationTagBase64: string; // 固定16 bytes
};

export type NativeSnapshotCryptoModule = {
  getOrCreateActiveKey(): Promise<{ keyId: string }>;
  encrypt(input: {
    keyId: string;
    plaintextUtf8: string;
    associatedDataUtf8: string;
  }): Promise<NativeAesGcmResult>;
  decrypt(input: {
    keyId: string;
    nonceBase64: string;
    ciphertextBase64: string;
    authenticationTagBase64: string;
    associatedDataUtf8: string;
  }): Promise<{ plaintextUtf8: string }>;
  rotateKey(): Promise<{ previousKeyId: string; keyId: string }>;
  canUseKey(keyId: string): Promise<boolean>;
  deleteRetiredKey(keyId: string): Promise<void>;
};

export type SnapshotV2KeyResolver = {
  getActive(): Promise<SnapshotV2Crypto>;
  getByKeyId(keyId: string): Promise<SnapshotV2Crypto | null>;
};
```

iOS 模块应为每个 `keyId` 创建或读取一个 Keychain 受保护的 256-bit key，并通过 `AES.GCM.seal(_:authenticating:)` 与 `AES.GCM.open(_:authenticating:)` 操作。Android 模块应以 `KeyGenerator.getInstance("AES", "AndroidKeyStore")` 和 `KeyGenParameterSpec` 创建 256-bit key，使用 12-byte 随机 nonce 与 `GCMParameterSpec(128, nonce)`。两端均应验证 nonce 长度、tag 长度、Base64 规范性和 AAD 非空；认证失败必须映射为 `SNAPSHOT_V2_AUTHENTICATION_FAILED`，而不是返回部分 plaintext。[4] [5]

建议的接入顺序是：先在 Expo Modules API 新建 `NativeSnapshotCryptoModule`，再实现 JS `NativeAesGcmSnapshotV2Provider`；应用启动时调用 `resolver.getActive()` 并以 `configureSnapshotV2Crypto()` 注入活动 key。随后将 `local-backup.ts` 从单例改为按 `EncryptedSnapshotV2.keyId` 调用 `resolver.getByKeyId()`。只有连续 7 天且至少 3 个成功 V2 双写/验证周期后，才允许启动既有 30 天 V1 淘汰窗口。每次轮换保留旧 key 至所有引用该 key 的 V2 slot 已删除、替换或超过保留期；不得按日历时间盲删仍被快照引用的 key。

## 3. Snapshot V1/V2 双写及淘汰测试覆盖审计

当前专项测试共覆盖九项断言，已经验证双写起点、凭据排除、正常解密、ciphertext/tag 篡改拒绝、错误 key ID、错误 schema/manifest、V2 认证失败时禁止 V1 回退、30 天后 V1 删除，以及 Web 会话票据不落盘。

| 测试域 | 已覆盖 | 仍需补充的极端场景 | 优先级 |
|---|---|---|---|
| V2 写入 | V1 与 V2 同槽双写、即时解密验证。 | V1 写入成功但 V2 分片写入中断；V2 写入成功但 meta 写入失败；旧 slot 循环覆盖期间崩溃。 | P0 |
| AEAD 完整性 | ciphertext 与认证标签篡改、错误 key ID。 | nonce 篡改、`createdAt`/AAD 篡改、Base64 非法、tag 长度错误、超大密文和解密后无效 JSON。 | P0 |
| 回退边界 | V2 认证失败时恢复被拒绝，现有业务值保持不变。 | V2 provider 不可用、Keystore 锁定/失效、解密超时；确认这些情况同样绝不写入或回退。 | P0 |
| V1 淘汰 | 验证后 30 天删除 V1，V2 仍可读。 | V2 缺失、V2 已损坏、V2 `v2State=failed`、系统时钟回拨/跳跃、淘汰过程在分片删除中断。 | P0 |
| 旧 App 共存 | 未覆盖。 | 旧版本 App 在新版本写入 V2 后再次写入同一 V1 slot：新版本不得错误优先读取过期 V2。需要给 V2 加入与 V1 mirror 的 `createdAt/hash` 绑定并在读取时比较。 | P0 |
| 恢复原子性 | 当前 `multiSet` 使用一批写入。 | `null` 快照值当前不会删除本地残留键；需测试并实现 `multiRemove` 与 `multiSet` 的两阶段恢复/恢复日志，防止 stale key 与半恢复状态。 | P0 |
| 原生互操作 | 使用测试用伪加密提供器。 | iOS CryptoKit 与 Android Keystore 的固定向量交叉测试、随机 nonce 唯一性、真实 Base64/AAD 兼容、key rotation 旧 key 读取。 | P1 |
| 分片与资源限制 | V2 分片读写实现已存在，但未测试。 | 大于 1.5MB、缺失任一 chunk、重复 chunk、超 10,000 chunk 拒绝、清理孤儿 chunk。 | P1 |
| 凭据过滤 | 已排除 app session 与 `cf.sync.*`。 | 新增注册表 S2 键时自动驱动 Snapshot 排除测试；审计导出和 iCloud 备份的同一排除集合。 | P1 |

最需要先处理的是“旧 App 覆盖 V1 而新 App 读取陈旧 V2”以及“恢复时 `null` 键不删除旧值”两个 P0 场景。它们不是单纯测试空白，而是当前双写协议需要补充的版本并发与恢复原子性机制。建议在正式接入原生 AES-GCM 前先完成这些协议修正及对应故障注入测试。

## References

[1] [Cloudflare Wrangler Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)  
[2] [Cloudflare D1 Wrangler Commands](https://developers.cloudflare.com/d1/wrangler-commands/)  
[3] [Cloudflare D1 Migrations](https://developers.cloudflare.com/d1/reference/migrations/)  
[4] [Apple CryptoKit AES.GCM](https://developer.apple.com/documentation/cryptokit/aes/gcm)  
[5] [Android Cryptography Guidance](https://developer.android.com/privacy-and-security/cryptography)
