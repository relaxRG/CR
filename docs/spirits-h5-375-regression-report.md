# 375pt 烈酒库存导入同步：H5 移动端回归报告

**执行命令：**`pnpm test:h5:schedule-correction`  
**测试夹具：**写入一款导入酒款 `H5进口金宾`、一笔 Excel 来源采购和对应当月台账；随后在 `/spirits-inventory` 依次检查“库存管理”与“当月进货 → H5供应商详情”。

| 页面/路径 | 视口 | Client Width | Root Scroll Width | Body Scroll Width | 数据同步断言 | 结论 |
|---|---:|---:|---:|---:|---|---|
| 烈酒库存 → 库存管理 | 375pt | 375 | 375 | 375 | `hasImportedItem: true`，导入酒款可见 | 通过，无根级横向溢出 |
| 烈酒库存 → 当月进货 → 供应商详情 | 375pt | 375 | 375 | 375 | `hasImportedPurchase: true`，导入酒款与供应商均可见 | 通过，无根级横向溢出 |

> 判定规则：`rootScrollWidth` 与 `bodyScrollWidth` 都不得大于 `rootClientWidth`；导入状态必须在库存台账和采购详情两个展示路径中同时可见。

## 原始结果摘录

```json
{
  "reportPage": "烈酒库存导入同步",
  "viewports": [
    {
      "width": 375,
      "ledger": {
        "rootClientWidth": 375,
        "rootScrollWidth": 375,
        "bodyScrollWidth": 375,
        "hasImportedItem": true
      },
      "purchase": {
        "rootClientWidth": 375,
        "rootScrollWidth": 375,
        "bodyScrollWidth": 375,
        "hasImportedPurchase": true
      }
    }
  ]
}
```

同一轮运行还验证了 390pt 与 430pt，三种视口均通过。
