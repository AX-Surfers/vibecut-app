import { invoke } from "@tauri-apps/api/core";
import type { ProjectState } from "../types";

export async function saveProject(path: string, state: ProjectState): Promise<void> {
  const json = JSON.stringify(state, null, 2);
  await invoke<void>("save_project", { path, content: json });
}

export async function loadProject(path: string): Promise<ProjectState | null> {
  try {
    const raw = await invoke<string>("load_project", { path });
    const parsed = JSON.parse(raw) as ProjectState;
    if (parsed.version !== 1 && parsed.version !== 2) throw new Error("Unknown project version");
    return parsed;
  } catch {
    return null;
  }
}
