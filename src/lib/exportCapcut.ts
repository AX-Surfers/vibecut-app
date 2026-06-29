import { invoke } from "@tauri-apps/api/core";
import type { KeepSpan, PythonExportResult } from "../types";

interface ExportInput {
  spans: [number, number][];
  template_path: string;
  output_path: string;
  video_file: string;
  subtitles?: string[];
  capcut_path?: string; // legacy
}

export async function exportToCapcut(
  keepSpans: KeepSpan[],
  templatePath: string,
  outputPath: string,
  videoFile: string,
  subtitles?: string[]
): Promise<PythonExportResult> {
  const input: ExportInput = {
    spans: keepSpans.map((s) => [s.startSec, s.endSec]),
    template_path: templatePath,
    output_path: outputPath,
    video_file: videoFile,
    ...(subtitles && subtitles.length > 0 ? { subtitles } : {}),
  };

  const raw = await invoke<string>("export_capcut", {
    inputJson: JSON.stringify(input),
  });

  const result = JSON.parse(raw) as PythonExportResult & { error?: string };
  if (result.error) throw new Error(result.error);
  return result;
}

/** 드롭된 inputIndex 집합 → wordId 집합으로 변환 */
export function droppedIndexesToWordIds(
  droppedInputIndexes: Set<number>,
  keepSpans: KeepSpan[]
): Set<string> {
  const wordIds = new Set<string>();
  for (const idx of droppedInputIndexes) {
    const span = keepSpans[idx];
    if (span) span.wordIds.forEach((id) => wordIds.add(id));
  }
  return wordIds;
}
