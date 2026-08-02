import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/not-used-by-this-test" },
}));

import { Preferences } from "./preferences";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Preferences", () => {
  it("defaults both durable feature toggles off", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "vibecheck-prefs-"),
    );
    directories.push(directory);
    const preferences = new Preferences(
      path.join(directory, "preferences.json"),
    );
    expect(preferences.read()).toEqual({
      notch_enabled: false,
      codex_enabled: false,
      component_reactions_enabled: false,
      emoji_recents: [],
    });
  });

  it("persists only feature toggles and never pause or runtime data", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "vibecheck-prefs-"),
    );
    directories.push(directory);
    const file = path.join(directory, "preferences.json");
    const preferences = new Preferences(file);
    preferences.write({
      notch_enabled: true,
      codex_enabled: false,
      component_reactions_enabled: true,
      emoji_recents: ["🧭", "🎯"],
    });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
      notch_enabled: true,
      codex_enabled: false,
      component_reactions_enabled: true,
      emoji_recents: ["🧭", "🎯"],
    });
    const raw = fs.readFileSync(file, "utf8");
    expect(raw).not.toContain("paused");
    expect(raw).not.toContain("expression");
    expect(raw).not.toContain("thread");
    expect(raw).not.toContain("frame");
  });

  it("migrates existing two-toggle preferences without losing intent", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "vibecheck-prefs-"),
    );
    directories.push(directory);
    const file = path.join(directory, "preferences.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ notch_enabled: true, codex_enabled: false }),
    );
    expect(new Preferences(file).read()).toEqual({
      notch_enabled: true,
      codex_enabled: false,
      component_reactions_enabled: false,
      emoji_recents: [],
    });
  });
});
