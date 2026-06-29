import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { loadProject } from "../lib/persistence";
import { useProjectStore } from "../state/projectStore";
import { useTranscriptStore } from "../state/transcriptStore";
import type { PrepareTranscriptResult, TranscriptProgressPayload, WhisperSegment } from "../types";

interface UseVideoPipelineResult {
  pythonWarning: string | null;
  pipelineMessage: string | null;
  pipelineError: string | null;
  transcriptProgress: TranscriptProgressPayload | null;
  openVideoPath: (videoPath: string) => Promise<void>;
  handleOpenVideo: () => Promise<void>;
}

export function useVideoPipeline(): UseVideoPipelineResult {
  const loadFromJson = useTranscriptStore((state) => state.loadFromJson);
  const {
    setProjectPath,
    setTemplatePath,
  } = useProjectStore();

  const [pythonWarning, setPythonWarning] = useState<string | null>(null);
  const [pipelineMessage, setPipelineMessage] = useState<string | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [transcriptProgress, setTranscriptProgress] = useState<TranscriptProgressPayload | null>(null);

  useEffect(() => {
    invoke<string>("check_python").catch(() => {
      setPythonWarning("python3를 찾을 수 없습니다. CapCut 내보내기를 사용하려면 Python 3.10+ 설치가 필요합니다.");
    });
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    void listen<TranscriptProgressPayload>("transcript-progress", (event) => {
      setTranscriptProgress(event.payload);
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const restoreProjectState = useCallback(async (projectFilePath: string) => {
    const saved = await loadProject(projectFilePath);
    if (!saved) return;

    if (saved.templatePath) setTemplatePath(saved.templatePath);

    const transcriptStore = useTranscriptStore.getState();
    for (const wordId of saved.deletedWordIds) {
      const word = transcriptStore.scenes.flatMap((scene) => scene.words).find((candidate) => candidate.id === wordId);
      if (word && !word.deleted) transcriptStore.toggleWord(wordId);
    }

    for (const [sceneId, text] of Object.entries(saved.subtitleOverrides)) {
      transcriptStore.setSubtitleOverride(sceneId, text);
    }
  }, [setTemplatePath]);

  const resolveTemplatePath = useCallback(async (videoDirectory: string) => {
    const localTemplatePath = `${videoDirectory}/draft_info.json`;
    try {
      await invoke("read_words_json", { path: localTemplatePath });
      setTemplatePath(localTemplatePath);
    } catch {
      try {
        const fallbackTemplatePath = await invoke<string>("find_default_template_path");
        setTemplatePath(fallbackTemplatePath);
      } catch {
        setTemplatePath(localTemplatePath);
      }
    }
  }, [setTemplatePath]);

  const openVideoPath = useCallback(async (videoPath: string) => {
    try {
      setPipelineError(null);
      setTranscriptProgress({
        stage: "starting",
        progress: 3,
        message: "전사 작업을 시작하는 중…",
      });

      const videoDirectory = videoPath.replace(/\/[^/]+$/, "");
      const projectFilePath = videoPath.replace(/\.(mp4|mov|m4v)$/i, ".aside.json");

      setPipelineMessage("자막 전사 준비 중…");
      const prepRaw = await invoke<string>("prepare_video_transcript", {
        videoPath,
        model: "small",
      });
      const prep = JSON.parse(prepRaw) as PrepareTranscriptResult;
      setPipelineMessage(prep.usedCache ? "캐시된 자막을 불러오는 중…" : "전사 결과를 불러오는 중…");

      const raw = await invoke<string>("read_words_json", { path: prep.wordsJsonPath });
      const segments = JSON.parse(raw) as WhisperSegment[];

      await resolveTemplatePath(videoDirectory);
      loadFromJson(segments, prep.wordsJsonPath, videoPath);
      setProjectPath(projectFilePath);
      await restoreProjectState(projectFilePath);

      setTranscriptProgress({
        stage: "done",
        progress: 100,
        message: prep.usedCache ? "캐시된 전사를 불러왔습니다." : "전사가 완료되었습니다.",
      });
      setPipelineMessage(null);
    } catch (error) {
      console.error("파일 열기 실패:", error);
      setPipelineMessage(null);
      setTranscriptProgress({
        stage: "error",
        progress: 100,
        message: "전사 중 오류가 발생했습니다.",
        detail: error instanceof Error ? error.message : String(error),
      });
      setPipelineError(error instanceof Error ? error.message : String(error));
    }
  }, [loadFromJson, resolveTemplatePath, restoreProjectState, setProjectPath]);

  const handleOpenVideo = useCallback(async () => {
    const selected = await open({
      filters: [{ name: "Video", extensions: ["mp4", "mov", "m4v", "MP4", "MOV"] }],
      multiple: false,
    });
    if (!selected) return;

    const videoPath = typeof selected === "string" ? selected : selected[0];
    await openVideoPath(videoPath);
  }, [openVideoPath]);

  return {
    pythonWarning,
    pipelineMessage,
    pipelineError,
    transcriptProgress,
    openVideoPath,
    handleOpenVideo,
  };
}
