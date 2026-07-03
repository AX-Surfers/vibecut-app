import { create } from "zustand";

interface VideoState {
  currentTime: number;
  isPlaying: boolean;
  skipDeletedMode: boolean;
  activeWordId: string | null;
  subtitleSize: number;
  seekTo: ((time: number) => void) | null;
  play: (() => void) | null;
  pause: (() => void) | null;
  setSeekFn: (fn: (time: number) => void) => void;
  setPlayFn: (fn: () => void) => void;
  setPauseFn: (fn: () => void) => void;
  setCurrentTime: (t: number) => void;
  setActiveWordId: (id: string | null) => void;
  setPlaying: (playing: boolean) => void;
  setSubtitleSize: (size: number) => void;
  toggleSkipMode: () => void;
}

export const useVideoStore = create<VideoState>((set) => ({
  currentTime: 0,
  isPlaying: false,
  skipDeletedMode: true,
  activeWordId: null,
  subtitleSize: 22,
  seekTo: null,
  play: null,
  pause: null,

  setSeekFn: (fn) => set({ seekTo: fn }),
  setPlayFn: (fn) => set({ play: fn }),
  setPauseFn: (fn) => set({ pause: fn }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setActiveWordId: (id) => set({ activeWordId: id }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  setSubtitleSize: (size) => set({ subtitleSize: size }),
  toggleSkipMode: () => set((s) => ({ skipDeletedMode: !s.skipDeletedMode })),
}));
