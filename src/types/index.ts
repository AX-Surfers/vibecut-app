// ── Whisper JSON (원본 파일 형태) ─────────────────────────────────────────────

export interface WhisperWord {
  start: number;
  end: number;
  word: string; // 선행 공백 포함 (예: " 엄청난")
}

export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
  words: WhisperWord[];
}

// ── 앱 내부 편집 모델 ────────────────────────────────────────────────────────

export interface Word {
  id: string;        // `${sceneId}-${index}`
  start: number;     // 초 단위
  end: number;       // 초 단위
  text: string;      // 선행 공백 제거
  deleted: boolean;
}

export interface Scene {
  id: string;             // `scene-${index}`
  start: number;
  end: number;
  words: Word[];
  thumbnailTime: number;  // = start
  sourceFile: string;     // "1.mp4" | "2.mp4"
  subtitleOverride?: string; // Phase 5: 수동 자막 오버라이드
}

// ── SegmentCompiler 출력 ────────────────────────────────────────────────────

export interface KeepSpan {
  inputIndex: number;
  startSec: number;
  endSec: number;
  wordIds: string[];   // 이 span에 포함된 Word id (provenance)
}

// ── Python 사이드카 반환 계약 ────────────────────────────────────────────────

export type DropReason = "below_min_clip" | "zero_frame";

export interface SnappedRange {
  inputIndex: number;
  frameStartUs: number;
  frameEndUs: number;
}

export interface DroppedRange {
  inputIndex: number;
  origStartSec: number;
  origEndSec: number;
  reason: DropReason;
}

export interface PythonExportResult {
  snappedRanges: SnappedRange[];
  droppedRanges: DroppedRange[];
}

export interface PrepareTranscriptResult {
  wordsJsonPath: string;
  subtitleInputPath: string;
  usedCache: boolean;
  stdout: string;
}

export interface TranscriptProgressPayload {
  stage: "starting" | "audio" | "transcribe" | "dump" | "done" | "error";
  progress: number;
  message: string;
  detail?: string;
}

export interface AutoEditSuggestion {
  sceneId: string;
  reason: "explicit_retry" | "adjacent_duplicate" | "self_repeat" | "short_restart";
  score: number;
  wordIds: string[];
}

export interface AutoEditAnalysisResult {
  suggestions: AutoEditSuggestion[];
  wordIds: string[];
  reasonCounts: Partial<Record<AutoEditSuggestion["reason"], number>>;
}

// ── 프로젝트 저장 형식 (.aside.json) ─────────────────────────────────────────

export interface ProjectState {
  version: 1;
  sourceFile: string;        // words.json 파일 경로
  videoFile: string;         // mp4 파일 경로
  templatePath?: string;     // draft_info.json 템플릿 경로
  capCutProjectPath?: string; // legacy
  deletedWordIds: string[];  // 삭제된 Word id 목록
  subtitleOverrides: Record<string, string>; // sceneId → 자막 텍스트
  lastModified: string;      // ISO 8601
}
