import { useDesignThumbnails } from '@/hooks/use-design-thumbnail';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';

export type HomeArtworkGalleryItem = {
  sessionId: string;
  artworkId: string;
  title: string;
  dateLabel: string;
};

export type HomeArtworkGalleryProps = {
  heading: string;
  countLabel: (count: number) => string;
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

/**
 * Recent artworks on the home page, drawn from the sidebar's thumbnail cache. Designs
 * with nothing on the canvas (a stopped or failed first run) are left out.
 */
export function HomeArtworkGallery({
  heading,
  countLabel,
  items,
  onOpen,
}: HomeArtworkGalleryProps) {
  const thumbnails = useDesignThumbnails(useMemo(() => items.map((item) => item.artworkId), [items]));
  const shown = items.filter((item) => thumbnails.get(item.artworkId) !== '');
  if (shown.length === 0) return null;
  return (
    <section aria-label={heading} className="w-full">
      <header className="mb-6 flex items-end justify-between gap-6 border-b border-hairline pb-4">
        <h2 className="font-editorial text-[32px] leading-none text-foreground">{heading}</h2>
        <span className="eyebrow pb-1 text-muted-foreground">{countLabel(shown.length)}</span>
      </header>
      <div className="columns-[220px] gap-6">
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
