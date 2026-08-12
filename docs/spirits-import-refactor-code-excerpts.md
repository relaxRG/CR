# 统一日期校验重构：跨模块代码摘录

本文件仅摘录本次重构最关键的实际代码，便于审阅。完整实现请以各路径的当前源文件为准。

## 1. 共享日期归一化工具

**文件：**`lib/import/date-utils.ts`

```ts
function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function formatDate(year: number, month: number, day: number): string | null {
  if (!isValidDate(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeImportDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return formatDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 25569 && value < 60000) {
    const date = new Date((value - 25569) * 86400 * 1000);
    return formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{8}$/.test(text)) {
    return formatDate(Number(text.slice(0, 4)), Number(text.slice(4, 6)), Number(text.slice(6, 8)));
  }

  const ymd = text.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:\D|$)/);
  if (ymd) return formatDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));

  const chinese = text.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?(?:\D|$)/);
  if (chinese) return formatDate(Number(chinese[1]), Number(chinese[2]), Number(chinese[3]));

  const mdY = text.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?:\D|$)/);
  if (mdY) {
    const first = Number(mdY[1]);
    const second = Number(mdY[2]);
    const year = Number(mdY[3]);
    return first > 12 ? formatDate(year, second, first) : formatDate(year, first, second);
  }
  return null;
}
```

**关键约束：**所有调用方将 `null` 当作“不可导入”；只允许空单元格继承上一条已经验证的日期，绝不使用当天日期伪造导入日期。

## 2. 葡萄酒库存：逐行日期验证与主月份判定

**文件：**`app/wine-inventory-import.tsx`

```ts
const rows = utils.sheet_to_json<any[]>(wsPO, { header: 1, defval: null });
let lastValidDate = "";
for (let i = 2; i < rows.length; i++) {
  const r = rows[i];
  const dateVal = r[1]; const supplier = r[2]; const productName = r[3];
  if (!supplier || !productName) continue;

  const parsedDate = normalizeImportDate(dateVal);
  const hasDateValue = dateVal !== null && dateVal !== undefined && String(dateVal).trim() !== "";
  if (hasDateValue && !parsedDate) continue;

  const dateStr = parsedDate ?? lastValidDate;
  if (!dateStr) continue;
  if (parsedDate) lastValidDate = parsedDate;

  purchaseOrders.push({
    date: dateStr,
    supplier: String(supplier).trim(),
    productName: String(productName).trim(),
    unitPrice: Number(r[4]) || 0,
    quantity: Number(r[5]) || 0,
    amount: Number(r[6]) || 0,
  });
}

const snapshotMonth = dominantPurchaseMonth(purchaseOrders, fallbackMonth);
const [year, month] = snapshotMonth.split("-");
const monthLabel = `${year}年${Number(month)}月`;
```

这段代码取代了原先的字符串截取、Excel 序列号手工换算和“第一条采购记录决定整月”的方式。

## 3. 食品供应商导入：安全继承合并单元格日期

**文件：**`lib/store/supplier-import.ts`

```ts
let lastValidDate = "";

for (let i = headerRowIdx + 1; i < allRows.length; i++) {
  const row = allRows[i] as unknown[];
  const rawName = colIdx.name >= 0 ? String(row[colIdx.name] ?? "").trim() : "";
  if (!rawName) continue;

  const rawDate = colIdx.date >= 0 ? row[colIdx.date] : null;
  const parsedDate = normalizeImportDate(rawDate);
  const hasDateValue = rawDate !== null && rawDate !== undefined && String(rawDate).trim() !== "";
  if (hasDateValue && !parsedDate) continue;

  const date = parsedDate ?? lastValidDate;
  if (!date) continue;
  if (parsedDate) lastValidDate = parsedDate;

  rows.push({
    rowNo: colIdx.no >= 0 ? Number(row[colIdx.no]) || i : i,
    date,
    orderNo,
    rawName,
    split,
    unit,
    quantity: qty,
    unitPrice: price,
    amount,
  });
}
```

显式非法日期会跳过；合并单元格造成的空日期仅在已有有效日期时继承；首个商品行无日期不会被误写为当天。

## 4. 备用金成本与时段报表：拒绝无效日期而不是伪造当天

**文件：**`lib/store/icost-import.ts`

```ts
const date = normalizeImportDate(rawDate);
if (!date) {
  skippedRows.push({ row: i + 1, reason: "日期无效", subcat: rawCat2 });
  continue;
}
records.push({ date, code, amount, description, paymentMethod, receiptUri: "" });
```

**文件：**`lib/store/period-analysis/excel-parser.ts`

```ts
const date = normalizeImportDate(row[0]) ?? "";
const slot = String(row[1]).trim();
if (!date || !slot || slot === "半小时") continue;
const key = `${date}|${slot}`;
```

## 5. 烈酒移动端预览：手工修改同样走统一校验

**文件：**`app/spirits-inventory.tsx`

```ts
const newDate = normalizeImportDate(editDate);
if (!newDate) {
  Alert.alert("日期无效", "请输入有效日期，例如：2026-07-15、2026/7/15 或 2026年7月15日");
  return;
}
const newMonth = newDate.slice(0, 7);
setRows((prev) => prev.map((r, i) => i === editingIdx ? {
  ...r,
  date: newDate,
  month: newMonth,
  rawName: editName || r.rawName,
  nameZh: editName || r.rawName,
  quantity: qty,
  unitPrice: price,
  amount: qty * price,
} : r));
```

批量改日期使用相同的 `normalizeImportDate`，成功后再从归一化 ISO 日期派生月份。

## 6. 非法日期、空日期继承与跨月导入回归测试

**文件：**`tests/spirits-import-sync.test.ts`

```ts
describe("烈酒导入日期边界：非法日期与跨月采购", () => {
  it("跳过非法自然日，保留空日期继承行，并将跨月有效采购分别归入自身月份", () => {
    const parsed = parseSpiritsExcel([
      ["日期", "商品名称", "单位", "数量", "单价", "金额"],
      ["2026-07-31", "金宾波本", "瓶", 1, 118, 118],
      [null, "金宾波本", "瓶", 2, 118, 236],
      ["2026-02-30", "不应导入的酒款", "瓶", 1, 100, 100],
      ["2026年8月1日", "金宾波本", "瓶", 3, 118, 354],
      [null, "金宾波本", "瓶", 1, 118, 118],
    ]);

    expect(parsed.rows.map((row) => ({ date: row.date, month: row.month, name: row.rawName }))).toEqual([
      { date: "2026-07-31", month: "2026-07", name: "金宾波本" },
      { date: "2026-07-31", month: "2026-07", name: "金宾波本" },
      { date: "2026-08-01", month: "2026-08", name: "金宾波本" },
      { date: "2026-08-01", month: "2026-08", name: "金宾波本" },
    ]);
    expect(parsed.warnings.some((warning) =>
      warning.includes("不应导入的酒款") && warning.includes("日期无法识别"),
    )).toBe(true);

    const orders = parsed.rows.map((row) => order({
      rawName: row.rawName,
      nameZh: row.nameZh,
      nameEn: row.nameEn,
      date: row.date,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      amount: row.amount,
    }));
    const { records, unmatched } = buildImportedPurchaseRecords(orders, [item], "2026-07");

    expect(unmatched).toEqual([]);
    expect(records.map((record) => record.month)).toEqual([
      "2026-07", "2026-07", "2026-08", "2026-08",
    ]);
    expect(records.reduce((total, record) => total + record.amount, 0)).toBe(826);
  });
});
```

该测试的结果是：非法日期的酒款既不进入采购流水，也不会进入库存台账；四条有效采购分别以 `2026-07` 与 `2026-08` 写入。

## 7. 375pt H5 移动端回归的核心断言

**文件：**`scripts/h5-schedule-correction-e2e.mjs`

```js
await call("Emulation.setDeviceMetricsOverride", {
  width: 375, height: 844, deviceScaleFactor: 3, mobile: true,
});
await call("Page.navigate", { url: `http://localhost:${port}/spirits-inventory` });

// 库存管理：导入酒款必须可见，根级不允许横向溢出。
const ledgerState = await call("Runtime.evaluate", { expression: `(() => ({
  rootClientWidth: document.documentElement.clientWidth,
  rootScrollWidth: document.documentElement.scrollWidth,
  bodyScrollWidth: document.body.scrollWidth,
  hasImportedItem: document.body.innerText.includes('H5进口金宾'),
}))()`, returnByValue: true });

// 当月进货：进入供应商详情后，导入采购必须可见，根级同样不得溢出。
const purchaseState = await call("Runtime.evaluate", { expression: `(() => ({
  rootClientWidth: document.documentElement.clientWidth,
  rootScrollWidth: document.documentElement.scrollWidth,
  bodyScrollWidth: document.body.scrollWidth,
  hasImportedPurchase: document.body.innerText.includes('H5进口金宾')
    && document.body.innerText.includes('H5供应商'),
}))()`, returnByValue: true });
```
