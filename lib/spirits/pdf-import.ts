/**
 * PDF 进货单导入解析工具
 *
 * 流程：
 * 1. 用户选择 PDF 文件
 * 2. 将 PDF 转为 base64
 * 3. 调用 LLM（gemini-3-flash-preview，支持 PDF/图片输入，成本低）解析内容
 * 4. LLM 输出结构化 JSON（进货记录列表）
 * 5. 返回与 Excel 导入相同格式的 ParsedPurchaseRow[]
 *
 * 注意：PDF 解析在移动端通过 API 调用实现，不在本地处理
 * API 端点：/api/parse-invoice（需要在 server 端实现）
 */

import { ParsedPurchaseRow, ExcelImportResult, guessCategory } from "./excel-import";
import { getImportMonth, normalizeImportDate } from "@/lib/import/date-utils";

export interface PdfParseRequest {
  pdfBase64: string;
  fileName?: string;
  supplierHint?: string;
}

export interface PdfParseResponse {
  success: boolean;
  rows: ParsedPurchaseRow[];
  month: string;
  supplier?: string;
  totalAmount: number;
  rawText?: string;  // LLM 提取的原始文本，用于调试
  errors: string[];
  warnings: string[];
}

/**
 * LLM 解析 PDF 进货单的 System Prompt
 * 专门针对中国酒类供应商进货单格式优化
 */
export const PDF_PARSE_SYSTEM_PROMPT = `你是一个专业的进货单数据提取助手，专门处理中国酒吧/餐厅的酒类进货单。

你的任务是从 PDF 进货单中提取所有进货记录，输出严格的 JSON 格式。

进货单通常包含以下信息：
- 供应商/客户名称（第一行或标题）
- 表格数据：日期、商品名称、单位、数量、单价、金额

商品名称格式（常见）：
- "中文名/英文名"（如：添加利金酒Tanqueray Gin）
- "中文名（备注）英文名"（如：白占边（金宾波本）/Jim Beam White）
- 纯中文名（如：堂白白酒）
- 纯英文名（如：Aperol）

输出格式（严格 JSON）：
{
  "supplier": "供应商名称（如果能识别）",
  "rows": [
    {
      "date": "YYYY-MM-DD",
      "rawName": "完整原始商品名",
      "nameZh": "中文名",
      "nameEn": "英文名",
      "unit": "单位（瓶/箱/罐等）",
      "quantity": 数量（数字）,
      "unitPrice": 单价（数字）,
      "amount": 金额（数字）
    }
  ],
  "totalAmount": 总金额（数字）
}

规则：
1. 跳过合计行、空行、表头行
2. 日期格式统一为 YYYY-MM-DD
3. 如果某行日期缺失，使用最近一行的日期
4. 数量、单价、金额必须是数字（不含货币符号）
5. 如果金额=0但有数量和单价，自动计算金额=数量×单价
6. 保留完整的原始商品名（rawName），不要截断
7. 如果无法识别供应商，supplier 设为 null`;

/**
 * 通过 API 解析 PDF 进货单
 * 需要 server 端的 /api/parse-invoice 端点支持
 */
export async function parsePdfInvoice(
  pdfBase64: string,
  options: { fileName?: string; supplierHint?: string; apiBaseUrl?: string } = {}
): Promise<PdfParseResponse> {
  const apiUrl = options.apiBaseUrl ?? "";

  try {
    const response = await fetch(`${apiUrl}/api/parse-invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pdfBase64,
        fileName: options.fileName,
        supplierHint: options.supplierHint,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return {
        success: false, rows: [], month: "", totalAmount: 0,
        errors: [`API 请求失败 (${response.status}): ${errText}`], warnings: [],
      };
    }

    const data = await response.json();
    return data as PdfParseResponse;
  } catch (e) {
    return {
      success: false, rows: [], month: "", totalAmount: 0,
      errors: [`网络请求失败: ${String(e)}`], warnings: [],
    };
  }
}

/**
 * 将 LLM 返回的原始 JSON 转换为标准 ParsedPurchaseRow[]
 */
export function normalizeLLMRows(
  llmData: any,
  supplierHint?: string
): ExcelImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!llmData || !Array.isArray(llmData.rows)) {
    return { rows: [], month: "", totalAmount: 0, errors: ["LLM 返回数据格式错误"], warnings };
  }

  const supplier = llmData.supplier ?? supplierHint;
  const rows: ParsedPurchaseRow[] = [];
  const monthCounts: Record<string, number> = {};
  let lastValidDate = "";

  for (const item of llmData.rows) {
    const rawName = String(item.rawName ?? item.name ?? "").trim();
    if (!rawName) continue;

    const rawDate = item.date;
    const parsedDate = normalizeImportDate(rawDate);
    const hasDateValue = rawDate !== null && rawDate !== undefined && String(rawDate).trim() !== "";
    if (hasDateValue && !parsedDate) {
      warnings.push(`「${rawName}」日期无法识别，已跳过`);
      continue;
    }
    const date = parsedDate ?? lastValidDate;
    if (!date) {
      warnings.push(`「${rawName}」缺少可继承的有效日期，已跳过`);
      continue;
    }
    if (parsedDate) lastValidDate = parsedDate;
    const month = getImportMonth(date);
    if (!month) {
      warnings.push(`「${rawName}」月份无法识别，已跳过`);
      continue;
    }
    monthCounts[month] = (monthCounts[month] ?? 0) + 1;

    const quantity = Number(item.quantity) || 1;
    const unitPrice = Number(item.unitPrice ?? item.unit_price ?? item.price) || 0;
    let amount = Number(item.amount ?? item.total) || 0;
    if (amount === 0 && quantity > 0 && unitPrice > 0) amount = quantity * unitPrice;

    rows.push({
      date, month, rawName,
      nameZh: String(item.nameZh ?? item.name_zh ?? "").trim(),
      nameEn: String(item.nameEn ?? item.name_en ?? "").trim(),
      unit: String(item.unit ?? "瓶").trim() || "瓶",
      quantity, unitPrice, amount, supplier,
      category: guessCategory(rawName),
    });
  }

  const mainMonth = Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);

  return { rows, month: mainMonth, supplier, totalAmount, errors, warnings };
}
