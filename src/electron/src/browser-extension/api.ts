export interface ExtensionSender {
  tab?: {
    id?: number;
    windowId?: number;
    active?: boolean;
    title?: string;
    url?: string;
  };
  frameId?: number;
  url?: string;
}

export interface ExtensionApi {
  runtime: {
    getManifest(): { version: string };
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: ExtensionSender,
        ) => unknown | Promise<unknown>,
      ): void;
    };
  };
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(value: Record<string, unknown>): Promise<void>;
    };
  };
  tabs: {
    query(queryInfo: {
      url?: string[];
    }): Promise<Array<NonNullable<ExtensionSender["tab"]>>>;
    captureVisibleTab(
      windowId: number,
      options: { format: "png" },
    ): Promise<string>;
    get(tabId: number): Promise<NonNullable<ExtensionSender["tab"]>>;
    sendMessage(
      tabId: number,
      message: unknown,
      options?: { frameId: number },
    ): Promise<unknown>;
    onRemoved: {
      addListener(listener: (tabId: number) => void): void;
    };
    onUpdated: {
      addListener(
        listener: (
          tabId: number,
          changeInfo: { status?: "loading" | "complete"; url?: string },
        ) => void,
      ): void;
    };
  };
}

export function extensionApi(): ExtensionApi {
  const root = globalThis as typeof globalThis & {
    browser?: ExtensionApi;
    chrome?: ExtensionApi;
  };
  const api = root.browser ?? root.chrome;
  if (!api) throw new Error("WebExtension APIs are unavailable");
  return api;
}
