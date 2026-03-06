import { useMemo, useCallback, useState, useEffect, type RefObject } from 'react';
import type { DiffLine } from './DiffViewer';

interface Marker {
  startPos: number;  // percentage (0–100)
  endPos: number;    // percentage (0–100)
  color: string;
  lineNum: number | null;
}

interface BaseProps {
  diffLines: DiffLine[];
  threadLineSet: Set<number>;
}

interface ContainerProps extends BaseProps {
  sticky?: false;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

interface StickyProps extends BaseProps {
  sticky: true;
  contentRef: RefObject<HTMLDivElement | null>;
}

type Props = ContainerProps | StickyProps;

/**
 * Renders change/comment markers alongside the scrollbar.
 * In container mode: absolutely positioned inside a relative wrapper around a scroll container.
 * In sticky mode: sticky-positioned as a flex sibling to flowing content (page scroll).
 */
export function ScrollbarMinimap(props: Props) {
  const { diffLines, threadLineSet } = props;
  const [containerHeight, setContainerHeight] = useState(0);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);

  useEffect(() => {
    if (props.sticky) {
      const contentEl = props.contentRef.current;
      const update = () => {
        const contentHeight = contentEl?.scrollHeight ?? window.innerHeight;
        setContainerHeight(Math.min(window.innerHeight, contentHeight));
      };
      update();
      window.addEventListener('resize', update);
      const ro = contentEl ? new ResizeObserver(update) : null;
      if (contentEl) ro!.observe(contentEl);
      return () => {
        window.removeEventListener('resize', update);
        ro?.disconnect();
      };
    }

    const el = props.scrollContainerRef.current;
    if (!el) return;
    const update = () => {
      setContainerHeight(el.clientHeight);
      setScrollbarWidth(el.offsetWidth - el.clientWidth);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [props.sticky, props.sticky ? (props as StickyProps).contentRef : (props as ContainerProps).scrollContainerRef]);

  const markers = useMemo(() => {
    const total = diffLines.length;
    if (total === 0) return [];

    // Minimum visual height for a marker as a percentage of total
    const minHeight = Math.max(0.4, (1 / total) * 100);
    // Gap threshold: merge same-color markers within this distance
    const mergeGap = Math.max(0.8, (2 / total) * 100);

    const raw: Marker[] = [];
    for (let i = 0; i < total; i++) {
      const line = diffLines[i];
      const pos = (i / total) * 100;

      if (line.newLineNum && threadLineSet.has(line.newLineNum)) {
        raw.push({ startPos: pos, endPos: pos, color: 'bg-blue-500', lineNum: line.newLineNum });
      } else if (line.type === 'added') {
        raw.push({ startPos: pos, endPos: pos, color: 'bg-green-500', lineNum: line.newLineNum });
      } else if (line.type === 'removed') {
        raw.push({ startPos: pos, endPos: pos, color: 'bg-red-500', lineNum: line.oldLineNum });
      }
    }

    // Merge consecutive same-color markers that are close together into larger bars
    const merged: Marker[] = [];
    for (const m of raw) {
      const last = merged[merged.length - 1];
      if (last && last.color === m.color && m.startPos - last.endPos <= mergeGap) {
        last.endPos = m.endPos;
      } else {
        merged.push({ ...m });
      }
    }

    // Enforce minimum height so tiny changes are still visible
    for (const m of merged) {
      if (m.endPos - m.startPos < minHeight) {
        m.endPos = m.startPos + minHeight;
      }
    }

    return merged;
  }, [diffLines, threadLineSet]);

  const handleClick = useCallback(
    (lineNum: number | null) => {
      if (!lineNum) return;
      const root = props.sticky
        ? props.contentRef.current
        : props.scrollContainerRef.current;
      const el = root?.querySelector(`[data-line="${lineNum}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
    },
    [props.sticky, props.sticky ? (props as StickyProps).contentRef : (props as ContainerProps).scrollContainerRef],
  );

  if (markers.length === 0 || containerHeight === 0) return null;

  const markerElements = markers.map((m, i) => (
    <div
      key={i}
      className={`absolute w-full ${m.color} opacity-70 hover:opacity-100 cursor-pointer pointer-events-auto rounded-sm`}
      style={{ top: `${m.startPos}%`, height: `max(3px, ${m.endPos - m.startPos}%)` }}
      onClick={() => handleClick(m.lineNum)}
      title={m.color.includes('blue') ? `Comment at line ${m.lineNum}` : `Change at line ${m.lineNum ?? '?'}`}
    />
  ));

  return (
    <div
      className={
        props.sticky
          ? 'sticky top-0 self-start z-20 pointer-events-none shrink-0'
          : 'absolute top-0 z-20 pointer-events-none'
      }
      style={
        props.sticky
          ? { height: containerHeight, width: 10 }
          : { height: containerHeight, width: 10, right: scrollbarWidth }
      }
    >
      <div className="relative w-full h-full bg-gray-100/50 rounded-sm">
        {markerElements}
      </div>
    </div>
  );
}
