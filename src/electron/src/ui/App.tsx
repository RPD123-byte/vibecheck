import { useEffect, useState } from "react";
import type { PublicState } from "../protocol";

const EMPTY: PublicState = {
  aggregate: "off",
  features: {
    revision: 0,
    notch_enabled: false,
    integrations: { codex_enabled: false },
    paused: false,
  },
  camera: "off",
  canRecover: false,
};

const STATUS: Record<PublicState["aggregate"], [string, string]> = {
  off: ["Off", "Nothing is watching right now."],
  starting: ["Warming up", "Getting the on-device model ready."],
  active: ["Active", "Reading expressions on this Mac."],
  paused: ["Paused", "Your settings are saved for this session."],
  needs_permission: [
    "Camera needed",
    "Allow camera access in System Settings.",
  ],
  degraded: ["Partly active", "One feature needs a quick recovery."],
  failed: ["Needs attention", "Vibecheck could not start a feature."],
};

export function App(): React.JSX.Element {
  const [state, setState] = useState<PublicState>(EMPTY);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.vibecheck.state().then(setState);
    return window.vibecheck.onState(setState);
  }, []);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") window.vibecheck.dismiss();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);

  async function act(name: string, action: () => Promise<void>): Promise<void> {
    setPending(name);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That did not work.");
    } finally {
      setPending(null);
    }
  }

  const [title, detail] = STATUS[state.aggregate];
  const enabled =
    state.features.notch_enabled || state.features.integrations.codex_enabled;

  return (
    <main className="shell">
      <header>
        <div className={`orb orb--${state.aggregate}`} aria-hidden="true" />
        <div>
          <h1>Vibecheck</h1>
          <p className="status">
            <strong>{title}</strong> · {detail}
          </p>
        </div>
      </header>

      <section className="controls" aria-label="Vibecheck features">
        <Toggle
          label="Show notch"
          detail="A small expression cue beside the camera."
          checked={state.features.notch_enabled}
          disabled={pending !== null}
          onChange={(checked) =>
            void act("notch", () =>
              window.vibecheck.setFeature("notch", checked),
            )
          }
        />
        <Toggle
          label="Codex interruption"
          detail="Share sustained negative expressions with an active turn."
          checked={state.features.integrations.codex_enabled}
          disabled={pending !== null}
          onChange={(checked) =>
            void act("codex", () =>
              window.vibecheck.setFeature("codex", checked),
            )
          }
        />
      </section>

      {error && <p className="error">{error}</p>}

      <footer>
        <button
          className="button button--primary"
          disabled={!enabled || pending !== null}
          onClick={() =>
            void act("pause", () =>
              window.vibecheck.setPaused(!state.features.paused),
            )
          }
        >
          {state.features.paused ? "Resume" : "Pause"}
        </button>
        {state.canRecover && (
          <button
            className="button"
            disabled={pending !== null}
            onClick={() => void act("recover", window.vibecheck.recover)}
          >
            Try again
          </button>
        )}
        <button className="quit" onClick={() => void window.vibecheck.quit()}>
          Quit
        </button>
      </footer>
    </main>
  );
}

interface ToggleProps {
  label: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

function Toggle({
  label,
  detail,
  checked,
  disabled,
  onChange,
}: ToggleProps): React.JSX.Element {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <input
        aria-label={label}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}
