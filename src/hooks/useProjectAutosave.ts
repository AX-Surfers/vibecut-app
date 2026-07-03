import { useEffect, useRef } from "react";
import { saveProject } from "../lib/persistence";
import { useProjectStore } from "../state/projectStore";
import { useTranscriptStore } from "../state/transcriptStore";

const AUTOSAVE_DELAY_MS = 800;

export function useProjectAutosave() {
  const { scenes, sourceFile } = useTranscriptStore();
  const {
    projectPath,
    templatePath,
    capCutProjectPath,
    markDirty,
    markClean,
  } = useProjectStore();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!projectPath || scenes.length === 0) return;

    markDirty();
    if (saveTimer.current) clearTimeout(saveTimer.current);

    saveTimer.current = setTimeout(async () => {
      try {
        await saveProject(projectPath, {
          version: 2,
          sourceFile,
          videoFile: useTranscriptStore.getState().videoFile,
          templatePath: templatePath ?? undefined,
          capCutProjectPath: capCutProjectPath ?? undefined,
          scenes,
          lastModified: new Date().toISOString(),
        });
        markClean();
      } catch (error) {
        console.error("자동 저장 실패:", error);
      }
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [capCutProjectPath, markClean, markDirty, projectPath, scenes, sourceFile, templatePath]);
}
