import type { MenuItemConstructorOptions } from "electron";
import type { PublicState } from "./protocol";

export interface MenuActions {
  setNotch(enabled: boolean): Promise<void>;
  setCodex(enabled: boolean): Promise<void>;
  setComponentReactions(enabled: boolean): Promise<void>;
  openChromeSetup(): Promise<void>;
  openSafariSetup(): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  recover(): Promise<void>;
  quit(): void;
}

export interface MenuBuildOptions {
  pending?: boolean;
  error?: string | null;
}

const aggregateLabels: Record<PublicState["aggregate"], string> = {
  off: "Off",
  starting: "Starting",
  active: "Active",
  paused: "Paused",
  needs_permission: "Needs Camera Permission",
  degraded: "Degraded",
  failed: "Failed",
};

const cameraLabels: Record<PublicState["camera"], string> = {
  off: "Off",
  starting: "Starting",
  active: "Active on this Mac",
  needs_permission: "Permission needed",
};

export function buildMenuTemplate(
  state: PublicState,
  actions: MenuActions,
  options: MenuBuildOptions = {},
): MenuItemConstructorOptions[] {
  const pending = options.pending ?? false;
  const enabledFeature =
    state.features.notch_enabled ||
    state.features.integrations.codex_enabled ||
    state.features.component_reactions_enabled;
  const template: MenuItemConstructorOptions[] = [
    {
      id: "status",
      label: `Vibecheck — ${aggregateLabels[state.aggregate]}`,
      enabled: false,
    },
    {
      id: "camera",
      label: `Camera: ${cameraLabels[state.camera]}`,
      enabled: false,
    },
  ];
  if (options.error) {
    template.push({
      id: "error",
      label: `Couldn’t update: ${shorten(options.error, 72)}`,
      enabled: false,
    });
  }
  template.push(
    { type: "separator" },
    {
      id: "notch",
      label: "Show notch",
      type: "checkbox",
      checked: state.features.notch_enabled,
      enabled: !pending,
      click: (item) => void actions.setNotch(item.checked),
    },
    {
      id: "codex",
      label: "Codex interruption",
      type: "checkbox",
      checked: state.features.integrations.codex_enabled,
      enabled: !pending,
      click: (item) => void actions.setCodex(item.checked),
    },
    {
      id: "component-reactions",
      label: `Component reactions — ${componentLabel(state)}`,
      type: "checkbox",
      checked: state.features.component_reactions_enabled,
      enabled: !pending,
      click: (item) => void actions.setComponentReactions(item.checked),
    },
    {
      id: "component-reactions-chrome-setup",
      label: "Set up reactions in Chrome…",
      enabled: !pending,
      click: () => void actions.openChromeSetup(),
    },
    {
      id: "component-reactions-safari-setup",
      label: "Set up reactions in Safari…",
      enabled: !pending,
      click: () => void actions.openSafariSetup(),
    },
    { type: "separator" },
    {
      id: "pause",
      label: state.features.paused ? "Resume Vibecheck" : "Pause Vibecheck",
      enabled: enabledFeature && !pending,
      click: () => void actions.setPaused(!state.features.paused),
    },
  );
  if (state.canRecover) {
    template.push({
      id: "recover",
      label: "Try Again",
      enabled: !pending,
      click: () => void actions.recover(),
    });
  }
  template.push(
    { type: "separator" },
    {
      id: "quit",
      label: "Quit Vibecheck",
      accelerator: "Command+Q",
      click: () => actions.quit(),
    },
  );
  return template;
}

export interface MenuProjectionItem {
  id: string | null;
  label: string | null;
  type: string;
  checked: boolean | null;
  enabled: boolean;
}

export function menuProjection(
  template: MenuItemConstructorOptions[],
): MenuProjectionItem[] {
  return template.map((item) => ({
    id: item.id ?? null,
    label: item.label ?? null,
    type: item.type ?? "normal",
    checked: item.type === "checkbox" ? (item.checked ?? false) : null,
    enabled: item.enabled ?? true,
  }));
}

function shorten(value: string, maximum: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maximum
    ? compact
    : `${compact.slice(0, maximum - 1)}…`;
}

function componentLabel(state: PublicState): string {
  const component = state.componentReactions;
  const attached =
    component.attached_targets + (component.attached_browser_tabs ?? 0);
  const permissionLabel = component.last_error?.includes("Input Monitoring")
    ? "Needs Input Monitoring"
    : "Needs Accessibility";
  const labels: Record<typeof component.health, string> = {
    off: "Off",
    starting: "Starting",
    active: attached > 0 ? `Active · ${attached} attached` : "Active",
    paused: "Paused",
    needs_permission: permissionLabel,
    degraded: "Degraded",
    failed: "Failed",
  };
  return labels[component.health];
}
