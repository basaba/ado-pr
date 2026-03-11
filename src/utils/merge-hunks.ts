import { computeDiffLines } from '../components/diff-viewer/DiffViewer';

export interface MergeHunk {
  id: number;
  type: 'unchanged' | 'conflict';
  oursLines: string[];
  theirsLines: string[];
}

export type HunkSelection = Record<number, 'ours' | 'theirs'>;

/**
 * Compute merge hunks by diffing ours vs theirs content.
 * Groups consecutive same-type diff lines into hunks.
 * Unchanged regions become 'unchanged' hunks; changed regions become 'conflict' hunks.
 */
export function computeMergeHunks(oursContent: string, theirsContent: string): MergeHunk[] {
  const diffLines = computeDiffLines(oursContent, theirsContent);
  const hunks: MergeHunk[] = [];
  let hunkId = 0;
  let i = 0;

  while (i < diffLines.length) {
    const line = diffLines[i];

    if (line.type === 'unchanged') {
      // Collect consecutive unchanged lines
      const lines: string[] = [];
      while (i < diffLines.length && diffLines[i].type === 'unchanged') {
        lines.push(diffLines[i].content);
        i++;
      }
      hunks.push({
        id: hunkId++,
        type: 'unchanged',
        oursLines: lines,
        theirsLines: lines,
      });
    } else {
      // Collect consecutive changed lines (removed = ours, added = theirs)
      const removed: string[] = [];
      const added: string[] = [];

      while (i < diffLines.length && diffLines[i].type !== 'unchanged') {
        const dl = diffLines[i];
        if (dl.type === 'removed') removed.push(dl.content);
        else if (dl.type === 'added') added.push(dl.content);
        i++;
      }

      hunks.push({
        id: hunkId++,
        type: 'conflict',
        oursLines: removed,
        theirsLines: added,
      });
    }
  }

  return hunks;
}

/**
 * Build merged file content from hunks and user selections.
 * Unchanged hunks are always included. Conflict hunks use the selected side.
 * Unresolved conflict hunks insert a placeholder marker.
 */
export function buildMergedContent(hunks: MergeHunk[], selections: HunkSelection): string {
  const parts: string[] = [];

  for (const hunk of hunks) {
    if (hunk.type === 'unchanged') {
      parts.push(...hunk.oursLines);
    } else {
      const sel = selections[hunk.id];
      if (sel === 'ours') {
        parts.push(...hunk.oursLines);
      } else if (sel === 'theirs') {
        parts.push(...hunk.theirsLines);
      } else {
        parts.push(`<<<< unresolved conflict (hunk #${hunk.id + 1}) >>>>`);
      }
    }
  }

  return parts.join('\n');
}

/** Returns true if every conflict hunk has a selection. */
export function allConflictsResolved(hunks: MergeHunk[], selections: HunkSelection): boolean {
  return hunks
    .filter((h) => h.type === 'conflict')
    .every((h) => selections[h.id] === 'ours' || selections[h.id] === 'theirs');
}

/** Count total conflict hunks and how many are resolved. */
export function conflictProgress(
  hunks: MergeHunk[],
  selections: HunkSelection
): { total: number; resolved: number } {
  const conflicts = hunks.filter((h) => h.type === 'conflict');
  const resolved = conflicts.filter(
    (h) => selections[h.id] === 'ours' || selections[h.id] === 'theirs'
  ).length;
  return { total: conflicts.length, resolved };
}
