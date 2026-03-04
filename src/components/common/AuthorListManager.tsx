import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadLists, SELECTED_KEY } from './authorListStore';

interface Author {
  id: string;
  displayName: string;
}

interface AuthorListManagerProps {
  onChange: (authors: Author[]) => void;
  active: boolean;
  onActiveChange: (active: boolean) => void;
}

export function AuthorListManager({ onChange, active, onActiveChange }: AuthorListManagerProps) {
  const navigate = useNavigate();
  const [lists] = useState(() => loadLists());
  const [selected, setSelected] = useState<string | null>(null);

  const currentAuthors = selected && active ? (lists[selected] ?? []) : [];

  useEffect(() => {
    onChange(currentAuthors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, active, JSON.stringify(currentAuthors)]);

  // Deselect when parent deactivates
  useEffect(() => {
    if (!active) setSelected(null);
  }, [active]);

  const handleSelect = useCallback((name: string) => {
    if (selected === name) {
      setSelected(null);
      onActiveChange(false);
      localStorage.removeItem(SELECTED_KEY);
    } else {
      setSelected(name);
      onActiveChange(true);
      localStorage.setItem(SELECTED_KEY, name);
    }
  }, [selected, onActiveChange]);

  const listNames = Object.keys(lists);

  return (
    <div className="flex items-center gap-1.5">
      {listNames.map((name) => (
        <button
          key={name}
          onClick={() => handleSelect(name)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            selected === name
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {name}
        </button>
      ))}
      <button
        onClick={() => navigate('/author-lists')}
        className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-gray-100 text-gray-600 hover:bg-gray-200"
      >
        + New list
      </button>
    </div>
  );
}
