# 美团管家智能版多店导入 MVP 与官方对账接入审计

## 目标与范围

本次实现为 Cocktail R 新增**美团管家智能版多店数据导入引擎**，优先覆盖“月度营业收入”和“菜品大类”，并提供美团官方日账单的可审计映射与防串联校验。当前阶段只生成**待确认预览**，不在未经用户确认的情况下写入现有月报、账户、库存或薪资状态。

> 美团管家官方产品说明覆盖全渠道订单、菜品管理、供应链管理、经营数据与多层级连锁门店管控；但具体可用字段仍取决于商户使用的智能版模块与已授予的权限。[1]

## 新增实现

| 文件 | 作用 | 关键保证 |
|---|---|---|
| `lib/integrations/meituan/monthly-import.ts` | 月度营业收入、菜品大类归并和差额校验 | 目标门店与月份作为硬约束；`Food`/`food`/全角变体合并；不静默平差 |
| `lib/integrations/meituan/excel-adapter.ts` | Excel 多工作表表头识别 | 必须读取原始门店 ID，禁止仅按门店名称猜测；支持说明行后的表头定位 |
| `lib/integrations/meituan/daily-bill-import.ts` | 官方日账单字段映射与幂等校验 | `source + storeId + orderId` 幂等键；跨店、跨月、退款和金额冲突阻断 |
| `lib/store/monthly-report/excel-parser.ts` | 现有经营报表导入 | 改为复用同名大类标准键，修复大小写/空格变体不合并的问题 |
| `tests/meituan-guanJia-import.test.ts` | 自动化护栏 | 覆盖月度归并、模板解析、金额差额、退款、跨店跨月和订单冲突 |

## 月度营业收入与菜品大类字段映射

| 美团管家导出字段（别名） | Cocktail R 字段 | 转换规则 | 必填 |
|---|---|---|---|
| `门店ID` / `门店编码` / `appPoiCode` | `store.storeId` | 仅使用稳定 ID，不按门店名称推断 | 是 |
| `营业月份` / `账期` / `营业日期` | `month` | 归一化为 `YYYY-MM`，按 `Asia/Shanghai` 业务月处理 | 是 |
| `营业收入` / `菜品收入` / `实收` | `kpi.revenue` | 精确到分；仅汇总同一门店、同一业务月 | 是 |
| `营业额` / `销售额` | `kpi.turnover` | 保留折前口径，不与实收混淆 | 否 |
| `优惠金额` / `折扣金额` | `kpi.discountAmount` | 取绝对值作为优惠支出，再计算优惠率 | 否 |
| `订单量` / `订单数` | `kpi.orderCount` | 数值合计 | 否 |
| `菜品大类` / `品类` | `dishCategories[].name` | Unicode NFKC、去不可见字符、合并空白、英文小写键归并 | 是 |
| `销售数量` / `销量` | `dishCategories[].salesQty` | 合计 | 否 |
| `销售额` | `dishCategories[].salesAmount` | 合计 | 否 |
| `菜品收入` | `dishCategories[].revenue` | 合计；与 KPI 做强制差额校验 | 是 |
| `优惠金额`（大类表） | `dishCategories[].discountAmount` | 合计 | 否 |

同名类别规则如下：`food`、`Food`、` FOOD ` 和全角字符变体会归入相同标准键；`Food · 套餐`、`Food（午市）` 等具有附加业务语义的名称不会自动并入 `Food`。对于合并后的显示名，保留首次遇到的有效标签，后续可增加用户维护的标准名称映射表。

### 月度差额校验

```text
菜品大类营业收入合计 + 未分类营业收入 = 目标门店当月营业收入
```

差额超过 `¥0.01` 即视为未平衡。预览会显示 `REVENUE_GAP`，由用户选择修正字段映射、作为“未分类营业收入”保留，或取消导入；不允许自动修改任一金额以凑平。

## 美团官方日账单导入 MVP 映射

美团官方日账单接口 `bill/list/yuan` 返回账单结算、菜品金额、优惠、平台费和 SKU 明细。官方文档限制在近 90 天内查询、单次日期跨度不得超过 7 天、前一日账单在当天 10 点前不可查询，并要求商家为应用申请账单调用权限。[2]

| 官方账单字段 | Cocktail R 标准字段 | 会计口径 | 校验 |
|---|---|---|---|
| `appPoiCode` | `storeId` | 门店归属 | 必须严格等于导入目标门店 ID |
| `daliyBillDate` | `businessDate` / `month` | 业务账单日 | 必须属于用户选择的 `YYYY-MM` |
| `wmOrderViewId` | `orderId` / `sourceKey` | 外部订单幂等身份 | 与门店拼接，重复金额不一致即阻断 |
| `totalFoodAmount` | `grossFoodAmount` | 菜品金额/折前菜品口径 | 与 SKU 净额进行上限校验 |
| `activityPoiAmount` | `merchantDiscount` | 商家承担优惠 | 绝对值单独保存 |
| `activityMeituanAmount` | `platformDiscount` | 平台承担优惠 | 绝对值单独保存 |
| `platformChargeFee` | `platformFee` | 平台服务费 | 绝对值单独保存，不能混入菜品收入 |
| `settleAmount` | `settlementAmount` | 实际结算额 | 独立于营业收入展示 |
| `userOnlinePayAmount` / `userOfflinePayAmount` | `onlinePaid` / `offlinePaid` | 支付方式参考额 | 不替代结算额 |
| `wmAppOrderSkuBenefitDetailList` | `skuLines` | 菜品 SKU 明细 | 保留外部 SPU/SKU ID、数量、原价、净额、优惠 |

### 防串联与冲突规则

| 规则 | 触发条件 | 行为 |
|---|---|---|
| 门店隔离 | 账单 `appPoiCode` 与目标门店不一致 | `STORE_MISMATCH`，拒绝该行 |
| 月份隔离 | 账单业务日不属于选择月份 | `MONTH_MISMATCH`，拒绝该行 |
| 退款复核 | 存在 `refundTime` | `REFUND_CONFLICT`，不导入，要求读取退款状态/接口后再确认 |
| 幂等导入 | 同一 `source + storeId + orderId` | 同字段重复可跳过；金额不同为 `DUPLICATE_CONFLICT`，禁止覆盖旧快照 |
| SKU 金额合理性 | SKU 净额超过 `totalFoodAmount` | `RECONCILIATION_GAP`，拒绝该单 |
| 写入保护 | 预览未经确认 | 不写入总月报、账户、库存、薪资或手工账 |

## 多店正式写入的建议模型

现有 `MonthlyReportStore` 以 `rawMonth` 单键替换同月快照，**不能直接承载多店数据**。在将新引擎接入 UI 前，必须先把存储唯一键升级为：

```ts
type MultiStoreMonthlyReportKey = {
  source: "meituan-guanJia" | "manual";
  storeId: string;
  month: "YYYY-MM";
  importVersion: string;
};
```

写入流程应为：原始导入文件/日账单响应不可变归档 → 标准化预览 → 用户确认 → 生成带 `source`、`storeId`、`month`、`importVersion` 的快照 → 总月报可按门店或集团汇总。只有在这一迁移完成后，才允许将多店导入快照作为总月报的正式来源；否则会发生同月不同门店相互覆盖。

## 官方 OpenAPI 每月自动对账：前置条件与材料

美团技术服务合作中心提供服务商、品牌商和个人开发者的接入入口；生态开放平台说明也列出合作申请、商务沟通、技术方案确认、开发测试和上线运营流程。[3] [4] 对于账单接口，官方文档要求邮件申请权限，并提供应用 `appid/appname`、开通背景、预期效果、开发上线计划以及商家公司授权证明。[2]

| 前置项 | 需要准备的材料 | 说明 |
|---|---|---|
| 开发者主体 | 企业/品牌或符合业务要求的服务商主体资料 | 多店、跨主体数据不应以个人账号共享方式接入 |
| 应用与环境 | 官方开发者中心的应用 `appid`、`appname`、回调/服务端信息 | 生产令牌只能在安全后端保存 |
| 商家授权 | 各门店/品牌对应用的授权证明 | 日账单接口文档明确要求商家公司授权证明 |
| 业务说明 | 对账范围、读取字段、频率、数据留存期限、预期效果 | 建议只申请只读账单/订单能力 |
| 安全材料 | 访问控制、加密、日志脱敏、删除策略、异常撤销流程 | 需符合平台接口协议和商家数据保护要求 |
| 对账试运行 | 1 门店、最近 30 天、每日一次的对账记录 | 对齐营业收入、优惠、平台费、结算额后再扩展到全门店 |

自动对账应在安全服务端运行，而不是在移动 App 内保存密钥。第一阶段建议每天一次，按官方日账单的 7 天查询窗口切片补拉；不得将分钟级轮询作为默认设计。若官方支持订单推送，则应在确认相应权限和签名验证方式后再接入事件驱动同步。[2]

## 账号密码、网页登录与未公开网页接口评估

| 方式 | 结论 | 原因与边界 |
|---|---|---|
| 将美团账号密码嵌入 Cocktail R | **不可接受** | 明文或可恢复凭据会扩大泄露、越权、风控与维护风险；移动 App 不是安全的第三方账号托管位置 |
| 在 Cocktail R 内置网页登录 | **不作为正式数据同步方案** | 即使 WebView 能显示官方登录页，也不应采集密码、验证码或 cookie；风控、扫码和 MFA 必须由用户在美团页面完成 |
| 受控浏览器辅助导出 | **可作为人工导出的辅助方式** | 用户本人完成官方登录和验证后，协助导出已确认的报表；不保存凭据、验证码或会话 cookie |
| 未公开网页接口/逆向抓取 | **不实施** | 接口稳定性、平台条款、账号风控、数据准确性和安全责任均不可控；不得替代官方 API 或导出流程 |
| 官方 OAuth/应用授权/API | **正式自动同步的唯一推荐路径** | 可建立最小权限、撤销授权、服务端密钥管理、幂等与审计链路 |

## 后续实施顺序

1. 由用户提供一份脱敏的智能版多店“月度营业收入”和“菜品销售统计—大类”导出样本，确认真实表头别名。
2. 将本次解析器接入“报表 → 导入美团经营数据”的预览页面，但暂不写入 `MonthlyReportStore`。
3. 完成多店快照键迁移和门店选择/集团汇总 UI 后，再开放确认写入。
4. 使用一个门店、一个自然月进行人工对账；通过后扩至所有门店。
5. 按官方开放平台要求申请只读账单/订单权限，先日更对账，最后评估订单推送。

## References

[1]: [美团管家 App Store 产品说明](https://apps.apple.com/in/app/%E7%BE%8E%E5%9B%A2%E7%AE%A1%E5%AE%B6/id1474035355?l=mr)

[2]: [美团官方日账单接口 bill/list/yuan](https://developer.waimai.meituan.com/home/docDetail/596)

[3]: [美团技术服务合作中心](https://developer.meituan.com/)

[4]: [美团生态开放平台](https://openapi.meituan.com/)
