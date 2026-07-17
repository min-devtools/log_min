export const DEFAULT_FONT_SIZE = 13;
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 20;
export const FONT_SIZE_STEP = 0.5;

export const clampFontSize = (size: number) => Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
export const changeFontSize = (size: number, direction: -1 | 1) => clampFontSize(size + direction * FONT_SIZE_STEP);
