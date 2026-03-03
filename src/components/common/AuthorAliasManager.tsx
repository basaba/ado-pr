import { useState, useCallback, useRef, useEffect } from 'react';
import { searchUsers, resolveIdentityId, type UserSearchResult } from '../../api/pullRequests';

interface Author {
  id: string;
  displayName: string;
}

type AliasMap = Record<string, Author[]>;

interface AuthorAliasManagerProps {
  onChange: (authors: Author[]) => void;
}

const ALIASES_KEY = 'pr-author-aliases';
const SELECTED_KEY = 'pr-selected-alias';
const LEGACY_KEY = 'pr-filter-authors';

function loadAliases(): AliasMap {
  try {
    const raw = localStorage.getItem(ALIASES_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }

  // Migrate legacy single author list into a "Default" alias
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const authors = JSON.parse(legacy) as Author[];
      if (authors.length > 0) {
        const aliases: AliasMap = { Default: authors };
        localStorage.setItem(ALIASES_KEY, JSON.stringify(aliases));
        localStorage.removeItem(LEGACY_KEY);
        return aliases;
      }
    }
  } catch { /* ignore */ }

  return {};
}

function loadSelectedAlias(aliases: AliasMap): string {
  const saved = localStorage.getItem(SELECTED_KEY);
  if (saved && aliases[saved]) return saved;
  const keys = Object.keys(aliases);
  return keys.length > 0 ? keys[0] : '';
}

export function AuthorAliasManager({ onChange }: AuthorAliasManagerProps) {
  const [aliases, setAliases] = useState<AliasMap>(loadAliases);
  const [selected, setSelected] = useState<string>(() => loadSelectedAlias(loadAliases()));
  const [popoutOpen, setPopoutOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');

  // Author search state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

  const popoutRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const currentAuthors = selected ? (aliases[selected] ?? []) : [];

  // Notify parent whenever the effective author list changes
  useEffect(() => {
    onChange(currentAuthors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, JSON.stringify(currentAuthors)]);

  const persist = useCallback((newAliases: AliasMap, newSelected: string) => {
    setAliases(newAliases);
    setSelected(newSelected);
    localStorage.setItem(ALIASES_KEY, JSON.stringify(newAliases));
    localStorage.setItem(SELECTED_KEY, newSelected);
  }, []);

  // Alias management
  const handleCreate = useCallback(() => {
    const name = newName.trim();
    if (!name || aliases[name]) return;
    persist({ ...aliases, [name]: [] }, name);
    setNewName('');
    setIsCreating(false);
  }, [newName, aliases, persist]);

  const handleDelete = useCallback(() => {
    if (!selected) return;
    const next = { ...aliases };
    delete next[selected];
    const keys = Object.keys(next);
    persist(next, keys.length > 0 ? keys[0] : '');
  }, [selected, aliases, persist]);

  const handleSelect = useCallback((name: string) => {
    setSelected(name);
    localStorage.setItem(SELECTED_KEY, name);
  }, []);

  // Author management
  const handleRemoveAuthor = useCallback((authorId: string) => {
    if (!selected) return;
    const updated = { ...aliases, [selected]: aliases[selected].filter((a) => a.id !== authorId) };
    persist(updated, selected);
  }, [selected, aliases, persist]);

  const doSearch = useCallback(async (text: string) => {
    if (!text || text.length < 2) { setResults([]); return; }
    setSearchLoading(true);
    try {
      const items = await searchUsers(text);
      const existingIds = new Set(currentAuthors.map((a) => a.id));
      setResults(items.filter((i) => !existingIds.has(i.id)));
      setSearchOpen(true);
    } catch {
      setResults([]);
    }
    setSearchLoading(false);
  }, [currentAuthors]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') doSearch(query);
    },
    [doSearch, query],
  );

  const handleAddAuthor = useCallback(
    async (item: UserSearchResult) => {
      if (!selected) return;
      let identityId = item.id;
      if (item.descriptor) {
        try { identityId = await resolveIdentityId(item.descriptor); } catch { /* fallback */ }
      }
      const updated = {
        ...aliases,
        [selected]: [...aliases[selected], { id: identityId, displayName: item.displayName }],
      };
      persist(updated, selected);
      setQuery('');
      setResults([]);
      setSearchOpen(false);
    },
    [selected, aliases, persist],
  );

  // Close popout on click outside
  useEffect(() => {
    if (!popoutOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (popoutRef.current && !popoutRef.current.contains(e.target as Node)) {
        setPopoutOpen(false);
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [popoutOpen]);

  const aliasNames = Object.keys(aliases);

  return (
    <div className="relative flex items-center gap-2">
      {/* Inline: alias dropdown + manage button */}
      {aliasNames.length > 0 ? (
        <select
          value={selected}
          onChange={(e) => handleSelect(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 bg-white text-gray-700"
        >
          {aliasNames.map((name) => (
            <option key={name} value={name}>{name} ({aliases[name].length})</option>
          ))}
        </select>
      ) : (
        <span className="text-sm text-gray-400">No lists</span>
      )}

      <button
        onClick={() => setPopoutOpen(!popoutOpen)}
        className={`px-2 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          popoutOpen ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
        title="Manage author lists"
      >
        ⚙️ Manage
      </button>

      {/* Popout panel */}
      {popoutOpen && (
        <div
          ref={popoutRef}
          className="absolute top-full left-0 mt-2 z-20 w-96 bg-white rounded-lg shadow-xl border border-gray-200 p-4 space-y-3"
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Manage Author Lists</h3>
            <button
              onClick={() => setPopoutOpen(false)}
              className="text-gray-400 hover:text-gray-600 text-sm"
            >
              ✕
            </button>
          </div>

          {/* Alias actions */}
          <div className="flex items-center gap-2 flex-wrap">
            {isCreating ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newName}
                  placeholder="List name…"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setIsCreating(false); }}
                  autoFocus
                  className="px-2 py-1 rounded text-sm border border-gray-300 w-36"
                />
                <button onClick={handleCreate} className="text-sm text-green-600 hover:underline">Save</button>
                <button onClick={() => setIsCreating(false)} className="text-sm text-gray-400 hover:underline">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setIsCreating(true)}
                className="px-2 py-1 rounded text-sm text-blue-600 hover:bg-blue-50"
              >
                + New list
              </button>
            )}

            {selected && (
              <button
                onClick={handleDelete}
                className="px-2 py-1 rounded text-sm text-red-500 hover:bg-red-50"
                title={`Delete "${selected}"`}
              >
                🗑 Delete "{selected}"
              </button>
            )}
          </div>

          {/* Authors for selected alias */}
          {selected ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 font-medium">
                Authors in "{selected}" ({currentAuthors.length}):
              </p>

              {currentAuthors.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {currentAuthors.map((a) => (
                    <span
                      key={a.id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                    >
                      {a.displayName}
                      <button
                        onClick={() => handleRemoveAuthor(a.id)}
                        className="text-blue-400 hover:text-blue-700"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">No authors added yet.</p>
              )}

              {/* Add author search */}
              <div ref={searchRef} className="relative">
                <input
                  type="text"
                  value={query}
                  placeholder="Add author (Enter to search)…"
                  onChange={(e) => { setQuery(e.target.value); if (!e.target.value) { setResults([]); setSearchOpen(false); } }}
                  onKeyDown={handleSearchKeyDown}
                  className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 bg-white text-gray-700 w-full"
                />
                {searchLoading && <span className="absolute right-3 top-2 text-gray-400 text-xs animate-pulse">…</span>}
                {searchOpen && results.length > 0 && (
                  <ul className="absolute z-30 mt-1 w-full max-h-48 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg text-sm">
                    {results.slice(0, 20).map((item) => (
                      <li
                        key={item.id}
                        onClick={() => handleAddAuthor(item)}
                        className="px-3 py-2 cursor-pointer hover:bg-blue-50"
                      >
                        <span>{item.displayName}</span>
                        {item.mail && <span className="text-gray-400 ml-1 text-xs">{item.mail}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {searchOpen && query && results.length === 0 && !searchLoading && (
                  <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg text-sm px-3 py-2 text-gray-400">
                    No users found
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400">Create an alias to start adding authors.</p>
          )}
        </div>
      )}
    </div>
  );
}
