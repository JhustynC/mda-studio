import { basicSetup } from 'codemirror';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { lintGutter, linter } from '@codemirror/lint';
import { openSearchPanel, search } from '@codemirror/search';
import { tags } from '@lezer/highlight';
export { createDiagram } from './diagram.mjs';

const theme = EditorView.theme({
  '&': { color: '#e2edeb', backgroundColor: '#172b2c' },
  '.cm-content': { caretColor: '#f0f9f5', padding: '10px 0', fontFamily: 'var(--mono)' },
  '.cm-gutters': { backgroundColor: '#172b2c', color: '#93b1ab', border: 'none', borderRight: '1px solid #375251' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#243c3d' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#365b58' },
  '.cm-cursor': { borderLeftColor: '#f0f9f5' },
  '.cm-panels': { backgroundColor: '#243c3d', color: '#eef8f5' },
  '.cm-panel input, .cm-panel button': { color: '#e2edeb', background: '#172b2c', borderColor: '#537470' },
}, { dark: true });

const highlight = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.propertyName, color: '#a6d9fa' },
  { tag: tags.string, color: '#bce6ae' },
  { tag: tags.number, color: '#ffcb9d' },
  { tag: [tags.bool, tags.null, tags.atom], color: '#e4c0fa' },
  { tag: [tags.brace, tags.squareBracket, tags.separator], color: '#c2d5d1' },
]));

export function createJsonEditor(parent, { onChange, onCursor, onFormat, onBuild }) {
  const jsonLint = jsonParseLinter();
  const extensions = [
    keymap.of([
      { key: 'Alt-Shift-f', run: () => { onFormat(); return true; } },
      { key: 'Mod-Enter', run: () => { onBuild(); return true; } },
    ]),
    basicSetup, json(), search({ top: true }), lintGutter(),
    linter(jsonLint, { delay: 250 }),
    theme, highlight, EditorState.tabSize.of(2),
    EditorView.contentAttributes.of({ 'aria-label': 'Modelo CIM en JSON', spellcheck: 'false' }),
    EditorState.phrases.of({
      'Find': 'Buscar', 'Replace': 'Reemplazar', 'next': 'Siguiente', 'previous': 'Anterior',
      'all': 'Todas', 'match case': 'Mayúsculas', 'regexp': 'Expresión regular',
      'by word': 'Palabra completa', 'replace': 'Reemplazar', 'replace all': 'Reemplazar todo',
      'close': 'Cerrar', 'Fold line': 'Plegar bloque', 'Unfold line': 'Desplegar bloque',
    }),
    EditorView.updateListener.of(update => {
      if (update.docChanged) onChange();
      if (update.selectionSet || update.docChanged) describeCursor(update.state);
    }),
  ];
  const state = doc => EditorState.create({ doc, extensions });
  const view = new EditorView({ state: state(''), parent });

  function describeCursor(editorState) {
    const head = editorState.selection.main.head;
    const line = editorState.doc.lineAt(head);
    onCursor(line.number, head - line.from + 1);
  }

  return {
    get value() { return view.state.doc.toString(); },
    load(text) {
      view.setState(state(text.replace(/^\uFEFF/, '')));
      view.scrollDOM.scrollTop = 0;
      view.scrollDOM.scrollLeft = 0;
      describeCursor(view.state);
    },
    format(text) {
      if (text === view.state.doc.toString()) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: Transaction.userEvent.of('input.format'),
      });
    },
    search() { openSearchPanel(view); },
    measure() { view.requestMeasure(); },
  };
}
