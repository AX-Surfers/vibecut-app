import { useEffect } from "react";
import { Virtuoso } from "react-virtuoso";
import { useTranscriptStore } from "../state/transcriptStore";
import { SceneCard } from "./SceneCard";

interface Props {
  suggestedSceneIds?: Set<string>;
}

export function SceneList({ suggestedSceneIds }: Props) {
  const scenes = useTranscriptStore((s) => s.scenes);
  const selectedSceneId = useTranscriptStore((s) => s.selectedSceneId);
  const setSelectedSceneId = useTranscriptStore((s) => s.setSelectedSceneId);

  useEffect(() => {
    if (scenes.length === 0) {
      setSelectedSceneId(null);
      return;
    }

    if (selectedSceneId && scenes.some((scene) => scene.id === selectedSceneId)) return;
    setSelectedSceneId(scenes[0].id);
  }, [scenes, selectedSceneId, setSelectedSceneId]);

  if (scenes.length === 0) {
    return (
      <div className="scene-list--empty">
        <p>파일을 열어 시작하세요</p>
        <p className="scene-list--empty-hint">File → 프로젝트 열기 또는 words.json 가져오기</p>
      </div>
    );
  }

  return (
    <Virtuoso
      className="scene-list"
      totalCount={scenes.length}
      itemContent={(index) => (
        <SceneCard
          index={index}
          scene={scenes[index]}
          isSuggested={suggestedSceneIds?.has(scenes[index].id)}
          isSelected={selectedSceneId === scenes[index].id}
          onSelect={() => setSelectedSceneId(scenes[index].id)}
        />
      )}
    />
  );
}
