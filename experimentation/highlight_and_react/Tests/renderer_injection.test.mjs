import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import {
  inject,
  loadSystemTapbackAssets,
  splitWorkspaceSource,
} from '../scripts/devtools_injector.mjs';

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
  assert.match(parts.script, /onKeydown/);
  assert.doesNotMatch(parts.script, /dblclick|onDoubleClick/);
});

test('interactive launcher discovers Electron from the renamed main checkout', () => {
  const electron = execFileSync(fixtureLauncher, ['--print-electron-path'], {
    cwd: projectDirectory,
    encoding: 'utf8',
  }).trim();
  assert.ok(existsSync(electron), `Electron path does not exist: ${electron}`);
  assert.doesNotMatch(electron, /\/Users\/computer\/uncover\//);
});

test('installed Messages Tapback vectors are available to the injector', async () => {
  const assets = await loadSystemTapbackAssets();
  assert.deepEqual(Object.keys(assets).sort(), [
    'exclamation',
    'haha',
    'heart',
    'question',
    'thumbs-down',
    'thumbs-up',
  ]);
  for (const dataUrl of Object.values(assets)) {
    assert.match(dataUrl, /^data:image\/png;base64,/);
  }
});

test('injected renderer matches compact and expanded Tapback behavior', async (context) => {
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
    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: '®',
      code: 'KeyR',
      ctrlKey: true,
      altKey: true,
    }));
    const message = document.querySelector('[data-user-message-bubble]');
    window.__reactionActions = [];
    message.addEventListener('highlight-and-react', (event) => {
      window.__reactionActions.push(event.detail.action);
    });
    const openedByShortcutInitially = Boolean(
      document.getElementById('highlight-and-react-bar')
      && CSS.highlights.has('highlight-and-react-selection'),
    );
    const compactButtons = document.querySelectorAll('#highlight-and-react-strip button').length;
    const systemTapbackIcons = document.querySelectorAll(
      '#highlight-and-react-strip .tapback-system-icon',
    ).length;
    const hasCustomEmojiButton = Boolean(document.getElementById('highlight-and-react-more'));
    const hasScrim = Boolean(document.getElementById('highlight-and-react-scrim'));
    const textHasElementOverlay = Boolean(
      document.getElementById('highlight-and-react-element-overlay'),
    );
    const compactHeight = getComputedStyle(
      document.getElementById('highlight-and-react-strip'),
    ).height;
    const compactGap = getComputedStyle(
      document.getElementById('highlight-and-react-strip'),
    ).gap;
    const stripBounds = document.getElementById('highlight-and-react-strip')
      .getBoundingClientRect();
    const moreBounds = document.getElementById('highlight-and-react-more')
      .getBoundingClientRect();
    const customEmojiAtEnd = moreBounds.left >= stripBounds.right;
    const customEmojiButtonSize = [
      getComputedStyle(document.getElementById('highlight-and-react-more')).width,
      getComputedStyle(document.getElementById('highlight-and-react-more')).height,
    ];

    document.getElementById('outside').dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }),
    );
    const dismissedOutside = !document.getElementById('highlight-and-react-bar')
      && !CSS.highlights.has('highlight-and-react-selection')
      && !document.getElementById('highlight-and-react-scrim');

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
    document.querySelector('[data-reaction-key="standard:heart"]').click();
    const addedReaction = message.dataset.highlightAndReactReaction;
    const addedReactionKey = message.dataset.highlightAndReactReactionKey;
    const addedReactionAsset = message.dataset.highlightAndReactReactionAsset;
    const closedAfterReaction = !document.getElementById('highlight-and-react-bar');

    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: '®',
      code: 'KeyR',
      ctrlKey: true,
      altKey: true,
    }));
    const selectedHeart = document.querySelector(
      '[data-reaction-key="standard:heart"]',
    )?.getAttribute('aria-pressed');
    document.querySelector('[data-reaction-key="standard:heart"]').click();
    const removedReaction = !message.dataset.highlightAndReactReaction
      && !message.dataset.highlightAndReactReactionKey;

    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: '®',
      code: 'KeyR',
      ctrlKey: true,
      altKey: true,
    }));
    document.getElementById('highlight-and-react-more').click();
    const expandedPicker = Boolean(
      document.getElementById('highlight-and-react-emoji-picker')
      && document.getElementById('highlight-and-react-bar').dataset.expanded === 'true',
    );
    const emojiChoices = document.querySelectorAll(
      '#highlight-and-react-emoji-picker .highlight-and-react-emoji-grid button',
    ).length;
    const nativePickerFurniture = Boolean(
      document.getElementById('highlight-and-react-emoji-search')
      && document.querySelectorAll('#highlight-and-react-picker-categories button').length === 9,
    );
    document.querySelector(
      '#highlight-and-react-emoji-picker [data-reaction-key="emoji:😂"]',
    ).click();
    const customReaction = message.dataset.highlightAndReactReaction;
    const customReactionKey = message.dataset.highlightAndReactReactionKey;
    const closedAfterCustomReaction = !document.getElementById('highlight-and-react-bar')
      && !document.getElementById('highlight-and-react-emoji-picker');

    const assistantText = document.getElementById('assistant-text').firstChild;
    const assistantRange = document.createRange();
    assistantRange.setStart(assistantText, 0);
    assistantRange.setEnd(assistantText, 9);
    selection.removeAllRanges();
    selection.addRange(assistantRange);
    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: '®',
      code: 'KeyR',
      ctrlKey: true,
      altKey: true,
    }));
    const assistantFallbackOpened = Boolean(document.getElementById('highlight-and-react-bar'));

    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: 'Escape',
      code: 'Escape',
    }));
    selection.removeAllRanges();
    const elementTarget = document.getElementById('fixture-element-target');
    window.__elementTargetEvents = [];
    window.__elementTargetActivations = 0;
    elementTarget.addEventListener('click', () => {
      window.__elementTargetActivations += 1;
    });
    elementTarget.addEventListener('highlight-and-react-targeted', (event) => {
      window.__elementTargetEvents.push(event.detail.targetType);
    });
    elementTarget.addEventListener('highlight-and-react', (event) => {
      window.__elementTargetEvents.push(event.detail.targetType);
    });
    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: '®',
      code: 'KeyR',
      ctrlKey: true,
      altKey: true,
    }));
    const elementPickingStarted = Boolean(
      document.documentElement.dataset.highlightAndReactPicking
      && document.getElementById('highlight-and-react-element-hint'),
    );
    const elementBounds = elementTarget.getBoundingClientRect();
    const elementPoint = {
      x: elementBounds.right - 16,
      y: elementBounds.top + elementBounds.height / 2,
    };
    elementTarget.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      clientX: elementPoint.x,
      clientY: elementPoint.y,
    }));
    const elementHovered = document.getElementById(
      'highlight-and-react-element-overlay',
    )?.dataset.state === 'hover';
    elementTarget.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: elementPoint.x,
      clientY: elementPoint.y,
    }));
    elementTarget.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: elementPoint.x,
      clientY: elementPoint.y,
    }));
    const elementLocked = Boolean(
      document.getElementById('highlight-and-react-bar')
      && document.getElementById('highlight-and-react-scrim')
      && document.getElementById('highlight-and-react-element-overlay')?.dataset.state === 'locked'
      && getComputedStyle(
        document.getElementById('highlight-and-react-element-label'),
      ).display === 'none'
      && !CSS.highlights.has('highlight-and-react-selection'),
    );
    document.querySelector('[data-reaction-key="standard:thumbs-up"]').click();
    const elementReaction = elementTarget.dataset.highlightAndReactReactionKey;
    const elementClosedAfterReaction = !document.getElementById(
      'highlight-and-react-element-overlay',
    ) && !document.getElementById('highlight-and-react-bar');

    return {
      openedByShortcutInitially,
      compactButtons,
      systemTapbackIcons,
      hasCustomEmojiButton,
      hasScrim,
      textHasElementOverlay,
      compactHeight,
      compactGap,
      customEmojiAtEnd,
      customEmojiButtonSize,
      dismissedOutside,
      openedByShortcut,
      addedReaction,
      addedReactionKey,
      addedReactionAsset,
      closedAfterReaction,
      selectedHeart,
      removedReaction,
      expandedPicker,
      fullEmojiCatalog: emojiChoices >= 300,
      nativePickerFurniture,
      customReaction,
      customReactionKey,
      closedAfterCustomReaction,
      reactionActions: window.__reactionActions,
      assistantFallbackOpened,
      elementPickingStarted,
      elementHovered,
      elementLocked,
      elementReaction,
      elementClosedAfterReaction,
      elementTargetEvents: window.__elementTargetEvents,
      elementTargetActivations: window.__elementTargetActivations,
    };
  })()`);

  assert.deepEqual(result, {
    openedByShortcutInitially: true,
    compactButtons: 8,
    systemTapbackIcons: 6,
    hasCustomEmojiButton: true,
    hasScrim: false,
    textHasElementOverlay: false,
    compactHeight: '36px',
    compactGap: '4px',
    customEmojiAtEnd: true,
    customEmojiButtonSize: ['38px', '38px'],
    dismissedOutside: true,
    openedByShortcut: true,
    addedReaction: '🩷',
    addedReactionKey: 'standard:heart',
    addedReactionAsset: 'heart',
    closedAfterReaction: true,
    selectedHeart: 'true',
    removedReaction: true,
    expandedPicker: true,
    fullEmojiCatalog: true,
    nativePickerFurniture: true,
    customReaction: '😂',
    customReactionKey: 'emoji:😂',
    closedAfterCustomReaction: true,
    reactionActions: ['add', 'remove', 'add'],
    assistantFallbackOpened: true,
    elementPickingStarted: true,
    elementHovered: true,
    elementLocked: true,
    elementReaction: 'standard:thumbs-up',
    elementClosedAfterReaction: true,
    elementTargetEvents: ['element', 'element'],
    elementTargetActivations: 0,
  });
});
