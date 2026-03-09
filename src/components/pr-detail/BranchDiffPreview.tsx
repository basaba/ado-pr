import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getBranchDiff, getFileContentByBranch } from '../../api';
import type { BranchDiffChange } from '../../api/diffs';
import { Spinner, Badge } from '../common';
import { DiffViewer, computeDiffLines, ScrollbarMinimap } from '../diff-viewer';
import { changeTypeLabel, changeTypeBadgeColor } from '../../utils';

interface Props {
  repoId: string;
  sourceBranch: string;
  targetBranch: string;
}

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  change?: BranchDiffChange;
}

function buildFileTree(changes: BranchDiffChange[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: [] };

  for (const change of changes) {
    const parts = change.item.path.replace(/^\//, '').split('/');
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

const noop = async () => {};

export function BranchDiffPreview({ repoId, sourceBranch, targetBranch }: Props) {
  const [changes, setChanges] = useState<BranchDiffChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<{ oldContent: string; newContent: string } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!repoId || !sourceBranch || !targetBranch) return;
    setLoading(true);
    setError(null);
    setChanges([]);
    setSelectedFile(null);
    setFileContent(null);
    getBranchDiff(repoId, sourceBranch, targetBranch)
      .then((data) => {
        setChanges(data.filter((c) => c.item?.path));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load diff'))
      .finally(() => setLoading(false));
  }, [repoId, sourceBranch, targetBranch]);

  const fileTree = useMemo(() => buildFileTree(changes), [changes]);

  const handleFileClick = useCallback(
    async (path: string) => {
      if (selectedFile === path) return;
      setSelectedFile(path);
      setFileContent(null);
      setLoadingFile(true);
      try {
        const [oldContent, newContent] = await Promise.all([
          getFileContentByBranch(repoId, path, targetBranch),
          getFileContentByBranch(repoId, path, sourceBranch),
        ]);
        setFileContent({ oldContent, newContent });
      } catch {
        setFileContent({ oldContent: '', newContent: '' });
      } finally {
        setLoadingFile(false);
      }
    },
    [repoId, sourceBranch, targetBranch, selectedFile],
  );

  const toggleDir = useCallback((path: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const selectedChange = changes.find((c) => c.item.path === selectedFile);

  const diffLines = useMemo(
    () => fileContent ? computeDiffLines(fileContent.oldContent, fileContent.newContent) : [],
    [fileContent],
  );

  const emptyThreadLineSet = useMemo(() => new Set<number>(), []);

  if (loading) return <Spinner className="py-6" />;
  if (error) return <p className="text-red-600 dark:text-red-400 text-sm py-4">{error}</p>;
  if (changes.length === 0) {
    return <p className="text-gray-400 dark:text-gray-500 text-sm italic py-4">No differences between branches.</p>;
  }

  return (
    <div className="flex gap-0 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* File tree sidebar */}
      <div className="w-60 shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 overflow-y-auto" style={{ maxHeight: '500px' }}>
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

      {/* Diff viewer area — wrapper for scroll container + minimap */}
      <div className="flex-1 min-w-0 relative" style={{ maxHeight: '500px' }}>
        <div ref={scrollContainerRef} className="h-full overflow-x-auto overflow-y-auto">
          {selectedFile && selectedChange ? (
            <div>
              <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
                <span className="font-mono text-sm text-gray-800 dark:text-gray-100 truncate">{selectedFile}</span>
                <Badge
                  text={changeTypeLabel(selectedChange.changeType)}
                  color={changeTypeBadgeColor(selectedChange.changeType)}
                />
              </div>
              {loadingFile ? (
                <Spinner className="py-10" />
              ) : fileContent ? (
                <DiffViewer
                  oldContent={fileContent.oldContent}
                  newContent={fileContent.newContent}
                  filePath={selectedFile}
                  threads={[]}
                  onAddComment={noop}
                  onReply={noop}
                  onSetStatus={noop}
                />
              ) : null}
            </div>
          ) : (
            <div className="flex items-center justify-center h-48 text-gray-400 dark:text-gray-500 text-sm">
              Select a file to view changes
            </div>
          )}
        </div>
        {diffLines.length > 0 && (
          <ScrollbarMinimap diffLines={diffLines} threadLineSet={emptyThreadLineSet} scrollContainerRef={scrollContainerRef} />
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
        <span className={`shrink-0 ${changeColor[node.change!.changeType] || 'text-gray-400 dark:text-gray-500'}`}>●</span>
        <span className="truncate">{node.name}</span>
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
