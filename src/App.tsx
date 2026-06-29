import { useState, useMemo } from "react";
import { SceneDrawer } from "./components/SceneDrawer";
import { VideoPreview } from "./components/VideoPreview";
import { ExportPanel } from "./components/ExportPanel";
import { SceneSubtitleEditor } from "./components/SceneSubtitleEditor";
import { SceneTokenRail } from "./components/SceneTokenRail";
import { useTranscriptStore } from "./state/transcriptStore";
import { useProjectStore } from "./state/projectStore";
import { useProjectAutosave } from "./hooks/useProjectAutosave";
import { useVideoPipeline } from "./hooks/useVideoPipeline";
import { useVideoStore } from "./state/videoStore";
import { formatTimestamp } from "./lib/timeFormat";
import "./App.css";

export default function App() {
  const { scenes, sourceFile, videoFile } = useTranscriptStore();
  const selectedSceneId = useTranscriptStore((s) => s.selectedSceneId);
  const setSelectedSceneId = useTranscriptStore((s) => s.setSelectedSceneId);
  const setSubtitleOverride = useTranscriptStore((s) => s.setSubtitleOverride);
  const mergeWithPrevious = useTranscriptStore((s) => s.mergeWithPrevious);
  const { isDirty } = useProjectStore();
  const seekTo = useVideoStore((s) => s.seekTo);
  const [dropWarningWordIds, setDropWarningWordIds] = useState<Set<string>>(new Set());
  const [suggestedWordIds, setSuggestedWordIds] = useState<Set<string>>(new Set());
  const [suggestedSceneIds, setSuggestedSceneIds] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const {
    pythonWarning,
    pipelineMessage,
    pipelineError,
    transcriptProgress,
    openVideoPath,
    handleOpenVideo,
  } = useVideoPipeline();

  useProjectAutosave();

  const selectedScene = useMemo(
    () => scenes.find((s) => s.id === selectedSceneId) ?? null,
    [scenes, selectedSceneId]
  );

  const selectedSceneIndex = useMemo(
    () => scenes.findIndex((s) => s.id === selectedSceneId),
    [scenes, selectedSceneId]
  );

  const previousSceneId = selectedSceneIndex > 0 ? scenes[selectedSceneIndex - 1]?.id : undefined;

  const handleCommitSubtitle = (sceneId: string, text: string) => {
    setSubtitleOverride(sceneId, text);
  };

  const handleMergeWithPrevious = (sceneId: string, _previousSceneId: string) => {
    mergeWithPrevious(sceneId);
  };

  return (
    <div className="app">
      {pythonWarning && (
        <div className="app-warning">{pythonWarning}</div>
      )}
      {pipelineError && (
        <div className="app-warning app-warning--error">{pipelineError}</div>
      )}

      <header className="app-header">
        <span className="app-title">SURFERS</span>
        <div className="app-header__actions">
          <button className="btn btn--primary" onClick={handleOpenVideo} disabled={pipelineMessage !== null}>
            {pipelineMessage ? "처리 중…" : "영상 열기"}
          </button>
        </div>
        {pipelineMessage && <span className="app-header__status">{pipelineMessage}</span>}
        {scenes.length > 0 && (
          <span className="app-header__info">
            <span>{scenes.length}개 씬</span>
            <span>·</span>
            <span>{sourceFile.replace(/.*\//, "")}</span>
            {isDirty && <span className="app-header__dirty">●</span>}
          </span>
        )}
      </header>

      <main className="app-body">
        <div className="app-panel app-panel--preview">
          <VideoPreview
            videoFile={videoFile}
            onOpenVideo={handleOpenVideo}
            onOpenVideoPath={openVideoPath}
            pipelineMessage={pipelineMessage}
            transcriptProgress={transcriptProgress}
          />
        </div>

        <div className="app-panel app-panel--workspace">
          <div className="workspace-header">
            <span className="workspace-header__title">
              {selectedScene
                ? `씬 ${selectedSceneIndex + 1} · ${formatTimestamp(selectedScene.start, selectedScene.end - selectedScene.start)}`
                : "자막 편집"}
            </span>
            <div className="workspace-header__actions">
              {scenes.length > 0 && (
                <button className="btn btn--ghost" onClick={() => setDrawerOpen(true)}>
                  씬 목록
                </button>
              )}
            </div>
          </div>

          <div className="workspace-subtitle">
            {selectedScene ? (
              <>
                <SceneTokenRail
                  words={selectedScene.words}
                  isSelected={true}
                  dropWarningWordIds={dropWarningWordIds}
                  suggestedWordIds={suggestedWordIds}
                  onSelect={() => {}}
                  onToggleWord={(wordId, start) => {
                    if (seekTo) seekTo(start);
                    useTranscriptStore.getState().toggleWord(wordId);
                  }}
                  onSplitWord={(wordId) => {
                    useTranscriptStore.getState().splitScene(selectedScene.id, wordId);
                  }}
                />
                <SceneSubtitleEditor
                  scene={selectedScene}
                  previousSceneId={previousSceneId}
                  onSelect={() => {}}
                  onSelectScene={setSelectedSceneId}
                  onCommitSubtitle={handleCommitSubtitle}
                  onMergeWithPrevious={handleMergeWithPrevious}
                />
              </>
            ) : (
              <div className="workspace-subtitle--empty">
                <p>영상을 열어 시작하세요</p>
              </div>
            )}
          </div>

          <ExportPanel
            onDropWarnings={setDropWarningWordIds}
            onSuggestionPreview={(sceneIds, wordIds) => {
              setSuggestedSceneIds(sceneIds);
              setSuggestedWordIds(wordIds);
            }}
          />
        </div>
      </main>

      <SceneDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        dropWarningWordIds={dropWarningWordIds}
        suggestedWordIds={suggestedWordIds}
        suggestedSceneIds={suggestedSceneIds}
      />
    </div>
  );
}
