# 统一供货商付款单：按行拆分、跨账期对账与核销状态机

**适用范围：** 烈酒进销存内的烈酒与啤酒分类。同一烈酒供货商可统一对账、统一付款；采购、库存、成本和分类分析仍分别记录。葡萄酒供应商不进入本付款单。

> 核心规则：供应商是**付款对象**，采购行是**核销对象**，分类是**成本和分析维度**。付款不能只写到供应商余额，必须最终落到具体采购行；未落行的资金只能作为预付款/待分配余额保存，不能伪造为已核销采购。

## 1. 账务对象与不变量

| 对象 | 关键字段 | 作用 | 不变量 |
|---|---|---|---|
| 采购行 `Purchase` | `id`、`supplierId`、`receivedAt`、`dueAt`、`amountMinor`、`productClassSnapshot` | 应付来源 | 成本金额只在采购行产生 |
| 统一付款单 `SupplierPayment` | `id`、`supplierId`、`paidAt`、`amountMinor`、`status`、`source` | 一笔实际转账、现金或备用金付款凭证 | 同一支付凭证不可重复入账 |
| 核销分配 `PaymentAllocation` | `paymentId`、`purchaseId`、`amountMinor`、`allocationStatus` | 将付款单金额落到采购行 | 只可指向同一供应商的采购行 |
| 预付款余额 `SupplierCredit` | `supplierId`、`originPaymentId`、`availableMinor`、`expiresAt?` | 已付但尚未指定采购的资金 | 不等于采购成本，不得自动消失 |
| 调整/冲销 `PaymentReversal` | `originalPaymentId`、`reason`、`reversedAt` | 更正错误付款或错误分配 | 不物理删除已核销历史 |

必须长期成立的等式：

```text
付款单金额 = 已分配金额 + 未分配金额 + 转入预付款余额
采购应付余额 = 采购金额 − 有效核销金额 − 有效预付款抵扣金额
供货商可用预付款 = 历史预付款余额 − 已抵扣金额 − 已冲销金额
烈酒/啤酒成本 = 采购行金额；与付款、预付款、核销金额无关
```

## 2. 前端状态机总览

```text
                 ┌───────────────────┐
                 │ payment_draft      │
                 │ 录入金额/凭证      │
                 └─────────┬─────────┘
                           │ 校验供应商、金额、日期、凭证
                           ▼
               ┌───────────────────────┐
               │ allocation_workspace   │
               │ 按行分配编辑工作区      │
               └───┬───────────────┬───┘
                   │               │
          全额已分配│               │部分/零分配
                   ▼               ▼
        ┌─────────────────┐  ┌──────────────────┐
        │ ready_to_submit │  │ credit_decision   │
        │ 可提交核销       │  │ 保存预付款/草稿   │
        └───────┬─────────┘  └───────┬──────────┘
                │                    │
                ├──────────────┬─────┘
                ▼              ▼
        submitting_single_flight  save_failed_retryable
                │              │
                ▼              └──────> allocation_workspace
        committed / conflict
                │
        ┌───────┴───────────────────────┐
        ▼                               ▼
   reconciled                     revision_conflict
   刷新只读投影                    读取权威版本/重放草稿
```

### 2.1 UI 状态定义

```ts
type SupplierPaymentWorkflowStatus =
  | "payment_draft"
  | "allocation_workspace"
  | "credit_decision"
  | "ready_to_submit"
  | "submitting"
  | "reconciled"
  | "revision_conflict"
  | "retryable_error";

type AllocationDraft = {
  purchaseId: string;
  amountMinor: number;
  source: "manual" | "suggested_oldest_due" | "suggested_pro_rata" | "credit_offset";
};

type SupplierPaymentDraft = {
  supplierId: string;
  paidAt: string;
  totalMinor: number;
  source: "bank_transfer" | "cash" | "petty_cash" | "other";
  proofRef?: string;
  allocations: AllocationDraft[];
  unresolvedMinor: number;
  treatment: "must_allocate" | "save_as_credit" | "save_as_draft";
  baseRevision: number;
};
```

`unresolvedMinor` 始终由 `totalMinor - sum(allocations)` 推导，前端不能允许它独立编辑。任何金额用最小货币单位整数保存，不使用浮点数。

## 3. 按行拆分分配交互

### 3.1 付款上浮卡布局

```text
供货商 A · 统一付款
本次付款  ¥1,000.00             付款日期 2026-08-24

待核销采购                                             选择全部待付
─────────────────────────────────────────────────────────────
2026-07  啤酒 / Beer   青岛经典           应付 ¥560.00  [ ¥ 200.00 ]
2026-08  威士忌        芝华士 12 年       应付 ¥800.00  [ ¥ 800.00 ]
2026-08  金酒          添加利金酒         应付 ¥240.00  [ ¥   0.00 ]

已分配 ¥1,000.00       未分配 ¥0.00
[按到期日建议分配] [按应付比例建议] [保存为预付款]
                                      [取消] [确认核销]
```

分类只作为采购行的视觉分组与金额构成。付款单顶部是统一金额；每个行输入框只能填入 `0..该行当前可核销余额`。点击类别分组可折叠，但折叠不能隐藏已经填写的分配总额。

### 3.2 前端伪代码

```ts
function deriveWorkspace(draft: SupplierPaymentDraft, openPurchases: Purchase[]) {
  const rows = openPurchases
    .filter(p => p.supplierId === draft.supplierId)
    .map(p => {
      const alreadySettled = p.confirmedAllocationsMinor + p.appliedCreditsMinor;
      const remaining = Math.max(0, p.amountMinor - alreadySettled);
      const allocation = draft.allocations.find(a => a.purchaseId === p.id)?.amountMinor ?? 0;
      return { ...p, remaining, allocation, maximum: remaining };
    });

  const allocatedMinor = rows.reduce((sum, row) => sum + row.allocation, 0);
  return {
    rows,
    allocatedMinor,
    unresolvedMinor: draft.totalMinor - allocatedMinor,
    canSubmit:
      draft.totalMinor > 0 &&
      allocatedMinor <= draft.totalMinor &&
      (draft.totalMinor === allocatedMinor || draft.treatment === "save_as_credit"),
  };
}

function setAllocation(purchaseId: string, enteredMinor: number) {
  const row = workspace.rows.find(row => row.id === purchaseId);
  if (!row) return showError("采购行已不存在，请刷新");
  const next = clamp(Math.trunc(enteredMinor), 0, row.maximum);
  // 不自动从其它分类或采购行扣减，避免意外改变用户已确认分配。
  updateDraft(previous => replaceAllocation(previous, purchaseId, next, "manual"));
}

function suggestOldestDue() {
  const available = draft.totalMinor;
  let rest = available;
  const next: AllocationDraft[] = [];
  for (const row of sortByDueDateThenReceipt(workspace.rows)) {
    const amount = Math.min(rest, row.remaining);
    if (amount > 0) next.push({ purchaseId: row.id, amountMinor: amount, source: "suggested_oldest_due" });
    rest -= amount;
    if (rest === 0) break;
  }
  // 建议仅填入草稿；用户必须查看并确认，不直接保存。
  updateDraft(previous => ({ ...previous, allocations: next }));
}

async function submitPayment() {
  const view = deriveWorkspace(draft, openPurchases);
  if (!view.canSubmit) return showError("请完成分配，或明确将剩余金额保存为预付款");
  if (inFlightRef.current) return;
  inFlightRef.current = true;
  setWorkflowStatus("submitting");
  try {
    await api.commitSupplierPayment({
      operationId: createUuid(),
      expectedRevision: draft.baseRevision,
      payment: omit(draft, ["baseRevision"]),
    });
    await reloadAuthoritativeSupplierLedger(draft.supplierId);
    setWorkflowStatus("reconciled");
  } catch (error) {
    if (isRevisionConflict(error)) setWorkflowStatus("revision_conflict");
    else setWorkflowStatus("retryable_error");
  } finally {
    inFlightRef.current = false;
  }
}
```

### 3.3 自动建议的边界

系统可提供“按最早到期日”与“按应付比例”两种**建议**，但建议永远是草稿，不可自动提交。原因是同一供货商常有指定发票、赠品、退货、折扣或业务优先级，必须让用户确认具体分配行。未分配金额必须选择：

| 用户选择 | 后续事实 | 不允许行为 |
|---|---|---|
| 完成分配 | 写入付款单和每一条 allocation | 多付金额偷偷分配给任意采购 |
| 保存为预付款 | 写入付款单与 `SupplierCredit` | 将预付款直接记入采购成本 |
| 保存草稿 | 仅本机加密/受控草稿，未形成付款事实 | 显示为“已付” |
| 取消 | 丢弃未保存草稿或按用户确认删除 | 删除已提交付款历史 |

## 4. 多账期对账与核销

### 4.1 账期原则

采购行的**成本账期**由收货/采购日期决定；付款单的**现金账期**由付款日期决定；核销只是两者之间的关系。举例：7 月收货的啤酒 ¥560，在 8 月被统一付款结清，7 月啤酒成本仍是 ¥560，8 月现金付款记录是 ¥560，不能把 8 月付款当作 8 月新增采购成本。

```text
2026-07：采购成本 = 啤酒 ¥560，待付 = ¥560
2026-08：付款 = ¥560，核销 2026-07 采购行
总月报：7 月成本不变；8 月付款卡展示已支付历史欠款
```

### 4.2 供应商对账视图

对账页面按供应商显示三个可折叠账龄分区：`本期`、`历史待付`、`预付款/贷方余额`。每个采购行展示收货日期、到期日、分类构成、原始金额、已核销、预付款抵扣、剩余应付和冻结状态。

| 字段 | 解释 | 示例 |
|---|---|---|
| 采购账期 | 采购/收货发生月 | 2026-07 |
| 付款账期 | 实际付款发生月 | 2026-08 |
| 核销账期 | 付款与采购关联确认月 | 2026-08 |
| 分类构成 | 采购行快照，不随主档改写 | 啤酒 / Beer |
| 账龄 | 截止当前的未付月数 | 1 个月 |
| 状态 | 待付、部分、已结、冻结待调整、争议 | 部分付款 |

### 4.3 部分付款

部分付款不会拆分采购成本行，只增加多条 `PaymentAllocation`。例如采购行 ¥800，先支付 ¥300、后支付 ¥500：采购成本始终 ¥800；付款卡分别记录两张付款单；采购状态先为 `partial` 后为 `paid`。任何一笔撤销只冲销该笔 allocation，不影响另一笔。

## 5. 预付款与抵扣

### 5.1 预付款创建

当付款金额大于当前选择采购行总额，或用户明确选择“保存为预付款”，剩余金额变成供货商的 `SupplierCredit`。它必须带有来源付款单、供货商 ID、余额、创建日、可选到期日和状态。

```ts
interface SupplierCredit {
  id: string;
  supplierId: string;
  originPaymentId: string;
  originalMinor: number;
  availableMinor: number;
  createdAt: string;
  expiresAt?: string;
  status: "available" | "exhausted" | "reversed" | "expired";
}
```

预付款不属于啤酒，也不属于非啤酒烈酒；它属于供应商现金余额。真正抵扣到采购行时，才产生带 `purchaseId` 的 `credit_offset` 分配。这样可避免在还没有采购时，把预付款错误记入任一分类成本。

### 5.2 抵扣流程

```text
可用预付款
  └─ 用户在某张采购行点击“使用预付款”
       └─ 选择一个或多个同供应商可用 credit
            └─ 输入抵扣金额（≤ credit 可用额且≤采购待付）
                 └─ 确认 → 写入 CreditAllocation → 采购应付下降
```

默认不自动按最旧预付款或最旧采购抵扣；可以提供建议，但需要用户确认。已月结采购行必须通过月结调整命令抵扣，并在对账页面展示“跨期调整”。

## 6. 退款、折扣、退货与超付

| 场景 | 正确处理 | 错误处理 |
|---|---|---|
| 付款录错 | 创建冲销付款/冲销 allocation，保留原始审计 | 物理删除付款记录 |
| 供应商退款 | 创建负向 `SupplierCredit` 或退款凭证，关联原付款 | 修改历史采购成本 |
| 采购退货 | 创建采购贷项/退货行，减少采购应付和库存；付款分配不自动删除 | 直接减少付款金额 |
| 供货折扣 | 创建折扣贷项，明确作用采购行或供应商余额 | 静默修改原采购单价 |
| 超付 | 显示红色超付异常；用户选择转预付款、退款或冲销 | 自动按比例分配到所有行 |
| 跨供应商付款 | 拒绝提交 | 用名称相同作为跨供应商依据 |

## 7. 月结冻结、离线和并发

1. 已月结采购行的付款核销允许记录，但若改变已发布月的已付/待付展示或需要反向调整，只能产生受控调整记录，不能改写原始采购快照。
2. 提交携带 `expectedRevision`、`operationId` 和完整 allocation 集合。服务端对供应商余额与每个采购行使用条件 revision 写入；任一冲突返回 `409`，前端保留草稿。
3. 网络中断：付款上浮卡 busy 解除，草稿标记 `retryable_error`；用户可重试、保存本机草稿或放弃。已提交但响应丢失时，以 `operationId` 查询幂等结果，不能重复扣款。
4. 单飞守卫阻止同一付款单双击提交；切换供应商、关闭卡片或路由离开时不得丢弃已保存草稿。

## 8. 自动化验收断言

1. 同供应商、跨两个月的啤酒 ¥560 与威士忌 ¥2,240 能在一张付款单中分别分配；供应商统一应付与分类成本都正确。
2. 8 月付款核销 7 月啤酒采购，不改变 7 月采购成本，也不制造 8 月啤酒采购成本。
3. 部分付款、二次付款、冲销其中一次后，采购剩余应付和供应商余额严格守恒。
4. 预付款不进入任何分类成本；抵扣时才对特定采购行生效；不同供应商不可使用该预付款。
5. 未分配金额不能提交为已核销；选择预付款后必须能在未来采购中可见、可抵扣、可审计。
6. 超付、退款、退货和折扣均为显式凭证/调整，不物理删除、不修改原始成本行。
7. 月结冻结、revision 冲突、网络中断和响应丢失后，草稿、幂等 operationId 与可重试路径正确。
