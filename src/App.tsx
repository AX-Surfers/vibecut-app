import { useState } from "react";
import { SceneList } from "./components/SceneList";
import { VideoPreview } from "./components/VideoPreview";
import { ExportPanel } from "./components/ExportPanel";
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
      <header className="app-toolbar">
        <span className="app-title">aside</span>
        <div className="app-toolbar__actions">
          <button className="btn btn--primary" onClick={handleOpenVideo} disabled={pipelineMessage !== null}>
            {pipelineMessage ? "처리 중…" : "영상 열기"}
          </button>
        </div>
        {pipelineMessage && <span className="app-toolbar__status">{pipelineMessage}</span>}
        {scenes.length > 0 && (
          <span className="app-toolbar__info">
            {scenes.length}개 씬 · {sourceFile.replace(/.*\//, "")}
            {isDirty && <span className="app-toolbar__dirty"> ●</span>}
          </span>
        )}
      </header>

      <main className="app-body">
        <div className="app-panel app-panel--video">
          <VideoPreview
            videoFile={videoFile}
            onOpenVideo={handleOpenVideo}
            onOpenVideoPath={openVideoPath}
            pipelineMessage={pipelineMessage}
            transcriptProgress={transcriptProgress}
          />
          <ExportPanel
            onDropWarnings={setDropWarningWordIds}
            onSuggestionPreview={(sceneIds, wordIds) => {
              setSuggestedSceneIds(sceneIds);
              setSuggestedWordIds(wordIds);
            }}
          />
        </div>
        <div className="app-panel app-panel--scenes">
          <SceneList
            dropWarningWordIds={dropWarningWordIds}
            suggestedWordIds={suggestedWordIds}
            suggestedSceneIds={suggestedSceneIds}
          />
        </div>
      </main>
    </div>
  );
}
