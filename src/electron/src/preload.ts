import { contextBridge, ipcRenderer } from "electron";
import type { PublicState } from "./protocol";

export interface VibecheckBridge {
  state: () => Promise<PublicState>;
  onState: (listener: (state: PublicState) => void) => () => void;
  setFeature: (name: "notch" | "codex", enabled: boolean) => Promise<void>;
  setPaused: (paused: boolean) => Promise<void>;
  recover: () => Promise<void>;
  quit: () => Promise<void>;
  dismiss: () => void;
}

const bridge: VibecheckBridge = {
  state: () => ipcRenderer.invoke("vibecheck:state"),
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: PublicState) =>
      listener(state);
    ipcRenderer.on("vibecheck:state", handler);
    return () => ipcRenderer.off("vibecheck:state", handler);
  },
  setFeature: (name, enabled) =>
    ipcRenderer.invoke("vibecheck:set-feature", name, enabled),
  setPaused: (paused) => ipcRenderer.invoke("vibecheck:set-paused", paused),
  recover: () => ipcRenderer.invoke("vibecheck:recover"),
  quit: () => ipcRenderer.invoke("vibecheck:quit"),
  dismiss: () => ipcRenderer.send("vibecheck:dismiss"),
};

contextBridge.exposeInMainWorld("vibecheck", Object.freeze(bridge));
