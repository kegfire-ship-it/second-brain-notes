import { getMarkRange } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';
import { createLinkDescriptionButton } from '@/components/ui/link-description-button';

const key = new PluginKey('linkDescription');
// Video links get their own card; the page reader can't read these sites anyway.
const VIDEO_HOST = /(?:^|\.)(?:youtube\.com|youtu\.be|instagram\.com)$/iu;
const describable = href => {
  if (!/^https?:\/\//iu.test(href)) return false;
  try { return !VIDEO_HOST.test(new URL(href).hostname); } catch { return false; }
};
const valid = (doc, job, type) => {
  if (job.from < 1 || job.to > doc.content.size || job.from >= job.to) return false;
  const range = getMarkRange(doc.resolve(job.from), type, { href: job.href });
  return range?.from === job.from && range.to === job.to
    && doc.textBetween(job.from, job.to) === job.label;
};

export function linkDescriptionPlugin(editor, type, describe) {
  let nextId = 0;
  let destroyed = false;
  const controllers = new Map();
  return new Plugin({
    key,
    state: {
      init: () => new Map(),
      apply(tr, previous) {
        const jobs = new Map();
        for (const [id, job] of previous) {
          const from = tr.mapping.mapResult(job.from, 1);
          const to = tr.mapping.mapResult(job.to, -1);
          const mapped = { ...job, from: from.pos, to: to.pos };
          if (!from.deletedAcross && !to.deletedAcross && valid(tr.doc, mapped, type)) jobs.set(id, mapped);
          else controllers.get(id)?.abort();
        }
        const action = tr.getMeta(key);
        if (action?.add) jobs.set(action.add.id, action.add);
        if (action?.remove) jobs.delete(action.remove);
        if (action?.error && jobs.has(action.id)) jobs.set(action.id, { ...jobs.get(action.id), loading: false, error: action.error });
        return jobs;
      },
    },
    props: {
      decorations(state) {
        if (!editor.isEditable) return DecorationSet.empty;
        const widgets = [];
        let previousEnd = -1;
        state.doc.descendants((node, pos) => {
          const mark = node.isText && type.isInSet(node.marks);
          if (!mark || pos < previousEnd || !describable(mark.attrs.href)) return;
          const range = getMarkRange(state.doc.resolve(pos), type, mark.attrs);
          if (!range) return;
          previousEnd = range.to;
          const job = [...key.getState(state).values()].find(item => item.from === range.from && item.to === range.to);
          widgets.push(Decoration.widget(range.to, (view, getPos) => createLinkDescriptionButton({
            loading: job?.loading, error: job?.error,
            onClick: async () => {
              if (!view.editable || destroyed) return;
              const end = getPos();
              if (end == null) return;
              const current = getMarkRange(view.state.doc.resolve(end - 1), type, mark.attrs);
              if (!current) return;
              const existing = [...key.getState(view.state).values()].find(item => item.from === current.from && item.to === current.to);
              if (existing?.loading) return;
              const id = ++nextId;
              const controller = new AbortController();
              controllers.set(id, controller);
              const pending = { id, from: current.from, to: current.to, href: mark.attrs.href,
                label: view.state.doc.textBetween(current.from, current.to), loading: true };
              view.dispatch(view.state.tr.setMeta(key, { add: pending, remove: existing?.id }).setMeta('addToHistory', false));
              try {
                const text = await describe(pending.href, controller.signal);
                if (destroyed || controller.signal.aborted || !view.editable) return;
                const mapped = key.getState(view.state).get(id);
                if (!mapped || !valid(view.state.doc, mapped, type)) return;
                if (typeof text !== 'string' || !text.trim() || text.length > 800) throw new Error('empty description');
                const paragraph = view.state.schema.nodes.paragraph.create(null, view.state.schema.text(text.trim()));
                const tr = closeHistory(view.state.tr).replaceRangeWith(mapped.to, mapped.to, paragraph);
                tr.setMeta(key, { remove: id }).setMeta('preventAutolink', true);
                view.dispatch(tr);
                view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false));
              } catch (error) {
                if (destroyed || controller.signal.aborted) return;
                const detail = error.response?.data?.detail;
                view.dispatch(view.state.tr.setMeta(key, { id, error: typeof detail === 'string' ? detail : 'Couldn’t read the site. Please try again.' }).setMeta('addToHistory', false));
              } finally {
                controllers.delete(id);
                // A temporary read-only phase must not leave a forever-busy button.
                if (!destroyed && key.getState(view.state).get(id)?.loading) {
                  view.dispatch(view.state.tr.setMeta(key, { remove: id }).setMeta('addToHistory', false));
                }
              }
            },
          }), { key: JSON.stringify([range.from, range.to, mark.attrs, job?.loading, job?.error]), side: 2, marks: [], stopEvent: () => true }));
        });
        return DecorationSet.create(state.doc, widgets);
      },
    },
    view: () => ({ destroy() { destroyed = true; controllers.forEach(controller => controller.abort()); controllers.clear(); } }),
  });
}
