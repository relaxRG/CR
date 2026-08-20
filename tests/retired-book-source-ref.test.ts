import { describe, expect, it } from "vitest";
import { purgeRetiredBookSourceFields } from "@/lib/migrations/retired-book-source-ref";

describe("retired book source fields purge", () => {
  it("removes only retired book metadata from recipe sourceRef records", () => {
    const serialized = JSON.stringify([
      {
        id: "recipe_1",
        name: "Example",
        source: "Manual note",
        ingredients: [{ name: "Gin", amount: "45 ml" }],
        sourceRef: {
          creator: "A bartender",
          createdYear: "2024",
          creatorConfidence: "high",
          sourceUrl: "https://example.com/recipe",
          sourceConfidence: "high",
          bookTitle: "Old title",
          bookAuthor: "Old author",
          publisher: "Old publisher",
          publishYear: "2020",
          pageRef: "p.12",
          chapterTitle: "Old chapter",
          rawText: "retired text",
        },
      },
      { id: "recipe_2", name: "No source ref", ingredients: [] },
    ]);

    const result = purgeRetiredBookSourceFields(serialized);
    expect(result.changedRecipeCount).toBe(1);
    const recipes = JSON.parse(result.serializedRecipes) as Array<Record<string, unknown>>;
    expect(recipes[0]).toMatchObject({
      id: "recipe_1",
      name: "Example",
      source: "Manual note",
      ingredients: [{ name: "Gin", amount: "45 ml" }],
      sourceRef: {
        creator: "A bartender",
        createdYear: "2024",
        creatorConfidence: "high",
        sourceUrl: "https://example.com/recipe",
        sourceConfidence: "high",
      },
    });
    expect(recipes[0].sourceRef).not.toHaveProperty("bookTitle");
    expect(recipes[0].sourceRef).not.toHaveProperty("rawText");
    expect(recipes[1]).toEqual({ id: "recipe_2", name: "No source ref", ingredients: [] });
  });

  it("is idempotent for cleaned, malformed, and non-array snapshots", () => {
    const cleaned = JSON.stringify([{ id: "recipe_1", sourceRef: { creator: "A", sourceUrl: "" } }]);
    expect(purgeRetiredBookSourceFields(cleaned)).toEqual({
      serializedRecipes: cleaned,
      changedRecipeCount: 0,
    });
    expect(purgeRetiredBookSourceFields("not-json")).toEqual({
      serializedRecipes: "not-json",
      changedRecipeCount: 0,
    });
    expect(purgeRetiredBookSourceFields(JSON.stringify({ id: "not-an-array" }))).toEqual({
      serializedRecipes: JSON.stringify({ id: "not-an-array" }),
      changedRecipeCount: 0,
    });
  });
});
