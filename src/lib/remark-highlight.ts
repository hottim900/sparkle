import { findAndReplace } from "mdast-util-find-and-replace";

const HIGHLIGHT_RE = /(?<!=)==(?!=)((?:[^=\n]|=[^=])+)==(?!=)/g;

export function remarkHighlight() {
  return (tree: unknown) => {
    findAndReplace(tree as Parameters<typeof findAndReplace>[0], [
      HIGHLIGHT_RE,
      (_: string, text: string) => ({
        type: "emphasis" as const,
        data: { hName: "mark" },
        children: [{ type: "text" as const, value: text }],
      }),
    ]);
  };
}
