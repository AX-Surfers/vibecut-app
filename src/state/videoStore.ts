import { create } from "zustand";

interface VideoState {
  currentTime: number;
  isPlaying: boolean;
  skipDeletedMode: boolean;
  seekTo: ((time: number) => void) | null;
  setSeekFn: (fn: (time: number) => void) => void;
  setCurrentTime: (t: number) => void;
  setPlaying: (playing: boolean) => void;
  toggleSkipMode: () => void;
}

export const useVideoStore = create<VideoState>((set) => ({
  currentTime: 0,
  isPlaying: false,
  skipDeletedMode: false,
  seekTo: null,

  setSeekFn: (fn) => set({ seekTo: fn }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  toggleSkipMode: () => set((s) => ({ skipDeletedMode: !s.skipDeletedMode })),
}));
