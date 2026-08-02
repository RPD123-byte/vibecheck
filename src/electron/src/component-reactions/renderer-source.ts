import rendererCss from "./renderer-style.css?raw";

export function componentRendererSource(): string {
  return `;(${rendererBootstrap.toString()})(${JSON.stringify(rendererCss)});`;
}

/**
 * This function is stringified and evaluated in attached target renderers.
 * Keep it self-contained: production CDP installation supplies no module scope.
 */
export function rendererBootstrap(cssText = ""): void {
  type Bounds = {
    x: number;
    y: number;
    width: number;
    height: number;
    device_scale_factor: number;
  };
  type TapbackAssetKey =
    "heart" | "thumbs-up" | "thumbs-down" | "haha" | "exclamation" | "question";
  type TapbackAssetMap = Partial<Record<TapbackAssetKey, string>>;
  type LockedTarget = {
    kind: "text" | "element" | "paper";
    copyText(): string;
    bounds(): DOMRect | null;
    anchor(): DOMRect | null;
  };
  type HostWindow = Window & {
    __vibecheckComponentCommit?: (payload: string) => void;
    __vibecheckComponentReactions?: {
      install(): void;
      setEnabled(
        value: boolean,
        recents?: string[],
        tapbackAssets?: TapbackAssetMap,
      ): void;
      setCaptureSession(sessionId: string | null): void;
      settle(eventId: string, outcome: string): void;
      dispose(): void;
      documentId: string;
    };
    __paperVibecheckAdapter?: {
      hitTest(
        x: number,
        y: number,
      ): {
        label?: string;
        bounds?: { x: number; y: number; width: number; height: number };
      } | null;
    };
  };
  type PaperNode = {
    id?: unknown;
    bounds?: unknown;
    label?: unknown;
    name?: unknown;
    text?: unknown;
    component?: unknown;
  };
  type PaperEditorState = {
    cameraState: {
      viewportToWorld(
        point: { x: number; y: number },
        precise: boolean,
      ): unknown;
      worldToViewportRect(bounds: unknown): unknown;
    };
    pointerState: {
      includeLockedNodesInHover?: boolean;
      calculateNodeAtPoint(
        point: unknown,
        includeLocked?: boolean,
      ): { node?: PaperNode; deepestNode?: PaperNode } | null;
    };
  };

  const host = window as HostWindow;
  if (host.__vibecheckComponentReactions) return;
  const documentId = crypto.randomUUID();
  const fixedReactions = [
    ["❤️", "Love"],
    ["👍", "Approve"],
    ["👎", "Disapprove"],
    ["😂", "Funny"],
    ["‼️", "Emphasize"],
    ["❓", "Question"],
  ] as const;
  const emojiGroups: Record<string, string[]> = {
    "Smileys & People": [
      "😀",
      "😃",
      "😄",
      "😁",
      "😆",
      "🥹",
      "😅",
      "😂",
      "🙂",
      "🙃",
      "😉",
      "😊",
      "🥰",
      "😍",
      "🤩",
      "😘",
      "🤔",
      "🫡",
      "🤨",
      "😐",
      "😑",
      "😶",
      "😏",
      "😒",
      "🙄",
      "😬",
      "😮",
      "😲",
      "🥳",
      "😎",
      "👍",
      "👎",
      "👏",
      "🙌",
      "🫶",
      "🤝",
      "🙏",
      "💪",
      "👌",
      "🤌",
      "🤏",
      "✌️",
      "🤞",
      "🫰",
      "🤟",
      "🤘",
      "👈",
      "👉",
      "👆",
      "👇",
    ],
    "Animals & Nature": [
      "🐶",
      "🐱",
      "🐭",
      "🐹",
      "🐰",
      "🦊",
      "🐻",
      "🐼",
      "🐨",
      "🐯",
      "🦁",
      "🐮",
      "🐷",
      "🐸",
      "🐵",
      "🐔",
      "🐧",
      "🐦",
      "🦋",
      "🌸",
      "🌱",
      "🌈",
      "☀️",
      "🌙",
    ],
    "Food & Drink": [
      "🍎",
      "🍊",
      "🍋",
      "🍉",
      "🍇",
      "🍓",
      "🍒",
      "🥑",
      "🍕",
      "🍔",
      "🌮",
      "🍣",
      "🍜",
      "🍪",
      "🍩",
      "🎂",
      "☕",
      "🍵",
      "🥂",
      "🍻",
    ],
    Activities: [
      "⚽",
      "🏀",
      "🏈",
      "⚾",
      "🎾",
      "🏐",
      "🎱",
      "🏓",
      "🎮",
      "🎲",
      "🎨",
      "🎭",
      "🎤",
      "🎧",
      "🎸",
      "🏅",
      "🏆",
      "🎯",
      "🎉",
      "✨",
    ],
    "Travel & Places": [
      "🚗",
      "🚕",
      "🚌",
      "🚲",
      "✈️",
      "🚀",
      "🚁",
      "⛵",
      "🚆",
      "🏠",
      "🏢",
      "🏖️",
      "🏕️",
      "🗻",
      "🌋",
      "🗽",
      "🌉",
      "🌍",
      "🧭",
      "🗺️",
    ],
    Objects: [
      "⌚",
      "📱",
      "💻",
      "⌨️",
      "🖥️",
      "📷",
      "💡",
      "🔦",
      "📚",
      "📝",
      "📌",
      "📎",
      "🔍",
      "🔐",
      "🔑",
      "🛠️",
      "🧪",
      "🧹",
      "🎁",
      "🪄",
    ],
    Symbols: [
      "❤️",
      "🧡",
      "💛",
      "💚",
      "💙",
      "💜",
      "🖤",
      "🤍",
      "💯",
      "💥",
      "✨",
      "🔥",
      "🎉",
      "✅",
      "❌",
      "⚠️",
      "‼️",
      "❓",
      "💡",
      "🎯",
      "🚀",
      "🧭",
      "🛠️",
      "🧪",
      "🔍",
      "📌",
      "⭐",
      "🏆",
      "🔄",
      "🧹",
    ],
    Flags: [
      "🏁",
      "🚩",
      "🎌",
      "🏳️",
      "🏴",
      "🇺🇸",
      "🇨🇦",
      "🇲🇽",
      "🇧🇷",
      "🇬🇧",
      "🇫🇷",
      "🇩🇪",
      "🇮🇹",
      "🇪🇸",
      "🇯🇵",
      "🇰🇷",
      "🇮🇳",
      "🇦🇺",
      "🇳🇿",
      "🇪🇺",
    ],
  };
  const emojiKeywords: Record<string, string> = {
    "😀": "grin happy smile",
    "🥹": "tears touched grateful",
    "😂": "laugh funny joy",
    "😉": "wink",
    "🥰": "love hearts",
    "😍": "love heart eyes",
    "🤔": "think question",
    "🫡": "salute understood",
    "🙄": "eye roll",
    "😬": "awkward grimace",
    "🥳": "party celebrate",
    "😎": "cool",
    "👍": "thumb up approve yes good",
    "👎": "thumb down disapprove no bad",
    "👏": "clap applause",
    "🙌": "celebrate praise",
    "🫶": "heart hands love",
    "🤝": "handshake agree deal",
    "🙏": "please thanks pray",
    "💪": "strong muscle",
    "👌": "okay perfect",
    "❤️": "heart love red",
    "💯": "hundred perfect",
    "🔥": "fire hot",
    "🎉": "party celebrate confetti",
    "✅": "check done yes",
    "❌": "cross no wrong",
    "⚠️": "warning caution",
    "‼️": "important emphasize",
    "❓": "question help",
    "💡": "idea light",
    "🎯": "target goal",
    "🚀": "rocket launch ship",
    "🧭": "compass direction",
    "🛠️": "tools build fix",
    "🧪": "test experiment",
    "🔍": "search inspect",
    "📌": "pin remember",
    "⭐": "star favorite",
    "🏆": "trophy win",
    "🔄": "refresh retry",
    "🧹": "clean cleanup",
  };

  let enabled = false;
  let captureSessionId: string | null = null;
  let mode: "idle" | "picking" | "locked" | "capturing" | "receipt" = "idle";
  let locked: LockedTarget | null = null;
  let hovered: Element | null = null;
  let recents: string[] = [];
  let tapbackAssets: TapbackAssetMap = {};
  let activeEventId: string | null = null;
  let expanded = false;
  let receiptTimer: number | null = null;

  const style = document.createElement("style");
  style.id = "vibecheck-component-reactions-style";
  style.textContent = cssText;
  const layer = document.createElement("div");
  layer.id = "vibecheck-reaction-layer";
  const outline = document.createElement("div");
  outline.id = "vibecheck-reaction-outline";
  const popover = document.createElement("div");
  popover.id = "vibecheck-reaction-popover";
  popover.dataset.expanded = "false";
  popover.dataset.placement = "above";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "React to component");
  const strip = document.createElement("div");
  strip.id = "vibecheck-reaction-strip";
  strip.setAttribute("role", "toolbar");
  strip.setAttribute("aria-label", "Reactions");
  const more = document.createElement("button");
  more.id = "vibecheck-reaction-more";
  more.className = "vibecheck-reaction-button";
  more.type = "button";
  more.textContent = "☺︎";
  more.title = "Add custom emoji reaction";
  more.setAttribute("aria-label", "Add custom emoji reaction");
  more.setAttribute("aria-haspopup", "dialog");
  more.setAttribute("aria-expanded", "false");
  const panel = document.createElement("div");
  panel.id = "vibecheck-emoji-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Choose an emoji reaction");
  const search = document.createElement("input");
  search.id = "vibecheck-emoji-search";
  search.type = "search";
  search.placeholder = "Describe an Emoji";
  search.setAttribute("aria-label", "Describe an Emoji");
  const grid = document.createElement("div");
  grid.id = "vibecheck-emoji-grid";
  const footer = document.createElement("div");
  footer.id = "vibecheck-picker-footer";
  const categories = document.createElement("div");
  categories.id = "vibecheck-picker-categories";
  const receipt = document.createElement("div");
  receipt.id = "vibecheck-receipt";
  receipt.setAttribute("role", "status");
  receipt.setAttribute("aria-live", "polite");
  footer.append(categories, search);
  panel.append(grid, footer);
  popover.append(strip, more, panel);
  layer.append(outline, popover, receipt);

  function ensureMounted(): void {
    if (!style.isConnected)
      (document.head || document.documentElement).append(style);
    if (!layer.isConnected) document.documentElement.append(layer);
  }

  function install(): void {
    ensureMounted();
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    renderStrip();
  }

  function setEnabled(
    value: boolean,
    nextRecents: string[] = [],
    nextTapbackAssets: TapbackAssetMap = {},
  ): void {
    enabled = value;
    recents = nextRecents
      .filter((emoji) => typeof emoji === "string" && emoji.length <= 16)
      .slice(0, 5);
    tapbackAssets = normalizeTapbackAssets(nextTapbackAssets);
    if (!enabled) {
      captureSessionId = null;
      dismiss();
    } else {
      ensureMounted();
    }
    renderStrip();
  }

  function setCaptureSession(sessionId: string | null): void {
    const normalized =
      typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
    if (normalized === captureSessionId) return;
    captureSessionId = normalized;
    dismiss();
  }

  function dispose(): void {
    enabled = false;
    captureSessionId = null;
    dismiss();
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
    style.remove();
    layer.remove();
    delete host.__vibecheckComponentReactions;
  }

  function renderStrip(): void {
    strip.replaceChildren();
    const reactions: Array<[string, string]> = fixedReactions.map(
      ([emoji, label]) => [emoji, label],
    );
    for (const emoji of recents.slice(0, 2)) {
      reactions.push([emoji, "Recent emoji"]);
    }
    for (const [index, [emoji, label]] of reactions.entries()) {
      strip.append(reactionButton(emoji, label, index < fixedReactions.length));
    }
  }

  function reactionButton(
    emoji: string,
    label: string,
    useTapbackGlyph = false,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "vibecheck-reaction-button";
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", `${emoji} ${label}`);
    const fixedKind: Record<string, string> = {
      "❤️": "heart",
      "👍": "thumbs-up",
      "👎": "thumbs-down",
      "😂": "haha",
      "‼️": "exclamation",
      "❓": "question",
    };
    const kind = fixedKind[emoji];
    if (kind && useTapbackGlyph) {
      const glyph = document.createElement("span");
      glyph.className = "vibecheck-reaction-glyph";
      glyph.dataset.kind = kind;
      const systemAsset = tapbackAssets[kind as TapbackAssetKey];
      if (systemAsset) {
        glyph.dataset.systemAsset = "true";
        glyph.style.setProperty(
          "--vibecheck-tapback-mask",
          `url("${systemAsset}")`,
        );
      } else if (kind === "heart") glyph.textContent = "♥";
      else if (kind === "haha") {
        glyph.append("HA", document.createElement("br"), "HA");
      } else if (kind === "exclamation") glyph.textContent = "!!";
      else if (kind === "question") glyph.textContent = "?";
      else glyph.textContent = emoji;
      button.append(glyph);
    } else {
      button.textContent = emoji;
    }
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void commit(emoji, label);
    });
    return button;
  }

  function normalizeTapbackAssets(value: unknown): TapbackAssetMap {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const allowed = new Set<TapbackAssetKey>([
      "heart",
      "thumbs-up",
      "thumbs-down",
      "haha",
      "exclamation",
      "question",
    ]);
    const normalized: TapbackAssetMap = {};
    let totalBytes = 0;
    for (const [key, dataUrl] of Object.entries(value)) {
      if (
        !allowed.has(key as TapbackAssetKey) ||
        typeof dataUrl !== "string" ||
        !dataUrl.startsWith("data:image/png;base64,") ||
        dataUrl.length > 12 * 1024
      ) {
        continue;
      }
      try {
        const bytes = atob(dataUrl.slice("data:image/png;base64,".length));
        if (
          bytes.length === 0 ||
          bytes.length > 8 * 1024 ||
          bytes.charCodeAt(0) !== 0x89 ||
          bytes.slice(1, 4) !== "PNG" ||
          bytes.charCodeAt(4) !== 0x0d ||
          bytes.charCodeAt(5) !== 0x0a ||
          bytes.charCodeAt(6) !== 0x1a ||
          bytes.charCodeAt(7) !== 0x0a
        ) {
          continue;
        }
        totalBytes += bytes.length;
        if (totalBytes > 48 * 1024) break;
        normalized[key as TapbackAssetKey] = dataUrl;
      } catch {
        // An unavailable or malformed template falls back independently.
      }
    }
    return normalized;
  }

  function renderEmojiGrid(query: string): void {
    grid.replaceChildren();
    categories.replaceChildren();
    const normalized = query.trim().toLowerCase();
    const groups: Array<[string, string[]]> = [];
    if (recents.length) groups.push(["Frequently Used", recents]);
    groups.push(...Object.entries(emojiGroups));
    const categoryIcons = ["◴", "☺︎", "♣", "●", "★", "✈", "▣", "♥", "⚑"];
    for (const [category, emojis] of groups) {
      const filtered = normalized
        ? emojis.filter(
            (emoji) =>
              emoji.includes(normalized) ||
              category.toLowerCase().includes(normalized) ||
              emojiKeywords[emoji]?.includes(normalized),
          )
        : emojis;
      if (!filtered.length) continue;
      const section = document.createElement("section");
      section.className = "vibecheck-emoji-section";
      section.dataset.category = category;
      const heading = document.createElement("h3");
      heading.className = "vibecheck-emoji-heading";
      heading.textContent = category;
      const sectionGrid = document.createElement("div");
      sectionGrid.className = "vibecheck-emoji-section-grid";
      for (const emoji of filtered)
        sectionGrid.append(reactionButton(emoji, category));
      section.append(heading, sectionGrid);
      grid.append(section);

      const categoryButton = document.createElement("button");
      categoryButton.className = "vibecheck-picker-category";
      categoryButton.type = "button";
      categoryButton.title = category;
      categoryButton.setAttribute("aria-label", category);
      categoryButton.setAttribute(
        "aria-current",
        String(categories.childElementCount === 0),
      );
      categoryButton.textContent =
        categoryIcons[categories.childElementCount] ?? "•";
      categoryButton.addEventListener("click", () => {
        section.scrollIntoView({ block: "start" });
        for (const candidate of categories.querySelectorAll("button")) {
          candidate.setAttribute(
            "aria-current",
            String(candidate === categoryButton),
          );
        }
      });
      categories.append(categoryButton);
    }
  }
  more.addEventListener("click", (event) => {
    event.stopPropagation();
    expanded = !expanded;
    popover.dataset.expanded = String(expanded);
    more.setAttribute("aria-expanded", String(expanded));
    panel.dataset.open = String(expanded);
    if (expanded) {
      renderEmojiGrid("");
      requestAnimationFrame(() => search.focus({ preventScroll: true }));
    } else {
      search.value = "";
    }
    reposition();
  });
  search.addEventListener("input", () => renderEmojiGrid(search.value));

  function onKeyDown(event: KeyboardEvent): void {
    if (!enabled) return;
    const shortcut =
      event.ctrlKey &&
      event.altKey &&
      !event.metaKey &&
      !event.shiftKey &&
      (event.code === "KeyR" || event.key.toLowerCase() === "r");
    if (shortcut) {
      ensureMounted();
      event.preventDefault();
      event.stopImmediatePropagation();
      if (captureSessionId) {
        requestCaptureSessionToggle();
        return;
      }
      if (mode !== "idle") {
        dismiss();
        return;
      }
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
        const text = selection.toString().trim();
        if (text) {
          lockRange(selection.getRangeAt(0).cloneRange(), text);
          return;
        }
      }
      requestCaptureSessionToggle();
      return;
    }
    if (event.key === "Escape" && mode !== "idle") {
      event.preventDefault();
      if (expanded) {
        expanded = false;
        popover.dataset.expanded = "false";
        more.setAttribute("aria-expanded", "false");
        panel.dataset.open = "false";
        search.value = "";
        reposition();
      } else {
        dismiss();
      }
    }
  }

  function requestCaptureSessionToggle(): void {
    if (typeof host.__vibecheckComponentCommit !== "function") return;
    try {
      host.__vibecheckComponentCommit(
        JSON.stringify({
          schema_version: 1,
          type: "toggle_capture_session",
          document_id: documentId,
        }),
      );
    } catch {
      // The host will restore the authoritative state on document refresh.
    }
  }

  function lockRange(range: Range, text: string): void {
    const container = (
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement
    ) as Element | null;
    const semantic =
      container?.closest(
        "button,a,input,textarea,label,li,article,section,[role],p,div",
      ) ?? container;
    const highlights = (
      CSS as typeof CSS & {
        highlights?: Map<string, unknown> & {
          set(name: string, value: unknown): void;
          delete(name: string): void;
        };
      }
    ).highlights;
    const HighlightConstructor = (
      globalThis as typeof globalThis & {
        Highlight?: new (...ranges: Range[]) => unknown;
      }
    ).Highlight;
    if (highlights && HighlightConstructor) {
      highlights.set(
        "vibecheck-component-selection",
        new HighlightConstructor(range),
      );
    }
    locked = {
      kind: "text",
      copyText: () => range.toString().trim() || text,
      bounds: () => {
        if (!range.startContainer.isConnected) return null;
        return (
          semantic?.getBoundingClientRect() ?? range.getBoundingClientRect()
        );
      },
      anchor: () =>
        range.startContainer.isConnected ? range.getBoundingClientRect() : null,
    };
    lockCurrent();
  }

  function onPointerMove(event: PointerEvent): void {
    if (!enabled || mode !== "picking") return;
    ensureMounted();
    const paper = paperTarget(event.clientX, event.clientY);
    if (paper) {
      hovered = null;
      locked = paper;
      drawBounds(paper.bounds(), "hover");
      return;
    }
    const element = usableElement(
      document.elementFromPoint(event.clientX, event.clientY),
    );
    hovered = element;
    locked = element ? elementTarget(element) : null;
    drawBounds(locked?.bounds() ?? null, "hover");
  }

  function onPointerDown(event: PointerEvent): void {
    if (enabled && mode === "picking" && locked) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function onClick(event: MouseEvent): void {
    if (!enabled) return;
    if (mode === "picking" && locked) {
      event.preventDefault();
      event.stopImmediatePropagation();
      lockCurrent();
      return;
    }
    if (
      mode !== "idle" &&
      !popover.contains(event.target as Node) &&
      !receipt.contains(event.target as Node)
    ) {
      dismiss();
    }
  }

  function usableElement(element: Element | null): Element | null {
    if (!element || layer.contains(element)) return null;
    if (element === document.documentElement || element === document.body)
      return null;
    let candidate: Element | null = element;
    while (
      candidate?.parentElement &&
      candidate.getBoundingClientRect().width < 8
    )
      candidate = candidate.parentElement;
    return candidate;
  }

  function elementTarget(element: Element): LockedTarget {
    return {
      kind: "element",
      copyText: () => {
        const visible =
          element instanceof HTMLElement ? element.innerText.trim() : "";
        return (
          visible ||
          element.getAttribute("aria-label")?.trim() ||
          element.getAttribute("alt")?.trim() ||
          ""
        );
      },
      bounds: () =>
        element.isConnected ? element.getBoundingClientRect() : null,
      anchor: () =>
        element.isConnected ? element.getBoundingClientRect() : null,
    };
  }

  function paperTarget(x: number, y: number): LockedTarget | null {
    const adapter = host.__paperVibecheckAdapter;
    if (adapter && typeof adapter.hitTest === "function") {
      try {
        const result = adapter.hitTest(x, y);
        if (
          result?.bounds &&
          Number.isFinite(result.bounds.x) &&
          Number.isFinite(result.bounds.y) &&
          result.bounds.width > 0 &&
          result.bounds.height > 0
        ) {
          const bounds = new DOMRect(
            result.bounds.x,
            result.bounds.y,
            result.bounds.width,
            result.bounds.height,
          );
          return {
            kind: "paper",
            copyText: () => String(result.label ?? "").trim(),
            bounds: () => bounds,
            anchor: () => bounds,
          };
        }
      } catch {
        // Continue to the isolated native Paper capability probe.
      }
    }
    return nativePaperTarget(x, y);
  }

  function nativePaperTarget(x: number, y: number): LockedTarget | null {
    const candidate = document.elementFromPoint(x, y);
    if (!(candidate instanceof HTMLCanvasElement)) return null;
    const editor = candidate.closest<HTMLElement>("[data-paper-editor]");
    if (!editor) return null;
    const state = paperEditorState(editor);
    if (!state) return null;
    try {
      const worldPoint = state.cameraState.viewportToWorld({ x, y }, false);
      const result = state.pointerState.calculateNodeAtPoint(
        worldPoint,
        state.pointerState.includeLockedNodesInHover,
      );
      const node = result?.deepestNode ?? result?.node;
      if (!node || typeof node.id !== "string" || !node.bounds) return null;
      const currentBounds = (): DOMRect | null => {
        try {
          return paperRect(state.cameraState.worldToViewportRect(node.bounds));
        } catch {
          return null;
        }
      };
      if (!currentBounds()) return null;
      const label = [node.label, node.name, node.text, node.component].find(
        (value) => typeof value === "string" && value.trim().length > 0,
      );
      return {
        kind: "paper",
        copyText: () => (typeof label === "string" ? label.trim() : ""),
        bounds: currentBounds,
        anchor: currentBounds,
      };
    } catch {
      return null;
    }
  }

  function paperEditorState(editor: HTMLElement): PaperEditorState | null {
    const key = Reflect.ownKeys(editor).find((candidate) =>
      String(candidate).startsWith("__reactFiber"),
    );
    let fiber = key
      ? (editor as unknown as Record<PropertyKey, unknown>)[key]
      : null;
    while (fiber && typeof fiber === "object") {
      const record = fiber as {
        memoizedProps?: { editorState?: unknown };
        return?: unknown;
      };
      const state = record.memoizedProps?.editorState as
        Partial<PaperEditorState> | undefined;
      if (
        typeof state?.cameraState?.viewportToWorld === "function" &&
        typeof state.cameraState.worldToViewportRect === "function" &&
        typeof state.pointerState?.calculateNodeAtPoint === "function"
      ) {
        return state as PaperEditorState;
      }
      fiber = record.return;
    }
    return null;
  }

  function paperRect(value: unknown): DOMRect | null {
    if (!value || typeof value !== "object") return null;
    const bounds = value as Record<string, unknown>;
    const left = Number(bounds.left ?? bounds.minX ?? bounds.x);
    const top = Number(bounds.top ?? bounds.minY ?? bounds.y);
    const right = Number(
      bounds.right ??
        bounds.maxX ??
        (Number.isFinite(Number(bounds.width))
          ? left + Number(bounds.width)
          : Number.NaN),
    );
    const bottom = Number(
      bounds.bottom ??
        bounds.maxY ??
        (Number.isFinite(Number(bounds.height))
          ? top + Number(bounds.height)
          : Number.NaN),
    );
    if (
      ![left, top, right, bottom].every(Number.isFinite) ||
      right <= left ||
      bottom <= top
    )
      return null;
    return new DOMRect(left, top, right - left, bottom - top);
  }

  function lockCurrent(): void {
    if (!locked) return;
    mode = "locked";
    if (locked.kind === "text") outline.style.display = "none";
    else drawBounds(locked.bounds(), "locked");
    popover.style.display = "flex";
    reposition();
  }

  function reposition(): void {
    if (!locked || (mode !== "locked" && mode !== "capturing")) return;
    const anchor = locked.anchor();
    if (!anchor || anchor.width <= 0 || anchor.height <= 0) {
      dismiss();
      return;
    }
    popover.dataset.expanded = String(expanded);
    popover.style.left = "0px";
    popover.style.top = "0px";
    popover.style.display = "flex";
    popover.dataset.placement = "below";
    let popoverRect = popover.getBoundingClientRect();
    const fitsAbove = anchor.top - popoverRect.height - 10 >= 8;
    const fitsBelow =
      anchor.bottom + popoverRect.height + 10 < window.innerHeight;
    const placement = expanded
      ? fitsBelow || !fitsAbove
        ? "below"
        : "above"
      : fitsAbove || !fitsBelow
        ? "above"
        : "below";
    popover.dataset.placement = placement;
    popoverRect = popover.getBoundingClientRect();
    const width = popoverRect.width;
    const left = Math.max(
      8,
      Math.min(
        window.innerWidth - width - 8,
        anchor.left + anchor.width / 2 - width / 2,
      ),
    );
    const top =
      placement === "below"
        ? anchor.bottom + 8
        : Math.max(8, anchor.top - popoverRect.height - 8);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    if (locked.kind === "text") outline.style.display = "none";
    else drawBounds(locked.bounds(), "locked");
  }

  function drawBounds(rect: DOMRect | null, state: string): void {
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      outline.style.display = "none";
      return;
    }
    outline.dataset.state = state;
    outline.style.display = "block";
    outline.style.left = `${Math.max(0, rect.left)}px`;
    outline.style.top = `${Math.max(0, rect.top)}px`;
    outline.style.width = `${Math.min(window.innerWidth - Math.max(0, rect.left), rect.width)}px`;
    outline.style.height = `${Math.min(window.innerHeight - Math.max(0, rect.top), rect.height)}px`;
  }

  async function commit(emoji: string, label: string): Promise<void> {
    if (!enabled || mode !== "locked" || !locked) return;
    const eventId = crypto.randomUUID();
    activeEventId = eventId;
    mode = "capturing";
    const target = locked;
    const copyText = target.copyText();
    hideInteraction();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const rect = target.bounds();
    if (
      !rect ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      typeof host.__vibecheckComponentCommit !== "function"
    ) {
      showReceipt("Copy failed");
      return;
    }
    const clipped = clipBounds(rect);
    const payload = {
      schema_version: 1,
      type: "commit",
      event_id: eventId,
      document_id: documentId,
      clipboard_session_id: captureSessionId,
      copy_text: copyText,
      reaction_emoji: emoji,
      reaction_label: label,
      bounds: clipped,
    };
    try {
      host.__vibecheckComponentCommit(JSON.stringify(payload));
    } catch {
      showReceipt("Copy failed");
    }
  }

  function clipBounds(rect: DOMRect): Bounds {
    const padding = 6;
    const left = Math.max(0, rect.left - padding);
    const top = Math.max(0, rect.top - padding);
    const right = Math.min(window.innerWidth, rect.right + padding);
    const bottom = Math.min(window.innerHeight, rect.bottom + padding);
    return {
      x: left,
      y: top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
      device_scale_factor: window.devicePixelRatio || 1,
    };
  }

  function settle(eventId: string, outcome: string): void {
    if (eventId !== activeEventId) return;
    const labels: Record<string, string> = {
      sent: "Sent to Codex · Copied",
      no_active_turn: "Copied · No active Codex task",
      multiple_active_turns: "Copied · Multiple active Codex tasks",
      unavailable: "Copied · Codex unavailable",
      rejected: "Copied · Codex unavailable",
      interrupt_failed: "Copied · Codex unavailable",
      restart_failed: "Copied · Codex unavailable",
      sent_outcome_unknown: "Send outcome unknown · Copied",
      copy_failed: "Copy failed",
    };
    showReceipt(labels[outcome] ?? "Copied");
  }

  function showReceipt(message: string): void {
    const anchor = locked?.anchor() ?? null;
    activeEventId = null;
    mode = "receipt";
    locked = null;
    receipt.textContent = message;
    receipt.style.display = "block";
    receipt.style.left = `${Math.max(
      12,
      Math.min(
        window.innerWidth - 260,
        anchor
          ? anchor.left + anchor.width / 2 - 110
          : window.innerWidth / 2 - 110,
      ),
    )}px`;
    receipt.style.top = `${anchor ? Math.min(window.innerHeight - 52, anchor.bottom + 8) : 18}px`;
    if (receiptTimer !== null) window.clearTimeout(receiptTimer);
    receiptTimer = window.setTimeout(() => dismiss(), 2400);
  }

  function hideInteraction(): void {
    outline.style.display = "none";
    popover.style.display = "none";
    panel.dataset.open = "false";
    (
      CSS as typeof CSS & {
        highlights?: { delete(name: string): void };
      }
    ).highlights?.delete("vibecheck-component-selection");
  }

  function dismiss(): void {
    mode = enabled && captureSessionId ? "picking" : "idle";
    locked = null;
    hovered = null;
    expanded = false;
    activeEventId = null;
    popover.dataset.expanded = "false";
    more.setAttribute("aria-expanded", "false");
    hideInteraction();
    receipt.style.display = "none";
    search.value = "";
    if (receiptTimer !== null) {
      window.clearTimeout(receiptTimer);
      receiptTimer = null;
    }
  }

  host.__vibecheckComponentReactions = {
    install,
    setEnabled,
    setCaptureSession,
    settle,
    dispose,
    documentId,
  };
  install();
}
