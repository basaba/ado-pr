import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className = '' }: Props) {
  return (
    <div className={`prose prose-sm max-w-none break-words ${className}`}>
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  );
}
