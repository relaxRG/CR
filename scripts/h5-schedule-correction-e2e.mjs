#!/usr/bin/env node
/**
 * 移动端 H5 排班纠错 E2E 烟雾测试。
 *
 * 前置：
 *   1. npx expo export --platform web --output-dir dist-web
 *   2. Chromium 已以 remote debugging port 9222 启动（Manus 浏览器环境默认满足）
 *
 * 此脚本启动带 SPA fallback 的静态服务，并在 375/390/430pt 下验证：
 *   - /labor 可加载且无根级横向溢出；
 *   - “编辑”入口可进入编辑模式；
 *   - 编辑模式中存在独立“清空本月”入口；
 *   - 正常模式仍包含独立的“生成薪资单”入口；
 *   - 月报页显示唯一“月度归档并确认发薪”主按钮；
 *   - 冻结归档与差额调整中的月报操作区均可在移动视口正常展示；
 *   - 薪资统计、考勤概况、绩效汇总、时段成本分析、月度经营报告与个人中心在
 *     375/390/430pt 下均不存在根级横向溢出。
 */
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "dist-web");
const port = Number(process.env.H5_E2E_PORT ?? 8093);
const route = `http://localhost:${port}/labor`;
// 极窄屏、主流窄屏与大屏手机均纳入回归，台账只能在自身容器内横向滚动。
const MOBILE_VIEWPORTS = [320, 360, 375, 390, 412, 430];
const contentTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

if (!existsSync(join(root, "index.html"))) {
  throw new Error("未找到 dist-web/index.html。请先执行：npx expo export --platform web --output-dir dist-web");
}

const server = createServer((request, response) => {
  const pathname = decodeURIComponent((request.url ?? "/").split("?")[0]);
  const candidate = normalize(join(root, pathname));
  const file = candidate.startsWith(root) && existsSync(candidate) ? candidate : join(root, "index.html");
  response.setHeader("Content-Type", contentTypes[extname(file)] ?? "application/octet-stream");
  createReadStream(file).on("error", () => { response.statusCode = 404; response.end(); }).pipe(response);
});

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function getDedicatedTestTarget() {
  // 不复用“第一个页面”：它可能是用户正在登录Cloudflare或其他敏感站点的标签页。
  // Chromium DevTools允许创建专用about:blank页，H5测试只导航这一页。
  const response = await fetch("http://localhost:9222/json/new?about:blank", { method: "PUT" });
  if (!response.ok) throw new Error(`无法创建专用H5测试标签页：HTTP ${response.status}`);
  const target = await response.json();
  if (!target?.webSocketDebuggerUrl) throw new Error("专用H5测试标签页缺少CDP连接地址。");
  return target;
}

async function openCdp(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const resolver = pending.get(message.id);
    if (resolver) { pending.delete(message.id); resolver(message); }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`CDP_TIMEOUT:${method}`));
    }, 15_000);
    pending.set(requestId, (message) => {
      clearTimeout(timeout);
      return message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  return { socket, call };
}

function hasTextExpression(text) {
  return `(() => [...document.querySelectorAll('*')].some((el) => el.children.length === 0 && el.textContent?.trim() === ${JSON.stringify(text)}))()`;
}

function clickTextExpression(text) {
  return `(() => {
    const element = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent?.trim() === ${JSON.stringify(text)});
    if (!element) return false;
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`;
}

function clickTestIdExpression(testId) {
  return `(() => {
    const element = document.querySelector('[data-testid=${JSON.stringify(testId)}]');
    if (!element) return false;
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`;
}

async function click(call, expression, error) {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true });
  if (!result.result.value) throw new Error(error);
}

server.listen(port, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));

let testTarget;
let testSocket;
try {
  testTarget = await getDedicatedTestTarget();
  const { socket, call } = await openCdp(testTarget);
  testSocket = socket;
  const report = [];
  await call("Page.enable");

  for (const width of MOBILE_VIEWPORTS) {
    await call("Emulation.setDeviceMetricsOverride", {
      width, height: 844, deviceScaleFactor: 3, mobile: true,
    });
    await call("Page.navigate", { url: route });
    await sleep(1000);

    const initial = await call("Runtime.evaluate", {
      expression: `(() => ({
        rootClientWidth: document.documentElement.clientWidth,
        rootScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        hasEdit: ${hasTextExpression("✐ 编辑")},
        hasGenerate: Boolean(document.querySelector('[aria-label="生成薪资单"]')),
      }))()`,
      returnByValue: true,
    });
    const initialState = initial.result.value;
    if (initialState.rootScrollWidth > initialState.rootClientWidth || initialState.bodyScrollWidth > initialState.rootClientWidth) {
      throw new Error(`${width}pt 出现根级横向溢出：${JSON.stringify(initialState)}`);
    }
    if (!initialState.hasEdit || !initialState.hasGenerate) {
      throw new Error(`${width}pt 未渲染正常模式排班工具栏：${JSON.stringify(initialState)}`);
    }

    const clicked = await call("Runtime.evaluate", { expression: clickTextExpression("✐ 编辑"), returnByValue: true });
    if (!clicked.result.value) throw new Error(`${width}pt 无法点击编辑入口`);
    await sleep(200);
    const editMode = await call("Runtime.evaluate", {
      expression: `(() => ({
        hasClearMonth: ${hasTextExpression("清空本月")},
        rootClientWidth: document.documentElement.clientWidth,
        rootScrollWidth: document.documentElement.scrollWidth,
      }))()`,
      returnByValue: true,
    });
    const editState = editMode.result.value;
    if (!editState.hasClearMonth) throw new Error(`${width}pt 编辑模式未显示独立“清空本月”入口`);
    if (editState.rootScrollWidth > editState.rootClientWidth) {
      throw new Error(`${width}pt 编辑模式工具栏造成根级横向溢出：${JSON.stringify(editState)}`);
    }
    report.push({ width, normalMode: initialState, editMode: editState });
  }

  // 桌面网页缩放/分屏等价回归：连续改变当前页面宽度后，外层三页与排班内两页必须同步为同一页宽，
  // 且保持“排班表”当前页，不能露出薪资预支页面或遗留旧页宽坐标。
  await call("Emulation.setDeviceMetricsOverride", { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: route });
  await sleep(900);
  const desktopScheduleClicked = await call("Runtime.evaluate", { expression: clickTextExpression("排班表"), returnByValue: true });
  if (!desktopScheduleClicked.result.value) throw new Error("桌面缩放回归未找到排班表页签");
  await sleep(250);
  const desktopScaleSteps = [];
  for (const width of [1024, 1280, 1440]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(350);
    const desktopLayout = await call("Runtime.evaluate", { expression: `(() => {
      const byId = (id) => document.querySelector('[data-testid="' + id + '"]');
      const rect = (id) => byId(id)?.getBoundingClientRect();
      const page = rect('labor-schedule-page');
      const grid = rect('schedule-grid-page');
      const attendance = rect('schedule-attendance-page');
      return {
        rootClientWidth: document.documentElement.clientWidth,
        rootScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        hasPages: Boolean(page && grid && attendance),
        schedulePageLeft: page?.left ?? null,
        schedulePageWidth: page?.width ?? null,
        gridPageWidth: grid?.width ?? null,
        attendancePageWidth: attendance?.width ?? null,
      };
    })()`, returnByValue: true });
    const state = desktopLayout.result.value;
    if (!state.hasPages) throw new Error(`桌面 ${width}px 未渲染排班分页测试节点：${JSON.stringify(state)}`);
    if (state.rootScrollWidth > state.rootClientWidth || state.bodyScrollWidth > state.rootClientWidth) {
      throw new Error(`桌面 ${width}px 排班页出现根级横向溢出：${JSON.stringify(state)}`);
    }
    for (const [name, value] of [["外层排班页", state.schedulePageWidth], ["内层排班页", state.gridPageWidth], ["内层考勤页", state.attendancePageWidth]]) {
      if (Math.abs(value - state.rootClientWidth) > 1) throw new Error(`桌面 ${width}px ${name}宽度未随当前页面同步：${JSON.stringify(state)}`);
    }
    if (Math.abs(state.schedulePageLeft) > 1) throw new Error(`桌面 ${width}px 缩放后未保持排班表当前页：${JSON.stringify(state)}`);
    desktopScaleSteps.push({ width, ...state });
  }
  report.push({ reportPage: "排班表桌面缩放", viewports: desktopScaleSteps });

  // 月报唯一归档入口：写入最小可用夹具后重新导航，验证 DRAFT / FROZEN / ADJUSTING 三态。
  await call("Emulation.setDeviceMetricsOverride", { width: 375, height: 844, deviceScaleFactor: 3, mobile: true });
  const seed = await call("Runtime.evaluate", { expression: `(() => {
    const month = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
    const employee = { id: 'h5-e2e-employee', code: 'E2E', realName: 'H5测试', phone: '', dept: 'front', type: 'fulltime', baseSalary: 10000, restDaysPerMonth: 4, hourlyRate: 0, overtimeHourlyRate: 50, notes: '', active: true, createdAt: new Date().toISOString() };
    const employees = [
      employee,
      ...Array.from({ length: 4 }, (_, i) => ({ ...employee, id: 'h5-front-' + i, code: 'F' + i, realName: '前厅测试' + i, dept: 'front' })),
      ...Array.from({ length: 3 }, (_, i) => ({ ...employee, id: 'h5-kitchen-' + i, code: 'K' + i, realName: '后厨测试' + i, dept: 'kitchen' })),
    ];
    const slip = { id: 'h5-e2e-slip', employeeId: employee.id, month, attendanceDays: 27, attendanceSalary: 10000, performanceBonus: 0, salesCommission: 0, mealAllowance: 0, transportAllowance: 0, otherAllowance: 0, rewardPenalty: 0, advanceAmount: 0, grossSalary: 10000, socialInsuranceDeduction: 0, housingFundDeduction: 0, incomeTax: 0, finalSalary: 10000, employerSocialInsurance: 0, employerHousingFund: 0, totalEmployerCost: 10000, notes: '', updatedAt: new Date().toISOString() };
    localStorage.setItem('labor_employees_v1', JSON.stringify(employees));
    localStorage.setItem('labor_payslips_v1', JSON.stringify([slip]));
    localStorage.removeItem('labor_month_close_archives_v1');
    localStorage.removeItem('labor_month_adjustment_sessions_v1');
    return month;
  })()`, returnByValue: true });
  const closeMonth = seed.result.value;
  await call("Page.navigate", { url: `http://localhost:${port}/monthly-summary` });
  await sleep(900);
  const draftClose = await call("Runtime.evaluate", { expression: `(() => ({
    hasClose: ${hasTextExpression("月度归档并确认发薪")},
    rootClientWidth: document.documentElement.clientWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
  }))()`, returnByValue: true });
  if (!draftClose.result.value.hasClose) throw new Error('月报 DRAFT 未显示唯一月度归档主按钮');
  if (draftClose.result.value.rootScrollWidth > draftClose.result.value.rootClientWidth) throw new Error('月报 DRAFT 出现根级横向溢出');

  await call("Runtime.evaluate", { expression: `(() => {
    const month = ${JSON.stringify(closeMonth)};
    const archive = { id: 'h5-close-v1', month, version: 1, status: 'frozen', createdAt: Date.now(), closedBy: 'manager', summary: { totalEmployees: 1, totalGrossSalary: 10000, totalFinalSalary: 10000, totalDeductions: 0 }, scheduleByDept: {}, payrollByEmployee: {}, adjustments: [] };
    localStorage.setItem('labor_month_close_archives_v1', JSON.stringify([archive]));
  })()`, returnByValue: true });
  await call("Page.navigate", { url: `http://localhost:${port}/monthly-summary` });
  await sleep(900);
  const frozenClose = await call("Runtime.evaluate", { expression: `(() => ({
    hasArchive: ${hasTextExpression("查看月度归档")},
    hasAdjust: ${hasTextExpression("进入差额调整")},
    rootClientWidth: document.documentElement.clientWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
  }))()`, returnByValue: true });
  if (!frozenClose.result.value.hasArchive || !frozenClose.result.value.hasAdjust) throw new Error('月报 FROZEN 未显示归档查看与差额调整入口');
  if (frozenClose.result.value.rootScrollWidth > frozenClose.result.value.rootClientWidth) throw new Error('月报 FROZEN 出现根级横向溢出');

  await call("Runtime.evaluate", { expression: `(() => {
    const month = ${JSON.stringify(closeMonth)};
    localStorage.setItem('labor_month_adjustment_sessions_v1', JSON.stringify([{ id: 'h5-adjust', month, baseArchiveId: 'h5-close-v1', baseVersion: 1, status: 'open', reason: 'H5验证', settleMethod: 'next_month', createdAt: Date.now(), createdBy: 'manager', baseline: { shifts: [], attendances: [], paySlips: [] } }]));
  })()`, returnByValue: true });
  await call("Page.navigate", { url: `http://localhost:${port}/monthly-summary` });
  await sleep(900);
  const adjustingClose = await call("Runtime.evaluate", { expression: `(() => ({
    hasDiscard: ${hasTextExpression("放弃调整")},
    hasReclose: ${hasTextExpression("重新归档并确认")},
    rootClientWidth: document.documentElement.clientWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
  }))()`, returnByValue: true });
  if (!adjustingClose.result.value.hasDiscard || !adjustingClose.result.value.hasReclose) throw new Error('月报 ADJUSTING 未显示放弃调整与重新归档入口');
  if (adjustingClose.result.value.rootScrollWidth > adjustingClose.result.value.rootClientWidth) throw new Error('月报 ADJUSTING 出现根级横向溢出');
  report.push({ width: 375, monthClose: { draft: draftClose.result.value, frozen: frozenClose.result.value, adjusting: adjustingClose.result.value } });

  // 核心薪资与报表页：路由级视觉烟雾测试。
  // 此处只验证根级布局，因为页面业务内容和数字状态已由 Vitest 的金额/颜色回归夹具覆盖。
  const reportRoutes = [
    ["/labor", "薪资统计"],
    ["/labor-attendance", "考勤概况"],
    [`/labor-kpi-allowance?employeeId=h5-e2e-employee&month=${closeMonth}`, "绩效汇总"],
    ["/period-analysis", "时段成本分析"],
    ["/store", "报表工作台"],
    ["/me", "个人中心"],
  ];
  for (const [path, label] of reportRoutes) {
    const viewports = [];
    for (const width of MOBILE_VIEWPORTS) {
      await call("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 3, mobile: true });
      await call("Page.navigate", { url: `http://localhost:${port}${path}` });
      await sleep(700);
      const layout = await call("Runtime.evaluate", { expression: `(() => ({
        rootClientWidth: document.documentElement.clientWidth,
        rootScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        hasVisibleText: document.body.innerText.trim().length > 0,
      }))()`, returnByValue: true });
      const state = layout.result.value;
      if (!state.hasVisibleText) throw new Error(`${label} ${width}pt 页面未加载内容`);
      if (state.rootScrollWidth > state.rootClientWidth || state.bodyScrollWidth > state.rootClientWidth) {
        throw new Error(`${label} ${width}pt 出现根级横向溢出：${JSON.stringify(state)}`);
      }
      viewports.push({ width, ...state });
    }
    report.push({ reportPage: label, viewports });
  }

  // 烈酒库存：模拟已确认的当月导入记录，验证同一采购会同步显示在库存台账与当月进货两个移动端页面。
  await call("Runtime.evaluate", { expression: `(() => {
    const month = ${JSON.stringify(closeMonth)};
    const now = new Date().toISOString();
    const item = { id: 'h5-spirit-item', name: 'H5进口金宾', nameEn: 'H5 Jim Beam', category: 'Whisky', unit: '瓶', refPrice: 118, active: true, createdAt: now, updatedAt: now };
    const purchase = { id: 'h5-spirit-purchase', month, date: month + '-15', itemId: item.id, rawName: 'H5进口金宾', unit: '瓶', quantity: 3, unitPrice: 118, amount: 354, supplier: 'H5供应商', category: 'Whisky', source: 'excel', createdAt: now };
    const ledger = { id: 'h5-spirit-ledger', month, itemId: item.id, openingQty: 1, openingUnitCost: 100, purchaseQty: 3, purchaseCost: 354, consumeQty: 0, closingQty: 4, closingUnitCost: 113.5, closingCost: 454, isClosed: false, updatedAt: now };
    localStorage.setItem('spirits.items.v3', JSON.stringify([item]));
    localStorage.setItem('spirits.purchases.v3', JSON.stringify([purchase]));
    localStorage.setItem('spirits.ledger.v3', JSON.stringify([ledger]));
    return month;
  })()`, returnByValue: true });
  const spiritsViewports = [];
  for (const width of MOBILE_VIEWPORTS) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 3, mobile: true });
    await call("Page.navigate", { url: `http://localhost:${port}/spirits-inventory` });
    await sleep(900);
    const ledgerClicked = await call("Runtime.evaluate", { expression: `(() => {
      const tab = document.querySelector('[data-testid="spirits-tab-ledger"]');
      if (!tab) return false;
      tab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    })()`, returnByValue: true });
    if (!ledgerClicked.result.value) throw new Error(`烈酒库存 ${width}pt 缺少库存管理Tab`);
    await sleep(200);
    const ledgerState = await call("Runtime.evaluate", { expression: `(() => ({
      rootClientWidth: document.documentElement.clientWidth,
      rootScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      hasImportedItem: document.body.innerText.includes('H5进口金宾'),
      hasExcelTableName: Boolean(document.querySelector('[data-testid="spirits-ledger-table-name-h5-spirit-item"]')),
      hasLegacyViewSwitcher: Boolean(document.querySelector('[data-testid="spirits-ledger-view-switcher"]')),
    }))()`, returnByValue: true });
    if (!ledgerState.result.value.hasImportedItem || !ledgerState.result.value.hasExcelTableName || ledgerState.result.value.hasLegacyViewSwitcher) {
      throw new Error(`烈酒库存 ${width}pt 未直接渲染完整Excel台账：${JSON.stringify(ledgerState.result.value)}`);
    }
    if (ledgerState.result.value.rootScrollWidth > ledgerState.result.value.rootClientWidth || ledgerState.result.value.bodyScrollWidth > ledgerState.result.value.rootClientWidth) {
      throw new Error(`烈酒库存台账 ${width}pt 出现根级横向溢出：${JSON.stringify(ledgerState.result.value)}`);
    }
    const nameClicked = await call("Runtime.evaluate", { expression: `(() => {
      const name = document.querySelector('[data-testid="spirits-ledger-table-name-h5-spirit-item"]');
      if (!name) return false;
      name.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    })()`, returnByValue: true });
    if (!nameClicked.result.value) throw new Error(`烈酒库存 ${width}pt 未渲染Excel台账商品名称`);
    await sleep(180);
    const detailState = await call("Runtime.evaluate", { expression: `(() => {
      const sheet = document.querySelector('[data-testid="spirits-ledger-detail-sheet"]');
      return {
        visible: Boolean(sheet),
        hasPrimaryColumns: document.body.innerText.includes('期末库存') && document.body.innerText.includes('期末成本'),
        hasFullDetail: ['期初', '本月进货', '期末库存', '本期消耗'].every((text) => sheet?.innerText.includes(text)),
        rootClientWidth: document.documentElement.clientWidth,
        rootScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
      };
    })()`, returnByValue: true });
    if (!detailState.result.value.visible || !detailState.result.value.hasPrimaryColumns || !detailState.result.value.hasFullDetail) {
      throw new Error(`烈酒库存 ${width}pt Excel台账商品名称或详情抽屉不完整：${JSON.stringify(detailState.result.value)}`);
    }
    if (detailState.result.value.rootScrollWidth > detailState.result.value.rootClientWidth || detailState.result.value.bodyScrollWidth > detailState.result.value.rootClientWidth) {
      throw new Error(`烈酒库存详情抽屉 ${width}pt 出现根级横向溢出：${JSON.stringify(detailState.result.value)}`);
    }

    await call("Page.navigate", { url: `http://localhost:${port}/spirits-inventory` });
    await sleep(350);
    const purchaseClicked = await call("Runtime.evaluate", { expression: clickTextExpression("📦 当月进货"), returnByValue: true });
    if (!purchaseClicked.result.value) throw new Error(`烈酒库存 ${width}pt 缺少当月进货Tab`);
    await sleep(200);
    const supplierTabClicked = await call("Runtime.evaluate", { expression: `(() => {
      const tab = document.querySelector('[data-testid="spirits-purchase-supplier-tab-H5供应商"]');
      if (!tab) return false;
      tab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    })()`, returnByValue: true });
    if (!supplierTabClicked.result.value) throw new Error(`烈酒当月进货 ${width}pt 未显示供应商同页标签`);
    await sleep(200);
    const purchaseState = await call("Runtime.evaluate", { expression: `(() => ({
      rootClientWidth: document.documentElement.clientWidth,
      rootScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      hasSupplierTabs: Boolean(document.querySelector('[data-testid="spirits-purchase-supplier-tabs"]')),
      hasSupplierTab: Boolean(document.querySelector('[data-testid="spirits-purchase-supplier-tab-H5供应商"]')),
      hasAddSupplier: Boolean(document.querySelector('[data-testid="spirits-purchase-add-supplier"]')),
      hasInlineDetail: Boolean(document.querySelector('[data-testid="spirits-supplier-purchase-detail"]')),
      hasImportedPurchase: document.body.innerText.includes('H5进口金宾') && document.body.innerText.includes('H5供应商'),
      hasLegacySummary: document.body.innerText.includes('进货合计'),
    }))()`, returnByValue: true });
    if (!purchaseState.result.value.hasSupplierTabs || !purchaseState.result.value.hasSupplierTab || !purchaseState.result.value.hasAddSupplier || !purchaseState.result.value.hasInlineDetail || !purchaseState.result.value.hasImportedPurchase || purchaseState.result.value.hasLegacySummary) {
      throw new Error(`烈酒当月进货 ${width}pt 未完成供应商同页标签明细改造：${JSON.stringify(purchaseState.result.value)}`);
    }
    if (purchaseState.result.value.rootScrollWidth > purchaseState.result.value.rootClientWidth || purchaseState.result.value.bodyScrollWidth > purchaseState.result.value.rootClientWidth) {
      throw new Error(`烈酒当月进货 ${width}pt 出现根级横向溢出：${JSON.stringify(purchaseState.result.value)}`);
    }
    spiritsViewports.push({ width, ledger: ledgerState.result.value, ledgerDetail: detailState.result.value, purchase: purchaseState.result.value });
  }
  report.push({ reportPage: "烈酒库存导入同步", viewports: spiritsViewports });

  // 直接完整台账：葡萄酒、水果、啤酒与食材均应在库存管理中直接显示横向表格，且名称可打开详情。
  await call("Runtime.evaluate", { expression: `(() => {
    const now = new Date().toISOString();
    const month = ${JSON.stringify(closeMonth)};
    const genericItem = (id, name, category, unit) => ({ id, name, category, spec: 'H5规格', unit, currentStock: 4, latestCostPrice: 12, supplier: 'H5供应商', notes: '', active: true, createdAt: now, updatedAt: now });
    localStorage.setItem('fruit.inventory.v2', JSON.stringify({ items: [genericItem('h5-fruit', 'H5青柠', 'citrus', 'kg')], purchases: [], consumes: [], snapshots: [] }));
    localStorage.setItem('beer.inventory.v2', JSON.stringify({ items: [genericItem('h5-beer', 'H5精酿啤酒', 'bottle', '瓶')], purchases: [], consumes: [], snapshots: [] }));
    const wineTypes = ['Red', 'White', 'Sparkling'];
    const wineItems = Array.from({ length: 36 }, (_, index) => {
      const seq = index + 1;
      const unitCost = 20 + (index % 5);
      const initQty = 4 + (index % 3);
      const purchaseQty = index % 2 === 0 ? 2 : 0;
      const endQty = initQty + purchaseQty - 1;
      return { seq, wineType: wineTypes[index % wineTypes.length], supplier: 'H5酒商', name: 'H5酒款' + seq + ' 赤霞珠', initUnitCost: unitCost, initQty, initCost: initQty * unitCost, purchaseQty, purchaseCost: purchaseQty * unitCost, endQty, unitCost, endCost: endQty * unitCost, consumeBottles: 1, consumeQty: unitCost };
    });
    localStorage.setItem('wine.snapshots.v2', JSON.stringify({ snapshots: [{ id: 'h5-wine-snapshot', monthLabel: month, importedAt: now, supplierTotals: { 'H5酒商': 396 }, totalPurchase: 396, totalConsume: 792, totalEndCost: wineItems.reduce((sum, item) => sum + item.endCost, 0), items: wineItems, purchaseOrders: [] }] }));
    localStorage.setItem('food.ingredients.v2', JSON.stringify({ ingredients: [{ id: 'h5-food', name: 'H5牛肉', category: 'meat', spec: '1kg/包', unit: '包', costPrice: 30, stock: 3, supplier: 'H5食材商', notes: '', createdAt: now, updatedAt: now }], priceHistory: {}, ledgerEntries: [{ id: 'h5-food-ledger', month, ingredientId: 'h5-food', openingQty: 2, openingUnitCost: 28, purchaseQty: 2, purchaseCost: 64, consumeQty: 1, consumeCost: 32, createdAt: now, updatedAt: now }], ledgerMovements: [] }));
    return month;
  })()`, returnByValue: true });
  const directLedgerViewports = [];
  for (const width of MOBILE_VIEWPORTS) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 3, mobile: true });
    for (const spec of [
      { label: '葡萄酒', path: '/wine-inventory', table: 'wine-horizontal-ledger-table', name: 'wine-ledger-name-1', sheet: 'generic-ledger-detail-sheet' },
      { label: '水果', path: '/fruit-inventory', table: 'fruit-horizontal-ledger-table', name: 'fruit-ledger-name-h5-fruit', sheet: 'generic-ledger-detail-sheet' },
      { label: '啤酒', path: '/beer-inventory', table: 'beer-horizontal-ledger-table', name: 'beer-ledger-name-h5-beer', sheet: 'generic-ledger-detail-sheet' },
      { label: '食材', path: '/food-inventory', table: 'food-horizontal-ledger-table', name: 'food-ledger-name-h5-food', sheet: 'food-ledger-detail-sheet' },
    ]) {
      await call("Page.navigate", { url: `http://localhost:${port}${spec.path}` });
      await sleep(760);
      const tableState = await call("Runtime.evaluate", { expression: `(() => {
        const table = document.querySelector('[data-testid="${spec.table}"]');
        const name = document.querySelector('[data-testid="${spec.name}"]');
        if (table) table.scrollLeft = Math.max(0, table.scrollWidth - table.clientWidth);
        return { foundTable: Boolean(table), foundName: Boolean(name), clientWidth: table?.clientWidth ?? 0, scrollWidth: table?.scrollWidth ?? 0, reachedEnd: table?.scrollLeft ?? 0, rootClientWidth: document.documentElement.clientWidth, rootScrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth };
      })()`, returnByValue: true });
      const state = tableState.result.value;
      if (!state.foundTable || !state.foundName || (state.scrollWidth > state.clientWidth + 1 && state.reachedEnd < 1)) throw new Error(`${spec.label} ${width}pt 未直接显示可横向滚动的完整台账：${JSON.stringify(state)}`);
      if (state.rootScrollWidth > state.rootClientWidth || state.bodyScrollWidth > state.rootClientWidth) throw new Error(`${spec.label} 完整台账 ${width}pt 出现根级横向溢出：${JSON.stringify(state)}`);
      const clicked = await call("Runtime.evaluate", { expression: `(() => { const name = document.querySelector('[data-testid="${spec.name}"]'); if (!name) return false; name.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); return true; })()`, returnByValue: true });
      if (!clicked.result.value) throw new Error(`${spec.label} ${width}pt 未能点击台账商品名称`);
      await sleep(140);
      const detail = await call("Runtime.evaluate", { expression: `Boolean(document.querySelector('[data-testid="${spec.sheet}"]'))`, returnByValue: true });
      if (!detail.result.value) throw new Error(`${spec.label} ${width}pt 商品名称未打开详情卡片`);
      let summaryTab = undefined;
      if (spec.label === "水果") {
        const summaryClicked = await call("Runtime.evaluate", { expression: `(() => { const tab = document.querySelector('[data-testid="fruit-inventory-tab-summary"]'); if (!tab) return false; tab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); return true; })()`, returnByValue: true });
        if (!summaryClicked.result.value) throw new Error(`水果 ${width}pt 未找到总结页签`);
        await sleep(120);
        const summaryState = await call("Runtime.evaluate", { expression: `(() => {
          const summary = document.querySelector('[data-testid="fruit-inventory-tab-summary"]');
          const ledger = document.querySelector('[data-testid="fruit-inventory-tab-ledger"]');
          const summaryRect = summary?.getBoundingClientRect();
          const ledgerRect = ledger?.getBoundingClientRect();
          return { found: Boolean(summary && ledger), summaryHeight: summaryRect?.height ?? 0, ledgerHeight: ledgerRect?.height ?? 0, summaryTop: summaryRect?.top ?? 0, ledgerTop: ledgerRect?.top ?? 0, rootClientWidth: document.documentElement.clientWidth, rootScrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth };
        })()`, returnByValue: true });
        summaryTab = summaryState.result.value;
        if (!summaryTab.found || summaryTab.summaryHeight < 44 || Math.abs(summaryTab.summaryHeight - summaryTab.ledgerHeight) > 1 || Math.abs(summaryTab.summaryTop - summaryTab.ledgerTop) > 1) throw new Error(`水果总结页签 ${width}pt 尺寸或对齐异常：${JSON.stringify(summaryTab)}`);
        if (summaryTab.rootScrollWidth > summaryTab.rootClientWidth || summaryTab.bodyScrollWidth > summaryTab.rootClientWidth) throw new Error(`水果总结页签 ${width}pt 出现根级横向溢出：${JSON.stringify(summaryTab)}`);
      }
      directLedgerViewports.push({ width, label: spec.label, ...state, summaryTab });
    }
  }
  report.push({ reportPage: '四类库存直接完整台账', viewports: directLedgerViewports });

  // 十类库存与店铺分类：选中页签和相邻页签必须等高、顶边对齐，且不会把绿色/红色选中态拉伸为异常块。
  const categoryTabLayoutViewports = [];
  const categoryTabSpecs = [
    { label: "烈酒", path: "/spirits-inventory", active: "spirits-tab-summary", peer: "spirits-tab-ledger" },
    { label: "葡萄酒", path: "/wine-inventory", active: "wine-tab-summary", peer: "wine-tab-ledger" },
    { label: "水果", path: "/fruit-inventory", active: "fruit-inventory-tab-summary", peer: "fruit-inventory-tab-ledger" },
    { label: "食材", path: "/food-inventory", active: "food-tab-summary", peer: "food-tab-ledger" },
    { label: "啤酒", path: "/beer-inventory", active: "beer-inventory-tab-summary", peer: "beer-inventory-tab-ledger" },
    { label: "冰块", path: "/ice-inventory", active: "ice-inventory-tab-summary", peer: "ice-inventory-tab-ledger" },
    { label: "杯具", path: "/glassware-inventory", active: "glassware-inventory-tab-summary", peer: "glassware-inventory-tab-ledger" },
    { label: "餐具", path: "/tableware-inventory", active: "tableware-inventory-tab-summary", peer: "tableware-inventory-tab-ledger" },
    { label: "日用品", path: "/daily-inventory", active: "daily-inventory-tab-summary", peer: "daily-inventory-tab-ledger" },
    { label: "设备", path: "/equipment-inventory", active: "equipment-tab-ledger", peer: "equipment-tab-purchase" },
  ];
  for (const width of MOBILE_VIEWPORTS) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 3, mobile: true });
    for (const spec of categoryTabSpecs) {
      await call("Page.navigate", { url: `http://localhost:${port}${spec.path}` });
      await sleep(620);
      const clicked = await call("Runtime.evaluate", { expression: `(() => { const tab = document.querySelector('[data-testid="${spec.active}"]'); if (!tab) return false; tab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); return true; })()`, returnByValue: true });
      if (!clicked.result.value) throw new Error(`${spec.label} ${width}pt 未找到待验证的页签`);
      await sleep(90);
      const tabState = await call("Runtime.evaluate", { expression: `(() => {
        const active = document.querySelector('[data-testid="${spec.active}"]');
        const peer = document.querySelector('[data-testid="${spec.peer}"]');
        const activeRect = active?.getBoundingClientRect();
        const peerRect = peer?.getBoundingClientRect();
        return { found: Boolean(active && peer), activeHeight: activeRect?.height ?? 0, peerHeight: peerRect?.height ?? 0, activeTop: activeRect?.top ?? 0, peerTop: peerRect?.top ?? 0, rootClientWidth: document.documentElement.clientWidth, rootScrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth };
      })()`, returnByValue: true });
      const state = tabState.result.value;
      if (!state.found || state.activeHeight < 44 || Math.abs(state.activeHeight - state.peerHeight) > 1 || Math.abs(state.activeTop - state.peerTop) > 1) throw new Error(`${spec.label} ${width}pt 页签选中态尺寸或对齐异常：${JSON.stringify(state)}`);
      if (state.rootScrollWidth > state.rootClientWidth || state.bodyScrollWidth > state.rootClientWidth) throw new Error(`${spec.label} ${width}pt 页签选中态出现根级横向溢出：${JSON.stringify(state)}`);
      categoryTabLayoutViewports.push({ width, label: spec.label, ...state });
    }
  }
  report.push({ reportPage: "十类分类页签尺寸一致性", viewports: categoryTabLayoutViewports });

  // 葡萄酒供应商：标签在当前工作台切换，展示往来信息和酒库档案，而不是重复库存台账。
  const wineSupplierViewports = [];
  for (const width of MOBILE_VIEWPORTS) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 3, mobile: true });
    await call("Page.navigate", { url: `http://localhost:${port}/wine-inventory` });
    await sleep(760);
    const switched = await call("Runtime.evaluate", { expression: `(() => { const tab = document.querySelector('[data-testid="wine-tab-supplier"]'); if (!tab) return false; tab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); return true; })()`, returnByValue: true });
    if (!switched.result.value) throw new Error(`葡萄酒供应商 ${width}pt 未找到同页标签入口`);
    await sleep(160);
    const supplierState = await call("Runtime.evaluate", { expression: `(() => {
      const workspace = document.querySelector('[data-testid="wine-supplier-inline-workspace"]');
      const tabs = document.querySelector('[data-testid="wine-supplier-tabs"]');
      const info = document.querySelector('[data-testid="wine-supplier-info-scroll"]');
      const record = document.querySelector('[data-testid="wine-supplier-record-purchase"]');
      const library = document.querySelector('[data-testid="wine-supplier-open-library"]');
      const legacyTable = document.querySelector('[data-testid="wine-supplier-horizontal-ledger-table"]');
      if (info) info.scrollTop = Math.max(0, info.scrollHeight - info.clientHeight);
      return { workspace: Boolean(workspace), tabs: Boolean(tabs), info: Boolean(info), record: Boolean(record), library: Boolean(library), legacyTable: Boolean(legacyTable), clientHeight: info?.clientHeight ?? 0, scrollHeight: info?.scrollHeight ?? 0, reachedEnd: info?.scrollTop ?? 0, rootClientWidth: document.documentElement.clientWidth, rootScrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth };
    })()`, returnByValue: true });
    const state = supplierState.result.value;
    if (!state.workspace || !state.tabs || !state.info || !state.record || !state.library || state.legacyTable || (state.scrollHeight > state.clientHeight + 1 && state.reachedEnd < 1)) throw new Error(`葡萄酒供应商 ${width}pt 信息工作台或纵向滚动异常：${JSON.stringify(state)}`);
    if (state.rootScrollWidth > state.rootClientWidth || state.bodyScrollWidth > state.rootClientWidth) throw new Error(`葡萄酒供应商 ${width}pt 出现根级横向溢出：${JSON.stringify(state)}`);
    wineSupplierViewports.push({ width, ...state });
  }
  report.push({ reportPage: '葡萄酒供货商信息工作台', viewports: wineSupplierViewports });

  // 葡萄酒库存台账：外层必须可纵向下滑，内层只处理横向列浏览。
  const wineLedgerScrollViewports = [];
  for (const width of MOBILE_VIEWPORTS) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 3, mobile: true });
    await call("Page.navigate", { url: `http://localhost:${port}/wine-inventory` });
    await sleep(760);
    const state = (await call("Runtime.evaluate", { expression: `(() => {
      const workspace = document.querySelector('[data-testid="wine-ledger-scroll-workspace"]');
      const table = document.querySelector('[data-testid="wine-horizontal-ledger-table"]');
      const vertical = workspace?.querySelector('[style*="overflow-y"]') || workspace?.firstElementChild;
      if (vertical) vertical.scrollTop = Math.max(0, vertical.scrollHeight - vertical.clientHeight);
      if (table) table.scrollLeft = Math.max(0, table.scrollWidth - table.clientWidth);
      return { workspace: Boolean(workspace), table: Boolean(table), verticalClientHeight: vertical?.clientHeight ?? 0, verticalScrollHeight: vertical?.scrollHeight ?? 0, verticalReachedEnd: vertical?.scrollTop ?? 0, horizontalClientWidth: table?.clientWidth ?? 0, horizontalScrollWidth: table?.scrollWidth ?? 0, horizontalReachedEnd: table?.scrollLeft ?? 0, rootClientWidth: document.documentElement.clientWidth, rootScrollWidth: document.documentElement.scrollWidth };
    })()`, returnByValue: true })).result.value;
    if (!state.workspace || !state.table || (state.verticalScrollHeight > state.verticalClientHeight + 1 && state.verticalReachedEnd < 1) || (state.horizontalScrollWidth > state.horizontalClientWidth + 1 && state.horizontalReachedEnd < 1)) throw new Error(`葡萄酒库存 ${width}pt 横纵向滚动异常：${JSON.stringify(state)}`);
    if (state.rootScrollWidth > state.rootClientWidth) throw new Error(`葡萄酒库存 ${width}pt 出现根级横向溢出：${JSON.stringify(state)}`);
    wineLedgerScrollViewports.push({ width, ...state });
  }
  report.push({ reportPage: '葡萄酒库存横纵向滚动', viewports: wineLedgerScrollViewports });

  // 报表四页签：总月报、经营分析、账户、时段经营分析均在同一工作台切换，且只保留一套月份导航。
  const reportMonthNavigatorViewports = [];
  for (const width of MOBILE_VIEWPORTS) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 3, mobile: true });
    await call("Page.navigate", { url: `http://localhost:${port}/store` });
    await sleep(760);
    await click(call, clickTestIdExpression("store-main-tab-monthly"), `${width}pt 未找到报表主导航`);
    await sleep(120);
    const states = [];
    for (const spec of [
      { tab: "store-report-tab-summary", label: "总月报" },
      { tab: "store-report-tab-analytics", label: "经营分析" },
      { tab: "store-report-tab-accounts", label: "账户" },
      { tab: "store-report-tab-period", label: "时段经营分析" },
    ]) {
      await click(call, clickTestIdExpression(spec.tab), `${width}pt 未找到${spec.label}页签`);
      await sleep(150);
      const measured = await call("Runtime.evaluate", { expression: `(() => {
        const navigator = document.querySelector('[data-testid="report-workspace-month-navigator"]');
        const picker = document.querySelector('[data-testid="report-workspace-month-navigator-picker"]');
        return {
          found: Boolean(navigator && picker),
          label: picker?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
          path: location.pathname,
          reportTabs: document.querySelectorAll('[data-testid^="store-report-tab-"]').length,
          rootClientWidth: document.documentElement.clientWidth,
          rootScrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
        };
      })()`, returnByValue: true });
      const state = measured.result.value;
      if (!state.found || state.reportTabs !== 4) throw new Error(`${spec.label} ${width}pt 缺少四页签共享月份导航：${JSON.stringify(state)}`);
      if (!state.path.endsWith("/store")) throw new Error(`${spec.label} ${width}pt 发生了不应有的路由跳转：${JSON.stringify(state)}`);
      if (state.rootScrollWidth > state.rootClientWidth || state.bodyScrollWidth > state.rootClientWidth) throw new Error(`${spec.label} ${width}pt 工作台出现根级横向溢出：${JSON.stringify(state)}`);
      states.push({ label: spec.label, ...state });
    }
    const labels = new Set(states.map((state) => state.label));
    if (labels.size !== 1) throw new Error(`报表四页 ${width}pt 月份不同步：${JSON.stringify(states)}`);
    reportMonthNavigatorViewports.push({ width, states });
  }
  report.push({ reportPage: "报表四页签共享月份与零跳转", viewports: reportMonthNavigatorViewports });

  // 员工档案顶部筛选栏：验证“后厨 3”文字与人数徽标分别完整可见、边界不相交。
  const employeeFilterViewports = [];
  for (const width of MOBILE_VIEWPORTS) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 3, mobile: true });
    await call("Page.navigate", { url: `http://localhost:${port}/labor-employees` });
    await sleep(700);
    const layout = await call("Runtime.evaluate", { expression: `(() => {
      const elements = [...document.querySelectorAll('*')];
      const chip = elements.find((node) => node.textContent?.replace(/\\s/g, '') === '后厨3');
      const label = chip && [...chip.querySelectorAll('*')].find((node) => node.children.length === 0 && node.textContent?.trim() === '后厨');
      const badge = chip && [...chip.querySelectorAll('*')].find((node) => node.children.length === 0 && node.textContent?.trim() === '3');
      const chipRect = chip?.getBoundingClientRect();
      const labelRect = label?.getBoundingClientRect();
      const badgeBox = badge && [badge, ...function* () { let node = badge.parentElement; while (node) { yield node; node = node.parentElement; } }()].find((node) => node.textContent?.trim() === '3' && node.getBoundingClientRect().width >= 20);
      const badgeRect = badgeBox?.getBoundingClientRect();
      return {
        rootClientWidth: document.documentElement.clientWidth,
        rootScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        foundChip: Boolean(chip && label && badge),
        hasOverlap: Boolean(labelRect && badgeRect && labelRect.right > badgeRect.left),
        fitsChip: Boolean(chipRect && labelRect && badgeRect && labelRect.left >= chipRect.left && badgeRect.right <= chipRect.right),
      };
    })()`, returnByValue: true });
    const state = layout.result.value;
    if (!state.foundChip || state.hasOverlap || !state.fitsChip) throw new Error(`员工筛选“后厨 3”在 ${width}pt 未完整独立显示：${JSON.stringify(state)}`);
    if (state.rootScrollWidth > state.rootClientWidth || state.bodyScrollWidth > state.rootClientWidth) throw new Error(`员工筛选栏在 ${width}pt 造成根级横向溢出：${JSON.stringify(state)}`);
    employeeFilterViewports.push({ width, ...state });
  }
  report.push({ reportPage: "员工档案筛选标签", viewports: employeeFilterViewports });

  await call("Emulation.clearDeviceMetricsOverride");
  socket.close();
  console.log(JSON.stringify({ passed: true, route, report }, null, 2));
} finally {
  if (testTarget?.id) {
    await fetch(`http://localhost:9222/json/close/${testTarget.id}`).catch(() => {});
  }
  testSocket?.close();
  server.close();
}
