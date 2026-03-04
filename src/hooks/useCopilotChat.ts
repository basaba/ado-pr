import { useState, useCallback, useRef, useEffect } from 'react';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface UseCopilotChatReturn {
  messages: ChatMessage[];
  sendMessage: (prompt: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  sessionReady: boolean;
}

/**
 * Build a system-prompt string from PR data so the Copilot session
 * understands the current pull request.
 */
function buildPrContext(pr: PrContextInput): string {
  const lines: string[] = [
    'You are a helpful code review assistant for an Azure DevOps pull request.',
    '',
    '## PR Details',
    `- Title: ${pr.title}`,
  ];

  if (pr.description) {
    lines.push(`- Description: ${pr.description}`);
  }
  lines.push(
    `- Repository: ${pr.repoName}`,
    `- Branch: ${pr.sourceBranch} → ${pr.targetBranch}`,
    `- Author: ${pr.author}`,
    `- Status: ${pr.status}`,
  );

  if (pr.reviewers.length) {
    const revs = pr.reviewers
      .map((r) => `${r.displayName} (vote: ${r.vote})`)
      .join(', ');
    lines.push(`- Reviewers: ${revs}`);
  }

  if (pr.files.length) {
    lines.push('', '## Changed Files');
    for (const f of pr.files) {
      lines.push(`- ${f.path} (${f.changeType})`);
    }
  }

  if (pr.diffs.length) {
    lines.push('', '## File Diffs');
    let totalLen = 0;
    const MAX_DIFF_CHARS = 60_000;
    for (const d of pr.diffs) {
      if (totalLen + d.diff.length > MAX_DIFF_CHARS) {
        lines.push('', '(remaining diffs truncated for size)');
        break;
      }
      lines.push('', '```diff', d.diff, '```');
      totalLen += d.diff.length;
    }
  }

  if (pr.threads.length) {
    lines.push('', '## Active Review Threads');
    for (const t of pr.threads) {
      const loc = t.filePath ? ` on ${t.filePath}` : ' (general)';
      lines.push(`Thread${loc}:`);
      for (const c of t.comments) {
        lines.push(`  - ${c.author}: ${c.content.slice(0, 300)}`);
      }
    }
  }

  lines.push(
    '',
    'Answer questions about this PR. Help with code review, suggest improvements, summarize changes, and explain code.',
  );

  return lines.join('\n');
}

export interface PrContextInput {
  title: string;
  description: string;
  repoName: string;
  sourceBranch: string;
  targetBranch: string;
  author: string;
  status: string;
  reviewers: { displayName: string; vote: number }[];
  files: { path: string; changeType: string }[];
  threads: {
    filePath?: string;
    comments: { author: string; content: string }[];
  }[];
  diffs: { path: string; diff: string }[];
}

export function useCopilotChat(prContext: PrContextInput, ready = true): UseCopilotChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const sessionIdRef = useRef<string | null>(null);

  // Create session once diffs are ready
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    async function init() {
      try {
        const res = await fetch('/copilot-api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prContext: buildPrContext(prContext),
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!cancelled) {
          sessionIdRef.current = data.sessionId;
          setSessionReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to create Copilot session');
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      // Destroy session on unmount
      const id = sessionIdRef.current;
      if (id) {
        fetch('/copilot-api/session', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: id }),
        }).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]); // Create session when diffs are ready

  const sendMessage = useCallback(async (prompt: string) => {
    if (!sessionIdRef.current) return;

    setError(null);
    setIsLoading(true);
    setMessages((prev) => [...prev, { role: 'user', content: prompt }]);

    // Add placeholder for assistant
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/copilot-api/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          prompt,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE lines
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          try {
            const parsed = JSON.parse(payload);
            if (parsed.error) {
              setError(parsed.error);
              break;
            }
            if (parsed.delta) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = {
                    ...last,
                    content: last.content + parsed.delta,
                  };
                }
                return updated;
              });
            }
            // parsed.done is the final message – streaming is complete
          } catch {
            // ignore malformed SSE
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
      // Remove empty assistant placeholder on error
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && !last.content) {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { messages, sendMessage, isLoading, error, sessionReady };
}
