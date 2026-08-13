# 同步组切换认证修复与设备命名实施方案

**作者：Manus AI**  
**状态：方案待确认，尚未实施**  
**范围：切换同步组的认证恢复、默认设备型号名称、后续改名与端到端验收**

## 一、截图问题的准确判断

截图中的“加入其他同步组”页面走的是**已加入设备的原子切组路径**，而不是普通新设备配对路径。客户端调用 `/api/device/prepare-switch` 时会把当前设备本地保存的 `deviceId` 和 `deviceToken` 放入请求头。Worker 先调用 `verifyDevice()`，只有设备行存在、令牌匹配且 `is_active = 1` 时才会继续校验目标配对码。

因此，`Unauthorized` 出现在目标码验证之前。它不表示六位目标配对码必然错误；更可能表示本机还保留着一个**已失效的来源组成员资格**，例如旧成员已在服务端被停用、此前切组已完成但本地崩溃在清理旧身份之前，或旧令牌已经被撤销。

> 现有设计的安全意图正确：一个仍然有效的来源成员不能绕过原子事务，直接用普通配对覆盖身份。但它缺少“来源身份已经失效”的受控恢复分支，最终把可恢复的状态显示为笼统的 `Unauthorized`。

| 场景 | 当前行为 | 风险 | 新方案行为 |
|---|---|---|---|
| 来源身份有效 | 原子切组 | 正确 | 保持原流程：快照、写入屏障、主设备交接、仅拉取替换 |
| 来源身份失效 | `Unauthorized`，无法继续 | 用户被阻断 | 显示“旧成员资格失效，可安全恢复加入”说明与确认操作 |
| 目标码无效/过期/已用 | 可能未到达此步骤 | 需要明确提示 | 返回 `PAIR_CODE_UNAVAILABLE`，不允许恢复加入 |
| 网络超时/5xx | 可能被误判为认证问题 | 不可把旧数据推入目标组 | 保持失败状态与写入屏障，允许重试；绝不自动降级 |

## 二、认证恢复方案：两条严格分离的路径

### 2.1 正常路径：有效成员资格的原子切组

保持当前 `prepare-switch → commit-switch → snapshot → hydrate` 协议不变。来源组内存在其他活跃设备时，主设备必须先交接；源设备在提交时被停用；目标组使用新令牌和完整快照覆盖；普通LWW推送仅在目标水合完成后恢复。

### 2.2 恢复路径：失效成员资格的安全重新加入

仅当 Worker 明确返回 `SOURCE_MEMBERSHIP_UNAVAILABLE` 时才显示该路径。客户端不能因为任意401、超时或网络错误自动降级。

1. 用户在输入目标码后点击“安全加入目标组”。
2. 客户端先创建加密本地备份、开启全局写入屏障并停止旧轮询。
3. `/api/device/prepare-switch` 返回 `SOURCE_MEMBERSHIP_UNAVAILABLE`；页面显示说明：旧来源组身份已失效，继续不会把当前数据上传至目标组。
4. 用户进行**第二次明确确认**后，客户端调用新端点 `POST /api/device/recover-join`。该端点只验证一次性目标配对码，不接受旧令牌，不读取或恢复旧组成员资格。
5. Worker 创建一个新的目标设备身份与令牌，消费目标码，并返回目标成员资格。
6. 客户端写入新成员资格，调用 `/api/sync/snapshot` 完整下载目标数据，物理替换本地同步键、重载Store、仅下载目标照片，然后才解除写入屏障。
7. 加密备份保留在本地恢复槽；旧身份和旧轮询游标被删除。恢复过程无任何A组同步键、脏队列、照片文件或时间戳可以进入B组。

```text
有效来源成员：
  source auth OK → prepare → commit → hydrate target → enable target push

失效来源成员：
  source auth unavailable → explicit recovery consent → recover-join(code)
  → hydrate target only → enable target push

任何网络/服务端错误：
  keep barrier → show retry → never invoke recover-join automatically
```

### 2.3 Worker接口与数据边界

| 接口 | 认证 | 主要行为 | 防冲突断言 |
|---|---|---|---|
| `POST /api/device/prepare-switch` | 当前来源设备 | 有效来源走原子准备 | 401改为稳定码 `SOURCE_MEMBERSHIP_UNAVAILABLE`；不泄露组信息 |
| `POST /api/device/commit-switch` | 来源令牌 + 恢复票据 | 原子停用来源、启用目标 | 必须保持现有幂等提交与主设备交接 |
| `POST /api/device/recover-join` | 目标六码 | 为本机创建新的目标成员资格 | 只在用户确认后调用；旧组ID、令牌、脏键一律不上传 |
| `GET /api/sync/snapshot` | 新目标令牌 | 返回目标完整快照 | 响应的 `groupId` 必须与目标成员资格完全一致 |
| `POST /api/device/rename` | 当前设备令牌 | 仅改自己的展示名称 | 不影响角色、授权键、组ID或令牌 |

`recover-join` 使用与普通配对相同的目标码消费规则，但客户端必须在调用前进入“恢复水合”状态机。它不是旧 `/pair` 的绕过入口：已有有效成员资格的设备仍被拒绝，只允许经原子切组路径迁移。

## 三、设备型号默认名与后续改名方案

设备名采用“**可读型号作为建议值，用户自定义名作为最终值**”的模式。Apple的设备名称可由用户随时修改；Core Bluetooth也把人类可读名称与设备身份分开，且名称变更应被独立处理。[1] [2] [3]

### 3.1 初始命名规则

1. 通过 `expo-device` 读取 `Device.modelName`；iOS示例为“iPhone 15 Pro”，Android示例为“Pixel 8”。
2. 只使用型号，不读取序列号、广告标识或用户Apple设备名，避免隐私与权限问题。
3. 平台无法提供型号时回退为 `iPhone`、`Android`、`Web 浏览器` 或 `设备`。
4. 在创建独立同步组、普通新设备配对、原子切组和恢复加入时，统一调用 `getSuggestedDeviceName()`。
5. 目标组若已有同名活跃设备，Worker将展示名归一为 `iPhone 15 Pro (2)`、`(3)`；这只影响显示，不影响设备ID、令牌或权限。

### 3.2 编辑与同步规则

设备管理页在每个设备名称右侧显示编辑入口。当前设备可修改自己的展示名；主设备可修改任意组内设备的展示名。保存调用 `POST /api/device/rename`，服务端以当前组与令牌为边界更新 `devices.name`，并发布组级 `device_renamed` 通知。其他设备在下一次实时轮询刷新设备列表。

名称最大40个Unicode字符，去除前后空格，拒绝空值、控制字符和仅标点名称。名称修改绝不改变 `deviceId`、`groupId`、`deviceToken`、`role`、`allowedKeys` 或历史同步记录。

## 四、前端交互设计

在“加入其他同步组”页面增加一个折叠的“本机名称”行，默认显示建议型号。用户可在输入目标码前改名；名称会与新的目标成员资格一并提交。常规切组页面仍使用“安全加入目标组”按钮。

当来源身份失效时，不显示英文原始异常。页面改为：

> **原同步组凭据已失效**  
> 这台设备无法验证原同步组身份。你仍可安全加入目标组：系统会先备份本机数据，再只下载目标组数据；本机旧数据不会上传。

底部提供“取消”和“确认恢复加入目标组”。取消后保持屏障并允许返回；确认后按钮显示“正在安全恢复…”，禁止重复提交。

## 五、自动化验收矩阵

| 层级 | 用例 | 必须断言 |
|---|---|---|
| Worker单元/集成 | 有效来源正常切组 | A停用、B新成员生成、目标快照完整、一次性码消费 |
| Worker单元/集成 | 失效来源准备切换 | 返回稳定的 `SOURCE_MEMBERSHIP_UNAVAILABLE`，不返回笼统Unauthorized |
| Worker单元/集成 | 恢复加入 | 必须消费有效目标码；不读写A组业务数据；生成全新目标令牌 |
| 状态机 | 恢复加入在快照前强退 | 冷启动保持屏障；仅允许继续目标水合或取消恢复，不允许推送 |
| 状态机 | 网络超时/5xx | 不自动转恢复路径；旧数据不能流入目标组 |
| 名称 | iOS/Android/Web回退 | 型号优先、回退稳定、用户改名永久优先 |
| 名称 | 同名设备 | 仅展示名去重，不改变身份/令牌 |
| UI | 375/390/430pt | 名称行、确认弹窗、错误说明无截断；无横向根溢出 |
| API烟测 | `/health`、未授权快照 | 健康200；无凭据快照401；不执行任何真实切组 |

## 六、实施顺序与兼容性

第一步扩展Worker错误码与恢复加入端点，并新增D1索引/审计事件（现有`devices.name`字段无需业务数据迁移）。第二步实现客户端状态机的显式恢复分支和名称建议工具。第三步接入设备管理改名与实时列表刷新。第四步补齐故障注入、API集成、H5多尺寸与真机测试。

旧客户端不会被强制迁移：仍可正常配对和普通同步；当它尝试失效身份切组时仍显示当前错误。新客户端会把此状态转为可确认的安全恢复流程。由于客户端状态机变更必须随新版本分发，最终修复需要一版新的TestFlight构建；本方案阶段不触发构建。

## 参考资料

[1] [Apple Support：Change the name of your iPhone](https://support.apple.com/guide/iphone/change-the-name-of-your-iphone-iphf256af64f/ios)  
[2] [Apple Developer：CBPeripheral.name](https://developer.apple.com/documentation/corebluetooth/cbperipheral/name)  
[3] [Apple Developer：peripheralDidUpdateName(_:)](https://developer.apple.com/documentation/corebluetooth/cbperipheraldelegate/peripheraldidupdatename(_:))
