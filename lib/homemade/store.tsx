import AsyncStorage from "@react-native-async-storage/async-storage";
import { notifySyncChange } from "../sync/engine";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { buildSamplePreps } from "./seed";
import { buildWaldorfPreps, findFullPrepByName } from "../bottles/waldorf-ingredients";
import {
  HomemadePrep,
  PREP_SECTION_MIGRATION,
  PrepGroup,
  PrepSection,
  PrepType,
  buildDefaultPrepSections,
  buildDefaultPrepTypes,
  classifyPrepGroup,
  normalizePrep,
  prepSectionOf,
} from "./types";

const PREPS_KEY = "homemade.preps.v1";
const PREPS_SEEDED_KEY = "homemade.seeded.v1";
const SECTIONS_KEY = "homemade.sections.v1";
const TYPES_KEY = "homemade.types.v1";
/** v2 迁移标记:含酒精/无酒精分组体系 */
const TAXONOMY_V2_KEY = "homemade.taxonomy.v2";
/** 《Waldorf》自制配料数据集导入标记 */
const WALDORF_PREPS_FLAG = "homemade.waldorf.v1";
/** 《Waldorf》v2:书中 House-Made Recipes 完整做法回填/去重/增补标记 */
const WALDORF_PREPS_V2_FLAG = "homemade.waldorf.v2";
/** v3:notes 中来源类文字提取归入 source 字段并去重的一次性迁移标记 */
const PREP_SOURCE_V3_FLAG = "homemade.source.v3";

/** 从 notes 中辩证提取来源类文字:返回 [提取出的来源, 清理后的 notes];无来源时返回 [null, 原 notes] */
export function extractSourceFromNotes(notes: string): [string | null, string] {
  if (!notes.trim()) return [null, notes];
  const lines = notes.split(/\n+/);
  const sourceLines: string[] = [];
  const kept: string[] = [];
  const patterns: RegExp[] = [
    /^(?:来源|出处|引用来源|摘自|源自)[::]\s*(.+)$/,
    /^Source[::]\s*(.+)$/i,
    /^(?:Adapted|Taken)\s+from\s+(.+)$/i,
    /^(?:摘录自|改编自)\s*(.+)$/,
  ];
  // 书名类内嵌:整行提及 Waldorf Astoria Bar Book 且为纯来源句(短句,无做法动词)
  const bookRe = /The\s+Waldorf\s+Astoria\s+Bar\s+Book|《?华尔道夫[·・]?阿斯托里亚酒吧手册》?/i;
  for (const line of lines) {
    const trimmed = line.trim();
    let matched = false;
    for (const re of patterns) {
      const m = trimmed.match(re);
      if (m) {
        sourceLines.push(m[1].trim());
        matched = true;
        break;
      }
    }
    if (!matched && bookRe.test(trimmed) && trimmed.length <= 60) {
      sourceLines.push(trimmed.replace(/^[-·•\s]+/, ""));
      matched = true;
    }
    if (!matched) kept.push(line);
  }
  if (sourceLines.length === 0) return [null, notes];
  return [sourceLines.join(" · "), kept.join("\n").trim()];
}
interface HomemadeStore {
  ready: boolean;
  preps: HomemadePrep[];
  sections: PrepSection[];
  types: PrepType[];
  addPrep: (
    p: Omit<
      HomemadePrep,
      "id" | "createdAt" | "updatedAt" | "builtin" | "made" | "rating" | "sortIndex" | "abvGroup"
    > & {
      made?: boolean;
      rating?: number | null;
      sortIndex?: number | null;
      abvGroup?: PrepGroup | null;
    },
  ) => HomemadePrep;
  updatePrep: (id: string, patch: Partial<HomemadePrep>) => void;
  deletePrep: (id: string) => void;
  deletePreps: (ids: string[]) => void;
  bulkUpdatePreps: (ids: string[], patch: Partial<HomemadePrep>) => void;
  togglePrepMade: (id: string) => void;
  setPrepRating: (id: string, rating: number | null) => void;
  setPrepGroup: (id: string, group: PrepGroup | null) => void;
  reorderPreps: (orderedIds: string[]) => void;
  importSamples: () => number;
  getPrep: (id: string | undefined) => HomemadePrep | undefined;
  // Section management
  addSection: (en: string, zh: string, group?: PrepGroup) => PrepSection | null;
  renameSection: (key: string, en: string, zh: string) => void;
  moveSection: (key: string, group: PrepGroup) => void;
  deleteSection: (key: string) => void;
  reorderSections: (orderedKeys: string[]) => void;
  // Type management
  addType: (en: string, zh: string, section: string) => PrepType | null;
  renameType: (key: string, en: string, zh: string) => void;
  moveType: (key: string, section: string) => void;
  deleteType: (key: string) => void;
  reorderTypes: (section: string, orderedKeys: string[]) => void;
}

const HomemadeContext = createContext<HomemadeStore | null>(null);

function slugify(en: string): string {
  const base = en
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `custom-${Date.now().toString(36)}`;
}

/**
 * v2 迁移:旧五分区体系 → 含酒精/无酒精专业体系。
 * - 旧 flavored-liquid 分区按类型拆分:infusion→infused-spirit,tincture/bitters→bitters-tincture,
 *   juice/solution→juice-cordial(依赖新默认 PREP_TYPES 的 section 归属)
 * - 自定义分区补 group 字段(按其内类型智能判定,默认 non_alcoholic)
 * - 条目 abvGroup 保持 null(跟随类型推断),仅对无法归入新体系的自定义类型条目做关键词判定
 */
function migrateSectionsV2(stored: PrepSection[]): PrepSection[] {
  const defaults = buildDefaultPrepSections();
  const defaultKeys = new Set(defaults.map((s) => s.key));
  const custom = stored.filter(
    (s) => !defaultKeys.has(s.key) && !PREP_SECTION_MIGRATION[s.key] &&
      !["homemade-syrup", "homemade-liqueur", "flavored-liquid", "homemade-spirit", "misc"].includes(s.key),
  );
  // 自定义分区保留在末尾,补 group(用分区名智能判定)
  const migratedCustom = custom.map((s) =>
    s.group === "alcoholic" || s.group === "non_alcoholic"
      ? s
      : { ...s, group: classifyPrepGroup({ name: `${s.en} ${s.zh}` }) },
  );
  return [...defaults, ...migratedCustom];
}

function migrateTypesV2(stored: PrepType[]): PrepType[] {
  const defaults = buildDefaultPrepTypes();
  const defaultKeys = new Set(defaults.map((t) => t.key));
  // 自定义类型:分区若被迁移则映射到新分区,否则保留
  const custom = stored
    .filter((t) => !defaultKeys.has(t.key))
    .map((t) => ({ ...t, section: PREP_SECTION_MIGRATION[t.section] ?? t.section }));
  return [...defaults, ...custom];
}

export function HomemadeProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [preps, setPreps] = useState<HomemadePrep[]>([]);
  const [sections, setSections] = useState<PrepSection[]>(buildDefaultPrepSections());
  const [types, setTypes] = useState<PrepType[]>(buildDefaultPrepTypes());

  useEffect(() => {
    (async () => {
      try {
        const [raw, sRaw, tRaw, v2Flag] = await Promise.all([
          AsyncStorage.getItem(PREPS_KEY),
          AsyncStorage.getItem(SECTIONS_KEY),
          AsyncStorage.getItem(TYPES_KEY),
          AsyncStorage.getItem(TAXONOMY_V2_KEY),
        ]);
        const needMigrate = !v2Flag;
        let nextSections = buildDefaultPrepSections();
        let nextTypes = buildDefaultPrepTypes();
        if (sRaw) {
          const parsed: PrepSection[] = JSON.parse(sRaw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            nextSections = needMigrate ? migrateSectionsV2(parsed) : parsed;
          }
        }
        if (tRaw) {
          const parsed: PrepType[] = JSON.parse(tRaw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            nextTypes = needMigrate ? migrateTypesV2(parsed) : parsed;
          }
        }
        setSections(nextSections);
        setTypes(nextTypes);
        let finalList: HomemadePrep[] = [];
        if (raw) {
          const list: HomemadePrep[] = JSON.parse(raw).map((p: HomemadePrep) =>
            normalizePrep(p),
          );
          // 迁移时对"类型不在新体系中"的条目做关键词归组,其余跟随类型推断
          const migrated = needMigrate
            ? list.map((p) =>
                nextTypes.some((t) => t.key === p.type) || p.abvGroup
                  ? p
                  : {
                      ...p,
                      abvGroup: classifyPrepGroup({
                        name: p.name,
                        nameAlt: p.nameAlt,
                        ingredients: p.ingredients,
                        recipe: p.recipe,
                        notes: p.notes,
                      }),
                    },
              )
            : list;
          finalList = migrated;
          if (needMigrate) {
            AsyncStorage.setItem(PREPS_KEY, JSON.stringify(migrated)).catch(() => {});
            notifySyncChange(PREPS_KEY);
          }
        }
        // 《Waldorf》自制配料数据集:首次加载时一次性合入(按中/英名去重,幂等)
        {
          const waldorfDone = await AsyncStorage.getItem(WALDORF_PREPS_FLAG);
          if (!waldorfDone) {
            const names = new Set<string>();
            for (const p of finalList) {
              if (p.name) names.add(p.name.trim().toLowerCase());
              if (p.nameAlt) names.add(p.nameAlt.trim().toLowerCase());
            }
            const fresh = buildWaldorfPreps().filter(
              (p) =>
                !names.has(p.name.trim().toLowerCase()) &&
                !names.has(p.nameAlt.trim().toLowerCase()),
            );
            if (fresh.length > 0) {
              finalList = [...finalList, ...fresh];
              AsyncStorage.setItem(PREPS_KEY, JSON.stringify(finalList)).catch(() => {});
              notifySyncChange(PREPS_KEY);
            }
            AsyncStorage.setItem(WALDORF_PREPS_FLAG, "1").catch(() => {});
            notifySyncChange(WALDORF_PREPS_FLAG);
          }
        }
        // 《Waldorf》v2:书中完整做法回填存量空壳条目 + 归一去重 + 增补新条目(一次性,幂等)
        {
          const v2Done = await AsyncStorage.getItem(WALDORF_PREPS_V2_FLAG);
          if (!v2Done) {
            let changed = false;
            // 1) 存量空壳 builtin 条目(无配料且无做法)按名回填完整数据
            finalList = finalList.map((p) => {
              if (!p.builtin || p.ingredients.length > 0 || p.recipe.trim()) return p;
              const full = findFullPrepByName(p.name) ?? findFullPrepByName(p.nameAlt);
              if (!full) return p;
              changed = true;
              return {
                ...p,
                type: full.type,
                ingredients: full.ingredients,
                recipe: full.recipe,
                yield: full.yield,
                shelfLife: full.shelfLife,
                storage: full.storage,
                notes: p.notes && !full.notes.includes(p.notes) ? `${full.notes}\n${p.notes}` : full.notes,
                updatedAt: Date.now(),
              };
            });
            // 2) 回填后按"英文名|中文名"去重(保留用户自建/信息更全的一条)
            const seen = new Map<string, number>();
            const deduped: HomemadePrep[] = [];
            for (const p of finalList) {
              const key = `${p.name.trim().toLowerCase()}|${p.nameAlt.trim()}`;
              const prev = seen.get(key);
              if (prev === undefined) {
                seen.set(key, deduped.length);
                deduped.push(p);
              } else {
                const a = deduped[prev];
                const score = (x: HomemadePrep) =>
                  (x.builtin ? 0 : 4) + (x.recipe.trim() ? 1 : 0) + (x.ingredients.length ? 1 : 0);
                if (score(p) > score(a)) deduped[prev] = p;
                changed = true;
              }
            }
            finalList = deduped;
            // 3) 补入书中新提取、库内尚无的条目
            const names = new Set<string>();
            for (const p of finalList) {
              if (p.name) names.add(p.name.trim().toLowerCase());
              if (p.nameAlt) names.add(p.nameAlt.trim().toLowerCase());
            }
            const fresh = buildWaldorfPreps().filter(
              (p) =>
                !names.has(p.name.trim().toLowerCase()) &&
                !names.has(p.nameAlt.trim().toLowerCase()),
            );
            if (fresh.length > 0) {
              finalList = [...finalList, ...fresh];
              changed = true;
            }
            if (changed) {
              AsyncStorage.setItem(PREPS_KEY, JSON.stringify(finalList)).catch(() => {});
              notifySyncChange(PREPS_KEY);
            }
            AsyncStorage.setItem(WALDORF_PREPS_V2_FLAG, "1").catch(() => {});
            notifySyncChange(WALDORF_PREPS_V2_FLAG);
          }
        }
        // v3:notes 中来源类文字提取归入 source 字段,并从 notes 删除重复信息(一次性,幂等)
        {
          const v3Done = await AsyncStorage.getItem(PREP_SOURCE_V3_FLAG);
          if (!v3Done) {
            let changed = false;
            finalList = finalList.map((p) => {
              // builtin Waldorf 条目:统一补书籍来源
              const isWaldorf =
                p.builtin &&
                (/waldorf/i.test(p.notes) || /waldorf/i.test(p.source ?? "") || p.builtin);
              const [extracted, cleanedNotes] = extractSourceFromNotes(p.notes);
              let nextSource = p.source ?? "";
              let nextNotes = p.notes;
              if (extracted) {
                nextSource = nextSource
                  ? nextSource.includes(extracted)
                    ? nextSource
                    : `${nextSource} · ${extracted}`
                  : extracted;
                nextNotes = cleanedNotes;
              }
              if (!nextSource && isWaldorf && /waldorf/i.test(`${p.notes} ${p.recipe}`)) {
                nextSource = "The Waldorf Astoria Bar Book · Frank Caiafa";
              }
              if (nextSource !== (p.source ?? "") || nextNotes !== p.notes) {
                changed = true;
                return { ...p, source: nextSource, notes: nextNotes, updatedAt: Date.now() };
              }
              return p;
            });
            if (changed) {
              AsyncStorage.setItem(PREPS_KEY, JSON.stringify(finalList)).catch(() => {});
              notifySyncChange(PREPS_KEY);
            }
            AsyncStorage.setItem(PREP_SOURCE_V3_FLAG, "1").catch(() => {});
            notifySyncChange(PREP_SOURCE_V3_FLAG);
          }
        }
        setPreps(finalList);
        if (needMigrate) {
          AsyncStorage.setItem(SECTIONS_KEY, JSON.stringify(nextSections)).catch(() => {});
          notifySyncChange(SECTIONS_KEY);
          AsyncStorage.setItem(TYPES_KEY, JSON.stringify(nextTypes)).catch(() => {});
          notifySyncChange(TYPES_KEY);
          AsyncStorage.setItem(TAXONOMY_V2_KEY, "1").catch(() => {});
          notifySyncChange(TAXONOMY_V2_KEY);
        }
      } catch (e) {
        console.warn("Failed to load homemade preps", e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const persist = useCallback((list: HomemadePrep[]) => {
    setPreps(list);
    AsyncStorage.setItem(PREPS_KEY, JSON.stringify(list)).catch(() => {});
    notifySyncChange(PREPS_KEY);
  }, []);

  const persistSections = useCallback((list: PrepSection[]) => {
    setSections(list);
    AsyncStorage.setItem(SECTIONS_KEY, JSON.stringify(list)).catch(() => {});
    notifySyncChange(SECTIONS_KEY);
  }, []);

  const persistTypes = useCallback((list: PrepType[]) => {
    setTypes(list);
    AsyncStorage.setItem(TYPES_KEY, JSON.stringify(list)).catch(() => {});
    notifySyncChange(TYPES_KEY);
  }, []);

  const addPrep = useCallback<HomemadeStore["addPrep"]>(
    (p) => {
      const now = Date.now();
      const prep: HomemadePrep = normalizePrep({
        ...p,
        id: `prep-user-${now}-${Math.random().toString(36).slice(2, 7)}`,
        builtin: false,
        createdAt: now,
        updatedAt: now,
      });
      persist([prep, ...preps]);
      return prep;
    },
    [preps, persist],
  );

  const updatePrep = useCallback<HomemadeStore["updatePrep"]>(
    (id, patch) => {
      persist(
        preps.map((p) => (p.id === id ? { ...p, ...patch, id, updatedAt: Date.now() } : p)),
      );
    },
    [preps, persist],
  );

  const deletePrep = useCallback<HomemadeStore["deletePrep"]>(
    (id) => {
      persist(preps.filter((p) => p.id !== id));
    },
    [preps, persist],
  );

  /** 批量删除自制品 */
  const deletePreps = useCallback<HomemadeStore["deletePreps"]>(
    (ids) => {
      const set = new Set(ids);
      persist(preps.filter((p) => !set.has(p.id)));
    },
    [preps, persist],
  );

  /** 批量更新自制品字段(类型/分组等) */
  const bulkUpdatePreps = useCallback<HomemadeStore["bulkUpdatePreps"]>(
    (ids, patch) => {
      const set = new Set(ids);
      persist(
        preps.map((p) => (set.has(p.id) ? { ...p, ...patch, id: p.id, updatedAt: Date.now() } : p)),
      );
    },
    [preps, persist],
  );

  /** 切换自制品"做过/未做过"状态 */
  const togglePrepMade = useCallback<HomemadeStore["togglePrepMade"]>(
    (id) => {
      persist(
        preps.map((p) => (p.id === id ? { ...p, made: !p.made, updatedAt: Date.now() } : p)),
      );
    },
    [preps, persist],
  );

  /** 设置自制品评分(1-10 整数,null 清除) */
  const setPrepRating = useCallback<HomemadeStore["setPrepRating"]>(
    (id, rating) => {
      const v =
        typeof rating === "number" && isFinite(rating)
          ? Math.min(10, Math.max(1, Math.round(rating)))
          : null;
      persist(
        preps.map((p) => (p.id === id ? { ...p, rating: v, updatedAt: Date.now() } : p)),
      );
    },
    [preps, persist],
  );

  /** 手动覆盖条目的酒精属性分组(null 恢复自动推断) */
  const setPrepGroup = useCallback<HomemadeStore["setPrepGroup"]>(
    (id, group) => {
      persist(
        preps.map((p) =>
          p.id === id ? { ...p, abvGroup: group, updatedAt: Date.now() } : p,
        ),
      );
    },
    [preps, persist],
  );

  /** 长按拖拽后按新顺序写入 sortIndex */
  const reorderPreps = useCallback<HomemadeStore["reorderPreps"]>(
    (orderedIds) => {
      const pos = new Map(orderedIds.map((id, i) => [id, i]));
      persist(
        preps.map((p) => (pos.has(p.id) ? { ...p, sortIndex: pos.get(p.id)! } : p)),
      );
    },
    [preps, persist],
  );

  const importSamples = useCallback(() => {
    const existing = new Set(preps.map((p) => p.name.trim().toLowerCase()));
    const fresh = buildSamplePreps().filter(
      (p) => !existing.has(p.name.trim().toLowerCase()),
    );
    if (fresh.length > 0) {
      persist([...fresh, ...preps]);
      AsyncStorage.setItem(PREPS_SEEDED_KEY, "1").catch(() => {});
      notifySyncChange(PREPS_SEEDED_KEY);
    }
    return fresh.length;
  }, [preps, persist]);

  const getPrep = useCallback(
    (id: string | undefined) => preps.find((p) => p.id === id),
    [preps],
  );

  // ----- Section management -----
  const addSection = useCallback(
    (en: string, zh: string, group?: PrepGroup): PrepSection | null => {
      const enT = en.trim();
      const zhT = zh.trim();
      if (!enT && !zhT) return null;
      let key = slugify(enT || zhT);
      while (sections.some((s) => s.key === key)) key = `${key}-1`;
      const sec: PrepSection = {
        key,
        en: enT || zhT,
        zh: zhT || enT,
        group: group ?? "non_alcoholic",
      };
      persistSections([...sections, sec]);
      return sec;
    },
    [sections, persistSections],
  );

  const renameSection = useCallback(
    (key: string, en: string, zh: string) => {
      persistSections(
        sections.map((s) =>
          s.key === key
            ? { ...s, en: en.trim() || s.en, zh: zh.trim() || s.zh }
            : s,
        ),
      );
    },
    [sections, persistSections],
  );

  /** 调整分区的含酒精/无酒精归属 */
  const moveSection = useCallback(
    (key: string, group: PrepGroup) => {
      persistSections(sections.map((s) => (s.key === key ? { ...s, group } : s)));
    },
    [sections, persistSections],
  );

  const deleteSection = useCallback(
    (key: string) => {
      persistSections(sections.filter((s) => s.key !== key));
      // 该分区下类型移到"其他"分区(若删除的就是 misc 则保留为 misc 键,标签函数会回退)
      const fallback = key === "misc" ? sections.find((s) => s.key !== "misc")?.key ?? "misc" : "misc";
      persistTypes(types.map((t) => (t.section === key ? { ...t, section: fallback } : t)));
    },
    [sections, types, persistSections, persistTypes],
  );

  const reorderSections = useCallback(
    (orderedKeys: string[]) => {
      const map = new Map(sections.map((s) => [s.key, s]));
      const next: PrepSection[] = [];
      for (const k of orderedKeys) {
        const item = map.get(k);
        if (item) {
          next.push(item);
          map.delete(k);
        }
      }
      for (const rest of map.values()) next.push(rest);
      persistSections(next);
    },
    [sections, persistSections],
  );

  // ----- Type management -----
  const addType = useCallback(
    (en: string, zh: string, section: string): PrepType | null => {
      const enT = en.trim();
      const zhT = zh.trim();
      if (!enT && !zhT) return null;
      let key = slugify(enT || zhT);
      while (types.some((t) => t.key === key)) key = `${key}-1`;
      const typ: PrepType = { key, en: enT || zhT, zh: zhT || enT, section };
      persistTypes([...types, typ]);
      return typ;
    },
    [types, persistTypes],
  );

  const renameType = useCallback(
    (key: string, en: string, zh: string) => {
      persistTypes(
        types.map((t) =>
          t.key === key ? { ...t, en: en.trim() || t.en, zh: zh.trim() || t.zh } : t,
        ),
      );
    },
    [types, persistTypes],
  );

  const moveType = useCallback(
    (key: string, section: string) => {
      persistTypes(types.map((t) => (t.key === key ? { ...t, section } : t)));
    },
    [types, persistTypes],
  );

  const deleteType = useCallback(
    (key: string) => {
      persistTypes(types.filter((t) => t.key !== key));
      // 使用该类型的条目改为 other,避免悬空
      if (preps.some((p) => p.type === key)) {
        persist(preps.map((p) => (p.type === key ? { ...p, type: "other" } : p)));
      }
    },
    [types, preps, persistTypes, persist],
  );

  const reorderTypes = useCallback(
    (section: string, orderedKeys: string[]) => {
      const same = types.filter((t) => t.section === section);
      const map = new Map(same.map((t) => [t.key, t]));
      const reordered: PrepType[] = [];
      for (const k of orderedKeys) {
        const item = map.get(k);
        if (item) {
          reordered.push(item);
          map.delete(k);
        }
      }
      for (const rest of map.values()) reordered.push(rest);
      // 保持整体列表中非本分区类型的相对位置,本分区类型按新顺序放回
      let idx = 0;
      const next = types.map((t) => (t.section === section ? reordered[idx++] : t));
      persistTypes(next);
    },
    [types, persistTypes],
  );

  const value = useMemo(
    () => ({
      ready,
      preps,
      sections,
      types,
      addPrep,
      updatePrep,
      deletePrep,
      deletePreps,
      bulkUpdatePreps,
      togglePrepMade,
      setPrepRating,
      setPrepGroup,
      reorderPreps,
      importSamples,
      getPrep,
      addSection,
      renameSection,
      moveSection,
      deleteSection,
      reorderSections,
      addType,
      renameType,
      moveType,
      deleteType,
      reorderTypes,
    }),
    [
      ready,
      preps,
      sections,
      types,
      addPrep,
      updatePrep,
      deletePrep,
      deletePreps,
      bulkUpdatePreps,
      togglePrepMade,
      setPrepRating,
      setPrepGroup,
      reorderPreps,
      importSamples,
      getPrep,
      addSection,
      renameSection,
      moveSection,
      deleteSection,
      reorderSections,
      addType,
      renameType,
      moveType,
      deleteType,
      reorderTypes,
    ],
  );

  return <HomemadeContext.Provider value={value}>{children}</HomemadeContext.Provider>;
}

export function useHomemadeStore(): HomemadeStore {
  const ctx = useContext(HomemadeContext);
  if (!ctx) throw new Error("useHomemadeStore must be used within HomemadeProvider");
  return ctx;
}

export function filterPreps(
  preps: HomemadePrep[],
  query: string,
  type?: string,
  section?: string,
  typesList?: PrepType[],
): HomemadePrep[] {
  const q = query.trim().toLowerCase();
  const sectionOf = (typeKey: string) =>
    typesList
      ? typesList.find((t) => t.key === typeKey)?.section ?? prepSectionOf(typeKey)
      : prepSectionOf(typeKey);
  return preps.filter((p) => {
    if (type && p.type !== type) return false;
    if (section && sectionOf(p.type) !== section) return false;
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.nameAlt.toLowerCase().includes(q) ||
      p.type.toLowerCase().includes(q) ||
      p.ingredients.some((ing) => ing.toLowerCase().includes(q)) ||
      p.notes.toLowerCase().includes(q)
    );
  });
}
