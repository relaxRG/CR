#!/usr/bin/env python3
"""Patch server/routers.ts to update enrichRecipe with new base spirits and multi-spirit logic."""
import re

with open('server/routers.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update default spirit list fallback
content = content.replace(
    '"金酒、朗姆、伏特加、威士忌、龙舌兰、白兰地、利口酒、无酒精、其他"',
    '"金酒、朗姆、伏特加、威士忌、龙舌兰、白兰地、梅斯卡尔、卡沙萨、皮斯科、利口酒、无酒精、其他"',
    1
)

# 2. Add ingredientsWithAmounts to schema
old_schema = '          ingredients: z.array(z.string().max(200)).max(30).optional(),'
new_schema = (
    '          ingredients: z.array(z.string().max(200)).max(30).optional(),\n'
    '          ingredientsWithAmounts: z.array(z.object({ name: z.string().max(200), amount: z.string().max(100) })).max(30).optional(),'
)
content = content.replace(old_schema, new_schema, 1)

# 3. Update suggestedBaseSpirit prompt to support multi-spirit
old_spirit_prompt = '"推荐基酒（优先从可选基酒列表中选，若列表中没有合适的可自由填写，不确定则返回空字符串）"'
new_spirit_prompt = '"推荐基酒（优先从可选基酒列表中选，若列表中没有合适的可自由填写，不确定则返回空字符串）。若两种烈酒用量相等，用逗号分隔列出所有，如：威士忌,白兰地"'
content = content.replace(old_spirit_prompt, new_spirit_prompt, 1)

# 4. Update prompt to use ingredientsWithAmounts when available
old_ing_line = '${(input.ingredients ?? []).length > 0 ? `配料: ${(input.ingredients ?? []).join(", ")}` : ""}'
new_ing_line = '${(input.ingredientsWithAmounts ?? []).length > 0 ? `配料（含用量，用量最大的含酒精原料即为基酒）: ${(input.ingredientsWithAmounts ?? []).map(i => i.amount ? i.name + " " + i.amount : i.name).join(", ")}` : (input.ingredients ?? []).length > 0 ? `配料: ${(input.ingredients ?? []).join(", ")}` : ""}'
content = content.replace(old_ing_line, new_ing_line, 1)

# 5. Update suggestedBaseSpirit return to handle multi-spirit (comma-separated)
old_return = '          suggestedBaseSpirit: typeof p.suggestedBaseSpirit === "string" ? p.suggestedBaseSpirit.trim() : "",'
new_return = '          suggestedBaseSpirit: typeof p.suggestedBaseSpirit === "string" ? p.suggestedBaseSpirit.trim() : "",\n          isMultiBaseSpirit: typeof p.suggestedBaseSpirit === "string" && p.suggestedBaseSpirit.includes(","),'
content = content.replace(old_return, new_return, 1)

with open('server/routers.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done patching server/routers.ts')
