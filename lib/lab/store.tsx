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

import { genId } from "../recipes/types";
import { diffSpecs } from "./diff";
import {
  LabBatch,
  LabProject,
  LabProjectStatus,
  LabSpec,
  LabVerdict,
  normalizeLabBatch,
  normalizeLabProject,
} from "./types";

const PROJECTS_KEY = "cocktail.lab.projects";
const BATCHES_KEY = "cocktail.lab.batches";

export interface LabBatchDraft {
  spec: LabSpec;
  tastingNote: string;
  score: number | null;
  verdict: LabVerdict;
}

export interface LabProjectDraft {
  name: string;
  goal: string;
  templateId: string;
  baseRecipeId: string;
}

interface LabStore {
  ready: boolean;
  projects: LabProject[];
  batches: LabBatch[];
  addProject: (draft: LabProjectDraft, initialSpec?: LabSpec | null) => LabProject;
  updateProject: (id: string, patch: Partial<LabProject>) => void;
  setProjectStatus: (id: string, status: LabProjectStatus) => void;
  deleteProject: (id: string) => void;
  addBatch: (projectId: string, draft: LabBatchDraft) => LabBatch | null;
  updateBatch: (id: string, draft: Partial<LabBatchDraft>) => void;
  deleteBatch: (id: string) => void;
  /** 项目定稿:记录转正生成的配方 id 并标记 finalized */
  markFinalized: (projectId: string, recipeId: string) => void;
  getProject: (id: string | undefined) => LabProject | undefined;
  getBatch: (id: string | undefined) => LabBatch | undefined;
  batchesOf: (projectId: string | undefined) => LabBatch[];
}

const LabContext = createContext<LabStore | null>(null);

export function LabProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [projects, setProjects] = useState<LabProject[]>([]);
  const [batches, setBatches] = useState<LabBatch[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [pRaw, bRaw] = await Promise.all([
          AsyncStorage.getItem(PROJECTS_KEY),
          AsyncStorage.getItem(BATCHES_KEY),
        ]);
        const ps: LabProject[] = (pRaw ? JSON.parse(pRaw) : []).map(normalizeLabProject);
        const bs: LabBatch[] = (bRaw ? JSON.parse(bRaw) : []).map(normalizeLabBatch);
        setProjects(ps);
        setBatches(bs);
      } catch (e) {
        console.warn("Failed to load lab store", e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const persistProjects = useCallback((next: LabProject[]) => {
    setProjects(next);
    AsyncStorage.setItem(PROJECTS_KEY, JSON.stringify(next)).catch(() => {});
    notifySyncChange(PROJECTS_KEY);
  }, []);
  const persistBatches = useCallback((next: LabBatch[]) => {
    setBatches(next);
    AsyncStorage.setItem(BATCHES_KEY, JSON.stringify(next)).catch(() => {});
    notifySyncChange(BATCHES_KEY);
  }, []);

  const addProject = useCallback(
    (draft: LabProjectDraft, initialSpec?: LabSpec | null): LabProject => {
      const now = Date.now();
      const project = normalizeLabProject({
        id: genId(),
        name: draft.name.trim(),
        goal: draft.goal.trim(),
        templateId: draft.templateId,
        baseRecipeId: draft.baseRecipeId,
        status: "ideation",
        createdAt: now,
        updatedAt: now,
      });
      const nextProjects = [project, ...projects];
      persistProjects(nextProjects);
      if (initialSpec) {
        const batch = normalizeLabBatch({
          id: genId(),
          projectId: project.id,
          seq: 1,
          spec: initialSpec,
          createdAt: now,
          updatedAt: now,
        });
        persistBatches([...batches, batch]);
      }
      return project;
    },
    [projects, batches, persistProjects, persistBatches],
  );

  const updateProject = useCallback(
    (id: string, patch: Partial<LabProject>) => {
      persistProjects(
        projects.map((p) => (p.id === id ? { ...p, ...patch, id, updatedAt: Date.now() } : p)),
      );
    },
    [projects, persistProjects],
  );

  const setProjectStatus = useCallback(
    (id: string, status: LabProjectStatus) => {
      persistProjects(
        projects.map((p) => (p.id === id ? { ...p, status, updatedAt: Date.now() } : p)),
      );
    },
    [projects, persistProjects],
  );

  const deleteProject = useCallback(
    (id: string) => {
      persistProjects(projects.filter((p) => p.id !== id));
      persistBatches(batches.filter((b) => b.projectId !== id));
    },
    [projects, batches, persistProjects, persistBatches],
  );

  const addBatch = useCallback(
    (projectId: string, draft: LabBatchDraft): LabBatch | null => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return null;
      const projBatches = batches
        .filter((b) => b.projectId === projectId)
        .sort((a, b) => a.seq - b.seq);
      const prev = projBatches[projBatches.length - 1] ?? null;
      const now = Date.now();
      const batch = normalizeLabBatch({
        id: genId(),
        projectId,
        seq: (prev?.seq ?? 0) + 1,
        parentBatchId: prev?.id ?? "",
        spec: draft.spec,
        changes: diffSpecs(prev?.spec ?? null, draft.spec),
        tastingNote: draft.tastingNote.trim(),
        score: draft.score,
        verdict: draft.verdict,
        tastedAt: draft.tastingNote.trim() || draft.score !== null ? now : 0,
        createdAt: now,
        updatedAt: now,
      });
      persistBatches([...batches, batch]);
      // 有批次即进入试验中
      if (project.status === "ideation") {
        persistProjects(
          projects.map((p) =>
            p.id === projectId ? { ...p, status: "testing" as const, updatedAt: now } : p,
          ),
        );
      }
      return batch;
    },
    [projects, batches, persistProjects, persistBatches],
  );

  const updateBatch = useCallback(
    (id: string, draft: Partial<LabBatchDraft>) => {
      const target = batches.find((b) => b.id === id);
      if (!target) return;
      const now = Date.now();
      persistBatches(
        batches.map((b) => {
          if (b.id !== id) return b;
          const nextSpec = draft.spec ?? b.spec;
          // spec 变化时基于 parent 批次重新 diff
          let changes = b.changes;
          if (draft.spec) {
            const parent = batches.find((x) => x.id === b.parentBatchId) ?? null;
            changes = diffSpecs(parent?.spec ?? null, nextSpec);
          }
          const note = draft.tastingNote !== undefined ? draft.tastingNote.trim() : b.tastingNote;
          const score = draft.score !== undefined ? draft.score : b.score;
          return {
            ...b,
            spec: nextSpec,
            changes,
            tastingNote: note,
            score,
            verdict: draft.verdict !== undefined ? draft.verdict : b.verdict,
            tastedAt: b.tastedAt || (note || score !== null ? now : 0),
            updatedAt: now,
          };
        }),
      );
    },
    [batches, persistBatches],
  );

  const deleteBatch = useCallback(
    (id: string) => {
      persistBatches(batches.filter((b) => b.id !== id));
    },
    [batches, persistBatches],
  );

  const markFinalized = useCallback(
    (projectId: string, recipeId: string) => {
      persistProjects(
        projects.map((p) =>
          p.id === projectId
            ? { ...p, status: "finalized" as const, finalizedRecipeId: recipeId, updatedAt: Date.now() }
            : p,
        ),
      );
    },
    [projects, persistProjects],
  );

  const getProject = useCallback(
    (id: string | undefined) => (id ? projects.find((p) => p.id === id) : undefined),
    [projects],
  );
  const getBatch = useCallback(
    (id: string | undefined) => (id ? batches.find((b) => b.id === id) : undefined),
    [batches],
  );
  const batchesOf = useCallback(
    (projectId: string | undefined) =>
      projectId
        ? batches.filter((b) => b.projectId === projectId).sort((a, b) => a.seq - b.seq)
        : [],
    [batches],
  );

  const value = useMemo(
    () => ({
      ready,
      projects,
      batches,
      addProject,
      updateProject,
      setProjectStatus,
      deleteProject,
      addBatch,
      updateBatch,
      deleteBatch,
      markFinalized,
      getProject,
      getBatch,
      batchesOf,
    }),
    [
      ready,
      projects,
      batches,
      addProject,
      updateProject,
      setProjectStatus,
      deleteProject,
      addBatch,
      updateBatch,
      deleteBatch,
      markFinalized,
      getProject,
      getBatch,
      batchesOf,
    ],
  );

  return <LabContext.Provider value={value}>{children}</LabContext.Provider>;
}

export function useLabStore(): LabStore {
  const ctx = useContext(LabContext);
  if (!ctx) throw new Error("useLabStore must be used within LabProvider");
  return ctx;
}
