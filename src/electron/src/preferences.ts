import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export interface FeaturePreferences {
  notch_enabled: boolean;
  codex_enabled: boolean;
  component_reactions_enabled: boolean;
  emoji_recents: string[];
}

const DEFAULTS: FeaturePreferences = {
  notch_enabled: false,
  codex_enabled: false,
  component_reactions_enabled: false,
  emoji_recents: [],
};

const MAX_EMOJI_RECENTS = 5;

export class Preferences {
  private readonly file: string;

  constructor(file = path.join(app.getPath("userData"), "preferences.json")) {
    this.file = file;
  }

  read(): FeaturePreferences {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object") return { ...DEFAULTS };
      const value = parsed as Partial<FeaturePreferences>;
      if (
        typeof value.notch_enabled !== "boolean" ||
        typeof value.codex_enabled !== "boolean" ||
        (value.component_reactions_enabled !== undefined &&
          typeof value.component_reactions_enabled !== "boolean") ||
        (value.emoji_recents !== undefined &&
          !Array.isArray(value.emoji_recents)) ||
        (Array.isArray(value.emoji_recents) &&
          value.emoji_recents.some(
            (emoji) => typeof emoji !== "string" || emoji.length > 32,
          ))
      ) {
        return { ...DEFAULTS };
      }
      return {
        notch_enabled: value.notch_enabled,
        codex_enabled: value.codex_enabled,
        component_reactions_enabled: value.component_reactions_enabled ?? false,
        emoji_recents: (value.emoji_recents ?? []).slice(0, MAX_EMOJI_RECENTS),
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  write(value: FeaturePreferences): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(
      temporary,
      JSON.stringify({
        notch_enabled: value.notch_enabled,
        codex_enabled: value.codex_enabled,
        component_reactions_enabled: value.component_reactions_enabled,
        emoji_recents: value.emoji_recents.slice(0, MAX_EMOJI_RECENTS),
      }),
      { mode: 0o600 },
    );
    fs.renameSync(temporary, this.file);
  }
}
