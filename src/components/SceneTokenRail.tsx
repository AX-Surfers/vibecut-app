import { useCallback, useEffect, useRef, useState } from "react";
import type { Word } from "../types";
import { WordWaveformEditor } from "./WordWaveformEditor";

interface Props {
  words: Word[];
  isSelected?: boolean;
  activeWordId?: string | null;
  dropWarningWordIds?: Set<string>;
  suggestedWordIds?: Set<string>;
  onSelect?: () => void;
  onToggleWord: (wordId: string, start: number) => void;
  onSplitWord: (wordId: string, index: number) => void;
  onSeekWord?: (start: number) => void;
}

export function SceneTokenRail({
  words,
  isSelected,
  activeWordId,
  dropWarningWordIds,
  suggestedWordIds,
  onSelect,
  onToggleWord,
  onSplitWord,
  onSeekWord,
}: Props) {
  const tokenRailRef = useRef<HTMLDivElement>(null);
  const visibleWords = words.filter((word) => !word.deleted);
  const [caretIndex, setCaretIndex] = useState(visibleWords.length);
  const [editingWordId, setEditingWordId] = useState<string | null>(null);

  useEffect(() => {
    setCaretIndex((current) => Math.min(current, visibleWords.length));
  }, [visibleWords.length]);

  // 재생 중 activeWordId가 바뀌면 해당 토큰이 보이도록 스크롤만 수행 (캐럿은 이동하지 않음)
  useEffect(() => {
    if (!activeWordId) return;
    const idx = visibleWords.findIndex((w) => w.id === activeWordId);
    if (idx < 0) return;
    const rail = tokenRailRef.current;
    if (!rail) return;
    const slot = rail.children[idx] as HTMLElement | undefined;
    if (!slot) return;
    const btn = slot.querySelector("button");
    if (btn) btn.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeWordId, visibleWords]);

  const resolveCaretFromPoint = useCallback((clientX: number, clientY: number) => {
    const rail = tokenRailRef.current;
    if (!rail || rail.children.length === 0) return 0;

    let best = visibleWords.length;
    let bestDist = Infinity;
    Array.from(rail.children).forEach((child, index) => {
      const rect = (child as HTMLElement).getBoundingClientRect();
      if (clientY < rect.top || clientY > rect.bottom) return;

      const distBefore = Math.abs(clientX - rect.left);
      if (distBefore < bestDist) {
        bestDist = distBefore;
        best = index;
      }
      const distAfter = Math.abs(clientX - rect.right);
      if (distAfter < bestDist) {
        bestDist = distAfter;
        best = index + 1;
      }
    });
    return best;
  }, [visibleWords.length]);

  const seekToCaret = useCallback((index: number) => {
    if (index < visibleWords.length) {
      onSeekWord?.(visibleWords[index].start);
    } else if (visibleWords.length > 0) {
      onSeekWord?.(visibleWords[visibleWords.length - 1].end);
    }
  }, [visibleWords, onSeekWord]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      const next = Math.max(0, caretIndex - 1);
      setCaretIndex(next);
      seekToCaret(next);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      const next = Math.min(visibleWords.length, caretIndex + 1);
      setCaretIndex(next);
      seekToCaret(next);
      return;
    }

    if (event.key === "Backspace") {
      if (caretIndex === 0) return;
      event.preventDefault();
      const target = visibleWords[caretIndex - 1];
      if (!target) return;
      onToggleWord(target.id, target.start);
      setCaretIndex((current) => Math.max(0, current - 1));
      return;
    }

    if (event.key === "Delete") {
      if (caretIndex >= visibleWords.length) return;
      event.preventDefault();
      const target = visibleWords[caretIndex];
      if (!target) return;
      onToggleWord(target.id, target.start);
    }
  }, [caretIndex, onToggleWord, seekToCaret, visibleWords]);

  return (
    <div
      ref={tokenRailRef}
      className="scene-card__tokens"
      title="클릭: 커서 이동 · 우클릭: 해당 위치에서 씬 분할 · 좌우 화살표/Backspace/Delete 지원"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.();
        tokenRailRef.current?.focus();
        const next = resolveCaretFromPoint(event.clientX, event.clientY);
        setCaretIndex(next);
        seekToCaret(next);
      }}
      onKeyDown={handleKeyDown}
    >
      {visibleWords.map((word, index) => (
        <div key={word.id} className="scene-card__token-slot">
          {isSelected && caretIndex === index && <span className="scene-card__token-caret" aria-hidden="true" />}
          <button
            type="button"
            className={[
              "scene-card__token",
              word.id === activeWordId ? "scene-card__token--active" : "",
              dropWarningWordIds?.has(word.id) ? "scene-card__token--drop-warning" : "",
              suggestedWordIds?.has(word.id) ? "scene-card__token--suggested" : "",
            ].filter(Boolean).join(" ")}
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.();
              tokenRailRef.current?.focus();
              setCaretIndex(index + 1);
              onSeekWord?.(word.start);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              tokenRailRef.current?.focus();
              setCaretIndex(index);
              onSplitWord(word.id, index);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              setEditingWordId(word.id);
            }}
            title={`${word.start.toFixed(2)}s–${word.end.toFixed(2)}s (더블클릭: 파형으로 경계 조정)`}
          >
            {word.text}
          </button>
        </div>
      ))}
      {isSelected && caretIndex === visibleWords.length && <span className="scene-card__token-caret" aria-hidden="true" />}
      {editingWordId && (
        <WordWaveformEditor wordId={editingWordId} onClose={() => setEditingWordId(null)} />
      )}
    </div>
  );
}
