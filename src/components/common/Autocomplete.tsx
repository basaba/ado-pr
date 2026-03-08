import { useState, useRef, useEffect, useCallback } from 'react';

export interface AutocompleteItem {
  id: string;
  label: string;
}

interface AutocompleteProps {
  items: AutocompleteItem[];
  value: string; // selected item id
  onChange: (id: string) => void;
  onQueryChange?: (query: string) => void;
  placeholder?: string;
  loading?: boolean;
  onFocus?: () => void;
  onNoResults?: () => void;
  noResultsHint?: string;
}

export function Autocomplete({ items, value, onChange, onQueryChange, placeholder = 'Search…', loading = false, onFocus, onNoResults, noResultsHint }: AutocompleteProps) {
  const selected = items.find((i) => i.id === value);
  const [query, setQuery] = useState(selected?.label ?? '');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Sync display text when selection changes externally
  useEffect(() => {
    setQuery(selected?.label ?? '');
  }, [selected]);

  const filtered = items.filter((i) =>
    i.label.toLowerCase().includes(query.toLowerCase()),
  );

  const handleSelect = useCallback(
    (item: AutocompleteItem) => {
      onChange(item.id);
      setQuery(item.label);
      setOpen(false);
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    onChange('');
    setQuery('');
    setOpen(false);
  }, [onChange]);

  // Close on click outside
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        // Reset text to current selection if user didn't pick
        setQuery(selected?.label ?? '');
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [selected]);

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex items-center">
        <input
          type="text"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            onQueryChange?.(e.target.value);
            if (!e.target.value) onChange('');
          }}
          onFocus={() => { setOpen(true); onFocus?.(); }}
          className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 w-64"
          disabled={loading}
        />
        {loading && (
          <span className="ml-2 text-gray-400 dark:text-gray-500 text-xs animate-pulse">Loading…</span>
        )}
        {!loading && value && (
          <button
            onClick={handleClear}
            className="ml-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm"
            title="Clear"
          >
            ✕
          </button>
        )}
      </div>
      {open && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 w-64 max-h-60 overflow-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg text-sm">
          {filtered.slice(0, 50).map((item) => (
            <li
              key={item.id}
              onClick={() => handleSelect(item)}
              className={`px-3 py-2 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/40 ${
                item.id === value ? 'bg-blue-100 dark:bg-blue-900 font-medium' : ''
              }`}
            >
              {item.label}
            </li>
          ))}
          {filtered.length > 50 && (
            <li className="px-3 py-2 text-gray-400 dark:text-gray-500 text-xs">
              Type to narrow down ({filtered.length} results)…
            </li>
          )}
        </ul>
      )}
      {open && query && filtered.length === 0 && (
        <div className="absolute z-10 mt-1 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg text-sm px-3 py-2 text-gray-400 dark:text-gray-500">
          {onNoResults ? (
            <button
              onClick={onNoResults}
              className="text-blue-500 hover:underline w-full text-left"
            >
              {noResultsHint || 'Load more results…'}
            </button>
          ) : (
            'No matches'
          )}
        </div>
      )}
    </div>
  );
}
