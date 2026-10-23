import { Skeleton } from '@/ui/skeleton';
import { WebArchiveScreen } from './web-archive-screen';

const SKELETON_ROW_WIDTHS = ['w-3/5', 'w-2/5', 'w-1/2'];

function ignore() {}

export function ArchiveLoadingScreen() {
  return (
    <WebArchiveScreen
      isMultiSelectMode={false}
      selectedCount={0}
      isBulkActionBusy={false}
      onExitMultiSelect={ignore}
      onBulkRestore={ignore}
      onRequestBulkDelete={ignore}
      dialogs={null}
    >
      <div
        aria-hidden="true"
        data-archive-loading=""
        className="mx-auto box-border flex w-full max-w-3xl flex-col gap-3 px-4 py-4 sm:px-6"
      >
        {SKELETON_ROW_WIDTHS.map((width) => (
          <div key={width} className="flex items-center gap-3">
            <Skeleton className="size-10 shrink-0 rounded-md bg-foreground/[0.06]" />
            <Skeleton className={`h-3.5 bg-foreground/[0.06] ${width}`} />
          </div>
        ))}
      </div>
    </WebArchiveScreen>
  );
}
