import type { ComponentPropsWithoutRef } from "react";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeCallouts from "rehype-callouts";
import { remarkHighlight } from "./remark-highlight";
import { remarkWikilink } from "./remark-wikilink";

export const remarkPlugins = [remarkGfm, remarkBreaks, remarkHighlight, remarkWikilink];
export const rehypePlugins = [rehypeCallouts];

export const sharedComponents = {
  pre: ({ children, ...props }: ComponentPropsWithoutRef<"pre">) => (
    <pre
      className="bg-muted rounded-md p-3 my-2 overflow-x-auto text-sm font-mono [&>code]:bg-transparent [&>code]:p-0 [&>code]:rounded-none"
      {...props}
    >
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }: ComponentPropsWithoutRef<"code">) => {
    if (className) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="bg-muted px-1 py-0.5 rounded text-sm font-mono" {...props}>
        {children}
      </code>
    );
  },
  mark: ({ children, ...props }: ComponentPropsWithoutRef<"mark">) => (
    <mark className="bg-yellow-200 dark:bg-yellow-900/50 px-0.5 rounded-sm" {...props}>
      {children}
    </mark>
  ),
};
