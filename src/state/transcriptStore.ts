import { create } from "zustand";
import type { Scene, Word, WhisperSegment } from "../types";
import { buildScenesFromSegments } from "../lib/segmentCompiler";

interface TranscriptState {
  scenes: Scene[];
  sourceFile: string;
  videoFile: string;
  selectedSceneId: string | null;
  subtitleDrafts: Record<string, string>;
  loadFromJson: (
    segments: WhisperSegment[],
    sourceFile: string,
    videoFile: string,
    keepSpans?: [number, number][]
  ) => void;
  loadFromSaved: (scenes: Scene[], sourceFile: string, videoFile: string) => void;
  toggleWord: (wordId: string) => void;
  setWordTiming: (wordId: string, start: number, end: number) => void;
  splitWordAt: (wordId: string, splitTime: number, discard: "left" | "right") => void;
  getAdjacentWords: (wordId: string) => { prev: Word | null; next: Word | null };
  setWordDeleted: (wordIds: string[], deleted: boolean) => void;
  clearDeletedWords: () => void;
  deleteScene: (sceneId: string) => void;
  restoreScene: (sceneId: string) => void;
  setSubtitleOverride: (sceneId: string, text: string) => void;
  setSelectedSceneId: (sceneId: string | null) => void;
  setSubtitleDraft: (sceneId: string, text: string) => void;
  clearSubtitleDraft: (sceneId: string) => void;
  getScene: (sceneId: string) => Scene | undefined;
  splitScene: (sceneId: string, splitWordId: string) => void;
  mergeWithNext: (sceneId: string) => void;
  mergeWithPrevious: (sceneId: string) => void;
}

export const useTranscriptStore = create<TranscriptState>((set, get) => ({
  scenes: [],
  sourceFile: "",
  videoFile: "",
  selectedSceneId: null,
  subtitleDrafts: {},

  loadFromJson(segments, sourceFile, videoFile, keepSpans) {
    let scenes = buildScenesFromSegments(segments, sourceFile);
    if (keepSpans && keepSpans.length > 0) {
      scenes = scenes.map((scene) => ({
        ...scene,
        words: scene.words.map((word) => {
          const midpoint = (word.start + word.end) / 2;
          const kept = keepSpans.some(([start, end]) => midpoint >= start && midpoint <= end);
          return kept ? word : { ...word, deleted: true };
        }),
      }));
    }
    set({
      scenes,
      sourceFile,
      videoFile,
      selectedSceneId: scenes[0]?.id ?? null,
      subtitleDrafts: {},
    });
  },

  loadFromSaved(scenes, sourceFile, videoFile) {
    set({
      scenes,
      sourceFile,
      videoFile,
      selectedSceneId: scenes[0]?.id ?? null,
      subtitleDrafts: {},
    });
  },

  toggleWord(wordId) {
    set((state) => ({
      scenes: state.scenes.map((scene) => {
        let touched = false;
        const words = scene.words.map((w) => {
          if (w.id !== wordId) return w;
          touched = true;
          return { ...w, deleted: !w.deleted };
        });

        return touched ? { ...scene, words, subtitleOverride: undefined } : scene;
      }),
    }));
  },

  setWordTiming(wordId, start, end) {
    set((state) => ({
      scenes: state.scenes.map((scene) => {
        const idx = scene.words.findIndex((w) => w.id === wordId);
        if (idx === -1) return scene;

        const words = scene.words.map((w, i) => (i === idx ? { ...w, start, end } : w));
        const patch: Partial<Scene> = { words };
        if (idx === 0) patch.start = start;
        if (idx === words.length - 1) patch.end = end;
        return { ...scene, ...patch, subtitleOverride: undefined };
      }),
    }));
  },

  splitWordAt(wordId, splitTime, discard) {
    set((state) => ({
      scenes: state.scenes.map((scene) => {
        const idx = scene.words.findIndex((w) => w.id === wordId);
        if (idx === -1) return scene;

        const word = scene.words[idx];
        if (splitTime <= word.start || splitTime >= word.end) return scene;

        const left: Word = { ...word, id: `${word.id}-a`, end: splitTime, deleted: discard === "left" };
        const right: Word = { ...word, id: `${word.id}-b`, start: splitTime, deleted: discard === "right" };

        const words = [...scene.words];
        words.splice(idx, 1, left, right);
        return { ...scene, words, subtitleOverride: undefined };
      }),
    }));
  },

  getAdjacentWords(wordId) {
    const flat = get().scenes.flatMap((scene) => scene.words);
    const idx = flat.findIndex((w) => w.id === wordId);
    if (idx === -1) return { prev: null, next: null };
    return {
      prev: idx > 0 ? flat[idx - 1] : null,
      next: idx < flat.length - 1 ? flat[idx + 1] : null,
    };
  },

  setWordDeleted(wordIds, deleted) {
    const targetIds = new Set(wordIds);
    set((state) => ({
      scenes: state.scenes.map((scene) => {
        let touched = false;
        const words = scene.words.map((word) => {
          if (!targetIds.has(word.id)) return word;
          touched = true;
          return { ...word, deleted };
        });

        return touched ? { ...scene, words, subtitleOverride: undefined } : scene;
      }),
    }));
  },

  clearDeletedWords() {
    set((state) => ({
      scenes: state.scenes.map((scene) => {
        let touched = false;
        const words = scene.words.map((word) => {
          if (!word.deleted) return word;
          touched = true;
          return { ...word, deleted: false };
        });

        return touched ? { ...scene, words, subtitleOverride: undefined } : scene;
      }),
    }));
  },

  deleteScene(sceneId) {
    set((state) => ({
      scenes: state.scenes.map((scene) => {
        if (scene.id !== sceneId) return scene;
        return { ...scene, words: scene.words.map((w) => ({ ...w, deleted: true })), subtitleOverride: undefined };
      }),
    }));
  },

  restoreScene(sceneId) {
    set((state) => ({
      scenes: state.scenes.map((scene) => {
        if (scene.id !== sceneId) return scene;
        return { ...scene, words: scene.words.map((w) => ({ ...w, deleted: false })), subtitleOverride: undefined };
      }),
    }));
  },

  setSubtitleOverride(sceneId, text) {
    set((state) => ({
      scenes: state.scenes.map((s) =>
        s.id === sceneId ? { ...s, subtitleOverride: text } : s
      ),
    }));
  },

  setSelectedSceneId(sceneId) {
    set({ selectedSceneId: sceneId });
  },

  setSubtitleDraft(sceneId, text) {
    set((state) => ({
      subtitleDrafts: {
        ...state.subtitleDrafts,
        [sceneId]: text,
      },
    }));
  },

  clearSubtitleDraft(sceneId) {
    set((state) => {
      if (!(sceneId in state.subtitleDrafts)) return state;
      const nextDrafts = { ...state.subtitleDrafts };
      delete nextDrafts[sceneId];
      return { subtitleDrafts: nextDrafts };
    });
  },

  getScene(sceneId) {
    return get().scenes.find((s) => s.id === sceneId);
  },

  splitScene(sceneId, splitWordId) {
    set((state) => {
      const idx = state.scenes.findIndex((s) => s.id === sceneId);
      if (idx === -1) return state;
      const scene = state.scenes[idx];
      const splitIdx = scene.words.findIndex((w) => w.id === splitWordId);
      if (splitIdx <= 0) return state; // 첫 번째 단어에서는 분할 불가
      const wordsA = scene.words.slice(0, splitIdx);
      const wordsB = scene.words.slice(splitIdx);
      const sceneA: Scene = { ...scene, end: wordsB[0].start, words: wordsA };
      const sceneB: Scene = {
        ...scene,
        id: `${scene.id}-split-${splitIdx}`,
        start: wordsB[0].start,
        words: wordsB,
        thumbnailTime: wordsB[0].start,
        subtitleOverride: undefined,
      };
      const next = [...state.scenes];
      next.splice(idx, 1, sceneA, sceneB);
      const nextDrafts = { ...state.subtitleDrafts };
      delete nextDrafts[scene.id];
      return {
        scenes: next,
        selectedSceneId: sceneA.id,
        subtitleDrafts: nextDrafts,
      };
    });
  },

  mergeWithNext(sceneId) {
    set((state) => {
      const idx = state.scenes.findIndex((s) => s.id === sceneId);
      if (idx === -1 || idx >= state.scenes.length - 1) return state;
      const a = state.scenes[idx];
      const b = state.scenes[idx + 1];
      const merged: Scene = {
        ...a,
        end: b.end,
        words: [...a.words, ...b.words],
        subtitleOverride: undefined,
      };
      const next = [...state.scenes];
      next.splice(idx, 2, merged);
      const nextDrafts = { ...state.subtitleDrafts };
      delete nextDrafts[a.id];
      delete nextDrafts[b.id];
      return { scenes: next, selectedSceneId: merged.id, subtitleDrafts: nextDrafts };
    });
  },

  mergeWithPrevious(sceneId) {
    set((state) => {
      const idx = state.scenes.findIndex((s) => s.id === sceneId);
      if (idx <= 0) return state;
      const prev = state.scenes[idx - 1];
      const current = state.scenes[idx];
      const merged: Scene = {
        ...prev,
        end: current.end,
        words: [...prev.words, ...current.words],
        subtitleOverride: undefined,
      };
      const next = [...state.scenes];
      next.splice(idx - 1, 2, merged);
      const nextDrafts = { ...state.subtitleDrafts };
      delete nextDrafts[prev.id];
      delete nextDrafts[current.id];
      return { scenes: next, selectedSceneId: merged.id, subtitleDrafts: nextDrafts };
    });
  },
}));

