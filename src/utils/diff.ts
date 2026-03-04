/**
 * Generate a unified-diff-style text from old and new file content.
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

  // LCS via DP
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to produce diff entries
  type Entry = { type: 'ctx' | 'add' | 'del'; line: string; oldNum: number | null; newNum: number | null };
  const stack: Entry[] = [];
  let i = m, j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({ type: 'ctx', line: oldLines[i - 1], oldNum: i, newNum: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'add', line: newLines[j - 1], oldNum: null, newNum: j });
      j--;
    } else {
      stack.push({ type: 'del', line: oldLines[i - 1], oldNum: i, newNum: null });
      i--;
    }
  }

  const entries = stack.reverse();

  // Mark which entries are visible (changed lines + context)
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

    // Find contiguous visible range
    const start = k;
    while (k < entries.length && visible[k]) k++;
    const end = k;

    // Compute hunk header
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

  // If no actual changes, return empty
  if (out.length <= 2) return '';

  return out.join('\n');
}
