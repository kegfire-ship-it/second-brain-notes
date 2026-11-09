import AbsoluteMasonry from './AbsoluteMasonry';

const GAP = 16;

/**
 * Thin wrapper around AbsoluteMasonry.
 * Public API: <MasonryGrid grid items renderItem />
 *   grid       From useColumnCount(): { cols, cardWidth, gridWidth }
 *   items      Array of objects each with `id`, `title`, `content` fields
 *              (notes from the backend).
 *   renderItem (item) => ReactNode — how to render one card.
 */
export default function MasonryGrid({ grid, items, renderItem }) {
    const wrappedItems = items.map(it => ({
        id: it.id,
        title: it.title,
        content: it.content,
        render: () => renderItem(it),
    }));
    return (
        <AbsoluteMasonry
            items={wrappedItems}
            cols={grid.cols}
            gap={GAP}
            gridWidth={grid.gridWidth}
        />
    );
}
