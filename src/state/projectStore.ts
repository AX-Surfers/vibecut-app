import { create } from "zustand";
import type { ProjectState } from "../types";

interface ProjectStoreState {
  projectPath: string | null;
  templatePath: string | null;
  capCutProjectPath: string | null; // legacy
  isDirty: boolean;
  setProjectPath: (path: string) => void;
  setTemplatePath: (path: string) => void;
  setCapCutProjectPath: (path: string) => void;
  markDirty: () => void;
  markClean: () => void;
  toProjectState: (
    sourceFile: string,
    videoFile: string,
    deletedWordIds: string[],
    subtitleOverrides: Record<string, string>
  ) => ProjectState;
}

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  projectPath: null,
  templatePath: null,
  capCutProjectPath: null,
  isDirty: false,

  setProjectPath: (path) => set({ projectPath: path }),
  setTemplatePath: (path) => set({ templatePath: path }),
  setCapCutProjectPath: (path) => set({ capCutProjectPath: path }),
  markDirty: () => set({ isDirty: true }),
  markClean: () => set({ isDirty: false }),

  toProjectState(sourceFile, videoFile, deletedWordIds, subtitleOverrides) {
    return {
      version: 1,
      sourceFile,
      videoFile,
      templatePath: get().templatePath ?? undefined,
      capCutProjectPath: get().capCutProjectPath ?? undefined,
      deletedWordIds,
      subtitleOverrides,
      lastModified: new Date().toISOString(),
    };
  },
}));
