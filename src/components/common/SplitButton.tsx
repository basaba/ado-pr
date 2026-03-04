import { useState, useRef, useEffect } from 'react';
import { Button } from './Button';

interface SplitButtonOption {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'ghost';
}

interface Props {
  options: SplitButtonOption[];
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export function SplitButton({ options, disabled, size = 'sm' }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const primary = options[0];
  const rest = options.slice(1);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative inline-flex" ref={ref}>
      <Button
        variant={primary.variant ?? 'success'}
        size={size}
        disabled={disabled}
        onClick={primary.onClick}
        className="rounded-r-none"
      >
        {primary.label}
      </Button>
      <Button
        variant={primary.variant ?? 'success'}
        size={size}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="rounded-l-none border-l border-l-white/30 px-1.5"
        aria-label="More actions"
      >
        ▾
      </Button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg z-50 min-w-[14rem]">
          {rest.map((opt) => (
            <button
              key={opt.label}
              className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 text-gray-700"
              onClick={() => {
                setOpen(false);
                opt.onClick();
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
