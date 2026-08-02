// @vitest-environment node

import fs from "node:fs";
import { EventEmitter, once } from "node:events";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Preferences } from "../preferences";
import type { RuntimeSnapshot } from "../protocol";
import type { CdpService, CdpSession } from "./cdp-service";
import type { NativeCompanionClient } from "./native-companion";
import type { NativeInputBridge } from "./native-input";
import type { BrowserReactionHost } from "./browser-host";
import { ComponentReactionService } from "./reaction-service";
import { componentRendererSource } from "./renderer-source";
import { TargetRegistry } from "./target-registry";
import {
  type ReactionOutcome,
  type RendererCommit,
  type TapbackAssetMap,
  type TargetRecord,
  validateRendererCommit,
  validateTapbackAssetMap,
} from "./types";

const TAPBACK_PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("component reaction production contracts", () => {
  it("validates the shared renderer fixture and rejects technical payload fields", () => {
    const fixture = JSON.parse(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../../tests/fixtures/component_reactions/renderer_commit_v1.json",
        ),
        "utf8",
      ),
    );
    expect(validateRendererCommit(fixture).copy_text).toBe("Save changes");
    expect(() =>
      validateRendererCommit({
        ...fixture,
        bounds: { ...fixture.bounds, width: 0 },
      }),
    ).toThrow();
    expect(() =>
      validateRendererCommit({
        ...fixture,
        outer_html: "<button>Save changes</button>",
      }),
    ).toThrow();
    expect(() =>
      validateRendererCommit({
        ...fixture,
        bounds: { ...fixture.bounds, selector: "#save" },
      }),
    ).toThrow();
  });

  it("accepts only bounded allowlisted PNG tapback assets", () => {
    expect(validateTapbackAssetMap({ heart: TAPBACK_PNG })).toEqual({
      heart: TAPBACK_PNG,
    });
    expect(() =>
      validateTapbackAssetMap({ heart: "data:image/svg+xml;base64,PHN2Zz4=" }),
    ).toThrow();
    expect(() =>
      validateTapbackAssetMap({ unexpected: TAPBACK_PNG }),
    ).toThrow();
  });

  it("allocates stable unique endpoints and preserves enrollment across observations", () => {
    const registry = new TargetRegistry();
    const paper = registry.observe({
      name: "Paper",
      bundle_id: "com.paper.app",
      bundle_path: "/Applications/Paper.app",
      pid: 10,
    });
    registry.enroll(paper.bundle_id);
    const observedAgain = registry.observe({
      name: "Paper",
      bundle_id: "com.paper.app",
      bundle_path: "/Applications/Paper.app",
      pid: 11,
    });
    const other = registry.observe({
      name: "Fixture",
      bundle_id: "com.example.fixture",
      bundle_path: "/Applications/Fixture.app",
      pid: 12,
    });
    expect(observedAgain.debug_port).toBe(paper.debug_port);
    expect(observedAgain.enrolled).toBe(true);
    expect(observedAgain.pid).toBe(11);
    expect(other.debug_port).not.toBe(paper.debug_port);
  });

  it("reacquires a validated Vibecheck-managed launch after Vibecheck restarts", () => {
    const registry = new TargetRegistry();
    const marker = "0123456789abcdef0123456789abcdef";
    const paper = registry.observe({
      name: "Paper",
      bundle_id: "com.paper.app",
      bundle_path: "/Applications/Paper.app",
      pid: 10,
      managed_debug_port: 43_004,
      managed_ownership_marker: marker,
    });

    expect(paper.debug_port).toBe(43_004);
    expect(paper.ownership_marker).toBe(marker);
    expect(paper.status).toBe("managed");
  });

  it("does not trust malformed inherited launch metadata", () => {
    const registry = new TargetRegistry();
    const paper = registry.observe({
      name: "Paper",
      bundle_id: "com.paper.app",
      bundle_path: "/Applications/Paper.app",
      pid: 10,
      managed_debug_port: 43_004,
      managed_ownership_marker: "not-a-vibecheck-marker",
    });

    expect(paper.ownership_marker).not.toBe("not-a-vibecheck-marker");
    expect(paper.status).toBe("discovered");
  });

  it("reserves all inherited ports before allocating a new target", () => {
    const registry = new TargetRegistry();
    const marker = "0123456789abcdef0123456789abcdef";
    const targets = [
      {
        name: "New",
        bundle_id: "com.example.new",
        bundle_path: "/Applications/New.app",
        pid: 9,
      },
      {
        name: "Paper",
        bundle_id: "com.paper.app",
        bundle_path: "/Applications/Paper.app",
        pid: 10,
        managed_debug_port: 43_000,
        managed_ownership_marker: marker,
      },
    ];
    registry.prepare(targets);

    const newlyAllocated = registry.observe(targets[0]!);
    const inherited = registry.observe(targets[1]!);

    expect(newlyAllocated.debug_port).toBe(43_001);
    expect(inherited.debug_port).toBe(43_000);
    expect(inherited.status).toBe("managed");
  });

  it("keeps an enrolled target dormant instead of degraded after its process exits", () => {
    const registry = new TargetRegistry();
    const paper = registry.observe({
      name: "Paper",
      bundle_id: "com.paper.app",
      bundle_path: "/Applications/Paper.app",
      pid: 10,
    });
    registry.enroll(paper.bundle_id);
    registry.mark(paper.bundle_id, "unavailable", "endpoint failed");

    (
      registry as unknown as {
        reconcileRunning(bundleIds: ReadonlySet<string>): void;
      }
    ).reconcileRunning(new Set());

    expect(paper.status).toBe("stopped");
    expect(paper.attached).toBe(false);
    expect(paper.enrolled).toBe(true);
    expect(paper.last_error).toBeNull();

    const reopened = registry.observe({
      name: "Paper",
      bundle_id: "com.paper.app",
      bundle_path: "/Applications/Paper.app",
      pid: 11,
    });
    expect(reopened.debug_port).toBe(paper.debug_port);
    expect(reopened.ownership_marker).toBe(paper.ownership_marker);
  });

  it("starts target ownership and dormant injection before the feature is enabled", async () => {
    const registry = new TargetRegistry();
    const cdp = new FakeCdp([]);
    const companion = new FakeCompanion([], false, [
      {
        name: "Fixture",
        bundle_id: "com.example.fixture",
        bundle_path: "/Applications/Fixture.app",
        pid: 10,
      },
    ]);
    companion.running = false;
    companion.afterRelaunch = () => {
      cdp.endpointIsHealthy = true;
    };
    const service = new ComponentReactionService(
      new Preferences(path.join(os.tmpdir(), "unused-component-preferences")),
      companion as unknown as NativeCompanionClient,
      cdp as unknown as CdpService,
      registry,
    );

    await service.startOwnership();
    await companion.attached;

    expect(companion.startCount).toBe(1);
    expect(companion.listCount).toBeGreaterThan(0);
    expect(companion.relaunchProfiles).toEqual(["standard"]);
    expect(registry.get("com.example.fixture")?.enrolled).toBe(true);
    expect(registry.get("com.example.fixture")?.status).toBe("attached");
    expect(cdp.enabledStates[0]).toBe(false);

    await service.sync(runtimeSnapshotWithFeatures(false, false, false));
    expect(registry.get("com.example.fixture")?.enrolled).toBe(true);
    expect(cdp.enabledStates.at(-1)).toBe(false);
    await service.shutdown();
  });

  it("defers a first source-only ChatGPT relaunch until the coordinated Codex lifecycle is needed", async () => {
    const registry = new TargetRegistry();
    const companion = new FakeCompanion([], false, [
      {
        name: "ChatGPT",
        bundle_id: "com.openai.codex",
        bundle_path: "/Applications/ChatGPT.app",
        pid: 20,
      },
    ]);
    const service = new ComponentReactionService(
      new Preferences(path.join(os.tmpdir(), "unused-component-preferences")),
      companion as unknown as NativeCompanionClient,
      new FakeCdp([]) as unknown as CdpService,
      registry,
    );

    await service.startOwnership();

    expect(companion.relaunchProfiles).toEqual([]);
    expect(registry.get("com.openai.codex")?.status).toBe("deferred");
    await service.shutdown();
  });

  it("folds ChatGPT debugging into one managed Codex relaunch", async () => {
    const registry = new TargetRegistry();
    const cdp = new FakeCdp([]);
    const companion = new FakeCompanion([], false, [
      {
        name: "ChatGPT",
        bundle_id: "com.openai.codex",
        bundle_path: "/Applications/ChatGPT.app",
        pid: 20,
      },
    ]);
    companion.afterRelaunch = () => {
      cdp.endpointIsHealthy = true;
    };
    const service = new ComponentReactionService(
      new Preferences(path.join(os.tmpdir(), "unused-component-preferences")),
      companion as unknown as NativeCompanionClient,
      cdp as unknown as CdpService,
      registry,
    );

    await service.startOwnership(true);
    await companion.attached;

    expect(companion.relaunchProfiles).toEqual(["managed_codex"]);
    expect(registry.get("com.openai.codex")?.status).toBe("attached");
    await service.shutdown();
  });

  it("disables and reenables existing controllers without another target relaunch", async () => {
    const registry = new TargetRegistry();
    const cdp = new FakeCdp([]);
    const companion = new FakeCompanion([], false, [
      {
        name: "Fixture",
        bundle_id: "com.example.fixture",
        bundle_path: "/Applications/Fixture.app",
        pid: 10,
      },
    ]);
    companion.afterRelaunch = () => {
      cdp.endpointIsHealthy = true;
    };
    const service = new ComponentReactionService(
      new Preferences(path.join(os.tmpdir(), "unused-component-preferences")),
      companion as unknown as NativeCompanionClient,
      cdp as unknown as CdpService,
      registry,
      new FakeInput() as unknown as NativeInputBridge,
    );
    await service.startOwnership();
    await companion.attached;

    await service.sync(runtimeSnapshotWithFeatures(true, false, false));
    await service.sync(runtimeSnapshotWithFeatures(false, false, false));
    await service.sync(runtimeSnapshotWithFeatures(true, false, false));

    expect(companion.relaunchProfiles).toEqual(["standard"]);
    expect(cdp.enabledStates).toEqual([false, true, false, true]);
    expect(registry.get("com.example.fixture")?.status).toBe("attached");
    await service.shutdown();
  });

  it("ships a dormant idempotent renderer controller with no markup capture", () => {
    const source = componentRendererSource();
    expect(source).toContain("__vibecheckComponentReactions");
    expect(source).toContain("setEnabled");
    expect(source).toContain("function ensureMounted()");
    expect(source).toMatch(/if \(shortcut\) \{\s*ensureMounted\(\);/);
    expect(source).toContain("__paperVibecheckAdapter");
    expect(source).toContain("calculateNodeAtPoint");
    expect(source).toContain("worldToViewportRect");
    expect(source).toContain("innerText");
    expect(source).not.toContain("innerHTML");
    expect(source).not.toContain("outerHTML");
    expect(source).not.toContain("localStorage");
  });

  it("ships the complete Messages-style reaction strip and categorized picker from production assets", () => {
    const source = componentRendererSource();
    const styles = fs.readFileSync(
      path.resolve(__dirname, "renderer-style.css"),
      "utf8",
    );
    const heart = source.indexOf('["❤️", "Love"]');
    const approve = source.indexOf('["👍", "Approve"]');
    const disapprove = source.indexOf('["👎", "Disapprove"]');
    const funny = source.indexOf('["😂", "Funny"]');
    const emphasize = source.indexOf('["‼️", "Emphasize"]');
    const question = source.indexOf('["❓", "Question"]');

    expect(heart).toBeGreaterThan(-1);
    expect(heart).toBeLessThan(approve);
    expect(approve).toBeLessThan(disapprove);
    expect(disapprove).toBeLessThan(funny);
    expect(funny).toBeLessThan(emphasize);
    expect(emphasize).toBeLessThan(question);
    expect(source).toContain("vibecheck-reaction-glyph");
    expect(source).toContain("normalizeTapbackAssets");
    expect(source).toContain("--vibecheck-tapback-mask");
    expect(styles).toContain('[data-system-asset="true"]');
    expect(styles).toContain("#vibecheck-reaction-more::before");
    expect(source).toContain("vibecheck-picker-categories");
    expect(source).toContain("Frequently Used");
    expect(source).toContain("Describe an Emoji");
    expect(source).toContain('popover.dataset.expanded = "false"');
    expect(source).not.toContain("IMSharedUI");
    expect(source).not.toContain("AckFunction-");
  });

  it("captures and replaces with the complete ad-hoc clipboard pair before settling unavailable", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "vibecheck-component-host-"),
    );
    const order: string[] = [];
    const cdp = new FakeCdp(order);
    const companion = new FakeCompanion(order);
    const preferences = new Preferences(
      path.join(directory, "preferences.json"),
    );
    const service = new ComponentReactionService(
      preferences,
      companion as unknown as NativeCompanionClient,
      cdp as unknown as CdpService,
    );
    setHostReady(service, directory);
    const published = once(service, "state");
    cdp.emit("commit", commitContext(cdp));
    await cdp.settled;
    await published;

    expect(order).toEqual(["capture", "clipboard", "settle"]);
    expect(companion.clipboardWrites).toEqual(["replace"]);
    expect(cdp.outcome).toBe("unavailable");
    expect(companion.pngPath).not.toBeNull();
    expect(fs.existsSync(companion.pngPath!)).toBe(false);
    expect(preferences.read().emoji_recents).toEqual(["🎯"]);
    await service.shutdown();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("globally toggles one capture session across every attached renderer", async () => {
    const cdp = new FakeCdp([]);
    const service = new ComponentReactionService(
      new Preferences(path.join(os.tmpdir(), "unused-component-preferences")),
      new FakeCompanion([]) as unknown as NativeCompanionClient,
      cdp as unknown as CdpService,
    );
    setHostReady(service, os.tmpdir());

    cdp.emit("toggle-capture-session", {});
    await serviceQueue(service);
    const sessionId = cdp.captureSessions.at(-1);
    expect(sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    cdp.emit("toggle-capture-session", {});
    await serviceQueue(service);
    expect(cdp.captureSessions.at(-1)).toBeNull();

    cdp.emit("toggle-capture-session", {});
    await serviceQueue(service);
    expect(cdp.captureSessions.at(-1)).not.toBeNull();
    await service.shutdown();
    expect(cdp.captureSessions.at(-1)).toBeNull();
  });

  it("starts the additive browser host and shares enablement, sessions, recents, and commits", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "vibecheck-browser-host-service-"),
    );
    const cdp = new FakeCdp([]);
    const companion = new FakeCompanion([]);
    const browser = new FakeBrowser();
    const service = new ComponentReactionService(
      new Preferences(path.join(directory, "preferences.json")),
      companion as unknown as NativeCompanionClient,
      cdp as unknown as CdpService,
      new TargetRegistry(),
      new FakeInput() as unknown as NativeInputBridge,
      browser as unknown as BrowserReactionHost,
    );

    await service.startOwnership();
    await service.sync(runtimeSnapshotWithFeatures(true, false, false));
    expect(browser.startCount).toBe(1);
    expect(browser.enabledStates).toEqual([false, true]);
    expect(service.state).toMatchObject({
      health: "active",
      browser_transport: "connected",
      attached_browser_tabs: 1,
    });

    browser.emit("toggle-capture-session");
    await serviceQueue(service);
    const sessionId = browser.captureSessions.at(-1);
    expect(typeof sessionId).toBe("string");
    expect(cdp.captureSessions.at(-1)).toBe(sessionId);

    const accepted = commitContext(
      cdp,
      sessionId ?? null,
      "browser-service-event",
    );
    browser.emit("commit", accepted);
    await serviceQueue(service);
    expect(companion.clipboardWrites).toEqual(["replace"]);
    expect(browser.enabledStates.at(-1)).toBe(true);
    expect(browser.recents.at(-1)).toEqual(["🎯"]);
    expect(companion.tapbackAssetReads).toBe(1);
    expect(cdp.tapbackAssets.at(-1)).toEqual({ heart: TAPBACK_PNG });
    expect(browser.tapbackAssets.at(-1)).toEqual({ heart: TAPBACK_PNG });

    await service.shutdown();
    expect(browser.disposed).toBe(true);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("replaces on the first commit in each session and appends only within that session", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "vibecheck-component-sessions-"),
    );
    const cdp = new FakeCdp([]);
    const companion = new FakeCompanion([]);
    const service = new ComponentReactionService(
      new Preferences(path.join(directory, "preferences.json")),
      companion as unknown as NativeCompanionClient,
      cdp as unknown as CdpService,
    );
    setHostReady(service, directory);

    cdp.emit("toggle-capture-session", {});
    await serviceQueue(service);
    const firstSession = cdp.captureSessions.at(-1);
    expect(typeof firstSession).toBe("string");
    cdp.emit("commit", commitContext(cdp, firstSession, "session-one-a"));
    cdp.emit("commit", commitContext(cdp, firstSession, "session-one-b"));
    await serviceQueue(service);

    cdp.emit("toggle-capture-session", {});
    cdp.emit("toggle-capture-session", {});
    await serviceQueue(service);
    const secondSession = cdp.captureSessions.at(-1);
    expect(secondSession).not.toBe(firstSession);
    cdp.emit("commit", commitContext(cdp, secondSession, "session-two-a"));
    await serviceQueue(service);

    expect(companion.clipboardWrites).toEqual(["replace", "append", "replace"]);
    await service.shutdown();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("keeps an ad-hoc selected-text commit out of bundle accumulation", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "vibecheck-component-adhoc-"),
    );
    const cdp = new FakeCdp([]);
    const companion = new FakeCompanion([]);
    const service = new ComponentReactionService(
      new Preferences(path.join(directory, "preferences.json")),
      companion as unknown as NativeCompanionClient,
      cdp as unknown as CdpService,
    );
    setHostReady(service, directory);

    cdp.emit("commit", commitContext(cdp, null, "adhoc-a"));
    cdp.emit("commit", commitContext(cdp, null, "adhoc-b"));
    await serviceQueue(service);

    expect(companion.clipboardWrites).toEqual(["replace", "replace"]);
    await service.shutdown();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("ignores a commit from an ended capture session", async () => {
    const cdp = new FakeCdp([]);
    const companion = new FakeCompanion([]);
    const service = new ComponentReactionService(
      new Preferences(path.join(os.tmpdir(), "unused-component-preferences")),
      companion as unknown as NativeCompanionClient,
      cdp as unknown as CdpService,
    );
    setHostReady(service, os.tmpdir());
    cdp.emit("toggle-capture-session", {});
    await serviceQueue(service);
    const endedSession = cdp.captureSessions.at(-1);
    cdp.emit("toggle-capture-session", {});
    cdp.emit("commit", commitContext(cdp, endedSession, "stale"));
    await serviceQueue(service);

    expect(companion.clipboardWrites).toEqual([]);
    await service.shutdown();
  });

  it("reports copy failed for the current append even after an earlier clipboard success", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "vibecheck-component-host-"),
    );
    const cdp = new FakeCdp([]);
    const companion = new FakeCompanion([], true);
    const service = new ComponentReactionService(
      new Preferences(path.join(directory, "preferences.json")),
      companion as unknown as NativeCompanionClient,
      cdp as unknown as CdpService,
    );
    setHostReady(service, directory, true);
    const published = once(service, "state");
    cdp.emit("commit", commitContext(cdp));
    await cdp.settled;
    await published;

    expect(cdp.outcome).toBe("copy_failed");
    await service.shutdown();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it.each([
    "sent",
    "no_active_turn",
    "multiple_active_turns",
    "sent_outcome_unknown",
  ] as const)(
    "settles the originating renderer with the correlated Rust %s outcome",
    async (outcome) => {
      const directory = fs.mkdtempSync("/tmp/vc-host-");
      const socketPath = path.join(directory, "component-reactions.sock");
      const order: string[] = [];
      const server = net.createServer((socket) => {
        socket.once("data", (data) => {
          const event = JSON.parse(data.toString("utf8").trim()) as {
            event_id: string;
          };
          order.push("rust");
          socket.end(
            `${JSON.stringify({
              schema_version: 1,
              event_id: event.event_id,
              outcome,
            })}\n`,
          );
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, resolve);
      });
      const cdp = new FakeCdp(order);
      const companion = new FakeCompanion(order);
      const service = new ComponentReactionService(
        new Preferences(path.join(directory, "preferences.json")),
        companion as unknown as NativeCompanionClient,
        cdp as unknown as CdpService,
      );
      setHostReady(service, directory);

      cdp.emit("commit", commitContext(cdp));
      await cdp.settled;
      await new Promise((resolve) => setImmediate(resolve));

      expect(order).toEqual(["capture", "clipboard", "rust", "settle"]);
      expect(cdp.outcome).toBe(outcome);
      const screenshotPath = path.join(directory, "fixture-event.png");
      const retainedForCodex =
        outcome === "sent" || outcome === "sent_outcome_unknown";
      expect(fs.existsSync(screenshotPath)).toBe(retainedForCodex);
      await service.shutdown();
      expect(fs.existsSync(screenshotPath)).toBe(false);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(directory, { recursive: true, force: true });
    },
  );

  it("rejects a pre-existing listener on a newly allocated debug port", async () => {
    const registry = new TargetRegistry();
    const record = registry.observe({
      name: "Fixture",
      bundle_id: "com.example.fixture",
      bundle_path: "/Applications/Fixture.app",
      pid: 10,
    });
    registry.enroll(record.bundle_id);
    const cdp = new FakeCdp([]);
    cdp.endpointIsHealthy = true;
    const service = new ComponentReactionService(
      new Preferences(path.join(os.tmpdir(), "unused-component-preferences")),
      new FakeCompanion([]) as unknown as NativeCompanionClient,
      cdp as unknown as CdpService,
      registry,
    );
    await (
      service as unknown as {
        ensureAttached(target: TargetRecord): Promise<void>;
      }
    ).ensureAttached(record);
    expect(record.status).toBe("unavailable");
    expect(record.last_error).toContain("already owned");
    await service.shutdown();
  });

  it("reports graceful relaunch refusal without forceful recovery", async () => {
    const registry = new TargetRegistry();
    const record = registry.observe({
      name: "Fixture",
      bundle_id: "com.example.fixture",
      bundle_path: "/Applications/Fixture.app",
      pid: 10,
    });
    registry.enroll(record.bundle_id);
    const companion = new FakeCompanion([]);
    companion.relaunchError = new Error("target refused graceful termination");
    const service = new ComponentReactionService(
      new Preferences(path.join(os.tmpdir(), "unused-component-preferences")),
      companion as unknown as NativeCompanionClient,
      new FakeCdp([]) as unknown as CdpService,
      registry,
    );

    await (
      service as unknown as {
        ensureAttached(target: TargetRecord): Promise<void>;
      }
    ).ensureAttached(record);

    expect(record.status).toBe("unavailable");
    expect(record.last_error).toContain("refused graceful termination");
    expect(companion.relaunchProfiles).toEqual(["standard"]);
    await service.shutdown();
  });

  it("recognizes a Vibecheck-owned endpoint without recursively relaunching", async () => {
    const registry = new TargetRegistry();
    const record = registry.observe({
      name: "Fixture",
      bundle_id: "com.example.fixture",
      bundle_path: "/Applications/Fixture.app",
      pid: 10,
    });
    registry.enroll(record.bundle_id);
    registry.mark(record.bundle_id, "relaunching");
    const cdp = new FakeCdp([]);
    cdp.endpointIsHealthy = true;
    const companion = new FakeCompanion([]);
    const service = new ComponentReactionService(
      new Preferences(path.join(os.tmpdir(), "unused-component-preferences")),
      companion as unknown as NativeCompanionClient,
      cdp as unknown as CdpService,
      registry,
    );

    await (
      service as unknown as {
        ensureAttached(target: TargetRecord): Promise<void>;
      }
    ).ensureAttached(record);

    expect(record.status).toBe("attached");
    expect(companion.relaunchProfiles).toEqual([]);
    await service.shutdown();
  });
});

class FakeCdp extends EventEmitter {
  outcome: ReactionOutcome | null = null;
  endpointIsHealthy = false;
  enabledStates: boolean[] = [];
  tapbackAssets: TapbackAssetMap[] = [];
  captureSessions: Array<string | null> = [];
  private settleDone!: () => void;
  readonly settled = new Promise<void>((resolve) => {
    this.settleDone = resolve;
  });

  constructor(private readonly order: string[]) {
    super();
  }

  async capture(): Promise<Buffer> {
    this.order.push("capture");
    return Buffer.from("\x89PNG\r\n\x1a\nfixture", "binary");
  }

  async endpointHealthy(): Promise<boolean> {
    return this.endpointIsHealthy;
  }

  async attach(): Promise<void> {}

  async settle(
    _bundleId: string,
    _targetId: string,
    _eventId: string,
    outcome: ReactionOutcome,
  ): Promise<void> {
    this.order.push("settle");
    this.outcome = outcome;
    this.settleDone();
  }

  async setEnabled(
    enabled: boolean,
    _recents: string[] = [],
    tapbackAssets: TapbackAssetMap = {},
  ): Promise<void> {
    this.enabledStates.push(enabled);
    this.tapbackAssets.push(tapbackAssets);
  }
  async setCaptureSession(sessionId: string | null): Promise<void> {
    this.captureSessions.push(sessionId);
  }
  async dispose(): Promise<void> {}
}

class FakeCompanion extends EventEmitter {
  running = true;
  pngPath: string | null = null;
  startCount = 0;
  listCount = 0;
  tapbackAssetReads = 0;
  relaunchProfiles: string[] = [];
  relaunchError: Error | null = null;
  afterRelaunch: (() => void) | null = null;
  clipboardWrites: Array<"replace" | "append"> = [];
  private attachedDone!: () => void;
  readonly attached = new Promise<void>((resolve) => {
    this.attachedDone = resolve;
  });

  constructor(
    private readonly order: string[],
    private readonly failAppend = false,
    private readonly targets: Array<{
      name: string;
      bundle_id: string;
      bundle_path: string;
      pid: number;
    }> = [],
  ) {
    super();
  }

  async start(): Promise<void> {
    this.startCount += 1;
    this.running = true;
  }

  async listTargets() {
    this.listCount += 1;
    return this.targets;
  }

  async tapbackAssets(): Promise<TapbackAssetMap> {
    this.tapbackAssetReads += 1;
    return { heart: TAPBACK_PNG };
  }

  async relaunchTarget(
    _bundlePath: string,
    _debugPort: number,
    _ownershipMarker: string,
    profile = "standard",
  ): Promise<void> {
    this.relaunchProfiles.push(profile);
    if (this.relaunchError) throw this.relaunchError;
    this.afterRelaunch?.();
    this.attachedDone();
  }

  async appendBundle(_text: string, pngPath: string): Promise<number> {
    this.clipboardWrites.push("append");
    this.order.push("clipboard");
    this.pngPath = pngPath;
    if (this.failAppend) throw new Error("fixture append failure");
    return 1;
  }

  async replaceBundle(_text: string, pngPath: string): Promise<number> {
    this.clipboardWrites.push("replace");
    this.order.push("clipboard");
    this.pngPath = pngPath;
    if (this.failAppend) throw new Error("fixture replace failure");
    return 1;
  }

  async stop(): Promise<void> {}
}

class FakeInput {
  permissionStatus(): "granted" {
    return "granted";
  }

  setEnabled(): void {}
}

class FakeBrowser extends EventEmitter {
  startCount = 0;
  enabledStates: boolean[] = [];
  recents: string[][] = [];
  tapbackAssets: TapbackAssetMap[] = [];
  captureSessions: Array<string | null> = [];
  disposed = false;

  async start(): Promise<void> {
    this.startCount += 1;
    this.emit("state", {
      transport: "connected",
      attached_tabs: 1,
      last_error: null,
    });
  }

  async setEnabled(
    enabled: boolean,
    recents: string[],
    tapbackAssets: TapbackAssetMap = {},
  ): Promise<void> {
    this.enabledStates.push(enabled);
    this.recents.push(recents);
    this.tapbackAssets.push(tapbackAssets);
  }

  async setCaptureSession(sessionId: string | null): Promise<void> {
    this.captureSessions.push(sessionId);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

function setHostReady(
  service: ComponentReactionService,
  directory: string,
  priorClipboardSuccess = false,
): void {
  const internal = service as unknown as {
    effective: boolean;
    runtime: RuntimeSnapshot;
    health: { clipboard_ready: boolean; reaction_socket: string | null };
  };
  internal.effective = true;
  internal.health.clipboard_ready = priorClipboardSuccess;
  internal.health.reaction_socket = path.join(
    directory,
    "component-reactions.sock",
  );
  internal.runtime = runtimeSnapshot(
    path.join(directory, "component-reactions.sock"),
  );
}

function runtimeSnapshot(reactionSocket: string): RuntimeSnapshot {
  return {
    features: {
      revision: 1,
      notch_enabled: false,
      component_reactions_enabled: true,
      integrations: { codex_enabled: false },
      paused: false,
    },
    desired_roles: ["interruption"],
    effective_roles: ["interruption"],
    aggregate: "active",
    workers: {},
    errors: [],
    component_reactions: {
      desired: true,
      effective: true,
      health: "active",
      reaction_socket: reactionSocket,
      attached_targets: 1,
      unavailable_targets: 0,
      permission: "granted",
      companion_ready: true,
      clipboard_ready: true,
      last_error: null,
    },
  };
}

function runtimeSnapshotWithFeatures(
  componentReactions: boolean,
  codex: boolean,
  paused: boolean,
): RuntimeSnapshot {
  const snapshot = runtimeSnapshot("/tmp/component-reactions.sock");
  snapshot.features.component_reactions_enabled = componentReactions;
  snapshot.features.integrations.codex_enabled = codex;
  snapshot.features.paused = paused;
  snapshot.component_reactions!.desired = componentReactions;
  snapshot.component_reactions!.effective = componentReactions && !paused;
  snapshot.component_reactions!.reaction_socket = componentReactions
    ? "/tmp/component-reactions.sock"
    : null;
  return snapshot;
}

function commitContext(
  cdp: FakeCdp,
  clipboardSessionId: string | null = null,
  eventId = "fixture-event",
): {
  source: TargetRecord;
  event: RendererCommit;
  capture(): Promise<Buffer>;
  settle(outcome: ReactionOutcome): Promise<void>;
} {
  const source: TargetRecord = {
    name: "Fixture",
    bundle_id: "com.example.fixture",
    bundle_path: "/Applications/Fixture.app",
    pid: 10,
    debug_port: 43_000,
    ownership_marker: "fixture",
    enrolled: true,
    attached: true,
    status: "attached",
    last_error: null,
  };
  return {
    source,
    event: {
      schema_version: 1,
      type: "commit",
      event_id: eventId,
      document_id: "fixture-document",
      clipboard_session_id: clipboardSessionId,
      copy_text: "Save changes",
      reaction_emoji: "🎯",
      reaction_label: "Target",
      bounds: {
        x: 10,
        y: 10,
        width: 100,
        height: 40,
        device_scale_factor: 2,
      },
    },
    capture: () => cdp.capture(),
    settle: (outcome) =>
      cdp.settle(
        source.bundle_id,
        (cdp as unknown as CdpSession).targetId,
        eventId,
        outcome,
      ),
  };
}

async function serviceQueue(service: ComponentReactionService): Promise<void> {
  await (
    service as unknown as {
      commitQueue: Promise<void>;
    }
  ).commitQueue;
}
