import { useCallback, useRef, useState } from "react";
import { VideoPreview } from "./components/VideoPreview";
import { ExportPanel } from "./components/ExportPanel";
import { SceneDocList } from "./components/SceneDocList";
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
  const [previewWidth, setPreviewWidth] = useState(420);
  const isResizingRef = useRef(false);

  const handleResizerMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = "col-resize";

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return;
      setPreviewWidth(Math.min(720, Math.max(280, moveEvent.clientX)));
    };
    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  const {
    pythonWarning,
    pipelineMessage,
    pipelineError,
    transcriptProgress,
    openVideoPath,
    handleOpenVideo,
    handleOpenCapcutProject,
    handleRetranscribe,
  } = useVideoPipeline();

  useProjectAutosave();

  return (
    <div className="app">
      {pythonWarning && <div className="app-warning">{pythonWarning}</div>}
      {pipelineError && <div className="app-warning app-warning--error">{pipelineError}</div>}

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
          <button
            className="btn btn--ghost"
            onClick={handleOpenCapcutProject}
            disabled={pipelineMessage !== null}
            title="컷 편집만 된 기존 CapCut 프로젝트의 draft_info.json 파일을 선택하세요"
          >
            CapCut 프로젝트 가져오기
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
        <div className="app-panel app-panel--preview" style={{ width: previewWidth }}>
          <VideoPreview
            videoFile={videoFile}
            onOpenVideo={handleOpenVideo}
            onOpenVideoPath={openVideoPath}
            onRetranscribe={handleRetranscribe}
            pipelineMessage={pipelineMessage}
            transcriptProgress={transcriptProgress}
          />
        </div>

        <div
          className="app-resizer"
          onMouseDown={handleResizerMouseDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="미리보기 패널 크기 조절"
        >
          <span className="app-resizer__handle">◂▸</span>
        </div>

        <div className="app-panel app-panel--workspace">
          <SceneDocList
            dropWarningWordIds={dropWarningWordIds}
            suggestedWordIds={suggestedWordIds}
          />
          <ExportPanel
            onDropWarnings={setDropWarningWordIds}
            onSuggestionPreview={(_sceneIds, wordIds) => {
              setSuggestedWordIds(wordIds);
            }}
          />
        </div>
      </main>
    </div>
  );
}
