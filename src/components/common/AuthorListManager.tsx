import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadLists, SELECTED_KEY } from './authorListStore';

interface AuthorListManagerProps {
  selected: string;
  onSelectedChange: (name: string) => void;
  active: boolean;
  onActiveChange: (active: boolean) => void;
}

export function AuthorListManager({ selected, onSelectedChange, active, onActiveChange }: AuthorListManagerProps) {
  const navigate = useNavigate();
  const [lists] = useState(() => loadLists());

  const handleSelect = useCallback((name: string) => {
    if (selected === name) {
      onSelectedChange('');
      onActiveChange(false);
      localStorage.removeItem(SELECTED_KEY);
    } else {
      onSelectedChange(name);
      onActiveChange(true);
      localStorage.setItem(SELECTED_KEY, name);
    }
  }, [selected, onSelectedChange, onActiveChange]);

  const listNames = Object.keys(lists);

  return (
    <div className="flex items-center gap-1.5">
      {listNames.map((name) => (
        <button
          key={name}
          onClick={() => handleSelect(name)}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            active && selected === name
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {name}
        </button>
      ))}
      <button
        onClick={() => navigate('/author-lists')}
        className="px-4 py-1.5 rounded-full text-sm font-medium transition-colors bg-gray-100 text-gray-600 hover:bg-gray-200"
      >
        + New list
      </button>
    </div>
  );
}
