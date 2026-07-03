import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildReadableSubtitleLines, buildSubtitleText } from "../lib/segmentCompiler";
import { useTranscriptStore } from "../state/transcriptStore";
import type { Scene } from "../types";

interface Props {
  scene: Scene;
  previousSceneId?: string;
  onSelect?: () => void;
  onSelectScene?: (sceneId: string) => void;
  onCommitSubtitle: (sceneId: string, text: string) => void;
  onMergeWithPrevious: (sceneId: string, previousSceneId: string) => void;
  onFocusSeek?: () => void;
}

export function SceneSubtitleEditor({
  scene,
  previousSceneId,
  onSelect,
  onSelectScene,
  onCommitSubtitle,
  onMergeWithPrevious,
  onFocusSeek,
}: Props) {
  const subtitle = buildSubtitleText(scene);
  const setSceneSubtitleDraft = useTranscriptStore((s) => s.setSubtitleDraft);
  const clearSceneSubtitleDraft = useTranscriptStore((s) => s.clearSubtitleDraft);
  const subtitleLines = useMemo(
    () =>
      scene.subtitleOverride !== undefined
        ? scene.subtitleOverride.split("\n").map((line) => line.trim()).filter(Boolean)
        : buildReadableSubtitleLines(scene),
    [scene]
  );
  const visibleSubtitle = subtitleLines.join("\n");
  const [subtitleDraft, setSubtitleDraft] = useState(visibleSubtitle);
  const subtitleInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setSubtitleDraft(visibleSubtitle);
    setSceneSubtitleDraft(scene.id, visibleSubtitle);
    return () => clearSceneSubtitleDraft(scene.id);
  }, [clearSceneSubtitleDraft, scene.id, setSceneSubtitleDraft, visibleSubtitle]);

  const commitSubtitle = useCallback((nextValue: string) => {
    const trimmed = nextValue.trim();
    const resolvedText = trimmed || subtitle;
    onCommitSubtitle(scene.id, resolvedText);
    setSubtitleDraft(resolvedText);
    clearSceneSubtitleDraft(scene.id);
  }, [clearSceneSubtitleDraft, onCommitSubtitle, scene.id, subtitle]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      commitSubtitle(event.currentTarget.value);
      subtitleInputRef.current?.blur();
      return;
    }

    if (
      event.key === "Backspace" &&
      previousSceneId &&
      event.currentTarget.selectionStart === 0 &&
      event.currentTarget.selectionEnd === 0
    ) {
      event.preventDefault();
      onSelectScene?.(previousSceneId);
      onMergeWithPrevious(scene.id, previousSceneId);
      return;
    }

    if (event.key === "Escape") {
      setSubtitleDraft(visibleSubtitle);
      subtitleInputRef.current?.blur();
    }
  }, [commitSubtitle, onMergeWithPrevious, onSelectScene, previousSceneId, scene.id, visibleSubtitle]);

  return (
    <div className="scene-card__preview">
      <textarea
        ref={subtitleInputRef}
        className="scene-card__subtitle-input"
        value={subtitleDraft}
        onChange={(event) => {
          const nextValue = event.target.value;
          setSubtitleDraft(nextValue);
          setSceneSubtitleDraft(scene.id, nextValue);
        }}
        onFocus={() => { onSelect?.(); onFocusSeek?.(); }}
        onBlur={(event) => commitSubtitle(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        onClick={(event) => event.stopPropagation()}
        placeholder="자막 문장을 입력하세요"
        title="문장 맨 앞에서 Backspace를 누르면 이전 씬과 합쳐집니다."
      />
    </div>
  );
}
