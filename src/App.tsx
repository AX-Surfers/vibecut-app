import { useState } from "react";
import { VideoPreview } from "./components/VideoPreview";
import { ExportPanel } from "./components/ExportPanel";
import { SceneDrawer } from "./components/SceneDrawer";
import { SceneTokenRail } from "./components/SceneTokenRail";
import { SceneSubtitleEditor } from "./components/SceneSubtitleEditor";
import { useTranscriptStore } from "./state/transcriptStore";
import { useProjectStore } from "./state/projectStore";
import { useProjectAutosave } from "./hooks/useProjectAutosave";
import { useVideoPipeline } from "./hooks/useVideoPipeline";
import { formatTimestamp } from "./lib/timeFormat";
import "./App.css";

export default function App() {
  const {
    scenes,
    sourceFile,
    videoFile,
    selectedSceneId,
    setSelectedSceneId,
    toggleWord,
    splitScene,
    setSubtitleOverride,
    mergeWithPrevious,
  } = useTranscriptStore();
  const { isDirty } = useProjectStore();
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

  const selectedSceneIndex = scenes.findIndex((s) => s.id === selectedSceneId);
  const selectedScene = selectedSceneIndex >= 0 ? scenes[selectedSceneIndex] : null;
  const previousSceneId =
    selectedSceneIndex > 0 ? scenes[selectedSceneIndex - 1]?.id : undefined;

  const handleMergeWithPrevious = (sceneId: string, _prevId: string) => {
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
          <button
            className="btn btn--primary"
            onClick={handleOpenVideo}
            disabled={pipelineMessage !== null}
          >
            {pipelineMessage ? "처리 중…" : "영상 열기"}
          </button>
        </div>
        {pipelineMessage && (
          <span className="app-header__status">{pipelineMessage}</span>
        )}
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
            <div className="workspace-header__title">
              {selectedScene ? (
                <>
                  <span>씬 {selectedSceneIndex + 1}</span>
                  <span>
                    {formatTimestamp(
                      selectedScene.words[0]?.start ?? 0,
                      (selectedScene.words[selectedScene.words.length - 1]?.end ?? 0) -
                        (selectedScene.words[0]?.start ?? 0)
                    )}
                  </span>
                </>
              ) : (
                <span>씬을 선택하세요</span>
              )}
            </div>
            <div className="workspace-header__actions">
              <button
                className="btn btn--ghost"
                onClick={() => setDrawerOpen(true)}
              >
                씬 목록
              </button>
            </div>
          </div>

          <div className={`workspace-subtitle${!selectedScene ? " workspace-subtitle--empty" : ""}`}>
            {selectedScene ? (
              <>
                <SceneTokenRail
                  words={selectedScene.words}
                  isSelected={true}
                  dropWarningWordIds={dropWarningWordIds}
                  suggestedWordIds={suggestedWordIds}
                  onSelect={() => setSelectedSceneId(selectedScene.id)}
                  onToggleWord={(wordId, _start) => toggleWord(wordId)}
                  onSplitWord={(wordId, _index) =>
                    splitScene(selectedScene.id, wordId)
                  }
                />
                <SceneSubtitleEditor
                  scene={selectedScene}
                  previousSceneId={previousSceneId}
                  onSelect={() => setSelectedSceneId(selectedScene.id)}
                  onSelectScene={setSelectedSceneId}
                  onCommitSubtitle={(sceneId, text) =>
                    setSubtitleOverride(sceneId, text)
                  }
                  onMergeWithPrevious={handleMergeWithPrevious}
                />
              </>
            ) : (
              <span>영상을 열고 씬을 선택하세요</span>
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
