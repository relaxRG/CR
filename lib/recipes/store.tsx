import AsyncStorage from "@react-native-async-storage/async-storage";
import { notifySyncChange, registerStoreReload } from "../sync/engine";
import { deleteCloudPhoto } from "../sync/photo-sync";
import * as FileSystem from "expo-file-system/legacy";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { buildDefaultCategories } from "./seed";
import { estimateRecipeAbv } from "./abv";
import { classifyRecipe, inferDrinkDuration, inferOccasion } from "./classify";
import { inferVariantOf, inferCodexFamily } from "./lineage";
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
import {
  CategoryGroup,
  FLAVOR_LAYER_LABELS,
  flavorTagLayer,
} from "./types";

/** 从 AsyncStorage 重新加载所有 RecipeProvider 数据（供同步引擎在覆盖本地后调用） */
async function reloadAllFromStorage(
  setRecipes: (r: Recipe[]) => void,
  setCategories: (c: Category[]) => void,
  setTags: (t: TagItem[]) => void,
  setTagGroups: (g: TagGroup[]) => void,
  setCategoryGroups: (g: CategoryGroup[]) => void,
  setPrefs?: (p: RecipePrefs) => void,
) {
  try {
    const [rRaw, cRaw, tRaw, gRaw, cgRaw, prefsRaw] = await Promise.all([
      AsyncStorage.getItem(RECIPES_KEY),
      AsyncStorage.getItem(CATEGORIES_KEY),
      AsyncStorage.getItem(TAGS_KEY),
      AsyncStorage.getItem(TAG_GROUPS_KEY),
      AsyncStorage.getItem(CATEGORY_GROUPS_KEY),
      AsyncStorage.getItem(PREFS_KEY),
    ]);
    if (rRaw) {
      try {
        let recs = JSON.parse(rRaw) as Recipe[];
        // 同步后合并 prefs 到 recipes（prefs 优先）
        if (prefsRaw) {
          const p: RecipePrefs = JSON.parse(prefsRaw);
          recs = recs.map((r) => {
            const pref = p[r.id];
            if (!pref) return r;
            return {
              ...r,
              // 有利优先：favorite/made 任一为 true 则保留 true；rating 取较高值
              favorite: (pref.favorite === true || r.favorite === true)
                ? true
                : (pref.favorite === false || r.favorite === false)
                ? false
                : r.favorite,
              rating: (() => {
                const pr = typeof pref.rating === "number" ? pref.rating : null;
                const rr = typeof r.rating === "number" ? r.rating : null;
                if (pr !== null && rr !== null) return Math.max(pr, rr);
                return pr ?? rr;
              })(),
              made: (pref.made === true || r.made === true)
                ? true
                : (pref.made === false || r.made === false)
                ? false
                : r.made,
            };
          });
          if (setPrefs) setPrefs(p);
        }
        setRecipes(recs);
      } catch {}
    }
    if (cRaw) { try { setCategories((JSON.parse(cRaw) as Category[]).map((c) => migrateTagNameEn(c))); } catch {} }
    if (tRaw) { try { setTags((JSON.parse(tRaw) as TagItem[]).map((t) => migrateTagNameEn(t))); } catch {} }
    if (gRaw) { try { setTagGroups((JSON.parse(gRaw) as TagGroup[]).map((g) => migrateTagNameEn(g))); } catch {} }
    if (cgRaw) { try { setCategoryGroups((JSON.parse(cgRaw) as CategoryGroup[]).map((g) => migrateTagNameEn(g))); } catch {} }
  } catch {
    // 静默忽略
  }
}
const RECIPES_KEY = "cocktail.recipes";
/** 收藏/评分独立存储键：按设备角色隔离，owner 组内同步，不同角色各自独立 */
const PREFS_KEY = "cocktail.prefs.v1";
type RecipePrefs = Record<string, { favorite?: boolean; rating?: number | null; made?: boolean }>;
const CATEGORIES_KEY = "cocktail.categories";
const SEEDED_KEY = "cocktail.seeded";
const TAGS_KEY = "cocktail.tags";
const TAG_GROUPS_KEY = "cocktail.tagGroups";
const CATEGORY_GROUPS_KEY = "cocktail.categoryGroups";

/** 安全删除配方照片文件（不抛错） */
async function deleteRecipePhoto(photoUri: string) {
  try {
    const info = await FileSystem.getInfoAsync(photoUri);
    if (info.exists) await FileSystem.deleteAsync(photoUri, { idempotent: true });
  } catch {
    // 文件不存在或删除失败时静默忽略
  }
  // 同步删除云端副本（非阻塞，失败静默）
  void deleteCloudPhoto(photoUri);
}

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
  /** 结构化装饰（可选；保存时与 garnish 字符串双写） */
  garnishItems?: Recipe["garnishItems"];
  notes: string;
  /** 卡片标签顺序与可见性(null 使用默认全显示) */
  cardTagOrder?: Recipe["cardTagOrder"];
  /** 结构化引用来源（可选，书库导入 / AI 补全 / 手动填写） */
  sourceRef?: Recipe["sourceRef"];
  /** 成品照片本地路径列表（可选，新建时默认空数组） */
  photoUris?: string[];
}

interface RecipeStore {
  ready: boolean;
  recipes: Recipe[];
  categories: Category[];
  tags: TagItem[];
  tagGroups: TagGroup[];
  categoryGroups: CategoryGroup[];
  addRecipe: (draft: RecipeDraft) => Recipe;
  addRecipes: (drafts: RecipeDraft[]) => { added: Recipe[]; skippedNames: string[] };
  updateRecipe: (id: string, draft: RecipeDraft) => void;
  duplicateRecipe: (id: string) => Recipe | null;
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
  getRecipe: (id: string | undefined) => Recipe | undefined;
  getCategory: (id: string | null | undefined) => Category | undefined;
  addCategoryGroup: (name: string) => CategoryGroup | null;
  renameCategoryGroup: (id: string, name: string) => void;
  setCategoryGroupNameEn: (id: string, nameEn: string) => void;
  deleteCategoryGroup: (id: string) => void;
  reorderCategoryGroups: (orderedIds: string[]) => void;
  setCategoryGroup: (categoryId: string, groupId: string | null) => void;
  toggleTagLocked: (id: string) => void;
  toggleTagGroupLocked: (id: string) => void;
  toggleCategoryLocked: (id: string) => void;
  toggleCategoryGroupLocked: (id: string) => void;
  /** 添加一张照片（最多 5 张）或删除指定照片（传 null 表示删除指定 uri） */
  updateRecipePhoto: (id: string, action: "add", uri: string) => void;
  removeRecipePhoto: (id: string, uri: string) => void;
}

const RecipeContext = createContext<RecipeStore | null>(null);

export function RecipeProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([]);
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);
  const [prefs, setPrefs] = useState<RecipePrefs>({});
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
        // 老用户升级:为已存在的 duration/occasion 标签补 isSystem: true
        if (tRaw && tagList.some((t) => (t.kind === "duration" || t.kind === "occasion") && !t.isSystem)) {
          tagList = tagList.map((t) =>
            (t.kind === "duration" || t.kind === "occasion") ? { ...t, isSystem: true } : t,
          );
          await AsyncStorage.setItem(TAGS_KEY, JSON.stringify(tagList));
          notifySyncChange(TAGS_KEY);
        }
        // 老用户升级:注入新增的 BASE_SPIRITS 标签（如梅斯卡尔、卡沙萨、皮斯科）
        if (tRaw) {
          const allDefaults = buildDefaultTags();
          const missingSpirits = allDefaults.filter(
            (d) => d.kind === "spirit" && !tagList.some((t) => t.kind === "spirit" && t.name === d.name),
          );
          if (missingSpirits.length > 0) {
            tagList = [...tagList, ...missingSpirits];
            await AsyncStorage.setItem(TAGS_KEY, JSON.stringify(tagList));
            notifySyncChange(TAGS_KEY);
          }
        }
        // 老用户升级:注入新增的 GLASSES 标签（尼克诺拉杯、郁金香杯、笛型杯、提基杯、铜杯、红酒杯、朱莉普杯）
        if (tRaw) {
          const allDefaults = buildDefaultTags();
          const missingGlasses = allDefaults.filter(
            (d) => d.kind === "glass" && !tagList.some((t) => t.kind === "glass" && t.name === d.name),
          );
          if (missingGlasses.length > 0) {
            tagList = [...tagList, ...missingGlasses];
            await AsyncStorage.setItem(TAGS_KEY, JSON.stringify(tagList));
            notifySyncChange(TAGS_KEY);
          }
        }
        const groupList: TagGroup[] = (gRaw ? (JSON.parse(gRaw) as TagGroup[]) : []).map(
          (g) => migrateTagNameEn(g),
        );
        // ── flavor 默认三分组初始化 ──────────────────────────────────────
        const buildDefaultFlavorGroups = (): TagGroup[] => {
          const now = Date.now();
          return [
            { id: "tg-flavor-taste",   kind: "flavor" as const, name: FLAVOR_LAYER_LABELS.taste.zh,   nameEn: FLAVOR_LAYER_LABELS.taste.en,   createdAt: now,     locked: true, flavorLayer: "taste"   as const },
            { id: "tg-flavor-aroma",   kind: "flavor" as const, name: FLAVOR_LAYER_LABELS.aroma.zh,   nameEn: FLAVOR_LAYER_LABELS.aroma.en,   createdAt: now + 1, locked: true, flavorLayer: "aroma"   as const },
            { id: "tg-flavor-texture", kind: "flavor" as const, name: FLAVOR_LAYER_LABELS.texture.zh, nameEn: FLAVOR_LAYER_LABELS.texture.en, createdAt: now + 2, locked: true, flavorLayer: "texture" as const },
          ];
        };
        const FLAVOR_GROUP_IDS: Record<string, string> = { taste: "tg-flavor-taste", aroma: "tg-flavor-aroma", texture: "tg-flavor-texture" };
        let mutableGroupList = groupList;
        if (!gRaw) {
          // 首次安装：创建三个 flavor 默认分组
          mutableGroupList = buildDefaultFlavorGroups();
          await AsyncStorage.setItem(TAG_GROUPS_KEY, JSON.stringify(mutableGroupList));
          notifySyncChange(TAG_GROUPS_KEY);
        } else {
          // 老用户升级：补充缺失的 flavor 分组
          const missingFlavorGroups = buildDefaultFlavorGroups().filter(
            (dg) => !mutableGroupList.some((g) => g.id === dg.id),
          );
          if (missingFlavorGroups.length > 0) {
            mutableGroupList = [...mutableGroupList, ...missingFlavorGroups];
            await AsyncStorage.setItem(TAG_GROUPS_KEY, JSON.stringify(mutableGroupList));
            notifySyncChange(TAG_GROUPS_KEY);
          }
          // 确保已有 flavor 分组的 locked/flavorLayer 字段正确
          const needsFlavorGroupFix = mutableGroupList.some(
            (g) => (g.id === "tg-flavor-taste" || g.id === "tg-flavor-aroma" || g.id === "tg-flavor-texture") && (!g.locked || !g.flavorLayer),
          );
          if (needsFlavorGroupFix) {
            const defaults = buildDefaultFlavorGroups();
            mutableGroupList = mutableGroupList.map((g) => {
              const def = defaults.find((d) => d.id === g.id);
              return def ? { ...g, locked: true, flavorLayer: def.flavorLayer } : g;
            });
            await AsyncStorage.setItem(TAG_GROUPS_KEY, JSON.stringify(mutableGroupList));
            notifySyncChange(TAG_GROUPS_KEY);
          }
        }
        // 老用户升级：为 flavor 标签分配默认分组（无 groupId 的标签）
        const flavorTagsNeedGroup = tagList.filter((t) => t.kind === "flavor" && !t.groupId);
        if (flavorTagsNeedGroup.length > 0) {
          tagList = tagList.map((t) => {
            if (t.kind !== "flavor" || t.groupId) return t;
            const layer = flavorTagLayer(t.name);
            if (!layer) return t;
            return { ...t, groupId: FLAVOR_GROUP_IDS[layer] };
          });
          await AsyncStorage.setItem(TAGS_KEY, JSON.stringify(tagList));
          notifySyncChange(TAGS_KEY);
        }
        setTagGroups(mutableGroupList);
        setTags(tagList);
        setCategories(cats);
        // 加载收藏/评分偏好（独立键），合并覆盖到 recipe 对象
        const prefsRaw = await AsyncStorage.getItem(PREFS_KEY);
        let loadedPrefs: RecipePrefs = prefsRaw ? JSON.parse(prefsRaw) : {};
        // 迁移：将 recipes 中已有的 favorite/rating/made 写入 prefs（首次迁移）
        let prefsMigrated = false;
        recs = recs.map((r) => {
          const p = loadedPrefs[r.id];
          if (!p) {
            // 如果 recipe 有个人偏好字段，迁移到 prefs
            if (r.favorite || r.rating != null || r.made) {
              loadedPrefs[r.id] = { favorite: r.favorite, rating: r.rating, made: r.made };
              prefsMigrated = true;
            }
            return r;
          }
          // prefs 优先覆盖 recipe 中的个人偏好字段
          return {
            ...r,
            favorite: p.favorite ?? r.favorite,
            rating: p.rating !== undefined ? p.rating : r.rating,
            made: p.made ?? r.made,
          };
        });
        if (prefsMigrated) {
          AsyncStorage.setItem(PREFS_KEY, JSON.stringify(loadedPrefs)).catch(() => {});
          notifySyncChange(PREFS_KEY);
        }
        setPrefs(loadedPrefs);
        setRecipes(recs);
        const cgRaw = await AsyncStorage.getItem(CATEGORY_GROUPS_KEY);
        const catGroupList: CategoryGroup[] = cgRaw
          ? (JSON.parse(cgRaw) as CategoryGroup[]).map((g) => migrateTagNameEn(g))
          : [];
        setCategoryGroups(catGroupList);
      } catch (e) {
        console.warn("Failed to load store", e);
      } finally {
        loadedRef.current = true;
        setReady(true);
      }
    })();
  }, []);

  // 云端同步覆盖本地 AsyncStorage 后，重新加载所有数据到内存
  // 这是修复"标签/分类/配方同步后消失"的关键：没有此回调，
  // 内存中的旧状态会在下次写操作时覆盖掉刚同步的云端数据
  useEffect(() => {
    return registerStoreReload(() => {
      void reloadAllFromStorage(
        setRecipes,
        setCategories,
        setTags,
        setTagGroups,
        setCategoryGroups,
        setPrefs,
      );
    });
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
  const categoryGroupsRef = useRef<CategoryGroup[]>([]);
  categoryGroupsRef.current = categoryGroups;
  const persistCategoryGroups = useCallback((next: CategoryGroup[]) => {
    setCategoryGroups(next);
    AsyncStorage.setItem(CATEGORY_GROUPS_KEY, JSON.stringify(next)).catch(() => {});
    notifySyncChange(CATEGORY_GROUPS_KEY);
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
      photoUris: [],
      };
      // 四层优先级融合：draft（AI/用户手动）> 启发式推断 > ""
      // draft 中有值（AI 或用户手动选择）时直接保留，否则启发式推断保底
      if (!recipe.drinkDuration) recipe.drinkDuration = inferDrinkDuration(recipe) || "";
      if (!recipe.occasion) recipe.occasion = inferOccasion(recipe) || "";
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
          photoUris: [],
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

  const duplicateRecipe = useCallback(
    (id: string): Recipe | null => {
      const src = recipesRef.current.find((r) => r.id === id);
      if (!src) return null;
      const now = Date.now();
      const copy: Recipe = {
        ...src,
        id: genId(),
        name: src.name + "（副本）",
        nameEn: src.nameEn ? src.nameEn + " (Copy)" : "",
        favorite: false,
        made: false,
        rating: null,
        sortIndex: null,
        createdAt: now,
        updatedAt: now,
        photoUris: [],
      };
      persistRecipes([copy, ...recipesRef.current]);
      return copy;
    },
    [persistRecipes],
  );



  // keep a ref to latest recipes/categories for stable callbacks
  const recipesRef = useRef(recipes);
  recipesRef.current = recipes;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
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
          // 四层优先级融合：draft（用户手动/AI）> 启发式推断 > 原有值
          // 若 draft 明确传入了值（包括空字符串表示用户清空），优先使用
          // 若 draft 未传入（undefined），保留原有值或重新推断
          if (draft.drinkDuration !== undefined) {
            // 用户或 AI 明确设置了值（含空字符串=清空），保留
            next.drinkDuration = draft.drinkDuration || inferDrinkDuration(next) || "";
          } else {
            // draft 未传入，配料/杯型可能变化，重新推断（但不覆盖已有的非空值）
            if (!next.drinkDuration) next.drinkDuration = inferDrinkDuration(next) || "";
          }
          if (draft.occasion !== undefined) {
            next.occasion = draft.occasion || inferOccasion(next) || "";
          } else {
            if (!next.occasion) next.occasion = inferOccasion(next) || "";
          }
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

  const updateRecipePhoto = useCallback(
    (id: string, _action: "add", uri: string) => {
      persistRecipes(
        recipesRef.current.map((r) => {
          if (r.id !== id) return r;
          const existing = r.photoUris ?? [];
          if (existing.includes(uri) || existing.length >= 5) return r;
          return { ...r, photoUris: [...existing, uri], updatedAt: Date.now() };
        }),
      );
    },
    [persistRecipes],
  );

  const removeRecipePhoto = useCallback(
    (id: string, uri: string) => {
      const target = recipesRef.current.find((r) => r.id === id);
      if (target) {
        // 只有该 uri 不再被其他配方引用时才删除文件
        const usedElsewhere = recipesRef.current.some(
          (r) => r.id !== id && (r.photoUris ?? []).includes(uri),
        );
        if (!usedElsewhere) deleteRecipePhoto(uri);
      }
      persistRecipes(
        recipesRef.current.map((r) =>
          r.id === id
            ? { ...r, photoUris: (r.photoUris ?? []).filter((u) => u !== uri), updatedAt: Date.now() }
            : r,
        ),
      );
    },
    [persistRecipes],
  );


  const deleteRecipe = useCallback(
    (id: string) => {
      const target = recipesRef.current.find((r) => r.id === id);
      (target?.photoUris ?? []).forEach((uri) => deleteRecipePhoto(uri));
      persistRecipes(recipesRef.current.filter((r) => r.id !== id));
    },
    [persistRecipes],
  );

  /** 批量删除配方 */
  const deleteRecipes = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      recipesRef.current.forEach((r) => {
        if (set.has(r.id)) (r.photoUris ?? []).forEach((uri) => deleteRecipePhoto(uri));
      });
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

  const persistPrefs = useCallback((next: RecipePrefs) => {
    setPrefs(next);
    AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next)).catch(() => {});
    notifySyncChange(PREFS_KEY);
  }, []);
  const toggleFavorite = useCallback(
    (id: string) => {
      const cur = recipesRef.current.find((r) => r.id === id);
      const newFav = !(cur?.favorite ?? false);
      // 双写：recipe 保持向后兼容，prefs 独立存储
      persistRecipes(
        recipesRef.current.map((r) =>
          r.id === id ? { ...r, favorite: newFav, updatedAt: Date.now() } : r,
        ),
      );
      const nextPrefs = { ...prefsRef.current, [id]: { ...prefsRef.current[id], favorite: newFav } };
      persistPrefs(nextPrefs);
    },
    [persistRecipes],
  );

  /** 切换"做过/未做过"状态 */
  const toggleMade = useCallback(
    (id: string) => {
      const cur = recipesRef.current.find((r) => r.id === id);
      const newMade = !(cur?.made ?? false);
      // 双写：recipe 保持向后兼容，prefs 独立存储
      persistRecipes(
        recipesRef.current.map((r) =>
          r.id === id ? { ...r, made: newMade, updatedAt: Date.now() } : r,
        ),
      );
      const nextPrefs = { ...prefsRef.current, [id]: { ...prefsRef.current[id], made: newMade } };
      persistPrefs(nextPrefs);
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
      // 双写：recipe 保持向后兼容，prefs 独立存储
      persistRecipes(
        recipesRef.current.map((r) =>
          r.id === id ? { ...r, rating: v, updatedAt: Date.now() } : r,
        ),
      );
      const nextPrefs = { ...prefsRef.current, [id]: { ...prefsRef.current[id], rating: v } };
      persistPrefs(nextPrefs);
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
      // 系统标签类型不允许手动新增
      if (kind === "duration" || kind === "occasion") return null;
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
      // 系统标签不允许改名
      if (target.isSystem) return;
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
      // 系统标签不允许删除
      if (target?.isSystem) return;
      // 锁定标签不允许删除
      if (target?.locked) return;
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
      const tgt = tagGroupsRef.current.find((g) => g.id === id);
      // 锁定分组不允许删除
      if (tgt?.locked) return;
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
      // P7: 校验 kind 一致性，防止跨 kind 分组赋值
      const tag = tagsRef.current.find((t) => t.id === tagId);
      if (!tag) return;
      if (groupId !== null) {
        const targetGroup = tagGroupsRef.current.find((g) => g.id === groupId);
        if (!targetGroup || targetGroup.kind !== tag.kind) return;
      }
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
      const catTarget = categoriesRef.current.find((c) => c.id === id);
      // 锁定分类不允许删除
      if (catTarget?.locked) return;
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

  const getRecipe = useCallback(
    (id: string | undefined) => recipes.find((r) => r.id === id),
    [recipes],
  );

  const getCategory = useCallback(
    (id: string | null | undefined) => categories.find((c) => c.id === id),
    [categories],
  );


  // ── CategoryGroup CRUD ──────────────────────────────────────────────────────
  const addCategoryGroup = useCallback(
    (name: string): CategoryGroup | null => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const filled = autoFillTagNames(trimmed);
      if (categoryGroupsRef.current.some((g) => g.name === filled.name)) return null;
      const group: CategoryGroup = {
        id: genId(),
        name: filled.name,
        nameEn: filled.nameEn,
        createdAt: Date.now(),
      };
      persistCategoryGroups([...categoryGroupsRef.current, group]);
      return group;
    },
    [persistCategoryGroups],
  );

  const renameCategoryGroup = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      persistCategoryGroups(
        categoryGroupsRef.current.map((g) => (g.id === id ? { ...g, name: trimmed } : g)),
      );
    },
    [persistCategoryGroups],
  );

  const setCategoryGroupNameEn = useCallback(
    (id: string, nameEn: string) => {
      persistCategoryGroups(
        categoryGroupsRef.current.map((g) =>
          g.id === id ? { ...g, nameEn: nameEn.trim() } : g,
        ),
      );
    },
    [persistCategoryGroups],
  );

  const deleteCategoryGroup = useCallback(
    (id: string) => {
      const target = categoryGroupsRef.current.find((g) => g.id === id);
      if (target?.locked) return;
      persistCategoryGroups(categoryGroupsRef.current.filter((g) => g.id !== id));
      persistCategories(
        categoriesRef.current.map((c) => (c.groupId === id ? { ...c, groupId: null } : c)),
      );
    },
    [persistCategoryGroups, persistCategories],
  );

  const reorderCategoryGroups = useCallback(
    (orderedIds: string[]) => {
      const map = new Map(categoryGroupsRef.current.map((g) => [g.id, g]));
      const next: CategoryGroup[] = [];
      for (const id of orderedIds) {
        const item = map.get(id);
        if (item) { next.push(item); map.delete(id); }
      }
      for (const rest of map.values()) next.push(rest);
      persistCategoryGroups(next);
    },
    [persistCategoryGroups],
  );

  const setCategoryGroup = useCallback(
    (categoryId: string, groupId: string | null) => {
      persistCategories(
        categoriesRef.current.map((c) => (c.id === categoryId ? { ...c, groupId } : c)),
      );
    },
    [persistCategories],
  );

  // ── 锁定/解锁 toggle ────────────────────────────────────────────────────────
  const toggleTagLocked = useCallback(
    (id: string) => {
      persistTags(
        tagsRef.current.map((t) => (t.id === id ? { ...t, locked: !t.locked } : t)),
      );
    },
    [persistTags],
  );

  const toggleTagGroupLocked = useCallback(
    (id: string) => {
      const target = tagGroupsRef.current.find((g) => g.id === id);
      if (target?.flavorLayer) return;
      persistTagGroups(
        tagGroupsRef.current.map((g) => (g.id === id ? { ...g, locked: !g.locked } : g)),
      );
    },
    [persistTagGroups],
  );

  const toggleCategoryLocked = useCallback(
    (id: string) => {
      persistCategories(
        categoriesRef.current.map((c) => (c.id === id ? { ...c, locked: !c.locked } : c)),
      );
    },
    [persistCategories],
  );

  const toggleCategoryGroupLocked = useCallback(
    (id: string) => {
      persistCategoryGroups(
        categoryGroupsRef.current.map((g) => (g.id === id ? { ...g, locked: !g.locked } : g)),
      );
    },
    [persistCategoryGroups],
  );

  const value = useMemo<RecipeStore>(
    () => ({
      ready,
      recipes,
      categories,
      tags,
      tagGroups,
      categoryGroups,
      addRecipe,
      addRecipes,
      updateRecipe,
      updateRecipePhoto,
      deleteRecipe,
      deleteRecipes,
      bulkUpdateRecipes,
      removeRecipePhoto,
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
      getRecipe,
      getCategory,
      duplicateRecipe,
      addCategoryGroup,
      renameCategoryGroup,
      setCategoryGroupNameEn,
      deleteCategoryGroup,
      reorderCategoryGroups,
      setCategoryGroup,
      toggleTagLocked,
      toggleTagGroupLocked,
      toggleCategoryLocked,
      toggleCategoryGroupLocked,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      ready,
      recipes,
      categories,
      tags,
      tagGroups,
      categoryGroups,
      addRecipe,
      addRecipes,
      updateRecipe,
      updateRecipePhoto,
      removeRecipePhoto,
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
      getRecipe,
      getCategory,
      duplicateRecipe,
      addCategoryGroup,
      renameCategoryGroup,
      setCategoryGroupNameEn,
      deleteCategoryGroup,
      reorderCategoryGroups,
      setCategoryGroup,
      toggleTagLocked,
      toggleTagGroupLocked,
      toggleCategoryLocked,
      toggleCategoryGroupLocked,
    ],
  );

  return <RecipeContext.Provider value={value}>{children}</RecipeContext.Provider>;
}

export function useRecipeStore(): RecipeStore {
  const ctx = useContext(RecipeContext);
  if (!ctx) throw new Error("useRecipeStore must be used within RecipeProvider");
  return ctx;
}
