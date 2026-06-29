import type { Scene } from "../types";

export interface AutoEditSuggestion {
  sceneId: string;
  reason: "explicit_retry" | "adjacent_duplicate" | "self_repeat" | "short_restart";
  score: number;
}

const RETRY_CUES = ["다시", "잠깐", "잠시만", "아니", "죄송", "정정", "말씀드리면"];

function normalizeWord(text: string): string {
  return text.replace(/[^\p{L}\p{N}]+/gu, "").trim();
}

function getKeptTokens(scene: Scene): string[] {
  return scene.words
    .filter((word) => !word.deleted)
    .map((word) => normalizeWord(word.text))
    .filter(Boolean);
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const aSet = new Set(a);
  const bSet = new Set(b);
  let intersection = 0;
  for (const token of aSet) {
    if (bSet.has(token)) intersection += 1;
  }
  return intersection / (aSet.size + bSet.size - intersection);
}

function hasSelfRepeat(tokens: string[]): boolean {
  if (tokens.length < 4) return false;
  for (let size = 1; size <= 3; size += 1) {
    for (let i = 0; i + size * 2 <= tokens.length; i += 1) {
      const left = tokens.slice(i, i + size).join(" ");
      const right = tokens.slice(i + size, i + size * 2).join(" ");
      if (left && left === right) {
        return true;
      }
    }
  }
  return false;
}

export function analyzeScenesForAutoEdit(scenes: Scene[]): AutoEditSuggestion[] {
  const suggestions = new Map<string, AutoEditSuggestion>();

  const upsert = (next: AutoEditSuggestion) => {
    const prev = suggestions.get(next.sceneId);
    if (!prev || next.score > prev.score) {
      suggestions.set(next.sceneId, next);
    }
  };

  for (let index = 0; index < scenes.length; index += 1) {
    const current = scenes[index];
    const currentTokens = getKeptTokens(current);
    const currentText = currentTokens.join(" ");
    const duration = current.end - current.start;

    if (currentTokens.some((token) => RETRY_CUES.includes(token))) {
      upsert({
        sceneId: current.id,
        reason: "explicit_retry",
        score: 0.95,
      });
      if (index > 0) {
        upsert({
          sceneId: scenes[index - 1].id,
          reason: "explicit_retry",
          score: 0.8,
        });
      }
    }

    if (hasSelfRepeat(currentTokens)) {
      upsert({
        sceneId: current.id,
        reason: "self_repeat",
        score: 0.88,
      });
    }

    const next = scenes[index + 1];
    if (!next) continue;

    const nextTokens = getKeptTokens(next);
    const similarity = jaccard(currentTokens, nextTokens);

    if (similarity >= 0.72 && currentText.length > 0 && nextTokens.length > 0) {
      upsert({
        sceneId: current.id,
        reason: "adjacent_duplicate",
        score: similarity,
      });
      continue;
    }

    const currentIsShort = duration <= 1.4 && currentTokens.length <= 5;
    const nextText = nextTokens.join(" ");
    const contained =
      currentText.length >= 2 &&
      nextText.length >= currentText.length &&
      nextText.includes(currentText);

    if (currentIsShort && (similarity >= 0.45 || contained)) {
      upsert({
        sceneId: current.id,
        reason: "short_restart",
        score: contained ? 0.78 : similarity,
      });
    }
  }

  return [...suggestions.values()].sort((a, b) => b.score - a.score);
}
