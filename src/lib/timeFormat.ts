/** "MM:SS + D.DD초" 형식으로 변환 */
export function formatTimestamp(startSec: number, durationSec: number): string {
  const minutes = Math.floor(startSec / 60);
  const seconds = Math.floor(startSec % 60);
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${mm}:${ss} + ${durationSec.toFixed(2)}초`;
}

/** 마이크로초 → 초 */
export function usToSec(us: number): number {
  return us / 1_000_000;
}

/** 초 → 마이크로초 */
export function secToUs(sec: number): number {
  return Math.round(sec * 1_000_000);
}

const FRAME_US = 1_000_000 / 30;

/** 프레임 번호 → 마이크로초 */
export function frameToUs(frame: number): number {
  return Math.round(frame * FRAME_US);
}
