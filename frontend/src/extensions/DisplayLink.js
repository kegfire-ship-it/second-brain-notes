import Link from '@tiptap/extension-link';
import { getMarkRange } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { linkDescriptionPlugin } from './LinkDescription';
import { closeHistory } from '@tiptap/pm/history';
import { getLinkDisplay } from '@/utils/richText';
import { createLinkDisplayButton } from '@/components/ui/link-display-button';

// A tap this close to a link's left edge places the caret before it instead
// of opening it. A link that starts a line has no other spot to tap there.
const LINK_START_TAP_PX = 10;

function createLineStartSpacer() {
  const spacer = document.createElement('span');
  spacer.contentEditable = 'false';
  spacer.dataset.linkLineStart = '';
  spacer.setAttribute('aria-hidden', 'true');
  spacer.style.fontSize = '0';
  spacer.textContent = ' ';
  return spacer;
}

export default Link.extend({
  addOptions() { return { ...this.parent?.(), describeLink: null }; },
  // Upstream makes the mark inclusive whenever autolink is on, so a space and
  // text typed right after a pasted link became part of it. Autolink still
  // links typed URLs without this.
  inclusive() { return false; },
  addAttributes() {
    const parent = this.parent?.() ?? {};
    return {
      ...parent,
      // Links pasted from other sites carry their own classes (e.g. Claude.ai's
      // `text-black font-bold`), which made them unreadable in the dark theme.
      // Always use our own link style instead of the pasted one.
      class: { ...parent.class, parseHTML: () => null },
      expandedLabel: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-link-expanded-label'),
        renderHTML: (attributes) => attributes.expandedLabel
          ? { 'data-link-expanded-label': attributes.expandedLabel } : {},
      },
    };
  },

  addProseMirrorPlugins() {
    const type = this.type;
    const editor = this.editor;
    return [
      // Runs before the upstream click handler, which would open the link.
      new Plugin({
        key: new PluginKey('linkStartCaret'),
        props: {
          handleClick(view, _pos, event) {
            if (event.button !== 0 || !view.editable) return false;
            const link = event.target instanceof Element ? event.target.closest('a') : null;
            if (!link || !view.dom.contains(link)) return false;
            const firstLine = link.getClientRects()[0];
            if (!firstLine || event.clientX - firstLine.left > LINK_START_TAP_PX) return false;
            const start = view.posAtDOM(link, 0);
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start)));
            view.focus();
            return true;
          },
          handleDOMEvents: {
            // With the caret right before a link, iOS Safari inserts typed text
            // inside the anchor (even after its first letter). Insert it here so
            // it lands before the link as plain text.
            beforeinput(view, event) {
              if (event.inputType !== 'insertText' || !event.data || view.composing) return false;
              const { empty, $from } = view.state.selection;
              if (!empty || !$from.nodeAfter || !type.isInSet($from.nodeAfter.marks)) return false;
              if ($from.nodeBefore && type.isInSet($from.nodeBefore.marks)) return false;
              event.preventDefault();
              view.dispatch(view.state.tr.insertText(event.data).scrollIntoView());
              return true;
            },
            // The upstream handler already opened the link on mouseup; stop the
            // browser following it too, so one tap opens one tab.
            click(view, event) {
              const link = event.target instanceof Element ? event.target.closest('a') : null;
              if (view.editable && link && view.dom.contains(link)) event.preventDefault();
              return false;
            },
          },
        },
      }),
      ...(this.parent?.() || []),
      ...(this.options.describeLink ? [linkDescriptionPlugin(editor, type, this.options.describeLink)] : []),
      new Plugin({
        key: new PluginKey('linkDisplay'),
        props: {
          decorations(state) {
            if (!editor.isEditable) return DecorationSet.empty;
            const widgets = [];
            let previousEnd = -1;
            let controls = 0;
            state.doc.descendants((node, pos) => {
              const mark = node.isText && type.isInSet(node.marks);
              if (!mark || pos < previousEnd) return;
              const range = getMarkRange(state.doc.resolve(pos), type, mark.attrs);
              if (!range) return;
              previousEnd = range.to;
              // iOS Safari has no caret stop before a link that starts a line:
              // the caret jumps from the line above to after the link's first
              // letter. An uneditable zero-width spacer gives it one.
              if (state.doc.resolve(range.from).parentOffset === 0) {
                widgets.push(Decoration.widget(range.from, createLineStartSpacer, {
                  key: 'link-line-start', side: -1, marks: [], ignoreSelection: true,
                }));
              }
              const label = state.doc.textBetween(range.from, range.to);
              const display = getLinkDisplay(mark.attrs.href, label, mark.attrs.expandedLabel);
              if (!display) return;
              const controlIndex = controls++;
              widgets.push(Decoration.widget(range.to, (view, getPos) => (
                createLinkDisplayButton(display.collapsed, () => {
                  if (!view.editable) return;
                  const end = getPos();
                  if (end == null) return;
                  const current = getMarkRange(view.state.doc.resolve(end - 1), type, mark.attrs);
                  if (!current) return;
                  const text = display.collapsed ? display.expandedLabel : display.compact;
                  const nextMark = type.create({
                    ...mark.attrs,
                    expandedLabel: display.collapsed ? null : display.expandedLabel,
                  });
                  const marks = view.state.doc.resolve(current.from).nodeAfter.marks
                    .filter((item) => item.type !== type).concat(nextMark);
                  const tr = closeHistory(view.state.tr).replaceWith(
                    current.from, current.to, view.state.schema.text(text, marks),
                  );
                  tr.setMeta('preventAutolink', true);
                  view.dispatch(tr);
                  // Return keyboard focus to the replacement control without
                  // opening a link or bringing up the phone keyboard.
                  view.dom.querySelectorAll('[data-link-display-toggle]')[controlIndex]?.focus({ preventScroll: true });
                })
              ), { key: JSON.stringify([range.from, range.to, mark.attrs, label]), side: 1, marks: [], stopEvent: () => true }));
            });
            return DecorationSet.create(state.doc, widgets);
          },
        },
      }),
    ];
  },
});
