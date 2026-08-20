import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getSpiritGroupDisplayName,
  getSpiritGroupKeywords,
  getSpiritGroupLegacyName,
  type SpiritGroupDef,
} from "@/lib/spirits/crud-store";

const storeSource = readFileSync("lib/spirits/crud-store.tsx", "utf8");
const workspaceSource = readFileSync("components/inventory/SpiritsInventoryWorkspaceScreen.tsx", "utf8");

const pernod: SpiritGroupDef = {
  id: "group_pernod",
  nameZh: "保乐力加",
  nameEn: "Pernod Ricard",
  keywordsZh: ["芝华士", "百龄坛"],
  keywordsEn: ["Chivas", "Ballantine's"],
  color: "#1D4ED8",
  builtin: true,
  createdAt: "2026-08-21T00:00:00.000Z",
};

describe("烈酒集团管理双语与删除规则", () => {
  it("中文名和英文名是同一集团的关联字段，而不是拼接成单个显示字符串", () => {
    expect(getSpiritGroupDisplayName(pernod)).toBe("保乐力加");
    expect(getSpiritGroupLegacyName(pernod)).toBe("保乐力加 (Pernod Ricard)");
    expect(getSpiritGroupKeywords(pernod)).toEqual(["芝华士", "百龄坛", "Chivas", "Ballantine's"]);
    expect(storeSource).toContain("nameZh: string");
    expect(storeSource).toContain("nameEn: string");
    expect(storeSource).toContain("keywordsZh: string[]");
    expect(storeSource).toContain("keywordsEn: string[]");
  });

  it("恢复旧数据时将旧的混合名称和关键词迁移为双语字段，并保留删除后的已保存列表", () => {
    expect(storeSource).toContain("splitLegacyGroupName");
    expect(storeSource).toContain("splitLegacyKeywords");
    expect(storeSource).toContain("normalizeSpiritGroup");
    expect(storeSource).toContain("const hasKeywordsZh = Array.isArray(raw.keywordsZh)");
    expect(storeSource).toContain("const hasKeywordsEn = Array.isArray(raw.keywordsEn)");
    expect(storeSource).toContain("首次安装才提供预置集团");
    expect(storeSource).toContain("Array.isArray(parsedGroups)");
    expect(storeSource).not.toContain("const mergedGroups = BUILTIN_GROUPS.map");
  });

  it("预置和自定义集团均有删除入口，删除时清理酒款、采购记录和匹配记忆中的悬挂归属", () => {
    expect(workspaceSource).toContain("删除「${groupName}」后，已手动归属的酒款和采购记录会恢复为未分配");
    expect(workspaceSource).toContain("{editId && (");
    expect(workspaceSource).not.toContain("{editId && !editBuiltin && (");
    expect(storeSource).toContain("groups: state.groups.filter((entry) => entry.id !== action.id)");
    expect(storeSource).toContain("items: state.items.map((item) => names.has(item.group ?? \"\")");
    expect(storeSource).toContain("purchases: state.purchases.map((purchase) => names.has(purchase.group ?? \"\")");
    expect(storeSource).toContain("groupMatchMemory: state.groupMatchMemory.filter((memory) => !names.has(memory.groupName))");
    expect(storeSource).not.toContain('type: "MERGE_GROUP"');
  });

  it("集团编辑页分别维护中文与英文品牌关键词，列表页按中文主名和英文副名展示", () => {
    expect(workspaceSource).toContain(">中文名</Text>");
    expect(workspaceSource).toContain(">英文名</Text>");
    expect(workspaceSource).toContain("中文品牌关键词");
    expect(workspaceSource).toContain("English brand keywords");
    expect(workspaceSource).toContain("中文：{g.keywordsZh.slice");
    expect(workspaceSource).toContain("English: {g.keywordsEn.slice");
  });
});
