import * as React from 'react';
import { completionKeymap, startCompletion } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import {
  dqlAutocompletion,
  dqlHighlight,
  dqlLint,
  dqlTheme,
  singleLine,
  type CompletionDeps,
} from './dql-language';

export interface QueryEditorProps {
  /** Externally controlled text; the editor pushes edits through `onChange` and adopts prop changes. */
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  completion: CompletionDeps;
  placeholder?: string;
  autoFocus?: boolean;
}

/** Single-line CodeMirror editor for DQL with highlighting, lint squiggles and autocomplete. */
export function QueryEditor(props: QueryEditorProps): React.JSX.Element {
  const host = React.useRef<HTMLDivElement>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const latest = React.useRef(props);
  latest.current = props;

  React.useEffect(() => {
    const deps: CompletionDeps = {
      fields: () => latest.current.completion.fields(),
      values: (field, prefix) => latest.current.completion.values(field, prefix),
    };
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          singleLine,
          history(),
          dqlHighlight,
          dqlLint,
          dqlAutocompletion(deps),
          keymap.of([
            ...completionKeymap,
            {
              key: 'Enter',
              run: () => {
                latest.current.onSubmit();
                return true;
              },
            },
            {
              key: 'Escape',
              run: () => {
                latest.current.onCancel();
                return true;
              },
            },
            { key: 'Mod-Space', run: startCompletion },
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onChange(update.state.doc.toString());
          }),
          cmPlaceholder(latest.current.placeholder ?? ''),
          EditorView.contentAttributes.of({
            'aria-label': 'Query',
            spellcheck: 'false',
            autocorrect: 'off',
            autocapitalize: 'off',
          }),
          dqlTheme,
        ],
      }),
    });
    viewRef.current = view;
    if (latest.current.autoFocus) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Adopt external value changes (revert, history/saved filter selection).
  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== props.value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: props.value },
        selection: { anchor: props.value.length },
      });
    }
  }, [props.value]);

  return <div ref={host} className="min-w-0 flex-1" data-testid="query-editor" />;
}
