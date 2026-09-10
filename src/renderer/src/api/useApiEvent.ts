import { useEffect, useRef } from 'react';
import type { PushEvents } from '@shared/ipc/contracts';
import { onEvent } from './client';

/** Subscribes to a main-process push event for the lifetime of the component (handler may change). */
export function useApiEvent<E extends keyof PushEvents>(
  event: E,
  handler: (payload: PushEvents[E]) => void,
): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => onEvent(event, (payload) => ref.current(payload)), [event]);
}
