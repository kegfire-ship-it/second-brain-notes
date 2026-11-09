import { Extension } from '@tiptap/core';

// Keep the server's stable ID when TipTap normalizes/re-saves a blockquote.
export default Extension.create({
    name: 'extractionBlock',
    addGlobalAttributes() {
        return [{ types: ['blockquote'], attributes: {
            videoUrl: {
                default: null,
                parseHTML: element => element.getAttribute('data-video-url'),
                renderHTML: attributes => attributes.videoUrl ? { 'data-video-url': attributes.videoUrl } : {},
            },
            extractionId: {
                default: null,
                parseHTML: element => element.getAttribute('data-extraction-id'),
                renderHTML: attributes => attributes.extractionId ? { 'data-extraction-id': attributes.extractionId } : {},
            },
        } }];
    },
});
