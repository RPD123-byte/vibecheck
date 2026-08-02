#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { deliverContextEvent } from './context_delivery.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, '..');
const defaultSource = resolve(projectDirectory, 'renderer/highlight_and_react.css');
const systemTapbackRenderer = resolve(scriptDirectory, 'render_system_tapbacks.swift');
const defaultScreenshotDirectory = join(tmpdir(), 'highlight-and-react-context');
const workspaceScriptPattern = /\/\*\s*@attune-script\s*\n([\s\S]*?)\n\s*@end-attune-script\s*\*\//g;
const execFileAsync = promisify(execFile);
let systemTapbackAssetsPromise;

function usage() {
  console.log(`Usage: node scripts/devtools_injector.mjs --port PORT [options]

Options:
  --source FILE   Attune-compatible CSS/script source
  --once          Inject once and exit instead of watching
  --debug         Print target and injection details
  --quiet         Suppress transient renderer-waiting messages
  --context-mode MODE  Context delivery: off, clipboard, or codex (default: off)
  --clipboard-bridge FILE  macOS text-and-PNG clipboard writer executable
  --context-bridge FILE  Experiment-local Codex bridge executable
  --help          Show this help`);
}

function parseOptions(arguments_) {
  const options = {
    port: 0,
    source: defaultSource,
    once: false,
    debug: false,
    quiet: false,
    contextMode: 'off',
    clipboardBridge: '',
    contextBridge: '',
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--port') options.port = Number(arguments_[++index]);
    else if (argument === '--source') options.source = resolve(arguments_[++index]);
    else if (argument === '--once') options.once = true;
    else if (argument === '--debug') options.debug = true;
    else if (argument === '--quiet') options.quiet = true;
    else if (argument === '--context-mode') options.contextMode = arguments_[++index];
    else if (argument === '--clipboard-bridge') {
      options.clipboardBridge = resolve(arguments_[++index]);
    }
    else if (argument === '--context-bridge') {
      options.contextBridge = resolve(arguments_[++index]);
    }
    else if (argument === '--help' || argument === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error('--port must be an integer between 1 and 65535');
  }
  if (!['off', 'clipboard', 'codex'].includes(options.contextMode)) {
    throw new Error('--context-mode must be off, clipboard, or codex');
  }
  if (options.contextMode !== 'off' && !options.clipboardBridge) {
    throw new Error('--clipboard-bridge is required when context delivery is enabled');
  }
  if (options.contextMode === 'codex' && !options.contextBridge) {
    throw new Error('--context-bridge is required when --context-mode is codex');
  }
  return options;
}

export function splitWorkspaceSource(source) {
  const scripts = [];
  const css = source.replace(workspaceScriptPattern, (_match, script) => {
    scripts.push(script.trim());
    return '';
  }).trim();
  return { css, script: scripts.join('\n;\n') };
}

export async function loadSystemTapbackAssets() {
  if (process.platform !== 'darwin') return {};
  systemTapbackAssetsPromise ??= execFileAsync(
    'swift',
    [systemTapbackRenderer],
    { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
  ).then(({ stdout }) => JSON.parse(stdout)).catch((error) => {
    console.warn(`[highlight-and-react] system Tapback assets unavailable: ${error.message}`);
    return {};
  });
  return systemTapbackAssetsPromise;
}

export function buildInjectionExpression(source, systemTapbackAssets = {}) {
  const { css, script } = splitWorkspaceSource(source);
  const hash = createHash('sha256').update(source).digest('hex');
  return `(() => {
    const id = 'highlight-and-react-stylesheet';
    const hash = ${JSON.stringify(hash)};
    const css = ${JSON.stringify(css)};
    const script = ${JSON.stringify(script)};
    const systemTapbackAssets = ${JSON.stringify(systemTapbackAssets)};
    const cleanupKey = '__highlightAndReactCleanup';
    const hashKey = '__highlightAndReactSourceHash';
    const current = document.getElementById(id);
    window.__highlightAndReactSystemTapbacks = systemTapbackAssets;
    const changed = window[hashKey] !== hash;
    if (!current || current.dataset.sourceHash !== hash) {
      const style = current || document.createElement('style');
      style.id = id;
      style.dataset.sourceHash = hash;
      style.textContent = css;
      if (!current) (document.head || document.documentElement).append(style);
    }
    if (changed) {
      try { window[cleanupKey]?.(); } catch (error) {
        console.warn('[highlight-and-react] cleanup failed', error);
      }
      window[hashKey] = hash;
      window[cleanupKey] = undefined;
      window.__attuneRegisterCleanup = (cleanup) => {
        if (typeof cleanup === 'function') window[cleanupKey] = cleanup;
      };
      (0, eval)(script);
    }
    return changed ? 'applied' : 'current';
  })()`;
}

async function debugTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(1000),
  });
  if (!response.ok) throw new Error(`DevTools endpoint returned ${response.status}`);
  return response.json();
}

async function cdpCommand(webSocketDebuggerUrl, method, params = {}) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error('DevTools connection timed out')), 3000);
    socket.addEventListener('open', () => {
      clearTimeout(timeout);
      resolvePromise();
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('DevTools connection failed'));
    }, { once: true });
  });

  try {
    return await new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(new Error(`${method} timed out`)), 3000);
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== 1) return;
        clearTimeout(timeout);
        if (message.error || message.result?.exceptionDetails) {
          reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
        } else {
          resolvePromise(message.result);
        }
      });
      socket.send(JSON.stringify({
        id: 1,
        method,
        params,
      }));
    });
  } finally {
    socket.close();
  }
}

async function evaluate(webSocketDebuggerUrl, expression) {
  const result = await cdpCommand(webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  return result?.result?.value;
}

function screenshotClip(bounds, viewport, padding = 12) {
  if (!bounds || !viewport) return null;
  const viewportWidth = Number(viewport.clientWidth);
  const viewportHeight = Number(viewport.clientHeight);
  const rawLeft = Number(bounds.x) - padding;
  const rawTop = Number(bounds.y) - padding;
  const rawRight = Number(bounds.x) + Number(bounds.width) + padding;
  const rawBottom = Number(bounds.y) + Number(bounds.height) + padding;
  if (![viewportWidth, viewportHeight, rawLeft, rawTop, rawRight, rawBottom]
    .every(Number.isFinite)) return null;
  const left = Math.max(0, Math.min(viewportWidth, rawLeft));
  const top = Math.max(0, Math.min(viewportHeight, rawTop));
  const right = Math.max(left, Math.min(viewportWidth, rawRight));
  const bottom = Math.max(top, Math.min(viewportHeight, rawBottom));
  if (right - left < 1 || bottom - top < 1) return null;
  return {
    x: Number(viewport.pageX || 0) + left,
    y: Number(viewport.pageY || 0) + top,
    width: right - left,
    height: bottom - top,
    scale: 1,
  };
}

async function captureComponentScreenshot(
  webSocketDebuggerUrl,
  event,
  screenshotDirectory,
) {
  const metrics = await cdpCommand(webSocketDebuggerUrl, 'Page.getLayoutMetrics');
  const viewport = metrics.cssVisualViewport || metrics.visualViewport;
  const clip = screenshotClip(event.target?.bounds, viewport);
  if (!clip) throw new Error('selected component has no visible screenshot bounds');
  const result = await cdpCommand(webSocketDebuggerUrl, 'Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    clip,
  });
  if (!result?.data) throw new Error('renderer returned no screenshot data');
  await mkdir(screenshotDirectory, { recursive: true });
  const safeId = String(event.id || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = join(screenshotDirectory, `${safeId}.png`);
  await writeFile(path, result.data, 'base64');
  return {
    path,
    mimeType: 'image/png',
    width: Math.round(clip.width),
    height: Math.round(clip.height),
  };
}

export async function inject(port, source, debug = false) {
  const targets = (await debugTargets(port))
    .filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  if (!targets.length) throw new Error('No page renderer targets found');
  const expression = buildInjectionExpression(source, await loadSystemTapbackAssets());
  const results = await Promise.all(targets.map(async (target) => ({
    title: target.title,
    url: target.url,
    status: await evaluate(target.webSocketDebuggerUrl, expression),
  })));
  if (debug) console.log(JSON.stringify(results, null, 2));
  return results;
}

export async function drainContextEvents(port, options = {}) {
  const screenshotDirectory = options.screenshotDirectory || defaultScreenshotDirectory;
  const targets = (await debugTargets(port))
    .filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  const expression = `(() => {
    const key = '__highlightAndReactContextOutbox';
    const outbox = globalThis[key];
    if (!Array.isArray(outbox) || !outbox.length) return [];
    return outbox.splice(0, outbox.length);
  })()`;
  const batches = await Promise.all(targets.map(async (target) => ({
    title: target.title,
    url: target.url,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl,
    events: await evaluate(target.webSocketDebuggerUrl, expression),
  })));
  const events = [];
  for (const batch of batches) {
    if (!Array.isArray(batch.events)) continue;
    for (const event of batch.events) {
      let screenshot;
      try {
        screenshot = await captureComponentScreenshot(
          batch.webSocketDebuggerUrl,
          event,
          screenshotDirectory,
        );
      } catch (error) {
        screenshot = {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
      events.push({
        ...event,
        renderer: { title: batch.title, url: batch.url },
        screenshot,
      });
    }
  }
  return events;
}

function printDeliveryResult(result) {
  const clipboard = result.clipboard?.status || 'unknown';
  const codex = result.codex?.status || 'unknown';
  console.log(`[highlight-and-react] context clipboard=${clipboard} codex=${codex}`);
  if (result.clipboard?.error) {
    console.error(`[highlight-and-react] clipboard error: ${result.clipboard.error}`);
  }
  if (result.codex?.error) {
    console.error(`[highlight-and-react] Codex bridge error: ${result.codex.error}`);
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  let lastError = '';
  let attached = false;
  do {
    try {
      const source = await readFile(options.source, 'utf8');
      const results = await inject(options.port, source, options.debug);
      if (!attached && !options.once && !options.quiet) {
        console.log(`[highlight-and-react] attached to ${results.length} renderer target(s)`);
      }
      attached = true;
      lastError = '';
      if (options.contextMode !== 'off') {
        const events = await drainContextEvents(options.port);
        for (const event of events) {
          const delivery = await deliverContextEvent(event, {
            mode: options.contextMode,
            clipboardBridgePath: options.clipboardBridge,
            bridgePath: options.contextBridge,
          });
          printDeliveryResult(delivery);
        }
      }
      if (options.once) {
        console.log(`Injected Highlight & React into ${results.length} renderer target(s).`);
        return;
      }
    } catch (error) {
      attached = false;
      const message = error instanceof Error ? error.message : String(error);
      if (!options.quiet && message !== lastError) {
        console.error(`[highlight-and-react] waiting for renderer: ${message}`);
      }
      lastError = message;
      if (options.once) throw error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  } while (true);
}

const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
