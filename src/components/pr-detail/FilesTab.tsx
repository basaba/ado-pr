import { useState, useCallback } from 'react';
import type { useDiff, useThreads } from '../../hooks';
import { changeTypeLabel, changeTypeBadgeColor } from '../../utils';
import { Badge, Spinner } from '../common';
import { DiffViewer } from '../diff-viewer/DiffViewer';
import type { PullRequestThread } from '../../types';

interface Props {
  diff: ReturnType<typeof useDiff>;
  threads: ReturnType<typeof useThreads>;
  repoId: string;
  prId: number;
}

export function FilesTab({ diff, threads }: Props) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<{
    oldContent: string;
    newContent: string;
  } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  const handleFileClick = useCallback(
    async (path: string) => {
      if (selectedFile === path) {
        setSelectedFile(null);
        setFileContent(null);
        return;
      }
      setSelectedFile(path);
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

  if (diff.loading) return <Spinner className="py-10" />;
  if (diff.error)
    return <p className="text-red-600 text-sm">{diff.error}</p>;

  if (diff.changes.length === 0) {
    return <p className="text-gray-400 text-sm italic">No file changes found.</p>;
  }

  // Group inline threads by file
  const threadsByFile: Record<string, PullRequestThread[]> = {};
  threads.threads.forEach((t) => {
    if (t.threadContext?.filePath) {
      const fp = t.threadContext.filePath;
      if (!threadsByFile[fp]) threadsByFile[fp] = [];
      threadsByFile[fp].push(t);
    }
  });

  return (
    <div>
      <div className="text-sm text-gray-500 mb-3">
        {diff.changes.length} file{diff.changes.length !== 1 ? 's' : ''} changed
      </div>

      <div className="border border-gray-200 rounded-lg divide-y divide-gray-200">
        {diff.changes.map((change) => {
          const filePath = change.item.path;
          const isOpen = selectedFile === filePath;
          const fileThreads = threadsByFile[filePath] || [];

          return (
            <div key={change.changeId}>
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => handleFileClick(filePath)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-gray-400">{isOpen ? '▾' : '▸'}</span>
                  <span className="font-mono text-sm text-gray-800 truncate">
                    {filePath}
                  </span>
                  {fileThreads.length > 0 && (
                    <span className="text-xs text-blue-600">
                      💬 {fileThreads.length}
                    </span>
                  )}
                </div>
                <Badge
                  text={changeTypeLabel(change.changeType)}
                  color={changeTypeBadgeColor(change.changeType)}
                />
              </div>

              {isOpen && (
                <div className="border-t border-gray-100 bg-gray-50">
                  {loadingFile ? (
                    <Spinner className="py-6" />
                  ) : fileContent ? (
                    <DiffViewer
                      oldContent={fileContent.oldContent}
                      newContent={fileContent.newContent}
                      filePath={filePath}
                      threads={fileThreads}
                      onAddComment={async (content, line) => {
                        await threads.addThread(content, {
                          filePath,
                          rightFileStart: { line, offset: 1 },
                          rightFileEnd: { line, offset: 1 },
                        });
                      }}
                      onReply={threads.reply}
                      onSetStatus={threads.setStatus}
                    />
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
