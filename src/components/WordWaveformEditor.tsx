import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useTranscriptStore } from "../state/transcriptStore";
import { useVideoStore } from "../state/videoStore";
import type { WaveformResult } from "../types";

interface Props {
  wordId: string;
  onClose: () => void;
}

const CONTEXT_PADDING_SEC = 0.6;
const MIN_WORD_DURATION_SEC = 0.05;

export function WordWaveformEditor({ wordId, onClose }: Props) {
  const videoFile = useTranscriptStore((s) => s.videoFile);
  const scenes = useTranscriptStore((s) => s.scenes);
  const setWordTiming = useTranscriptStore((s) => s.setWordTiming);
  const splitWordAt = useTranscriptStore((s) => s.splitWordAt);
  const getAdjacentWords = useTranscriptStore((s) => s.getAdjacentWords);
  const seekTo = useVideoStore((s) => s.seekTo);
  const play = useVideoStore((s) => s.play);
  const pause = useVideoStore((s) => s.pause);

  const word = useMemo(
    () => scenes.flatMap((s) => s.words).find((w) => w.id === wordId) ?? null,
    [scenes, wordId]
  );
  const { prev, next } = useMemo(() => getAdjacentWords(wordId), [getAdjacentWords, wordId]);

  const [draftStart, setDraftStart] = useState(word?.start ?? 0);
  const [draftEnd, setDraftEnd] = useState(word?.end ?? 0);
  const [cursorTime, setCursorTime] = useState<number | null>(null);
  const [waveform, setWaveform] = useState<WaveformResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<"start" | "end" | null>(null);
  const didDragRef = useRef(false);

  const contextStart = Math.max(0, prev ? prev.end : (word?.start ?? 0) - CONTEXT_PADDING_SEC);
  const contextEnd = next ? next.start : (word?.end ?? 0) + CONTEXT_PADDING_SEC;

  useEffect(() => {
    if (!word) return;
    setDraftStart(word.start);
    setDraftEnd(word.end);
    setCursorTime(null);
  }, [word]);

  // 드래그로 경계가 바뀌어 커서가 범위를 벗어나면 커서를 치운다
  useEffect(() => {
    if (cursorTime !== null && (cursorTime <= draftStart || cursorTime >= draftEnd)) {
      setCursorTime(null);
    }
  }, [cursorTime, draftStart, draftEnd]);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!videoFile || !word) return;
    let cancelled = false;
    invoke<string>("extract_waveform", {
      videoPath: videoFile,
      startSec: contextStart,
      endSec: contextEnd,
      columns: 400,
    })
      .then((raw) => {
        if (cancelled) return;
        setWaveform(JSON.parse(raw) as WaveformResult);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoFile, word?.id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveform) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const span = contextEnd - contextStart || 1;
    const startRatio = (draftStart - contextStart) / span;
    const endRatio = (draftEnd - contextStart) / span;

    const mid = height / 2;
    const barWidth = width / waveform.peaks.length;

    waveform.peaks.forEach(([min, max], i) => {
      const x = i * barWidth;
      const ratio = i / waveform.peaks.length;
      const inWord = ratio >= startRatio && ratio <= endRatio;
      ctx.fillStyle = inWord ? "#2f6fed" : "rgba(47, 111, 237, 0.28)";
      const top = mid - max * mid * 0.9;
      const barHeight = Math.max(1, (max - min) * mid * 0.9);
      ctx.fillRect(x, top, Math.max(1, barWidth - 1), barHeight);
    });
  }, [waveform, draftStart, draftEnd, contextStart, contextEnd]);

  const clampStart = useCallback(
    (t: number) => {
      const min = prev ? prev.end : contextStart;
      const max = draftEnd - MIN_WORD_DURATION_SEC;
      return Math.min(Math.max(t, min), max);
    },
    [prev, contextStart, draftEnd]
  );

  const clampEnd = useCallback(
    (t: number) => {
      const min = draftStart + MIN_WORD_DURATION_SEC;
      const max = next ? next.start : contextEnd;
      return Math.max(Math.min(t, max), min);
    },
    [next, contextEnd, draftStart]
  );

  const posToTime = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return contextStart;
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return contextStart + ratio * (contextEnd - contextStart);
    },
    [contextStart, contextEnd]
  );

  const handlePointerDown = useCallback(
    (handle: "start" | "end") => (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      draggingRef.current = handle;
      didDragRef.current = true;

      const handleMove = (moveEvent: PointerEvent) => {
        const t = posToTime(moveEvent.clientX);
        if (draggingRef.current === "start") setDraftStart(clampStart(t));
        else if (draggingRef.current === "end") setDraftEnd(clampEnd(t));
      };
      const handleUp = () => {
        draggingRef.current = null;
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        // click 이벤트가 pointerup 직후에 뜨므로, 한 틱 뒤에 풀어줘야
        // 드래그 종료가 트랙 클릭(커서 놓기)으로 오인되지 않는다.
        setTimeout(() => {
          didDragRef.current = false;
        }, 0);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [posToTime, clampStart, clampEnd]
  );

  // 트랙 클릭 → 그 지점에 커서를 놓는다 (좌우 나누기 기준점)
  const handleTrackClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (didDragRef.current) return;
      const t = posToTime(event.clientX);
      const min = draftStart + MIN_WORD_DURATION_SEC;
      const max = draftEnd - MIN_WORD_DURATION_SEC;
      if (min >= max) return;
      setCursorTime(Math.min(Math.max(t, min), max));
    },
    [posToTime, draftStart, draftEnd]
  );

  // 커서 지점에서 단어를 둘로 나누고, 버린 쪽을 실제 삭제 단어로 표시한다.
  // (경계만 좁히는 방식은 compileKeepSpans가 "삭제 안 된 단어" 사이 간격을
  // 그대로 이어붙이기 때문에 실제로 영상이 잘리지 않는다 — 진짜 컷을 만들려면
  // 삭제된 단어가 그 자리에 있어야 한다.)
  const handleSplit = useCallback(
    (discard: "left" | "right") => {
      if (cursorTime === null) return;
      pause?.();
      if (draftStart !== word?.start || draftEnd !== word?.end) {
        setWordTiming(wordId, draftStart, draftEnd);
      }
      splitWordAt(wordId, cursorTime, discard);
      onClose();
    },
    [cursorTime, pause, draftStart, draftEnd, word, setWordTiming, splitWordAt, wordId, onClose]
  );

  useEffect(() => {
    if (!isPreviewPlaying) return;
    return useVideoStore.subscribe((state) => {
      if (state.currentTime >= draftEnd) {
        pause?.();
        setIsPreviewPlaying(false);
      }
    });
  }, [isPreviewPlaying, draftEnd, pause]);

  const handlePlayPreview = useCallback(() => {
    seekTo?.(draftStart);
    play?.();
    setIsPreviewPlaying(true);
  }, [seekTo, play, draftStart]);

  const handleReset = useCallback(() => {
    if (!word) return;
    setDraftStart(word.start);
    setDraftEnd(word.end);
  }, [word]);

  const handleCommit = useCallback(() => {
    pause?.();
    setWordTiming(wordId, draftStart, draftEnd);
    onClose();
  }, [pause, setWordTiming, wordId, draftStart, draftEnd, onClose]);

  const handleCancel = useCallback(() => {
    pause?.();
    onClose();
  }, [pause, onClose]);

  if (!word) return null;

  const span = contextEnd - contextStart || 1;
  const startPct = ((draftStart - contextStart) / span) * 100;
  const endPct = ((draftEnd - contextStart) / span) * 100;

  return createPortal(
    <div className="waveform-editor-overlay" onClick={handleCancel}>
      <div
        ref={rootRef}
        className="waveform-editor"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") handleCancel();
          if (e.key === "Enter") handleCommit();
        }}
        tabIndex={-1}
      >
        <div className="waveform-editor__header">
          <span className="waveform-editor__word">{word.text}</span>
          <span className="waveform-editor__duration">{(draftEnd - draftStart).toFixed(2)}초</span>
        </div>

        <div className="waveform-editor__context">
          <span className="waveform-editor__neighbor">{prev ? prev.text : ""}</span>
          <span className="waveform-editor__neighbor waveform-editor__neighbor--next">{next ? next.text : ""}</span>
        </div>

        <div className="waveform-editor__track" ref={trackRef} onClick={handleTrackClick}>
          <canvas ref={canvasRef} className="waveform-editor__canvas" />
          <div className="waveform-editor__dim" style={{ left: 0, width: `${startPct}%` }} />
          <div className="waveform-editor__dim" style={{ left: `${endPct}%`, right: 0, width: "auto" }} />
          <button
            type="button"
            className="waveform-editor__handle waveform-editor__handle--start"
            style={{ left: `${startPct}%` }}
            onPointerDown={handlePointerDown("start")}
            onClick={(e) => e.stopPropagation()}
            aria-label="시작 지점 조절"
          />
          <button
            type="button"
            className="waveform-editor__handle waveform-editor__handle--end"
            style={{ left: `${endPct}%` }}
            onPointerDown={handlePointerDown("end")}
            onClick={(e) => e.stopPropagation()}
            aria-label="끝 지점 조절"
          />
          {cursorTime !== null && (
            <>
              <div
                className="waveform-editor__cursor"
                style={{ left: `${((cursorTime - contextStart) / span) * 100}%` }}
              />
              <div
                className="waveform-editor__cursor-actions"
                style={{ left: `${((cursorTime - contextStart) / span) * 100}%` }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="waveform-editor__split-btn"
                  onClick={() => handleSplit("left")}
                  title="커서 기준으로 나누고 왼쪽을 삭제합니다"
                >
                  ◀ 나누기
                </button>
                <button
                  type="button"
                  className="waveform-editor__split-btn"
                  onClick={() => handleSplit("right")}
                  title="커서 기준으로 나누고 오른쪽을 삭제합니다"
                >
                  나누기 ▶
                </button>
              </div>
            </>
          )}
        </div>

        {error && <div className="waveform-editor__error">{error}</div>}

        <div className="waveform-editor__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={handlePlayPreview}>
            ▶ 미리듣기
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={handleReset}>
            되돌리기
          </button>
          <div className="waveform-editor__actions-spacer" />
          <button type="button" className="btn btn--ghost btn--sm" onClick={handleCancel}>
            취소
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={handleCommit}>
            적용
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
