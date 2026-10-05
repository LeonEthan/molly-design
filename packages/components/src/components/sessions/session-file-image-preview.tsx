import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getImageMimeTypeForPath } from '@/lib/image-file-preview';
import { ZoomableImageViewer } from '@/components/shared/zoomable-image-viewer';

interface SessionFileImagePreviewProps {
  readonly path: string;
  /** Raw bytes for binary images (png/jpeg/gif/webp/…). */
  readonly bytes?: Uint8Array;
  readonly url?: string;
  /** Source text for SVG files (which are classified as text, not binary). */
  readonly svgText?: string;
}

export const SessionFileImagePreview = memo(function SessionFileImagePreview({
  path,
  bytes,
  svgText,
  url,
}: SessionFileImagePreviewProps) {
  const { t } = useTranslation();
  const mimeType = getImageMimeTypeForPath(path);
  const [objectUrl, setObjectUrl] = useState<string | undefined>(undefined);
  const [viewerOpen, setViewerOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mimeType) {
      setObjectUrl(undefined);
      return undefined;
    }
    let blob: Blob | undefined;
    if (svgText !== undefined) {
      blob = new Blob([svgText], { type: 'image/svg+xml' });
    } else if (bytes && bytes.byteLength > 0) {
      // Copy into a fresh ArrayBuffer-backed Uint8Array so Blob typing is happy
      // even if `bytes` is a view over a shared/transferable buffer.
      blob = new Blob([Uint8Array.from(bytes)], { type: mimeType });
    }
    if (!blob) {
      setObjectUrl(undefined);
      return undefined;
    }
    const blobUrl = URL.createObjectURL(blob);
    setObjectUrl(blobUrl);
    // The open viewer holds the previous object URL; close it before the URL is
    // revoked so it can never show a dead blob.
    setViewerOpen(false);
    return () => URL.revokeObjectURL(blobUrl);
  }, [bytes, svgText, mimeType]);

  const imageUrl = url ?? objectUrl;
  const images = useMemo(
    () => (imageUrl ? [{ key: path, src: imageUrl, fileName: path }] : []),
    [imageUrl, path]
  );
  const handleClose = useCallback(() => setViewerOpen(false), []);

  if (!mimeType || !imageUrl) return null;
  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 items-center justify-center overflow-auto p-3"
    >
      <button
        type="button"
        className="flex h-full w-full cursor-zoom-in items-center justify-center"
        onClick={() => setViewerOpen(true)}
        aria-label={t('sessions.imagePreview.zoom', 'Open image in full screen')}
      >
        <img src={imageUrl} alt={path} className="max-h-full max-w-full object-contain" />
      </button>
      <ZoomableImageViewer open={viewerOpen} onClose={handleClose} images={images} index={0} />
    </div>
  );
});
