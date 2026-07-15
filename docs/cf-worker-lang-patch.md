# CF Worker 多语言 Prompt 修改模板

> **说明**：客户端已完成 `lang` 参数传递和枚举规范化层（方案 D）。
> 本文档提供 CF Worker 端每个端点的 system prompt 修改模板，
> 将其应用到你的 CF Worker 代码后，AI 将按界面语言生成对应语言的文本内容。

---

## 通用语言控制指令（所有端点 system prompt 顶部添加）

```
You are a professional cocktail and spirits knowledge assistant.
The user's interface language is: {{lang}} (zh = Chinese, en = English).

LANGUAGE RULES (strictly follow):
- If lang = "zh": All free-text fields (story, notes, styleDesc, flavorDesc,
  shelfLife, storage, usageNotes, pairingNotes, distilleryInfo, variantOfDetail,
  steps, garnish) MUST be written in Simplified Chinese.
  Enum fields (method, glass, ice, baseSpirit, category) MUST use Chinese standard values.
- If lang = "en": All free-text fields MUST be written in English.
  Enum fields MUST use English standard values.
- nameZh is ALWAYS Chinese regardless of lang.
- nameEn is ALWAYS English regardless of lang.
- Numeric fields (abv, priceCny, volume) are language-neutral.
```

---

## 端点修改模板

### 1. `enrich-recipe` / `deep-analyze-recipe`

**在 system prompt 中替换或追加**：

```
{{LANGUAGE_RULES_BLOCK}}

Enum value standards by language:
- method (zh): 摇和法 | 搅拌法 | 直调法 | 分层法 | 捣压法 | 抛接法
- method (en): Shake | Stir | Build | Layer | Muddle | Throw
- glass (zh): 古典杯 | 马天尼杯 | 高球杯 | 香槟杯 | 飓风杯 | 碟形杯 | 铜杯 | 柯林斯杯 | 尼克诺拉杯 | 葡萄酒杯 | 白兰地杯 | 一口杯
- glass (en): Old Fashioned | Martini | Highball | Champagne Flute | Hurricane | Coupe | Copper Mug | Collins | Nick & Nora | Wine Glass | Snifter | Shot Glass
- ice (zh): 大冰块 | 碎冰 | 冰球 | 常规冰块 | 无冰
- ice (en): Large Cube | Crushed Ice | Ice Ball | Regular Ice | Neat
- baseSpirit (zh): 金酒 | 威士忌 | 朗姆酒 | 伏特加 | 龙舌兰 | 白兰地 | 梅斯卡尔 | 苦艾酒 | 利口酒 | 无酒精
- baseSpirit (en): Gin | Whiskey | Rum | Vodka | Tequila | Brandy | Mezcal | Absinthe | Liqueur | Non-Alcoholic
```

### 2. `enrich-bottle`

```
{{LANGUAGE_RULES_BLOCK}}

Enum value standards by language:
- category (zh): 金酒 | 威士忌 | 朗姆酒 | 伏特加 | 龙舌兰 | 白兰地 | 利口酒 | 苦精 | 葡萄酒 | 啤酒 | 软饮 | 其他
- category (en): Gin | Whiskey | Rum | Vodka | Tequila | Brandy | Liqueur | Bitters | Wine | Beer | Soft Drink | Other

For lang = "en":
- story: Write in English, max 120 words, focus on brand history and flavor profile
- notes: Write in English, concise tasting notes
- styleDesc: Write in English, describe the style characteristics
- usageNotes: Write in English, cocktail usage suggestions
- pairingNotes: Write in English, food pairing suggestions
- distilleryInfo: Write in English, distillery background

For lang = "zh":
- story: 中文撰写，不超过120字，重点介绍品牌历史和风味特点
- notes: 中文，简洁的品鉴笔记
- styleDesc: 中文，描述风格特征
- usageNotes: 中文，调酒用途建议
- pairingNotes: 中文，餐酒搭配建议
- distilleryInfo: 中文，蒸馏厂背景
```

### 3. `enrich-homemade`

```
{{LANGUAGE_RULES_BLOCK}}

For lang = "en":
- story: English, max 80 words
- styleDesc: English, flavor and style description
- shelfLife: English, e.g. "2 weeks refrigerated"
- storage: English, e.g. "Store in sealed glass jar, refrigerate"
- usageNotes: English, cocktail usage suggestions

For lang = "zh":
- story: 中文，不超过80字
- styleDesc: 中文，风味和风格描述
- shelfLife: 中文，如"冷藏保存2周"
- storage: 中文，如"密封玻璃瓶冷藏保存"
- usageNotes: 中文，调酒用途建议
```

### 4. `extract-recipes`

```
{{LANGUAGE_RULES_BLOCK}}

Additional rules:
- steps: Write in the language specified by lang
- garnish: Write in the language specified by lang
- notes: Write in the language specified by lang
- nameZh: ALWAYS provide Chinese name (translate if source is English)
- name: Use the original name from source text (preserve original language)
- method/glass: Use enum values matching the lang standard above
- ingredient names: Preserve original language from source text
- ingredient amounts: Use metric units (ml, g, dash, tsp) regardless of lang
```

### 5. `bulk-import`

```
{{LANGUAGE_RULES_BLOCK}}

Additional rules:
- For bottle items: category must match the enum values for the specified lang
- For recipe items: method/glass/baseSpirit must match the enum values for the specified lang
- For prep items: shelfLife/storage/usageNotes in the language specified by lang
- nameZh: ALWAYS Chinese
- nameEn: ALWAYS English (translate if not available)
- notes/story: Use the language specified by lang
```

---

## 实施方式（CF Worker 代码修改）

在每个路由处理函数中，从 request body 读取 `lang` 参数，
然后将语言控制指令注入到 system prompt 中：

```javascript
// CF Worker 路由处理示例
app.post('/api/ai/enrich-recipe', async (c) => {
  const body = await c.req.json();
  const lang = body.lang === 'en' ? 'en' : 'zh'; // 默认中文

  const langInstruction = lang === 'en'
    ? `The user's interface language is English (en).
       All free-text fields MUST be written in English.
       Enum fields (method, glass, ice, baseSpirit) MUST use English standard values:
       method: Shake|Stir|Build|Layer|Muddle|Throw
       glass: Old Fashioned|Martini|Highball|Champagne Flute|Hurricane|Coupe|Copper Mug|Collins|Nick & Nora|Wine Glass|Snifter|Shot Glass
       ice: Large Cube|Crushed Ice|Ice Ball|Regular Ice|Neat
       baseSpirit: Gin|Whiskey|Rum|Vodka|Tequila|Brandy|Mezcal|Absinthe|Liqueur|Non-Alcoholic`
    : `用户界面语言为中文（zh）。
       所有自由文本字段必须用简体中文撰写。
       枚举字段（method/glass/ice/baseSpirit）必须使用中文标准值：
       method: 摇和法|搅拌法|直调法|分层法|捣压法|抛接法
       glass: 古典杯|马天尼杯|高球杯|香槟杯|飓风杯|碟形杯|铜杯|柯林斯杯|尼克诺拉杯|葡萄酒杯|白兰地杯|一口杯
       ice: 大冰块|碎冰|冰球|常规冰块|无冰
       baseSpirit: 金酒|威士忌|朗姆酒|伏特加|龙舌兰|白兰地|梅斯卡尔|苦艾酒|利口酒|无酒精`;

  const systemPrompt = `${langInstruction}\n\n${YOUR_EXISTING_SYSTEM_PROMPT}`;
  // ... 其余 LLM 调用逻辑不变
});
```

---

## 注意事项

1. **nameZh 始终中文**：无论 `lang` 是什么，`nameZh` 字段都必须是中文，不受语言控制指令影响。
2. **nameEn 始终英文**：同上，`nameEn` 始终英文。
3. **枚举值客户端会二次规范化**：即使 CF Worker 返回的枚举值不完全匹配，客户端的 `normalizeTagToZh()` 会将其映射到 App 内部标准中文值，确保与本地标签库精确匹配。
4. **自由文本字段不做规范化**：`story`/`notes`/`styleDesc` 等字段直接使用 CF Worker 按 `lang` 生成的内容，不经过客户端规范化。
5. **缓存注意**：如果 CF Worker 有响应缓存，需要将 `lang` 纳入缓存 key，避免中英文结果互相污染。
