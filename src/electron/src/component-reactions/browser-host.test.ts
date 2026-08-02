// @vitest-environment node

import { once } from "node:events";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserReactionHost } from "./browser-host";
import {
  browserProof,
  type BrowserChallenge,
  type BrowserHostMessage,
} from "./browser-protocol";
import type { RendererReactionContext } from "./types";
import { browserCommit } from "./browser-protocol.test";

const hosts: BrowserReactionHost[] = [];

afterEach(async () => {
  await Promise.allSettled(hosts.splice(0).map((host) => host.dispose()));
});

describe("browser reaction host", () => {
  it("rejects non-extension websocket origins", async () => {
    const host = await startHost();
    const socket = new WebSocket(
      `ws://127.0.0.1:${host.port}/component-reactions/v1`,
      { headers: { Origin: "https://example.com" } },
    );
    const error = await new Promise<Error>((resolve) => {
      socket.once("error", resolve);
    });
    expect(error.message).toContain("403");
  });

  it("authenticates, synchronizes, accepts one live commit, and settles its document", async () => {
    const png = Buffer.from("\x89PNG\r\n\x1a\ncropped", "binary");
    const host = await startHost(() => png);
    const tapback = "data:image/png;base64,iVBORw0KGgo=";
    await host.setEnabled(true, ["🎯"], { heart: tapback });
    const socket = await connect(host, {
      enabled: true,
      recents: ["🎯"],
      tapback_assets: { heart: tapback },
    });
    const inventoryState = once(host, "state");
    socket.send(
      JSON.stringify({
        version: 1,
        type: "inventory",
        documents: [
          {
            tab_id: 7,
            window_id: 3,
            frame_id: 0,
            document_id: "document-one",
            title: "Fixture",
            url: "https://example.com",
            active: true,
          },
        ],
      }),
    );
    await inventoryState;
    expect(host.state).toMatchObject({
      transport: "connected",
      attached_tabs: 1,
    });

    const accepted = once(host, "commit");
    socket.send(JSON.stringify(browserCommit()));
    const [context] = (await accepted) as [RendererReactionContext];
    expect(context.source).toEqual({
      name: "Google Chrome",
      bundle_id: "com.google.Chrome",
    });
    await expect(context.capture()).resolves.toEqual(png);

    const settlement = nextMessage(socket);
    await context.settle("no_active_turn");
    await expect(settlement).resolves.toMatchObject({
      version: 1,
      type: "settle",
      event_id: "event-one",
      document_id: "document-one",
      outcome: "no_active_turn",
    });
  });

  it("rejects authentication failure and deduplicates retried events", async () => {
    const host = await startHost(() =>
      Buffer.from("\x89PNG\r\n\x1a\ncrop", "binary"),
    );
    const unauthenticated = new WebSocket(
      `ws://127.0.0.1:${host.port}/component-reactions/v1`,
      {
        headers: { Origin: "chrome-extension://abcdefghijklmnop" },
      },
    );
    const challenge = (await nextMessage(unauthenticated)) as BrowserChallenge;
    unauthenticated.send(
      JSON.stringify({
        version: 1,
        type: "hello",
        nonce: challenge.nonce,
        proof: "0".repeat(64),
        browser: "chrome",
        extension_version: "0.2.2",
        profile_id: "bad-profile",
      }),
    );
    unauthenticated.on("error", () => undefined);
    await once(unauthenticated, "close");

    const socket = await connect(host);
    socket.send(
      JSON.stringify({
        version: 1,
        type: "inventory",
        documents: [
          {
            tab_id: 7,
            window_id: 3,
            frame_id: 0,
            document_id: "document-one",
            title: "",
            url: "https://example.com",
            active: true,
          },
        ],
      }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    let commits = 0;
    host.on("commit", () => {
      commits += 1;
    });
    const message = JSON.stringify(browserCommit());
    socket.send(message);
    socket.send(message);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(commits).toBe(1);
  });

  it("reports a bind collision without taking over the listener", async () => {
    const first = await startHost();
    const second = new BrowserReactionHost({ port: first.port! });
    hosts.push(second);
    await expect(second.start()).rejects.toThrow();
    expect(second.state.transport).toBe("degraded");
  });

  it("returns to off after bounded shutdown", async () => {
    const host = await startHost();
    await connect(host);
    await host.dispose();
    expect(host.state).toEqual({
      transport: "off",
      attached_tabs: 0,
      last_error: null,
    });
  });
});

async function startHost(
  crop: (dataUrl: string, bounds: never, viewport: never) => Buffer = () =>
    Buffer.alloc(0),
): Promise<BrowserReactionHost> {
  const host = new BrowserReactionHost({
    port: 0,
    crop: crop as never,
  });
  hosts.push(host);
  await host.start();
  return host;
}

async function connect(
  host: BrowserReactionHost,
  expectedState: Record<string, unknown> = {},
): Promise<WebSocket> {
  const socket = new WebSocket(
    `ws://127.0.0.1:${host.port}/component-reactions/v1`,
    { headers: { Origin: "chrome-extension://abcdefghijklmnop" } },
  );
  const challenge = (await nextMessage(socket)) as BrowserChallenge;
  const profileId = "test-profile";
  socket.send(
    JSON.stringify({
      version: 1,
      type: "hello",
      nonce: challenge.nonce,
      proof: browserProof(challenge.nonce, "chrome", profileId),
      browser: "chrome",
      extension_version: "0.2.2",
      profile_id: profileId,
    }),
  );
  const state = await nextMessage(socket);
  expect(state).toMatchObject({
    version: 1,
    type: "state",
    tapback_assets: {},
    ...expectedState,
  });
  return socket;
}

function nextMessage(socket: WebSocket): Promise<BrowserHostMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData): void => {
      cleanup();
      resolve(JSON.parse(data.toString()) as BrowserHostMessage);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    socket.once("message", onMessage);
    socket.once("error", onError);
  });
}
