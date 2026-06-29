import { useState } from "react";
import { VideoPreview } from "./components/VideoPreview";
import { ExportPanel } from "./components/ExportPanel";
import { SceneList } from "./components/SceneList";
import { useTranscriptStore } from "./state/transcriptStore";
import { useProjectStore } from "./state/projectStore";
import { useProjectAutosave } from "./hooks/useProjectAutosave";
import { useVideoPipeline } from "./hooks/useVideoPipeline";
import "./App.css";

export default function App() {
  const { scenes, sourceFile, videoFile } = useTranscriptStore();
  const { isDirty } = useProjectStore();
  const [dropWarningWordIds, setDropWarningWordIds] = useState<Set<string>>(new Set());
  const [suggestedWordIds, setSuggestedWordIds] = useState<Set<string>>(new Set());
  const [suggestedSceneIds, setSuggestedSceneIds] = useState<Set<string>>(new Set());
  const {
    pythonWarning,
    pipelineMessage,
    pipelineError,
    transcriptProgress,
    openVideoPath,
    handleOpenVideo,
  } = useVideoPipeline();

  useProjectAutosave();

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

        <div className="app-panel app-panel--scenes">
          <SceneList
            dropWarningWordIds={dropWarningWordIds}
            suggestedWordIds={suggestedWordIds}
            suggestedSceneIds={suggestedSceneIds}
          />
          <ExportPanel
            onDropWarnings={setDropWarningWordIds}
            onSuggestionPreview={(sceneIds, wordIds) => {
              setSuggestedSceneIds(sceneIds);
              setSuggestedWordIds(wordIds);
            }}
          />
        </div>
      </main>
    </div>
  );
}
