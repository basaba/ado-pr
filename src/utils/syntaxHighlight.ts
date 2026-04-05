import Prism from 'prismjs';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-docker';

const extToLang: Record<string, string> = {
  '.cs': 'csharp',
  '.py': 'python',
  '.sh': 'bash',
  '.bash': 'bash',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.dockerfile': 'docker',
  '.tt': 'csharp',
  '.csproj': 'markup',
  '.xml': 'markup',
};

// Map filename (no extension) to language
const nameToLang: Record<string, string> = {
  'dockerfile': 'docker',
};

function getLanguage(filePath: string): string | null {
  const dot = filePath.lastIndexOf('.');
  const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (dot > slash + 1) {
    const ext = filePath.slice(dot).toLowerCase();
    return extToLang[ext] ?? null;
  }
  // No extension — try matching by filename
  const name = filePath.slice(slash + 1).toLowerCase();
  return nameToLang[name] ?? null;
}

/**
 * Highlight a single line of code and return an HTML string with Prism token classes.
 * Returns null if the language is unsupported (caller should render plain text).
 */
export function highlightLine(code: string, filePath: string): string | null {
  const lang = getLanguage(filePath);
  if (!lang) return null;
  const grammar = Prism.languages[lang];
  if (!grammar) return null;
  return Prism.highlight(code, grammar, lang);
}
