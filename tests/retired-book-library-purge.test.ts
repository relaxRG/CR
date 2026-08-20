import { describe, expect, it } from "vitest";
import { isRetiredBookStorageKey } from "@/lib/migrations/retired-book-storage";

describe("retired book library purge", () => {
  it("identifies every historical book-library storage namespace for one-time removal", () => {
    expect(isRetiredBookStorageKey("cocktail.books.v1")).toBe(true);
    expect(isRetiredBookStorageKey("books.ch.book_12.0")).toBe(true);
    expect(isRetiredBookStorageKey("cocktail.reader.highlights.v1.book_12")).toBe(true);
    expect(isRetiredBookStorageKey("cocktail.reader.settings.v1.book_12")).toBe(true);
  });

  it("does not remove active recipe, bottle, homemade, labor, or sync data", () => {
    for (const key of [
      "cocktail.recipes",
      "cocktail.bottles",
      "homemade.preps.v1",
      "labor_payslips_v1",
      "cf.sync.deviceToken",
      "monthly_summary.reports.v1",
    ]) {
      expect(isRetiredBookStorageKey(key), key).toBe(false);
    }
  });
});
