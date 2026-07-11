import AsyncStorage from "@react-native-async-storage/async-storage";
import { notifySyncChange } from "../sync/engine";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { buildDefaultCategories, buildSampleRecipes } from "./seed";
import { estimateRecipeAbv } from "./abv";
import { classifyRecipe, inferDrinkDuration, inferOccasion } from "./classify";
import { inferVariantOf, inferCodexFamily } from "./lineage";
import {
  WALDORF_DATASET_KEY,
  buildWaldorfCategories,
  buildWaldorfRecipes,
} from "./waldorf";
import {
  Category,
  Recipe,
  TagGroup,
  TagItem,
  TagKind,
  autoFillTagNames,
  buildDefaultTags,
  genId,
  migrateTagNameEn,
  normalizeRecipe,
} from "./types";

const RECIPES_KEY = "cocktail.recipes";
const CATEGORIES_KEY = "cocktail.categories";
const SEEDED_KEY = "cocktail.seeded";
const TAGS_KEY = "cocktail.tags";
const TAG_GROUPS_KEY = "cocktail.tagGroups";

export interface RecipeDraft {
  name: string;
  /** 英文名(独立字段,可空) */
  nameEn?: string;
  categoryId: string | null;
  baseSpirit: string;
  glass: string;
  method: string;
  /** 冰块类型(可选,空字符串未选择) */
  ice?: string;
  strength: Recipe["strength"];
  strengthBand?: Recipe["strengthBand"];
  /** 自动计算的成品酒精度(%),null 表示无法计算 */
  abv?: Recipe["abv"];
  /** 评分(1-10 整数,可空) */
  rating?: number | null;
  variantOf: string;
  codexFamily: string;
  flavors: string[];
  /** 饮用时长(短饮/长饮),空字符串未选择 */
  drinkDuration?: string;
  /** 饮用场合(餐前酒/餐后酒等),空字符串未选择 */
  occasion?: string;
  source: string;
  story: string;
  flavorDesc: string;
  ingredients: Recipe["ingredients"];
  steps: string;
  garnish: string;
  notes: string;
  /** 卡片标签顺序与可见性(null 使用默认全显示) */
  cardTagOrder?: Recipe["cardTagOrder"];
}

interface RecipeStore {
  ready: boolean;
  recipes: Recipe[];
  categories: Category[];
  tags: TagItem[];
  tagGroups: TagGroup[];
  addRecipe: (draft: RecipeDraft) => Recipe;
  addRecipes: (drafts: RecipeDraft[]) => { added: Recipe[]; skippedNames: string[] };
  updateRecipe: (id: string, draft: RecipeDraft) => void;
  deleteRecipe: (id: string) => void;
  deleteRecipes: (ids: string[]) => void;
  bulkUpdateRecipes: (ids: string[], patch: Partial<Recipe>) => void;
  toggleFavorite: (id: string) => void;
  toggleMade: (id: string) => void;
  setRating: (id: string, rating: number | null) => void;
  reorderRecipes: (orderedIds: string[]) => void;
  addCategory: (name: string, color: string) => Category | null;
  renameCategory: (id: string, name: string) => void;
  setCategoryNameEn: (id: string, nameEn: string) => void;
  setCategoryColor: (id: string, color: string) => void;
  deleteCategory: (id: string) => void;
  reorderCategories: (orderedIds: string[]) => void;
  addTag: (kind: TagKind, name: string, color: string) => TagItem | null;
  renameTag: (id: string, name: string) => void;
  setTagNameEn: (id: string, nameEn: string) => void;
  setTagColor: (id: string, color: string) => void;
  deleteTag: (id: string) => void;
  reorderTags: (kind: TagKind, orderedIds: string[]) => void;
  tagsOf: (kind: TagKind) => TagItem[];
  addTagGroup: (kind: TagKind, name: string) => TagGroup | null;
  renameTagGroup: (id: string, name: string) => void;
  setTagGroupNameEn: (id: string, nameEn: string) => void;
  deleteTagGroup: (id: string) => void;
  reorderTagGroups: (kind: TagKind, orderedIds: string[]) => void;
  setTagGroup: (tagId: string, groupId: string | null) => void;
  tagGroupsOf: (kind: TagKind) => TagGroup[];
  importSamples: () => void;
  getRecipe: (id: string | undefined) => Recipe | undefined;
  getCategory: (id: string | null | undefined) => Category | undefined;
}

const RecipeContext = createContext<RecipeStore | null>(null);

export function RecipeProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([]);
  const loadedRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const [rRaw, cRaw, seeded, tRaw, gRaw] = await Promise.all([
          AsyncStorage.getItem(RECIPES_KEY),
          AsyncStorage.getItem(CATEGORIES_KEY),
          AsyncStorage.getItem(SEEDED_KEY),
          AsyncStorage.getItem(TAGS_KEY),
          AsyncStorage.getItem(TAG_GROUPS_KEY),
        ]);
        const waldorfDone = await AsyncStorage.getItem(WALDORF_DATASET_KEY);
        let cats: Category[] = (cRaw ? (JSON.parse(cRaw) as Category[]) : []).map((c) =>
          migrateTagNameEn(c),
        );
        const parsed: Recipe[] = rRaw ? JSON.parse(rRaw) : [];
        let migrated = false;
        let recs: Recipe[] = parsed.map((r) => {
          const rec = normalizeRecipe(r);
          // 旧数据迁移:未计算过 ABV 的配方按内置关键词表回填(酒库/自制库
          // 在各自 Provider 中加载,此处用无上下文降级计算,保存时会精确重算)
          if (rec.abv === null && rec.ingredients.length > 0) {
            const est = estimateRecipeAbv(rec.ingredients, rec.method, [], []);
            if (est.abv !== null && est.band && est.strength) {
              rec.abv = est.abv;
              rec.strengthBand = est.band;
              rec.strength = est.strength;
              migrated = true;
            }
          }
          // 旧数据迁移:自动归类饮用时长(短饮/长饮)与饮用场合(餐前/餐后等)
          if (classifyRecipe(rec)) migrated = true;
          // 旧数据迁移:经典变体智能识别(空 variantOf 时按谱系引擎回填)
          if (!rec.variantOf && rec.ingredients.length > 0) {
            const v = inferVariantOf(rec);
            if (v) {
              rec.variantOf = v;
              migrated = true;
            }
          }
          // 旧数据迁移:Codex 六大家族智能识别(空 codexFamily 时按引擎回填;
          // 人工/文本声明的非空值不覆盖——三级优先级)
          if (!rec.codexFamily && rec.ingredients.length > 0) {
            const f = inferCodexFamily(rec);
            if (f) {
              rec.codexFamily = f;
              migrated = true;
            }
          }
          return rec;
        });
        if (!seeded && cats.length === 0) {
          cats = buildDefaultCategories();
          await AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(cats));
          notifySyncChange(CATEGORIES_KEY);
          await AsyncStorage.setItem(SEEDED_KEY, "1");
          notifySyncChange(SEEDED_KEY);
        }
        // 《The Waldorf Astoria Bar Book》数据集:首次加载时一次性合入(按英文名去重)
        if (!waldorfDone) {
          const existingNames = new Set(
            recs.map((r) => (r.nameEn || r.name).trim().toLowerCase()).filter(Boolean),
          );
          const newRecipes = buildWaldorfRecipes().filter(
            (r) => !existingNames.has((r.nameEn || r.name).trim().toLowerCase()),
          );
          if (newRecipes.length > 0) {
            recs = [...recs, ...newRecipes];
            migrated = true;
          }
          const existingCatIds = new Set(cats.map((c) => c.id));
          const newCats = buildWaldorfCategories().filter((c) => !existingCatIds.has(c.id));
          if (newCats.length > 0) {
            cats = [...cats, ...newCats];
            await AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(cats));
            notifySyncChange(CATEGORIES_KEY);
          }
          await AsyncStorage.setItem(WALDORF_DATASET_KEY, "1");
          notifySyncChange(WALDORF_DATASET_KEY);
        }
        if (migrated) {
          AsyncStorage.setItem(RECIPES_KEY, JSON.stringify(recs)).catch(() => {});
          notifySyncChange(RECIPES_KEY);
        }
        let tagList: TagItem[] = (tRaw ? (JSON.parse(tRaw) as TagItem[]) : []).map((t) =>
          migrateTagNameEn(t),
        );
        if (!tRaw) {
          tagList = buildDefaultTags();
          await AsyncStorage.setItem(TAGS_KEY, JSON.stringify(tagList));
          notifySyncChange(TAGS_KEY);
        } else if (!tagList.some((t) => t.kind === "duration") || !tagList.some((t) => t.kind === "occasion")) {
          // 老用户升级:注入新增维度(饮用时长/饮用场合)的默认标签
          const defaults = buildDefaultTags().filter(
            (d) =>
              (d.kind === "duration" || d.kind === "occasion") &&
              !tagList.some((t) => t.kind === d.kind),
          );
          if (defaults.length > 0) {
            tagList = [...tagList, ...defaults];
            await AsyncStorage.setItem(TAGS_KEY, JSON.stringify(tagList));
            notifySyncChange(TAGS_KEY);
          }
        }
        const groupList: TagGroup[] = (gRaw ? (JSON.parse(gRaw) as TagGroup[]) : []).map(
          (g) => migrateTagNameEn(g),
        );
        setTagGroups(groupList);
        setTags(tagList);
        setCategories(cats);
        setRecipes(recs);
      } catch (e) {
        console.warn("Failed to load store", e);
      } finally {
        loadedRef.current = true;
        setReady(true);
      }
    })();
  }, []);

  const persistRecipes = useCallback((next: Recipe[]) => {
    setRecipes(next);
    AsyncStorage.setItem(RECIPES_KEY, JSON.stringify(next)).catch(() => {});
    notifySyncChange(RECIPES_KEY);
  }, []);

  const persistCategories = useCallback((next: Category[]) => {
    setCategories(next);
    AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(next)).catch(() => {});
    notifySyncChange(CATEGORIES_KEY);
  }, []);

  const persistTags = useCallback((next: TagItem[]) => {
    setTags(next);
    AsyncStorage.setItem(TAGS_KEY, JSON.stringify(next)).catch(() => {});
    notifySyncChange(TAGS_KEY);
  }, []);

  const tagGroupsRef = useRef<TagGroup[]>([]);
  tagGroupsRef.current = tagGroups;
  const persistTagGroups = useCallback((next: TagGroup[]) => {
    setTagGroups(next);
    AsyncStorage.setItem(TAG_GROUPS_KEY, JSON.stringify(next)).catch(() => {});
    notifySyncChange(TAG_GROUPS_KEY);
  }, []);

  const addRecipe = useCallback(
    (draft: RecipeDraft): Recipe => {
      const now = Date.now();
      const recipe: Recipe = {
        id: genId(),
        favorite: false,
        made: false,
        rating: null,
        sortIndex: null,
        cardTagOrder: null,
        createdAt: now,
        updatedAt: now,
        strengthBand: "",
        abv: null,
        nameEn: "",
        ice: "",
        drinkDuration: "",
        occasion: "",
        ...draft,
        ...(draft.strengthBand === undefined ? { strengthBand: "" as const } : {}),
        ...(draft.abv === undefined ? { abv: null } : {}),
        ...(draft.nameEn === undefined ? { nameEn: "" } : {}),
        ...(draft.rating === undefined ? { rating: null } : {}),
      };
      // 智能归类:饮用时长与场合始终由引擎自动判定(无需人工填写)
      recipe.drinkDuration = inferDrinkDuration(recipe);
      recipe.occasion = inferOccasion(recipe);
      // 经典变体智能识别:人工未填写时自动判定(人工填写优先)
      if (!recipe.variantOf) recipe.variantOf = inferVariantOf(recipe);
      // Codex 家族智能识别:人工/文本声明未给出时自动判定
      if (!recipe.codexFamily) recipe.codexFamily = inferCodexFamily(recipe);
      persistRecipes([recipe, ...recipesRef.current]);
      return recipe;
    },
    [persistRecipes],
  );

  const addRecipes = useCallback(
    (drafts: RecipeDraft[]): { added: Recipe[]; skippedNames: string[] } => {
      const now = Date.now();
      const existing = recipesRef.current;
      const existingNames = new Set(existing.map((r) => r.name.trim().toLowerCase()));
      const added: Recipe[] = [];
      const skippedNames: string[] = [];
      for (const draft of drafts) {
        const nameKey = (draft.name ?? "").trim().toLowerCase();
        if (existingNames.has(nameKey)) {
          skippedNames.push(draft.name ?? "");
          continue;
        }
        const recipe: Recipe = {
          id: genId(),
          favorite: false,
          made: false,
          rating: null,
          sortIndex: null,
          cardTagOrder: null,
          createdAt: now,
          updatedAt: now,
          strengthBand: "",
          abv: null,
          nameEn: "",
          ice: "",
          drinkDuration: "",
          occasion: "",
          ...draft,
          ...(draft.strengthBand === undefined ? { strengthBand: "" as const } : {}),
          ...(draft.abv === undefined ? { abv: null } : {}),
          ...(draft.nameEn === undefined ? { nameEn: "" } : {}),
          ...(draft.rating === undefined ? { rating: null } : {}),
        };
        recipe.drinkDuration = inferDrinkDuration(recipe);
        recipe.occasion = inferOccasion(recipe);
        if (!recipe.variantOf) recipe.variantOf = inferVariantOf(recipe);
        if (!recipe.codexFamily) recipe.codexFamily = inferCodexFamily(recipe);
        added.push(recipe);
        existingNames.add(nameKey);
      }
      if (added.length > 0) {
        persistRecipes([...added, ...recipesRef.current]);
      }
      return { added, skippedNames };
    },
    [persistRecipes],
  );


  // keep a ref to latest recipes/categories for stable callbacks
  const recipesRef = useRef(recipes);
  recipesRef.current = recipes;
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;
  const tagsRef = useRef(tags);
  tagsRef.current = tags;

  const updateRecipe = useCallback(
    (id: string, draft: RecipeDraft) => {
      persistRecipes(
        recipesRef.current.map((r) => {
          if (r.id !== id) return r;
          const next = { ...r, ...draft, updatedAt: Date.now() };
          // 编辑后重新智能归类(配料/杯型/方法可能已变化)
          next.drinkDuration = inferDrinkDuration(next);
          next.occasion = inferOccasion(next);
          // 变体来源:人工清空或从未填写时重新智能判定
          if (!next.variantOf) next.variantOf = inferVariantOf(next);
          // Codex 家族:人工清空或从未填写时重新智能判定
          if (!next.codexFamily) next.codexFamily = inferCodexFamily(next);
          return next;
        }),
      );
    },
    [persistRecipes],
  );

  const deleteRecipe = useCallback(
    (id: string) => {
      persistRecipes(recipesRef.current.filter((r) => r.id !== id));
    },
    [persistRecipes],
  );

  /** 批量删除配方 */
  const deleteRecipes = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      persistRecipes(recipesRef.current.filter((r) => !set.has(r.id)));
    },
    [persistRecipes],
  );

  /** 批量更新配方字段(分类/风味标签等) */
  const bulkUpdateRecipes = useCallback(
    (ids: string[], patch: Partial<Recipe>) => {
      const set = new Set(ids);
      persistRecipes(
        recipesRef.current.map((r) =>
          set.has(r.id) ? { ...r, ...patch, updatedAt: Date.now() } : r,
        ),
      );
    },
    [persistRecipes],
  );

  const toggleFavorite = useCallback(
    (id: string) => {
      persistRecipes(
        recipesRef.current.map((r) =>
          r.id === id ? { ...r, favorite: !r.favorite, updatedAt: Date.now() } : r,
        ),
      );
    },
    [persistRecipes],
  );

  /** 切换"做过/未做过"状态 */
  const toggleMade = useCallback(
    (id: string) => {
      persistRecipes(
        recipesRef.current.map((r) =>
          r.id === id ? { ...r, made: !r.made, updatedAt: Date.now() } : r,
        ),
      );
    },
    [persistRecipes],
  );

  /** 设置评分(1-10 整数,null 清除评分) */
  const setRating = useCallback(
    (id: string, rating: number | null) => {
      const v =
        typeof rating === "number" && isFinite(rating)
          ? Math.min(10, Math.max(1, Math.round(rating)))
          : null;
      persistRecipes(
        recipesRef.current.map((r) =>
          r.id === id ? { ...r, rating: v, updatedAt: Date.now() } : r,
        ),
      );
    },
    [persistRecipes],
  );

  /** 长按拖拽后按新顺序写入 sortIndex(仅对传入的 id 生效,其余保持) */
  const reorderRecipes = useCallback(
    (orderedIds: string[]) => {
      const pos = new Map(orderedIds.map((id, i) => [id, i]));
      persistRecipes(
        recipesRef.current.map((r) =>
          pos.has(r.id) ? { ...r, sortIndex: pos.get(r.id)! } : r,
        ),
      );
    },
    [persistRecipes],
  );

  const addCategory = useCallback(
    (name: string, color: string): Category | null => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const filled = autoFillTagNames(trimmed);
      if (categoriesRef.current.some((c) => c.name === filled.name)) return null;
      const cat: Category = {
        id: genId(),
        name: filled.name,
        nameEn: filled.nameEn,
        color,
        createdAt: Date.now(),
      };
      persistCategories([...categoriesRef.current, cat]);
      return cat;
    },
    [persistCategories],
  );

  const renameCategory = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      persistCategories(
        categoriesRef.current.map((c) => (c.id === id ? { ...c, name: trimmed } : c)),
      );
    },
    [persistCategories],
  );

  const setCategoryColor = useCallback(
    (id: string, color: string) => {
      persistCategories(
        categoriesRef.current.map((c) => (c.id === id ? { ...c, color } : c)),
      );
    },
    [persistCategories],
  );

  const setCategoryNameEn = useCallback(
    (id: string, nameEn: string) => {
      persistCategories(
        categoriesRef.current.map((c) =>
          c.id === id ? { ...c, nameEn: nameEn.trim() } : c,
        ),
      );
    },
    [persistCategories],
  );

  const addTag = useCallback(
    (kind: TagKind, name: string, color: string): TagItem | null => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const filled = autoFillTagNames(trimmed);
      if (
        tagsRef.current.some(
          (t) =>
            t.kind === kind &&
            (t.name === filled.name ||
              (!!filled.nameEn &&
                (t.nameEn ?? "").toLowerCase() === filled.nameEn.toLowerCase())),
        )
      )
        return null;
      const tag: TagItem = {
        id: genId(),
        kind,
        name: filled.name,
        nameEn: filled.nameEn,
        color,
        createdAt: Date.now(),
      };
      persistTags([...tagsRef.current, tag]);
      return tag;
    },
    [persistTags],
  );

  const renameTag = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const target = tagsRef.current.find((t) => t.id === id);
      if (!target) return;
      const oldName = target.name;
      persistTags(
        tagsRef.current.map((t) => (t.id === id ? { ...t, name: trimmed } : t)),
      );
      // 同步更新已有配方中的标签名称
      persistRecipes(
        recipesRef.current.map((r) => {
          let changed = false;
          const next = { ...r };
          if (target.kind === "spirit" && r.baseSpirit === oldName) {
            next.baseSpirit = trimmed;
            changed = true;
          }
          if (target.kind === "glass" && r.glass === oldName) {
            next.glass = trimmed;
            changed = true;
          }
          if (target.kind === "flavor" && r.flavors.includes(oldName)) {
            next.flavors = r.flavors.map((f) => (f === oldName ? trimmed : f));
            changed = true;
          }
          return changed ? next : r;
        }),
      );
    },
    [persistTags, persistRecipes],
  );

  const setTagNameEn = useCallback(
    (id: string, nameEn: string) => {
      persistTags(
        tagsRef.current.map((t) => (t.id === id ? { ...t, nameEn: nameEn.trim() } : t)),
      );
    },
    [persistTags],
  );

  const setTagColor = useCallback(
    (id: string, color: string) => {
      persistTags(tagsRef.current.map((t) => (t.id === id ? { ...t, color } : t)));
    },
    [persistTags],
  );

  const deleteTag = useCallback(
    (id: string) => {
      const target = tagsRef.current.find((t) => t.id === id);
      persistTags(tagsRef.current.filter((t) => t.id !== id));
      if (!target) return;
      // 从已有配方中移除该风味标签;基酒/杯型保留原文字(仅失去颜色标记)
      if (target.kind === "flavor") {
        persistRecipes(
          recipesRef.current.map((r) =>
            r.flavors.includes(target.name)
              ? { ...r, flavors: r.flavors.filter((f) => f !== target.name) }
              : r,
          ),
        );
      }
    },
    [persistTags, persistRecipes],
  );

  const tagsOf = useCallback(
    (kind: TagKind) => tags.filter((t) => t.kind === kind),
    [tags],
  );

  const tagGroupsOf = useCallback(
    (kind: TagKind) => tagGroups.filter((g) => g.kind === kind),
    [tagGroups],
  );

  const addTagGroup = useCallback(
    (kind: TagKind, name: string): TagGroup | null => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const filled = autoFillTagNames(trimmed);
      if (tagGroupsRef.current.some((g) => g.kind === kind && g.name === filled.name)) return null;
      const group: TagGroup = {
        id: genId(),
        kind,
        name: filled.name,
        nameEn: filled.nameEn,
        createdAt: Date.now(),
      };
      persistTagGroups([...tagGroupsRef.current, group]);
      return group;
    },
    [persistTagGroups],
  );

  const renameTagGroup = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      persistTagGroups(
        tagGroupsRef.current.map((g) => (g.id === id ? { ...g, name: trimmed } : g)),
      );
    },
    [persistTagGroups],
  );

  const setTagGroupNameEn = useCallback(
    (id: string, nameEn: string) => {
      persistTagGroups(
        tagGroupsRef.current.map((g) =>
          g.id === id ? { ...g, nameEn: nameEn.trim() } : g,
        ),
      );
    },
    [persistTagGroups],
  );

  const deleteTagGroup = useCallback(
    (id: string) => {
      persistTagGroups(tagGroupsRef.current.filter((g) => g.id !== id));
      // 组内标签回到未分组,标签本身保留
      persistTags(
        tagsRef.current.map((t) => (t.groupId === id ? { ...t, groupId: null } : t)),
      );
    },
    [persistTagGroups, persistTags],
  );

  const reorderTagGroups = useCallback(
    (kind: TagKind, orderedIds: string[]) => {
      const same = tagGroupsRef.current.filter((g) => g.kind === kind);
      const others = tagGroupsRef.current.filter((g) => g.kind !== kind);
      const map = new Map(same.map((g) => [g.id, g]));
      const next: TagGroup[] = [];
      for (const id of orderedIds) {
        const item = map.get(id);
        if (item) {
          next.push(item);
          map.delete(id);
        }
      }
      for (const rest of map.values()) next.push(rest);
      persistTagGroups([...others, ...next]);
    },
    [persistTagGroups],
  );

  const setTagGroup = useCallback(
    (tagId: string, groupId: string | null) => {
      persistTags(
        tagsRef.current.map((t) => (t.id === tagId ? { ...t, groupId } : t)),
      );
    },
    [persistTags],
  );

  const reorderCategories = useCallback(
    (orderedIds: string[]) => {
      const map = new Map(categoriesRef.current.map((c) => [c.id, c]));
      const next: Category[] = [];
      for (const id of orderedIds) {
        const item = map.get(id);
        if (item) {
          next.push(item);
          map.delete(id);
        }
      }
      // 保留不在 orderedIds 中的项(容错)
      for (const rest of map.values()) next.push(rest);
      persistCategories(next);
    },
    [persistCategories],
  );

  const reorderTags = useCallback(
    (kind: TagKind, orderedIds: string[]) => {
      const sameKind = tagsRef.current.filter((t) => t.kind === kind);
      const others = tagsRef.current.filter((t) => t.kind !== kind);
      const map = new Map(sameKind.map((t) => [t.id, t]));
      const next: TagItem[] = [];
      for (const id of orderedIds) {
        const item = map.get(id);
        if (item) {
          next.push(item);
          map.delete(id);
        }
      }
      for (const rest of map.values()) next.push(rest);
      persistTags([...others, ...next]);
    },
    [persistTags],
  );

  const deleteCategory = useCallback(
    (id: string) => {
      persistCategories(categoriesRef.current.filter((c) => c.id !== id));
      // Recipes in this category become uncategorized
      persistRecipes(
        recipesRef.current.map((r) =>
          r.categoryId === id ? { ...r, categoryId: null } : r,
        ),
      );
    },
    [persistCategories, persistRecipes],
  );

  const importSamples = useCallback(() => {
    const samples = buildSampleRecipes();
    const existingNames = new Set(recipesRef.current.map((r) => r.name));
    const fresh = samples.filter((s) => !existingNames.has(s.name));
    if (fresh.length === 0) return;
    persistRecipes([...fresh, ...recipesRef.current]);
  }, [persistRecipes]);

  const getRecipe = useCallback(
    (id: string | undefined) => recipes.find((r) => r.id === id),
    [recipes],
  );

  const getCategory = useCallback(
    (id: string | null | undefined) => categories.find((c) => c.id === id),
    [categories],
  );

  const value = useMemo<RecipeStore>(
    () => ({
      ready,
      recipes,
      categories,
      tags,
      tagGroups,
      addRecipe,
      addRecipes,
      updateRecipe,
      deleteRecipe,
      deleteRecipes,
      bulkUpdateRecipes,
      toggleFavorite,
      toggleMade,
      setRating,
      reorderRecipes,
      addCategory,
      renameCategory,
      setCategoryNameEn,
      setCategoryColor,
      deleteCategory,
      reorderCategories,
      addTag,
      renameTag,
      setTagNameEn,
      setTagColor,
      deleteTag,
      reorderTags,
      tagsOf,
      addTagGroup,
      renameTagGroup,
      setTagGroupNameEn,
      deleteTagGroup,
      reorderTagGroups,
      setTagGroup,
      tagGroupsOf,
      importSamples,
      getRecipe,
      getCategory,
    }),
    [
      ready,
      recipes,
      categories,
      tags,
      tagGroups,
      addRecipe,
      addRecipes,
      updateRecipe,
      deleteRecipe,
      deleteRecipes,
      bulkUpdateRecipes,
      toggleFavorite,
      toggleMade,
      setRating,
      reorderRecipes,
      addCategory,
      renameCategory,
      setCategoryNameEn,
      setCategoryColor,
      deleteCategory,
      reorderCategories,
      addTag,
      renameTag,
      setTagNameEn,
      setTagColor,
      deleteTag,
      reorderTags,
      tagsOf,
      addTagGroup,
      renameTagGroup,
      setTagGroupNameEn,
      deleteTagGroup,
      reorderTagGroups,
      setTagGroup,
      tagGroupsOf,
      importSamples,
      getRecipe,
      getCategory,
    ],
  );

  return <RecipeContext.Provider value={value}>{children}</RecipeContext.Provider>;
}

export function useRecipeStore(): RecipeStore {
  const ctx = useContext(RecipeContext);
  if (!ctx) throw new Error("useRecipeStore must be used within RecipeProvider");
  return ctx;
}
