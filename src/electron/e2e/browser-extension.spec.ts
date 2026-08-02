import { execFileSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium, expect, test, type Worker } from "@playwright/test";
import { BrowserReactionHost } from "../src/component-reactions/browser-host";
import type { RendererReactionContext } from "../src/component-reactions/types";

test("managed Chrome uses the production extension for a physical component reaction", async () => {
  const electronRoot = path.resolve(__dirname, "..");
  const repoRoot = path.resolve(electronRoot, "../..");
  execFileSync("npm", ["run", "browser:build"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  const extension = path.join(
    repoRoot,
    "dist/component-reactions/browser-extension",
  );
  const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), "vibecheck-browser-e2e-"),
  );
  const fixture = await serveFixture(
    path.join(__dirname, "fixtures/browser-reactions.html"),
    path.join(__dirname, "fixtures/browser-frame.html"),
  );
  let capturedDataUrl = "";
  const outputPng = Buffer.from("\x89PNG\r\n\x1a\ncrop", "binary");
  const host = new BrowserReactionHost({
    crop: (dataUrl) => {
      capturedDataUrl = dataUrl;
      return outputPng;
    },
  });
  let restartedHost: BrowserReactionHost | null = null;
  const hostDiagnostics: string[] = [];
  host.on("diagnostic", (value) =>
    hostDiagnostics.push(
      value instanceof Error ? value.message : String(value),
    ),
  );
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: chromeForTesting(),
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  const extensionLogs: string[] = [];
  const watchWorker = (worker: Worker) => {
    worker.on("console", (message) => extensionLogs.push(message.text()));
  };
  context.on("serviceworker", watchWorker);
  for (const worker of context.serviceWorkers()) watchWorker(worker);
  try {
    await host.start();
    let captureSequence = 0;
    let activeCaptureSession: string | null = null;
    host.on("toggle-capture-session", () => {
      activeCaptureSession =
        activeCaptureSession === null
          ? `browser-e2e-session-${++captureSequence}`
          : null;
      void host.setCaptureSession(activeCaptureSession);
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`http://127.0.0.1:${fixture.port}/`);
    await expect
      .poll(() => host.state.attached_tabs, { timeout: 15_000 })
      .toBe(1);
    await page.keyboard.press("Control+Alt+KeyR");
    await page.waitForTimeout(100);
    expect(captureSequence).toBe(0);
    await expect(page.locator("#vibecheck-reaction-outline")).toBeHidden();
    const tapbackPng = "data:image/png;base64,iVBORw0KGgo=";
    await host.setEnabled(true, ["🎯"], {
      heart: tapbackPng,
      "thumbs-up": tapbackPng,
      "thumbs-down": tapbackPng,
      haha: tapbackPng,
      exclamation: tapbackPng,
      question: tapbackPng,
    });

    await page.keyboard.press("Control+Alt+KeyR");
    await expect
      .poll(
        () =>
          page
            .locator("#vibecheck-reaction-outline")
            .evaluate((element) => getComputedStyle(element).display)
            .catch(() => "missing"),
        { timeout: 5_000 },
      )
      .not.toBe("missing");

    await page.locator("#target").hover();
    await page.locator("#target").click();
    await expect(page.locator("#vibecheck-reaction-popover")).toBeVisible();
    await expect(
      page.locator(
        '#vibecheck-reaction-strip .vibecheck-reaction-glyph[data-system-asset="true"]',
      ),
    ).toHaveCount(6);
    await expect(
      page.locator(
        '.vibecheck-reaction-button[aria-label*="Recent emoji"] [data-system-asset]',
      ),
    ).toHaveCount(0);
    await page.locator("#vibecheck-reaction-more").click();
    await expect(page.locator("#vibecheck-emoji-panel")).toBeVisible();
    await expect(
      page.locator("#vibecheck-emoji-panel .vibecheck-reaction-button").first(),
    ).toHaveCSS("font-family", /Apple Color Emoji/);
    await page.locator("#vibecheck-reaction-more").click();
    await host.setEnabled(true, ["🎯"], {});
    await expect(
      page.locator(
        '#vibecheck-reaction-strip .vibecheck-reaction-glyph[data-system-asset="true"]',
      ),
    ).toHaveCount(0);
    await expect(
      page.locator("#vibecheck-reaction-strip .vibecheck-reaction-glyph"),
    ).toHaveCount(6);
    const accepted = once(host, "commit");
    await page
      .locator('.vibecheck-reaction-button[aria-label*="Approve"]')
      .click();
    const [reaction] = (await Promise.race([
      accepted,
      page
        .locator("#vibecheck-receipt")
        .filter({ hasText: "Copy failed" })
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => {
          throw new Error(
            `The browser extension failed before sending its screenshot: ${extensionLogs.join(" | ")}`,
          );
        }),
    ])) as [RendererReactionContext];

    expect(reaction.event.copy_text).toBe("Selectable browser component");
    expect(reaction.event.clipboard_session_id).toBe("browser-e2e-session-1");
    await expect(reaction.capture()).resolves.toEqual(outputPng);
    expect(capturedDataUrl).toMatch(/^data:image\/png;base64,/);
    await reaction.settle("no_active_turn");
    await expect(page.locator("#vibecheck-receipt")).toContainText(
      "No active Codex task",
    );

    await page.keyboard.press("Control+Alt+KeyR");
    await expect.poll(() => activeCaptureSession).toBeNull();
    await page.reload();
    await expect
      .poll(() => host.state.attached_tabs, { timeout: 10_000 })
      .toBe(1);
    await page.locator("#exact").selectText();
    await page.keyboard.press("Control+Alt+KeyR");
    await expect(page.locator("#vibecheck-reaction-popover")).toBeVisible();
    const textAccepted = once(host, "commit");
    await page
      .locator('.vibecheck-reaction-button[aria-label*="Question"]')
      .click();
    const [textReaction] = (await textAccepted) as [RendererReactionContext];
    expect(textReaction.event.copy_text).toBe(
      "This exact sentence can be selected.",
    );
    expect(textReaction.event.clipboard_session_id).toBeNull();
    await textReaction.settle("multiple_active_turns");

    await page.goto("about:blank");
    await expect.poll(() => host.state.attached_tabs).toBe(0);
    await page.goto(`http://127.0.0.1:${fixture.port}/`);
    await expect.poll(() => host.state.attached_tabs).toBe(1);

    const secondPage = await context.newPage();
    await secondPage.goto(`http://127.0.0.1:${fixture.port}/`);
    await expect.poll(() => host.state.attached_tabs).toBe(2);
    await secondPage.close();
    await expect.poll(() => host.state.attached_tabs).toBe(1);

    await page.goto(`http://127.0.0.1:${fixture.port}/with-frame`);
    const frame = page
      .frames()
      .find((candidate) =>
        candidate.url().startsWith(`http://localhost:${fixture.port}/frame`),
      );
    expect(frame).toBeTruthy();
    await frame!.locator("body").press("Control+Alt+KeyR");
    await expect.poll(() => activeCaptureSession).toBe("browser-e2e-session-2");
    await frame!.locator("#frame-target").hover();
    await frame!.locator("#frame-target").click();
    await expect(frame!.locator("#vibecheck-reaction-popover")).toBeVisible();
    const frameAccepted = once(host, "commit");
    await frame!
      .locator('.vibecheck-reaction-button[aria-label*="Approve"]')
      .click();
    const [frameReaction] = (await Promise.race([
      frameAccepted,
      frame!
        .locator("#vibecheck-receipt")
        .filter({ hasText: "Copy failed" })
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => {
          throw new Error(
            `The frame commit failed: ${extensionLogs.join(" | ")} ${hostDiagnostics.join(" | ")}`,
          );
        }),
    ])) as [RendererReactionContext];
    expect(frameReaction.event.copy_text).toBe("Cross-origin frame component");
    expect(frameReaction.event.clipboard_session_id).toBe(
      "browser-e2e-session-2",
    );
    expect(frameReaction.event.bounds.x).toBeGreaterThan(0);
    await frameReaction.settle("no_active_turn");

    await host.dispose();
    restartedHost = new BrowserReactionHost({
      crop: () => outputPng,
    });
    await restartedHost.start();
    await restartedHost.setEnabled(true, []);
    await expect
      .poll(() => restartedHost?.state.attached_tabs ?? 0, {
        timeout: 10_000,
      })
      .toBe(1);
    const reconnectedToggle = once(restartedHost, "toggle-capture-session");
    await frame!.locator("body").press("Control+Alt+KeyR");
    await reconnectedToggle;
  } finally {
    await restartedHost?.dispose();
    await host.dispose();
    await context.close();
    await fixture.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

function chromeForTesting(): string {
  const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
  const candidates = fs
    .readdirSync(cache)
    .filter((entry) => /^chromium-\d+$/.test(entry))
    .sort((left, right) => Number(right.slice(9)) - Number(left.slice(9)))
    .map((entry) =>
      path.join(
        cache,
        entry,
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      ),
    );
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) {
    throw new Error(
      "Chrome for Testing is unavailable; run `npx playwright install chromium`",
    );
  }
  return executable;
}

async function serveFixture(
  file: string,
  frameFile: string,
): Promise<{
  port: number;
  close(): Promise<void>;
}> {
  const body = fs.readFileSync(file);
  const frameBody = fs.readFileSync(frameFile);
  const server = http.createServer((request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    if (request.url === "/frame") {
      response.end(frameBody);
      return;
    }
    if (request.url === "/with-frame") {
      const address = server.address();
      const port = address && typeof address !== "string" ? address.port : 0;
      response.end(`<!doctype html>
        <meta charset="utf-8">
        <title>Cross-origin owner</title>
        <iframe
          title="Cross-origin component frame"
          src="http://localhost:${port}/frame"
          style="margin:40px;width:420px;height:220px"
        ></iframe>`);
      return;
    }
    response.end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("fixture server has no TCP address");
  }
  return {
    port: address.port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
