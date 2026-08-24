import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { recipeState, iceSettings } = vi.hoisted(() => ({
  recipeState: { current: null as Record<string, unknown> | null },
  iceSettings: vi.fn(() => ({ ice: {} })),
}));

function primitive(name: string) {
  return ({ children }: { children?: React.ReactNode }) => React.createElement(name, null, children);
}

vi.mock("react-native", () => ({
  Modal: primitive("Modal"),
  ActivityIndicator: primitive("ActivityIndicator"),
  ActionSheetIOS: { showActionSheetWithOptions: vi.fn() },
  Alert: { alert: vi.fn() },
  Platform: { OS: "web" },
  Pressable: primitive("Pressable"),
  ScrollView: primitive("ScrollView"),
  StyleSheet: { create: <T,>(value: T) => value, hairlineWidth: 1 },
  Text: primitive("Text"),
  TextInput: primitive("TextInput"),
  View: primitive("View"),
  Linking: { openSettings: vi.fn() },
}));
vi.mock("expo-haptics", () => ({ impactAsync: vi.fn(), notificationAsync: vi.fn(), ImpactFeedbackStyle: { Light: "light" }, NotificationFeedbackType: { Success: "success" } }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => ({ id: "recipe-1" }) }));
vi.mock("@/components/screen-container", () => ({ ScreenContainer: primitive("ScreenContainer") }));
vi.mock("@/components/star-rating", () => ({ StarRating: primitive("StarRating") }));
vi.mock("@/components/ui/icon-symbol", () => ({ IconSymbol: primitive("IconSymbol") }));
vi.mock("@/components/variant-badge", () => ({ VariantBadge: primitive("VariantBadge") }));
vi.mock("@/components/codex-family-badge", () => ({ CodexFamilyBadge: primitive("CodexFamilyBadge") }));
vi.mock("@/components/lab-origin-badge", () => ({ LabOriginBadge: primitive("LabOriginBadge") }));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ foreground: "#111", muted: "#666", primary: "#06f", success: "#080", error: "#c00", border: "#ddd", surface: "#eee", aiAccent: "#a0f" }) }));
vi.mock("@/hooks/use-network", () => ({ useNetwork: () => ({ isOnline: false }) }));
vi.mock("@/hooks/use-can", () => ({ useCan: () => ({ allowed: false }) }));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ lang: "zh", t: (key: string) => key }) }));
vi.mock("@/lib/utils", () => ({ cn: (...parts: string[]) => parts.filter(Boolean).join(" "), displayNames: (en: string, zh: string) => ({ primary: zh || en, secondary: en && zh ? en : "" }) }));
vi.mock("@/lib/bottles/cost", () => ({ formatAmountAsMl: (value: unknown) => String(value ?? "") }));
vi.mock("@/lib/recipes/smart-cost", () => ({ estimateRecipeCostSmart: () => ({ total: 0, items: [] }) }));
vi.mock("@/lib/recipes/garnish-split", () => ({ estimateGarnishCost: () => ({ total: 0, groups: [], unmatchedNames: [] }), splitGarnish: () => [] }));
vi.mock("@/lib/recipes/auto-add", () => ({ buildAutoAddDrafts: () => [] }));
vi.mock("@/lib/recipes/source-parse", () => ({ parseSource: () => null }));
vi.mock("@/lib/ice/store", () => ({ useIceSettings: iceSettings }));
vi.mock("@/lib/ice/cost", () => ({ estimateIceCost: () => ({ total: 0 }) }));
vi.mock("@/lib/recipes/structure", () => ({ analyzeStructure: () => null, structuralFormula: () => "" }));
vi.mock("@/lib/recipes/ingredient-display", () => ({ ingredientDisplayName: (name: string) => name }));
vi.mock("@/lib/bottles/store", () => ({ useBottleStore: () => ({ bottles: [], addBottle: vi.fn(), updateBottle: vi.fn() }) }));
vi.mock("@/lib/bottles/enrich", () => ({ applyEnrichedToBottle: vi.fn(), enrichQueryName: (name: string) => name, matchEnrichedItem: vi.fn() }));
vi.mock("@/lib/homemade/store", () => ({ useHomemadeStore: () => ({ preps: [] }) }));
vi.mock("@/lib/api/smart-router", () => ({ enrichBottles: vi.fn() }));
vi.mock("@/lib/recipes/smart-link", () => ({ smartLinkIngredient: () => null, smartLinkDisplayName: () => null }));
vi.mock("@/lib/recipes/store", () => ({
  useRecipeStore: () => ({
    getRecipe: () => recipeState.current,
    getCategory: () => null,
    toggleFavorite: vi.fn(), toggleMade: vi.fn(), setRating: vi.fn(), deleteRecipe: vi.fn(), tags: [],
    updateRecipePhoto: vi.fn(), updateRecipe: vi.fn(), removeRecipePhoto: vi.fn(),
  }),
}));
vi.mock("expo-image", () => ({ Image: primitive("Image") }));
vi.mock("expo-image-picker", () => ({ requestCameraPermissionsAsync: vi.fn(), requestMediaLibraryPermissionsAsync: vi.fn(), launchCameraAsync: vi.fn(), launchImageLibraryAsync: vi.fn() }));
vi.mock("expo-image-manipulator", () => ({ manipulateAsync: vi.fn(), SaveFormat: { JPEG: "jpeg" } }));
vi.mock("expo-file-system/legacy", () => ({ cacheDirectory: "/tmp/", getInfoAsync: vi.fn(), makeDirectoryAsync: vi.fn(), copyAsync: vi.fn() }));
vi.mock("@/lib/menu/store", () => ({ useMenuStore: () => ({ groups: [], addEntry: vi.fn() }) }));
vi.mock("@/lib/recipes/types", () => ({ STRENGTH_LABELS: {}, STRENGTH_BAND_LABELS: {}, localizedTagName: (value: string) => value }));
vi.mock("@/lib/settings/card-tags", () => ({ FLAVOR_TAG_DEFAULT_COLORS: {} }));
vi.mock("@/lib/recipes/photo", () => ({ ensureRecipePhotoDirectory: vi.fn() }));

import RecipeDetailScreen from "@/app/recipe/[id]";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("配方详情真实水合稳定性", () => {
  let renderer: ReactTestRenderer | null = null;
  let consoleError: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    recipeState.current = null;
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    if (renderer) await act(async () => { renderer?.unmount(); });
    renderer = null;
    consoleError?.mockRestore();
    consoleError = null;
  });

  it("配方从缺失状态水合为可渲染档案后，冰块设置Hook保持固定顺序", async () => {
    await act(async () => { renderer = create(<RecipeDetailScreen />); });
    expect(renderer?.toJSON()).not.toBeNull();
    expect(iceSettings).toHaveBeenCalledTimes(1);

    recipeState.current = {
      id: "recipe-1", name: "测试配方", nameEn: "Test Recipe", categoryId: "", codexFamily: "", drinkDuration: "", occasion: "",
      flavors: [], baseSpirit: "", glass: "", method: "", ice: "", strength: "", strengthBand: "", abv: null,
      rating: null, ingredients: [], garnish: "", garnishItems: [], photoUris: [], favorite: false, made: false,
      notes: "", steps: "", source: "", sourceRef: "", story: "", flavorDesc: "",
    };
    await act(async () => { renderer?.update(<RecipeDetailScreen />); });

    expect(renderer?.toJSON()).not.toBeNull();
    expect(iceSettings).toHaveBeenCalledTimes(2);
    const errors = consoleError?.mock.calls.flat().join(" ") ?? "";
    expect(errors).not.toContain("Rendered more hooks than during the previous render");
    expect(errors).not.toContain("Rendered fewer hooks than expected");
  });
});
