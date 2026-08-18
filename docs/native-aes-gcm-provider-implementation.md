# 原生 AES-GCM 加密提供器：正式接入方案与接口定义

**作者：Manus AI**  
**版本：1.0**  
**状态：实施设计；尚未替换生产 Snapshot V1**  
**适用范围：iOS、Android 原生 App；Web 采用受限的服务端会话策略。**

> 本方案的目标是把 Snapshot V2 从“可测试的加密契约”接入为真实的**认证加密（AEAD）**能力。密钥不得写入 AsyncStorage、localStorage、备份、同步、日志、崩溃报告或 JavaScript 持久化状态。

## 1. 设计决策

| 决策 | 规范 | 原因 |
|---|---|---|
| 算法 | AES-256-GCM，12-byte nonce，16-byte tag | AES-GCM 同时提供保密性与篡改检测；Android 官方推荐 AES-256 GCM，Expo Crypto 的跨平台 AES-GCM 默认 nonce 为 12 bytes、推荐 tag 为 16 bytes。[1] [2] |
| 密钥边界 | JS 只看见 `keyId`，永不接触密钥字节 | 防止密钥进入 JS 日志、AsyncStorage、同步或导出文件。 |
| iOS | CryptoKit `AES.GCM` + Keychain `WhenUnlockedThisDeviceOnly` | CryptoKit 的 `seal/open` 支持认证附加数据；Keychain 限定本机且解锁后可用。[3] |
| Android | Android Keystore 中生成的 `AES/GCM/NoPadding` SecretKey | Keystore 可为密钥提供更强保护；Android 官方建议在需要更高密钥安全性时使用它。[1] |
| Web | 不创建可长期恢复的本地业务密钥；只允许 HTTPS + 服务端会话的受限流程 | 浏览器本地存储不等同于 Keychain/Keystore，不能把 Web 作为原生设备密钥保护的替代。 |
| 凭据隔离 | 所有 `app_session_token`、`manus-runtime-user-info`、`cf.sync.*` 都不得进入 V2 payload | 认证、设备身份、授权范围及组切换恢复状态属于 S2，不应和业务快照混装。 |

## 2. 威胁模型与不支持范围

Snapshot V2 防御“设备文件系统、AsyncStorage 备份、错误分享、普通应用日志或被动存储读取导致的明文业务数据泄露”，并在认证标签校验失败时拒绝恢复。它**不**防御已解锁且被完全控制的设备、运行时恶意注入、系统级调试、屏幕内容泄露或服务端账户被盗。

V2 不解决跨设备可读性。使用 `ThisDeviceOnly` / Android Keystore 的设备本地密钥意味着新设备不能直接解密旧设备快照。若未来必须实现跨设备加密备份，必须另建“用户确认的恢复密钥或服务端 KMS 包装密钥”方案；不得将设备 DEK 上传到云端。

## 3. JavaScript 契约

新的原生模块名为 `CocktailCrypto`。它是唯一允许触碰密钥材料的平台边界；`lib/backup/snapshot-v2.ts` 只依赖下列接口。

```ts
export type AeadScope = "snapshot-v2" | "business-v1";

export type AeadKeyRef = {
  keyId: string;              // 不含密钥材料，例如 snapshot-v2:2026-08:3f8a
  scope: AeadScope;
  algorithm: "AES-256-GCM";
  createdAt: number;
};

export type AeadSealInput = {
  keyId: string;
  plaintextBase64: string;
  aadBase64: string;
};

export type AeadSealedData = {
  algorithm: "AES-256-GCM";
  nonceBase64: string;        // 必须恰好 12 bytes
  ciphertextBase64: string;
  tagBase64: string;          // 必须恰好 16 bytes
};

export interface NativeAesGcmProvider {
  getOrCreateKey(scope: AeadScope): Promise<AeadKeyRef>;
  rotateKey(scope: AeadScope, expectedCurrentKeyId: string): Promise<AeadKeyRef>;
  seal(input: AeadSealInput): Promise<AeadSealedData>;
  open(input: AeadSealedData & { keyId: string; aadBase64: string }): Promise<{ plaintextBase64: string }>;
  deleteKey(keyId: string): Promise<void>;
  isAvailable(): Promise<{ available: boolean; reason?: "UNAVAILABLE" | "LOCKED" | "UNSUPPORTED" }>;
}
```

**禁止接口**：`exportKey()`、`getRawKey()`、从 JS 传入 key bytes、在 JS 内生成 nonce、把密钥以 SecureStore 字符串形式长期保存。`keyId` 是可公开的元数据，不可作为授权凭据。

### 3.1 Snapshot V2 适配器

```ts
export function createSnapshotV2Crypto(provider: NativeAesGcmProvider, key: AeadKeyRef): SnapshotV2Crypto {
  return {
    keyId: key.keyId,
    async encrypt(plaintext, associatedData) {
      const sealed = await provider.seal({
        keyId: key.keyId,
        plaintextBase64: toBase64Utf8(plaintext),
        aadBase64: toBase64Utf8(associatedData),
      });
      return {
        nonce: sealed.nonceBase64,
        ciphertext: sealed.ciphertextBase64,
        authenticationTag: sealed.tagBase64,
      };
    },
    async decrypt(input) {
      const opened = await provider.open({
        keyId: key.keyId,
        algorithm: "AES-256-GCM",
        nonceBase64: input.nonce,
        ciphertextBase64: input.ciphertext,
        tagBase64: input.authenticationTag,
        aadBase64: toBase64Utf8(input.associatedData),
      });
      return fromBase64Utf8(opened.plaintextBase64);
    },
  };
}
```

`toBase64Utf8/fromBase64Utf8` 必须采用明确 UTF-8 编码；不可使用隐式平台字符串编码。适配器必须在业务层创建 `SnapshotV2Crypto` 后立即使用，不能把它缓存为全局可导出对象。

## 4. AAD 与加密信封

AAD 不加密但必须被认证。它应绑定快照的不可变身份，防止在同一设备上替换或重放合法密文。

```ts
type SnapshotV2Aad = {
  appId: "cocktail-r";
  schemaVersion: 2;
  snapshotId: string;       // 原生 CSPRNG UUID
  createdAt: number;
  keyId: string;
  scope: "snapshot-v2";
  payloadDigest: string;    // SHA-256(明文序列化)，只用于诊断/一致性，不代替认证标签
};
```

AAD 的规范序列化必须是固定字段顺序的 UTF-8 JSON。写入前验证 `nonce=12 bytes`、`tag=16 bytes`、`algorithm=AES-256-GCM`；读取时任何不符均返回 `SNAPSHOT_V2_ENVELOPE_INVALID`，不得回退到 V1 自动恢复。

目标信封如下：

```ts
type EncryptedSnapshotV2 = {
  schemaVersion: 2;
  appId: "cocktail-r";
  snapshotId: string;
  createdAt: number;
  keyId: string;
  algorithm: "AES-256-GCM";
  nonce: string;
  ciphertext: string;
  authenticationTag: string;
  manifest: {
    keyCount: number;
    includedKeys: string[];
    excludedCredentialKeys: string[];
    sourceSchemaVersions: Record<string, number>;
  };
};
```

## 5. 原生实现要点

### 5.1 iOS（Swift）

1. Keychain lookup 使用稳定 `keyId`，`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`，并设置 `kSecAttrSynchronizable=false`。
2. 首次创建时以系统 CSPRNG 生成 256-bit `SymmetricKey`；Keychain 保存编码后的密钥材料仅供本 App、当前设备使用。
3. 使用 `AES.GCM.seal(plaintext, using:key, authenticating:aad)`；从 `SealedBox` 返回 nonce、ciphertext、tag。
4. 使用 `AES.GCM.open(sealedBox, using:key, authenticating:aad)`；将认证失败归一化为 `SNAPSHOT_V2_AUTH_FAILED`，不返回任何部分明文。
5. 锁屏/Keychain 不可用返回 `KEY_LOCKED`；密钥不存在返回 `KEY_UNAVAILABLE`。

CryptoKit 的 AES.GCM 提供密封与解封 API，并支持认证附加数据。[3]

### 5.2 Android（Kotlin）

1. 使用 `AndroidKeyStore` 中别名 `cocktail-r.snapshot-v2.{rotation}` 生成 `KeyGenerator("AES", "AndroidKeyStore")` 密钥。
2. `KeyGenParameterSpec` 设置 `PURPOSE_ENCRYPT | PURPOSE_DECRYPT`、`BLOCK_MODE_GCM`、`ENCRYPTION_PADDING_NONE`、256 bits；必要时明确 provider `AndroidKeyStore`。
3. 每次 `Cipher.init(ENCRYPT_MODE, key)` 生成新 IV；验证 IV 长度为 12 bytes，输出密文与 16-byte tag 的分离部分。
4. 解密前以 `GCMParameterSpec(128, iv)` 初始化并 `updateAAD(aad)`；捕获 `AEADBadTagException` 为 `SNAPSHOT_V2_AUTH_FAILED`。
5. 不使用已弃用的 Jetpack `security-crypto`；不指定非 Keystore 的 provider。Android 官方推荐 AES-256 GCM，并说明需要更强密钥安全性时使用 Android Keystore。[1]

### 5.3 Expo 集成路径

优先采用**本项目自有 Expo 原生模块**封装上述 iOS/Android 实现，避免在 JavaScript 中导出密钥。Expo Crypto 可以提供 AES-GCM、AAD、nonce 和 tag 的跨平台基础能力，但其密钥对象允许编码导出；因此它可用于验证和过渡测试，不应成为最终硬件/系统边界的唯一密钥管理层。[2]

模块接入要求：

- 使用 Expo prebuild 与 EAS 构建；Expo Go 不承载生产密钥能力。
- `isAvailable()` 在 Web 返回 `UNSUPPORTED`；调用方显示受限提示，不降级写入明文。
- 原生模块不记录 plaintext、ciphertext、AAD、keyId 之外的密钥材料，更不记录 tag 校验异常中的输入。
- 所有 native error 通过固定错误码映射到 JS，禁止透传系统异常字符串。

## 6. 密钥轮换、迁移与清理

| 事件 | 动作 | 验收边界 |
|---|---|---|
| 首次启用 | 创建 `snapshot-v2` 活动密钥；V1 仅只读、迁移后写 V2 | 不删除 V1，直到 V2 可解密验证完成 |
| 常规轮换 | 每 180 天或发生设备授权变更时创建新 `keyId` | 新写入使用新 key；旧 key 保留至所有关联快照自然过期 |
| 认证失败 | 拒绝恢复、保留密文用于用户诊断、生成无敏感错误事件 | 不回退 V1、不部分恢复 |
| 登出/离组 | 删除本设备 Snapshot V2 密文、元数据和所有旧 key | 必须先停止同步并清理组切换状态 |
| 卸载/重装 | `ThisDeviceOnly` / Keystore 密钥不可假定仍存在 | V2 不可解密时显示“本机加密快照不可恢复”，不得伪造恢复 |
| 旧快照淘汰 | V1 在一个受控发布窗口后删除，连同 `simpleHash`、V1 tests、V1 import path | 运行时只接受 V2 |

若未来需要导入他人/旧设备文件，必须使用独立的“用户显式导入 + 密码/恢复密钥包装”格式；不可把设备本地 V2 直接当成可移植备份。

## 7. 测试与发布门禁

| 层级 | 必测项 |
|---|---|
| 单元 | nonce/tag 长度、AAD 不匹配、篡改密文、篡改 tag、错误 keyId、空 key、非法 base64、凭据键排除、V1→V2 迁移与旧键删除 |
| 原生集成 | iOS Keychain 锁屏、Android Keystore 删除、硬件/软件 Keystore 差异、密钥轮换、设备时间变化 |
| 恢复 | 写入中断、分片缺失、V2 认证失败、重复迁移、旧快照与新快照并存、离组后不可读取 |
| Web | `isAvailable=UNSUPPORTED` 时不写任何明文 V2 或密钥；恢复票据刷新后安全阻断 |
| CI | `pnpm audit:storage`、凭据/日志回归、V2 加密迁移测试、禁止 `simpleHash` 被用于 V2、密钥 API 不得暴露 export 方法 |
| 发布 | 真机 iOS/Android 测试，检查 Keychain/Keystore 清除、离线恢复、卸载重装与错误码脱敏 |

## 8. 分阶段交付

| 阶段 | 交付 | 停止条件 |
|---|---|---|
| 0 | 完成当前 V2 契约加固：AAD 增加 snapshotId/keyId/scope，排除全部 `cf.sync.*` | 合同测试覆盖重放/替换拒绝 |
| 1 | 新建原生 Expo 模块和 iOS/Android provider；仅在开发设置创建测试 V2 | 不影响 V1 生产恢复 |
| 2 | 双写 V1/V2、只读校验 V2，采集无敏感成功率指标 | 连续两个发布周期无 V2 解密失败 |
| 3 | 默认 V2 写入与恢复；V1 仅显式迁移入口 | 用户可见 V2 状态与错误说明 |
| 4 | 移除 V1、`simpleHash`、明文快照和兼容代码 | 全量快照符合 V2，回滚窗口结束 |

## 参考资料

[1] [Android Developers — Cryptography](https://developer.android.com/privacy-and-security/cryptography)  
[2] [Expo Crypto Documentation](https://docs.expo.dev/versions/latest/sdk/crypto/)  
[3] [Apple CryptoKit — AES.GCM](https://developer.apple.com/documentation/cryptokit/aes/gcm)
