/**
 * iCost Excel 导入工具
 * 解析 iCost 导出的 .xlsx 文件，映射到备用金 PettyRecord
 * 只使用：日期、类型、金额、一级分类、二级分类、备注
 * 忽略：账户1、账户2、货币、标签
 */
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
// xlsx 是 CommonJS 模块，需要用 require 方式导入
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require("xlsx") as typeof import("xlsx");
import { PettyRecord, PettyCode } from "./petty-store";
import { normalizeImportDate } from "@/lib/import/date-utils";

/** iCost 二级分类 → PettyCode 映射表 */
const ICOST_SUBCAT_MAP: Record<string, PettyCode> = {
  // A 食材
  "A1 牛肉": "A1", "A1 新鲜肉类": "A1",
  "A2 新鲜海鲜": "A2", "A2 海鲜": "A2",
  "A3 各种冻品": "A3", "A3 冻品": "A3", "A4 冻品": "A3",
  "A4 米面粮油": "A4", "A5 粮油": "A4",
  "A5 蔬菜水果": "A5", "A6 蔬菜": "A5", "A7 水果": "A5",
  "A6 牛排": "A6",
  "A7 火腿": "A7", "A9 火腿": "A7",
  "A8 三文鱼": "A8", "A10 三文鱼": "A8",
  "A9 临时采购": "A9", "A11 临时采购": "A9",
  "A10 研发采购": "A10",
  // B 酒水
  "B1 酒水现结": "B1", "B2 烈酒现结": "B1",
  "B2 酒水配料": "B2", "B3 酒水配料": "B2",
  "B3 酒水耗材": "B3", "B4 酒水耗材": "B3", "B5 啤酒": "B1",
  // C 设备
  "C1 厨房设备": "C1", "C2 厨房工具": "C2",
  "C3 吧台设备": "C3", "C4 吧台工具": "C4",
  "C5 前厅硬装": "C5", "C6 前厅软装": "C6",
  // D 员工
  "D1 员工聚餐": "D1", "D2 员工工餐": "D2", "D3 员工福利": "D3",
  // E 设计
  "E1 设计创意": "E1", "E2 图文广告": "E2", "E3 节日采购": "E3",
  // F 包装
  "F1 餐具": "F1", "F2 酒杯": "F2",
  "F3 餐具一次性": "F3", "F4 酒杯一次性": "F4",
  "F5 包装袋": "F5", "F6 杯垫": "F6",
  // G 推广
  "G1 点星": "G1", "G2 大众点评美团": "G2", "G3 小红书": "G3",
  "G4 抖音": "G4", "G5 美团外卖": "G5", "G6 饿了么": "G6",
  // H 差旅
  "H1 餐食探店": "H1", "H2 酒水探店": "H2", "H3 差旅费用": "H3",
  // I 运输
  "I1 闪送、跑腿": "I1", "I1 闪送跑腿": "I1",
  "I2 交通、运输": "I2", "I2 交通运输": "I2",
  "I3 快递": "I3",
  // J 客户
  "J1 客户维护": "J1", "J2 处理客诉": "J2", "J3 会员福利": "J3",
  // K 运维
  "K1 固定兼职": "K1", "K2 日常消耗": "K2", "K3 洗手间消耗": "K3",
  "K4维护维修": "K4", "K4 维护维修": "K4", "K5 消杀工作": "K5",
  "K6 电话网费": "K6", "K7 账号费用": "K7", "K8 其他": "K8",
  "K9 临时兼职": "K9",
  // L 水电
  "L1 上月电费": "L1", "L2 上月水费": "L2",
  // M 房租
  "M1 247房租": "M1", "M2 仓库房租": "M2",
  // N 备用金（收入类）
  "N0 （招商）备用金": "N0", "N0（招商）备用金": "N0",
  "N1（工商）备用金": "N1", "N1 （工商）备用金": "N1",
  "N2（微信）备用金": "N2", "N2 （微信）备用金": "N2",
  "N3 返点": "N3", "N4 充电宝": "N4", "N5 其他": "N5",
};

/** 从二级分类字符串中提取 PettyCode */
function resolveCode(subcat: string): PettyCode | null {
  if (!subcat) return null;
  const trimmed = subcat.trim();
  // 直接匹配
  if (ICOST_SUBCAT_MAP[trimmed]) return ICOST_SUBCAT_MAP[trimmed];
  // 提取开头的字母+数字编码（如 "K6 电话网费" → "K6"）
  const m = trimmed.match(/^([A-Z]\d+)/);
  if (m) {
    const code = m[1] as PettyCode;
    // 验证是否是有效的 PettyCode
    const validCodes = Object.keys(ICOST_SUBCAT_MAP).map((k) => {
      const mm = k.match(/^([A-Z]\d+)/);
      return mm ? mm[1] : null;
    }).filter(Boolean);
    if (validCodes.includes(code)) return code;
  }
  return null;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  skippedRows: { row: number; reason: string; subcat: string }[];
  records: Omit<PettyRecord, "id" | "createdAt">[];
}

/** 选择并解析 iCost Excel 文件 */
export async function importIcostExcel(): Promise<ImportResult | null> {
  // 1. 选择文件
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "*/*",
    ],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  const uri = asset.uri;

  // 2. 读取文件为 base64
  let base64: string;
  try {
    base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch {
    throw new Error("无法读取文件，请确认文件权限");
  }

  // 3. 解析 Excel
  let workbook;
  try {
    workbook = XLSX.read(base64, { type: "base64" });
  } catch {
    throw new Error("文件格式不支持，请使用 iCost 导出的 .xlsx 文件");
  }

  // 4. 取第一个 Sheet
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel 文件为空");
  const sheet = workbook.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (rows.length < 2) throw new Error("文件无数据行");

  // 5. 识别列头
  const header = (rows[0] as string[]).map((h) => String(h).trim());
  const colIdx = {
    date: header.indexOf("日期"),
    type: header.indexOf("类型"),
    amount: header.indexOf("金额"),
    cat1: header.indexOf("一级分类"),
    cat2: header.indexOf("二级分类"),
    note: header.indexOf("备注"),
  };

  if (colIdx.date < 0 || colIdx.amount < 0 || colIdx.cat2 < 0) {
    throw new Error("文件格式不符，缺少「日期」「金额」「二级分类」列");
  }

  // 6. 逐行解析
  const records: Omit<PettyRecord, "id" | "createdAt">[] = [];
  const skippedRows: ImportResult["skippedRows"] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    const rawDate = row[colIdx.date];
    const rawType = colIdx.type >= 0 ? String(row[colIdx.type] ?? "").trim() : "支出";
    const rawAmount = row[colIdx.amount];
    const rawCat2 = colIdx.cat2 >= 0 ? String(row[colIdx.cat2] ?? "").trim() : "";
    const rawNote = colIdx.note >= 0 ? String(row[colIdx.note] ?? "").trim() : "";

    // 跳过空行
    if (!rawDate && !rawAmount) continue;

    // 解析金额（iCost 支出为负数）
    const rawAmtNum = typeof rawAmount === "number" ? rawAmount : parseFloat(String(rawAmount));
    if (isNaN(rawAmtNum) || rawAmtNum === 0) {
      skippedRows.push({ row: i + 1, reason: "金额无效", subcat: rawCat2 });
      continue;
    }
    const amount = Math.abs(rawAmtNum);

    // 解析分类
    const code = resolveCode(rawCat2);
    if (!code) {
      skippedRows.push({ row: i + 1, reason: `无法识别分类「${rawCat2}」`, subcat: rawCat2 });
      continue;
    }

    // 解析日期：无法可靠识别时不允许归入当天。
    const date = normalizeImportDate(rawDate);
    if (!date) {
      skippedRows.push({ row: i + 1, reason: "日期无效", subcat: rawCat2 });
      continue;
    }

    // 支付方式：从类型推断
    const paymentMethod = rawType === "收入" ? "收入" : "银行卡";

    records.push({
      date,
      code,
      amount,
      description: rawNote || rawCat2,
      paymentMethod,
      receiptUri: "",
    });
  }

  return {
    imported: records.length,
    skipped: skippedRows.length,
    skippedRows,
    records,
  };
}
