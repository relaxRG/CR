# 生产环境监控大盘配置

> 文档版本：v1.0 | 更新时间：2026-08-11

## 一、监控架构

由于项目为 **Expo React Native** 移动端应用，无传统后端服务器，监控体系分为两层：

| 层级 | 工具 | 说明 |
|------|------|------|
| **客户端异常** | `lib/labor/payroll-monitor.ts` | 内存日志 + 本地告警规则 |
| **崩溃追踪** | 推荐接入 **Sentry Expo SDK** | 自动捕获 JS 崩溃和未处理异常 |
| **OTA 更新** | `expo-updates` | 已集成，支持热更新 |

---

## 二、已实现的告警规则（payroll-monitor.ts）

### A1：负薪资告警（Critical）

```typescript
// 触发条件
finalSalary < 0

// 告警内容
"[A1-NEGATIVE_SALARY] 张忠洋 2026-08 实发薪资为负数 (¥-385.37)"

// 处理建议
检查预支金额是否超过应发薪资，或社保/个税计算是否异常
```

### A1b：薪资超额告警（Warning）

```typescript
// 触发条件
finalSalary > grossSalary × 1.5 && grossSalary > 0

// 告警内容
"[A1-SALARY_EXCEEDS_GROSS] 王琪 2026-08 实发(¥12000)超过应发(¥8000)的150%"

// 处理建议
检查是否有异常的调休兑现或差额调整
```

### A2：预支超额告警（Warning）

```typescript
// 触发条件
totalAdvance > grossSalary && grossSalary > 0

// 告警内容
"[A2-ADVANCE_EXCEEDS_GROSS] 张忠洋 2026-08 预支(¥9000)超过应发(¥8000)"

// 处理建议
提醒管理者该员工本月预支已超过应发，实发将为负数
```

### A3：补贴超额告警（Warning）

```typescript
// 触发条件
allowanceAmount > dailyRate × daysInMonth × 1.1 && dailyRate > 0

// 告警内容
"[A3-ALLOWANCE_EXCEEDS_MAX] 王琪 2026-08 补贴(¥500)超过理论最大值(¥405)"

// 处理建议
检查补贴规则的日单价或出勤天数是否异常
```

### A4：数据一致性告警（Warning/Critical）

```typescript
// 触发条件
checkPettyLaborIntegrity(slips, links).issuesFound > 0

// 严重性
issues > 5 → Critical；否则 Warning

// 告警内容
"[A4-DATA_INTEGRITY] 数据一致性检查发现 3/45 条薪资单存在问题"

// 处理建议
调用 repairPettyLaborData() 自动修复
```

### A5：FROZEN 违规告警（Critical）

```typescript
// 触发条件
已确认月份的写操作被执行（理论上不应发生）

// 告警内容
"[A5-FROZEN_VIOLATION] 已确认月份 2026-07 被意外修改：upsertShift"

// 处理建议
立即检查 isMonthWritable() 的调用链，可能是新增操作入口未添加 FROZEN 检查
```

---

## 三、告警集成方案

### 方案 A：接入 Sentry（推荐）

```bash
# 安装
npx expo install @sentry/react-native

# 初始化（app/_layout.tsx）
import * as Sentry from "@sentry/react-native";
Sentry.init({
  dsn: "YOUR_SENTRY_DSN",
  environment: "production",
  tracesSampleRate: 0.1,
});
```

修改 `payroll-monitor.ts` 中的 `reportAnomaly` 函数：

```typescript
function reportAnomaly(alert: Omit<AnomalyAlert, "id" | "detectedAt">) {
  // ... 现有逻辑 ...

  // 接入 Sentry
  Sentry.captureMessage(alert.message, {
    level: alert.severity === "critical" ? "error" : "warning",
    tags: { rule: alert.rule, month: alert.month },
    extra: { employeeId: alert.employeeId },
  });
}
```

### 方案 B：接入钉钉/企业微信机器人（简单快速）

```typescript
// 在 reportAnomaly 中添加
if (alert.severity === "critical") {
  fetch("YOUR_WEBHOOK_URL", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msgtype: "text",
      text: { content: `🚨 [${alert.rule}] ${alert.message}` },
    }),
  }).catch(() => {}); // 静默失败，不影响主流程
}
```

---

## 四、金额精度监控规则

### 精度标准

| 字段 | 精度 | 计算方式 |
|------|------|---------|
| 所有薪资金额 | 2位小数 | `Math.round(n × 100) / 100` |
| 展示格式 | 整数不显示小数点 | `formatMoney()` |
| 最大合理值 | ¥99,999.99 | 超过触发 A1b 告警 |

### 精度异常检测

```typescript
// 检测金额是否超过2位小数精度
function hasPrecisionAnomaly(amount: number): boolean {
  return Math.abs(amount - Math.round(amount * 100) / 100) > 0.001;
}

// 在 buildPaySlipDraft 完成后调用
const fields = [finalSalary, grossSalary, attendanceSalary, ...];
fields.forEach(f => {
  if (hasPrecisionAnomaly(f)) {
    logPayrollCalc("precision_anomaly", { field: f });
  }
});
```

---

## 五、监控大盘指标

### 关键指标（KPI）

| 指标 | 计算方式 | 告警阈值 |
|------|---------|---------|
| 负薪资率 | 负薪资员工数 / 总员工数 | > 0% 立即告警 |
| 预支超额率 | 预支>应发员工数 / 总员工数 | > 10% 告警 |
| 数据一致性 | 问题薪资单数 / 总薪资单数 | > 0% 告警 |
| FROZEN 违规次数 | 每月 | > 0 立即告警 |

### 日志查询

```typescript
// 获取最近告警
const alerts = getActiveAlerts();
console.log(`当前活跃告警：${alerts.length} 条`);
alerts.forEach(a => console.log(`[${a.severity}] ${a.message}`));

// 获取最近日志
const logs = getRecentLogs();
const errors = logs.filter(l => l.level === "error");
```

---

## 六、自适应字号监控

### 字号溢出检测（客户端）

```typescript
// 在 Text 组件的 onLayout 回调中检测
<Text
  numberOfLines={1}
  adjustsFontSizeToFit
  minimumFontScale={0.6}
  onLayout={(e) => {
    // 如果实际渲染高度 > 预期高度，说明发生了换行（溢出）
    if (e.nativeEvent.layout.height > expectedHeight) {
      logPayrollCalc("text_overflow", { text: value, width: e.nativeEvent.layout.width });
    }
  }}
>
  {value}
</Text>
```

---

## 七、部署检查清单

在每次 TestFlight 发布前，执行以下检查：

- [ ] `npx vitest run` — 所有测试通过（当前：624 passed）
- [ ] `npx tsc --noEmit` — TypeScript 0 errors
- [ ] 运行 Suite N（多分辨率视觉回归）— 42 passed
- [ ] 运行 Suite O（金额精度一致性）— 30 passed
- [ ] 检查 `getActiveAlerts()` — 无活跃告警
- [ ] 检查 `checkPettyLaborIntegrity()` — 0 issues
