import { lazy, Suspense } from "react";

const MarkdownContent = lazy(() => import("./MarkdownContent"));

export default function Markdown({ text, compact }: { text: string; compact?: boolean }) {
  return <Suspense fallback={<span className="muted">Loading formatted content…</span>}>
    <MarkdownContent text={text} compact={compact} />
  </Suspense>;
}
