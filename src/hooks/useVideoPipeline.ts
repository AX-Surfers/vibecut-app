import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { homeDir, join } from "@tauri-apps/api/path";
import { loadProject } from "../lib/persistence";
import { useProjectStore } from "../state/projectStore";
import { useTranscriptStore } from "../state/transcriptStore";
import type {
  CapcutCutImportResult,
  PrepareTranscriptResult,
  TranscriptProgressPayload,
  WhisperSegment,
} from "../types";

const CAPCUT_PROJECTS_ROOT = "Movies/CapCut/User Data/Projects/com.lveditor.draft";

interface UseVideoPipelineResult {
  pythonWarning: string | null;
  pipelineMessage: string | null;
  pipelineError: string | null;
  transcriptProgress: TranscriptProgressPayload | null;
  openVideoPath: (videoPath: string) => Promise<void>;
  handleOpenVideo: () => Promise<void>;
  handleOpenCapcutProject: () => Promise<void>;
  handleRetranscribe: () => Promise<void>;
}

export function useVideoPipeline(): UseVideoPipelineResult {
  const loadFromJson = useTranscriptStore((state) => state.loadFromJson);
  const {
    setProjectPath,
    setTemplatePath,
    setCapCutProjectPath,
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
    if (saved.capCutProjectPath) setCapCutProjectPath(saved.capCutProjectPath);

    const transcriptStore = useTranscriptStore.getState();

    if (saved.version === 2) {
      // split/merge/타이밍 편집까지 그대로 보존된 scenes를 재구성 없이 통째로 적용
      transcriptStore.loadFromSaved(saved.scenes, transcriptStore.sourceFile, transcriptStore.videoFile);
      return;
    }

    if (saved.deletedWordIds.length > 0) {
      transcriptStore.setWordDeleted(saved.deletedWordIds, true);
    }

    for (const [sceneId, text] of Object.entries(saved.subtitleOverrides)) {
      transcriptStore.setSubtitleOverride(sceneId, text);
    }
  }, [setTemplatePath, setCapCutProjectPath]);

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

  const runTranscriptionPipeline = useCallback(async (
    videoPath: string,
    options?: { keepSpans?: [number, number][]; explicitTemplatePath?: string; force?: boolean }
  ) => {
    try {
      setPipelineError(null);
      setTranscriptProgress({
        stage: "starting",
        progress: 3,
        message: options?.force ? "다시 전사를 시작하는 중…" : "전사 작업을 시작하는 중…",
      });

      const videoDirectory = videoPath.replace(/\/[^/]+$/, "");
      const projectFilePath = videoPath.replace(/\.(mp4|mov|m4v)$/i, ".aside.json");

      setPipelineMessage("자막 전사 준비 중…");
      const prepRaw = await invoke<string>("prepare_video_transcript", {
        videoPath,
        model: "medium",
        force: options?.force ?? false,
      });
      const prep = JSON.parse(prepRaw) as PrepareTranscriptResult;
      setPipelineMessage(prep.usedCache ? "캐시된 자막을 불러오는 중…" : "전사 결과를 불러오는 중…");

      const raw = await invoke<string>("read_words_json", { path: prep.wordsJsonPath });
      const segments = JSON.parse(raw) as WhisperSegment[];

      if (options?.explicitTemplatePath) {
        setTemplatePath(options.explicitTemplatePath);
      } else {
        await resolveTemplatePath(videoDirectory);
      }
      loadFromJson(segments, prep.wordsJsonPath, videoPath, options?.keepSpans);
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
  }, [loadFromJson, resolveTemplatePath, restoreProjectState, setProjectPath, setTemplatePath]);

  const openVideoPath = useCallback(async (videoPath: string) => {
    // 새 영상을 직접 여는 경우엔 이전 프로젝트에서 남은 CapCut 되돌려쓰기 대상 경로를 지운다
    setCapCutProjectPath(null);
    await runTranscriptionPipeline(videoPath);
  }, [runTranscriptionPipeline, setCapCutProjectPath]);

  const handleOpenVideo = useCallback(async () => {
    const selected = await open({
      filters: [{ name: "Video", extensions: ["mp4", "mov", "m4v", "MP4", "MOV"] }],
      multiple: false,
    });
    if (!selected) return;

    const videoPath = typeof selected === "string" ? selected : selected[0];
    await openVideoPath(videoPath);
  }, [openVideoPath]);

  const handleRetranscribe = useCallback(async () => {
    const videoFile = useTranscriptStore.getState().videoFile;
    if (!videoFile) return;
    await runTranscriptionPipeline(videoFile, { force: true });
  }, [runTranscriptionPipeline]);

  const handleOpenCapcutProject = useCallback(async () => {
    let defaultPath: string | undefined;
    try {
      defaultPath = await join(await homeDir(), CAPCUT_PROJECTS_ROOT);
    } catch {
      defaultPath = undefined;
    }

    const selected = await open({
      filters: [{ name: "CapCut Draft", extensions: ["json"] }],
      defaultPath,
      multiple: false,
    });
    if (!selected) return;

    const projectPath = typeof selected === "string" ? selected : selected[0];

    try {
      setPipelineError(null);
      setPipelineMessage("CapCut 프로젝트를 읽는 중…");
      const raw = await invoke<string>("read_capcut_cut_project", { projectPath });
      const imported = JSON.parse(raw) as CapcutCutImportResult;

      // 가져온 원본 CapCut draft로 내보내기 기본 저장 위치를 맞춰둔다 — 편집 후
      // 곧바로 같은 CapCut 프로젝트에 반영할 수 있도록(사용자가 다른 경로로 바꿀 수도 있음)
      setCapCutProjectPath(imported.templatePath);

      await runTranscriptionPipeline(imported.videoPath, {
        keepSpans: imported.keepSpans,
        explicitTemplatePath: imported.templatePath,
      });
    } catch (error) {
      console.error("CapCut 프로젝트 읽기 실패:", error);
      setPipelineMessage(null);
      setPipelineError(error instanceof Error ? error.message : String(error));
    }
  }, [runTranscriptionPipeline, setCapCutProjectPath]);

  return {
    pythonWarning,
    pipelineMessage,
    pipelineError,
    transcriptProgress,
    openVideoPath,
    handleOpenVideo,
    handleOpenCapcutProject,
    handleRetranscribe,
  };
}
