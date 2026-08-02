import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  buildMenuTemplate,
  MenuActions,
  menuProjection,
} from "./menu-template";
import type { PublicState } from "./protocol";

const baseState: PublicState = {
  aggregate: "off",
  camera: "off",
  componentReactions: {
    desired: false,
    effective: false,
    health: "off",
    attached_targets: 0,
    unavailable_targets: 0,
    permission: "unknown",
    companion_ready: false,
    clipboard_ready: false,
    last_error: null,
  },
  canRecover: false,
  features: {
    revision: 4,
    notch_enabled: false,
    component_reactions_enabled: false,
    integrations: { codex_enabled: false },
    paused: false,
  },
};

function actions(): MenuActions {
  return {
    setNotch: vi.fn(async () => undefined),
    setCodex: vi.fn(async () => undefined),
    setComponentReactions: vi.fn(async () => undefined),
    openChromeSetup: vi.fn(async () => undefined),
    openSafariSetup: vi.fn(async () => undefined),
    setPaused: vi.fn(async () => undefined),
    recover: vi.fn(async () => undefined),
    quit: vi.fn(),
  };
}

function item(
  template: MenuItemConstructorOptions[],
  id: string,
): MenuItemConstructorOptions {
  const found = template.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing menu item ${id}`);
  return found;
}

describe("native menu template", () => {
  it.each([
    ["off", "Off"],
    ["starting", "Starting"],
    ["active", "Active"],
    ["paused", "Paused"],
    ["needs_permission", "Needs Camera Permission"],
    ["degraded", "Degraded"],
    ["failed", "Failed"],
  ] as const)("projects %s aggregate state", (aggregate, label) => {
    const template = buildMenuTemplate({ ...baseState, aggregate }, actions());
    expect(item(template, "status").label).toBe(`Vibecheck — ${label}`);
  });

  it.each([
    ["off", "Off"],
    ["starting", "Starting"],
    ["active", "Active on this Mac"],
    ["needs_permission", "Permission needed"],
  ] as const)("projects %s camera state", (camera, label) => {
    const template = buildMenuTemplate({ ...baseState, camera }, actions());
    expect(item(template, "camera").label).toBe(`Camera: ${label}`);
  });

  it.each([
    ["off", "Off"],
    ["starting", "Starting"],
    ["active", "Active · 2 attached"],
    ["paused", "Paused"],
    ["needs_permission", "Needs Accessibility"],
    ["degraded", "Degraded"],
    ["failed", "Failed"],
  ] as const)("projects %s component state", (health, label) => {
    const template = buildMenuTemplate(
      {
        ...baseState,
        componentReactions: {
          ...baseState.componentReactions,
          health,
          attached_targets: health === "active" ? 2 : 0,
        },
      },
      actions(),
    );
    expect(item(template, "component-reactions").label).toBe(
      `Component reactions — ${label}`,
    );
    expect(
      template.some((candidate) => candidate.id === "component-status"),
    ).toBe(false);
  });

  it("names the specific component permission that is missing", () => {
    const template = buildMenuTemplate(
      {
        ...baseState,
        componentReactions: {
          ...baseState.componentReactions,
          health: "needs_permission",
          last_error: "Input Monitoring permission is required",
        },
      },
      actions(),
    );
    expect(item(template, "component-reactions").label).toBe(
      "Component reactions — Needs Input Monitoring",
    );
  });

  it("keeps browser attachment status on the component row", () => {
    const template = buildMenuTemplate(
      {
        ...baseState,
        componentReactions: {
          ...baseState.componentReactions,
          health: "active",
          attached_targets: 2,
          attached_browser_tabs: 3,
          browser_transport: "connected",
        },
      },
      actions(),
    );
    expect(item(template, "component-reactions").label).toBe(
      "Component reactions — Active · 5 attached",
    );
    expect(
      template.some((candidate) => candidate.id === "component-status"),
    ).toBe(false);
  });

  it("preserves desired checks during loading and failure", () => {
    for (const aggregate of ["starting", "degraded", "failed"] as const) {
      const template = buildMenuTemplate(
        {
          ...baseState,
          aggregate,
          features: {
            ...baseState.features,
            notch_enabled: true,
            component_reactions_enabled: false,
            integrations: { codex_enabled: true },
          },
        },
        actions(),
      );
      expect(item(template, "notch").checked).toBe(true);
      expect(item(template, "codex").checked).toBe(true);
    }
  });

  it("routes only fixed toggle, pause, recovery, and quit actions", async () => {
    const callbacks = actions();
    const template = buildMenuTemplate(
      {
        ...baseState,
        aggregate: "failed",
        canRecover: true,
        features: {
          ...baseState.features,
          notch_enabled: true,
        },
      },
      callbacks,
    );

    item(template, "notch").click?.(
      { checked: false } as never,
      undefined as never,
      undefined as never,
    );
    item(template, "codex").click?.(
      { checked: true } as never,
      undefined as never,
      undefined as never,
    );
    item(template, "component-reactions").click?.(
      { checked: true } as never,
      undefined as never,
      undefined as never,
    );
    item(template, "component-reactions-chrome-setup").click?.(
      {} as never,
      undefined as never,
      undefined as never,
    );
    item(template, "component-reactions-safari-setup").click?.(
      {} as never,
      undefined as never,
      undefined as never,
    );
    item(template, "pause").click?.(
      {} as never,
      undefined as never,
      undefined as never,
    );
    item(template, "recover").click?.(
      {} as never,
      undefined as never,
      undefined as never,
    );
    item(template, "quit").click?.(
      {} as never,
      undefined as never,
      undefined as never,
    );
    await Promise.resolve();

    expect(callbacks.setNotch).toHaveBeenCalledWith(false);
    expect(callbacks.setCodex).toHaveBeenCalledWith(true);
    expect(callbacks.setComponentReactions).toHaveBeenCalledWith(true);
    expect(callbacks.openChromeSetup).toHaveBeenCalledOnce();
    expect(callbacks.openSafariSetup).toHaveBeenCalledOnce();
    expect(callbacks.setPaused).toHaveBeenCalledWith(true);
    expect(callbacks.recover).toHaveBeenCalledOnce();
    expect(callbacks.quit).toHaveBeenCalledOnce();
  });

  it("disables mutable actions while one is pending", () => {
    const template = buildMenuTemplate(
      {
        ...baseState,
        features: { ...baseState.features, notch_enabled: true },
      },
      actions(),
      { pending: true },
    );
    expect(item(template, "notch").enabled).toBe(false);
    expect(item(template, "codex").enabled).toBe(false);
    expect(item(template, "component-reactions").enabled).toBe(false);
    expect(item(template, "pause").enabled).toBe(false);
    expect(item(template, "quit").enabled).not.toBe(false);
  });

  it("shows a bounded action error and excludes private context", () => {
    const projection = menuProjection(
      buildMenuTemplate(baseState, actions(), {
        error: `permission denied ${"x".repeat(200)}`,
      }),
    );
    const serialized = JSON.stringify(projection);
    expect(
      item(
        buildMenuTemplate(baseState, actions(), { error: "permission denied" }),
        "error",
      ).label,
    ).toContain("permission denied");
    expect(serialized).not.toContain("expression");
    expect(serialized).not.toContain("confidence");
    expect(serialized).not.toContain("thread");
    expect(serialized.length).toBeLessThan(1_300);
  });
});
