import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchUsers, resolveIdentityId, type UserSearchResult } from '../api/pullRequests';
import {
  type ListMap,
  loadLists,
  saveLists,
  saveSelectedList,
} from '../components/common/authorListStore';

export function AuthorListPage() {
  const navigate = useNavigate();
  const [lists, setLists] = useState<ListMap>(loadLists);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  // Per-list search state keyed by list name
  const [searchState, setSearchState] = useState<Record<string, {
    query: string;
    results: UserSearchResult[];
    open: boolean;
    loading: boolean;
  }>>({});

  const searchRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const persist = useCallback((newLists: ListMap) => {
    setLists(newLists);
    saveLists(newLists);
    // Keep selected in sync if lists change
    const keys = Object.keys(newLists);
    if (keys.length > 0) saveSelectedList(keys[0]);
  }, []);

  const handleNewList = useCallback(() => {
    // Generate a unique temporary key
    let tempKey = '__new_list__';
    let i = 1;
    while (lists[tempKey]) { tempKey = `__new_list_${i}__`; i++; }
    const newLists = { [tempKey]: [], ...lists };
    persist(newLists);
    setEditingName(tempKey);
    setDraftName('');
  }, [lists, persist]);

  const handleCommitName = useCallback((oldName: string) => {
    const name = draftName.trim();
    if (!name || (name !== oldName && lists[name])) {
      // If empty or duplicate, remove if it was a new unsaved list, otherwise cancel edit
      if (oldName.startsWith('__new_list')) {
        const next = { ...lists };
        delete next[oldName];
        persist(next);
      }
      setEditingName(null);
      setDraftName('');
      return;
    }
    if (name === oldName) {
      setEditingName(null);
      setDraftName('');
      return;
    }
    // Rename: create new key, preserve order
    const newLists: ListMap = {};
    for (const [key, val] of Object.entries(lists)) {
      if (key === oldName) newLists[name] = val;
      else newLists[key] = val;
    }
    persist(newLists);
    setEditingName(null);
    setDraftName('');
  }, [draftName, lists, persist]);

  const handleDelete = useCallback((name: string) => {
    const next = { ...lists };
    delete next[name];
    persist(next);
  }, [lists, persist]);

  const handleRemoveAuthor = useCallback((listName: string, authorId: string) => {
    const updated = { ...lists, [listName]: lists[listName].filter((a) => a.id !== authorId) };
    persist(updated);
  }, [lists, persist]);

  const getSearch = (listName: string) => searchState[listName] ?? { query: '', results: [], open: false, loading: false };

  const updateSearch = useCallback((listName: string, patch: Partial<typeof searchState[string]>) => {
    setSearchState((prev) => ({ ...prev, [listName]: { ...getSearch(listName), ...patch } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchState]);

  const doSearch = useCallback(async (listName: string, text: string) => {
    if (!text || text.length < 2) { updateSearch(listName, { results: [], open: false }); return; }
    updateSearch(listName, { loading: true });
    try {
      const items = await searchUsers(text);
      const existingIds = new Set((lists[listName] ?? []).map((a) => a.id));
      updateSearch(listName, { results: items.filter((i) => !existingIds.has(i.id)), open: true, loading: false });
    } catch {
      updateSearch(listName, { results: [], loading: false });
    }
  }, [lists, updateSearch]);

  const handleAddAuthor = useCallback(async (listName: string, item: UserSearchResult) => {
    let identityId = item.id;
    if (item.descriptor) {
      try { identityId = await resolveIdentityId(item.descriptor); } catch { /* fallback */ }
    }
    const updated = {
      ...lists,
      [listName]: [...lists[listName], { id: identityId, displayName: item.displayName }],
    };
    persist(updated);
    updateSearch(listName, { query: '', results: [], open: false });
  }, [lists, persist, updateSearch]);

  // Close search dropdowns on click outside
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      for (const [name, ref] of Object.entries(searchRefs.current)) {
        if (ref && !ref.contains(e.target as Node) && searchState[name]?.open) {
          updateSearch(name, { open: false });
        }
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [searchState, updateSearch]);

  const listNames = Object.keys(lists);

  return (
    <div>
      <button
        onClick={() => navigate('/')}
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-2"
      >
        ← Back to Pull Requests
      </button>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Manage Author Lists</h1>
        <button
          onClick={handleNewList}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
        >
          + New list
        </button>
      </div>

      {listNames.length === 0 && !editingName && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <p className="text-sm text-gray-400 dark:text-gray-500">No author lists yet. Create one to get started.</p>
        </div>
      )}

      <div className="space-y-4">
        {listNames.map((name) => {
          const authors = lists[name];
          const search = getSearch(name);
          return (
            <div key={name} className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 space-y-3">
              <div className="flex items-center justify-between">
                {editingName === name ? (
                  <input
                    type="text"
                    value={draftName}
                    placeholder="Enter list name…"
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCommitName(name); if (e.key === 'Escape') { handleCommitName(name); } }}
                    onBlur={() => handleCommitName(name)}
                    autoFocus
                    className="text-base font-semibold text-gray-800 dark:text-gray-100 px-2 py-0.5 rounded border border-blue-400 outline-none w-64 dark:bg-gray-700"
                  />
                ) : (
                  <h2
                    className="text-base font-semibold text-gray-800 dark:text-gray-100 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 group"
                    onClick={() => { setEditingName(name); setDraftName(name.startsWith('__new_list') ? '' : name); }}
                    title="Click to rename"
                  >
                    {name.startsWith('__new_list') ? <span className="text-gray-400 dark:text-gray-500 italic">Untitled list</span> : name}
                    <span className="ml-1.5 text-gray-300 dark:text-gray-600 group-hover:text-blue-400 dark:group-hover:text-blue-300 text-sm">✏️</span>
                  </h2>
                )}
                <button
                  onClick={() => handleDelete(name)}
                  className="px-2 py-1 rounded text-sm text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
                  title={`Delete "${name}"`}
                >
                  🗑 Delete
                </button>
              </div>

              {authors.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {authors.map((a) => (
                    <span
                      key={a.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200"
                    >
                      {a.displayName}
                      <button
                        onClick={() => handleRemoveAuthor(name, a.id)}
                        className="text-blue-400 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-300"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500">No authors added yet.</p>
              )}

              <div ref={(el) => { searchRefs.current[name] = el; }} className="relative max-w-md">
                <input
                  type="text"
                  value={search.query}
                  placeholder="Add author (Enter to search)…"
                  onChange={(e) => { updateSearch(name, { query: e.target.value }); if (!e.target.value) updateSearch(name, { results: [], open: false }); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') doSearch(name, search.query); }}
                  className="px-3 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 w-full"
                />
                {search.loading && <span className="absolute right-3 top-2.5 text-gray-400 dark:text-gray-500 text-xs animate-pulse">…</span>}
                {search.open && search.results.length > 0 && (
                  <ul className="absolute z-30 mt-1 w-full max-h-48 overflow-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg text-sm">
                    {search.results.slice(0, 20).map((item) => (
                      <li
                        key={item.id}
                        onClick={() => handleAddAuthor(name, item)}
                        className="px-3 py-2 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/30"
                      >
                        <span>{item.displayName}</span>
                        {item.mail && <span className="text-gray-400 dark:text-gray-500 ml-1 text-xs">{item.mail}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {search.open && search.query && search.results.length === 0 && !search.loading && (
                  <div className="absolute z-30 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg text-sm px-3 py-2 text-gray-400 dark:text-gray-500">
                    No users found
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
