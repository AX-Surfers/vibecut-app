import { useCallback, useEffect, useRef, useState } from "react";
import type { Word } from "../types";

interface Props {
  words: Word[];
  isSelected?: boolean;
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

  useEffect(() => {
    setCaretIndex((current) => Math.min(current, visibleWords.length));
  }, [visibleWords.length]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setCaretIndex((current) => Math.max(0, current - 1));
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      setCaretIndex((current) => Math.min(visibleWords.length, current + 1));
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
  }, [caretIndex, onToggleWord, visibleWords]);

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
        setCaretIndex(visibleWords.length);
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
            title={`${word.start.toFixed(2)}s–${word.end.toFixed(2)}s`}
          >
            {word.text}
          </button>
        </div>
      ))}
      {isSelected && caretIndex === visibleWords.length && <span className="scene-card__token-caret" aria-hidden="true" />}
    </div>
  );
}
