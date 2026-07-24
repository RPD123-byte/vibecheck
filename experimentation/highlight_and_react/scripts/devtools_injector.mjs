#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, '..');
const defaultSource = resolve(projectDirectory, 'renderer/highlight_and_react.css');
const systemTapbackRenderer = resolve(scriptDirectory, 'render_system_tapbacks.swift');
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
  --help          Show this help`);
}

function parseOptions(arguments_) {
  const options = {
    port: 0,
    source: defaultSource,
    once: false,
    debug: false,
    quiet: false,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--port') options.port = Number(arguments_[++index]);
    else if (argument === '--source') options.source = resolve(arguments_[++index]);
    else if (argument === '--once') options.once = true;
    else if (argument === '--debug') options.debug = true;
    else if (argument === '--quiet') options.quiet = true;
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

async function evaluate(webSocketDebuggerUrl, expression) {
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
      const timeout = setTimeout(() => reject(new Error('Runtime.evaluate timed out')), 3000);
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== 1) return;
        clearTimeout(timeout);
        if (message.error || message.result?.exceptionDetails) {
          reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
        } else {
          resolvePromise(message.result?.result?.value);
        }
      });
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true },
      }));
    });
  } finally {
    socket.close();
  }
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
