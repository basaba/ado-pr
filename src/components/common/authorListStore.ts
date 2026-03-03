export interface Author {
  id: string;
  displayName: string;
}

export type ListMap = Record<string, Author[]>;

export const LISTS_KEY = 'pr-author-aliases';
export const SELECTED_KEY = 'pr-selected-alias';
const LEGACY_KEY = 'pr-filter-authors';

export function loadLists(): ListMap {
  try {
    const raw = localStorage.getItem(LISTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }

  // Migrate legacy single author list into a "Default" list
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const authors = JSON.parse(legacy) as Author[];
      if (authors.length > 0) {
        const lists: ListMap = { Default: authors };
        localStorage.setItem(LISTS_KEY, JSON.stringify(lists));
        localStorage.removeItem(LEGACY_KEY);
        return lists;
      }
    }
  } catch { /* ignore */ }

  return {};
}

export function loadSelectedList(lists: ListMap): string {
  const saved = localStorage.getItem(SELECTED_KEY);
  if (saved && lists[saved]) return saved;
  const keys = Object.keys(lists);
  return keys.length > 0 ? keys[0] : '';
}

export function saveLists(lists: ListMap): void {
  localStorage.setItem(LISTS_KEY, JSON.stringify(lists));
}

export function saveSelectedList(name: string): void {
  localStorage.setItem(SELECTED_KEY, name);
}
