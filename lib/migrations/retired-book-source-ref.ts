const RETIRED_SOURCE_REF_FIELDS = [
  "bookTitle",
  "bookAuthor",
  "publisher",
  "publishYear",
  "pageRef",
  "chapterTitle",
  "rawText",
] as const;

export type RetiredSourceRefPurgeResult = {
  serializedRecipes: string;
  changedRecipeCount: number;
};

/**
 * 从旧配方快照中移除已退役书库专属字段。
 * 仅重写 sourceRef 对象，其他配方内容及其未知扩展字段均原样保留。
 */
export function purgeRetiredBookSourceFields(serializedRecipes: string): RetiredSourceRefPurgeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedRecipes);
  } catch {
    return { serializedRecipes, changedRecipeCount: 0 };
  }
  if (!Array.isArray(parsed)) return { serializedRecipes, changedRecipeCount: 0 };

  let changedRecipeCount = 0;
  const next = parsed.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const recipe = entry as Record<string, unknown>;
    const sourceRef = recipe.sourceRef;
    if (!sourceRef || typeof sourceRef !== "object" || Array.isArray(sourceRef)) return entry;

    const nextSourceRef = { ...(sourceRef as Record<string, unknown>) };
    let changed = false;
    for (const field of RETIRED_SOURCE_REF_FIELDS) {
      if (field in nextSourceRef) {
        delete nextSourceRef[field];
        changed = true;
      }
    }
    if (!changed) return entry;

    changedRecipeCount += 1;
    return { ...recipe, sourceRef: nextSourceRef };
  });

  return changedRecipeCount > 0
    ? { serializedRecipes: JSON.stringify(next), changedRecipeCount }
    : { serializedRecipes, changedRecipeCount: 0 };
}
