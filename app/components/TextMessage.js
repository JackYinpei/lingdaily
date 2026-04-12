import clsx from 'clsx';
import React from 'react';
import ReactMarkdown from 'react-markdown';

export function TextMessage({ text, isUser }) {
  return (
    <div
      className={clsx('flex flex-row gap-2', {
        'justify-end py-2': isUser,
      })}
    >
      <div
        className={clsx('rounded-[16px]', {
          // User bubble (right)
          'px-4 py-2 max-w-[90%] ml-4 bg-secondary text-secondary-foreground whitespace-pre-wrap': isUser,
          // Assistant bubble (left)
          'px-4 py-2 max-w-[90%] mr-4 bg-muted text-foreground border border-border prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 max-w-none': !isUser,
        })}
      >
        {isUser ? text : <ReactMarkdown>{text}</ReactMarkdown>}
      </div>
    </div>
  );
}
