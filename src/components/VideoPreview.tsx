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
  const { currentTime, setSeekFn, setCurrentTime, setPlaying, isPlaying, skipDeletedMode } = useVideoStore();
  const scenes = useTranscriptStore((s) => s.scenes);
  const subtitleDrafts = useTranscriptStore((s) => s.subtitleDrafts);
  const [isDragActive, setIsDragActive] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);

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
  // 현재 재생 시간을 포함하는 씬 자막을 반환 — selectedSceneId와 무관
  const activeSubtitle = useMemo(() => {
    const t = currentTime;
    const activeScene = scenes.find((scene) => {
      const keptWords = scene.words.filter((w) => !w.deleted);
      if (keptWords.length === 0) return false;
      const first = keptWords[0].start;
      const last = keptWords[keptWords.length - 1].end;
      return t >= first - 0.05 && t <= last + 0.15;
    });
    if (!activeScene) return "";
    const draft = subtitleDrafts[activeScene.id];
    return draft ?? buildSubtitleText(activeScene);
  }, [currentTime, scenes, subtitleDrafts]);

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

  // 전역 Space 키 → 재생/일시정지 (input/textarea 제외)
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      if (e.code === "Space") {
        e.preventDefault();
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) void video.play();
        else video.pause();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

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
  const handleLoadedMetadata = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    setVideoDuration(e.currentTarget.duration || 0);
  }, []);
  const handleTogglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }, []);
  const handleSeekBar = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    setIsSeeking(true);
    if (videoRef.current) videoRef.current.currentTime = t;
    setCurrentTime(t);
  }, [setCurrentTime]);
  const handleSeekBarMouseUp = useCallback(() => setIsSeeking(false), []);
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
              <button className="btn btn--ghost btn--sm" onClick={onOpenVideo}>교체</button>
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
          <div
            className="video-preview__stage"
            tabIndex={0}
            onClick={handleTogglePlay}
          >
            <video
              ref={videoRef}
              key={videoSrc}
              className="video-preview__player"
              src={videoSrc}
              onTimeUpdate={handleTimeUpdate}
              onPlay={handlePlay}
              onPause={handlePause}
              onLoadedData={handleLoadedData}
              onLoadedMetadata={handleLoadedMetadata}
              onError={handleVideoError}
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
            <div className="video-preview__play-indicator" aria-hidden="true">
              {isPlaying ? "⏸" : "▶"}
            </div>
          </div>
          {videoError && <div className="video-preview__error">{videoError}</div>}
          <div className="video-player-controls" onClick={(e) => e.stopPropagation()}>
            <button
              className="video-player-controls__play-btn"
              onClick={handleTogglePlay}
              aria-label={isPlaying ? "일시정지" : "재생"}
            >
              {isPlaying ? (
                <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                  <rect x="3" y="2" width="4" height="14" rx="1"/>
                  <rect x="11" y="2" width="4" height="14" rx="1"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                  <path d="M4 2.5l12 6.5-12 6.5V2.5z"/>
                </svg>
              )}
            </button>
            <div className="video-player-controls__seek">
              <input
                type="range"
                className="video-player-controls__seekbar"
                min={0}
                max={videoDuration || 100}
                step={0.05}
                value={isSeeking ? undefined : currentTime}
                defaultValue={0}
                onChange={handleSeekBar}
                onMouseUp={handleSeekBarMouseUp}
                onTouchEnd={handleSeekBarMouseUp}
                aria-label="재생 위치"
              />
            </div>
            <span className="video-player-controls__time">
              {formatDuration(currentTime)} / {formatDuration(videoDuration)}
            </span>
            <label className="video-player-controls__skip-toggle" title="삭제된 구간 건너뛰기">
              <input
                type="checkbox"
                checked={skipDeletedMode}
                onChange={() => useVideoStore.getState().toggleSkipMode()}
              />
              컷 스킵
            </label>
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
