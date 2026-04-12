import { createPatch } from 'diff';

/**
 * Generate a unified-diff-style text from old and new file content.
 * Uses Myers diff algorithm via the 'diff' package.
 * Produces output LLMs understand well: lines prefixed with +/- and context.
 */
export function generateTextDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
  contextLines = 3,
): string {
  const patch = createPatch(filePath, oldContent, newContent, '', '', { context: contextLines });

  // createPatch always produces headers; strip the "Index:" and "===" lines
  const lines = patch.split('\n');
  const start = lines.findIndex(l => l.startsWith('---'));
  if (start === -1) return ''; // no changes

  // Replace createPatch's header with our a/ b/ format
  const result = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    ...lines.slice(start + 2), // skip createPatch's --- and +++ lines
  ];

  // Drop trailing empty line that createPatch may add
  while (result.length > 0 && result[result.length - 1] === '') result.pop();

  // If only headers remain, no actual changes
  if (result.length <= 2) return '';

  return result.join('\n');
}
