import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { inject, splitWorkspaceSource } from '../scripts/devtools_injector.mjs';

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(projectDirectory, 'renderer/highlight_and_react.css');
const fixtureMain = resolve(projectDirectory, 'Fixtures/Renderer/main.mjs');
const fixtureLauncher = resolve(projectDirectory, 'scripts/run_fixture_renderer.sh');

function findElectron() {
  const executable = 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
  const candidates = [];
  if (process.env.ELECTRON_PATH) candidates.push(process.env.ELECTRON_PATH);
  candidates.push(resolve(projectDirectory, executable));
  try {
    const commonGitDirectory = execFileSync(
      'git',
      ['rev-parse', '--git-common-dir'],
      { cwd: projectDirectory, encoding: 'utf8' },
    ).trim();
    candidates.push(resolve(commonGitDirectory, '..', executable));
  } catch {
    // The explicit ELECTRON_PATH fallback still works outside a git checkout.
  }
  return candidates.find(existsSync);
}

async function availablePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolvePromise(address.port);
      });
    });
  });
}

async function waitForPage(port) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => (
        target.type === 'page'
        && target.url.startsWith('file:')
        && target.webSocketDebuggerUrl
      ));
      if (page) {
        const ready = await evaluate(
          page.webSocketDebuggerUrl,
          `document.readyState === 'complete' && Boolean(document.getElementById('fixture-text'))`,
        );
        if (ready) return page;
      }
    } catch {
      // Electron has not bound the debugging port yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error('Timed out waiting for the Electron fixture');
}

async function evaluate(webSocketDebuggerUrl, expression) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener('open', resolvePromise, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  try {
    return await new Promise((resolvePromise, reject) => {
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== 1) return;
        if (message.result?.exceptionDetails) reject(new Error(JSON.stringify(message.result.exceptionDetails)));
        else resolvePromise(message.result?.result?.value);
      });
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression,
          awaitPromise: true,
          returnByValue: true,
        },
      }));
    });
  } finally {
    socket.close();
  }
}

test('Attune source separates renderer CSS and JavaScript', async () => {
  const source = await readFile(sourcePath, 'utf8');
  const parts = splitWorkspaceSource(source);
  assert.match(parts.css, /#highlight-and-react-bar/);
  assert.doesNotMatch(parts.css, /@attune-script/);
  assert.match(parts.script, /onDoubleClick/);
});

test('interactive launcher discovers Electron from the renamed main checkout', () => {
  const electron = execFileSync(fixtureLauncher, ['--print-electron-path'], {
    cwd: projectDirectory,
    encoding: 'utf8',
  }).trim();
  assert.ok(existsSync(electron), `Electron path does not exist: ${electron}`);
  assert.doesNotMatch(electron, /\/Users\/computer\/uncover\//);
});

test('injected renderer opens, dismisses, shortcuts, and reacts', async (context) => {
  const electron = findElectron();
  assert.ok(electron, 'Electron not found; set ELECTRON_PATH to its executable');
  const port = await availablePort();
  const electronProcess = spawn(
    electron,
    [`--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${port}`, fixtureMain],
    { stdio: 'ignore' },
  );
  context.after(() => {
    if (electronProcess.exitCode === null) electronProcess.kill('SIGTERM');
  });

  const page = await waitForPage(port);
  const source = await readFile(sourcePath, 'utf8');
  await inject(port, source);

  const result = await evaluate(page.webSocketDebuggerUrl, `(async () => {
    const text = document.getElementById('fixture-text').firstChild;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 9);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.getElementById('fixture-text').dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true }),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const message = document.querySelector('[data-user-message-bubble]');
    const openedByDoubleClick = Boolean(
      document.getElementById('highlight-and-react-bar')
      && CSS.highlights.has('highlight-and-react-selection'),
    );

    document.getElementById('outside').dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }),
    );
    const dismissedOutside = !document.getElementById('highlight-and-react-bar')
      && !CSS.highlights.has('highlight-and-react-selection');

    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: '®',
      code: 'KeyR',
      ctrlKey: true,
      altKey: true,
    }));
    const openedByShortcut = Boolean(document.getElementById('highlight-and-react-bar'));
    document.querySelector('#highlight-and-react-bar button').click();
    const reaction = message.dataset.highlightAndReactReaction;
    const closedAfterReaction = !document.getElementById('highlight-and-react-bar');

    const assistantText = document.getElementById('assistant-text').firstChild;
    const assistantRange = document.createRange();
    assistantRange.setStart(assistantText, 0);
    assistantRange.setEnd(assistantText, 9);
    selection.removeAllRanges();
    selection.addRange(assistantRange);
    document.getElementById('assistant-text').dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true }),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const assistantFallbackOpened = Boolean(document.getElementById('highlight-and-react-bar'));
    return {
      openedByDoubleClick,
      dismissedOutside,
      openedByShortcut,
      reaction,
      closedAfterReaction,
      assistantFallbackOpened,
    };
  })()`);

  assert.deepEqual(result, {
    openedByDoubleClick: true,
    dismissedOutside: true,
    openedByShortcut: true,
    reaction: '❤️',
    closedAfterReaction: true,
    assistantFallbackOpened: true,
  });
});
