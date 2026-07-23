import type { VibecheckBridge } from "./preload";

declare global {
  interface Window {
    vibecheck: VibecheckBridge;
  }
}

export {};
