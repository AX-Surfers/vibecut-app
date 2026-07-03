import { useRef, useEffect, useMemo, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useTranscriptStore } from "../state/transcriptStore";
import { useVideoStore } from "../state/videoStore";
import { usePlaybackSync } from "../hooks/usePlaybackSync";
import { SceneTokenRail } from "./SceneTokenRail";
import { SceneSubtitleEditor } from "./SceneSubtitleEditor";
import { formatTimestamp } from "../lib/timeFormat";

interface Props {
  dropWarningWordIds?: Set<string>;
  suggestedWordIds?: Set<string>;
}

export function SceneDocList({ dropWarningWordIds, suggestedWordIds }: Props) {
  const allScenes = useTranscriptStore((s) => s.scenes);
  const [showDeleted, setShowDeleted] = useState(false);
  const deletedSceneCount = useMemo(
    () => allScenes.filter((s) => s.words.every((w) => w.deleted)).length,
    [allScenes]
  );
  const scenes = useMemo(
    () => (showDeleted ? allScenes : allScenes.filter((s) => s.words.some((w) => !w.deleted))),
    [allScenes, showDeleted]
  );
  const selectedSceneId = useTranscriptStore((s) => s.selectedSceneId);
  const setSelectedSceneId = useTranscriptStore((s) => s.setSelectedSceneId);
  const toggleWord = useTranscriptStore((s) => s.toggleWord);
  const splitScene = useTranscriptStore((s) => s.splitScene);
  const setSubtitleOverride = useTranscriptStore((s) => s.setSubtitleOverride);
  const mergeWithPrevious = useTranscriptStore((s) => s.mergeWithPrevious);
  const deleteScene = useTranscriptStore((s) => s.deleteScene);
  const restoreScene = useTranscriptStore((s) => s.restoreScene);
  const seekTo = useVideoStore((s) => s.seekTo);
  const activeWordId = useVideoStore((s) => s.activeWordId);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [selectedForDeletion, setSelectedForDeletion] = useState<Set<string>>(new Set());

  usePlaybackSync();

  const selectableIds = useMemo(
    () => scenes.filter((s) => !s.words.every((w) => w.deleted)).map((s) => s.id),
    [scenes]
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedForDeletion.has(id));

  const toggleSelected = (sceneId: string) => {
    setSelectedForDeletion((current) => {
      const next = new Set(current);
      if (next.has(sceneId)) next.delete(sceneId);
      else next.add(sceneId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedForDeletion((current) => {
      if (selectableIds.length > 0 && selectableIds.every((id) => current.has(id))) {
        return new Set();
      }
      return new Set(selectableIds);
    });
  };

  const handleBulkDelete = () => {
    for (const sceneId of selectedForDeletion) {
      deleteScene(sceneId);
    }
    setSelectedForDeletion(new Set());
  };

  useEffect(() => {
    if (!selectedSceneId) return;
    const idx = scenes.findIndex((s) => s.id === selectedSceneId);
    if (idx >= 0) {
      virtuosoRef.current?.scrollToIndex({ index: idx, behavior: "smooth", align: "start" });
    }
  }, [selectedSceneId, scenes]);

  if (allScenes.length === 0) {
    return (
      <div className="scene-doc--empty">
        <span>영상을 열고 씬을 선택하세요</span>
      </div>
    );
  }

  return (
    <div className="scene-doc-container">
      <div className="scene-doc-toolbar">
        <label className="scene-doc-toolbar__select-all">
          <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
          전체 선택
        </label>
        {deletedSceneCount > 0 && (
          <label className="scene-doc-toolbar__select-all">
            <input type="checkbox" checked={showDeleted} onChange={() => setShowDeleted((v) => !v)} />
            삭제된 씬 보기 ({deletedSceneCount})
          </label>
        )}
        <div className="scene-doc-toolbar__spacer" />
        {selectedForDeletion.size > 0 && (
          <button
            type="button"
            className="btn btn--ghost btn--sm scene-doc-toolbar__bulk-delete"
            onClick={handleBulkDelete}
          >
            선택 삭제 ({selectedForDeletion.size})
          </button>
        )}
      </div>
      <Virtuoso
        ref={virtuosoRef}
        className="scene-doc"
        totalCount={scenes.length}
        itemContent={(index) => {
          const scene = scenes[index];
          const prevScene = scenes[index - 1];
          const isSelected = selectedSceneId === scene.id;
          const isDeleted = scene.words.every((w) => w.deleted);
          const duration = scene.end - scene.start;

          return (
            <div
              className={[
                "scene-doc-row",
                isSelected ? "scene-doc-row--selected" : "",
                isDeleted ? "scene-doc-row--deleted" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => {
                setSelectedSceneId(scene.id);
                seekTo?.(scene.start);
              }}
            >
              <div className="scene-doc-row__meta">
                {!isDeleted && (
                  <input
                    type="checkbox"
                    className="scene-doc-row__checkbox"
                    checked={selectedForDeletion.has(scene.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleSelected(scene.id)}
                    aria-label="삭제할 씬으로 선택"
                  />
                )}
                <span className="scene-doc-row__index">{index + 1}</span>
                <div className="scene-doc-row__info">
                  <span className="scene-doc-row__label">영상편집</span>
                  <span className="scene-doc-row__time">
                    {formatTimestamp(scene.start, duration)}
                  </span>
                </div>
                <div className="scene-doc-row__actions">
                  {isDeleted ? (
                    <button
                      className="scene-doc-row__btn scene-doc-row__btn--restore"
                      onClick={(e) => { e.stopPropagation(); restoreScene(scene.id); }}
                    >
                      복구
                    </button>
                  ) : (
                    <button
                      className="scene-doc-row__btn scene-doc-row__btn--delete"
                      onClick={(e) => { e.stopPropagation(); deleteScene(scene.id); }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {!isDeleted ? (
                <>
                  <SceneTokenRail
                    words={scene.words}
                    isSelected={isSelected}
                    activeWordId={activeWordId}
                    dropWarningWordIds={dropWarningWordIds}
                    suggestedWordIds={suggestedWordIds}
                    onSelect={() => setSelectedSceneId(scene.id)}
                    onToggleWord={(wordId, start) => {
                      setSelectedSceneId(scene.id);
                      seekTo?.(start);
                      toggleWord(wordId);
                    }}
                    onSplitWord={(wordId) => splitScene(scene.id, wordId)}
                    onSeekWord={(start) => {
                      setSelectedSceneId(scene.id);
                      seekTo?.(start);
                    }}
                  />
                  <SceneSubtitleEditor
                    scene={scene}
                    previousSceneId={prevScene?.id}
                    onSelect={() => setSelectedSceneId(scene.id)}
                    onSelectScene={setSelectedSceneId}
                    onCommitSubtitle={(sceneId, text) => setSubtitleOverride(sceneId, text)}
                    onMergeWithPrevious={(sceneId) => mergeWithPrevious(sceneId)}
                    onFocusSeek={() => seekTo?.(scene.start)}
                  />
                </>
              ) : (
                <div className="scene-doc-row__deleted-msg">이 씬의 영상 클립이 제외됩니다</div>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}
