import { useState, useCallback } from 'react';

/**
 * Like useState but persists the value in localStorage.
 * Reads the initial value from localStorage (falling back to `defaultValue`),
 * and writes every update back so the preference survives page reloads.
 */
export function useLocalStorageState<T extends string>(
  key: string,
  defaultValue: T,
): [T, (v: T) => void] {
  const [value, setValueRaw] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return (stored as T) ?? defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const setValue = useCallback(
    (next: T) => {
      setValueRaw(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        // storage full or blocked — ignore
      }
    },
    [key],
  );

  return [value, setValue];
}
