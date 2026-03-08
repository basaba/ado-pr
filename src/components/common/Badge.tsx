interface Props {
  text: string;
  color?: string;
}

export function Badge({ text, color = 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200' }: Props) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {text}
    </span>
  );
}
