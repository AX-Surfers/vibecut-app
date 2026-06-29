import { useEffect } from "react";
import { SceneList } from "./SceneList";

interface Props {
  open: boolean;
  onClose: () => void;
  dropWarningWordIds?: Set<string>;
  suggestedWordIds?: Set<string>;
  suggestedSceneIds?: Set<string>;
}

export function SceneDrawer({ open, onClose, dropWarningWordIds, suggestedWordIds, suggestedSceneIds }: Props) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="app-drawer-overlay" onClick={onClose} />
      <div className="app-drawer" role="dialog" aria-modal="true">
        <div className="app-drawer__header">
          <span className="app-drawer__title">씬 목록</span>
          <button className="app-drawer__close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        <div className="app-drawer__body">
          <SceneList
            dropWarningWordIds={dropWarningWordIds}
            suggestedWordIds={suggestedWordIds}
            suggestedSceneIds={suggestedSceneIds}
          />
        </div>
      </div>
    </>
  );
}
