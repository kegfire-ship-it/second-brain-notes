import { Paragraph } from '@tiptap/extension-paragraph';
import { ReactNodeViewRenderer } from '@tiptap/react';
import VideoParagraphView from './VideoParagraph.jsx';

export default Paragraph.extend({
    addStorage() { return { presentation: null }; },
    addNodeView() { return ReactNodeViewRenderer(VideoParagraphView); },
});
