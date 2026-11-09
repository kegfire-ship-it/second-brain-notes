import api from '@/services/api';
import { useEditor, EditorContent } from '@tiptap/react';
import VideoParagraph from '@/extensions/VideoParagraph.js';
import ExtractionBlock from '@/extensions/ExtractionBlock';
import StarterKit from '@tiptap/starter-kit';
import Link from '@/extensions/DisplayLink';
import { useEffect, useRef, useState } from 'react';
import { Bold as BoldIcon, Italic as ItalicIcon, List as ListIcon, Link as LinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { insertSanitisedPastedLink, linkifyHtml, plainTextToHtml, splitParagraphLines } from '@/utils/richText';

const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);

const processInitialContent = (text) => linkifyHtml(splitParagraphLines(plainTextToHtml(text)));

const normaliseLinkUrl = (value) => {
    const url = value.trim();
    if (!url) return '';
    return /^(?:https?:\/\/|mailto:)/iu.test(url) ? url : `https://${url}`;
};

function ToolbarButton({ active, onClick, label, disabled = false, children }) {
    return (
        <button
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={onClick}
            onMouseDown={(event) => event.preventDefault()}
            disabled={disabled}
            className={`flex h-7 w-7 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                active ? 'bg-accent-50 text-accent-600' : 'text-ink-3 hover:bg-surface-soft hover:text-ink-2'
            }`}
        >
            {children}
        </button>
    );
}

const TipTapEditor = ({ content, onChange, readOnly = false, onEditorReady, describeLinks = false, offline = false }) => {
    const editorRef = useRef(null);
    const linkControlsRef = useRef(null);
    const [linkPanelOpen, setLinkPanelOpen] = useState(false);
    const [linkUrl, setLinkUrl] = useState('');

    const editor = useEditor({
        enableInputRules: false,
        extensions: [
            StarterKit.configure({ link: false, paragraph: offline ? {} : false }),
            ...(!offline ? [VideoParagraph] : []),
            ExtractionBlock,
            Link.configure({
                describeLink: describeLinks ? async (url, signal) => {
                    const { data } = await api.post('/notes/describe-link', { url }, { signal, timeout: 15000 });
                    return data.description;
                } : null,
                openOnClick: true,
                autolink: true,
                defaultProtocol: 'https',
                HTMLAttributes: {
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    class: '[overflow-wrap:anywhere] text-accent-600 underline decoration-1 underline-offset-2 cursor-pointer hover:text-[var(--accent)] transition-colors',
                },
            })
        ],
        content: processInitialContent(content),
        editable: !readOnly,
        editorProps: {
            attributes: {
                class: 'prose prose-sm sm:prose-base prose-a:text-accent-600 prose-a:underline prose-a:decoration-1 prose-a:underline-offset-2 hover:prose-a:text-[var(--accent)] focus:outline-none min-h-[300px] w-full text-ink font-normal whitespace-pre-wrap leading-relaxed font-sans',
                spellcheck: 'false',
                translate: 'no',
                'data-gramm': 'false'
            },
            handleKeyDown: (_view, event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
                    event.stopPropagation();
                }
                return false;
            },
            // Plain-text paste with newlines: TipTap's default collapses
            // newlines into a single paragraph. Detect that case and insert
            // each line as its own paragraph instead. Rich (HTML) pastes are
            // left to TipTap's default handler.
            handlePaste: (_view, event) => {
                // A URL pasted on its own is stored as a full-address anchor instead
                // of accepting external HTML/link-preview nodes. That makes its
                // later clipboard representation stable in other apps.
                if (insertSanitisedPastedLink(event, editorRef.current)) return true;

                const text = event.clipboardData?.getData('text/plain');
                const html = event.clipboardData?.getData('text/html');
                if (html) return false;
                if (!text || !text.includes('\n')) return false;

                event.preventDefault();
                const insertHtml = linkifyHtml(text.split(/\r?\n/)
                    .map(line => line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p></p>')
                    .join(''));
                editorRef.current?.commands.insertContent(insertHtml);
                return true;
            },
        },
        onUpdate: ({ editor }) => {
            // Persist ordinary TipTap HTML; video card views are not serialized.
            onChange(editor.getHTML());
        },
    });

    // Bridge editor instance to a ref so editorProps callbacks (which close over
    // a stale `editor` from initial useEditor call) can access the live instance.
    useEffect(() => {
        editorRef.current = editor;
        if (editor && onEditorReady) onEditorReady(editor);
    }, [editor, onEditorReady]);

    useEffect(() => {
        if (editor && content !== editor.getHTML()) {
            const processed = processInitialContent(content);
            if (processed !== editor.getHTML()) {
                editor.commands.setContent(processed);
            }
        }
    }, [content, editor]);

    useEffect(() => {
        if (editor) {
            editor.setEditable(!readOnly);
        }
    }, [readOnly, editor]);

    const activeLinkUrl = editor?.getAttributes('link').href || '';
    const canApplyLink = !!editor && (!editor.state.selection.empty || !!activeLinkUrl);
    const openLinkPanel = () => {
        setLinkUrl(activeLinkUrl);
        setLinkPanelOpen(true);
    };
    const applyLink = () => {
        const href = normaliseLinkUrl(linkUrl);
        if (!href || !canApplyLink) return;
        editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
        setLinkPanelOpen(false);
    };
    const removeLink = () => {
        editor?.chain().focus().unsetLink().run();
        setLinkPanelOpen(false);
    };

    useEffect(() => {
        if (!linkPanelOpen) return undefined;
        const closeOnOutsidePointerDown = (event) => {
            if (!linkControlsRef.current?.contains(event.target)) setLinkPanelOpen(false);
        };
        document.addEventListener('pointerdown', closeOnOutsidePointerDown, true);
        return () => document.removeEventListener('pointerdown', closeOnOutsidePointerDown, true);
    }, [linkPanelOpen]);

    if (!editor) return null;

    return (
        <div className="flex flex-col flex-1 h-full relative group">
            {!readOnly && (
                <div ref={linkControlsRef}>
                    <div className="mb-2 flex shrink-0 items-center gap-0.5 border-b border-border px-1.5 py-1">
                        <ToolbarButton
                            label="bold" active={editor.isActive('bold')}
                            onClick={() => editor.chain().focus().toggleBold().run()}
                        >
                            <BoldIcon size={15} strokeWidth={2} />
                        </ToolbarButton>
                        <ToolbarButton
                            label="italic" active={editor.isActive('italic')}
                            onClick={() => editor.chain().focus().toggleItalic().run()}
                        >
                            <ItalicIcon size={15} strokeWidth={2} />
                        </ToolbarButton>
                        <ToolbarButton
                            label="list" active={editor.isActive('bulletList')}
                            onClick={() => editor.chain().focus().toggleBulletList().run()}
                        >
                            <ListIcon size={15} strokeWidth={1.8} />
                        </ToolbarButton>
                        <ToolbarButton
                            label="link" active={!!activeLinkUrl}
                            onClick={openLinkPanel}
                        >
                            <LinkIcon size={15} strokeWidth={1.8} />
                        </ToolbarButton>
                    </div>
                    {linkPanelOpen && (
                        <div className="mb-3 flex shrink-0 items-center gap-2 rounded-md border border-line bg-surface-soft p-2">
                            {/* Do not autofocus: browser selection stays visibly painted
                                until the person chooses to type the URL. */}
                            <Input
                                type="url"
                                value={linkUrl}
                                aria-label="link address"
                                placeholder="https://example.com"
                                className="h-8 bg-surface text-sm"
                                onChange={(event) => setLinkUrl(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        applyLink();
                                    }
                                    if (event.key === 'Escape') setLinkPanelOpen(false);
                                }}
                            />
                            <Button type="button" size="xs" onClick={applyLink} disabled={!linkUrl.trim() || !canApplyLink}>
                                apply
                            </Button>
                            {activeLinkUrl && (
                                <Button type="button" variant="ghost" size="xs" onClick={removeLink}>
                                    remove
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            )}
            {/* Editor Content Box */}
            <div className="flex-1 w-full overflow-visible cursor-text">
                <EditorContent editor={editor} className="h-full w-full" />
            </div>
        </div>
    );
};

export default TipTapEditor;
