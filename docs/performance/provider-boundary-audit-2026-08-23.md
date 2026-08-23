# Provider 功能域边界审计

## 旧根层装配

`app/_layout.tsx` 当前将 39 个业务 Provider 与应用内核一起挂载。所有路由首次渲染都会加载这些 Provider、执行各自的 AsyncStorage 水合 effect，并注册同步重载回调。

## 共享内核（保留根层）

- ThemeProvider / SafeAreaProvider / GestureHandlerRootView
- QueryClientProvider / I18nProvider / SyncProvider
- 全局月份导航与 Sync 会话的只读桥接

## 功能域建议边界

| 域 | 核心 Provider | 关联路由 |
|---|---|---|
| 鸡尾酒 | Recipe、Bottle、BottleTaxonomy、PriceAlert、Homemade、IceSettings、Menu、MenuPackage、Shopping | cocktail、recipe、bottle、homemade、menu、shopping、ice-settings、taxonomy-manager |
| 葡萄酒 | Wine | wine、wine-form、wine/[id]、wine-inventory、wine-inventory-import |
| 研发 | Lab、LabPlan | lab、lab/plan、lab/projects、lab/new、lab/batch-form、lab/compare |
| 餐食 | FoodMenu、FoodIngredient、SupplierPurchase | food、food-form、food-ingredient、supplier-import、suppliers |
| 门店 | Revenue、PettyCash、Labor、SalaryAdvance、Petty links/categories、Spirits、库存四类、月报、排班、时段、月结、原始 Excel | store、labor、spirits-inventory、monthly-summary、period-analysis、店铺库存、月报导入及相关详情路由 |

## 跨域约束

- 同步、主题、安全区、权限和导航不得迁移到功能域。
- 对用户开放的 URL、深链返回、95 个同步键和持久化键不得改变。
- 所有详情/表单路由必须在渲染前由相同的功能域边界包裹，不能依赖根层旧 Provider。
- 迁移后删除根布局中的旧 Provider import 与 JSX 装配；禁止双重 Provider 或新旧 Provider 并存。

## 迁移风险

门店域包含最多跨页面上下文和历史深链，应最后迁移。鸡尾酒与葡萄酒可以先迁移为按路由边界包装，再通过同步重载、离线水合、深链返回、导入导出和权限测试进行验收。
