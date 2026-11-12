import { useDeferredValue, useId, useRef, useState, type KeyboardEvent } from "react";
import Markdown from "./Markdown";

type View = "split" | "edit" | "preview";
type Props = {
  label: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Form field name for uncontrolled use inside a FormData form. */
  name?: string;
  rows?: number;
  maxLength?: number;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Starts in edit-only mode for short fields; the preview remains one click away. */
  compact?: boolean;
  className?: string;
};

const snippets: { label: string; title: string; before: string; after?: string; block?: boolean }[] = [
  { label: "H", title: "Heading", before: "## ", block: true },
  { label: "B", title: "Bold", before: "**", after: "**" },
  { label: "•", title: "Bulleted list", before: "- ", block: true },
  { label: "☐", title: "Task list", before: "- [ ] ", block: true },
  { label: "❝", title: "Blockquote", before: "> ", block: true },
  { label: "</>", title: "Code block", before: "```python\n", after: "\n```", block: true },
  { label: "∑", title: "Inline math", before: "$", after: "$" },
  { label: "$$", title: "Display math", before: "$$\n", after: "\n$$", block: true },
  { label: "▦", title: "Table", before: "| Column | Column |\n| --- | --- |\n| ", after: " |  |", block: true },
];

/**
 * Shared editor for authored multiline Markdown: an Obsidian-style split view with
 * a live preview rendered by the app's sanitizing Markdown renderer (raw HTML is skipped).
 */
export default function MarkdownEditor({ label, value, defaultValue = "", onChange, name, rows = 8, maxLength, required, disabled, placeholder, compact, className }: Props) {
  const [own, setOwn] = useState(defaultValue);
  const text = value ?? own;
  const [view, setView] = useState<View>(compact ? "edit" : "split");
  const preview = useDeferredValue(text);
  const area = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const update = (next: string) => { if (value === undefined) setOwn(next); onChange?.(next); };

  function insert(snippet: typeof snippets[number]) {
    const element = area.current;
    if (!element) return;
    const { selectionStart: start, selectionEnd: end } = element;
    const selected = text.slice(start, end);
    const lineStart = snippet.block && start > 0 && text[start - 1] !== "\n" ? "\n" : "";
    const inserted = lineStart + snippet.before + selected + (snippet.after ?? "");
    const next = text.slice(0, start) + inserted + text.slice(end);
    if (maxLength && next.length > maxLength) return;
    update(next);
    requestAnimationFrame(() => {
      element.focus();
      const cursor = start + lineStart.length + snippet.before.length + selected.length;
      element.setSelectionRange(cursor, cursor);
    });
  }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab" || event.shiftKey || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    const element = event.currentTarget;
    const { selectionStart: start, selectionEnd: end } = element;
    update(text.slice(0, start) + "  " + text.slice(end));
    requestAnimationFrame(() => element.setSelectionRange(start + 2, start + 2));
  }

  return <div className={`field markdown-editor ${className ?? ""}`}>
    <div className="markdown-editor-bar">
      <label htmlFor={id}>{label}</label>
      <div className="markdown-editor-tools" role="toolbar" aria-label={`${label} formatting`}>
        {view !== "preview" && snippets.map(snippet => <button key={snippet.title} type="button" className="md-tool" title={snippet.title}
          aria-label={snippet.title} disabled={disabled} onClick={() => insert(snippet)}>{snippet.label}</button>)}
        <span className="md-view" role="group" aria-label="Editor view">
          {(["edit", "split", "preview"] as View[]).map(item => <button key={item} type="button" className="md-tool"
            aria-pressed={view === item} onClick={() => setView(item)}>{item === "edit" ? "Edit" : item === "split" ? "Split" : "Preview"}</button>)}
        </span>
      </div>
    </div>
    <div className={`markdown-editor-body view-${view}`}>
      <textarea id={id} ref={area} name={name} value={text} rows={rows} maxLength={maxLength} required={required} disabled={disabled}
        placeholder={placeholder} spellCheck onKeyDown={keyDown} onChange={event => update(event.target.value)}
        hidden={view === "preview"} />
      {view !== "edit" && <section className="markdown-editor-preview" aria-label={`${label} preview`} aria-live="polite">
        {preview.trim() ? <Markdown text={preview} /> : <p className="muted">Live preview appears here. Markdown, tables, task lists, code and $math$ are supported.</p>}
      </section>}
    </div>
  </div>;
}
