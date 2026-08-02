#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildInjectionExpression,
  loadSystemTapbackAssets,
} from "./devtools_injector.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, "..");
const fixtureDirectory = resolve(projectDirectory, "Fixtures/Browser");
const sourcePath = resolve(
  projectDirectory,
  "renderer/highlight_and_react.css",
);
const safariDriver = "/usr/bin/safaridriver";
const elementKey = "element-6066-11e4-a52e-4f735466cecf";

class BidiConnection {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.type === "error" || message.error) {
        pending.reject(
          new Error(message.message || message.error || "BiDi command failed"),
        );
      } else {
        pending.resolve(message.result || {});
      }
    });
    await new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out connecting to Safari BiDi")),
        5_000,
      );
      this.socket.addEventListener(
        "open",
        () => {
          clearTimeout(timeout);
          resolvePromise();
        },
        { once: true },
      );
      this.socket.addEventListener(
        "error",
        (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        { once: true },
      );
    });
    return this;
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 8_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolvePromise(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

function deferredInstallExpression(expression) {
  return `(() => {
    const install = () => ${expression};
    if (document.documentElement) return install();
    document.addEventListener('readystatechange', function ready() {
      if (!document.documentElement) return;
      document.removeEventListener('readystatechange', ready);
      install();
    });
    return 'deferred';
  })()`;
}

async function listen(server) {
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  return typeof address === "object" && address ? address.port : 0;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
}

async function fixtureServer() {
  const server = createServer(async (request, response) => {
    const pathname = request.url?.split("?")[0];
    const path = pathname === "/frame.html"
      ? resolve(fixtureDirectory, "frame.html")
      : resolve(fixtureDirectory, "index.html");
    try {
      const body = await readFile(path);
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  const port = await listen(server);
  return { server, port };
}

async function availablePort() {
  const server = createServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
}

async function waitForDriver(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {
      // safaridriver is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error("Timed out waiting for safaridriver");
}

async function webdriver(port, method, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.value?.error) {
    const message =
      payload.value?.message ||
      payload.value?.error ||
      `${method} ${path} returned ${response.status}`;
    throw new Error(message);
  }
  return payload.value;
}

async function execute(port, sessionId, script, args = []) {
  return webdriver(
    port,
    "POST",
    `/session/${sessionId}/execute/sync`,
    { script, args },
  );
}

async function keyboardShortcut(port, sessionId) {
  await webdriver(port, "POST", `/session/${sessionId}/actions`, {
    actions: [
      {
        type: "key",
        id: "highlight-and-react-keyboard",
        actions: [
          { type: "keyDown", value: "\uE009" },
          { type: "keyDown", value: "\uE00A" },
          { type: "keyDown", value: "r" },
          { type: "keyUp", value: "r" },
          { type: "keyUp", value: "\uE00A" },
          { type: "keyUp", value: "\uE009" },
        ],
      },
    ],
  });
  await webdriver(port, "DELETE", `/session/${sessionId}/actions`);
}

async function findElement(port, sessionId, selector) {
  return webdriver(port, "POST", `/session/${sessionId}/element`, {
    using: "css selector",
    value: selector,
  });
}

async function switchToFrame(port, sessionId, frame) {
  await webdriver(port, "POST", `/session/${sessionId}/frame`, {
    id: frame,
  });
}

async function injectSource(port, sessionId, expression) {
  return execute(
    port,
    sessionId,
    "return eval(arguments[0]);",
    [expression],
  );
}

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000)),
  ]);
}

export async function runSafariExperiment(options = {}) {
  const fixture = await fixtureServer();
  const driverPort = await availablePort();
  const bidiPort = options.bidi ? await availablePort() : 0;
  const driverArguments = ["--port", String(driverPort)];
  if (options.bidi) {
    driverArguments.push("--bidi", String(bidiPort));
  }
  const driver = spawn(safariDriver, driverArguments, {
    stdio: options.debug ? ["ignore", "inherit", "inherit"] : "ignore",
  });
  let sessionId;
  let bidiConnection;
  try {
    await waitForDriver(driverPort);
    let session;
    try {
      session = await webdriver(driverPort, "POST", "/session", {
        capabilities: {
          alwaysMatch: {
            browserName: "safari",
            pageLoadStrategy: "normal",
            ...(options.bidi ? { webSocketUrl: true } : {}),
          },
        },
      });
    } catch (error) {
      return {
        available: false,
        transport: "WebDriver/Web Inspector",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    sessionId = session.sessionId;
    const origin = `http://127.0.0.1:${fixture.port}`;
    const fixtureUrl =
      `${origin}/safari.html?crossOrigin=${
        encodeURIComponent(`http://localhost:${fixture.port}/frame.html`)
      }`;
    const source = await readFile(sourcePath, "utf8");
    const injectionExpression = buildInjectionExpression(
      source,
      await loadSystemTapbackAssets(),
    );
    let bidiPreload = {
      requested: Boolean(options.bidi),
      supported: false,
    };
    if (options.bidi) {
      try {
        bidiConnection = await new BidiConnection(
          `ws://127.0.0.1:${bidiPort}/session/${sessionId}`,
        ).connect();
        const preload = await bidiConnection.call(
          "script.addPreloadScript",
          {
            functionDeclaration:
              `() => ${deferredInstallExpression(injectionExpression)}`,
          },
        );
        bidiPreload = {
          requested: true,
          supported: true,
          script: preload.script,
        };
      } catch (error) {
        bidiPreload = {
          requested: true,
          supported: false,
          error: error instanceof Error ? error.message : String(error),
        };
        bidiConnection?.close();
        bidiConnection = undefined;
      }
    }
    await webdriver(
      driverPort,
      "POST",
      `/session/${sessionId}/url`,
      { url: fixtureUrl },
    );
    const preloadedInitialDocument = await execute(
      driverPort,
      sessionId,
      "return Boolean(globalThis.__highlightAndReactSourceHash);",
    );
    const initialInjection = preloadedInitialDocument
      ? "preloaded"
      : await injectSource(driverPort, sessionId, injectionExpression);
    const pageAccess = await execute(
      driverPort,
      sessionId,
      `const target = document.getElementById('component-target');
       const before = getComputedStyle(target).backgroundColor;
       target.style.backgroundColor = 'rgb(12, 34, 56)';
       const after = getComputedStyle(target).backgroundColor;
       target.style.removeProperty('background-color');
       return {
         title: document.title,
         text: target.innerText,
         cssBefore: before,
         cssMutationObserved: after === 'rgb(12, 34, 56)',
         openShadowText:
           document.getElementById('open-shadow').shadowRoot
             ?.getElementById('open-shadow-text')?.textContent || null,
         closedShadowHidden:
           document.getElementById('closed-shadow').shadowRoot === null
       };`,
    );

    await execute(
      driverPort,
      sessionId,
      `const paragraph = document.getElementById('selection-target');
       const text = paragraph.firstChild;
       const start = text.nodeValue.indexOf('This exact');
       const range = document.createRange();
       range.setStart(text, start);
       range.setEnd(text, start + 'This exact sentence'.length);
       const selection = getSelection();
       selection.removeAllRanges();
       selection.addRange(range);`,
    );
    await keyboardShortcut(driverPort, sessionId);
    const exactSelection = await execute(
      driverPort,
      sessionId,
      `return {
         selectedText: getSelection().toString(),
         toolbarOpened:
           Boolean(document.getElementById('highlight-and-react-bar')),
         exactHighlightInstalled:
           Boolean(globalThis.CSS?.highlights?.has(
             'highlight-and-react-selection'
           ))
       };`,
    );
    await webdriver(driverPort, "POST", `/session/${sessionId}/actions`, {
      actions: [
        {
          type: "key",
          id: "escape-keyboard",
          actions: [
            { type: "keyDown", value: "\uE00C" },
            { type: "keyUp", value: "\uE00C" },
          ],
        },
      ],
    });
    await webdriver(driverPort, "DELETE", `/session/${sessionId}/actions`);

    await execute(
      driverPort,
      sessionId,
      "getSelection().removeAllRanges();",
    );
    await keyboardShortcut(driverPort, sessionId);
    const actionButton = await findElement(
      driverPort,
      sessionId,
      "#action-button",
    );
    await webdriver(driverPort, "POST", `/session/${sessionId}/actions`, {
      actions: [
        {
          type: "pointer",
          id: "highlight-and-react-pointer",
          parameters: { pointerType: "mouse" },
          actions: [
            {
              type: "pointerMove",
              duration: 0,
              origin: actionButton,
              x: 0,
              y: 0,
            },
          ],
        },
      ],
    });
    const elementHover = await execute(
      driverPort,
      sessionId,
      `return document.getElementById(
         'highlight-and-react-element-overlay'
       )?.dataset.state || null;`,
    );
    await webdriver(driverPort, "POST", `/session/${sessionId}/actions`, {
      actions: [
        {
          type: "pointer",
          id: "highlight-and-react-pointer",
          parameters: { pointerType: "mouse" },
          actions: [
            { type: "pointerDown", button: 0 },
            { type: "pointerUp", button: 0 },
          ],
        },
      ],
    });
    const elementLocked = await execute(
      driverPort,
      sessionId,
      `return {
         locked: Boolean(
           document.getElementById('highlight-and-react-bar')
           && document.getElementById('highlight-and-react-element-overlay')
             ?.dataset.state === 'locked'
         ),
         underlyingActivations: globalThis.__underlyingActivations
       };`,
    );
    const questionReaction = await findElement(
      driverPort,
      sessionId,
      '[data-reaction-key="standard:question"]',
    );
    await webdriver(
      driverPort,
      "POST",
      `/session/${sessionId}/element/${questionReaction[elementKey]}/click`,
      {},
    );
    const contextEvents = await execute(
      driverPort,
      sessionId,
      `return globalThis.__highlightAndReactContextOutbox?.length || 0;`,
    );
    await webdriver(driverPort, "DELETE", `/session/${sessionId}/actions`);
    const component = await findElement(
      driverPort,
      sessionId,
      "#component-target",
    );
    const componentScreenshot = await webdriver(
      driverPort,
      "GET",
      `/session/${sessionId}/element/${component[elementKey]}/screenshot`,
    );
    const elementSelection = {
      hover: elementHover,
      locked: elementLocked.locked,
      underlyingActivations: elementLocked.underlyingActivations,
      contextEvents,
      screenshotCaptured:
        typeof componentScreenshot === "string" &&
        componentScreenshot.length > 100,
    };

    const sameOriginFrame = await findElement(
      driverPort,
      sessionId,
      "#same-origin-frame",
    );
    await switchToFrame(driverPort, sessionId, sameOriginFrame);
    const sameOriginInjection = await injectSource(
      driverPort,
      sessionId,
      injectionExpression,
    );
    const sameOriginFrameAccess = await execute(
      driverPort,
      sessionId,
      `return {
         href: location.href,
         text: document.getElementById('frame-component').innerText,
         injected: Boolean(globalThis.__highlightAndReactSourceHash),
         border:
           getComputedStyle(document.getElementById('frame-component'))
             .borderTopWidth
       };`,
    );
    await switchToFrame(driverPort, sessionId, null);

    const crossOriginFrame = await findElement(
      driverPort,
      sessionId,
      "#cross-origin-frame",
    );
    await switchToFrame(driverPort, sessionId, crossOriginFrame);
    const crossOriginInjection = await injectSource(
      driverPort,
      sessionId,
      injectionExpression,
    );
    const crossOriginFrameAccess = await execute(
      driverPort,
      sessionId,
      `return {
         href: location.href,
         text: document.getElementById('frame-component').innerText,
         injected: Boolean(globalThis.__highlightAndReactSourceHash),
         border:
           getComputedStyle(document.getElementById('frame-component'))
             .borderTopWidth
       };`,
    );
    await switchToFrame(driverPort, sessionId, null);

    const screenshot = await webdriver(
      driverPort,
      "GET",
      `/session/${sessionId}/screenshot`,
    );
    const navigationUrl = `${origin}/safari-navigation.html`;
    await webdriver(
      driverPort,
      "POST",
      `/session/${sessionId}/url`,
      { url: navigationUrl },
    );
    const injectionBeforeOwnerRepair = await execute(
      driverPort,
      sessionId,
      "return Boolean(globalThis.__highlightAndReactSourceHash);",
    );
    const ownerRepair = injectionBeforeOwnerRepair
      ? "not-needed"
      : await injectSource(driverPort, sessionId, injectionExpression);
    const injectionAfterOwnerRepair = await execute(
      driverPort,
      sessionId,
      `return {
         href: location.href,
         injected: Boolean(globalThis.__highlightAndReactSourceHash),
         styleInstalled:
           Boolean(document.getElementById('highlight-and-react-stylesheet'))
       };`,
    );
    let newTab;
    if (bidiPreload.supported) {
      const created = await webdriver(
        driverPort,
        "POST",
        `/session/${sessionId}/window/new`,
        { type: "tab" },
      );
      await webdriver(
        driverPort,
        "POST",
        `/session/${sessionId}/window`,
        { handle: created.handle },
      );
      const newTabUrl = `${origin}/safari-new-tab.html`;
      await webdriver(
        driverPort,
        "POST",
        `/session/${sessionId}/url`,
        { url: newTabUrl },
      );
      newTab = await execute(
        driverPort,
        sessionId,
        `return {
           href: location.href,
           injected: Boolean(globalThis.__highlightAndReactSourceHash),
           styleInstalled:
             Boolean(document.getElementById('highlight-and-react-stylesheet'))
         };`,
      );
      await webdriver(
        driverPort,
        "DELETE",
        `/session/${sessionId}/window`,
      );
    }
    if (options.hold) {
      console.log(
        `[safari-webdriver-experiment] ready for a visible physical-input pass for ${options.hold}ms`,
      );
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, options.hold)
      );
    }
    return {
      available: true,
      transport: "WebDriver/Web Inspector",
      capabilities: session.capabilities,
      bidiPreload,
      preloadedInitialDocument,
      initialInjection,
      pageAccess,
      exactSelection,
      elementSelection,
      sameOriginFrame: {
        injection: sameOriginInjection,
        ...sameOriginFrameAccess,
      },
      crossOriginFrame: {
        injection: crossOriginInjection,
        ...crossOriginFrameAccess,
      },
      screenshot: {
        captured: typeof screenshot === "string" && screenshot.length > 100,
        base64Bytes: typeof screenshot === "string"
          ? Math.floor((screenshot.length * 3) / 4)
          : 0,
      },
      navigation: {
        injectionBeforeOwnerRepair,
        ownerRepair,
        ...injectionAfterOwnerRepair,
      },
      newTab,
    };
  } finally {
    bidiConnection?.close();
    if (sessionId) {
      await webdriver(
        driverPort,
        "DELETE",
        `/session/${sessionId}`,
      ).catch(() => undefined);
    }
    await stopProcess(driver);
    await closeServer(fixture.server);
  }
}

const invokedDirectly =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  runSafariExperiment({
    bidi: process.argv.includes("--bidi"),
    debug: process.argv.includes("--debug"),
    hold: process.argv.includes("--hold") ? 60_000 : 0,
  })
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : error);
      process.exit(1);
    });
}
