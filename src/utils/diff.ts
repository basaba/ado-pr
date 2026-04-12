import { histogramDiff } from 'histogram-diff';

/**
 * Generate a unified-diff-style text from old and new file content.
 * Uses the histogram diff algorithm for minimal, readable diffs.
 * Produces output LLMs understand well: lines prefixed with +/- and context.
 */
export function generateTextDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
  contextLines = 3,
): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const regions = histogramDiff(oldLines, newLines);

  if (regions.length === 0) return '';

  // Build full diff entries from regions
  type Entry = { type: 'ctx' | 'add' | 'del'; line: string; oldNum: number | null; newNum: number | null };
  const entries: Entry[] = [];
  let oldIdx = 0;
  let newIdx = 0;

  for (const [aLo, aHi, bLo, bHi] of regions) {
    while (oldIdx < aLo && newIdx < bLo) {
      entries.push({ type: 'ctx', line: oldLines[oldIdx], oldNum: oldIdx + 1, newNum: newIdx + 1 });
      oldIdx++;
      newIdx++;
    }
    for (let i = aLo; i < aHi; i++) {
      entries.push({ type: 'del', line: oldLines[i], oldNum: i + 1, newNum: null });
    }
    for (let i = bLo; i < bHi; i++) {
      entries.push({ type: 'add', line: newLines[i], oldNum: null, newNum: i + 1 });
    }
    oldIdx = aHi;
    newIdx = bHi;
  }
  while (oldIdx < oldLines.length && newIdx < newLines.length) {
    entries.push({ type: 'ctx', line: oldLines[oldIdx], oldNum: oldIdx + 1, newNum: newIdx + 1 });
    oldIdx++;
    newIdx++;
  }

  // Mark visible entries (changed lines + context)
  const visible = new Array(entries.length).fill(false);
  for (let k = 0; k < entries.length; k++) {
    if (entries[k].type !== 'ctx') {
      for (let c = Math.max(0, k - contextLines); c <= Math.min(entries.length - 1, k + contextLines); c++) {
        visible[c] = true;
      }
    }
  }

  // Build unified diff text
  const out: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
  let k = 0;

  while (k < entries.length) {
    if (!visible[k]) { k++; continue; }

    const start = k;
    while (k < entries.length && visible[k]) k++;
    const end = k;

    const firstOld = entries.slice(start, end).find(e => e.oldNum != null)?.oldNum ?? 1;
    const firstNew = entries.slice(start, end).find(e => e.newNum != null)?.newNum ?? 1;
    const oldCount = entries.slice(start, end).filter(e => e.type !== 'add').length;
    const newCount = entries.slice(start, end).filter(e => e.type !== 'del').length;
    out.push(`@@ -${firstOld},${oldCount} +${firstNew},${newCount} @@`);

    for (let idx = start; idx < end; idx++) {
      const e = entries[idx];
      const prefix = e.type === 'add' ? '+' : e.type === 'del' ? '-' : ' ';
      out.push(`${prefix}${e.line}`);
    }
  }

  if (out.length <= 2) return '';
  return out.join('\n');
}
