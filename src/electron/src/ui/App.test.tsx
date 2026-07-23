import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicState } from "../protocol";
import { App } from "./App";

const active: PublicState = {
  aggregate: "active",
  features: {
    revision: 3,
    notch_enabled: true,
    integrations: { codex_enabled: false },
    paused: false,
  },
  camera: "active",
  canRecover: false,
};

describe("App", () => {
  beforeEach(() => {
    window.vibecheck = {
      state: vi.fn().mockResolvedValue(active),
      onState: vi.fn().mockReturnValue(() => undefined),
      setFeature: vi.fn().mockResolvedValue(undefined),
      setPaused: vi.fn().mockResolvedValue(undefined),
      recover: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue(undefined),
      dismiss: vi.fn(),
    };
  });

  it("renders authoritative state and sends a bounded feature intent", async () => {
    render(<App />);
    expect(await screen.findByText("Active")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Codex interruption"));
    await waitFor(() =>
      expect(window.vibecheck.setFeature).toHaveBeenCalledWith("codex", true),
    );
  });

  it("preserves enabled toggles while paused and can resume", async () => {
    window.vibecheck.state = vi.fn().mockResolvedValue({
      ...active,
      aggregate: "paused",
      features: { ...active.features, paused: true },
    });
    render(<App />);
    expect(await screen.findByText("Paused")).toBeTruthy();
    expect(screen.getByLabelText("Show notch")).toHaveProperty("checked", true);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() =>
      expect(window.vibecheck.setPaused).toHaveBeenCalledWith(false),
    );
  });

  it("shows permission errors and conditional recovery", async () => {
    window.vibecheck.state = vi.fn().mockResolvedValue({
      ...active,
      aggregate: "needs_permission",
      camera: "needs_permission",
      canRecover: true,
    });
    window.vibecheck.setFeature = vi
      .fn()
      .mockRejectedValue(new Error("Camera access is required"));
    render(<App />);
    expect(await screen.findByText("Camera needed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Show notch"));
    expect(await screen.findByText("Camera access is required")).toBeTruthy();
  });

  it("dismisses on Escape", async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(window.vibecheck.dismiss).toHaveBeenCalledOnce();
  });

  it.each([
    ["off", "Off"],
    ["starting", "Warming up"],
    ["active", "Active"],
    ["paused", "Paused"],
    ["needs_permission", "Camera needed"],
    ["degraded", "Partly active"],
    ["failed", "Needs attention"],
  ] as const)(
    "renders the %s authoritative state",
    async (aggregate, label) => {
      window.vibecheck.state = vi.fn().mockResolvedValue({
        ...active,
        aggregate,
        features: {
          ...active.features,
          paused: aggregate === "paused",
        },
      });
      render(<App />);
      expect(await screen.findByText(label)).toBeTruthy();
    },
  );

  it("sends recovery and quit without exposing runtime details", async () => {
    window.vibecheck.state = vi.fn().mockResolvedValue({
      ...active,
      canRecover: true,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(window.vibecheck.recover).toHaveBeenCalledOnce(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Quit" }));
    expect(window.vibecheck.quit).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain("pid");
    expect(document.body.textContent).not.toContain("disgust");
    expect(document.body.textContent).not.toContain("confidence");
    expect(document.body.textContent).not.toContain("frame");
  });
});
