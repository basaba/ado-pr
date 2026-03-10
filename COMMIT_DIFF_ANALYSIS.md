# COMMIT DIFF VIEW - COMPREHENSIVE IMPLEMENTATION GUIDE

## EXECUTIVE SUMMARY

You have **95% of the diff infrastructure already built**. Here's what exists and what needs to be added:

### ✅ What Already Exists
- **DiffViewer** (`src/components/diff-viewer/DiffViewer.tsx`) - Fully featured, renders unified/split diffs
- **File content APIs** (`getFileContent`) - Already fetches files at any commit
- **Diff algorithm** (`computeDiffLines`) - LCS-based diff calculation
- **FilesTab layout** - File tree sidebar + diff viewer pattern
- **ScrollbarMinimap** - Visual change/comment markers
- **Commit list hook** (`useCommits`) - Gets all PR commits

### ❌ What Needs to Be Added
1. **API function**: `getCommitChanges()` - Get files changed in a single commit
2. **Hook**: `useCommitDiff()` - Manage commit diff state
3. **Component**: `CommitDiffView` - Display commit's file diffs (copy FilesTab structure)
4. **Update CommitsTab**: Make commit rows expandable

---

## DETAILED ANALYSIS

### 1. DiffViewer Component (1,095 lines)
**Location**: `src/components/diff-viewer/DiffViewer.tsx`

**What it does**:
- Renders unified (inline) or split (side-by-side) diffs
- Performs LCS algorithm to calculate diff lines
- Supports inline comments (add, reply, resolve)
- Shows scroll minimap with change/comment markers
- Collapses unchanged sections, expandable on demand
- Supports scroll-to-line for deep linking

**Key Exports**:
```typescript
export function DiffViewer(props: Props): JSX.Element
export function computeDiffLines(oldText: string, newText: string): DiffLine[]
export function computeSplitPairs(diffLines: DiffLine[]): SplitPair[]
```

**Props Interface**:
```typescript
interface Props {
  oldContent: string;
  newContent: string;
  filePath: string;
  threads: PullRequestThread[];        // Empty array for commit diffs
  onAddComment: (content: string, line: number) => Promise<void>;
  onReply: (threadId: number, content: string) => Promise<void>;
  onSetStatus: (threadId: number, status: ThreadStatus) => Promise<void>;
  onDeleteComment?: (threadId: number, commentId: number) => Promise<void>;
  onToggleLike?: (threadId: number, commentId: number, currentUserId: string) => Promise<void>;
  usersMap?: Record<string, string>;
  currentUserId?: string;
  isPrOwner?: boolean;
  hiddenThreadIds?: Set<number>;
  onToggleHideThread?: (threadId: number) => void;
  scrollToLine?: number;
  onScrollHandled?: () => void;
  onMentionInserted?: (user: IdentitySearchResult) => void;
  viewMode?: 'unified' | 'split';
}
```

**For commit diffs, you can pass**:
- `threads=[]` (no inline comments on commits)
- Stub implementations for comment handlers
- All other props are optional or can be empty

---

### 2. Current PR Diff Flow

#### useDiff Hook (`src/hooks/useDiff.ts`)
```typescript
export function useDiff(repoId: string, prId: number) {
  // 1. Lists all PR iterations
  // 2. Gets changes from LATEST iteration only
  // 3. Fetches file content at targetRefCommit (base) and sourceRefCommit (tip)
  
  const fetchFilePair = async (path, changeType) => {
    const oldContent = getFileContent(repoId, path, lastIter.targetRefCommit.commitId);
    const newContent = getFileContent(repoId, path, lastIter.sourceRefCommit.commitId);
    return { oldContent, newContent };
  };
}
```

#### FilesTab Component (`src/components/pr-detail/FilesTab.tsx`)
- Builds file tree from PR diff changes
- Renders file tree sidebar (with collapsible directories)
- On file click: fetches old/new content via `diff.fetchFilePair()`
- Renders DiffViewer with the content
- Supports thread-aware line highlighting

---

### 3. What ADO APIs Provide

#### Existing APIs Used
```typescript
// List iterations for a PR
GET /git/repositories/{repoId}/pullrequests/{prId}/iterations
→ PullRequestIteration[]

// Get changes in an iteration
GET /git/repositories/{repoId}/pullrequests/{prId}/iterations/{iterationId}/changes
→ { changeEntries: IterationChange[] }

// Get file content at a commit
GET /git/repositories/{repoId}/items?path={path}&versionDescriptor.version={commitId}
→ string (file content)

// List commits in a PR
GET /git/repositories/{repoId}/pullrequests/{prId}/commits
→ GitCommitRef[]
```

#### **NEW API Needed for Commits**
```typescript
// Get changes in a single commit
GET /git/repositories/{repoId}/commits/{commitId}/changes
→ { changeEntries: IterationChange[] }
```

This endpoint returns the **exact same structure** as `getIterationChanges`, so the reuse is perfect.

---

### 4. Implementation Plan (Inline Expansion - RECOMMENDED)

#### Why Inline Expansion?
- ✅ Users stay on CommitsTab
- ✅ Browse multiple commits easily
- ✅ Reuses existing component patterns
- ✅ No new routes needed
- ✅ Simpler than modal/sidebar

#### Architecture
```
CommitsTab
├── CommitRow (clickable, shows basic info)
│   └── [Expanded?] CommitDiffView
│       ├── File tree sidebar
│       ├── File selection
│       └── DiffViewer (reused)
└── CommitRow
    └── (collapsed)
```

---

### 5. Step-by-Step Implementation

#### Step 1: Add API Function
**File**: `src/api/commits.ts`

```typescript
import { adoClient } from './client';
import type { IterationChange } from '../types';

export async function getCommitChanges(
  repoId: string,
  commitId: string,
): Promise<IterationChange[]> {
  const data = await adoClient.get<{ changeEntries: IterationChange[] }>(
    `/git/repositories/${repoId}/commits/${commitId}/changes`,
  );
  return data.changeEntries;
}

// Optional: If you need to fetch parent commit ID
export async function getCommitDetail(
  repoId: string,
  commitId: string,
) {
  return adoClient.get(`/git/repositories/${repoId}/commits/${commitId}`);
}
```

**Update**: `src/api/index.ts`
```typescript
export * from './commits';  // Already done
```

#### Step 2: Create Hook
**File**: `src/hooks/useCommitDiff.ts` (NEW)

```typescript
import { useState, useEffect, useCallback } from 'react';
import { getCommitChanges, getFileContent } from '../api';
import type { IterationChange } from '../types';

export function useCommitDiff(repoId: string, commitId: string, parentCommitId?: string) {
  const [changes, setChanges] = useState<IterationChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!repoId || !commitId) return;
    setLoading(true);
    setError(null);
    try {
      const ch = await getCommitChanges(repoId, commitId);
      setChanges(ch);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load commit changes');
    } finally {
      setLoading(false);
    }
  }, [repoId, commitId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const fetchFilePair = useCallback(
    async (path: string, changeType?: string) => {
      if (!parentCommitId) {
        return { oldContent: '', newContent: '' };
      }

      // For added files, old content is empty
      const oldContent = changeType === 'add'
        ? ''
        : await getFileContent(repoId, path, parentCommitId);

      // For deleted files, new content is empty
      const newContent = changeType === 'delete'
        ? ''
        : await getFileContent(repoId, path, commitId);

      return { oldContent, newContent };
    },
    [repoId, commitId, parentCommitId],
  );

  return { changes, loading, error, refresh, fetchFilePair };
}
```

**Update**: `src/hooks/index.ts`
```typescript
export { useCommitDiff } from './useCommitDiff';
```

#### Step 3: Create CommitDiffView Component
**File**: `src/components/pr-detail/CommitDiffView.tsx` (NEW)

Copy **most of** FilesTab structure. Simplified version:

```typescript
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useCommitDiff } from '../../hooks';
import { changeTypeLabel, changeTypeBadgeColor } from '../../utils';
import { Badge, Spinner } from '../common';
import { DiffViewer, computeDiffLines, ScrollbarMinimap } from '../diff-viewer';
import type { IterationChange } from '../../types';

interface Props {
  repoId: string;
  commitId: string;
  parentCommitId?: string;
  filePath?: string;
}

// ... buildFileTree, FileTreeNode etc. (copy from FilesTab)

export function CommitDiffView({ repoId, commitId, parentCommitId, filePath }: Props) {
  const diff = useCommitDiff(repoId, commitId, parentCommitId);
  const [selectedFile, setSelectedFile] = useState<string | null>(filePath || null);
  const [fileContent, setFileContent] = useState<{ oldContent: string; newContent: string } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const contentRef = useRef<HTMLDivElement>(null);

  // ... (copy state management from FilesTab)

  const handleFileClick = useCallback(
    async (path: string) => {
      if (selectedFile === path) return;
      setSelectedFile(path);
      setFileContent(null);
      setLoadingFile(true);
      const changeType = diff.changes.find((c) => (c.item?.path ?? c.originalPath) === path)?.changeType;
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

  // Auto-select first file
  useEffect(() => {
    if (selectedFile || !diff.changes.length) return;
    const firstPath = diff.changes[0].item?.path ?? diff.changes[0].originalPath;
    if (firstPath) handleFileClick(firstPath);
  }, [diff.changes, selectedFile, handleFileClick]);

  if (diff.loading) return <Spinner className="py-4" />;
  if (diff.error) return <p className="text-red-600 text-sm">{diff.error}</p>;
  if (diff.changes.length === 0) return <p className="text-gray-400 text-sm">No changes in this commit</p>;

  // Return layout similar to FilesTab
  return (
    <div className="flex gap-0 bg-white dark:bg-gray-800 rounded-lg mt-2">
      {/* File tree sidebar */}
      <div className="shrink-0 border-r border-gray-200 dark:border-gray-700" style={{ width: sidebarWidth }}>
        {/* ... file tree rendering ... */}
      </div>

      {/* Diff viewer */}
      <div className="flex-1 min-w-0" ref={contentRef}>
        {selectedFile && fileContent ? (
          <>
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b sticky top-0">
              <span className="text-sm font-mono text-gray-700 dark:text-gray-200">{selectedFile}</span>
              {diff.changes.find((c) => (c.item?.path ?? c.originalPath) === selectedFile) && (
                <Badge
                  text={changeTypeLabel(diff.changes.find((c) => (c.item?.path ?? c.originalPath) === selectedFile)?.changeType || 'edit')}
                  color={changeTypeBadgeColor(diff.changes.find((c) => (c.item?.path ?? c.originalPath) === selectedFile)?.changeType || 'edit')}
                />
              )}
            </div>
            <DiffViewer
              oldContent={fileContent.oldContent}
              newContent={fileContent.newContent}
              filePath={selectedFile}
              threads={[]}  // No threads on commits
              onAddComment={async () => {}}  // Stub
              onReply={async () => {}}
              onSetStatus={async () => {}}
              usersMap={{}}
            />
          </>
        ) : (
          <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
            Select a file to view changes
          </div>
        )}
      </div>
    </div>
  );
}
```

#### Step 4: Update CommitsTab
**File**: `src/components/pr-detail/CommitsTab.tsx`

```typescript
import { useState } from 'react';
import type { GitCommitRef } from '../../types';
import { Spinner, ErrorBanner } from '../common';
import { CommitDiffView } from './CommitDiffView';
import { adoClient } from '../../api';
import { formatDate } from '../../utils';

interface Props {
  commits: GitCommitRef[];
  loading: boolean;
  error: string | null;
  repoName: string;
  repoId: string;  // NEW
}

export function CommitsTab({ commits, loading, error, repoName, repoId }: Props) {
  const [expandedCommitId, setExpandedCommitId] = useState<string | null>(null);

  if (loading) return <Spinner className="mt-10" />;
  if (error) return <ErrorBanner message={error} />;
  if (commits.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        No commits found for this pull request.
      </p>
    );
  }

  return (
    <div>
      <div className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {commits.length} commit{commits.length !== 1 ? 's' : ''}
      </div>

      <div className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg">
        {commits.map((commit, idx) => (
          <div key={commit.commitId}>
            {/* Commit row */}
            <div
              onClick={() => setExpandedCommitId(expandedCommitId === commit.commitId ? null : commit.commitId)}
              className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <span className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                {expandedCommitId === commit.commitId ? '▾' : '▸'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {commit.comment.split('\n')[0]}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  <span>{commit.author.name}</span>
                  <span>{formatDate(commit.author.date)}</span>
                  {commit.changeCounts && (
                    <span className="flex gap-2">
                      {commit.changeCounts.Add > 0 && (
                        <span className="text-green-600 dark:text-green-400">
                          +{commit.changeCounts.Add}
                        </span>
                      )}
                      {commit.changeCounts.Edit > 0 && (
                        <span className="text-yellow-600 dark:text-yellow-400">
                          ~{commit.changeCounts.Edit}
                        </span>
                      )}
                      {commit.changeCounts.Delete > 0 && (
                        <span className="text-red-600 dark:text-red-400">
                          -{commit.changeCounts.Delete}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </div>
              <a
                href={`${adoClient.orgUrl}/${encodeURIComponent(adoClient.projectName)}/_git/${encodeURIComponent(repoName)}/commit/${commit.commitId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline bg-gray-50 dark:bg-gray-700 px-2 py-1 rounded"
                title={commit.commitId}
              >
                {commit.commitId.slice(0, 8)}
              </a>
            </div>

            {/* Expanded diff view */}
            {expandedCommitId === commit.commitId && (
              <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800">
                <CommitDiffView
                  repoId={repoId}
                  commitId={commit.commitId}
                  parentCommitId={idx < commits.length - 1 ? commits[idx + 1].commitId : undefined}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

#### Step 5: Update PrDetailPage.tsx
**File**: `src/pages/PrDetailPage.tsx`

```typescript
{activeTab === 'commits' && (
  <CommitsTab
    commits={commits.commits}
    loading={commits.loading}
    error={commits.error}
    repoName={pr.repository.name}
    repoId={repoId!}  // NEW - pass repoId
  />
)}
```

---

### 6. Testing Checklist

- [ ] Commit row expands/collapses on click
- [ ] File tree builds correctly for all change types (add/edit/delete/rename)
- [ ] File content loads and displays correctly
- [ ] Diff rendering is accurate (unified and split modes)
- [ ] Line numbers are correct
- [ ] Minimap works and shows markers
- [ ] Scroll-to-line works if implemented
- [ ] File tree sidebar resizable
- [ ] Works with single-file and multi-file commits
- [ ] Performance: expands quickly even with many files changed
- [ ] Mobile: sidebar doesn't break layout on small screens

---

### 7. Key Files Summary

| File | Lines | Purpose | Status |
|------|-------|---------|--------|
| `src/components/diff-viewer/DiffViewer.tsx` | 1,095 | Main diff renderer | ✅ Complete |
| `src/components/diff-viewer/ScrollbarMinimap.tsx` | 156 | Visual markers | ✅ Complete |
| `src/components/pr-detail/FilesTab.tsx` | 495 | Pattern to copy | ✅ Complete |
| `src/components/pr-detail/CommitsTab.tsx` | 84 | To be updated | 🔧 Update |
| `src/components/pr-detail/CommitDiffView.tsx` | ~400 est. | New component | 🆕 Create |
| `src/hooks/useDiff.ts` | 54 | Pattern to copy | ✅ Complete |
| `src/hooks/useCommitDiff.ts` | ~60 est. | New hook | 🆕 Create |
| `src/api/diffs.ts` | 107 | Pattern to copy | ✅ Complete |
| `src/api/commits.ts` | 13 | To be updated | 🔧 Add function |
| `src/types/ado.ts` | 183 | Types (no changes) | ✅ Complete |
| `src/pages/PrDetailPage.tsx` | 446 | Pass repoId prop | 🔧 Update |

---

### 8. Estimated Effort

| Task | Time | Difficulty |
|------|------|-----------|
| Add `getCommitChanges` API | 10 min | Trivial |
| Create `useCommitDiff` hook | 20 min | Easy |
| Create `CommitDiffView` component | 1.5 hr | Medium (copy FilesTab) |
| Update `CommitsTab` | 20 min | Easy |
| Update `PrDetailPage.tsx` | 5 min | Trivial |
| Testing & polish | 30 min | Easy |
| **TOTAL** | **~2.5 hours** | **Medium** |

---

### 9. Potential Challenges & Solutions

#### Challenge 1: Getting parent commit ID
**Problem**: How do we know what commit to diff against?

**Solutions**:
1. ✅ **Use commit list order** (recommended) - Next commit in descending order is "parent"
2. Use ADO API to fetch parent from commit metadata
3. Allow first commit to show against empty (all additions)

**Chosen**: Solution 1 - simplest, no extra API calls

#### Challenge 2: No thread support yet
**Problem**: Commit diffs can't have inline comments (they're PR-level)

**Solution**: Pass empty `threads=[]` to DiffViewer. Can enable later.

#### Challenge 3: Performance with large commits
**Problem**: Commits with 100+ files could be slow

**Solution**: File tree is already lazy (doesn't fetch until clicked), minimap renders efficiently

#### Challenge 4: Parent for first commit
**Problem**: First commit in PR has no parent in the list

**Solution**: Set `parentCommitId={undefined}`, show empty old content (all green lines)

---

### 10. Future Enhancements

Once the basic version works, consider:

1. **Commit metadata** - Show full commit message (not just first line) when expanded
2. **Diff stats** - Show +added/-deleted line counts per file
3. **Keyboard nav** - Arrow keys to expand/collapse commits
4. **Deep linking** - `?commit={commitId}&file={path}` URL params
5. **Caching** - Cache fetched file content to avoid re-fetching
6. **Inline threads** - If wanted later, attach threads to commits
7. **Commit graph** - Show commit ancestry visualization
8. **Cherry-pick** - Allow cherry-picking individual commits

---

## QUICK START

1. **Copy this entire analysis** to your project
2. **Follow steps 1-5** in order
3. **Test each step** before moving to next
4. **Reference FilesTab** when stuck on CommitDiffView
5. **Use DiffViewer's prop interface** exactly as is

---

## CONCLUSION

The infrastructure is already there. You're just **adding a new data source** (single commit instead of PR iteration) and **wrapping it in expandable UI** (CommitsTab rows).

The DiffViewer, file content fetching, and all diff logic can be reused **without any modification**.

**Build time: 2-3 hours for someone familiar with the codebase.**

