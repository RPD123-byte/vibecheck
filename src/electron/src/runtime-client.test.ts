// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => "/unused",
    getPath: () => "/unused",
  },
}));

import type { FeaturePreferences } from "./preferences";
import { RuntimeClient } from "./runtime-client";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

class MemoryPreferences {
  value: FeaturePreferences = {
    notch_enabled: false,
    codex_enabled: false,
  };

  read(): FeaturePreferences {
    return { ...this.value };
  }

  write(value: FeaturePreferences): void {
    this.value = { ...value };
  }
}

describe("RuntimeClient", () => {
  it("drives a real private socket, reconnects, rejects stale state, and quits", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "vibecheck-client-"),
    );
    directories.push(directory);
    const script = path.join(directory, "fake-owner.cjs");
    const socket = path.join(directory, "control.sock");
    fs.writeFileSync(script, fakeOwnerSource());
    const preferences = new MemoryPreferences();
    const client = new RuntimeClient(preferences, () => ({
      executable: process.execPath,
      args: [script, socket],
      cwd: directory,
    }));

    await client.start();
    expect(client.state?.aggregate).toBe("off");
    await client.setFeature("notch", true);
    expect(client.state?.features.notch_enabled).toBe(true);
    expect(preferences.value.notch_enabled).toBe(true);

    const reconnected = once(client, "reconnected");
    await client.setFeature("codex", true);
    await reconnected;
    expect(client.state?.features.revision).toBe(2);
    expect(client.state?.features.integrations.codex_enabled).toBe(true);

    await client.shutdown();
  });

  it("restarts a crashed owner without overlapping the replacement", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "vibecheck-client-"),
    );
    directories.push(directory);
    const script = path.join(directory, "fake-owner.cjs");
    const socket = path.join(directory, "control.sock");
    const crashMarker = path.join(directory, "crashed-once");
    fs.writeFileSync(script, fakeOwnerSource());
    const client = new RuntimeClient(new MemoryPreferences(), () => ({
      executable: process.execPath,
      args: [script, socket, crashMarker],
      cwd: directory,
    }));

    await client.start();
    const ownerError = once(client, "runtime-error");
    await ownerError;
    await once(client, "state");
    expect(fs.existsSync(crashMarker)).toBe(true);
    expect(client.state?.aggregate).toBe("off");
    await client.shutdown();
  });
});

function fakeOwnerSource(): string {
  return String.raw`
const fs = require("node:fs");
const net = require("node:net");
const socketPath = process.argv[2];
const crashMarker = process.argv[3];
const runtimeId = "fake-runtime";
const token = "fake-controller-token-with-enough-entropy";
let shouldDisconnect = false;
let state = {
  features: {
    revision: 0,
    notch_enabled: false,
    integrations: { codex_enabled: false },
    paused: false
  },
  desired_roles: [],
  effective_roles: [],
  aggregate: "off",
  workers: {},
  errors: []
};
function send(stream, message) {
  stream.write(JSON.stringify(message) + "\n");
}
function envelope(type, id) {
  return { version: 1, type, id, runtime_id: runtimeId, state };
}
const server = net.createServer((stream) => {
  send(stream, envelope("state_update"));
  if (shouldDisconnect) {
    send(stream, {
      ...envelope("state_update"),
      state: {
        ...state,
        features: { ...state.features, revision: state.features.revision - 1 }
      }
    });
  }
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const message = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (message.type === "set_features") {
        state = {
          ...state,
          features: {
            revision: state.features.revision + 1,
            ...message.features
          },
          aggregate:
            message.features.notch_enabled ||
            message.features.integrations.codex_enabled
              ? "active"
              : "off"
        };
        send(stream, envelope("ack", message.id));
        if (
          state.features.integrations.codex_enabled &&
          !shouldDisconnect
        ) {
          shouldDisconnect = true;
          setTimeout(() => stream.destroy(), 20);
        }
      } else if (message.type === "shutdown") {
        send(stream, envelope("ack", message.id));
        setTimeout(() => {
          server.close();
          try { fs.unlinkSync(socketPath); } catch {}
          process.exit(0);
        }, 20);
      } else {
        send(stream, envelope("ack", message.id));
      }
    }
  });
});
try { fs.unlinkSync(socketPath); } catch {}
server.listen(socketPath, () => {
  fs.chmodSync(socketPath, 0o600);
  console.log(JSON.stringify({
    version: 1,
    type: "bootstrap",
    runtime_id: runtimeId,
    control_socket: socketPath,
    controller_token: token
  }));
  if (crashMarker && !fs.existsSync(crashMarker)) {
    setTimeout(() => {
      fs.writeFileSync(crashMarker, "crashed");
      process.exit(17);
    }, 100);
  }
});
`;
}
