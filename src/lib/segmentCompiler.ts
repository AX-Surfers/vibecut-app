import type { Scene, KeepSpan } from "../types";

const GAP_MERGE_THRESHOLD_S = 0.05; // 50ms 이하 갭은 병합
const LINE_BREAK_GAP_THRESHOLD_S = 0.58;
const SOFT_LINE_LENGTH = 24;
const HARD_LINE_LENGTH = 38;
const MAX_WORDS_PER_LINE = 10;

/**
 * 씬 배열과 deleted 상태로부터 초 단위 keep-span 목록을 산출한다.
 * 프레임 스냅·드롭 판정은 Python 사이드카 권위 — 이 함수는 수행하지 않는다.
 */
export function compileKeepSpans(scenes: Scene[]): KeepSpan[] {
  // 1. 유지 단어를 시간 순으로 수집
  const kept: { start: number; end: number; wordId: string }[] = [];
  for (const scene of scenes) {
    for (const word of scene.words) {
      if (!word.deleted) {
        kept.push({ start: word.start, end: word.end, wordId: word.id });
      }
    }
  }

  if (kept.length === 0) return [];

  // 2. 인접 갭 병합
  const spans: KeepSpan[] = [];
  let current: KeepSpan = {
    inputIndex: 0,
    startSec: kept[0].start,
    endSec: kept[0].end,
    wordIds: [kept[0].wordId],
  };

  for (let i = 1; i < kept.length; i++) {
    const word = kept[i];
    if (word.start - current.endSec <= GAP_MERGE_THRESHOLD_S) {
      // 병합
      current.endSec = Math.max(current.endSec, word.end);
      current.wordIds.push(word.wordId);
    } else {
      spans.push(current);
      current = {
        inputIndex: spans.length,
        startSec: word.start,
        endSec: word.end,
        wordIds: [word.wordId],
      };
    }
  }
  spans.push(current);

  return spans;
}

/**
 * 씬의 유지 단어를 조합해 자막 텍스트를 반환한다.
 * subtitleOverride가 있으면 우선한다.
 */
export function buildSubtitleText(scene: Scene): string {
  if (scene.subtitleOverride !== undefined) return scene.subtitleOverride;
  return buildReadableSubtitleLines(scene).join("\n");
}

export function buildReadableSubtitleLines(scene: Scene): string[] {
  const words = scene.words.filter((word) => !word.deleted);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let currentWords: string[] = [];
  let currentLength = 0;

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const previous = words[index - 1];
    const gap = previous ? word.start - previous.end : 0;
    const next = words[index + 1];
    const prospectiveLength = currentLength === 0 ? word.text.length : currentLength + 1 + word.text.length;
    const shouldBreakBeforeWord =
      currentWords.length > 0 &&
      (
        gap >= LINE_BREAK_GAP_THRESHOLD_S ||
        currentWords.length >= MAX_WORDS_PER_LINE ||
        prospectiveLength >= HARD_LINE_LENGTH ||
        (prospectiveLength >= SOFT_LINE_LENGTH && previous && looksLikeSentenceBoundary(previous.text))
      );

    if (shouldBreakBeforeWord) {
      lines.push(currentWords.join(" "));
      currentWords = [];
      currentLength = 0;
    }

    currentWords.push(word.text);
    currentLength = currentLength === 0 ? word.text.length : currentLength + 1 + word.text.length;

    const shouldBreakAfterWord =
      currentWords.length > 0 &&
      (
        !next ||
        looksLikeSentenceBoundary(word.text) ||
        (next && next.start - word.end >= LINE_BREAK_GAP_THRESHOLD_S && currentLength >= 10)
      );

    if (shouldBreakAfterWord) {
      lines.push(currentWords.join(" "));
      currentWords = [];
      currentLength = 0;
    }
  }

  if (currentWords.length > 0) {
    lines.push(currentWords.join(" "));
  }

  return lines;
}

function looksLikeSentenceBoundary(text: string): boolean {
  return /[.!?…]$/.test(text) || /(요|죠|다|까|네|군요|거든요)$/.test(text);
}
