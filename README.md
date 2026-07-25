# Vibecheck

Vibecheck gives the Codex desktop app limited nonverbal context from your facial
expression.

It runs facial-expression detection locally, shows the strongest current
expression beside the MacBook notch, and can interrupt an active Codex response
when a negative expression has been held long enough. Codex then continues the
same task with a short note such as:

> Nonverbal context update: the user appears sad (mild; 35%). This was inferred
> from their facial expression and may be imperfect. Continue the existing task
> with this context in mind.

The goal is to help Codex notice reactions that are normally lost in a text-only
conversation without recording or uploading camera footage.

> [!NOTE]
> Vibecheck currently ships for Apple-silicon Macs. The downloadable app is
> signed with Developer ID and notarized by Apple.

## Current behavior

- Facial-expression detection runs on your Mac.
- The notch shows only the strongest non-neutral expression.
- Neutral does not show an emoji.
- Happiness and surprise may appear in the notch but never interrupt Codex.
- Only anger, contempt, disgust, fear, and sadness can trigger an interruption.
- A negative expression must remain above the threshold for one second.
- Vibecheck acts once per expression episode rather than repeatedly interrupting.
- Camera frames and face crops are not saved or sent through the local event
  stream.

Expression detection is probabilistic and may be wrong. The message sent to
Codex explicitly describes the result as an imperfect inference.

## Download and install

1. Download
   [Vibecheck v0.2.1 for Apple silicon](https://github.com/RPD123-byte/vibecheck/releases/download/v0.2.1/Vibecheck-darwin-arm64-0.2.1.zip).
2. Double-click the ZIP to extract `Vibecheck.app`.
3. Move `Vibecheck.app` to your **Applications** folder.
4. Open Vibecheck from Applications.
5. Click the Vibecheck icon in the macOS menu bar and enable **Show notch**,
   **Codex interruption**, or both.
6. Approve camera access when macOS asks.

Requirements:

- macOS
- An Apple-silicon Mac
- A Mac with a built-in display notch for the visual overlay
- The Codex desktop app for live interruption

Vibecheck is a menu-bar utility. It does not open a normal app window or show a
Dock icon.

## Run from source

Source development additionally requires Python 3.11, Rust 1.91 or newer,
Node.js 24, Git, Xcode Command Line Tools, and internet access during setup.

```bash
git clone https://github.com/RPD123-byte/vibecheck.git
cd vibecheck
./setup.sh
```

The script creates `.venv`, installs the Python dependencies, and builds the
Rust interruption component. Inference dependencies are large, so initial setup
may take several minutes. Then install the menu-bar dependencies:

```bash
npm ci
```

## First run

If you installed the downloadable app, open it from Applications and use its
menu-bar icon.

To start the app from source:

```bash
npm run app:dev
```

Vibecheck appears only in the macOS menu bar; it does not open a Dock icon or
ordinary app window. Click its icon to open the controls. Both **Show notch**
and **Codex interruption** are off on first launch. Enabling either feature
starts camera inference, and disabling the final active feature releases the
camera while leaving the small controller process ready.

Use **Pause** to stop all feature workers without changing the two toggles.
Pause is not restored after the app restarts. Quit from the native menu to stop
every Vibecheck-owned process without quitting Codex.

The command-line modes below remain supported for diagnostics and as a rollback
path.

### Test the installation without using the camera or changing Codex

```bash
source .venv/bin/activate
vibecheck \
  --mode demo \
  --no-manage-codex-gui
```

Demo mode cycles through synthetic expressions. It exercises the real notch and
decision logic but cannot interrupt Codex.

Press `Ctrl-C` to stop.

If your current display does not support the notch overlay, use:

```bash
vibecheck \
  --mode demo \
  --headless-notch \
  --no-manage-codex-gui
```

This prints the current state in the terminal instead.

### Test your camera without changing Codex

```bash
vibecheck \
  --mode dry-run \
  --no-manage-codex-gui
```

On the first camera-backed run, macOS should ask for camera access. The first
model-backed run may also download model weights into `~/.emotiefflib`.

Dry-run mode uses the real camera and model but only reports what it would have
sent to Codex.

## Camera permission

If camera access is denied or the prompt does not appear, open:

**System Settings → Privacy & Security → Camera**

Enable access for **Vibecheck**. If you are running from source, enable access
for the terminal or Python host instead. Then restart Vibecheck.

Do not run the historical experiment and the production app at the same time.
Two processes competing for the camera can cause failures or delayed frames.

## Normal use

### Show expressions without interrupting Codex

```bash
source .venv/bin/activate
vibecheck --mode display-only
```

This starts camera inference and the notch display only.

### Run the complete app

Open the Codex desktop app, then run:

```bash
source .venv/bin/activate
vibecheck --mode normal
```

Normal mode enables both the notch and live Codex interruption.

By default, Vibecheck may gracefully relaunch the Codex desktop app once during
startup so it can connect to Codex control. Stopping Vibecheck does not quit or
relaunch Codex.

If Codex control is already being managed elsewhere, run:

```bash
vibecheck \
  --mode normal \
  --no-manage-codex-gui
```

Press `Ctrl-C` to stop Vibecheck. Its camera, notch, and interruption processes
will exit while the Codex desktop app remains running.

## When interruption can happen

An interruption occurs only when:

1. anger, contempt, disgust, fear, or sadness is detected above the configured
   threshold;
2. the detected negative expression remains stable for the full hold time;
3. a Codex response is currently running; and
4. Vibecheck can identify exactly one active Codex task.

If multiple Codex tasks are generating at once, Vibecheck refuses to guess which
one to interrupt.

You can target a known task explicitly:

```bash
vibecheck \
  --mode normal \
  --thread-id YOUR_CODEX_THREAD_ID
```

## Runtime modes

| Mode | Purpose | Can change Codex? |
| --- | --- | --- |
| `demo` | Test installation using synthetic expressions | No |
| `dry-run` | Test the real camera and decision logic | No |
| `display-only` | Use the camera and notch without interruption | No |
| `normal` | Run the complete app | Yes |

## Useful options

### Choose a different camera

```bash
vibecheck --mode dry-run --camera 1 --no-manage-codex-gui
```

The default camera index is `0`.

### Adjust notch expression thresholds

```bash
vibecheck \
  --mode dry-run \
  --threshold 0.55 \
  --surprise-threshold 0.35 \
  --no-manage-codex-gui
```

The notch first finds the strongest non-neutral expression. Surprise must be
above `0.30` to appear; every other expression must be above `0.50`. The
`--surprise-threshold` option changes the surprise threshold, while
`--threshold` changes the threshold for all other expressions. Lower values
make an expression appear more easily but may increase false detections.

The interruption threshold is independent and remains `0.30` by default. To
change it:

```bash
vibecheck \
  --mode dry-run \
  --interruption-threshold 0.40 \
  --no-manage-codex-gui
```

### Adjust the negative-expression hold

```bash
vibecheck \
  --mode normal \
  --hold-seconds 1.5
```

The default hold is one second. A longer hold makes interruption more
conservative.

### Test saved images

```bash
vibecheck \
  --mode dry-run \
  --image /absolute/path/to/face.jpg \
  --headless-notch \
  --no-manage-codex-gui
```

`--image` can be supplied more than once.

### View every available option

```bash
vibecheck --help
```

## Troubleshooting

### `vibecheck: command not found`

Activate the environment:

```bash
source .venv/bin/activate
```

Or use:

```bash
.venv/bin/vibecheck --mode demo --no-manage-codex-gui
```

### `Camera denied` or `Allow camera access`

Enable camera access under **System Settings → Privacy & Security → Camera**,
then restart Vibecheck.

### `Camera unavailable`

- Close other apps using the camera.
- Confirm the correct `--camera` index.
- Make sure an experiment process is not already using the camera.

### `Display unsupported`

The visual overlay requires a usable MacBook notch. Add `--headless-notch` to
print state in the terminal.

### No expression appears

- Neutral is intentionally hidden.
- The strongest non-neutral expression must exceed its threshold: `0.30` for
  surprise and `0.50` for every other expression by default.
- A new expression must be detected consistently before it appears.
- Only one expression is shown at a time.

Try dry-run mode with lower thresholds while tuning:

```bash
vibecheck \
  --mode dry-run \
  --threshold 0.40 \
  --surprise-threshold 0.25 \
  --no-manage-codex-gui
```

### The notch works but Codex is not interrupted

- Confirm you are using `--mode normal`.
- Only negative expressions can interrupt.
- Hold the expression for at least the configured hold time.
- Make sure a Codex response is actively running.
- Avoid running multiple Codex responses simultaneously.
- If using `--no-manage-codex-gui`, make sure Codex control is already
  available.

The terminal output may report `no_active_turn`, `multiple_active_turns`,
`interrupt_failed`, or `restart_failed`.

## Updating

Download the newest build from the
[releases page](https://github.com/RPD123-byte/vibecheck/releases).

When running from source:

```bash
git pull --ff-only
./setup.sh
```

## Development checks

Install the test tools:

```bash
source .venv/bin/activate
python -m pip install -e '.[inference,macos,test]'
```

Run the default Python tests:

```bash
source .venv/bin/activate
ruff check src tests
ruff format --check src tests
pytest
```

Run the Rust checks:

```bash
cargo fmt \
  --manifest-path src/native/expression_interruption/Cargo.toml \
  -- --check
cargo clippy \
  --manifest-path src/native/expression_interruption/Cargo.toml \
  --all-targets \
  -- -D warnings
cargo test \
  --manifest-path src/native/expression_interruption/Cargo.toml
```

Run the Electron checks:

```bash
npm run js:format:check
npm run js:typecheck
npm run js:test
npm run js:audit
```

Create an unsigned arm64 local app bundle:

```bash
scripts/build_runtime.sh
npm run app:package
```

See [docs/macos-release.md](docs/macos-release.md) for the protected Developer
ID, permission, notarization, DMG, and clean-install release process.

The supported app lives under `src/`. The ignored `experimentation/` directory
contains historical prototypes and is not used by the production runtime.
