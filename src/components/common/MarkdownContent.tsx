import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { preprocessMentions } from '../../utils';

interface Props {
  content: string;
  className?: string;
  usersMap?: Record<string, string>;
}

export function MarkdownContent({ content, className = '', usersMap }: Props) {
  const stripped = content.replace(/<!--[\s\S]*?-->/g, '');
  const processed = usersMap ? preprocessMentions(stripped, usersMap) : stripped;
  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none break-words prose-code:before:content-none prose-code:after:content-none ${className}`}>
      <Markdown remarkPlugins={[remarkGfm]}>{processed}</Markdown>
    </div>
  );
}
