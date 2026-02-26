import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { useDiff, useThreads } from '../../hooks';
import { changeTypeLabel, changeTypeBadgeColor } from '../../utils';
import { Badge, Spinner } from '../common';
import { DiffViewer } from '../diff-viewer/DiffViewer';
import type { PullRequestThread, IterationChange } from '../../types';

export interface FileNavigateTarget {
  filePath: string;
  line?: number;
}

interface Props {
  diff: ReturnType<typeof useDiff>;
  threads: ReturnType<typeof useThreads>;
  repoId: string;
  prId: number;
  usersMap?: Record<string, string>;
  navigateTarget?: FileNavigateTarget | null;
  onNavigateHandled?: () => void;
}

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  change?: IterationChange;
  threadCount: number;
}

function buildFileTree(
  changes: IterationChange[],
  threadsByFile: Record<string, PullRequestThread[]>,
): TreeNode {
  const root: TreeNode = { name: '', path: '', children: [], threadCount: 0 };

  for (const change of changes) {
    const parts = change.item.path.replace(/^\//, '').split('/');
    let node = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const partPath = '/' + parts.slice(0, i + 1).join('/');
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path: partPath, children: [], threadCount: 0 };
        node.children.push(child);
      }
      node = child;
    }

    node.change = change;
    node.threadCount = (threadsByFile[change.item.path] || []).length;
  }

  // Collapse single-child directories (e.g. src/api → src/api)
  function collapse(node: TreeNode): TreeNode {
    node.children = node.children.map(collapse);
    if (node.children.length === 1 && !node.change && node.name) {
      const child = node.children[0];
      if (!child.change) {
        return { ...child, name: `${node.name}/${child.name}` };
      }
    }
    // Sort: directories first, then files
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

export function FilesTab({ diff, threads, usersMap, navigateTarget, onNavigateHandled }: Props) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<{
    oldContent: string;
    newContent: string;
  } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const [scrollToLine, setScrollToLine] = useState<number | undefined>();
  const diffContainerRef = useRef<HTMLDivElement>(null);

  // Handle external navigation (e.g. from Threads tab)
  useEffect(() => {
    if (!navigateTarget) return;
    const { filePath, line } = navigateTarget;
    setScrollToLine(line);
    // Open the file
    setSelectedFile(filePath);
    setFileContent(null);
    setLoadingFile(true);
    diff.fetchFilePair(filePath)
      .then((content) => setFileContent(content))
      .catch(() => setFileContent({ oldContent: '', newContent: '' }))
      .finally(() => setLoadingFile(false));
    onNavigateHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateTarget]);

  // Group inline threads by file
  const threadsByFile: Record<string, PullRequestThread[]> = {};
  threads.threads.forEach((t) => {
    if (t.threadContext?.filePath) {
      const fp = t.threadContext.filePath;
      if (!threadsByFile[fp]) threadsByFile[fp] = [];
      threadsByFile[fp].push(t);
    }
  });

  const fileTree = useMemo(
    () => buildFileTree(diff.changes, threadsByFile),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [diff.changes, threads.threads],
  );

  const handleFileClick = useCallback(
    async (path: string) => {
      if (selectedFile === path) return;
      setSelectedFile(path);
      setFileContent(null);
      setLoadingFile(true);
      try {
        const content = await diff.fetchFilePair(path);
        setFileContent(content);
      } catch {
        setFileContent({ oldContent: '', newContent: '' });
      } finally {
        setLoadingFile(false);
      }
    },
    [selectedFile, diff],
  );

  const toggleDir = useCallback((path: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  if (diff.loading) return <Spinner className="py-10" />;
  if (diff.error) return <p className="text-red-600 text-sm">{diff.error}</p>;
  if (diff.changes.length === 0) {
    return <p className="text-gray-400 text-sm italic">No file changes found.</p>;
  }

  const selectedChange = diff.changes.find((c) => c.item.path === selectedFile);
  const fileThreads = selectedFile ? threadsByFile[selectedFile] || [] : [];

  return (
    <div className="flex gap-0">
      {/* File tree sidebar */}
      <div className="w-64 shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto" style={{ height: 'calc(100vh - 220px)' }}>
        <div className="px-3 py-2 text-xs font-semibold text-gray-500 border-b border-gray-200 sticky top-0 bg-gray-50 z-10">
          {diff.changes.length} changed file{diff.changes.length !== 1 ? 's' : ''}
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

      {/* Diff viewer area */}
      <div className="flex-1 min-w-0 overflow-x-auto" style={{ height: 'calc(100vh - 220px)', overflowY: 'auto' }}>
        {selectedFile && selectedChange ? (
          <div>
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
              <span className="font-mono text-sm text-gray-800 truncate">{selectedFile}</span>
              <Badge
                text={changeTypeLabel(selectedChange.changeType)}
                color={changeTypeBadgeColor(selectedChange.changeType)}
              />
              {fileContent && <LineStats oldContent={fileContent.oldContent} newContent={fileContent.newContent} />}
              {fileThreads.length > 0 && (
                <span className="text-xs text-blue-600">💬 {fileThreads.length}</span>
              )}
            </div>
            {loadingFile ? (
              <Spinner className="py-10" />
            ) : fileContent ? (
              <DiffViewer
                oldContent={fileContent.oldContent}
                newContent={fileContent.newContent}
                filePath={selectedFile}
                threads={fileThreads}
                scrollToLine={scrollToLine}
                onScrollHandled={() => setScrollToLine(undefined)}
                onAddComment={async (content, line) => {
                  await threads.addThread(content, {
                    filePath: selectedFile,
                    rightFileStart: { line, offset: 1 },
                    rightFileEnd: { line, offset: 1 },
                  });
                }}
                onReply={threads.reply}
                onSetStatus={threads.setStatus}
                onDeleteComment={threads.removeComment}
                usersMap={usersMap}
              />
            ) : null}
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
            Select a file to view changes
          </div>
        )}
      </div>
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
    add: 'text-green-600',
    edit: 'text-blue-600',
    delete: 'text-red-600',
    rename: 'text-yellow-600',
  };

  if (isFile) {
    return (
      <div
        className={`flex items-center gap-1.5 py-1 pr-2 cursor-pointer text-xs transition-colors truncate ${
          isSelected
            ? 'bg-blue-100 text-blue-900 font-medium'
            : 'text-gray-700 hover:bg-gray-100'
        }`}
        style={{ paddingLeft }}
        onClick={() => onFileClick(node.path)}
        title={node.path}
      >
        <span className={`shrink-0 ${changeColor[node.change!.changeType] || 'text-gray-400'}`}>
          {node.change!.changeType === 'add' ? '●' : node.change!.changeType === 'delete' ? '●' : '●'}
        </span>
        <span className="truncate">{node.name}</span>
        {node.threadCount > 0 && (
          <span className="shrink-0 ml-auto text-blue-500 text-[10px]">💬{node.threadCount}</span>
        )}
      </div>
    );
  }

  if (isDir) {
    return (
      <>
        <div
          className="flex items-center gap-1.5 py-1 pr-2 cursor-pointer text-xs text-gray-500 hover:bg-gray-100 transition-colors"
          style={{ paddingLeft }}
          onClick={() => onToggleDir(node.path)}
        >
          <span className="shrink-0 text-gray-400 w-3 text-center">
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

  // Quick diff count using simple LCS length
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
      {added > 0 && <span className="text-green-600 font-medium">+{added}</span>}
      {deleted > 0 && <span className="text-red-600 font-medium">−{deleted}</span>}
      {added === 0 && deleted === 0 && <span className="text-gray-400">no changes</span>}
    </span>
  );
}
