import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import MarkdownContent from "../client/src/MarkdownContent";

it("renders math, code and Obsidian callouts while treating raw HTML as untrusted", () => {
  const markdown = [
    "# Sequence and series",
    String.raw`The ratio is $\frac{a_{n+1}}{a_n}$.`,
    ["$$", String.raw`S_n = \sum_{k=1}^n a_k`, "$$"].join("\n"),
    ["> [!tip]- Try it", "> Start with the first two terms."].join("\n"),
    ["| Term | Value |", "| --- | --- |", "| First | 1 |"].join("\n"),
    ["```python", "for n in range(3):", "    print(n)", "```"].join("\n"),
    "<script>alert(1)</script>",
    "[Unsafe link](javascript:alert%281%29)",
  ].join("\n\n");

  const html = renderToStaticMarkup(createElement(MarkdownContent, { text: markdown }));
  expect(html).toContain('class="katex"');
  expect(html).toContain('class="katex-display"');
  expect(html).toContain('class="hljs-keyword"');
  expect(html).toContain("    ");
  expect(html).toContain('<details class="markdown-callout callout-tip">');
  expect(html).toContain(">Try it</summary>");
  expect(html).toContain("<table>");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("javascript:");
});
