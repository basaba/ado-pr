import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { preprocessMentions } from '../../utils';

interface Props {
  content: string;
  className?: string;
  usersMap?: Record<string, string>;
}

export function MarkdownContent({ content, className = '', usersMap }: Props) {
  const processed = usersMap ? preprocessMentions(content, usersMap) : content;
  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none break-words ${className}`}>
      <Markdown remarkPlugins={[remarkGfm]}>{processed}</Markdown>
    </div>
  );
}
