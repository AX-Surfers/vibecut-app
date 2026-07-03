import { useCallback, useMemo } from "react";
import type { Scene } from "../types";
import { useTranscriptStore } from "../state/transcriptStore";
import { useVideoStore } from "../state/videoStore";
import { SceneThumbnail } from "./SceneThumbnail";
import { formatTimestamp } from "../lib/timeFormat";

interface Props {
  index: number;
  scene: Scene;
  isSuggested?: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
}

export function SceneCard({ index, scene, isSuggested, isSelected, onSelect }: Props) {
  const deleteScene = useTranscriptStore((s) => s.deleteScene);
  const restoreScene = useTranscriptStore((s) => s.restoreScene);
  const seekTo = useVideoStore((s) => s.seekTo);

  const duration = scene.end - scene.start;
  const isDeleted = useMemo(() => scene.words.every((w) => w.deleted), [scene.words]);

  const handleClick = useCallback(() => {
    onSelect?.();
    seekTo?.(scene.start);
  }, [onSelect, seekTo, scene.start]);

  return (
    <div
      className={[
        "scene-card",
        isSuggested ? "scene-card--suggested" : "",
        isSelected ? "scene-card--selected" : "",
        isDeleted ? "scene-card--deleted" : "",
      ].filter(Boolean).join(" ")}
      onClick={handleClick}
    >
      <div className="scene-card__thumb-wrap">
        <SceneThumbnail seekTime={scene.start} />
        {isDeleted && <span className="scene-card__cut-badge">컷</span>}
      </div>
      <div className="scene-card__foot">
        <span className="scene-card__index">{index + 1}</span>
        <span className="scene-card__duration">{formatTimestamp(scene.start, duration)}</span>
        <button
          className={[
            "scene-card__action-btn",
            isDeleted ? "scene-card__action-btn--restore" : "scene-card__action-btn--delete",
          ].join(" ")}
          onClick={(e) => {
            e.stopPropagation();
            isDeleted ? restoreScene(scene.id) : deleteScene(scene.id);
          }}
          title={isDeleted ? "복구" : "삭제"}
        >
          {isDeleted ? "↩" : "✕"}
        </button>
      </div>
    </div>
  );
}
