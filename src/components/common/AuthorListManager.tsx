import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadLists, loadSelectedList, SELECTED_KEY } from './authorListStore';

interface Author {
  id: string;
  displayName: string;
}

interface AuthorListManagerProps {
  onChange: (authors: Author[]) => void;
}

export function AuthorListManager({ onChange }: AuthorListManagerProps) {
  const navigate = useNavigate();
  const [lists] = useState(() => loadLists());
  const [selected, setSelected] = useState<string>(() => loadSelectedList(loadLists()));

  const currentAuthors = selected ? (lists[selected] ?? []) : [];

  useEffect(() => {
    onChange(currentAuthors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, JSON.stringify(currentAuthors)]);

  const handleSelect = useCallback((name: string) => {
    setSelected(name);
    localStorage.setItem(SELECTED_KEY, name);
  }, []);

  const listNames = Object.keys(lists);

  return (
    <div className="relative flex items-center gap-2">
      {listNames.length > 0 ? (
        <select
          value={selected}
          onChange={(e) => handleSelect(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 bg-white text-gray-700"
        >
          {listNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      ) : (
        <span className="text-sm text-gray-400">No lists</span>
      )}

      <button
        onClick={() => navigate('/author-lists')}
        className="px-2 py-1.5 rounded-lg text-sm font-medium transition-colors bg-gray-100 text-gray-600 hover:bg-gray-200"
        title="Manage author lists"
      >
        ⚙️ Manage
      </button>
    </div>
  );
}
