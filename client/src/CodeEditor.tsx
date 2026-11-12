import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";

const theme = EditorView.theme({
  "&": { color: "#eef0ff", backgroundColor: "#0d1124", borderRadius: "12px", border: "1px solid rgba(255,255,255,.2)", fontSize: "14px" },
  ".cm-content": { fontFamily: "'DM Mono', ui-monospace, monospace", caretColor: "#fff" },
  ".cm-gutters": { backgroundColor: "#0a0e1e", color: "#7f84a8", border: "none", borderRadius: "12px 0 0 12px" },
  ".cm-activeLine": { backgroundColor: "rgba(143,183,255,.08)" },
  ".cm-activeLineGutter": { backgroundColor: "rgba(143,183,255,.12)" },
  "&.cm-focused": { outline: "2px solid rgba(201,186,255,.45)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "rgba(143,183,255,.3) !important" },
  ".cm-cursor": { borderLeftColor: "#fff" },
}, { dark: true });

/** CodeMirror editor for source code. Loaded lazily so it does not weigh on other screens. */
export default function CodeEditor({ value, onChange, language, label, minHeight = 260, readOnly = false }: {
  value: string; onChange?: (value: string) => void; language: string; label: string; minHeight?: number; readOnly?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const languageSlot = useRef(new Compartment());
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup, keymap.of([indentWithTab]), theme,
          EditorView.contentAttributes.of({ "aria-label": label }),
          EditorState.readOnly.of(readOnly),
          EditorView.theme({ ".cm-scroller": { minHeight: `${minHeight}px` } }),
          languageSlot.current.of(language === "python" ? python() : javascript()),
          EditorView.updateListener.of(update => { if (update.docChanged) change.current?.(update.state.doc.toString()); }),
        ],
      }),
    });
    view.current = editor;
    return () => editor.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);
  useEffect(() => {
    view.current?.dispatch({ effects: languageSlot.current.reconfigure(language === "python" ? python() : javascript()) });
  }, [language]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  return <div className="code-editor" ref={host} />;
}
