import { nativeImage } from "electron";
import { MAX_SCREENSHOT_BYTES, type RendererCommit } from "./types";
import type { BrowserCommit } from "./browser-protocol";

const PNG_PREFIX = "data:image/png;base64,";

export function cropBrowserScreenshot(
  dataUrl: string,
  bounds: RendererCommit["bounds"],
  viewport: BrowserCommit["viewport"],
): Buffer {
  if (!dataUrl.startsWith(PNG_PREFIX)) {
    throw new Error("browser screenshot must be a PNG data URL");
  }
  const encoded = dataUrl.slice(PNG_PREFIX.length);
  if (
    encoded.length === 0 ||
    encoded.length > Math.ceil((MAX_SCREENSHOT_BYTES * 4) / 3) + 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    throw new Error("browser screenshot encoding is invalid");
  }
  const source = Buffer.from(encoded, "base64");
  if (
    source.length === 0 ||
    source.length > MAX_SCREENSHOT_BYTES ||
    !source.subarray(0, 8).equals(Buffer.from("\x89PNG\r\n\x1a\n", "binary"))
  ) {
    throw new Error("browser screenshot PNG is invalid");
  }
  const image = nativeImage.createFromBuffer(source);
  if (image.isEmpty())
    throw new Error("browser screenshot could not be decoded");
  const size = image.getSize();
  const scaleX = size.width / viewport.width;
  const scaleY = size.height / viewport.height;
  if (
    !Number.isFinite(scaleX) ||
    !Number.isFinite(scaleY) ||
    scaleX <= 0 ||
    scaleY <= 0 ||
    Math.abs(scaleX - scaleY) > Math.max(0.15, scaleX * 0.08) ||
    Math.abs(scaleX - viewport.device_scale_factor) >
      Math.max(0.5, viewport.device_scale_factor * 0.25)
  ) {
    throw new Error("browser screenshot dimensions do not match its viewport");
  }
  const left = Math.max(0, Math.floor(bounds.x * scaleX));
  const top = Math.max(0, Math.floor(bounds.y * scaleY));
  const right = Math.min(
    size.width,
    Math.ceil((bounds.x + bounds.width) * scaleX),
  );
  const bottom = Math.min(
    size.height,
    Math.ceil((bounds.y + bounds.height) * scaleY),
  );
  if (right <= left || bottom <= top) {
    throw new Error("browser component is outside the visible screenshot");
  }
  const cropped = image.crop({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
  const png = cropped.toPNG();
  if (png.length === 0 || png.length > MAX_SCREENSHOT_BYTES) {
    throw new Error("browser component PNG is outside allowed bounds");
  }
  return png;
}
