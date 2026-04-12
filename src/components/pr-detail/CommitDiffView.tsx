import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useCommitDiff } from '../../hooks/useCommitDiff';
import { useSearchParamStateNullable, useLocalStorageState } from '../../hooks';
import { changeTypeLabel, changeTypeBadgeColor } from '../../utils';
import { Badge, Spinner } from '../common';
import { DiffViewer, computeDiffLines, ScrollbarMinimap } from '../diff-viewer';
import type { DiffViewMode } from '../diff-viewer';
import type { CommitChangeNormalized } from '../../api/commits';

function ScrollingPath({ text }: { text: string }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [offset, setOffset] = useState(0);

  const handleMouseEnter = () => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (outer && inner && inner.scrollWidth > outer.clientWidth) {
      setOffset(inner.scrollWidth - outer.clientWidth);
    }
  };

  return (
    <div
      ref={outerRef}
      className="overflow-hidden min-w-0 flex-1"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setOffset(0)}
    >
      <span
        ref={innerRef}
        className="font-mono text-sm text-gray-800 dark:text-gray-100 whitespace-nowrap inline-block transition-transform duration-500 ease-in-out"
        style={{ transform: `translateX(-${offset}px)` }}
      >
        {text}
      </span>
    </div>
  );
}

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  change?: CommitChangeNormalized;
}

function buildFileTree(changes: CommitChangeNormalized[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: [] };

  for (const change of changes) {
    const parts = change.path.replace(/^\//, '').split('/');
    let node = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const partPath = '/' + parts.slice(0, i + 1).join('/');
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path: partPath, children: [] };
        node.children.push(child);
      }
      node = child;
    }

    node.change = change;
  }

  function collapse(node: TreeNode): TreeNode {
    node.children = node.children.map(collapse);
    if (node.children.length === 1 && !node.change && node.name) {
      const child = node.children[0];
      if (!child.change) {
        return { ...child, name: `${node.name}/${child.name}` };
      }
    }
    node.children.sort((a, b) => {
      const aDir = a.children.length > 0 && !a.change ? 0 : 1;
      const bDir = b.children.length > 0 && !b.change ? 0 : 1;
      if (aDir !== bDir) return aDir - bDir;
      return a.name.localeCompare(b.name);
    });
    return node;
  }

  return collapse(root);
}

interface Props {
  repoId: string;
  commitId: string;
}

export function CommitDiffView({ repoId, commitId }: Props) {
  const { changes, loading, error, fetchFilePair } = useCommitDiff(repoId, commitId);
  const [selectedFile, setSelectedFile] = useSearchParamStateNullable('commitFile');
  const [diffView, setDiffView] = useLocalStorageState<DiffViewMode>('ado-pr-diff-view', 'unified');
  const [fileContent, setFileContent] = useState<{ oldContent: string; newContent: string } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const dragging = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const fileTree = useMemo(() => buildFileTree(changes), [changes]);

  const handleFileClick = useCallback(
    async (path: string) => {
      if (selectedFile === path) return;
      setSelectedFile(path);
      setFileContent(null);
      setLoadingFile(true);
      const changeType = changes.find((c) => c.path === path)?.changeType;
      try {
        const content = await fetchFilePair(path, changeType);
        setFileContent(content);
      } catch {
        setFileContent({ oldContent: '', newContent: '' });
      } finally {
        setLoadingFile(false);
      }
    },
    [selectedFile, changes, fetchFilePair, setSelectedFile],
  );

  // Auto-select first file
  useEffect(() => {
    if (selectedFile) return;
    function firstLeaf(node: TreeNode): string | null {
      for (const child of node.children) {
        if (child.change) return child.path;
        const found = firstLeaf(child);
        if (found) return found;
      }
      return null;
    }
    const first = firstLeaf(fileTree);
    if (first) handleFileClick(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileTree]);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      setSidebarWidth(Math.min(Math.max(startWidth + ev.clientX - startX, 120), 600));
    };
    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  const toggleDir = useCallback((path: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const selectedChange = changes.find((c) => c.path === selectedFile);

  const diffLines = useMemo(
    () => fileContent ? computeDiffLines(fileContent.oldContent, fileContent.newContent) : [],
    [fileContent],
  );

  if (loading) return <Spinner className="py-10" />;
  if (error) return <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>;
  if (changes.length === 0) {
    return <p className="text-gray-400 dark:text-gray-500 text-sm italic">No file changes found in this commit.</p>;
  }

  return (
    <div className="flex gap-0">
      {/* File tree sidebar */}
      <div className="shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900" style={{ width: sidebarWidth }}>
        <div className="sticky top-0 overflow-y-auto" style={{ maxHeight: '100vh' }}>
          <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-gray-50 dark:bg-gray-900 z-10">
            {changes.length} changed file{changes.length !== 1 ? 's' : ''}
          </div>
          <div className="py-1">
            {fileTree.children.map((node) => (
              <FileTreeNode
                key={node.path}
                node={node}
                depth={0}
                selectedFile={selectedFile}
                collapsedDirs={collapsedDirs}
                onFileClick={handleFileClick}
                onToggleDir={toggleDir}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={startDrag}
        className="w-1 cursor-col-resize hover:bg-blue-400 dark:hover:bg-blue-600 active:bg-blue-500 transition-colors shrink-0"
      />

      {/* Diff viewer area */}
      <div className="flex-1 min-w-0" ref={contentRef}>
        {selectedFile && selectedChange ? (
          <div>
            <div className="sticky top-0 z-10 group/toolbar">
              <div className="h-1 bg-gray-200/50 dark:bg-gray-700/50 group-hover/toolbar:h-auto" />
              <div className="max-h-0 group-hover/toolbar:max-h-20 overflow-hidden transition-all duration-150 ease-out">
                <div className="flex items-center gap-2 px-4 py-2 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700">
                  <ScrollingPath text={selectedFile} />
                  <Badge
                    text={changeTypeLabel(selectedChange.changeType)}
                    color={changeTypeBadgeColor(selectedChange.changeType)}
                  />
                  {fileContent && <LineStats oldContent={fileContent.oldContent} newContent={fileContent.newContent} />}
                  <DiffViewToggle value={diffView} onChange={setDiffView} />
                </div>
              </div>
            </div>
            {loadingFile ? (
              <Spinner className="py-10" />
            ) : fileContent ? (
              <DiffViewer
                oldContent={fileContent.oldContent}
                newContent={fileContent.newContent}
                filePath={selectedFile}
                threads={[]}
                onAddComment={async () => {}}
                onReply={async () => {}}
                onSetStatus={async () => {}}
                viewMode={diffView}
              />
            ) : null}
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 text-gray-400 dark:text-gray-500 text-sm">
            Select a file to view changes
          </div>
        )}
      </div>

      {/* Minimap */}
      {diffLines.length > 0 && (
        <ScrollbarMinimap sticky diffLines={diffLines} threadLineSet={new Set()} contentRef={contentRef} />
      )}
    </div>
  );
}

function FileTreeNode({
  node,
  depth,
  selectedFile,
  collapsedDirs,
  onFileClick,
  onToggleDir,
}: {
  node: TreeNode;
  depth: number;
  selectedFile: string | null;
  collapsedDirs: Set<string>;
  onFileClick: (path: string) => void;
  onToggleDir: (path: string) => void;
}) {
  const isFile = !!node.change;
  const isDir = !isFile && node.children.length > 0;
  const isCollapsed = collapsedDirs.has(node.path);
  const isSelected = selectedFile === node.path;
  const paddingLeft = 12 + depth * 16;

  const changeColor: Record<string, string> = {
    add: 'text-green-600 dark:text-green-400',
    edit: 'text-blue-600 dark:text-blue-400',
    delete: 'text-red-600 dark:text-red-400',
    rename: 'text-yellow-600 dark:text-yellow-400',
  };

  if (isFile) {
    return (
      <div
        className={`flex items-center gap-1.5 py-1 pr-2 cursor-pointer text-xs transition-colors truncate ${
          isSelected
            ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-200 font-medium'
            : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
        }`}
        style={{ paddingLeft }}
        onClick={() => onFileClick(node.path)}
        title={node.path}
      >
        <span className={`shrink-0 ${changeColor[node.change!.changeType] || 'text-gray-400 dark:text-gray-500'}`}>
          {node.change!.changeType === 'add' ? '+' : node.change!.changeType === 'delete' ? '−' : '●'}
        </span>
        <span className={`truncate ${node.change!.changeType === 'delete' ? 'line-through opacity-60' : ''}`}>{node.name}</span>
      </div>
    );
  }

  if (isDir) {
    return (
      <>
        <div
          className="flex items-center gap-1.5 py-1 pr-2 cursor-pointer text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          style={{ paddingLeft }}
          onClick={() => onToggleDir(node.path)}
        >
          <span className="shrink-0 text-gray-400 dark:text-gray-500 w-3 text-center">
            {isCollapsed ? '▸' : '▾'}
          </span>
          <span className="font-medium truncate">{node.name}</span>
        </div>
        {!isCollapsed &&
          node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFile={selectedFile}
              collapsedDirs={collapsedDirs}
              onFileClick={onFileClick}
              onToggleDir={onToggleDir}
            />
          ))}
      </>
    );
  }

  return null;
}

function LineStats({ oldContent, newContent }: { oldContent: string; newContent: string }) {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const common = dp[m][n];
  const added = n - common;
  const deleted = m - common;

  return (
    <span className="flex items-center gap-1.5 text-xs font-mono ml-auto shrink-0">
      {added > 0 && <span className="text-green-600 dark:text-green-400 font-medium">+{added}</span>}
      {deleted > 0 && <span className="text-red-600 dark:text-red-400 font-medium">−{deleted}</span>}
      {added === 0 && deleted === 0 && <span className="text-gray-400 dark:text-gray-500">no changes</span>}
    </span>
  );
}

function DiffViewToggle({ value, onChange }: { value: DiffViewMode; onChange: (v: DiffViewMode) => void }) {
  const options: { key: DiffViewMode; label: string }[] = [
    { key: 'unified', label: 'Inline' },
    { key: 'split', label: 'Side by Side' },
    { key: 'original', label: 'Before' },
    { key: 'modified', label: 'After' },
  ];
  return (
    <span className="inline-flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden shrink-0 ml-1">
      {options.map((opt, i) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`px-2 py-0.5 text-[11px] font-medium transition-colors ${i > 0 ? 'border-l border-gray-200 dark:border-gray-700' : ''} ${
            value === opt.key
              ? 'bg-blue-500 text-white'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </span>
  );
}
