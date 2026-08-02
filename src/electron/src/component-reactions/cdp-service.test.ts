// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CdpService, CdpSession } from "./cdp-service";
import type { TargetRecord } from "./types";

describe("centralized component CDP lifecycle", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.errorsByUrl.clear();
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches every page, installs current state, refreshes navigation, and disposes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          page("one", "ws://fixture/one"),
          page("two", "ws://fixture/two"),
          { id: "worker", type: "service_worker" },
        ],
      })),
    );
    const service = new CdpService();
    const tapback = "data:image/png;base64,iVBORw0KGgo=";
    await service.setEnabled(true, ["🔥"], { heart: tapback });
    await service.setCaptureSession("global-session");

    expect(await service.attach(target())).toBe(2);
    expect(FakeWebSocket.instances).toHaveLength(2);
    for (const socket of FakeWebSocket.instances) {
      expect(methods(socket)).toEqual([
        "Runtime.enable",
        "Page.enable",
        "Runtime.addBinding",
        "Page.addScriptToEvaluateOnNewDocument",
        "Runtime.evaluate",
        "Runtime.evaluate",
        "Runtime.evaluate",
      ]);
      expect(expressions(socket)).toContainEqual(
        expect.stringContaining(
          `setEnabled(...[true,["🔥"],{"heart":"${tapback}"}])`,
        ),
      );
      expect(lastExpression(socket)).toContain(
        'setCaptureSession(...["global-session"])',
      );
    }

    const [first, second] = FakeWebSocket.instances;
    if (!first || !second) throw new Error("fixture pages were not attached");
    await service.setEnabled(false, [], {});
    first.dispatch("message", {
      data: JSON.stringify({ method: "Page.loadEventFired", params: {} }),
    });
    await nextTurn();
    expect(expressions(first)).toContainEqual(
      expect.stringContaining("setEnabled(...[false,[],{}])"),
    );
    expect(lastExpression(first)).toContain(
      'setCaptureSession(...["global-session"])',
    );

    first.close();
    await service.settle("com.example.fixture", "one", "event", "sent");
    expect(lastExpression(first)).not.toContain("settle");

    await service.dispose();
    expect(FakeWebSocket.instances.every((socket) => socket.closed)).toBe(true);
    expect(lastExpression(second)).toContain("dispose");
  });

  it("validates and routes renderer session toggles separately from commits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [page("one", "ws://fixture/one")],
      })),
    );
    const service = new CdpService();
    const toggles: unknown[] = [];
    const commits: unknown[] = [];
    const diagnostics: unknown[] = [];
    service.on("toggle-capture-session", (value) => toggles.push(value));
    service.on("commit", (value) => commits.push(value));
    service.on("diagnostic", (value) => diagnostics.push(value));
    await service.attach(target());
    const socket = FakeWebSocket.instances[0];
    if (!socket) throw new Error("fixture page was not attached");

    socket.dispatch("message", {
      data: JSON.stringify({
        method: "Runtime.bindingCalled",
        params: {
          name: "__vibecheckComponentCommit",
          payload: JSON.stringify({
            schema_version: 1,
            type: "toggle_capture_session",
            document_id: "fixture-document",
          }),
        },
      }),
    });
    socket.dispatch("message", {
      data: JSON.stringify({
        method: "Runtime.bindingCalled",
        params: {
          name: "__vibecheckComponentCommit",
          payload: JSON.stringify({
            schema_version: 1,
            type: "toggle_capture_session",
            document_id: "fixture-document",
            unexpected: true,
          }),
        },
      }),
    });

    expect(toggles).toHaveLength(1);
    expect(commits).toHaveLength(0);
    expect(diagnostics).toHaveLength(1);
    await service.dispose();
  });

  it("does not duplicate an existing page session on repeated discovery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [page("one", "ws://fixture/one")],
      })),
    );
    const service = new CdpService();

    expect(await service.attach(target())).toBe(1);
    expect(await service.attach(target())).toBe(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0]?.close();
    expect(await service.attach(target())).toBe(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await service.dispose();
  });

  it("removes a partially installed session so discovery can retry it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [page("one", "ws://fixture/one")],
      })),
    );
    FakeWebSocket.errorsByUrl.set(
      "ws://fixture/one",
      new Map([["Runtime.addBinding", "fixture policy rejected binding"]]),
    );
    const service = new CdpService();

    await expect(service.attach(target())).rejects.toThrow(
      "fixture policy rejected binding",
    );
    expect(FakeWebSocket.instances[0]?.closed).toBe(true);

    FakeWebSocket.errorsByUrl.clear();
    await expect(service.attach(target())).resolves.toBe(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await service.dispose();
  });

  it("captures the exact clipped viewport bounds and rejects malformed PNG data", async () => {
    const service = new CdpService();
    const validSocket = new FakeWebSocket("ws://fixture/capture");
    validSocket.results.set("Page.captureScreenshot", {
      data: Buffer.from("\x89PNG\r\n\x1a\nfixture", "binary").toString(
        "base64",
      ),
    });
    const validSession = new CdpSession(
      "capture",
      validSocket as unknown as WebSocket,
    );

    await expect(
      service.capture(validSession, {
        x: 4,
        y: 6,
        width: 80,
        height: 40,
        device_scale_factor: 2,
      }),
    ).resolves.toEqual(Buffer.from("\x89PNG\r\n\x1a\nfixture", "binary"));
    const capture = validSocket.sent.find(
      (message) => message.method === "Page.captureScreenshot",
    );
    expect(capture?.params).toMatchObject({
      captureBeyondViewport: false,
      clip: { x: 4, y: 6, width: 80, height: 40, scale: 1 },
    });

    const invalidSocket = new FakeWebSocket("ws://fixture/invalid");
    invalidSocket.results.set("Page.captureScreenshot", {
      data: Buffer.from("not a png").toString("base64"),
    });
    const invalidSession = new CdpSession(
      "invalid",
      invalidSocket as unknown as WebSocket,
    );
    await expect(
      service.capture(invalidSession, {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        device_scale_factor: 1,
      }),
    ).rejects.toThrow("invalid PNG");
    validSession.close();
    invalidSession.close();
  });
});

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  static errorsByUrl = new Map<string, Map<string, string>>();
  readonly readyState = FakeWebSocket.OPEN;
  readonly sent: Array<Record<string, unknown>> = [];
  readonly results = new Map<string, Record<string, unknown>>();
  closed = false;
  private readonly listeners = new Map<string, Array<(event: any) => void>>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(
    type: string,
    listener: (event: any) => void,
    _options?: { once?: boolean },
  ): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(serialized: string): void {
    const message = JSON.parse(serialized) as Record<string, unknown>;
    this.sent.push(message);
    queueMicrotask(() => {
      const error = FakeWebSocket.errorsByUrl
        .get(this.url)
        ?.get(String(message.method));
      this.dispatch("message", {
        data: JSON.stringify({
          id: message.id,
          ...(error
            ? { error: { message: error } }
            : { result: this.results.get(String(message.method)) ?? {} }),
        }),
      });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.dispatch("close", {});
  }

  dispatch(type: string, event: any): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function target(): TargetRecord {
  return {
    name: "Fixture",
    bundle_id: "com.example.fixture",
    bundle_path: "/Applications/Fixture.app",
    pid: 10,
    debug_port: 43_000,
    ownership_marker: "fixture",
    enrolled: true,
    attached: false,
    status: "attaching",
    last_error: null,
  };
}

function page(id: string, webSocketDebuggerUrl: string) {
  return {
    id,
    type: "page",
    title: id,
    url: `app://${id}`,
    webSocketDebuggerUrl,
  };
}

function methods(socket: FakeWebSocket): unknown[] {
  return socket.sent.map((message) => message.method);
}

function lastExpression(socket: FakeWebSocket): string {
  const evaluate = [...socket.sent]
    .reverse()
    .find((message) => message.method === "Runtime.evaluate");
  return String(
    (evaluate?.params as Record<string, unknown> | undefined)?.expression ?? "",
  );
}

function expressions(socket: FakeWebSocket): string[] {
  return socket.sent
    .filter((message) => message.method === "Runtime.evaluate")
    .map((message) =>
      String(
        (message.params as Record<string, unknown> | undefined)?.expression ??
          "",
      ),
    );
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
