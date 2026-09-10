/** Row selection model by entry id (rows shift while tailing; ids stay stable). Pure functions. */

export interface Selection {
  /** Selected ids in selection order. */
  ids: number[];
  /** Anchor for Shift ranges. */
  anchor: number | null;
  /** Row that has keyboard focus and is shown in the detail panel. */
  focus: number | null;
}

export const EMPTY_SELECTION: Selection = { ids: [], anchor: null, focus: null };

export interface ClickModifiers {
  shift?: boolean;
  ctrl?: boolean;
}

export type SelectionMove = 'up' | 'down' | 'pageUp' | 'pageDown' | 'home' | 'end';

function uniq(ids: number[]): number[] {
  return [...new Set(ids)];
}

function rangeBetween(rowIds: number[], a: number, b: number): number[] {
  const ia = rowIds.indexOf(a);
  const ib = rowIds.indexOf(b);
  if (ia < 0 || ib < 0) return [b];
  const [lo, hi] = ia <= ib ? [ia, ib] : [ib, ia];
  return rowIds.slice(lo, hi + 1);
}

/** Plain click selects one row; Ctrl toggles; Shift selects the range from the anchor (Ctrl+Shift adds it). */
export function selectByClick(
  sel: Selection,
  rowIds: number[],
  id: number,
  mods: ClickModifiers = {},
): Selection {
  if (mods.shift && sel.anchor !== null) {
    const range = rangeBetween(rowIds, sel.anchor, id);
    return { ids: uniq([...(mods.ctrl ? sel.ids : []), ...range]), anchor: sel.anchor, focus: id };
  }
  if (mods.ctrl) {
    const has = sel.ids.includes(id);
    const ids = has ? sel.ids.filter((x) => x !== id) : [...sel.ids, id];
    return { ids, anchor: id, focus: has ? (ids[ids.length - 1] ?? null) : id };
  }
  return { ids: [id], anchor: id, focus: id };
}

/** Keyboard navigation relative to the focused row; `extend` (Shift) grows the range from the anchor. */
export function moveSelection(
  sel: Selection,
  rowIds: number[],
  move: SelectionMove,
  extend = false,
  pageSize = 20,
): Selection {
  if (rowIds.length === 0) return sel;
  const last = rowIds.length - 1;
  const cur = sel.focus !== null ? rowIds.indexOf(sel.focus) : -1;
  let next: number;
  switch (move) {
    case 'up':
      next = cur < 0 ? 0 : Math.max(cur - 1, 0);
      break;
    case 'down':
      next = cur < 0 ? 0 : Math.min(cur + 1, last);
      break;
    case 'pageUp':
      next = cur < 0 ? 0 : Math.max(cur - pageSize, 0);
      break;
    case 'pageDown':
      next = cur < 0 ? Math.min(pageSize, last) : Math.min(cur + pageSize, last);
      break;
    case 'home':
      next = 0;
      break;
    case 'end':
      next = last;
      break;
  }
  const id = rowIds[next]!;
  if (extend) {
    const anchor = sel.anchor ?? sel.focus ?? id;
    return { ids: rangeBetween(rowIds, anchor, id), anchor, focus: id };
  }
  return { ids: [id], anchor: id, focus: id };
}

export function clearSelection(): Selection {
  return EMPTY_SELECTION;
}
