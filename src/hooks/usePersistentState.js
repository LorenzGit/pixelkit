import { useEffect, useRef, useState } from 'react';

// useState that mirrors to localStorage. Plain-object values are merged over
// the initial value so new default fields survive a stored older shape.
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return initial;
      const parsed = JSON.parse(raw);
      if (initial && typeof initial === 'object' && !Array.isArray(initial) && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...initial, ...parsed };
      }
      return parsed;
    } catch {
      return initial;
    }
  });

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode */ }
  }, [key, value]);

  return [value, setValue];
}
