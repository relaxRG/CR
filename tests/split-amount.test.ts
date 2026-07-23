import { describe, expect, it } from "vitest";
import { splitAmount, mergeAmount } from "../lib/units";

describe("splitAmount", () => {
  it("parses plain integer", () => {
    expect(splitAmount("1")).toEqual({ qty: "1", unit: "" });
    expect(splitAmount("30")).toEqual({ qty: "30", unit: "" });
  });

  it("parses decimal number", () => {
    expect(splitAmount("1.5")).toEqual({ qty: "1.5", unit: "" });
    expect(splitAmount("0.5")).toEqual({ qty: "0.5", unit: "" });
    expect(splitAmount("2.25")).toEqual({ qty: "2.25", unit: "" });
  });

  it("treats trailing decimal point as part of qty, not unit (regression)", () => {
    const result = splitAmount("1.");
    expect(result.qty).toBe("1.");
    expect(result.unit).toBe("");
  });

  it("treats trailing comma as part of qty, not unit", () => {
    const result = splitAmount("1,");
    expect(result.qty).toBe("1,");
    expect(result.unit).toBe("");
  });

  it("parses qty + unit", () => {
    expect(splitAmount("1.5 oz")).toEqual({ qty: "1.5", unit: "oz" });
    expect(splitAmount("30 ml")).toEqual({ qty: "30", unit: "ml" });
    expect(splitAmount("2 dash")).toMatchObject({ qty: "2" });
  });

  it("parses trailing decimal point with unit", () => {
    const result = splitAmount("1. oz");
    expect(result.qty).toBe("1.");
    expect(result.unit).toBeTruthy();
  });

  it("parses unicode fraction characters", () => {
    expect(splitAmount("½")).toMatchObject({ qty: "½", unit: "" });
    expect(splitAmount("¼")).toMatchObject({ qty: "¼", unit: "" });
    expect(splitAmount("¾")).toMatchObject({ qty: "¾", unit: "" });
    expect(splitAmount("⅓")).toMatchObject({ qty: "⅓", unit: "" });
  });

  it("parses integer + unicode fraction (e.g. 1½)", () => {
    const result = splitAmount("1½");
    expect(result.qty).toBe("1½");
    expect(result.unit).toBe("");
  });

  it("parses unicode fraction + unit", () => {
    expect(splitAmount("½ oz")).toMatchObject({ qty: "½" });
    expect(splitAmount("¾ oz")).toMatchObject({ qty: "¾" });
  });

  it("parses common decimal shortcuts 1.5 and 2.5", () => {
    expect(splitAmount("1.5")).toEqual({ qty: "1.5", unit: "" });
    expect(splitAmount("2.5")).toEqual({ qty: "2.5", unit: "" });
    expect(splitAmount("1.5 oz")).toMatchObject({ qty: "1.5" });
    expect(splitAmount("2.5 ml")).toMatchObject({ qty: "2.5" });
  });

  it("parses fuzzy-only units", () => {
    expect(splitAmount("适量")).toEqual({ qty: "", unit: "适量" });
    expect(splitAmount("少许")).toEqual({ qty: "", unit: "少许" });
  });

  it("returns empty for empty input", () => {
    expect(splitAmount("")).toEqual({ qty: "", unit: "" });
  });

  it("handles lone decimal point gracefully", () => {
    const result = splitAmount(".");
    expect(typeof result.qty).toBe("string");
    expect(typeof result.unit).toBe("string");
  });
});

describe("mergeAmount", () => {
  it("merges qty and unit", () => {
    expect(mergeAmount("1.5", "oz")).toBe("1.5 oz");
    expect(mergeAmount("30", "ml")).toBe("30 ml");
  });

  it("returns qty alone when unit is empty", () => {
    expect(mergeAmount("1.5", "")).toBe("1.5");
    expect(mergeAmount("1.", "")).toBe("1.");
  });

  it("returns unit alone when qty is empty", () => {
    expect(mergeAmount("", "适量")).toBe("适量");
  });

  it("returns empty string when both are empty", () => {
    expect(mergeAmount("", "")).toBe("");
  });

  it("round-trips with splitAmount for standard inputs", () => {
    const cases = ["1.5 oz", "30 ml", "½ oz", "适量", "1½ oz"];
    for (const c of cases) {
      const { qty, unit } = splitAmount(c);
      const merged = mergeAmount(qty, unit);
      expect(splitAmount(merged)).toEqual(splitAmount(c));
    }
  });
});
