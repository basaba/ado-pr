import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useCopilotChat } from '../../hooks';
import type { PrContextInput, ChatMessage } from '../../hooks';
import type { PullRequest, PullRequestThread, IterationChange } from '../../types';
import { Spinner } from '../common';

interface CopilotTabProps {
  pr: PullRequest;
  threads: PullRequestThread[];
  changes: IterationChange[];
}

function branchName(ref: string) {
  return ref.replace(/^refs\/heads\//, '');
}

function buildContext(pr: PullRequest, threads: PullRequestThread[], changes: IterationChange[]): PrContextInput {
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
  };
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

export function CopilotTab({ pr, threads, changes }: CopilotTabProps) {
  const prContext = buildContext(pr, threads, changes);
  const { messages, sendMessage, isLoading, error, sessionReady } = useCopilotChat(prContext);
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
