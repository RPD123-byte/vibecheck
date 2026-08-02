import { execFile, execFileSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { BrowserReactionHost } from "../src/component-reactions/browser-host";
import type { RendererReactionContext } from "../src/component-reactions/types";

test("signed Safari extension accepts physical keyboard and pointer input", async () => {
  test.skip(
    process.env.VIBECHECK_SAFARI_EXTENSION_ACCEPTANCE !== "1",
    "Set VIBECHECK_SAFARI_EXTENSION_ACCEPTANCE=1 after installing and enabling the signed Safari extension.",
  );
  const installedExtension =
    "/Applications/Vibecheck.app/Contents/PlugIns/Vibecheck Browser Reactions Extension.appex";
  expect(fs.existsSync(installedExtension)).toBe(true);
  execFileSync("codesign", ["--verify", "--strict", installedExtension]);

  const fixtureBody = fs.readFileSync(
    path.join(__dirname, "fixtures/browser-reactions.html"),
  );
  const fixture = await serve(fixtureBody);
  const helperDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "vibecheck-safari-acceptance-"),
  );
  const helper = path.join(helperDirectory, "safari-physical-input");
  execFileSync(
    "xcrun",
    [
      "swiftc",
      path.join(__dirname, "safari-physical-input.swift"),
      "-o",
      helper,
    ],
    { stdio: "inherit" },
  );
  const png = Buffer.from("\x89PNG\r\n\x1a\nsafari", "binary");
  let screenshot = "";
  const host = new BrowserReactionHost({
    crop: (dataUrl) => {
      screenshot = dataUrl;
      return png;
    },
  });
  let restartedHost: BrowserReactionHost | null = null;
  try {
    await host.start();
    await host.setEnabled(false, []);
    let toggles = 0;
    host.on("toggle-capture-session", () => {
      toggles += 1;
      void host.setCaptureSession("safari-acceptance-session");
    });
    await run("/usr/bin/open", [
      "-a",
      "Safari",
      `http://127.0.0.1:${fixture.port}/`,
    ]);
    await expect
      .poll(() => host.state.attached_tabs, { timeout: 20_000 })
      .toBeGreaterThan(0);
    const fixtureAttachedTabs = host.state.attached_tabs;

    execFileSync(helper, ["shortcut"]);
    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(toggles).toBe(0);

    await host.setEnabled(true, []);
    const toggled = once(host, "toggle-capture-session");
    execFileSync(helper, ["shortcut"]);
    await toggled;
    expect(toggles).toBe(1);

    const accepted = once(host, "commit");
    execFileSync(helper, ["commit"]);
    const [reaction] = (await accepted) as [RendererReactionContext];
    expect(reaction.source.bundle_id).toBe("com.apple.Safari");
    expect(reaction.event.copy_text).toBe("Selectable browser component");
    await expect(reaction.capture()).resolves.toEqual(png);
    expect(screenshot).toMatch(/^data:image\/png;base64,/);
    await reaction.settle("no_active_turn");

    await setSafariUrl("about:blank");
    await expect
      .poll(() => host.state.attached_tabs, { timeout: 10_000 })
      .toBeLessThan(fixtureAttachedTabs);
    await setSafariUrl(`http://127.0.0.1:${fixture.port}/?navigation=1`);
    await expect
      .poll(() => host.state.attached_tabs, { timeout: 10_000 })
      .toBe(fixtureAttachedTabs);

    const deniedUrl = process.env.VIBECHECK_SAFARI_DENIED_URL;
    if (deniedUrl) {
      await setSafariUrl(deniedUrl);
      await expect
        .poll(() => host.state.attached_tabs, { timeout: 10_000 })
        .toBeLessThan(fixtureAttachedTabs);
      await setSafariUrl(`http://127.0.0.1:${fixture.port}/?after-denial=1`);
      await expect
        .poll(() => host.state.attached_tabs, { timeout: 10_000 })
        .toBe(fixtureAttachedTabs);
    }

    await host.dispose();
    execFileSync(helper, ["shortcut"]);
    restartedHost = new BrowserReactionHost({
      crop: () => png,
    });
    await restartedHost.start();
    await expect
      .poll(() => restartedHost?.state.attached_tabs ?? 0, {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
    expect(restartedHost.state.transport).toBe("connected");
  } finally {
    await restartedHost?.dispose();
    await host.dispose();
    await fixture.close();
    fs.rmSync(helperDirectory, { recursive: true, force: true });
    await run("/usr/bin/osascript", [
      "-e",
      'tell application "Safari" to if (count windows) > 0 then close current tab of front window',
    ]).catch(() => undefined);
  }
});

async function serve(body: Buffer): Promise<{
  port: number;
  close(): Promise<void>;
}> {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Safari fixture has no TCP address");
  }
  return {
    port: address.port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function setSafariUrl(url: string): Promise<void> {
  await run("/usr/bin/osascript", [
    "-e",
    `tell application "Safari" to set URL of current tab of front window to ${JSON.stringify(url)}`,
  ]);
}

function run(executable: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, (error) => (error ? reject(error) : resolve()));
  });
}
