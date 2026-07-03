import type { Scene, Word, WhisperSegment, KeepSpan } from "../types";

const LINE_BREAK_GAP_THRESHOLD_S = 0.58;
const SOFT_LINE_LENGTH = 18;
const HARD_LINE_LENGTH = 28;
const MAX_WORDS_PER_LINE = 8;

/**
 * 씬 배열과 deleted 상태로부터 초 단위 keep-span 목록을 산출한다.
 * 프레임 스냅·드롭 판정은 Python 사이드카 권위 — 이 함수는 수행하지 않는다.
 */
export function compileKeepSpans(scenes: Scene[]): KeepSpan[] {
  // 삭제된 단어를 만날 때만 span을 끊는다 — 씬 사이 자연스러운 침묵/포즈는
  // 실제 삭제가 아니므로 재생·내보내기 모두 이어서 처리해야 한다.
  const spans: KeepSpan[] = [];
  let current: KeepSpan | null = null;

  for (const scene of scenes) {
    for (const word of scene.words) {
      if (word.deleted) {
        if (current) {
          spans.push(current);
          current = null;
        }
        continue;
      }

      if (!current) {
        current = {
          inputIndex: spans.length,
          startSec: word.start,
          endSec: word.end,
          wordIds: [word.id],
        };
      } else {
        current.endSec = Math.max(current.endSec, word.end);
        current.wordIds.push(word.id);
      }
    }
  }

  if (current) spans.push(current);

  return spans;
}

/**
 * 미리보기 재생 전용 — 너무 짧은 삭제 구간(gap)은 실제로 건너뛰지 않고 이어서
 * 재생한다. 초 단위 seek는 키프레임 재탐색 비용이 커서, 아주 짧은 구간을
 * 정확히 건너뛰려다 오히려 버벅임(stutter)이 더 두드러지는 역효과가 난다.
 * 내보내기(export)는 이 함수를 거치지 않고 원본 compileKeepSpans 결과를 그대로 쓴다 —
 * 정확한 컷은 export 단계(ffmpeg)에서 보장된다.
 */
export function mergeTinyGaps(spans: KeepSpan[], minGapSec: number): KeepSpan[] {
  if (spans.length === 0) return spans;

  const merged: KeepSpan[] = [{ ...spans[0], wordIds: [...spans[0].wordIds] }];
  for (let i = 1; i < spans.length; i++) {
    const span = spans[i];
    const last = merged[merged.length - 1];
    if (span.startSec - last.endSec < minGapSec) {
      last.endSec = Math.max(last.endSec, span.endSec);
      last.wordIds.push(...span.wordIds);
    } else {
      merged.push({ ...span, wordIds: [...span.wordIds] });
    }
  }

  return merged;
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

  // 삭제된 단어를 걷어내면서 원본 인덱스를 같이 들고 있는다 — 두 유지 단어 사이에
  // 삭제된 단어가 끼어 있었다면(=컷으로 붙어버림) 원본 타임스탬프상의 공백은
  // 더 이상 실제 침묵이 아니므로 줄바꿈 판정에서 무시해야 한다.
  const originalIndex = new Map<string, number>();
  scene.words.forEach((w, idx) => originalIndex.set(w.id, idx));

  const lines: string[] = [];
  let currentWords: string[] = [];
  let currentLength = 0;

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const previous = words[index - 1];
    const wasAdjacentInSource =
      previous !== undefined &&
      (originalIndex.get(word.id) ?? 0) - (originalIndex.get(previous.id) ?? 0) === 1;
    const gap = previous && wasAdjacentInSource ? word.start - previous.end : 0;
    const next = words[index + 1];

    // 실제 침묵(원본에서 진짜 인접했던 두 유지 단어 사이의 긴 공백)은 "..."로 표시
    if (currentWords.length > 0 && gap >= LINE_BREAK_GAP_THRESHOLD_S) {
      currentWords.push("...");
      currentLength += 4;
    }

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

    const nextWasAdjacentInSource =
      next !== undefined &&
      (originalIndex.get(next.id) ?? 0) - (originalIndex.get(word.id) ?? 0) === 1;
    const shouldBreakAfterWord =
      currentWords.length > 0 &&
      (
        !next ||
        looksLikeSentenceBoundary(word.text) ||
        (next && nextWasAdjacentInSource && next.start - word.end >= LINE_BREAK_GAP_THRESHOLD_S && currentLength >= 10)
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

/**
 * Whisper 세그먼트 배열 → 씬 배열.
 * 자막 줄 나누기 기준(LINE_BREAK_GAP_THRESHOLD_S 등)과 동일한 조건으로 분할하여
 * 씬 1개 = 자막 1줄이 되도록 보장한다.
 */
export function buildScenesFromSegments(segments: WhisperSegment[], sourceFile: string): Scene[] {
  const allWords: Word[] = [];
  let wordCounter = 0;

  for (const segment of segments) {
    for (const w of segment.words) {
      const text = w.word.replace(/\s+/g, " ").trim();
      if (text.length > 0) {
        allWords.push({ id: `word-${wordCounter}`, text, start: w.start, end: w.end, deleted: false });
      }
      wordCounter++;
    }
  }

  if (allWords.length === 0) return [];

  const scenes: Scene[] = [];
  let currentWords: Word[] = [];
  let currentLength = 0;

  const pushScene = () => {
    if (currentWords.length === 0) return;
    scenes.push({
      id: `scene-${scenes.length}`,
      start: currentWords[0].start,
      end: currentWords[currentWords.length - 1].end,
      words: currentWords,
      thumbnailTime: currentWords[0].start,
      sourceFile,
    });
    currentWords = [];
    currentLength = 0;
  };

  for (let i = 0; i < allWords.length; i++) {
    const word = allWords[i];
    const previous = i > 0 ? allWords[i - 1] : null;
    const next = i < allWords.length - 1 ? allWords[i + 1] : null;
    const gap = previous ? word.start - previous.end : 0;
    const prospectiveLength = currentLength === 0 ? word.text.length : currentLength + 1 + word.text.length;

    const shouldBreakBefore =
      currentWords.length > 0 &&
      (gap >= LINE_BREAK_GAP_THRESHOLD_S ||
        currentWords.length >= MAX_WORDS_PER_LINE ||
        prospectiveLength >= HARD_LINE_LENGTH ||
        (prospectiveLength >= SOFT_LINE_LENGTH && previous !== null && looksLikeSentenceBoundary(previous.text)));

    if (shouldBreakBefore) pushScene();

    currentWords.push(word);
    currentLength = currentLength === 0 ? word.text.length : currentLength + 1 + word.text.length;

    const shouldBreakAfter =
      !next ||
      looksLikeSentenceBoundary(word.text) ||
      (next.start - word.end >= LINE_BREAK_GAP_THRESHOLD_S && currentLength >= 10);

    if (shouldBreakAfter) pushScene();
  }

  pushScene();
  return scenes;
}
