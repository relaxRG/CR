#!/usr/bin/env python3
"""Patch recipe-form.tsx to support multi-spirit selection and confidence UI."""

with open('app/recipe-form.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# ============================================================
# 1. Add spiritConfidence state and aiSuggestedSpirits state
# ============================================================
old1 = '  const [flavorConfidence, setFlavorConfidence] = useState<"high" | "medium" | "low" | null>(null);\n  const [newSpiritTags, setNewSpiritTags] = useState<string[]>([]);'
new1 = '''  const [flavorConfidence, setFlavorConfidence] = useState<"high" | "medium" | "low" | null>(null);
  /** AI 推断基酒的置信度 */
  const [spiritConfidence, setSpiritConfidence] = useState<"high" | "medium" | "low" | null>(null);
  /** AI 推断的基酒列表（用于置信度边框高亮） */
  const [aiSuggestedSpirits, setAiSuggestedSpirits] = useState<string[]>([]);
  const [newSpiritTags, setNewSpiritTags] = useState<string[]>([]);'''
content = content.replace(old1, new1, 1)

# ============================================================
# 2. Update ensureSpiritName to handle comma-separated multi-spirit
# ============================================================
old2 = '''  const ensureSpiritName = (raw: string) => {
    const cleaned = raw.trim();
    if (!cleaned) return "";
    const hit = spiritNames.find((s) => cleaned.includes(s) || s.includes(cleaned));
    if (hit) return hit;
    const created = addTag("spirit", cleaned, CATEGORY_COLORS[0]);
    const nextName = created?.name ?? cleaned;
    setNewSpiritTags((prev) => (prev.includes(nextName) ? prev : [...prev, nextName]));
    return nextName;
  };'''
new2 = '''  const ensureSpiritName = (raw: string) => {
    const cleaned = raw.trim();
    if (!cleaned) return "";
    const hit = spiritNames.find((s) => cleaned.includes(s) || s.includes(cleaned));
    if (hit) return hit;
    const created = addTag("spirit", cleaned, CATEGORY_COLORS[0]);
    const nextName = created?.name ?? cleaned;
    setNewSpiritTags((prev) => (prev.includes(nextName) ? prev : [...prev, nextName]));
    return nextName;
  };

  /** 处理 AI 返回的基酒（支持逗号分隔多基酒），返回逗号分隔的规范化名称 */
  const resolveAiSpirits = (raw: string): string => {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const resolved = parts.map((p) => {
      const hit = spiritNames.find((s) => p.includes(s) || s.includes(p));
      if (hit) return hit;
      // 尝试创建新标签（仅当不是品牌名时）
      const created = addTag("spirit", p, CATEGORY_COLORS[0]);
      const nextName = created?.name ?? p;
      setNewSpiritTags((prev) => (prev.includes(nextName) ? prev : [...prev, nextName]));
      return nextName;
    });
    return resolved.join(",");
  };'''
content = content.replace(old2, new2, 1)

# ============================================================
# 3. Update handleAiEnrich to pass ingredientsWithAmounts and handle multi-spirit
# ============================================================
old3 = '''    const ingNames = ingredients.map((i) => i.name).filter(Boolean);
    enrichRecipeMutation.mutate(
      {
        name: recipeName,
        nameEn: nameEn.trim() || undefined,
        baseSpirit: baseSpirit || undefined,
        ingredients: ingNames.length > 0 ? ingNames : undefined,
        source: source.trim() || undefined,
        story: story.trim() || undefined,
        flavorDesc: flavorDesc.trim() || undefined,
        method: method || undefined,
        existingSpirits: spiritNames,
        existingGlasses: glassNames,
      },
      {
        onSuccess: (result) => {
          if (!isMountedRef.current) return;
          if (!baseSpirit && result.suggestedBaseSpirit && result.suggestedBaseSpiritConfidence === "high") {
            const nextName = ensureSpiritName(result.suggestedBaseSpirit);
            if (nextName) setBaseSpirit(nextName);
          }
          if (!glass && result.suggestedGlass && result.suggestedGlassConfidence === "high") {
            const nextName = ensureGlassName(result.suggestedGlass);
            if (nextName) setGlass(nextName);
          }
          if (!ice && result.suggestedIce && result.suggestedIceConfidence === "high") {
            const nextName = normalizeIceName(result.suggestedIce);
            if ((ICE_TYPES as readonly string[]).includes(nextName)) setIce(nextName);
          }
          setAiResult(result);
          setAiEnriching(false);
        },
        onError: (err: unknown) => {
          if (!isMountedRef.current) return;
          setAiEnriching(false);
          const msg = err instanceof Error ? err.message : "AI 分析失败，请重试";
          Alert.alert("AI 补全失败", msg);
        },
      },
    );
  };'''
new3 = '''    const ingNames = ingredients.map((i) => i.name).filter(Boolean);
    const ingWithAmounts = ingredients.filter((i) => i.name.trim()).map((i) => ({ name: i.name, amount: i.amount }));
    enrichRecipeMutation.mutate(
      {
        name: recipeName,
        nameEn: nameEn.trim() || undefined,
        baseSpirit: baseSpirit || undefined,
        ingredients: ingNames.length > 0 ? ingNames : undefined,
        ingredientsWithAmounts: ingWithAmounts.length > 0 ? ingWithAmounts : undefined,
        source: source.trim() || undefined,
        story: story.trim() || undefined,
        flavorDesc: flavorDesc.trim() || undefined,
        method: method || undefined,
        existingSpirits: spiritNames,
        existingGlasses: glassNames,
      },
      {
        onSuccess: (result) => {
          if (!isMountedRef.current) return;
          if (!baseSpirit && result.suggestedBaseSpirit) {
            const conf = result.suggestedBaseSpiritConfidence ?? "medium";
            const resolved = resolveAiSpirits(result.suggestedBaseSpirit);
            const spirits = resolved.split(",").map(s => s.trim()).filter(Boolean);
            setSpiritConfidence(conf);
            setAiSuggestedSpirits(spirits);
            if (conf === "high") {
              setBaseSpirit(resolved);
            }
          }
          if (!glass && result.suggestedGlass && result.suggestedGlassConfidence === "high") {
            const nextName = ensureGlassName(result.suggestedGlass);
            if (nextName) setGlass(nextName);
          }
          if (!ice && result.suggestedIce && result.suggestedIceConfidence === "high") {
            const nextName = normalizeIceName(result.suggestedIce);
            if ((ICE_TYPES as readonly string[]).includes(nextName)) setIce(nextName);
          }
          setAiResult(result);
          setAiEnriching(false);
        },
        onError: (err: unknown) => {
          if (!isMountedRef.current) return;
          setAiEnriching(false);
          const msg = err instanceof Error ? err.message : "AI 分析失败，请重试";
          Alert.alert("AI 补全失败", msg);
        },
      },
    );
  };'''
content = content.replace(old3, new3, 1)

# ============================================================
# 4. Update auto-trigger useEffect to pass ingredientsWithAmounts and handle multi-spirit
# ============================================================
old4 = '''    const ingNames = ingredients.map((i) => i.name).filter(Boolean);
    enrichRecipeMutation.mutate(
      {
        name: recipeName,
        nameEn: nameEn.trim() || undefined,
        baseSpirit: baseSpirit || undefined,
        ingredients: ingNames.length > 0 ? ingNames : undefined,
        method: method || undefined,
        existingSpirits: spiritNames,
        existingGlasses: glassNames,
      },
      {
        onSuccess: (result) => {
          if (!isMountedRef.current) return;
          if (result.flavors && result.flavors.length > 0) {
            setFlavors(result.flavors);
            const conf = result.flavorConfidence ?? result.confidence ?? "medium";
            setFlavorConfidence(conf);
          }
          if (!baseSpirit && result.suggestedBaseSpirit && result.suggestedBaseSpiritConfidence === "high") {
            const nextName = ensureSpiritName(result.suggestedBaseSpirit);
            if (nextName) setBaseSpirit(nextName);
          }
          if (!glass && result.suggestedGlass && result.suggestedGlassConfidence === "high") {
            const nextName = ensureGlassName(result.suggestedGlass);
            if (nextName) setGlass(nextName);
          }
          if (!ice && result.suggestedIce && result.suggestedIceConfidence === "high") {
            const nextName = normalizeIceName(result.suggestedIce);
            if ((ICE_TYPES as readonly string[]).includes(nextName)) setIce(nextName);
          }
          // 同时存入 aiResult，供用户按需应用故事/来源等字段
          if (
            result.story ||
            result.flavorDesc ||
            result.source ||
            result.suggestedBaseSpirit ||
            result.suggestedGlass ||
            result.suggestedIce
          ) {
            setAiResult(result);
          }
        },
        onError: (err: unknown) => {
          if (!isMountedRef.current) return;
          const msg = err instanceof Error ? err.message : "AI 分析失败";
          // Silently ignore auto-trigger errors (non-blocking)
          console.warn("[AutoFlavor] AI enrich failed:", msg);
        },
      },
    );'''
new4 = '''    const ingNames = ingredients.map((i) => i.name).filter(Boolean);
    const ingWithAmounts = ingredients.filter((i) => i.name.trim()).map((i) => ({ name: i.name, amount: i.amount }));
    enrichRecipeMutation.mutate(
      {
        name: recipeName,
        nameEn: nameEn.trim() || undefined,
        baseSpirit: baseSpirit || undefined,
        ingredients: ingNames.length > 0 ? ingNames : undefined,
        ingredientsWithAmounts: ingWithAmounts.length > 0 ? ingWithAmounts : undefined,
        method: method || undefined,
        existingSpirits: spiritNames,
        existingGlasses: glassNames,
      },
      {
        onSuccess: (result) => {
          if (!isMountedRef.current) return;
          if (result.flavors && result.flavors.length > 0) {
            setFlavors(result.flavors);
            const conf = result.flavorConfidence ?? result.confidence ?? "medium";
            setFlavorConfidence(conf);
          }
          if (!baseSpirit && result.suggestedBaseSpirit) {
            const conf = result.suggestedBaseSpiritConfidence ?? "medium";
            const resolved = resolveAiSpirits(result.suggestedBaseSpirit);
            const spirits = resolved.split(",").map(s => s.trim()).filter(Boolean);
            setSpiritConfidence(conf);
            setAiSuggestedSpirits(spirits);
            if (conf === "high") {
              setBaseSpirit(resolved);
            }
          }
          if (!glass && result.suggestedGlass && result.suggestedGlassConfidence === "high") {
            const nextName = ensureGlassName(result.suggestedGlass);
            if (nextName) setGlass(nextName);
          }
          if (!ice && result.suggestedIce && result.suggestedIceConfidence === "high") {
            const nextName = normalizeIceName(result.suggestedIce);
            if ((ICE_TYPES as readonly string[]).includes(nextName)) setIce(nextName);
          }
          // 同时存入 aiResult，供用户按需应用故事/来源等字段
          if (
            result.story ||
            result.flavorDesc ||
            result.source ||
            result.suggestedBaseSpirit ||
            result.suggestedGlass ||
            result.suggestedIce
          ) {
            setAiResult(result);
          }
        },
        onError: (err: unknown) => {
          if (!isMountedRef.current) return;
          const msg = err instanceof Error ? err.message : "AI 分析失败";
          // Silently ignore auto-trigger errors (non-blocking)
          console.warn("[AutoFlavor] AI enrich failed:", msg);
        },
      },
    );'''
content = content.replace(old4, new4, 1)

# ============================================================
# 5. Update applyAiResult to handle multi-spirit
# ============================================================
old5 = '''    if (!baseSpirit && aiResult.suggestedBaseSpirit) {
      const nextName = ensureSpiritName(aiResult.suggestedBaseSpirit);
      if (nextName) setBaseSpirit(nextName);
    }'''
new5 = '''    if (!baseSpirit && aiResult.suggestedBaseSpirit) {
      const resolved = resolveAiSpirits(aiResult.suggestedBaseSpirit);
      if (resolved) {
        setBaseSpirit(resolved);
        setSpiritConfidence(null);
        setAiSuggestedSpirits([]);
      }
    }'''
content = content.replace(old5, new5, 1)

# ============================================================
# 6. Replace ChipGroup for base spirit with MultiSpiritChipGroup
# ============================================================
old6 = '''          {/* Base spirit */}
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("form.spirit")}</Text>
          {spiritNames.length > 0 ? (
            <ChipGroup
              options={spiritNames}
              value={baseSpirit}
              onChange={setBaseSpirit}
              colorsMap={spiritColors}
              newTags={newSpiritTags}
              labelOf={(v) => {
                const tag = spiritTags.find((tg) => tg.name === v);
                return localizedTagName(v, tag?.nameEn, lang);
              }}
            />
          ) : (
            <Text className="text-xs text-muted">{t("form.noSpirit")}</Text>
          )}'''
new6 = '''          {/* Base spirit */}
          <View className="flex-row items-center justify-between mt-5 mb-1.5">
            <Text className="text-sm font-medium text-muted">{t("form.spirit")}</Text>
            {spiritConfidence !== null && (
              <View className="flex-row items-center" style={{ gap: 4 }}>
                <IconSymbol
                  name="sparkles"
                  size={12}
                  color={spiritConfidence === "high" ? colors.success : spiritConfidence === "medium" ? "#FF9500" : "#FF6B35"}
                />
                <Text className="text-xs" style={{ color: spiritConfidence === "high" ? colors.success : spiritConfidence === "medium" ? "#FF9500" : "#FF6B35" }}>
                  {spiritConfidence === "high"
                    ? (lang === "zh" ? "AI 已标注" : "AI tagged")
                    : spiritConfidence === "medium"
                      ? (lang === "zh" ? "AI 推断，请确认" : "AI inferred, please confirm")
                      : (lang === "zh" ? "置信度低，请手动选择" : "Low confidence, please select")}
                </Text>
              </View>
            )}
          </View>
          {/* 多基酒提示 */}
          {baseSpirit && baseSpirit.includes(",") && (
            <View
              className="flex-row items-start rounded-xl px-3 py-2 mb-2"
              style={{ backgroundColor: "#007AFF15", borderWidth: 1, borderColor: "#007AFF44", gap: 8 }}
            >
              <IconSymbol name="info.circle" size={14} color="#007AFF" style={{ marginTop: 1 }} />
              <Text className="text-xs flex-1" style={{ color: "#007AFF", lineHeight: 18 }}>
                {lang === "zh"
                  ? `多基酒配方：${baseSpirit.split(",").join(" + ")}，用量相等，已全部标注。`
                  : `Multi-spirit recipe: ${baseSpirit.split(",").join(" + ")} in equal parts.`}
              </Text>
            </View>
          )}
          {/* 低置信度警告横幅 */}
          {spiritConfidence === "low" && (
            <View
              className="flex-row items-start rounded-xl px-3 py-2 mb-2"
              style={{ backgroundColor: "#FF6B3515", borderWidth: 1, borderColor: "#FF6B3544", gap: 8 }}
            >
              <IconSymbol name="exclamationmark.triangle" size={14} color="#FF6B35" style={{ marginTop: 1 }} />
              <Text className="text-xs flex-1" style={{ color: "#FF6B35", lineHeight: 18 }}>
                {lang === "zh"
                  ? "未找到可靠信息，请手动选择基酒。"
                  : "No reliable info found. Please select base spirit manually."}
              </Text>
              <Pressable onPress={() => setSpiritConfidence(null)} hitSlop={8}>
                <IconSymbol name="xmark" size={12} color="#FF6B35" />
              </Pressable>
            </View>
          )}
          {spiritNames.length > 0 ? (
            <MultiSpiritChipGroup
              options={spiritNames}
              value={baseSpirit}
              onChange={(v) => {
                setBaseSpirit(v);
                // User manually changed → clear AI confidence indicator
                setSpiritConfidence(null);
                setAiSuggestedSpirits([]);
              }}
              colorsMap={spiritColors}
              newTags={newSpiritTags}
              labelOf={(v) => {
                const tag = spiritTags.find((tg) => tg.name === v);
                return localizedTagName(v, tag?.nameEn, lang);
              }}
              aiConfidence={spiritConfidence}
              aiSuggestedSpirits={aiSuggestedSpirits}
            />
          ) : (
            <Text className="text-xs text-muted">{t("form.noSpirit")}</Text>
          )}'''
content = content.replace(old6, new6, 1)

with open('app/recipe-form.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done patching recipe-form.tsx')
