/** Test helpers for the CodeMirror query editor (typing into contenteditable is unreliable in jsdom). */
import { act, fireEvent, screen } from '@testing-library/react';
import { EditorView } from '@codemirror/view';

export function queryEditorView(): EditorView {
  const content = screen.getByRole('textbox', { name: 'Query' });
  const view = EditorView.findFromDOM(content as HTMLElement);
  if (!view) throw new Error('CodeMirror view not found');
  return view;
}

/** Replaces the editor text (as if the user typed it) and places the cursor at the end. */
export function setQueryText(text: string): void {
  const view = queryEditorView();
  act(() => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: text.length },
      userEvent: 'input.type',
    });
  });
}

export function queryText(): string {
  return queryEditorView().state.doc.toString();
}

/** Sends a key to the editor (handled by CodeMirror's keymap on keydown). */
export function pressInQuery(key: string): void {
  act(() => {
    fireEvent.keyDown(queryEditorView().contentDOM, { key, code: key });
  });
}
