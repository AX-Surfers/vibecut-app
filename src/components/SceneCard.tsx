import { useCallback, useMemo } from "react";
import type { Scene } from "../types";
import { formatTimestamp } from "../lib/timeFormat";
import { useTranscriptStore } from "../state/transcriptStore";
import { useVideoStore } from "../state/videoStore";
import { SceneSubtitleEditor } from "./SceneSubtitleEditor";
import { SceneTokenRail } from "./SceneTokenRail";

interface Props {
  index: number;
  scene: Scene;
  previousSceneId?: string;
  dropWarningWordIds?: Set<string>;
  suggestedWordIds?: Set<string>;
  isSuggested?: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
  onSelectScene?: (sceneId: string) => void;
}

export function SceneCard({
  index,
  scene,
  previousSceneId,
  dropWarningWordIds,
  suggestedWordIds,
  isSuggested,
  isSelected,
  onSelect,
  onSelectScene,
}: Props) {
  const toggleWord = useTranscriptStore((s) => s.toggleWord);
  const setSubtitleOverride = useTranscriptStore((s) => s.setSubtitleOverride);
  const splitScene = useTranscriptStore((s) => s.splitScene);
  const mergeWithPrevious = useTranscriptStore((s) => s.mergeWithPrevious);
  const seekTo = useVideoStore((s) => s.seekTo);
  const duration = scene.end - scene.start;
  const keptWords = useMemo(() => scene.words.filter((word) => !word.deleted), [scene.words]);

  const handleWordContextMenu = useCallback(
    (wordId: string) => {
      splitScene(scene.id, wordId);
    },
    [splitScene, scene.id]
  );

  const handleSceneClick = useCallback(() => {
    onSelect?.();
    if (seekTo) seekTo(scene.start);
  }, [onSelect, seekTo, scene.start]);

  const handleToggleWord = useCallback((wordId: string, start: number) => {
    onSelect?.();
    if (seekTo) seekTo(start);
    toggleWord(wordId);
  }, [onSelect, seekTo, toggleWord]);

  const handleCommitSubtitle = useCallback((sceneId: string, text: string) => {
    setSubtitleOverride(sceneId, text);
  }, [setSubtitleOverride]);

  const handleMergeWithPrevious = useCallback((sceneId: string) => {
    mergeWithPrevious(sceneId);
  }, [mergeWithPrevious]);

  return (
    <div
      className={[
        "scene-card",
        isSuggested ? "scene-card--suggested" : "",
        isSelected ? "scene-card--selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={handleSceneClick}
    >
      <div className="scene-card__rail">
        <span className="scene-card__index">{index + 1}</span>
        <span className="scene-card__duration">{duration.toFixed(1)}s</span>
      </div>
      <div className="scene-card__body">
        <div className="scene-card__header">
          <div className="scene-card__meta">
            <span className="scene-card__source">{scene.sourceFile.replace(/^.*\//, "")}</span>
            <span className="scene-card__timestamp">{formatTimestamp(scene.start, duration)}</span>
            {isSuggested && <span className="scene-card__badge">추천</span>}
          </div>
        </div>

        <SceneTokenRail
          words={scene.words}
          isSelected={isSelected}
          dropWarningWordIds={dropWarningWordIds}
          suggestedWordIds={suggestedWordIds}
          onSelect={onSelect}
          onToggleWord={handleToggleWord}
          onSplitWord={(wordId) => handleWordContextMenu(wordId)}
        />

        <SceneSubtitleEditor
          scene={scene}
          previousSceneId={previousSceneId}
          onSelect={onSelect}
          onSelectScene={onSelectScene}
          onCommitSubtitle={handleCommitSubtitle}
          onMergeWithPrevious={handleMergeWithPrevious}
        />

        {keptWords.length === 0 && (
          <div className="scene-card__empty">모든 토큰이 제외되었습니다. 필요하면 컷 초기화로 다시 복구할 수 있습니다.</div>
        )}
      </div>
    </div>
  );
}
