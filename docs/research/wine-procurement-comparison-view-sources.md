# 葡萄酒采购管理比较视图研究摘记

本文件记录葡萄酒采购管理“供应商月度趋势、累计采购、图表/表格切换与比较”的外部设计依据，供实现决策参考；不改变当前业务事实或数据模型。

## 可采用的交互原则

成熟采购仪表板应将采购金额、供应商表现和流程效率置于同一可行动的视图中，并通过可下钻的明细避免把图表做成仅展示的静态报表。[1]

周期比较应同时支持相对上期与用户选定的自定义时期；在分类表或 KPI 等非时间序列视图中，必须明确比较所使用的日期范围，避免两个时期实际返回相同数据。[2]

采购分析必须首先保持统一口径、可追溯的分类和供应商事实，再显示比较结果。按供应商、分类、历史趋势和付款条件等维度展开，是可行动采购分析的核心。[3]

## 对葡萄酒采购管理的落地含义

| 需求 | 实现规则 |
|---|---|
| 月度/累计趋势 | 月度值来自当月真实采购流水；累计值 = 已归档历史月度值 + 当月流水 + 经审计的人工基线。 |
| 比较对象 | 默认“上月”；可选“去年同月”（若可得）和自定义业务月份；任意比较都展示绝对差与百分比，零基数不伪造百分比。 |
| 图表/表格 | 使用同一 `WineSupplierPurchaseReadModel`；图表只改变投影，表格始终可下钻到供应商、酒款和采购行。 |
| 三端 | iPhone 默认单一指标和可横滑时间序列；iPad/macOS 宽窗口可同屏显示本期/比较期与差值三列；窄窗口不会缩小关键金额字号，而是按行折叠次级信息。 |
| 事实边界 | 供应商资料与采购流水各自保持唯一来源；比较不写入、不重分类、不影响月结快照。 |

## References

[1]: https://www.ivalua.com/blog/procurement-dashboard/ "Ivalua — Procurement Dashboard: KPIs, Benchmarks & Visual Tips"
[2]: https://docs-v3.holistics.io/docs/reporting/period-comparison "Holistics — Period Comparison"
[3]: https://www.sap.com/resources/guide-to-spend-analysis "SAP — Spend analysis: the ultimate guide"
