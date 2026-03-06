import { useMemo, useCallback, useState, useEffect, type RefObject } from 'react';
import type { DiffLine } from './DiffViewer';

interface Marker {
  position: number; // percentage (0–100)
  color: string;
  lineNum: number | null;
}

interface Props {
  diffLines: DiffLine[];
  threadLineSet: Set<number>;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

/**
 * Renders change/comment markers alongside the scrollbar.
 * Must be placed inside a position:relative wrapper that sits around the scroll container.
 */
export function ScrollbarMinimap({ diffLines, threadLineSet, scrollContainerRef }: Props) {
  const [containerHeight, setContainerHeight] = useState(0);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const update = () => {
      setContainerHeight(el.clientHeight);
      setScrollbarWidth(el.offsetWidth - el.clientWidth);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollContainerRef]);

  const markers = useMemo(() => {
    const total = diffLines.length;
    if (total === 0) return [];

    const result: Marker[] = [];
    for (let i = 0; i < total; i++) {
      const line = diffLines[i];
      const pos = (i / total) * 100;

      if (line.newLineNum && threadLineSet.has(line.newLineNum)) {
        result.push({ position: pos, color: 'bg-blue-500', lineNum: line.newLineNum });
      } else if (line.type === 'added') {
        result.push({ position: pos, color: 'bg-green-500', lineNum: line.newLineNum });
      } else if (line.type === 'removed') {
        result.push({ position: pos, color: 'bg-red-500', lineNum: line.oldLineNum });
      }
    }

    // Consolidate markers that are very close together (< 0.5% apart) and same color
    const consolidated: Marker[] = [];
    for (const m of result) {
      const last = consolidated[consolidated.length - 1];
      if (last && last.color === m.color && m.position - last.position < 0.5) {
        continue;
      }
      consolidated.push(m);
    }
    return consolidated;
  }, [diffLines, threadLineSet]);

  const handleClick = useCallback(
    (lineNum: number | null) => {
      if (!lineNum || !scrollContainerRef.current) return;
      const el = scrollContainerRef.current.querySelector(`[data-line="${lineNum}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },
    [scrollContainerRef],
  );

  if (markers.length === 0 || containerHeight === 0) return null;

  return (
    <div
      className="absolute top-0 z-20 pointer-events-none"
      style={{ height: containerHeight, width: 10, right: scrollbarWidth }}
    >
      <div className="relative w-full h-full bg-gray-100/50 rounded-sm">
        {markers.map((m, i) => (
          <div
            key={i}
            className={`absolute w-full h-1 ${m.color} opacity-70 hover:opacity-100 cursor-pointer pointer-events-auto rounded-sm`}
            style={{ top: `${m.position}%` }}
            onClick={() => handleClick(m.lineNum)}
            title={m.color.includes('blue') ? `Comment at line ${m.lineNum}` : `Change at line ${m.lineNum ?? '?'}`}
          />
        ))}
      </div>
    </div>
  );
}
