/** Pure helpers for previewing multi-line cell values and sizing rows deterministically. */

export const ROW_HEIGHT = 28;
/** Mirrors `JsonTable`'s preview threshold in the detail panel. */
export const PREVIEW_LINES = 3;

const LINE_HEIGHT = 16;
const VERTICAL_PADDING = 12; // 6px top + 6px bottom for a "tall" row
const TOGGLE_HEIGHT = 16;
const TOGGLE_GAP = 2;

/** Splits a string into lines, or null if it doesn't span multiple lines. */
export function valueLines(value: string): string[] | null {
  return value.includes('\n') ? value.split('\n') : null;
}

export interface LinePreview {
  visibleLines: string[];
  hasMore: boolean;
  moreCount: number;
}

/** Which lines to show collapsed vs. expanded, and whether a toggle is needed (mirrors JsonTable). */
export function previewLines(lines: string[], expanded: boolean): LinePreview {
  const hasMore = lines.length > PREVIEW_LINES;
  return {
    visibleLines: expanded ? lines : lines.slice(0, PREVIEW_LINES),
    hasMore,
    moreCount: lines.length - PREVIEW_LINES,
  };
}

/** Deterministic pixel height needed for a cell holding `totalLines` lines, collapsed or expanded. */
export function cellHeight(totalLines: number, expanded: boolean): number {
  if (totalLines <= 1) return ROW_HEIGHT;
  const visible = expanded ? totalLines : Math.min(totalLines, PREVIEW_LINES);
  const hasMore = totalLines > PREVIEW_LINES;
  const content = visible * LINE_HEIGHT + (hasMore ? TOGGLE_HEIGHT + TOGGLE_GAP : 0);
  return Math.max(ROW_HEIGHT, content + VERTICAL_PADDING);
}
