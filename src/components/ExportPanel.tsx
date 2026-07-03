import { useState, useCallback, useEffect } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useTranscriptStore } from "../state/transcriptStore";
import { useProjectStore } from "../state/projectStore";
import { compileKeepSpans, buildSubtitleText } from "../lib/segmentCompiler";
import { exportToCapcut, droppedIndexesToWordIds } from "../lib/exportCapcut";
import type { AutoEditAnalysisResult, PythonExportResult } from "../types";

interface Props {
  onDropWarnings: (wordIds: Set<string>) => void;
  onSuggestionPreview: (sceneIds: Set<string>, wordIds: Set<string>) => void;
}

const REASON_LABEL: Record<string, string> = {
  explicit_retry: "재시도 신호",
  adjacent_duplicate: "중복 시도",
  self_repeat: "문장 내부 반복",
  short_restart: "짧은 재시작",
};

export function ExportPanel({ onDropWarnings, onSuggestionPreview }: Props) {
  const scenes = useTranscriptStore((s) => s.scenes);
  const setWordDeleted = useTranscriptStore((s) => s.setWordDeleted);
  const clearDeletedWords = useTranscriptStore((s) => s.clearDeletedWords);
  const { templatePath, capCutProjectPath } = useProjectStore();
  const videoFile = useTranscriptStore((s) => s.videoFile);

  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [lastResult, setLastResult] = useState<PythonExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoEditSummary, setAutoEditSummary] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AutoEditAnalysisResult | null>(null);

  // CapCut 프로젝트를 가져온 경우 원본 draft로 바로 되돌려쓸 수 있도록 저장 위치를
  // 기본값으로 채워둔다 — "저장 위치 선택"으로 언제든 다른 경로로 바꿀 수 있다.
  useEffect(() => {
    if (capCutProjectPath) setOutputPath(capCutProjectPath);
  }, [capCutProjectPath]);

  const handleSelectOutput = useCallback(async () => {
    const selected = await save({
      filters: [{ name: "CapCut Draft", extensions: ["json"] }],
      defaultPath: "draft_info_edited.json",
    });
    if (selected) setOutputPath(selected);
  }, []);

  const handleExport = useCallback(async () => {
    if (!templatePath) {
      setError(
        "draft_info.json 템플릿이 필요합니다. 영상 파일과 같은 폴더에 draft_info.json 또는 draft_info.backup.json을 놓아주세요."
      );
      return;
    }
    const resolvedOutput = outputPath;
    if (!resolvedOutput) {
      setError("저장 위치를 먼저 선택하세요.");
      return;
    }
    setError(null);
    setExporting(true);
    try {
      const keepSpans = compileKeepSpans(scenes);

      // 각 keepSpan의 자막 텍스트 계산
      const wordTextMap = new Map<string, string>();
      const wordSceneMap = new Map<string, string>();
      const sceneMap = new Map(scenes.map((s) => [s.id, s]));
      for (const scene of scenes) {
        for (const word of scene.words) {
          wordTextMap.set(word.id, word.text);
          wordSceneMap.set(word.id, scene.id);
        }
      }
      const subtitleTexts = keepSpans.map((span) => {
        const sceneIds = new Set(
          span.wordIds.map((id) => wordSceneMap.get(id)).filter(Boolean) as string[]
        );
        if (sceneIds.size === 1) {
          const scene = sceneMap.get([...sceneIds][0]);
          if (scene) return buildSubtitleText(scene);
        }
        return span.wordIds.map((id) => wordTextMap.get(id) ?? "").filter(Boolean).join(" ");
      });

      const result = await exportToCapcut(keepSpans, templatePath, resolvedOutput, videoFile, subtitleTexts);
      setLastResult(result);

      // 드롭된 word token에 주황 경고 표시
      const droppedIdxSet = new Set(result.droppedRanges.map((d) => d.inputIndex));
      onDropWarnings(droppedIndexesToWordIds(droppedIdxSet, keepSpans));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }, [templatePath, outputPath, scenes, videoFile, onDropWarnings]);

  const handleAutoEdit = useCallback(async () => {
    setError(null);
    try {
      const analysisRaw = await invoke<string>("analyze_auto_edit", {
        scenesJson: JSON.stringify({ scenes }),
      });
      const analysis = JSON.parse(analysisRaw) as AutoEditAnalysisResult;
      setAnalysis(analysis);

      if (analysis.suggestions.length === 0) {
        onSuggestionPreview(new Set(), new Set());
        setAutoEditSummary("자동 컷 후보를 찾지 못했습니다.");
        return;
      }

      if (analysis.wordIds.length === 0) {
        onSuggestionPreview(new Set(), new Set());
        setAutoEditSummary("후보는 있었지만 이미 모두 제외된 구간입니다.");
        return;
      }
      onSuggestionPreview(
        new Set(analysis.suggestions.map((item) => item.sceneId)),
        new Set(analysis.wordIds)
      );

      const reasonText = Object.entries(analysis.reasonCounts)
        .map(([reason, count]) => `${reason}:${count}`)
        .join(", ");

      setAutoEditSummary(
        `${analysis.suggestions.length}개 씬 / ${analysis.wordIds.length}개 단어 추천 (${reasonText})`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [onSuggestionPreview, scenes]);

  const handleApplySuggestions = useCallback(() => {
    if (!analysis || analysis.wordIds.length === 0) return;
    setWordDeleted(analysis.wordIds, true);
    onSuggestionPreview(new Set(), new Set());
    setAutoEditSummary(
      `${analysis.suggestions.length}개 씬 / ${analysis.wordIds.length}개 단어 자동 제외 적용 완료`
    );
    setAnalysis(null);
  }, [analysis, onSuggestionPreview, setWordDeleted]);

  const handleClearPreview = useCallback(() => {
    setAnalysis(null);
    onSuggestionPreview(new Set(), new Set());
    setAutoEditSummary("자동 컷 추천 미리보기를 해제했습니다.");
  }, [onSuggestionPreview]);

  const handleResetCuts = useCallback(() => {
    clearDeletedWords();
    onDropWarnings(new Set());
    onSuggestionPreview(new Set(), new Set());
    setAnalysis(null);
    setAutoEditSummary("자동/수동 컷 제외를 모두 초기화했습니다.");
    setLastResult(null);
    setError(null);
  }, [clearDeletedWords, onDropWarnings, onSuggestionPreview]);

  return (
    <div className="export-panel">
      <div className="export-panel__row">
        <span className="export-panel__label">템플릿</span>
        <span className="export-panel__path">
          {templatePath ?? "draft_info.json 미감지"}
        </span>
      </div>

      <div className="export-panel__row">
        <button className="btn btn--secondary" onClick={handleAutoEdit} disabled={scenes.length === 0 || exporting}>
          추천 생성
        </button>
        <button className="btn btn--secondary" onClick={handleResetCuts} disabled={scenes.length === 0 || exporting}>
          컷 초기화
        </button>
      </div>

      {analysis && analysis.suggestions.length > 0 && (
        <div className="export-panel__review">
          <div className="export-panel__review-head">
            <div>
              <div className="export-panel__review-title">추천 컷 검토</div>
              <div className="export-panel__review-subtitle">
                하이라이트된 씬과 단어를 확인한 뒤 적용하세요.
              </div>
            </div>
            <div className="export-panel__review-actions">
              <button className="btn btn--secondary" onClick={handleClearPreview}>
                미리보기 해제
              </button>
              <button className="btn btn--accent" onClick={handleApplySuggestions}>
                추천 적용
              </button>
            </div>
          </div>

          <div className="export-panel__suggestions">
            {analysis.suggestions.map((item) => {
              const scene = scenes.find((candidate) => candidate.id === item.sceneId);
              const text = scene
                ? scene.words.filter((word) => !word.deleted).map((word) => word.text).join(" ")
                : item.sceneId;
              return (
                <div key={`${item.sceneId}-${item.reason}`} className="export-panel__suggestion-card">
                  <div className="export-panel__suggestion-top">
                    <span className="export-panel__suggestion-reason">
                      {REASON_LABEL[item.reason] ?? item.reason}
                    </span>
                    <span className="export-panel__suggestion-score">
                      {Math.round(item.score * 100)}%
                    </span>
                  </div>
                  <div className="export-panel__suggestion-text">{text || "(내용 없음)"}</div>
                  <div className="export-panel__suggestion-meta">
                    {item.wordIds.length}개 단어 추천 제외
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="export-panel__row">
        <button className="btn btn--secondary" onClick={handleSelectOutput}>
          저장 위치 선택
        </button>
        <span className="export-panel__path">
          {outputPath ?? "저장 경로 미설정"}
        </span>
      </div>

      <button
        className="btn btn--export"
        onClick={handleExport}
        disabled={exporting}
      >
        {exporting ? "내보내는 중…" : "CapCut으로 내보내기"}
      </button>

      {error && <div className="export-panel__error">{error}</div>}
      {autoEditSummary && <div className="export-panel__result">{autoEditSummary}</div>}

      {lastResult && (
        <div className="export-panel__result">
          ✓ {lastResult.snappedRanges.length}개 구간 내보내기 완료
          {lastResult.droppedRanges.length > 0 && (
            <span className="export-panel__dropped">
              {" · "}{lastResult.droppedRanges.length}개 구간 드롭 (주황 표시)
            </span>
          )}
        </div>
      )}
    </div>
  );
}
