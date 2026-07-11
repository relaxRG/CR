import { Ingredient } from "../recipes/types";
import { LabChange, LabSpec } from "./types";

const norm = (s: string) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * 批次间自动 diff:对比新旧 spec,生成变量标记列表。
 * 规则:
 * - 同名配料用量不同 → amount
 * - 位置对应(旧被删+新出现且用量相同)视为换产品 → product;
 *   其余旧有新无 → remove,新有旧无 → add
 * - method 不同 → technique;ice/glass/garnish 不同 → 对应类型
 */
export function diffSpecs(prev: LabSpec | null, next: LabSpec): LabChange[] {
  if (!prev) return [];
  const changes: LabChange[] = [];

  const prevIngs = prev.ingredients.filter((i) => norm(i.name));
  const nextIngs = next.ingredients.filter((i) => norm(i.name));

  const matchedPrev = new Set<string>();
  const matchedNext = new Set<string>();

  // 1) 同名配对:用量变化 → amount
  for (const ni of nextIngs) {
    const pi = prevIngs.find((p) => !matchedPrev.has(p.id) && norm(p.name) === norm(ni.name));
    if (pi) {
      matchedPrev.add(pi.id);
      matchedNext.add(ni.id);
      if (norm(pi.amount) !== norm(ni.amount)) {
        changes.push({
          type: "amount",
          ingredientName: ni.name.trim(),
          from: pi.amount.trim(),
          to: ni.amount.trim(),
        });
      }
    }
  }

  // 2) 未配对的旧新配料:同用量视为换产品(同槽位换件)
  const restPrev = prevIngs.filter((p) => !matchedPrev.has(p.id));
  const restNext = nextIngs.filter((n) => !matchedNext.has(n.id));
  for (const ni of restNext) {
    const pi = restPrev.find(
      (p) => !matchedPrev.has(p.id) && norm(p.amount) === norm(ni.amount) && norm(p.amount),
    );
    if (pi) {
      matchedPrev.add(pi.id);
      matchedNext.add(ni.id);
      changes.push({
        type: "product",
        ingredientName: ni.name.trim(),
        from: pi.name.trim(),
        to: ni.name.trim(),
      });
    }
  }

  // 3) 剩余:旧有新无 → remove;新有旧无 → add
  for (const pi of prevIngs) {
    if (matchedPrev.has(pi.id)) continue;
    changes.push({
      type: "remove",
      ingredientName: pi.name.trim(),
      from: `${pi.name.trim()}${pi.amount.trim() ? ` ${pi.amount.trim()}` : ""}`,
      to: "",
    });
  }
  for (const ni of nextIngs) {
    if (matchedNext.has(ni.id)) continue;
    changes.push({
      type: "add",
      ingredientName: ni.name.trim(),
      from: "",
      to: `${ni.name.trim()}${ni.amount.trim() ? ` ${ni.amount.trim()}` : ""}`,
    });
  }

  // 4) 非配料维度
  if (norm(prev.method) !== norm(next.method)) {
    changes.push({ type: "technique", from: prev.method.trim(), to: next.method.trim() });
  }
  if (norm(prev.ice) !== norm(next.ice)) {
    changes.push({ type: "ice", from: prev.ice.trim(), to: next.ice.trim() });
  }
  if (norm(prev.glass) !== norm(next.glass)) {
    changes.push({ type: "glass", from: prev.glass.trim(), to: next.glass.trim() });
  }
  if (norm(prev.garnish) !== norm(next.garnish)) {
    changes.push({ type: "garnish", from: prev.garnish.trim(), to: next.garnish.trim() });
  }

  return changes;
}

/** 对比视图用:按配料行对齐 2-N 个 spec,产出每行各版本的值与差异标记 */
export interface CompareRow {
  /** 行标题(配料名,取首个出现版本的原始写法) */
  label: string;
  /** 每个版本该配料的展示值(名称差异时显示产品名,否则显示用量);null=该版本没有 */
  cells: ({ name: string; amount: string } | null)[];
  /** 此行是否存在版本间差异 */
  differs: boolean;
}

export function buildCompareRows(specs: LabSpec[]): CompareRow[] {
  // 以规范化配料名为键,保持首次出现顺序
  const order: string[] = [];
  const rows = new Map<string, ({ name: string; amount: string } | null)[]>();
  specs.forEach((spec, idx) => {
    for (const ing of spec.ingredients) {
      const key = norm(ing.name);
      if (!key) continue;
      if (!rows.has(key)) {
        rows.set(key, specs.map(() => null));
        order.push(key);
      }
      const cells = rows.get(key)!;
      if (!cells[idx]) cells[idx] = { name: ing.name.trim(), amount: ing.amount.trim() };
    }
  });
  return order.map((key) => {
    const cells = rows.get(key)!;
    const present = cells.filter((c): c is { name: string; amount: string } => c !== null);
    const label = present[0]?.name ?? key;
    const allSame =
      cells.every((c) => c !== null) &&
      present.every((c) => norm(c.amount) === norm(present[0].amount));
    return { label, cells, differs: !allSame };
  });
}

/** 深拷贝 spec 并为配料生成新 id(新批次编辑时使用) */
export function cloneSpec(spec: LabSpec, genId: () => string): LabSpec {
  return {
    ...spec,
    ingredients: spec.ingredients.map((i: Ingredient) => ({ ...i, id: genId() })),
  };
}

