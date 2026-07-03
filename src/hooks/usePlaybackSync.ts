import { useEffect } from "react";
import { useVideoStore } from "../state/videoStore";
import { useTranscriptStore } from "../state/transcriptStore";

/**
 * 재생 중 currentTime이 바뀔 때마다 해당 씬을 자동 선택.
 * Zustand subscribe를 직접 써서 React 리렌더 없이 동작.
 */
export function usePlaybackSync() {
  useEffect(() => {
    return useVideoStore.subscribe((state, prev) => {
      if (!state.isPlaying) return;
      if (state.currentTime === prev.currentTime) return;

      const { scenes, selectedSceneId, setSelectedSceneId } = useTranscriptStore.getState();
      const t = state.currentTime;

      const active = scenes.find((scene) => {
        const kept = scene.words.filter((w) => !w.deleted);
        if (kept.length === 0) return false;
        return t >= kept[0].start - 0.05 && t <= kept[kept.length - 1].end + 0.15;
      });

      if (active && active.id !== selectedSceneId) {
        setSelectedSceneId(active.id);
      }
    });
  }, []);
}
