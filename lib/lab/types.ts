import { Ingredient } from "../recipes/types";

/** 研发项目状态:构思中 / 试验中 / 已定稿 / 已归档 */
export type LabProjectStatus = "ideation" | "testing" | "finalized" | "archived";

/** 批次结论:keeper 保留方向 / iterate 继续迭代 / reject 否决 */
export type LabVerdict = "keeper" | "iterate" | "reject" | "";

/** 批次配方规格快照(独立于正式配方,定稿时转换为 Recipe) */
export interface LabSpec {
  ingredients: Ingredient[];
  method: string;
  glass: string;
  ice: string;
  garnish: string;
}

/** 变量维度:用量 / 换产品 / 技法 / 冰 / 杯型 / 装饰 / 新增 / 移除 */
export type LabChangeType =
  | "amount"
  | "product"
  | "technique"
  | "ice"
  | "glass"
  | "garnish"
  | "add"
  | "remove";

/** 单个变量标记:批次相对上一版的一处差异 */
export interface LabChange {
  type: LabChangeType;
  /** 涉及的配料名(配料类差异);技法/冰/杯型/装饰差异为空 */
  ingredientName?: string;
  /** 变更前值(新增时为空) */
  from: string;
  /** 变更后值(移除时为空) */
  to: string;
}

/** 研发批次(一次试验版本 v1..vN) */
export interface LabBatch {
  id: string;
  projectId: string;
  /** 版本序号,从 1 开始 */
  seq: number;
  /** 派生自哪个批次(通常上一版);v1 为空 */
  parentBatchId: string;
  spec: LabSpec;
  /** 相对 parent 批次的差异(保存时自动 diff 生成) */
  changes: LabChange[];
  /** 品鉴笔记 */
  tastingNote: string;
  /** 评分 1-10;null 未评分 */
  score: number | null;
  verdict: LabVerdict;
  /** 品鉴时间戳 */
  tastedAt: number;
  createdAt: number;
  updatedAt: number;
}

/** 研发项目 */
export interface LabProject {
  id: string;
  name: string;
  /** 概念目标 / 电梯陈述:想做成什么样的酒 */
  goal: string;
  /** 选用的经典框架模板 id;空表示自由研发 */
  templateId: string;
  /** 从酒单某配方发起时的来源配方 id */
  baseRecipeId: string;
  status: LabProjectStatus;
  /** 定稿后转正生成的正式配方 id */
  finalizedRecipeId: string;
  createdAt: number;
  updatedAt: number;
}

export const LAB_STATUS_ORDER: LabProjectStatus[] = [
  "testing",
  "ideation",
  "finalized",
  "archived",
];

/** 变量维度 chip 配色(浅色/深色通用的柔和色) */
export const LAB_CHANGE_COLORS: Record<LabChangeType, string> = {
  amount: "#3B82F6", // 蓝:用量
  product: "#8B5CF6", // 紫:换产品
  technique: "#F97316", // 橙:技法
  ice: "#6B7280", // 灰:冰
  glass: "#6B7280", // 灰:杯型
  garnish: "#6B7280", // 灰:装饰
  add: "#22C55E", // 绿:新增
  remove: "#EF4444", // 红:移除
};

export function normalizeLabProject(
  p: Partial<LabProject> & Pick<LabProject, "id" | "name">,
): LabProject {
  return {
    goal: "",
    templateId: "",
    baseRecipeId: "",
    status: "ideation",
    finalizedRecipeId: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...p,
  };
}

export function normalizeLabBatch(
  b: Partial<LabBatch> & Pick<LabBatch, "id" | "projectId">,
): LabBatch {
  return {
    seq: 1,
    parentBatchId: "",
    spec: { ingredients: [], method: "", glass: "", ice: "", garnish: "" },
    changes: [],
    tastingNote: "",
    score: null,
    verdict: "",
    tastedAt: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...b,
  };
}
