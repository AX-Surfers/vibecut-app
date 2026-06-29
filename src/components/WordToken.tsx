import type { Word } from "../types";

interface Props {
  word: Word;
  isDropWarning?: boolean;
  isSuggested?: boolean;
  onClick: (wordId: string) => void;
  onContextMenu?: (wordId: string) => void;
}

export function WordToken({ word, isDropWarning, isSuggested, onClick, onContextMenu }: Props) {
  const handleClick = () => onClick(word.id);
  const handleContextMenu = (e: React.MouseEvent) => {
    if (onContextMenu) {
      e.preventDefault();
      onContextMenu(word.id);
    }
  };

  if (word.deleted) {
    return (
      <span
        className="word-token word-token--deleted"
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        title={`${word.text} (${word.start.toFixed(2)}s)`}
      >
        [...]
      </span>
    );
  }

  return (
    <span
      className={[
        "word-token",
        "word-token--kept",
        isDropWarning ? "word-token--drop-warning" : "",
        isSuggested ? "word-token--suggested" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      title={`${word.text} (${word.start.toFixed(2)}s–${word.end.toFixed(2)}s) — 우클릭: 여기서 씬 분할`}
    >
      {word.text}
    </span>
  );
}
