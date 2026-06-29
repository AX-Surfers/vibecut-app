import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { useVideoStore } from "../state/videoStore";
import { useTranscriptStore } from "../state/transcriptStore";
import { buildSubtitleText, compileKeepSpans } from "../lib/segmentCompiler";
import type { TranscriptProgressPayload } from "../types";

interface Props {
  videoFile: string;
  onOpenVideo: () => void;
  onOpenVideoPath: (path: string) => Promise<void>;
  pipelineMessage: string | null;
  transcriptProgress: TranscriptProgressPayload | null;
}

function formatDuration(totalSec: number): string {
  const minutes = Math.floor(totalSec / 60);
  const seconds = Math.floor(totalSec % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function VideoPreview({
  videoFile,
  onOpenVideo,
  onOpenVideoPath,
  pipelineMessage,
  transcriptProgress,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { currentTime, setSeekFn, setCurrentTime, setPlaying, skipDeletedMode } = useVideoStore();
  const scenes = useTranscriptStore((s) => s.scenes);
  const selectedSceneId = useTranscriptStore((s) => s.selectedSceneId);
  const subtitleDrafts = useTranscriptStore((s) => s.subtitleDrafts);
  const [isDragActive, setIsDragActive] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const videoSources = useMemo(() => {
    if (!videoFile) return [];
    return [
      convertFileSrc(videoFile, "asset"),
      toFileUrl(videoFile),
      blobUrl,
    ];
  }, [blobUrl, videoFile]).filter(Boolean) as string[];
  const videoSrc = videoSources[sourceIndex] ?? "";
  const keptSpans = useMemo(() => compileKeepSpans(scenes), [scenes]);
  const keptDuration = useMemo(
    () => keptSpans.reduce((sum, span) => sum + (span.endSec - span.startSec), 0),
    [keptSpans]
  );
  const deletedWords = useMemo(
    () => scenes.flatMap((scene) => scene.words).filter((word) => word.deleted).length,
    [scenes]
  );
  const totalWords = useMemo(
    () => scenes.flatMap((scene) => scene.words).length,
    [scenes]
  );
  const showTranscriptProgress =
    transcriptProgress !== null && transcriptProgress.stage !== "done" && transcriptProgress.stage !== "error";
  const activeSubtitle = useMemo(() => {
    const selectedScene = selectedSceneId
      ? scenes.find((scene) => scene.id === selectedSceneId)
      : undefined;
    const selectedDraft = selectedScene ? subtitleDrafts[selectedScene.id] : undefined;

    if (selectedScene) {
      if (selectedDraft !== undefined) return selectedDraft;
      return buildSubtitleText(selectedScene);
    }

    const activeScene = scenes.find((scene) => currentTime >= scene.start && currentTime <= scene.end);
    return activeScene ? buildSubtitleText(activeScene) : "";
  }, [currentTime, scenes, selectedSceneId, subtitleDrafts]);

  // seek 함수를 store에 등록
  const seek = useCallback((time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
    setCurrentTime(time);
  }, [setCurrentTime]);

  useEffect(() => {
    setSeekFn(seek);
  }, [seek, setSeekFn]);

  useEffect(() => {
    setSourceIndex(0);
    setVideoError(null);
  }, [videoFile]);

  useEffect(() => {
    let cancelled = false;
    let localBlobUrl: string | null = null;

    if (!videoFile) {
      setBlobUrl(null);
      return;
    }

    void (async () => {
      try {
        const bytes = await readFile(videoFile);
        if (cancelled) return;
        localBlobUrl = URL.createObjectURL(new Blob([bytes], { type: inferVideoMimeType(videoFile) }));
        setBlobUrl(localBlobUrl);
      } catch {
        if (!cancelled) {
          setBlobUrl(null);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (localBlobUrl) {
        URL.revokeObjectURL(localBlobUrl);
      }
    };
  }, [videoFile]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;
    video.load();
  }, [videoSrc]);

  // 유지 구간만 재생 — 삭제 구간 스킵
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const t = video.currentTime;
    setCurrentTime(t);
    if (!skipDeletedMode) return;

    const spans = keptSpans;
    if (spans.length === 0) return;

    // 현재 시간이 어떤 keep-span에도 없으면 다음 span으로 점프
    const inSpan = spans.some((s) => t >= s.startSec && t < s.endSec);
    if (!inSpan) {
      const next = spans.find((s) => s.startSec > t);
      if (next) {
        video.currentTime = next.startSec;
        setCurrentTime(next.startSec);
      } else {
        video.pause();
      }
    }
  }, [keptSpans, skipDeletedMode, setCurrentTime]);

  const handlePlay = useCallback(() => setPlaying(true), [setPlaying]);
  const handlePause = useCallback(() => setPlaying(false), [setPlaying]);
  const handleLoadedData = useCallback(() => {
    setVideoError(null);
  }, []);
  const handleVideoError = useCallback(() => {
    if (sourceIndex < videoSources.length - 1) {
      setSourceIndex((current) => current + 1);
      return;
    }
    setVideoError("영상 미리보기를 불러오지 못했습니다. 파일 경로 또는 브라우저 엔진의 코덱 지원을 확인해주세요.");
  }, [sourceIndex, videoSources.length]);
  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragActive(false);
      const dropped = Array.from(event.dataTransfer.files ?? []);
      const first = dropped[0] as File & { path?: string };
      const path = first?.path;
      if (!path) return;
      await onOpenVideoPath(path);
    },
    [onOpenVideoPath]
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragActive(false);
  }, []);

  return (
    <div className="video-preview">
      {videoFile ? (
        <>
          <div className="video-preview__meta">
            <div className="video-preview__meta-card">
              <span className="video-preview__meta-label">영상</span>
              <strong className="video-preview__meta-value">{videoFile.replace(/.*\//, "")}</strong>
            </div>
            {transcriptProgress && (
              <div className="video-preview__progress-card">
                <div className="video-preview__progress-header">
                  <span className="video-preview__meta-label">전사 진행률</span>
                  <strong>{Math.max(0, Math.min(100, transcriptProgress.progress))}%</strong>
                </div>
                <div className="video-preview__progress-bar">
                  <div
                    className="video-preview__progress-fill"
                    style={{ width: `${Math.max(0, Math.min(100, transcriptProgress.progress))}%` }}
                  />
                </div>
                <div className="video-preview__progress-copy">
                  <span>{transcriptProgress.message}</span>
                  {transcriptProgress.detail && showTranscriptProgress && (
                    <span className="video-preview__progress-detail">{transcriptProgress.detail}</span>
                  )}
                </div>
              </div>
            )}
            <div className="video-preview__meta-grid">
              <div className="video-preview__stat">
                <span className="video-preview__stat-label">씬</span>
                <strong>{scenes.length}</strong>
              </div>
              <div className="video-preview__stat">
                <span className="video-preview__stat-label">유지 길이</span>
                <strong>{formatDuration(keptDuration)}</strong>
              </div>
              <div className="video-preview__stat">
                <span className="video-preview__stat-label">제외 단어</span>
                <strong>{deletedWords}/{totalWords}</strong>
              </div>
            </div>
          </div>
          <div className="video-preview__stage">
            <video
              ref={videoRef}
              key={videoSrc}
              className="video-preview__player"
              src={videoSrc}
              onTimeUpdate={handleTimeUpdate}
              onPlay={handlePlay}
              onPause={handlePause}
              onLoadedData={handleLoadedData}
              onError={handleVideoError}
              controls
              preload="auto"
              playsInline
            />
            {activeSubtitle && (
              <div className="video-preview__subtitle-overlay">
                {activeSubtitle.split("\n").map((line, index) => (
                  <span key={`video-preview-subtitle-${index}`} className="video-preview__subtitle-line">
                    {line}
                  </span>
                ))}
              </div>
            )}
          </div>
          {videoError && <div className="video-preview__error">{videoError}</div>}
          <div className="video-preview__controls">
            <label className="video-preview__skip-toggle">
              <input
                type="checkbox"
                checked={skipDeletedMode}
                onChange={() => useVideoStore.getState().toggleSkipMode()}
              />
              유지 구간만 재생
            </label>
            <button className="btn btn--secondary" onClick={onOpenVideo}>
              다른 영상 열기
            </button>
          </div>
        </>
      ) : (
        <div
          className={[
            "video-preview__launcher",
            isDragActive ? "video-preview__launcher--drag" : "",
          ].join(" ")}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <div className="video-preview__launcher-badge">Desktop Flow</div>
          <h2 className="video-preview__launcher-title">영상을 넣고, 자막 기준으로 컷을 정리하세요.</h2>
          <p className="video-preview__launcher-copy">
            비디오 파일을 드롭하거나 직접 선택하면 전사, 자동 컷 추천, CapCut 초안 내보내기까지 이어집니다.
          </p>
          <div className="video-preview__launcher-actions">
            <button className="btn btn--primary" onClick={onOpenVideo} disabled={pipelineMessage !== null}>
              {pipelineMessage ? "전사 준비 중…" : "영상 선택"}
            </button>
          </div>
          {transcriptProgress && (
            <div className="video-preview__launcher-progress">
              <div className="video-preview__progress-header">
                <span className="video-preview__meta-label">전사 진행률</span>
                <strong>{Math.max(0, Math.min(100, transcriptProgress.progress))}%</strong>
              </div>
              <div className="video-preview__progress-bar">
                <div
                  className="video-preview__progress-fill"
                  style={{ width: `${Math.max(0, Math.min(100, transcriptProgress.progress))}%` }}
                />
              </div>
              <div className="video-preview__progress-copy">
                <span>{transcriptProgress.message}</span>
                {transcriptProgress.detail && showTranscriptProgress && (
                  <span className="video-preview__progress-detail">{transcriptProgress.detail}</span>
                )}
              </div>
            </div>
          )}
          <div className="video-preview__steps">
            <div className="video-preview__step">
              <span>1</span>
              <div>Whisper 전사</div>
            </div>
            <div className="video-preview__step">
              <span>2</span>
              <div>자동 컷 추천 검토</div>
            </div>
            <div className="video-preview__step">
              <span>3</span>
              <div>CapCut `draft_info.json` 내보내기</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function toFileUrl(path: string): string {
  return `file://${encodeURI(path).replace(/#/g, "%23").replace(/\?/g, "%3F")}`;
}

function inferVideoMimeType(path: string): string {
  if (path.endsWith(".mov")) return "video/quicktime";
  if (path.endsWith(".m4v")) return "video/x-m4v";
  return "video/mp4";
}
