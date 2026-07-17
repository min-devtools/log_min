export interface ThemePalette {
  surface: {
    app: string;
    window: string;
    panel: string;
    raised: string;
    hover: string;
    editor: string;
    overlay: string;
  };
  text: { primary: string; secondary: string; muted: string; onAccent: string };
  border: { default: string; strong: string };
  accent: { primary: string; secondary: string; focus: string };
  status: { success: string; warning: string; danger: string; info: string };
  syntax: { key: string; string: string; number: string; boolean: string; null: string; punctuation: string };
}

const value = (style: CSSStyleDeclaration, name: string) => style.getPropertyValue(name).trim();

/**
 * Built-in palettes are generated CSS today. This adapter exposes them through
 * stable semantic roles, so a future JSON loader only needs to produce this shape.
 */
export function readBuiltinPalette(style: CSSStyleDeclaration): ThemePalette {
  return {
    surface: {
      app: value(style, "--app-bg"),
      window: value(style, "--window"),
      panel: value(style, "--pane"),
      raised: value(style, "--pane-2"),
      hover: value(style, "--pane-3"),
      editor: value(style, "--editor-bg"),
      overlay: value(style, "--glass"),
    },
    text: {
      primary: value(style, "--text"),
      secondary: value(style, "--text-2"),
      muted: value(style, "--text-3"),
      onAccent: value(style, "--editor-bg"),
    },
    border: { default: value(style, "--line"), strong: value(style, "--line-2") },
    accent: { primary: value(style, "--blue"), secondary: value(style, "--blue-2"), focus: value(style, "--blue") },
    status: { success: value(style, "--green"), warning: value(style, "--orange"), danger: value(style, "--red"), info: value(style, "--blue-2") },
    // Read --syntax-* (tokens.css maps these to --blue/--green/etc by default,
    // but body.light overrides them with contrast-safe colors on its white editor).
    syntax: {
      key: value(style, "--syntax-key") || value(style, "--blue"),
      string: value(style, "--syntax-string") || value(style, "--green"),
      number: value(style, "--syntax-number") || value(style, "--blue-2"),
      boolean: value(style, "--syntax-boolean") || value(style, "--purple"),
      null: value(style, "--syntax-null") || value(style, "--red"),
      punctuation: value(style, "--syntax-punctuation") || value(style, "--text-3"),
    },
  };
}

export function applyPalette(style: CSSStyleDeclaration, palette: ThemePalette) {
  const variables: Record<string, string> = {
    "--surface-app": palette.surface.app,
    "--surface-window": palette.surface.window,
    "--surface-panel": palette.surface.panel,
    "--surface-raised": palette.surface.raised,
    "--surface-hover": palette.surface.hover,
    "--surface-editor": palette.surface.editor,
    "--surface-overlay": palette.surface.overlay,
    "--text-primary": palette.text.primary,
    "--text-secondary": palette.text.secondary,
    "--text-muted": palette.text.muted,
    "--text-on-accent": palette.text.onAccent,
    "--border-default": palette.border.default,
    "--border-strong": palette.border.strong,
    "--accent-primary": palette.accent.primary,
    "--accent-secondary": palette.accent.secondary,
    "--accent-focus": palette.accent.focus,
    "--status-success": palette.status.success,
    "--status-warning": palette.status.warning,
    "--status-danger": palette.status.danger,
    "--status-info": palette.status.info,
    "--syntax-key": palette.syntax.key,
    "--syntax-string": palette.syntax.string,
    "--syntax-number": palette.syntax.number,
    "--syntax-boolean": palette.syntax.boolean,
    "--syntax-null": palette.syntax.null,
    "--syntax-punctuation": palette.syntax.punctuation,
    "--accent": palette.accent.primary,
  };
  for (const [name, color] of Object.entries(variables)) style.setProperty(name, color);
}
