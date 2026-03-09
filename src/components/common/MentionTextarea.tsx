import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { searchIdentities, type IdentitySearchResult } from '../../api/pullRequests';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  /** Pre-known users (reviewers, commenters) shown before API search */
  knownUsers?: IdentitySearchResult[];
  /** Called when a mention is inserted, so the parent can track id→displayName */
  onMentionInserted?: (user: IdentitySearchResult) => void;
}

export function MentionTextarea({ value, onChange, placeholder, rows = 3, className, knownUsers = [], onMentionInserted }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(-1);
  const [results, setResults] = useState<IdentitySearchResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const isOpen = mentionQuery !== null;

  // Filter known users locally, then search API with debounce
  useEffect(() => {
    if (mentionQuery === null) {
      setResults([]);
      return;
    }

    const q = mentionQuery.toLowerCase();

    // Immediately show matching known users
    const local = q.length === 0
      ? knownUsers.slice(0, 10)
      : knownUsers.filter(
          (u) => u.displayName.toLowerCase().includes(q) || u.mail?.toLowerCase().includes(q),
        ).slice(0, 10);
    setResults(local);
    setSelectedIdx(0);

    // Debounce API search
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.length >= 2) {
      setLoading(true);
      searchTimer.current = setTimeout(async () => {
        try {
          const remote = await searchIdentities(q, ['user']);
          // Merge: known first, then remote (dedupe by id)
          const seen = new Set(local.map((u) => u.id.toLowerCase()));
          const merged = [
            ...local,
            ...remote.filter((u) => !seen.has(u.id.toLowerCase())),
          ].slice(0, 15);
          setResults(merged);
        } catch { /* keep local results */ }
        setLoading(false);
      }, 300);
    } else {
      setLoading(false);
    }

    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [mentionQuery, knownUsers]);

  const insertMention = useCallback((user: IdentitySearchResult) => {
    const before = value.slice(0, mentionStart);
    const after = value.slice(textareaRef.current?.selectionStart ?? value.length);
    const mention = `@<${user.id}>`;
    const newValue = before + mention + ' ' + after;
    onChange(newValue);
    onMentionInserted?.(user);
    setMentionQuery(null);

    // Restore cursor after the inserted mention
    requestAnimationFrame(() => {
      const pos = before.length + mention.length + 1;
      textareaRef.current?.setSelectionRange(pos, pos);
      textareaRef.current?.focus();
    });
  }, [value, mentionStart, onChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertMention(results[selectedIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setMentionQuery(null);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    const cursorPos = e.target.selectionStart;
    const textBefore = newValue.slice(0, cursorPos);

    // Find the last unmatched @ before cursor
    const atIdx = textBefore.lastIndexOf('@');
    if (atIdx >= 0) {
      // @ must be at start or preceded by whitespace
      const charBefore = atIdx > 0 ? textBefore[atIdx - 1] : ' ';
      if (/\s/.test(charBefore) || atIdx === 0) {
        const query = textBefore.slice(atIdx + 1);
        // Close if user typed a space-only query or it looks like @<GUID> already
        if (query.startsWith('<') || query.length > 30) {
          setMentionQuery(null);
        } else {
          setMentionQuery(query);
          setMentionStart(atIdx);
        }
        return;
      }
    }
    setMentionQuery(null);
  };

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        textareaRef.current && !textareaRef.current.contains(e.target as Node)
      ) {
        setMentionQuery(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (!isOpen || !dropdownRef.current) return;
    const item = dropdownRef.current.children[selectedIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx, isOpen]);

  // Compute dropdown position relative to viewport
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    if (!isOpen || !textareaRef.current) return;
    const updatePosition = () => {
      const rect = textareaRef.current!.getBoundingClientRect();
      setDropdownPos({
        top: rect.top - 4,
        left: rect.left,
        width: rect.width,
      });
    };
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen]);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        className={className}
      />
      {isOpen && results.length > 0 && createPortal(
        <div
          ref={dropdownRef}
          className="fixed max-h-48 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-[9999]"
          style={{
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            transform: 'translateY(-100%)',
          }}
        >
          {results.map((user, i) => (
            <button
              key={user.id}
              onMouseDown={(e) => { e.preventDefault(); insertMention(user); }}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                i === selectedIdx
                  ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                  : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <span className="rounded-full bg-gray-300 dark:bg-gray-600 text-white flex items-center justify-center text-[9px] font-bold" style={{ width: 22, height: 22, minWidth: 22 }}>
                {user.displayName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
              </span>
              <span className="flex-1 truncate">
                <span className="font-medium">{user.displayName}</span>
                {user.mail && <span className="text-gray-400 dark:text-gray-500 ml-1.5 text-xs">{user.mail}</span>}
              </span>
            </button>
          ))}
          {loading && (
            <div className="px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500">Searching...</div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
