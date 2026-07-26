import { spawn } from 'node:child_process';

function runProcess(executable, arguments_, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

export async function copyToClipboard(text) {
  const result = await runProcess('/usr/bin/pbcopy', [], text);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `pbcopy exited with ${result.code}`);
  }
  return { status: 'copied' };
}

export async function runContextBridge(text, bridgePath) {
  if (!bridgePath) throw new Error('Codex context bridge path is missing');
  const result = await runProcess(bridgePath, [], text);
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim()
      || result.stdout.trim()
      || `context bridge exited with ${result.code}`,
    );
  }
  const lastLine = result.stdout.trim().split('\n').filter(Boolean).at(-1);
  if (!lastLine) throw new Error('context bridge returned no result');
  return JSON.parse(lastLine);
}

export async function deliverContextEvent(event, options = {}) {
  const {
    mode = 'clipboard',
    bridgePath,
    copy = copyToClipboard,
    bridge = runContextBridge,
  } = options;
  if (!event || typeof event.clipboardText !== 'string' || !event.clipboardText.trim()) {
    return {
      eventId: event?.id || null,
      clipboard: { status: 'rejected', error: 'context text is missing' },
      codex: { status: 'skipped' },
    };
  }
  if (mode === 'off') {
    return {
      eventId: event.id || null,
      clipboard: { status: 'skipped' },
      codex: { status: 'skipped' },
    };
  }

  let clipboard;
  try {
    clipboard = await copy(event.clipboardText);
  } catch (error) {
    clipboard = {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  let codex = { status: 'skipped' };
  if (mode === 'codex') {
    try {
      codex = await bridge(event.agentMessage || event.clipboardText, bridgePath);
    } catch (error) {
      codex = {
        status: 'bridge_failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return {
    eventId: event.id || null,
    clipboard,
    codex,
  };
}
