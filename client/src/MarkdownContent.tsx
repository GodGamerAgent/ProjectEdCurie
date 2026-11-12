import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import type { Element, Root } from "hast";
import "katex/dist/katex.min.css";

function obsidianCallouts() {
  return (tree: Root) => {
    function visit(parent: Root | Element) {
      for (const child of parent.children) {
        if (child.type !== "element") continue;
        if (child.tagName === "blockquote") {
          const firstParagraph = child.children.find(node => node.type === "element" && node.tagName === "p");
          const firstText = firstParagraph?.type === "element" ? firstParagraph.children[0] : null;
          if (firstText?.type === "text") {
            const marker = /^\[!([a-z][a-z0-9-]*)\]([+-]?)[ \t]*([^\n]*)\n?/i.exec(firstText.value);
            if (marker) {
              const [, kind, fold, title] = marker;
              firstText.value = firstText.value.slice(marker[0].length);
              child.tagName = fold ? "details" : "aside";
              child.properties = { className: ["markdown-callout", `callout-${kind.toLowerCase()}`], ...(fold === "+" ? { open: true } : {}) };
              child.children.unshift({
                type: "element", tagName: fold ? "summary" : "strong", properties: { className: ["callout-title"] },
                children: [{ type: "text", value: title.trim() || kind.charAt(0).toUpperCase() + kind.slice(1) }],
              });
            }
          }
        }
        visit(child);
      }
    }
    visit(tree);
  };
}

export default memo(function Markdown({ text, compact = false }: { text: string; compact?: boolean }) {
  const Container = compact ? "span" : "div";
  return <Container className={compact ? "markdown markdown-compact" : "markdown"}>
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[obsidianCallouts, [rehypeKatex, { trust: false }], rehypeHighlight]}
      components={{
        ...(compact ? { p: ({ children }) => <span>{children}</span> } : {}),
        img: ({ node: _node, ...props }) => <img {...props} loading="lazy" referrerPolicy="no-referrer" />,
      }}
    >{text}</ReactMarkdown>
  </Container>;
});
