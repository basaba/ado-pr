import { useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

/**
 * Syncs a single URL search-param with React state.
 * Every call to the setter pushes a new history entry so the browser
 * back / forward buttons step through each change.
 *
 * Setters read from window.location at call time (not a stale closure)
 * so multiple setters can be called in the same event handler safely.
 */
export function useSearchParamState(
  param: string,
  defaultValue: string,
): [string, (v: string) => void] {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const value = searchParams.get(param) ?? defaultValue;

  const setValue = useCallback(
    (next: string) => {
      const sp = new URLSearchParams(window.location.search);
      if (next === defaultValue) {
        sp.delete(param);
      } else {
        sp.set(param, next);
      }
      const qs = sp.toString();
      navigate(`${window.location.pathname}${qs ? `?${qs}` : ''}`, { replace: false });
    },
    [param, defaultValue, navigate],
  );

  return [value, setValue];
}

/**
 * Like useSearchParamState but for a nullable string.
 * Absent param → null; setting null removes the param.
 */
export function useSearchParamStateNullable(
  param: string,
): [string | null, (v: string | null) => void] {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const value = searchParams.get(param);

  const setValue = useCallback(
    (next: string | null) => {
      const sp = new URLSearchParams(window.location.search);
      if (next == null) {
        sp.delete(param);
      } else {
        sp.set(param, next);
      }
      const qs = sp.toString();
      navigate(`${window.location.pathname}${qs ? `?${qs}` : ''}`, { replace: false });
    },
    [param, navigate],
  );

  return [value, setValue];
}

/**
 * Like useSearchParamState but for a Set<string> stored as comma-separated values.
 */
export function useSearchParamStateSet(
  param: string,
): [Set<string>, (v: Set<string>) => void] {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const raw = searchParams.get(param);
  const value = raw ? new Set(raw.split(',')) : new Set<string>();

  const setValue = useCallback(
    (next: Set<string>) => {
      const sp = new URLSearchParams(window.location.search);
      if (next.size === 0) {
        sp.delete(param);
      } else {
        sp.set(param, Array.from(next).join(','));
      }
      const qs = sp.toString();
      navigate(`${window.location.pathname}${qs ? `?${qs}` : ''}`, { replace: false });
    },
    [param, navigate],
  );

  return [value, setValue];
}
