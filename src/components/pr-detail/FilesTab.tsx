import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { useDiff, useThreads } from '../../hooks';
import { useSearchParamStateNullable, useLocalStorageState } from '../../hooks';
import { changeTypeLabel, changeTypeBadgeColor } from '../../utils';
import { Badge, Spinner } from '../common';
import { DiffViewer, computeDiffLines, ScrollbarMinimap } from '../diff-viewer';
import type { DiffViewMode } from '../diff-viewer';
import type { PullRequestThread, IterationChange } from '../../types';

/** Displays a path that scrolls horizontally on hover when it overflows */
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

  const handleMouseLeave = () => setOffset(0);

  return (
    <div
      ref={outerRef}
      className="overflow-hidden min-w-0 flex-1"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
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

/** Extract the display path from an iteration change, falling back to originalPath for deletes */
function changePath(change: IterationChange): string | undefined {
  return change.item?.path ?? change.originalPath;
}

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
  currentUserId?: string;
  isPrOwner?: boolean;
  onMentionInserted?: (user: { id: string; displayName: string }) => void;
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
    const filePath = changePath(change);
    if (!filePath) continue;
    const parts = filePath.replace(/^\//, '').split('/');
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
    node.threadCount = (threadsByFile[filePath] || []).length;
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

export function FilesTab({ diff, threads, usersMap, navigateTarget, onNavigateHandled, currentUserId, isPrOwner, onMentionInserted }: Props) {
  const [selectedFile, setSelectedFile] = useSearchParamStateNullable('file');
  const [diffView, setDiffView] = useLocalStorageState<DiffViewMode>('ado-pr-diff-view', 'unified');
  const [fileContent, setFileContent] = useState<{
    oldContent: string;
    newContent: string;
  } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const dragging = useRef(false);
  const [scrollToLine, setScrollToLine] = useState<number | undefined>();
  const [hiddenThreadIds, setHiddenThreadIds] = useState<Set<number>>(new Set());
  const contentRef = useRef<HTMLDivElement>(null);
  const toolbarSentinelRef = useRef<HTMLDivElement>(null);
  const [isToolbarStuck, setIsToolbarStuck] = useState(false);
  const [toolbarHovered, setToolbarHovered] = useState(false);
  const [contentRect, setContentRect] = useState<{ left: number; width: number; top: number }>({ left: 0, width: 0, top: 0 });

  // Track content area position + parent sticky tab bar bottom for fixed toolbar overlay
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    // Find the sticky tab bar: walk up to the shadow container, then find its first sticky child
    const shadowContainer = el.closest('.shadow');
    const tabBar = shadowContainer?.querySelector(':scope > .sticky') as HTMLElement | null;
    const update = () => {
      const r = el.getBoundingClientRect();
      const tabBottom = tabBar ? tabBar.getBoundingClientRect().bottom : 0;
      setContentRect({ left: r.left, width: r.width, top: tabBottom });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('scroll', update, { passive: true });
    return () => { ro.disconnect(); window.removeEventListener('scroll', update); };
  }, []);

  // Detect when toolbar sentinel scrolls out of view (toolbar becomes "stuck")
  useEffect(() => {
    const sentinel = toolbarSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsToolbarStuck(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [selectedFile]);

  // Sidebar resize via drag handle
  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const newWidth = Math.min(Math.max(startWidth + ev.clientX - startX, 120), 600);
      setSidebarWidth(newWidth);
    };
    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  // Handle external navigation (e.g. from Threads tab)
  useEffect(() => {
    if (!navigateTarget) return;
    const { filePath, line } = navigateTarget;
    setScrollToLine(line);
    // Open the file
    setSelectedFile(filePath);
    setFileContent(null);
    setLoadingFile(true);
    const changeType = diff.changes.find((c) => changePath(c) === filePath)?.changeType;
    diff.fetchFilePair(filePath, changeType)
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
      const changeType = diff.changes.find((c) => changePath(c) === path)?.changeType;
      try {
        const content = await diff.fetchFilePair(path, changeType);
        setFileContent(content);
      } catch {
        setFileContent({ oldContent: '', newContent: '' });
      } finally {
        setLoadingFile(false);
      }
    },
    [selectedFile, diff],
  );

  // Auto-select the first file when the file tree is ready and nothing is selected
  useEffect(() => {
    if (selectedFile || navigateTarget) return;
    function firstLeaf(node: TreeNode): string | null {
      for (const child of node.children) {
        if (child.change) return child.path;
        const found = firstLeaf(child);
        if (found) return found;
      }
      return null;
    }
    const first = firstLeaf(fileTree);
    if (first) {
      handleFileClick(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileTree]);

  const toggleDir = useCallback((path: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const selectedChange = diff.changes.find((c) => changePath(c) === selectedFile);
  const fileThreads = selectedFile ? threadsByFile[selectedFile] || [] : [];

  const diffLines = useMemo(
    () => fileContent ? computeDiffLines(fileContent.oldContent, fileContent.newContent) : [],
    [fileContent],
  );

  const fileThreadLineSet = useMemo(() => {
    const set = new Set<number>();
    fileThreads.forEach((t) => {
      const line = t.threadContext?.rightFileStart?.line;
      if (line) set.add(line);
    });
    return set;
  }, [fileThreads]);

  if (diff.loading) return <Spinner className="py-10" />;
  if (diff.error) return <p className="text-red-600 dark:text-red-400 text-sm">{diff.error}</p>;
  if (diff.changes.length === 0) {
    return <p className="text-gray-400 dark:text-gray-500 text-sm italic">No file changes found.</p>;
  }

  return (
    <div className="flex gap-0">
      {/* File tree sidebar — stretches full height, content is sticky */}
      <div className="shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900" style={{ width: sidebarWidth }}>
        <div className="sticky top-[45px] overflow-y-auto" style={{ maxHeight: 'calc(100vh - 45px)' }}>
          <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-gray-50 dark:bg-gray-900 z-10">
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
      </div>

      {/* Drag handle to resize the sidebar */}
      <div
        onMouseDown={startDrag}
        className="w-1 cursor-col-resize hover:bg-blue-400 dark:hover:bg-blue-600 active:bg-blue-500 transition-colors shrink-0"
      />

      {/* Diff viewer area — flows naturally with page scroll */}
      <div className="flex-1 min-w-0" ref={contentRef}>
        {selectedFile && selectedChange ? (
          <div>
            {/* Sentinel: when this scrolls out of view, the toolbar is "stuck" */}
            <div ref={toolbarSentinelRef} />
            {/* When stuck, invisible hover zone at top of content area triggers reveal */}
            {isToolbarStuck && (
              <div
                className="fixed h-8 z-20"
                style={{ left: contentRect.left, width: contentRect.width, top: contentRect.top }}
                onMouseEnter={() => setToolbarHovered(true)}
                onMouseLeave={() => setToolbarHovered(false)}
              />
            )}
            {isToolbarStuck && toolbarHovered && (
              <div
                className="fixed z-20"
                style={{ left: contentRect.left, width: contentRect.width, top: contentRect.top }}
                onMouseEnter={() => setToolbarHovered(true)}
                onMouseLeave={() => setToolbarHovered(false)}
              >
                <div className="flex items-center gap-2 px-4 py-2 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 shadow-md">
                  <ScrollingPath text={selectedFile} />
                  <Badge
                    text={changeTypeLabel(selectedChange.changeType)}
                    color={changeTypeBadgeColor(selectedChange.changeType)}
                  />
                  {fileContent && <LineStats oldContent={fileContent.oldContent} newContent={fileContent.newContent} />}
                  {fileThreads.length > 0 && (
                    <span className="text-xs text-blue-600 dark:text-blue-400">💬 {fileThreads.length}</span>
                  )}
                  <DiffViewToggle value={diffView} onChange={setDiffView} />
                </div>
              </div>
            )}
            {!isToolbarStuck && (
              <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                <ScrollingPath text={selectedFile} />
                <Badge
                  text={changeTypeLabel(selectedChange.changeType)}
                  color={changeTypeBadgeColor(selectedChange.changeType)}
                />
                {fileContent && <LineStats oldContent={fileContent.oldContent} newContent={fileContent.newContent} />}
                {fileThreads.length > 0 && (
                  <span className="text-xs text-blue-600 dark:text-blue-400">💬 {fileThreads.length}</span>
                )}
                <DiffViewToggle value={diffView} onChange={setDiffView} />
              </div>
            )}
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
                onToggleLike={threads.toggleLike}
                usersMap={usersMap}
                currentUserId={currentUserId}
                isPrOwner={isPrOwner}
                hiddenThreadIds={hiddenThreadIds}
                onToggleHideThread={(threadId) => setHiddenThreadIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(threadId)) next.delete(threadId);
                  else next.add(threadId);
                  return next;
                })}
                onMentionInserted={onMentionInserted}
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

      {/* Minimap — sticky alongside diff content */}
      {diffLines.length > 0 && (
        <ScrollbarMinimap sticky diffLines={diffLines} threadLineSet={fileThreadLineSet} contentRef={contentRef} />
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
        {node.threadCount > 0 && (
          <span className="shrink-0 ml-auto text-blue-500 dark:text-blue-400 text-[10px]">💬{node.threadCount}</span>
        )}
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
      {added > 0 && <span className="text-green-600 dark:text-green-400 font-medium">+{added}</span>}
      {deleted > 0 && <span className="text-red-600 dark:text-red-400 font-medium">−{deleted}</span>}
      {added === 0 && deleted === 0 && <span className="text-gray-400 dark:text-gray-500">no changes</span>}
    </span>
  );
}

function DiffViewToggle({ value, onChange }: { value: DiffViewMode; onChange: (v: DiffViewMode) => void }) {
  const diffOptions: { key: DiffViewMode; label: string }[] = [
    { key: 'unified', label: 'Inline' },
    { key: 'split', label: 'Side by Side' },
  ];
  const fileOptions: { key: DiffViewMode; label: string }[] = [
    { key: 'original', label: 'Before' },
    { key: 'modified', label: 'After' },
  ];
  const renderGroup = (options: { key: DiffViewMode; label: string }[]) => (
    <span className="inline-flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden shrink-0">
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
  return (
    <span className="inline-flex gap-2 shrink-0 ml-1">
      {renderGroup(diffOptions)}
      {renderGroup(fileOptions)}
    </span>
  );
}
