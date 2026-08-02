#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildInjectionExpression,
  drainContextEvents,
  inject,
  loadSystemTapbackAssets,
  splitWorkspaceSource,
} from "./devtools_injector.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, "..");
const fixtureDirectory = resolve(projectDirectory, "Fixtures/Browser");
const sourcePath = resolve(
  projectDirectory,
  "renderer/highlight_and_react.css",
);
const defaultBrowser =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const artifactDirectory = resolve(
  projectDirectory,
  "artifacts/browser-cdp-experiment",
);

function parseOptions(arguments_) {
  const options = {
    browser: defaultBrowser,
    headless: false,
    keepOpen: false,
    debug: false,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--browser") options.browser = resolve(arguments_[++index]);
    else if (argument === "--headless") options.headless = true;
    else if (argument === "--keep-open") options.keepOpen = true;
    else if (argument === "--debug") options.debug = true;
    else if (argument === "--help" || argument === "-h") {
      console.log(`Usage: node scripts/browser_cdp_experiment.mjs [options]

Launches an isolated Chrome profile with a loopback-only CDP endpoint, injects
the existing Highlight & React experiment, and measures browser access.

Options:
  --browser FILE  Chromium-family browser executable
  --headless      Run without a visible browser window
  --keep-open     Leave the isolated browser open after the report
  --debug         Print injector target details
  --help          Show this help`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
  return port;
}

async function fixtureServer(hostname = "127.0.0.1") {
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
        ...(pathname === "/csp.html"
          ? {
              "Content-Security-Policy":
                "default-src 'self'; script-src 'none'; style-src 'none'; frame-src http:",
            }
          : {}),
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, hostname, resolvePromise);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    port,
    close: () =>
      new Promise((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()));
      }),
  };
}

async function waitForPage(port, expectedUrl) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1_000),
      });
      const targets = await response.json();
      const page = targets.find(
        (target) =>
          target.type === "page" &&
          target.url.startsWith(expectedUrl) &&
          target.webSocketDebuggerUrl,
      );
      if (page) return page;
    } catch {
      // Chrome has not opened its debugging endpoint yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Timed out waiting for the isolated browser fixture");
}

class CdpConnection {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error || message.result?.exceptionDetails) {
          pending.reject(
            new Error(
              JSON.stringify(message.error || message.result.exceptionDetails),
            ),
          );
        } else {
          pending.resolve(message.result || {});
        }
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) {
        listener(message.params || {}, message.sessionId);
      }
    });
    await new Promise((resolvePromise, reject) => {
      this.socket.addEventListener("open", resolvePromise, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    return this;
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  call(method, params = {}, sessionId) {
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
      this.socket.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  }

  async evaluate(expression, contextId, sessionId) {
    const result = await this.call(
      "Runtime.evaluate",
      {
        expression,
        contextId,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
    );
    return result.result?.value;
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

function findText(node, expected) {
  if (!node || typeof node !== "object") return false;
  if (node.nodeValue === expected) return true;
  return Object.values(node).some((value) => {
    if (Array.isArray(value)) {
      return value.some((child) => findText(child, expected));
    }
    return value && typeof value === "object"
      ? findText(value, expected)
      : false;
  });
}

function frameProbeExpression() {
  return `(() => {
    const component = document.getElementById('frame-component');
    let selectorEntered = null;
    if (component) {
      getSelection().removeAllRanges();
      const bounds = component.getBoundingClientRect();
      const point = {
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2
      };
      document.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'r',
        code: 'KeyR',
        ctrlKey: true,
        altKey: true
      }));
      component.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        clientX: point.x,
        clientY: point.y
      }));
      selectorEntered =
        document.documentElement.dataset.highlightAndReactPicking === 'true'
        && document.getElementById('highlight-and-react-element-overlay')
          ?.dataset.state === 'hover';
      document.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Escape',
        code: 'Escape'
      }));
    }
    return {
      href: location.href,
      injected: Boolean(globalThis.__highlightAndReactSourceHash),
      styleInstalled: Boolean(
        document.getElementById('highlight-and-react-stylesheet')
      ),
      frameText: component?.innerText || null,
      computedBorder: component ? getComputedStyle(component).borderTopWidth : null,
      selectorEntered
    };
  })()`;
}

async function probeFrames(connection, injectionExpression) {
  const contexts = new Map();
  connection.on("Runtime.executionContextCreated", ({ context }) => {
    if (context?.auxData?.isDefault && context.auxData.frameId) {
      contexts.set(context.auxData.frameId, {
        id: context.id,
        origin: context.origin,
      });
    }
  });
  connection.on("Runtime.executionContextDestroyed", ({ executionContextId }) => {
    for (const [frameId, context] of contexts) {
      if (context.id === executionContextId) contexts.delete(frameId);
    }
  });
  connection.on("Runtime.executionContextsCleared", () => contexts.clear());
  await connection.call("Runtime.enable");
  await connection.call("Page.enable");
  await connection.call("Page.addScriptToEvaluateOnNewDocument", {
    source: deferredInstallExpression(injectionExpression),
  });
  const loaded = new Promise((resolvePromise) => {
    connection.on("Page.loadEventFired", resolvePromise);
  });
  await connection.call("Page.reload", { ignoreCache: true });
  await loaded;
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));

  const results = [];
  for (const [frameId, context] of contexts) {
    try {
      const value = await connection.evaluate(
        frameProbeExpression(),
        context.id,
      );
      results.push({
        frameId,
        targetType: "frame-context",
        origin: context.origin,
        ...value,
      });
    } catch (error) {
      results.push({
        frameId,
        origin: context.origin,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await connection.call("Target.setDiscoverTargets", { discover: true });
  const { targetInfos = [] } = await connection.call("Target.getTargets");
  const outOfProcessFrames = targetInfos.filter(
    (target) => target.type === "iframe" && target.url,
  );
  for (const target of outOfProcessFrames) {
    let sessionId;
    try {
      const attached = await connection.call("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
      });
      sessionId = attached.sessionId;
      await connection.call("Runtime.enable", {}, sessionId);
      await connection.evaluate(
        deferredInstallExpression(injectionExpression),
        undefined,
        sessionId,
      );
      const value = await connection.evaluate(
        frameProbeExpression(),
        undefined,
        sessionId,
      );
      results.push({
        frameId: target.targetId,
        targetType: "out-of-process-iframe",
        origin: new URL(target.url).origin,
        ...value,
      });
    } catch (error) {
      results.push({
        frameId: target.targetId,
        targetType: "out-of-process-iframe",
        origin: new URL(target.url).origin,
        href: target.url,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (sessionId) {
        await connection
          .call("Target.detachFromTarget", { sessionId })
          .catch(() => undefined);
      }
    }
  }
  return results.sort((left, right) =>
    String(left.href || left.origin).localeCompare(
      String(right.href || right.origin),
    ),
  );
}

async function stopBrowser(browser) {
  if (browser.exitCode !== null) return;
  browser.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => browser.once("exit", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000)),
  ]);
}

async function dispatchShortcut(connection) {
  const common = {
    modifiers: 3,
    key: "r",
    code: "KeyR",
    windowsVirtualKeyCode: 82,
  };
  await connection.call("Input.dispatchKeyEvent", {
    type: "keyDown",
    ...common,
  });
  await connection.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    ...common,
  });
}

async function dispatchPointer(connection, type, point, options = {}) {
  await connection.call("Input.dispatchMouseEvent", {
    type,
    x: point.x,
    y: point.y,
    button: options.button || "none",
    buttons: options.buttons || 0,
    clickCount: options.clickCount || 0,
    pointerType: "mouse",
  });
}

async function probeStrictContentSecurityPolicy(
  pageConnection,
  debugPort,
  primaryOrigin,
  source,
) {
  const cspUrl = `${primaryOrigin}/csp.html`;
  const { targetId } = await pageConnection.call("Target.createTarget", {
    url: cspUrl,
  });
  let cspConnection;
  try {
    const target = await waitForPage(debugPort, cspUrl);
    await inject(debugPort, source);
    cspConnection = await new CdpConnection(
      target.webSocketDebuggerUrl,
    ).connect();
    await cspConnection.call("Page.enable");
    await cspConnection.call("DOM.enable");
    await cspConnection.call("CSS.enable");
    const before = await cspConnection.evaluate(`(() => {
      const style = document.getElementById('highlight-and-react-stylesheet');
      return {
        scriptInstalled: Boolean(globalThis.__highlightAndReactSourceHash),
        styleElementInstalled: Boolean(style),
        inlineRuleCount: style?.sheet?.cssRules?.length || 0
      };
    })()`);
    const { frameTree } = await cspConnection.call("Page.getFrameTree");
    const { styleSheetId } = await cspConnection.call(
      "CSS.createStyleSheet",
      { frameId: frameTree.frame.id },
    );
    const { css } = splitWorkspaceSource(source);
    await cspConnection.call("CSS.setStyleSheetText", {
      styleSheetId,
      text: css,
    });
    const { text: cdpStyleSheetText } = await cspConnection.call(
      "CSS.getStyleSheetText",
      { styleSheetId },
    );
    const componentPoint = await cspConnection.evaluate(`(() => {
      getSelection().removeAllRanges();
      const bounds = document
        .getElementById('component-target')
        .getBoundingClientRect();
      return {
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2
      };
    })()`);
    await dispatchShortcut(cspConnection);
    await dispatchPointer(cspConnection, "mouseMoved", componentPoint);
    const after = {
      cdpStyleSheetContainsOverlayRule:
        cdpStyleSheetText.includes("#highlight-and-react-element-overlay"),
    };
    after.selectorEntered =
      await cspConnection.evaluate(`(() => {
        const overlay = document.getElementById(
          'highlight-and-react-element-overlay'
        );
        return {
          active:
            document.documentElement.dataset.highlightAndReactPicking === 'true',
          overlayPosition: overlay ? getComputedStyle(overlay).position : null,
          cursor: getComputedStyle(document.documentElement).cursor
        };
      })()`);
    await cspConnection.call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await cspConnection.call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    return { ...before, ...after };
  } finally {
    cspConnection?.close();
    await pageConnection
      .call("Target.closeTarget", { targetId })
      .catch(() => undefined);
  }
}

async function waitForCondition(probe, description, timeout = 8_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(
    `Timed out waiting for ${description}${
      lastError instanceof Error ? `: ${lastError.message}` : ""
    }`,
  );
}

async function probeContinuousOwnership(
  debugPort,
  primaryOrigin,
  crossOrigin,
  injectionExpression,
) {
  const browserVersion = await (
    await fetch(`http://127.0.0.1:${debugPort}/json/version`)
  ).json();
  const owner = await new CdpConnection(
    browserVersion.webSocketDebuggerUrl,
  ).connect();
  const sessionsByTarget = new Map();
  const installations = [];

  const install = async (sessionId, targetInfo) => {
    if (
      !sessionId ||
      !targetInfo?.targetId ||
      !["page", "iframe"].includes(targetInfo.type)
    ) {
      return;
    }
    sessionsByTarget.set(targetInfo.targetId, {
      sessionId,
      targetInfo,
    });
    const installation = (async () => {
      await owner.call("Runtime.enable", {}, sessionId);
      if (targetInfo.type === "page") {
        await owner.call("Page.enable", {}, sessionId);
        await owner.call(
          "Page.addScriptToEvaluateOnNewDocument",
          { source: deferredInstallExpression(injectionExpression) },
          sessionId,
        );
      }
      await owner.evaluate(
        deferredInstallExpression(injectionExpression),
        undefined,
        sessionId,
      );
      return targetInfo.targetId;
    })();
    installations.push(installation);
    await installation;
  };

  owner.on(
    "Target.attachedToTarget",
    ({ sessionId, targetInfo }) => {
      install(sessionId, targetInfo).catch(() => undefined);
    },
  );
  owner.on("Target.detachedFromTarget", ({ targetId }) => {
    sessionsByTarget.delete(targetId);
  });

  try {
    await owner.call("Target.setDiscoverTargets", { discover: true });
    await owner.call("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
      filter: [{ type: "page" }, { type: "iframe" }],
    });
    const { targetInfos = [] } = await owner.call("Target.getTargets");
    for (const targetInfo of targetInfos) {
      if (
        !["page", "iframe"].includes(targetInfo.type) ||
        sessionsByTarget.has(targetInfo.targetId)
      ) {
        continue;
      }
      try {
        const { sessionId } = await owner.call("Target.attachToTarget", {
          targetId: targetInfo.targetId,
          flatten: true,
        });
        await install(sessionId, targetInfo);
      } catch (error) {
        if (!String(error).includes("already attached")) throw error;
      }
    }

    const navigationOne =
      `${primaryOrigin}/navigation-one.html?crossOrigin=${
        encodeURIComponent(`${crossOrigin}/frame.html`)
      }`;
    const { targetId } = await owner.call("Target.createTarget", {
      url: navigationOne,
    });
    const newPage = await waitForCondition(
      () => sessionsByTarget.get(targetId),
      "continuous owner to attach to a new tab",
    );
    await Promise.allSettled(installations);
    const newTabInjected = await waitForCondition(
      async () =>
        owner.evaluate(
          `globalThis.__highlightAndReactSourceHash ? {
            href: location.href,
            styleInstalled: Boolean(
              document.getElementById('highlight-and-react-stylesheet')
            )
          } : null`,
          undefined,
          newPage.sessionId,
        ),
      "new tab injection",
    );

    const navigationTwo =
      `${primaryOrigin}/navigation-two.html?crossOrigin=${
        encodeURIComponent(`${crossOrigin}/frame.html`)
      }`;
    await owner.call(
      "Page.navigate",
      { url: navigationTwo },
      newPage.sessionId,
    );
    const reinjectedAfterNavigation = await waitForCondition(
      async () =>
        owner.evaluate(
          `location.pathname === '/navigation-two.html'
            && globalThis.__highlightAndReactSourceHash
            ? {
                href: location.href,
                styleInstalled: Boolean(
                  document.getElementById('highlight-and-react-stylesheet')
                )
              }
            : null`,
          undefined,
          newPage.sessionId,
        ),
      "same-tab reinjection after navigation",
    );
    const crossOriginFrame = await waitForCondition(
      async () => {
        for (const session of sessionsByTarget.values()) {
          if (
            session.targetInfo.type !== "iframe" ||
            !session.targetInfo.url.startsWith(crossOrigin)
          ) {
            continue;
          }
          const injected = await owner.evaluate(
            `Boolean(globalThis.__highlightAndReactSourceHash)`,
            undefined,
            session.sessionId,
          );
          if (injected) {
            return {
              href: session.targetInfo.url,
              targetType: session.targetInfo.type,
              injected,
            };
          }
        }
        return null;
      },
      "cross-origin iframe auto-attachment",
    );
    await owner.call("Target.closeTarget", { targetId });
    return {
      autoAttachEnabled: true,
      newTabInjected,
      reinjectedAfterNavigation,
      crossOriginFrame,
    };
  } finally {
    owner.close();
  }
}

export async function runBrowserExperiment(options = {}) {
  const browserExecutable = options.browser || defaultBrowser;
  const debugPort = await availablePort();
  const primaryServer = await fixtureServer("127.0.0.1");
  const crossOriginServer = await fixtureServer("127.0.0.1");
  const profileDirectory = await mkdtemp(
    join(tmpdir(), "highlight-and-react-browser-profile-"),
  );
  const primaryOrigin = `http://127.0.0.1:${primaryServer.port}`;
  const crossOrigin = `http://localhost:${crossOriginServer.port}`;
  const fixtureUrl =
    `${primaryOrigin}/?crossOrigin=${encodeURIComponent(`${crossOrigin}/frame.html`)}`;
  const arguments_ = [
    `--user-data-dir=${profileDirectory}`,
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${debugPort}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-component-update",
    "--new-window",
    fixtureUrl,
  ];
  if (options.headless) arguments_.unshift("--headless=new");
  const browser = spawn(browserExecutable, arguments_, {
    stdio: options.debug ? ["ignore", "inherit", "inherit"] : "ignore",
    detached: Boolean(options.keepOpen),
  });
  if (options.keepOpen) browser.unref();

  let keepBrowser = Boolean(options.keepOpen);
  try {
    const page = await waitForPage(debugPort, primaryOrigin);
    const source = await readFile(sourcePath, "utf8");
    const initialInjection = await inject(
      debugPort,
      source,
      Boolean(options.debug),
    );
    const connection = await new CdpConnection(
      page.webSocketDebuggerUrl,
    ).connect();
    try {
      const pageAccess = await connection.evaluate(`(() => {
        const target = document.getElementById('component-target');
        const before = getComputedStyle(target).backgroundColor;
        target.style.backgroundColor = 'rgb(12, 34, 56)';
        const after = getComputedStyle(target).backgroundColor;
        target.style.removeProperty('background-color');
        let crossOriginBlocked = false;
        try {
          void document.getElementById('cross-origin-frame').contentDocument.body;
        } catch {
          crossOriginBlocked = true;
        }
        return {
          title: document.title,
          targetText: target.innerText,
          cssBefore: before,
          cssMutationObserved: after === 'rgb(12, 34, 56)',
          sameOriginFrameText:
            document.getElementById('same-origin-frame').contentDocument
              ?.getElementById('frame-component')?.innerText || null,
          crossOriginBlockedFromPageJavaScript: crossOriginBlocked,
          openShadowText:
            document.getElementById('open-shadow').shadowRoot
              ?.getElementById('open-shadow-text')?.textContent || null,
          closedShadowHiddenFromPageJavaScript:
            document.getElementById('closed-shadow').shadowRoot === null
        };
      })()`);

      const selectedText = await connection.evaluate(`(() => {
        const paragraph = document.getElementById('selection-target');
        const range = document.createRange();
        const text = paragraph.firstChild;
        const start = text.nodeValue.indexOf('This exact');
        range.setStart(text, start);
        range.setEnd(text, start + 'This exact sentence'.length);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return selection.toString();
      })()`);
      await dispatchShortcut(connection);
      const exactRangeSelection = await connection.evaluate(`(() => {
        const result = {
          toolbarOpened: Boolean(document.getElementById('highlight-and-react-bar')),
          exactHighlightInstalled:
            Boolean(globalThis.CSS?.highlights?.has('highlight-and-react-selection')),
          selectedText: getSelection().toString()
        };
        document.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true,
          key: 'Escape',
          code: 'Escape'
        }));
        return result;
      })()`);
      exactRangeSelection.inputDispatchedByCdp =
        exactRangeSelection.selectedText === selectedText;

      const elementPoint = await connection.evaluate(`(() => {
        getSelection().removeAllRanges();
        const button = document.getElementById('action-button');
        const bounds = button.getBoundingClientRect();
        return {
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2
        };
      })()`);
      await dispatchShortcut(connection);
      await dispatchPointer(connection, "mouseMoved", elementPoint);
      const hover = await connection.evaluate(`document.getElementById(
        'highlight-and-react-element-overlay'
      )?.dataset.state`);
      await dispatchPointer(connection, "mousePressed", elementPoint, {
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      await dispatchPointer(connection, "mouseReleased", elementPoint, {
        button: "left",
        clickCount: 1,
      });
      const elementSelection = await connection.evaluate(`(() => {
        const locked = Boolean(
          document.getElementById('highlight-and-react-bar')
          && document.getElementById('highlight-and-react-element-overlay')
            ?.dataset.state === 'locked'
        );
        const reaction = document.querySelector(
          '[data-reaction-key="standard:question"]'
        );
        const reactionBounds = reaction.getBoundingClientRect();
        return {
          reactionPoint: {
            x: reactionBounds.left + reactionBounds.width / 2,
            y: reactionBounds.top + reactionBounds.height / 2
          },
          locked,
          underlyingActivations: globalThis.__underlyingActivations
        };
      })()`);
      await dispatchPointer(
        connection,
        "mousePressed",
        elementSelection.reactionPoint,
        {
          button: "left",
          buttons: 1,
          clickCount: 1,
        },
      );
      await dispatchPointer(
        connection,
        "mouseReleased",
        elementSelection.reactionPoint,
        {
          button: "left",
          clickCount: 1,
        },
      );
      const contextEventCount = await connection.evaluate(
        `globalThis.__highlightAndReactContextOutbox?.length || 0`,
      );
      Object.assign(elementSelection, {
        hover,
        contextEvents: contextEventCount,
        inputDispatchedByCdp: true,
      });
      delete elementSelection.reactionPoint;

      const contextEvents = await drainContextEvents(debugPort, {
        screenshotDirectory: options.artifactDirectory || artifactDirectory,
      });
      const documentTree = await connection.call("DOM.getDocument", {
        depth: -1,
        pierce: true,
      });
      const closedShadowPiercedByCdp = findText(
        documentTree.root,
        "Closed shadow component text",
      );
      const strictContentSecurityPolicy =
        await probeStrictContentSecurityPolicy(
          connection,
          debugPort,
          primaryOrigin,
          source,
        );
      const injectionExpression = buildInjectionExpression(
        source,
        await loadSystemTapbackAssets(),
      );
      const frameAccess = await probeFrames(connection, injectionExpression);
      const continuousOwnership = await probeContinuousOwnership(
        debugPort,
        primaryOrigin,
        crossOrigin,
        injectionExpression,
      );
      const browserVersion = await (
        await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      ).json();
      const report = {
        browser: {
          executable: browserExecutable,
          name: basename(browserExecutable),
          protocol: browserVersion["Protocol-Version"],
          userAgent: browserVersion["User-Agent"],
          isolatedProfile: true,
          loopbackDebugPort: debugPort,
        },
        pageAccess,
        exactRangeSelection,
        elementSelection,
        closedShadowPiercedByCdp,
        strictContentSecurityPolicy,
        continuousOwnership,
        frames: frameAccess,
        initialInjection,
        capturedContext: contextEvents.map((event) => ({
          targetType: event.target?.targetType,
          label: event.target?.label,
          text: event.clipboardText,
          screenshot: event.screenshot,
        })),
      };
      keepBrowser = Boolean(options.keepOpen);
      return report;
    } finally {
      connection.close();
    }
  } finally {
    await primaryServer.close();
    await crossOriginServer.close();
    if (!keepBrowser) {
      await stopBrowser(browser);
      await rm(profileDirectory, { recursive: true, force: true });
    } else {
      console.log(
        `[browser-cdp-experiment] isolated profile retained at ${profileDirectory}`,
      );
    }
  }
}

const invokedDirectly =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const options = parseOptions(process.argv.slice(2));
  runBrowserExperiment(options)
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : error);
      process.exit(1);
    });
}
