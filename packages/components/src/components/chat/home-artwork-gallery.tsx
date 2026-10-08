import { useDesignThumbnails } from '@/hooks/use-design-thumbnail';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

export type HomeArtworkGalleryItem = {
  sessionId: string;
  artworkId: string;
  title: string;
  dateLabel: string;
};

export type HomeArtworkGalleryProps = {
  heading: string;
  limit: number;
  countLabel: (count: number, truncated: boolean) => string;
  items: readonly HomeArtworkGalleryItem[];
  onOpen: (sessionId: string) => void;
};

const STAGGER_MS = 50;

function HomeArtworkCard({
  item,
  src,
  index,
  onOpen,
}: {
  item: HomeArtworkGalleryItem;
  src: string | undefined;
  index: number;
  onOpen: (sessionId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item.sessionId)}
      style={{ animationDelay: `${120 + index * STAGGER_MS}ms` }}
      className="group animate-reveal mb-7 block w-full break-inside-avoid text-left focus-visible:outline-hidden"
    >
      <span
        className={cn(
          'relative block overflow-hidden rounded-[6px] bg-foreground/[0.04]',
          'outline outline-1 -outline-offset-1 outline-[var(--hairline)]',
          'group-focus-visible:outline-2 group-focus-visible:outline-ring'
        )}
      >
        {src ? (
          <img
            src={src}
            alt=""
            draggable={false}
            className="block h-auto w-full transition-transform duration-700 ease-[var(--ease-gallery)] group-hover:scale-[1.025]"
          />
        ) : (
          <span className="block aspect-[4/5] w-full" />
        )}
      </span>
      <span className="mt-3 flex items-baseline gap-3 px-0.5">
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground transition-colors duration-200 group-hover:text-foreground">
          {item.title}
        </span>
        <span className="eyebrow shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
          {item.dateLabel}
        </span>
      </span>
    </button>
  );
}

/** How many leading items must be read so `limit` of them are not known to be blank. */
function windowEnd(
  items: readonly HomeArtworkGalleryItem[],
  thumbnails: ReadonlyMap<string, string>,
  limit: number
) {
  let kept = 0;
  for (const [index, item] of items.entries())
    if (thumbnails.get(item.artworkId) !== '' && ++kept === limit) return index + 1;
  return items.length;
}

/**
 * Recent artworks on the home page, drawn from the sidebar's thumbnail cache, newest
 * first and reading left to right. Designs with nothing on the canvas (a stopped or
 * failed first run) are left out before the limit applies, so the gallery reads further
 * down the list only as far as blank designs make necessary.
 */
export function HomeArtworkGallery({
  heading,
  limit,
  countLabel,
  items,
  onOpen,
}: HomeArtworkGalleryProps) {
  const [end, setEnd] = useState(limit);
  const thumbnails = useDesignThumbnails(
    useMemo(() => items.slice(0, end).map((item) => item.artworkId), [items, end])
  );
  const neededEnd = windowEnd(items, thumbnails, limit);
  useEffect(() => setEnd(neededEnd), [neededEnd]);
  const withContent = items.filter((item) => thumbnails.get(item.artworkId) !== '');
  const shown = withContent.slice(0, limit);
  if (shown.length === 0) return null;
  return (
    <section aria-label={heading} className="w-full">
      <header className="mb-6 flex items-end justify-between gap-6 border-b border-hairline pb-4">
        <h2 className="font-editorial text-[32px] leading-none text-foreground">{heading}</h2>
        <span className="eyebrow pb-1 text-muted-foreground">{countLabel(shown.length, withContent.length > shown.length || neededEnd < items.length)}</span>
      </header>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] items-start gap-x-6">
        {shown.map((item, index) => (
          <HomeArtworkCard
            key={item.sessionId}
            item={item}
            src={thumbnails.get(item.artworkId)}
            index={index}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
}
