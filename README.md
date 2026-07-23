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

> [!IMPORTANT]
> Vibecheck currently runs from source. It is not yet packaged as a signed macOS
> app or installer.

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

## Requirements

Before installing Vibecheck, you need:

- macOS
- A Mac with a built-in display notch for the visual overlay
- Python 3.11 or newer
- Rust 1.91 or newer
- Git
- Xcode Command Line Tools
- The Codex desktop app for live interruption
- Internet access during installation and the first model load

## Installation

### 1. Install the Xcode Command Line Tools

```bash
xcode-select --install
```

If they are already installed, macOS will tell you.

### 2. Check Python

```bash
python3 --version
```

Install Python 3.11 or newer if the command is missing or reports an older
version.

### 3. Install Rust

Install Rust using [rustup](https://rustup.rs/), then run:

```bash
rustup toolchain install 1.91.1 --profile minimal --component clippy,rustfmt
rustup default 1.91.1
rustc --version
```

### 4. Clone Vibecheck

```bash
git clone https://github.com/RPD123-byte/vibecheck.git
cd vibecheck
```

### 5. Create a Python environment

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e '.[inference,macos]'
```

The inference dependencies are fairly large and may take several minutes to
install.

### 6. Build the interruption component

```bash
cargo build \
  --locked \
  --release \
  --manifest-path src/native/expression_interruption/Cargo.toml
```

You only need to repeat this after the Rust code changes.

## First run

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

Enable access for the terminal or Python host used to launch Vibecheck, then
restart the command.

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

### Adjust the expression threshold

```bash
vibecheck \
  --mode dry-run \
  --threshold 0.25 \
  --no-manage-codex-gui
```

The default threshold is `0.30`. Lower values make expressions appear more
easily but may increase false detections. The same threshold is used for notch
entry and negative-expression interruption eligibility.

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
- The strongest non-neutral expression must exceed the threshold.
- A new expression must be detected consistently before it appears.
- Only one expression is shown at a time.

Try dry-run mode with a lower threshold while tuning:

```bash
vibecheck \
  --mode dry-run \
  --threshold 0.25 \
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

From the repository:

```bash
git pull --ff-only
source .venv/bin/activate
python -m pip install -e '.[inference,macos]'
cargo build \
  --locked \
  --release \
  --manifest-path src/native/expression_interruption/Cargo.toml
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

The supported app lives under `src/`. The ignored `experimentation/` directory
contains historical prototypes and is not used by the production runtime.
