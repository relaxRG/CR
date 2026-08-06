/**
 * lib/labor/export.ts
 * 员工管理导出引擎 — 薪资报表（Excel/PDF）+ 排班表（时长/班次模式，Excel/PDF）
 */

import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as XLSX from "xlsx";

import type { Employee, ShiftEntry, MonthlyAttendance, PaySlip, ShiftTemplate } from "./types";
import { DEPT_LABELS, EMPLOYEE_TYPE_LABELS } from "./types";

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

function fmt(n: number | undefined | null, digits = 2): string {
  if (n == null || isNaN(n)) return "—";
  return n.toFixed(digits);
}

function fmtStatus(slip: PaySlip | undefined): string {
  if (!slip) return "—";
  const paid = slip.pettyLaborPaid ?? 0;
  const final = slip.finalSalary ?? 0;
  if (paid >= final && final > 0) return "已发";
  if (paid > 0) return `部分已发 (¥${paid.toFixed(0)})`;
  return "待发";
}

// 获取月份所有日期列表
function getDaysInMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const days: string[] = [];
  const d = new Date(y, m - 1, 1);
  while (d.getMonth() === m - 1) {
    days.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

// 星期标签
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
function weekdayLabel(dateStr: string): string {
  return WEEKDAY_LABELS[new Date(dateStr).getDay()];
}

// ─── 导出参数类型 ──────────────────────────────────────────────────────────────

export interface ExportParams {
  month: string;
  employees: Employee[];
  paySlips: PaySlip[];
  attendances: MonthlyAttendance[];
  shifts: ShiftEntry[];
  shiftTemplates: ShiftTemplate[];
}

// ─── 薪资报表 Excel ────────────────────────────────────────────────────────────

export function buildPayrollWorkbook(params: ExportParams): XLSX.WorkBook {
  const { month, employees, paySlips, attendances } = params;
  const wb = XLSX.utils.book_new();

  const activeEmps = employees.filter((e) => e.active && !e.archived);
  const monthSlips = paySlips.filter((s) => s.month === month);
  const monthAtts = attendances.filter((a) => a.month === month);

  // 部门分组顺序
  const DEPT_ORDER: Array<{ key: string; label: string; filter: (e: Employee) => boolean }> = [
    { key: "front",    label: "前厅",     filter: (e) => e.dept === "front" && e.type !== "parttime" },
    { key: "kitchen",  label: "后厨",     filter: (e) => e.dept === "kitchen" && e.type !== "parttime" },
    { key: "company",  label: "公司",     filter: (e) => e.dept === "other" && e.type !== "parttime" },
    { key: "parttime", label: "临时兼职", filter: (e) => e.type === "parttime" },
  ];

  // ── Sheet 1：总表 ──
  const totalHeader = [
    "部门", "姓名", "代号", "类型",
    "底薪", "应出勤天", "实际出勤天", "日薪",
    "加班时长(h)", "加班金额",
    "节假日天数", "节假日薪资",
    "考勤工资小计",
    "工作绩效", "补贴合计", "奖惩小计", "调休兑现",
    "应发工资",
    "社保代缴(个人)", "公积金代缴(个人)", "个税代缴",
    "预支",
    "实发工资",
    "公司社保部分", "公司公积金部分", "公司总人力成本",
    "付款状态",
  ];

  const totalRows: (string | number)[][] = [];
  let grandFinal = 0;
  let grandCost = 0;

  for (const dept of DEPT_ORDER) {
    const deptEmps = activeEmps.filter(dept.filter);
    if (deptEmps.length === 0) continue;

    let deptFinal = 0;
    let deptCost = 0;

    for (const emp of deptEmps) {
      const slip = monthSlips.find((s) => s.employeeId === emp.id);
      const att = monthAtts.find((a) => a.employeeId === emp.id);

      const baseSalary = emp.baseSalary ?? 0;
      const expectedDays = att?.expectedAttendanceDays ?? 0;
      const actualDays = att?.attendanceDays ?? 0;
      const dailySalary = expectedDays > 0 ? baseSalary / expectedDays : 0;
      const overtimeHours = att?.paidOvertimeHours ?? 0;
      const overtimeAmount = 0; // overtimeBonus 在 PaySlip 中计算
      const holidayDays = 0; // 节假日天数在 PaySlip 中计算
      const holidayBonus = att?.holidayBonus ?? 0;
      const attendanceSalary = slip?.attendanceSalary ?? 0;
      const performanceBonus = slip?.performanceBonus ?? 0;
      const allowanceTotal = (slip?.mealAllowance ?? 0) + (slip?.transportAllowance ?? 0) + (slip?.otherAllowance ?? 0);
      const rewardPenalty = slip?.rewardPenalty ?? 0;
      const compOffCashOut = slip?.compOffCashOut ?? 0;
      const grossSalary = slip?.grossSalary ?? 0;
      const socialIns = slip?.socialInsuranceDeduction ?? 0;
      const housingFund = slip?.housingFundDeduction ?? 0;
      const incomeTax = slip?.incomeTax ?? 0;
      const advance = slip?.advanceAmount ?? 0;
      const finalSalary = slip?.finalSalary ?? 0;
      const empSocialIns = slip?.employerSocialInsurance ?? 0;
      const empHousingFund = slip?.employerHousingFund ?? 0;
      const totalCost = slip?.totalEmployerCost ?? grossSalary;

      deptFinal += finalSalary;
      deptCost += totalCost;
      grandFinal += finalSalary;
      grandCost += totalCost;

      totalRows.push([
        dept.label,
        emp.realName,
        emp.code ?? "",
        EMPLOYEE_TYPE_LABELS[emp.type],
        baseSalary,
        expectedDays,
        actualDays,
        +dailySalary.toFixed(2),
        +overtimeHours.toFixed(1),
        +overtimeAmount.toFixed(2),
        holidayDays,
        +holidayBonus.toFixed(2),
        +attendanceSalary.toFixed(2),
        +performanceBonus.toFixed(2),
        +allowanceTotal.toFixed(2),
        +rewardPenalty.toFixed(2),
        +compOffCashOut.toFixed(2),
        +grossSalary.toFixed(2),
        +socialIns.toFixed(2),
        +housingFund.toFixed(2),
        +incomeTax.toFixed(2),
        +advance.toFixed(2),
        +finalSalary.toFixed(2),
        +empSocialIns.toFixed(2),
        +empHousingFund.toFixed(2),
        +totalCost.toFixed(2),
        fmtStatus(slip),
      ]);
    }

    // 部门小计行
    totalRows.push([
      `【${dept.label} 小计】`, "", "", "",
      "", "", "", "", "", "", "", "", "", "", "", "", "",
      "", "", "", "", "",
      +deptFinal.toFixed(2),
      "", "", +deptCost.toFixed(2), "",
    ]);
  }

  // 总计行
  totalRows.push([
    "【总计】", "", "", "",
    "", "", "", "", "", "", "", "", "", "", "", "", "",
    "", "", "", "", "",
    +grandFinal.toFixed(2),
    "", "", +grandCost.toFixed(2), "",
  ]);

  const totalSheet = XLSX.utils.aoa_to_sheet([totalHeader, ...totalRows]);
  // 设置列宽
  totalSheet["!cols"] = totalHeader.map((h) => ({ wch: Math.max(h.length * 2, 8) }));
  XLSX.utils.book_append_sheet(wb, totalSheet, `${month} 薪资总表`);

  // ── Sheet 2-N：各部门明细 ──
  for (const dept of DEPT_ORDER) {
    const deptEmps = activeEmps.filter(dept.filter);
    if (deptEmps.length === 0) continue;

    const detailHeader = [
      "姓名", "代号", "类型",
      "底薪", "应出勤天", "实际出勤天", "日薪",
      "加班时长(h)", "加班金额",
      "节假日天数", "节假日薪资",
      "考勤工资小计",
      "工作绩效", "餐补", "交通补贴", "其他补贴", "补贴合计",
      "奖励", "惩罚", "奖惩小计",
      "调休兑现",
      "应发工资",
      "社保代缴(个人)", "公积金代缴(个人)", "个税代缴",
      "预支",
      "实发工资",
      "公司社保部分", "公司公积金部分", "公司总人力成本",
      "付款状态", "备注",
    ];

    const detailRows: (string | number)[][] = deptEmps.map((emp) => {
      const slip = monthSlips.find((s) => s.employeeId === emp.id);
      const att = monthAtts.find((a) => a.employeeId === emp.id);

      const baseSalary = emp.baseSalary ?? 0;
      const expectedDays = att?.expectedAttendanceDays ?? 0;
      const dailySalary = expectedDays > 0 ? baseSalary / expectedDays : 0;
      const rewardItems = slip?.rewardPenaltyItems ?? [];
      const rewards = rewardItems.filter((i) => i.amount > 0).reduce((s, i) => s + i.amount, 0);
      const penalties = rewardItems.filter((i) => i.amount < 0).reduce((s, i) => s + i.amount, 0);

      return [
        emp.realName,
        emp.code ?? "",
        EMPLOYEE_TYPE_LABELS[emp.type],
        baseSalary,
        expectedDays,
        att?.attendanceDays ?? 0,
        +dailySalary.toFixed(2),
        +(att?.paidOvertimeHours ?? 0).toFixed(1),
        0, // overtimeBonus 在 PaySlip 中计算
        0, // holidayDays 在 PaySlip 中计算
        +(att?.holidayBonus ?? 0).toFixed(2),
        +(slip?.attendanceSalary ?? 0).toFixed(2),
        +(slip?.performanceBonus ?? 0).toFixed(2),
        +(slip?.mealAllowance ?? 0).toFixed(2),
        +(slip?.transportAllowance ?? 0).toFixed(2),
        +(slip?.otherAllowance ?? 0).toFixed(2),
        +((slip?.mealAllowance ?? 0) + (slip?.transportAllowance ?? 0) + (slip?.otherAllowance ?? 0)).toFixed(2),
        +rewards.toFixed(2),
        +penalties.toFixed(2),
        +(slip?.rewardPenalty ?? 0).toFixed(2),
        +(slip?.compOffCashOut ?? 0).toFixed(2),
        +(slip?.grossSalary ?? 0).toFixed(2),
        +(slip?.socialInsuranceDeduction ?? 0).toFixed(2),
        +(slip?.housingFundDeduction ?? 0).toFixed(2),
        +(slip?.incomeTax ?? 0).toFixed(2),
        +(slip?.advanceAmount ?? 0).toFixed(2),
        +(slip?.finalSalary ?? 0).toFixed(2),
        +(slip?.employerSocialInsurance ?? 0).toFixed(2),
        +(slip?.employerHousingFund ?? 0).toFixed(2),
        +(slip?.totalEmployerCost ?? slip?.grossSalary ?? 0).toFixed(2),
        fmtStatus(slip),
        slip?.notes ?? "",
      ];
    });

    const detailSheet = XLSX.utils.aoa_to_sheet([detailHeader, ...detailRows]);
    detailSheet["!cols"] = detailHeader.map((h) => ({ wch: Math.max(h.length * 2, 8) }));
    XLSX.utils.book_append_sheet(wb, detailSheet, `${dept.label}`);
  }

  return wb;
}

// ─── 排班表 Excel ──────────────────────────────────────────────────────────────

export type ScheduleMode = "hours" | "session";

export function buildScheduleWorkbook(params: ExportParams, mode: ScheduleMode): XLSX.WorkBook {
  const { month, employees, shifts, shiftTemplates } = params;
  const wb = XLSX.utils.book_new();
  const days = getDaysInMonth(month);

  const DEPT_GROUPS: Array<{ key: string; label: string; filter: (e: Employee) => boolean }> = [
    { key: "front",   label: "前厅", filter: (e) => e.dept === "front" && e.type !== "parttime" },
    { key: "kitchen", label: "后厨", filter: (e) => e.dept === "kitchen" && e.type !== "parttime" },
  ];

  for (const dept of DEPT_GROUPS) {
    const deptEmps = employees.filter((e) => e.active && !e.archived && dept.filter(e));
    if (deptEmps.length === 0) continue;

    // 表头：姓名 + 日期列
    const dateHeader = ["姓名 / 日期", ...days.map((d) => {
      const day = d.slice(8); // "01"
      const wd = weekdayLabel(d);
      return `${day}\n周${wd}`;
    }), "合计"];

    const rows: (string | number)[][] = [dateHeader];

    for (const emp of deptEmps) {
      const empShifts = shifts.filter((s) => s.employeeId === emp.id && s.date.startsWith(month));
      let totalHours = 0;
      const sessionSet = new Set<string>();

      const row: (string | number)[] = [emp.realName];

      for (const day of days) {
        const dayShifts = empShifts.filter((s) => s.date === day);
        if (dayShifts.length === 0) {
          row.push("—");
          continue;
        }

        if (mode === "hours") {
          const hours = dayShifts.reduce((sum, s) => sum + (typeof s.hoursValue === 'number' ? s.hoursValue : 0), 0);
          totalHours += hours;
          row.push(hours > 0 ? `${hours.toFixed(1)}h` : "—");
        } else {
          // 班次模式：显示班次名称
          const sessions = dayShifts
            .map((s) => s.shift)
            .filter(Boolean)
            .join("/");
          dayShifts.forEach((s) => s.shift && sessionSet.add(s.shift));
          row.push(sessions || "—");
        }
      }

      // 合计列
      if (mode === "hours") {
        row.push(`${totalHours.toFixed(1)}h`);
      } else {
        row.push(`${sessionSet.size} 种班次`);
      }

      rows.push(row);
    }

    // 班次图例行（班次模式）
    if (mode === "session" && shiftTemplates.length > 0) {
      rows.push([]);
      rows.push(["班次图例："]);
      for (const tpl of shiftTemplates) {
        rows.push([`${tpl.session}`, `${tpl.startTime} - ${tpl.endTime}`, `默认 ${tpl.defaultHours}h`]);
      }
    }

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    // 设置列宽
    sheet["!cols"] = [{ wch: 12 }, ...days.map(() => ({ wch: 8 })), { wch: 10 }];
    const sheetName = `${dept.label}${mode === "hours" ? "（时长）" : "（班次）"}`;
    XLSX.utils.book_append_sheet(wb, sheet, sheetName);
  }

  return wb;
}

// ─── 薪资报表 PDF HTML ─────────────────────────────────────────────────────────

export function buildPayrollHtml(params: ExportParams): string {
  const { month, employees, paySlips, attendances } = params;
  const activeEmps = employees.filter((e) => e.active && !e.archived);
  const monthSlips = paySlips.filter((s) => s.month === month);
  const monthAtts = attendances.filter((a) => a.month === month);

  const DEPT_ORDER: Array<{ label: string; filter: (e: Employee) => boolean }> = [
    { label: "前厅",     filter: (e) => e.dept === "front" && e.type !== "parttime" },
    { label: "后厨",     filter: (e) => e.dept === "kitchen" && e.type !== "parttime" },
    { label: "公司",     filter: (e) => e.dept === "other" && e.type !== "parttime" },
    { label: "临时兼职", filter: (e) => e.type === "parttime" },
  ];

  let grandFinal = 0;
  let grandCost = 0;

  const deptSections = DEPT_ORDER.map(({ label, filter }) => {
    const deptEmps = activeEmps.filter(filter);
    if (deptEmps.length === 0) return "";

    let deptFinal = 0;
    const empRows = deptEmps.map((emp) => {
      const slip = monthSlips.find((s) => s.employeeId === emp.id);
      const att = monthAtts.find((a) => a.employeeId === emp.id);
      const finalSalary = slip?.finalSalary ?? 0;
      deptFinal += finalSalary;
      grandFinal += finalSalary;
      grandCost += slip?.totalEmployerCost ?? slip?.grossSalary ?? 0;

      return `
        <tr>
          <td>${emp.realName}</td>
          <td>${emp.code ?? ""}</td>
          <td>${EMPLOYEE_TYPE_LABELS[emp.type]}</td>
          <td>${att?.attendanceDays ?? "—"}/${att?.expectedAttendanceDays ?? "—"}</td>
          <td>${fmt(att?.paidOvertimeHours ?? 0, 1)}h</td>
          <td>¥${fmt(slip?.attendanceSalary)}</td>
          <td>¥${fmt(slip?.performanceBonus)}</td>
          <td>¥${fmt((slip?.mealAllowance ?? 0) + (slip?.transportAllowance ?? 0) + (slip?.otherAllowance ?? 0))}</td>
          <td>¥${fmt(slip?.rewardPenalty)}</td>
          <td>¥${fmt(slip?.compOffCashOut)}</td>
          <td>¥${fmt(slip?.grossSalary)}</td>
          <td>¥${fmt(slip?.socialInsuranceDeduction)}</td>
          <td>¥${fmt(slip?.housingFundDeduction)}</td>
          <td>¥${fmt(slip?.incomeTax)}</td>
          <td>¥${fmt(slip?.advanceAmount)}</td>
          <td class="highlight">¥${fmt(finalSalary)}</td>
          <td>¥${fmt(slip?.totalEmployerCost ?? slip?.grossSalary)}</td>
          <td class="${fmtStatus(slip) === "已发" ? "paid" : "unpaid"}">${fmtStatus(slip)}</td>
        </tr>`;
    }).join("");

    return `
      <tr class="dept-header"><td colspan="18">${label}（${deptEmps.length} 人）</td></tr>
      ${empRows}
      <tr class="subtotal">
        <td colspan="15">【${label} 小计】</td>
        <td class="highlight">¥${deptFinal.toFixed(2)}</td>
        <td colspan="2"></td>
      </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${month} 薪资报表</title>
<style>
  body { font-family: -apple-system, "PingFang SC", sans-serif; font-size: 10px; margin: 16px; color: #1a1a1a; }
  h1 { font-size: 16px; text-align: center; margin-bottom: 4px; }
  h2 { font-size: 11px; text-align: center; color: #666; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 9px; }
  th { background: #1a1a2e; color: white; padding: 5px 4px; text-align: center; white-space: nowrap; }
  td { border: 1px solid #ddd; padding: 4px; text-align: center; white-space: nowrap; }
  tr:nth-child(even) { background: #f8f8f8; }
  .dept-header td { background: #e8f4fd; font-weight: bold; text-align: left; padding: 6px 8px; color: #007AFF; }
  .subtotal td { background: #fff3e0; font-weight: bold; }
  .highlight { color: #007AFF; font-weight: bold; }
  .paid { color: #34C759; font-weight: bold; }
  .unpaid { color: #FF3B30; }
  .total-row td { background: #1a1a2e; color: white; font-weight: bold; }
  @page { margin: 10mm; size: A3 landscape; }
</style>
</head>
<body>
<h1>${month} 薪资报表</h1>
<h2>导出时间：${new Date().toLocaleString("zh-CN")}</h2>
<table>
  <thead>
    <tr>
      <th>姓名</th><th>代号</th><th>类型</th>
      <th>出勤/应出勤</th><th>加班(h)</th>
      <th>考勤工资</th><th>绩效</th><th>补贴合计</th>
      <th>奖惩</th><th>调休兑现</th>
      <th>应发工资</th>
      <th>社保(个人)</th><th>公积金(个人)</th><th>个税</th>
      <th>预支</th>
      <th>实发工资</th><th>公司总成本</th><th>状态</th>
    </tr>
  </thead>
  <tbody>
    ${deptSections}
    <tr class="total-row">
      <td colspan="15">【总计】</td>
      <td>¥${grandFinal.toFixed(2)}</td>
      <td>¥${grandCost.toFixed(2)}</td>
      <td></td>
    </tr>
  </tbody>
</table>
</body>
</html>`;
}

// ─── 排班表 PDF HTML ───────────────────────────────────────────────────────────

export function buildScheduleHtml(params: ExportParams, mode: ScheduleMode): string {
  const { month, employees, shifts, shiftTemplates } = params;
  const days = getDaysInMonth(month);

  const DEPT_GROUPS: Array<{ label: string; filter: (e: Employee) => boolean }> = [
    { label: "前厅", filter: (e) => e.dept === "front" && e.type !== "parttime" },
    { label: "后厨", filter: (e) => e.dept === "kitchen" && e.type !== "parttime" },
  ];

  const deptSections = DEPT_GROUPS.map(({ label, filter }) => {
    const deptEmps = employees.filter((e) => e.active && !e.archived && filter(e));
    if (deptEmps.length === 0) return "";

    const dateHeaders = days.map((d) => {
      const day = d.slice(8);
      const wd = weekdayLabel(d);
      const isWeekend = new Date(d).getDay() === 0 || new Date(d).getDay() === 6;
      return `<th class="${isWeekend ? "weekend" : ""}">${day}<br><span style="font-size:8px">周${wd}</span></th>`;
    }).join("");

    const empRows = deptEmps.map((emp) => {
      const empShifts = shifts.filter((s) => s.employeeId === emp.id && s.date.startsWith(month));
      let totalHours = 0;

      const cells = days.map((day) => {
        const dayShifts = empShifts.filter((s) => s.date === day);
        if (dayShifts.length === 0) return `<td class="empty">—</td>`;

        if (mode === "hours") {
          const hours = dayShifts.reduce((sum, s) => sum + (typeof s.hoursValue === 'number' ? s.hoursValue : 0), 0);
          totalHours += hours;
          return `<td class="has-shift">${hours.toFixed(1)}h</td>`;
        } else {
          const sessions = dayShifts.map((s) => {
            const tpl = shiftTemplates.find((t) => t.session === s.shift);
            const color = tpl?.color ?? "#007AFF";
            return `<span style="background:${color}20;color:${color};padding:1px 3px;border-radius:3px;font-size:8px">${s.shift}</span>`;
          }).join("<br>");
          return `<td class="has-shift">${sessions}</td>`;
        }
      }).join("");

      const totalCell = mode === "hours"
        ? `<td class="total-cell">${totalHours.toFixed(1)}h</td>`
        : `<td class="total-cell">—</td>`;

      return `<tr><td class="emp-name">${emp.realName}</td>${cells}${totalCell}</tr>`;
    }).join("");

    return `
      <h3>${label}（${deptEmps.length} 人）</h3>
      <table>
        <thead>
          <tr>
            <th class="emp-col">姓名</th>
            ${dateHeaders}
            <th class="total-col">合计</th>
          </tr>
        </thead>
        <tbody>${empRows}</tbody>
      </table>`;
  }).join("<br>");

  // 班次图例
  const legend = mode === "session" && shiftTemplates.length > 0
    ? `<div class="legend">
        <strong>班次图例：</strong>
        ${shiftTemplates.map((t) =>
          `<span style="background:${t.color}20;color:${t.color};padding:2px 6px;border-radius:4px;margin:2px">${t.session}（${t.startTime}–${t.endTime}，${t.defaultHours}h）</span>`
        ).join("")}
      </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>${month} 排班表（${mode === "hours" ? "时长模式" : "班次模式"}）</title>
<style>
  body { font-family: -apple-system, "PingFang SC", sans-serif; font-size: 9px; margin: 12px; color: #1a1a1a; }
  h2 { font-size: 14px; text-align: center; margin-bottom: 4px; }
  h3 { font-size: 11px; color: #007AFF; margin: 12px 0 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th { background: #1a1a2e; color: white; padding: 4px 2px; text-align: center; font-size: 8px; }
  th.weekend { background: #5856D6; }
  td { border: 1px solid #e0e0e0; padding: 3px 2px; text-align: center; font-size: 8px; }
  td.empty { color: #ccc; }
  td.has-shift { background: #f0f8ff; }
  td.emp-name { font-weight: bold; text-align: left; padding-left: 4px; white-space: nowrap; min-width: 50px; }
  td.total-cell { background: #fff3e0; font-weight: bold; color: #FF6B00; }
  th.emp-col { text-align: left; min-width: 50px; }
  th.total-col { background: #FF6B00; }
  .legend { margin-top: 8px; padding: 6px; background: #f8f8f8; border-radius: 6px; font-size: 9px; }
  @page { margin: 8mm; size: A3 landscape; }
</style>
</head>
<body>
<h2>${month} 排班表（${mode === "hours" ? "时长模式" : "班次模式"}）</h2>
${legend}
${deptSections}
</body>
</html>`;
}

// ─── 统一导出函数 ──────────────────────────────────────────────────────────────

export type ExportType = "payroll_excel" | "payroll_pdf" | "schedule_hours_excel" | "schedule_hours_pdf" | "schedule_session_excel" | "schedule_session_pdf";

export async function exportLaborData(type: ExportType, params: ExportParams): Promise<void> {
  const { month } = params;

  let fileUri: string;
  let mimeType: string;
  let dialogTitle: string;

  switch (type) {
    case "payroll_excel": {
      const wb = buildPayrollWorkbook(params);
      const wbout = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
      const fileName = `薪资报表_${month}.xlsx`;
      fileUri = (FileSystem.cacheDirectory ?? "") + fileName;
      await FileSystem.writeAsStringAsync(fileUri, wbout, { encoding: FileSystem.EncodingType.Base64 });
      mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      dialogTitle = `导出 ${month} 薪资报表`;
      break;
    }
    case "payroll_pdf": {
      const html = buildPayrollHtml(params);
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const fileName = `薪资报表_${month}.pdf`;
      fileUri = (FileSystem.cacheDirectory ?? "") + fileName;
      await FileSystem.copyAsync({ from: uri, to: fileUri });
      mimeType = "application/pdf";
      dialogTitle = `导出 ${month} 薪资报表 PDF`;
      break;
    }
    case "schedule_hours_excel": {
      const wb = buildScheduleWorkbook(params, "hours");
      const wbout = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
      const fileName = `排班表_时长_${month}.xlsx`;
      fileUri = (FileSystem.cacheDirectory ?? "") + fileName;
      await FileSystem.writeAsStringAsync(fileUri, wbout, { encoding: FileSystem.EncodingType.Base64 });
      mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      dialogTitle = `导出 ${month} 排班表（时长）`;
      break;
    }
    case "schedule_hours_pdf": {
      const html = buildScheduleHtml(params, "hours");
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const fileName = `排班表_时长_${month}.pdf`;
      fileUri = (FileSystem.cacheDirectory ?? "") + fileName;
      await FileSystem.copyAsync({ from: uri, to: fileUri });
      mimeType = "application/pdf";
      dialogTitle = `导出 ${month} 排班表（时长）PDF`;
      break;
    }
    case "schedule_session_excel": {
      const wb = buildScheduleWorkbook(params, "session");
      const wbout = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
      const fileName = `排班表_班次_${month}.xlsx`;
      fileUri = (FileSystem.cacheDirectory ?? "") + fileName;
      await FileSystem.writeAsStringAsync(fileUri, wbout, { encoding: FileSystem.EncodingType.Base64 });
      mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      dialogTitle = `导出 ${month} 排班表（班次）`;
      break;
    }
    case "schedule_session_pdf": {
      const html = buildScheduleHtml(params, "session");
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const fileName = `排班表_班次_${month}.pdf`;
      fileUri = (FileSystem.cacheDirectory ?? "") + fileName;
      await FileSystem.copyAsync({ from: uri, to: fileUri });
      mimeType = "application/pdf";
      dialogTitle = `导出 ${month} 排班表（班次）PDF`;
      break;
    }
    default:
      throw new Error(`未知导出类型: ${type}`);
  }

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(fileUri, { mimeType, dialogTitle });
  } else {
    throw new Error(`文件已生成：${fileUri}`);
  }
}
