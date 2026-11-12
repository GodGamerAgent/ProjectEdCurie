import { useDeferredValue, useEffect, useId, useRef, type ReactNode } from "react";
import Markdown from "./Markdown";

export default function ResourceReview({ title, children, text, onClose, showPreview = true }: {
  title: string;
  showPreview?: boolean;
  children?: ReactNode;
  text: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const preview = useDeferredValue(text);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="resource-review" aria-labelledby={headingId}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="resource-review-header">
      <h2 id={headingId}>{title}</h2>
      <button type="button" className="button small" onClick={onClose}>Close</button>
    </header>
    <div className={children && showPreview ? "resource-review-content resource-review-split" : "resource-review-content"}>
      {children && <div className="resource-review-editor">{children}</div>}
      {showPreview && <section className="resource-review-preview" aria-label="Markdown preview">
        {children && <h3>Markdown preview</h3>}
        {preview.trim() ? <Markdown text={preview} /> : <p className="muted">Add text to see a preview.</p>}
      </section>}
    </div>
  </dialog>;
}
