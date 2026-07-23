import { describe, expect, it } from "vitest";
import { parseFlavorDesc, buildFlavorDesc } from "../lib/recipes/flavor-desc";

// ─── buildFlavorDesc ──────────────────────────────────────────────────────────

describe("buildFlavorDesc", () => {
  it("produces correct three-line format", () => {
    const result = buildFlavorDesc("柑橘与草本", "中段转向辛香", "干爽收尾");
    expect(result).toBe("核心基调: 柑橘与草本\n风味演变: 中段转向辛香\n整体质感: 干爽收尾");
  });

  it("skips empty segments", () => {
    expect(buildFlavorDesc("柑橘", "", "")).toBe("核心基调: 柑橘");
    expect(buildFlavorDesc("", "中段辛香", "")).toBe("风味演变: 中段辛香");
    expect(buildFlavorDesc("", "", "干爽")).toBe("整体质感: 干爽");
    expect(buildFlavorDesc("", "", "")).toBe("");
  });

  it("trims whitespace from each segment", () => {
    const result = buildFlavorDesc("  柑橘  ", "  辛香  ", "  干爽  ");
    expect(result).toBe("核心基调: 柑橘\n风味演变: 辛香\n整体质感: 干爽");
  });

  // 防止模板字符串转义回归：确保输出中不含字面量 "${" 文字
  it("does NOT produce literal ${...} in output (template escape regression)", () => {
    const result = buildFlavorDesc("柑橘", "辛香", "干爽");
    expect(result).not.toContain("${");
    expect(result).not.toContain("\\${");
  });

  it("round-trips through parseFlavorDesc", () => {
    const tone = "柑橘与草本";
    const evolution = "中段转向辛香";
    const texture = "干爽收尾";
    const built = buildFlavorDesc(tone, evolution, texture);
    const parsed = parseFlavorDesc(built);
    expect(parsed.tone).toBe(tone);
    expect(parsed.evolution).toBe(evolution);
    expect(parsed.texture).toBe(texture);
  });
});

// ─── parseFlavorDesc ──────────────────────────────────────────────────────────

describe("parseFlavorDesc", () => {
  it("parses standard Chinese-label format", () => {
    const raw = "核心基调: 柑橘\n风味演变: 辛香\n整体质感: 干爽";
    const result = parseFlavorDesc(raw);
    expect(result.tone).toBe("柑橘");
    expect(result.evolution).toBe("辛香");
    expect(result.texture).toBe("干爽");
  });

  it("parses English-label format", () => {
    const raw = "Core profile: Citrus\nFlavor evolution: Spicy mid\nOverall texture: Dry finish";
    const result = parseFlavorDesc(raw);
    expect(result.tone).toBe("Citrus");
    expect(result.evolution).toBe("Spicy mid");
    expect(result.texture).toBe("Dry finish");
  });

  it("accepts full-width colon 「：」", () => {
    const raw = "核心基调：柑橘\n风味演变：辛香\n整体质感：干爽";
    const result = parseFlavorDesc(raw);
    expect(result.tone).toBe("柑橘");
    expect(result.evolution).toBe("辛香");
    expect(result.texture).toBe("干爽");
  });

  it("returns empty strings for empty input", () => {
    expect(parseFlavorDesc("")).toEqual({ tone: "", evolution: "", texture: "" });
    expect(parseFlavorDesc("   ")).toEqual({ tone: "", evolution: "", texture: "" });
  });

  // 容错：旧数据无标签时兜底放入 tone
  it("falls back to tone when no known labels are present (legacy data)", () => {
    const raw = "这是一段没有标签的旧版风味描述文字，直接写的纯文本。";
    const result = parseFlavorDesc(raw);
    expect(result.tone).toBe(raw.trim());
    expect(result.evolution).toBe("");
    expect(result.texture).toBe("");
  });

  it("falls back to tone for multi-line legacy data without labels", () => {
    const raw = "烟熏泥煤\n蜂蜜太妃糖\n长余韵";
    const result = parseFlavorDesc(raw);
    // No known labels → entire raw string goes to tone
    expect(result.tone).toBe(raw.trim());
    expect(result.evolution).toBe("");
    expect(result.texture).toBe("");
  });

  it("does not fall back when at least one label is matched", () => {
    const raw = "核心基调: 柑橘\n这行没有标签";
    const result = parseFlavorDesc(raw);
    expect(result.tone).toBe("柑橘");
    // 未匹配的行不影响其他段
    expect(result.evolution).toBe("");
    expect(result.texture).toBe("");
  });
});
