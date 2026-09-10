import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '../../api/client';
import { useCurrentWorkspace } from '../../queries/workspaces';
import { DEFAULT_LAYOUT, type ColumnLayout } from './columns';

export const LAYOUT_KV_KEY = 'layout.columns';

function parseLayout(text: string | null): ColumnLayout {
  if (!text) return DEFAULT_LAYOUT;
  try {
    const parsed = JSON.parse(text) as Partial<ColumnLayout>;
    return {
      order:
        Array.isArray(parsed.order) && parsed.order.length > 0
          ? parsed.order
          : DEFAULT_LAYOUT.order,
      sizes: parsed.sizes && typeof parsed.sizes === 'object' ? parsed.sizes : {},
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/**
 * Column layout (visible order + sizes) persisted per workspace in the `kv` table. Local edits apply
 * immediately and are written back debounced.
 */
export function useColumnLayout(): {
  layout: ColumnLayout;
  setLayout: (update: (prev: ColumnLayout) => ColumnLayout) => void;
  ready: boolean;
} {
  const { data: workspace } = useCurrentWorkspace();
  const qc = useQueryClient();
  const key = ['workspace', 'kv', workspace?.id ?? null, LAYOUT_KV_KEY] as const;
  const stored = useQuery({
    queryKey: key,
    queryFn: () => invoke('workspace:kvGet', { key: LAYOUT_KV_KEY }),
    enabled: Boolean(workspace),
    staleTime: Infinity,
  });
  const [local, setLocal] = React.useState<{ wsId: string | null; layout: ColumnLayout } | null>(
    null,
  );
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const persisted = React.useMemo(() => parseLayout(stored.data ?? null), [stored.data]);
  const wsId = workspace?.id ?? null;
  const layout = local && local.wsId === wsId ? local.layout : persisted;

  const setLayout = React.useCallback(
    (update: (prev: ColumnLayout) => ColumnLayout) => {
      const next = update(layout);
      setLocal({ wsId, layout: next });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const text = JSON.stringify(next);
        void invoke('workspace:kvSet', { key: LAYOUT_KV_KEY, value: text }).then(() =>
          qc.setQueryData(key, text),
        );
      }, 400);
    },
    [layout, wsId, qc, key],
  );

  React.useEffect(() => () => clearTimeout(timer.current), []);

  return { layout, setLayout, ready: !workspace || stored.isSuccess || stored.isError };
}
