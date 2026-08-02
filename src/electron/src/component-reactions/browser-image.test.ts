// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createFromBuffer } = vi.hoisted(() => ({
  createFromBuffer: vi.fn(),
}));
vi.mock("electron", () => ({
  nativeImage: { createFromBuffer },
}));

import { cropBrowserScreenshot } from "./browser-image";

describe("browser component screenshot crop", () => {
  beforeEach(() => {
    createFromBuffer.mockReset();
  });

  it("reconciles viewport scale, clips bounds, and returns a PNG", () => {
    const output = Buffer.from("\x89PNG\r\n\x1a\noutput", "binary");
    const toPNG = vi.fn(() => output);
    const crop = vi.fn(() => ({ toPNG }));
    createFromBuffer.mockReturnValue({
      isEmpty: () => false,
      getSize: () => ({ width: 1_600, height: 1_200 }),
      crop,
    });
    const source = Buffer.from("\x89PNG\r\n\x1a\nsource", "binary");
    const result = cropBrowserScreenshot(
      `data:image/png;base64,${source.toString("base64")}`,
      {
        x: -5,
        y: 20,
        width: 105,
        height: 40,
        device_scale_factor: 2,
      },
      { width: 800, height: 600, device_scale_factor: 2 },
    );
    expect(crop).toHaveBeenCalledWith({
      x: 0,
      y: 40,
      width: 200,
      height: 80,
    });
    expect(result).toEqual(output);
  });

  it("rejects malformed images and inconsistent viewport dimensions", () => {
    expect(() =>
      cropBrowserScreenshot(
        "data:text/plain;base64,Zm9v",
        { x: 0, y: 0, width: 10, height: 10, device_scale_factor: 1 },
        { width: 100, height: 100, device_scale_factor: 1 },
      ),
    ).toThrow(/PNG data URL/);

    createFromBuffer.mockReturnValue({
      isEmpty: () => false,
      getSize: () => ({ width: 200, height: 500 }),
      crop: vi.fn(),
    });
    const source = Buffer.from("\x89PNG\r\n\x1a\nsource", "binary");
    expect(() =>
      cropBrowserScreenshot(
        `data:image/png;base64,${source.toString("base64")}`,
        { x: 0, y: 0, width: 10, height: 10, device_scale_factor: 2 },
        { width: 100, height: 100, device_scale_factor: 2 },
      ),
    ).toThrow(/dimensions/);
  });
});
