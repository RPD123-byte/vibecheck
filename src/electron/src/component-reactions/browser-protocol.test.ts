// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  MAX_BROWSER_FRAME_BYTES,
  browserProof,
  extensionOriginAllowed,
  validateBrowserClientMessage,
} from "./browser-protocol";

describe("browser reaction protocol", () => {
  it("accepts extension origins and rejects ordinary webpages", () => {
    expect(extensionOriginAllowed("chrome-extension://abcdefghijklmnop")).toBe(
      true,
    );
    expect(
      extensionOriginAllowed(
        "safari-web-extension://com.rithvikprakki.vibecheck.browser.Extension",
      ),
    ).toBe(true);
    expect(extensionOriginAllowed("https://example.com")).toBe(false);
    expect(extensionOriginAllowed("http://127.0.0.1:43831")).toBe(false);
    expect(extensionOriginAllowed(undefined)).toBe(false);
  });

  it("validates exact handshake fields and deterministic proof", () => {
    const hello = {
      version: 1,
      type: "hello",
      nonce: "a".repeat(64),
      proof: browserProof("a".repeat(64), "chrome", "profile"),
      browser: "chrome",
      extension_version: "0.2.2",
      profile_id: "profile",
    };
    expect(validateBrowserClientMessage(hello)).toEqual(hello);
    expect(() =>
      validateBrowserClientMessage({ ...hello, command: "anything" }),
    ).toThrow(/unknown or missing/);
    expect(() =>
      validateBrowserClientMessage({ ...hello, version: 2 }),
    ).toThrow(/version/);
  });

  it("rejects commits with forged document identity or technical fields", () => {
    const commit = browserCommit();
    expect(validateBrowserClientMessage(commit)).toEqual(commit);
    expect(() =>
      validateBrowserClientMessage({
        ...commit,
        event: { ...commit.event, document_id: "other-document" },
      }),
    ).toThrow(/identity/);
    expect(() =>
      validateBrowserClientMessage({
        ...commit,
        event: { ...commit.event, outer_html: "<button>Save</button>" },
      }),
    ).toThrow(/invalid/);
    expect(() =>
      validateBrowserClientMessage({
        ...commit,
        screenshot_data_url: "x".repeat(MAX_BROWSER_FRAME_BYTES + 1),
      }),
    ).toThrow(/envelope/);
  });
});

export function browserCommit() {
  return {
    version: 1 as const,
    type: "commit" as const,
    tab_id: 7,
    window_id: 3,
    frame_id: 0,
    document_id: "document-one",
    viewport: {
      width: 800,
      height: 600,
      device_scale_factor: 2,
    },
    event: {
      schema_version: 1 as const,
      type: "commit" as const,
      event_id: "event-one",
      document_id: "document-one",
      clipboard_session_id: null,
      copy_text: "Save changes",
      reaction_emoji: "👍",
      reaction_label: "Approve",
      bounds: {
        x: 20,
        y: 30,
        width: 100,
        height: 40,
        device_scale_factor: 2,
      },
    },
    screenshot_data_url: "data:image/png;base64,iVBORw0KGgo=",
  };
}
