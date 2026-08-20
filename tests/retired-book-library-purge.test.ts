import { describe, expect, it, vi } from "vitest";
import { purgeRetiredBookStorage } from "@/lib/migrations/retired-book-cleaner-core";
import { isRetiredBookStorageKey } from "@/lib/migrations/retired-book-storage";

describe("retired book library purge", () => {
  it("identifies every historical book-library storage namespace for one-time removal", () => {
    expect(isRetiredBookStorageKey("cocktail.books.v1")).toBe(true);
    expect(isRetiredBookStorageKey("books.ch.book_12.0")).toBe(true);
    expect(isRetiredBookStorageKey("cocktail.reader.highlights.v1.book_12")).toBe(true);
    expect(isRetiredBookStorageKey("cocktail.reader.settings.v1.book_12")).toBe(true);
  });

  it("does not remove active recipe, bottle, homemade, labor, inventory, or sync data", () => {
    for (const key of [
      "cocktail.recipes",
      "cocktail.bottles",
      "homemade.preps.v1",
      "labor_payslips_v1",
      "cf.sync.deviceToken",
      "monthly_summary.reports.v1",
      "wine.bottles.v1",
      "store.petty.v1",
    ]) {
      expect(isRetiredBookStorageKey(key), key).toBe(false);
    }
  });

  it("physically removes only matched keys and the retired directory", async () => {
    const multiRemove = vi.fn().mockResolvedValue(undefined);
    const deleteRetiredDirectory = vi.fn().mockResolvedValue(undefined);
    const result = await purgeRetiredBookStorage({
      getAllKeys: vi.fn().mockResolvedValue([
        "cocktail.recipes",
        "cocktail.books.v1",
        "books.ch.book_4.2",
        "cocktail.reader.highlights.v1.book_4",
        "labor_payslips_v1",
      ]),
      multiRemove,
      deleteRetiredDirectory,
    });

    expect(multiRemove).toHaveBeenCalledTimes(1);
    expect(multiRemove).toHaveBeenCalledWith([
      "cocktail.books.v1",
      "books.ch.book_4.2",
      "cocktail.reader.highlights.v1.book_4",
    ]);
    expect(deleteRetiredDirectory).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ removedStorageKeys: 3, directoryDeleteFailed: false });
  });

  it("is idempotent when no legacy key remains and leaves unrelated data untouched", async () => {
    const multiRemove = vi.fn().mockResolvedValue(undefined);
    const result = await purgeRetiredBookStorage({
      getAllKeys: vi.fn().mockResolvedValue(["cocktail.recipes", "labor_payslips_v1"]),
      multiRemove,
    });

    expect(multiRemove).not.toHaveBeenCalled();
    expect(result).toEqual({ removedStorageKeys: 0, directoryDeleteFailed: false });
  });

  it("records a directory deletion failure without blocking a future safe retry", async () => {
    const result = await purgeRetiredBookStorage({
      getAllKeys: vi.fn().mockResolvedValue([]),
      multiRemove: vi.fn().mockResolvedValue(undefined),
      deleteRetiredDirectory: vi.fn().mockRejectedValue(new Error("disk unavailable")),
    });

    expect(result).toEqual({ removedStorageKeys: 0, directoryDeleteFailed: true });
  });
});
