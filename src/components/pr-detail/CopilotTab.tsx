import { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useCopilotChat } from '../../hooks';
import type { PrContextInput, ChatMessage, TurnState, ToolCall } from '../../hooks';
import type { PullRequest, PullRequestThread, IterationChange } from '../../types';
import { generateTextDiff } from '../../utils';
import { Spinner } from '../common';
import { useAuth } from '../../context';

interface CopilotTabProps {
  pr: PullRequest;
  threads: PullRequestThread[];
  changes: IterationChange[];
  fetchFilePair: (path: string, changeType?: string) => Promise<{ oldContent: string; newContent: string }>;
}

function branchName(ref: string) {
  return ref.replace(/^refs\/heads\//, '');
}

function buildContext(
  pr: PullRequest,
  threads: PullRequestThread[],
  changes: IterationChange[],
  diffs: { path: string; diff: string }[],
): PrContextInput {
  return {
    title: pr.title,
    description: pr.description ?? '',
    repoName: pr.repository.name,
    sourceBranch: branchName(pr.sourceRefName),
    targetBranch: branchName(pr.targetRefName),
    author: pr.createdBy.displayName,
    status: pr.status,
    reviewers: pr.reviewers.map((r) => ({
      displayName: r.displayName,
      vote: r.vote,
    })),
    files: changes
      .filter((c) => c.item?.path)
      .map((c) => ({ path: c.item!.path, changeType: c.changeType })),
    threads: threads
      .filter((t) => t.status === 'active' && t.comments.some((c) => c.commentType === 'text'))
      .map((t) => ({
        filePath: t.threadContext?.filePath,
        comments: t.comments
          .filter((c) => c.commentType === 'text')
          .map((c) => ({ author: c.author.displayName, content: c.content })),
      })),
    diffs,
  };
}

function ToolCallIndicator({ tool }: { tool: ToolCall }) {
  const isRunning = tool.status === 'running';
  return (
    <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600">
      {isRunning ? (
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
      ) : (
        <span className="text-green-500">✓</span>
      )}
      <span className="font-mono">{tool.toolName}</span>
    </div>
  );
}

function TurnIndicators({ turnState }: { turnState: TurnState }) {
  if (!turnState.isThinking && turnState.toolCalls.length === 0 && !turnState.reasoning) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5 mb-3 ml-1">
      {/* Intent */}
      {turnState.intent && (
        <div className="flex items-center gap-1.5 text-xs text-indigo-600">
          <span className="animate-pulse">⚡</span>
          <span className="italic">{turnState.intent}</span>
        </div>
      )}

      {/* Tool calls */}
      {turnState.toolCalls.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {turnState.toolCalls.map((tc) => (
            <ToolCallIndicator key={tc.toolCallId} tool={tc} />
          ))}
        </div>
      )}

      {/* Reasoning / thinking */}
      {turnState.reasoning && (
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer select-none hover:text-gray-700">
            Thinking…
          </summary>
          <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-[11px]">
            {turnState.reasoning}
          </pre>
        </details>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-gray-100 text-gray-900'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        ) : msg.content ? (
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1 text-gray-400">
            <span className="animate-pulse">●</span>
            <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>●</span>
            <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>●</span>
          </span>
        )}
      </div>
    </div>
  );
}

export function CopilotTab({ pr, threads, changes, fetchFilePair }: CopilotTabProps) {
  const { config } = useAuth();
  const repoPath = config?.repoPath;
  const [diffs, setDiffs] = useState<{ path: string; diff: string }[]>([]);
  const [diffsReady, setDiffsReady] = useState(false);

  // Fetch file diffs for all changes before creating the session
  useEffect(() => {
    let cancelled = false;

    async function loadDiffs() {
      const filesToFetch = changes.filter((c) => c.item?.path);
      const results: { path: string; diff: string }[] = [];

      await Promise.all(
        filesToFetch.map(async (change) => {
          const path = change.item!.path;
          try {
            const { oldContent, newContent } = await fetchFilePair(path, change.changeType);
            const diff = generateTextDiff(oldContent, newContent, path);
            if (diff) results.push({ path, diff });
          } catch {
            // Skip files that fail to fetch
          }
        }),
      );

      if (!cancelled) {
        // Sort to match original file order
        const pathOrder = filesToFetch.map((c) => c.item!.path);
        results.sort((a, b) => pathOrder.indexOf(a.path) - pathOrder.indexOf(b.path));
        setDiffs(results);
        setDiffsReady(true);
      }
    }

    loadDiffs();
    return () => { cancelled = true; };
  }, [changes, fetchFilePair]);

  const prContext = useMemo(
    () => buildContext(pr, threads, changes, diffs),
    [pr, threads, changes, diffs],
  );
  const { messages, sendMessage, isLoading, error, sessionReady, turnState } = useCopilotChat(prContext, diffsReady, repoPath);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setInput('');
    await sendMessage(trimmed);
  };

  if (!sessionReady && !error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500">
        <Spinner />
        <p className="mt-3 text-sm">Starting Copilot session…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[600px]">
      {/* Local repo context indicator */}
      {repoPath && (
        <div className="mx-4 mt-2 flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2.5 py-1.5 w-fit">
          <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
          Local repo: {repoPath}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-2 rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-16">
            <p className="text-lg font-medium">Ask Copilot about this PR</p>
            <p className="text-sm mt-1">
              Try "Summarize this PR" or "What are the main changes?"
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        {isLoading && <TurnIndicators turnState={turnState} />}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-gray-200 px-4 py-3 flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={sessionReady ? 'Ask Copilot…' : 'Connecting…'}
          disabled={!sessionReady || isLoading}
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                     disabled:bg-gray-50 disabled:text-gray-400"
        />
        <button
          type="submit"
          disabled={!sessionReady || isLoading || !input.trim()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white
                     hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed
                     transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
}
