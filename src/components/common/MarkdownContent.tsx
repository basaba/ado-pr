import Markdown from 'react-markdown';

interface Props {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className = '' }: Props) {
  return (
    <div className={`prose prose-sm max-w-none break-words ${className}`}>
      <Markdown>{content}</Markdown>
    </div>
  );
}
