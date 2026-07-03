import { useState, useEffect } from "react";
import { useTranscriptStore } from "../state/transcriptStore";

const cache = new Map<string, string>();

interface Props {
  seekTime: number;
}

export function SceneThumbnail({ seekTime }: Props) {
  const videoFile = useTranscriptStore((s) => s.videoFile);
  const key = `${videoFile}@${seekTime.toFixed(1)}`;
  const [src, setSrc] = useState<string | null>(() => cache.get(key) ?? null);

  useEffect(() => {
    if (!videoFile || cache.has(key)) {
      if (cache.has(key)) setSrc(cache.get(key)!);
      return;
    }

    const assetUrl = `file://${encodeURI(videoFile).replace(/#/g, "%23").replace(/\?/g, "%3F")}`;
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;

    const onSeeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 220;
      canvas.height = 124;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(video, 0, 0, 220, 124);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
      cache.set(key, dataUrl);
      setSrc(dataUrl);
      video.src = "";
    };

    const onMeta = () => { video.currentTime = seekTime; };

    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("seeked", onSeeked);
    video.src = assetUrl;

    return () => {
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("seeked", onSeeked);
      video.src = "";
    };
  }, [key, videoFile, seekTime]);

  if (!src) return <div className="scene-thumb scene-thumb--blank" />;
  return <img className="scene-thumb" src={src} alt="" draggable={false} />;
}
