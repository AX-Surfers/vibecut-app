import { create } from "zustand";
import type { Scene, Word, WhisperSegment } from "../types";

const SCENE_SPLIT_GAP_THRESHOLD_S = 0.82;
const SCENE_MERGE_GAP_THRESHOLD_S = 0.32;
const SCENE_MAX_DURATION_S = 7.5;
const SCENE_MAX_WORDS = 18;
const SCENE_TARGET_TEXT_LENGTH = 34;

interface TranscriptState {
  scenes: Scene[];
  sourceFile: string;
  videoFile: string;
  selectedSceneId: string | null;
  subtitleDrafts: Record<string, string>;
  loadFromJson: (segments: WhisperSegment[], sourceFile: string, videoFile: string) => void;
  toggleWord: (wordId: string) => void;
  setWordDeleted: (wordIds: string[], deleted: boolean) => void;
  clearDeletedWords: () => void;
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

  loadFromJson(segments, sourceFile, videoFile) {
    const scenes = buildScenesFromSegments(segments, sourceFile);
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

function buildScenesFromSegments(segments: WhisperSegment[], sourceFile: string): Scene[] {
  const scenes: Scene[] = [];
  let currentWords: Word[] = [];
  let currentStart = 0;
  let currentEnd = 0;
  let globalWordIndex = 0;

  const pushScene = () => {
    if (currentWords.length === 0) return;
    const sceneIndex = scenes.length;
    scenes.push({
      id: `scene-${sceneIndex}`,
      start: currentStart,
      end: currentEnd,
      words: currentWords,
      thumbnailTime: currentStart,
      sourceFile,
    });
    currentWords = [];
  };

  for (const segment of segments) {
    const words = segment.words
      .map((word, index) => ({
        index,
        text: normalizeWordText(word.word),
        start: word.start,
        end: word.end,
      }))
      .filter((word) => word.text.length > 0)
      .map((word) => ({
        id: `word-${globalWordIndex + word.index}`,
        start: word.start,
        end: word.end,
        text: word.text,
        deleted: false,
      }));

    globalWordIndex += segment.words.length;
    if (words.length === 0) continue;

    if (currentWords.length === 0) {
      currentWords = words;
      currentStart = words[0].start;
      currentEnd = words[words.length - 1].end;
      continue;
    }

    const gap = words[0].start - currentEnd;
    const currentText = currentWords.map((word) => word.text).join(" ");
    const shouldSplit =
      gap >= SCENE_SPLIT_GAP_THRESHOLD_S ||
      currentWords.length >= SCENE_MAX_WORDS ||
      currentEnd - currentStart >= SCENE_MAX_DURATION_S ||
      (gap >= SCENE_MERGE_GAP_THRESHOLD_S && currentText.length >= SCENE_TARGET_TEXT_LENGTH) ||
      endsWithSentenceTone(currentText);

    if (shouldSplit) {
      pushScene();
      currentWords = words;
      currentStart = words[0].start;
      currentEnd = words[words.length - 1].end;
      continue;
    }

    currentWords = [...currentWords, ...words];
    currentEnd = words[words.length - 1].end;
  }

  pushScene();
  return scenes;
}

function normalizeWordText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function endsWithSentenceTone(text: string): boolean {
  return /[.!?…]$/.test(text) || /(요|죠|다|까|네|군요|거든요)$/.test(text);
}
