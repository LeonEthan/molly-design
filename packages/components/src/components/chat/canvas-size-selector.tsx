import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { ArrowLeft, Check, ChevronDown, Maximize, Plus, Rectangle, Square } from '@/ui/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { menuSurfaceStyle } from '@/ui/menu-styles';
import { handleMenuCloseAutoFocus } from '@/lib/menu-focus';
import { cn } from '@/lib/utils';

type CanvasSize = { mode: 'auto' | 'custom'; width: number; height: number };

const isValidDimension = (value: number) => Number.isInteger(value) && value >= 1 && value <= 4096;

/** A canvas outline keeps each preset's proportions legible at menu size. */
function SizeOutline({ width, height }: { width: number; height: number }) {
  return (
    <span aria-hidden className="flex size-7 shrink-0 items-center justify-center">
      <span
        className="rounded-[2px] border border-current"
        style={{
          width: 20 * Math.min(1, width / height),
          height: 20 * Math.min(1, height / width),
        }}
      />
    </span>
  );
}

export function CanvasSizeSelector({
  mode,
  width,
  height,
  disabled,
  onChange,
}: CanvasSize & {
  disabled: boolean;
  onChange: (size: CanvasSize) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'presets' | 'custom'>('presets');
  // Edits remain local until Apply; dismissing never changes the submitted size.
  const [draft, setDraft] = useState({ width: String(width), height: String(height) });
  const draftWidth = Number(draft.width);
  const draftHeight = Number(draft.height);
  const validWidth = isValidDimension(draftWidth);
  const validHeight = isValidDimension(draftHeight);
  const invalidDraft = (draft.width !== '' && !validWidth) || (draft.height !== '' && !validHeight);
  const presets = [
    { label: t('design.sizeSquare', 'Square'), width: 1080, height: 1080 },
    { label: t('design.sizePortrait', 'Portrait'), width: 1080, height: 1350 },
    { label: t('design.sizeStory', 'Story'), width: 1080, height: 1920 },
    { label: t('design.sizeLandscape', 'Landscape'), width: 1920, height: 1080 },
    { label: t('design.sizeLongImage', 'Long image'), width: 1080, height: 2400 },
  ];
  const customSelected =
    mode === 'custom' &&
    !presets.some((preset) => preset.width === width && preset.height === height);
  const label = mode === 'auto' ? t('design.autoSize', 'Auto size') : `${width} × ${height}`;
  const TriggerIcon = mode === 'auto' ? Maximize : width === height ? Square : Rectangle;
  const select = (size: CanvasSize) => {
    onChange(size);
    setOpen(false);
  };
  const rowClassName =
    'h-auto min-h-12 w-full justify-start gap-3 rounded-lg px-2.5 py-2 text-left font-normal aria-pressed:bg-foreground/[0.06]';

  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setView('presets');
          setDraft({ width: String(width), height: String(height) });
        }
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          aria-label={`${t('design.size', 'Canvas size')}: ${label}`}
          className="h-7 shrink-0 select-none gap-1.5 rounded-full bg-foreground/[0.04] px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground data-[state=open]:bg-hover data-[state=open]:text-foreground"
        >
          <TriggerIcon
            aria-hidden
            className={cn('size-3.5', mode === 'custom' && height > width && 'rotate-90')}
          />
          <span className="tabular-nums">{label}</span>
          <ChevronDown aria-hidden className="size-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        aria-label={t('design.size', 'Canvas size')}
        className="w-72 max-w-[calc(100vw-24px)] select-none rounded-xl border-0 p-1.5"
        style={menuSurfaceStyle}
        onOpenAutoFocus={(event) => {
          if (!(event.target instanceof HTMLElement)) return;
          const selected = event.target.querySelector<HTMLButtonElement>(
            'button[aria-pressed="true"]'
          );
          if (selected) {
            event.preventDefault();
            selected.focus();
          }
        }}
        onCloseAutoFocus={(event) =>
          handleMenuCloseAutoFocus(event, { didSelectItem: true, menuContent: event.currentTarget })
        }
      >
        {view === 'presets' ? (
          <>
            <Button
              type="button"
              variant="ghost"
              aria-pressed={mode === 'auto'}
              className={rowClassName}
              onClick={() => select({ mode: 'auto', width, height })}
            >
              <span className="flex size-7 shrink-0 items-center justify-center text-muted-foreground">
                <Maximize aria-hidden className="size-5" />
              </span>
              <span className="flex flex-1 flex-col gap-0.5">
                <span>{t('design.autoSize', 'Auto size')}</span>
                <span className="text-xs text-muted-foreground">
                  {t('design.autoSizeHint', 'No fixed dimensions')}
                </span>
              </span>
              {mode === 'auto' ? <Check aria-hidden className="size-4" /> : null}
            </Button>
            <div className="px-3 pb-1 pt-3 text-[11px] text-muted-foreground">
              {t('design.commonSizes', 'Common sizes')}
            </div>
            {presets.map((preset) => {
              const selected =
                mode === 'custom' && width === preset.width && height === preset.height;
              return (
                <Button
                  key={preset.label}
                  type="button"
                  variant="ghost"
                  aria-pressed={selected}
                  className={rowClassName}
                  onClick={() =>
                    select({ mode: 'custom', width: preset.width, height: preset.height })
                  }
                >
                  <SizeOutline width={preset.width} height={preset.height} />
                  <span className="flex flex-1 flex-col gap-0.5">
                    <span>{preset.label}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {preset.width} × {preset.height}
                    </span>
                  </span>
                  {selected ? <Check aria-hidden className="size-4" /> : null}
                </Button>
              );
            })}
            <div className="my-1.5 h-px bg-foreground/[0.06]" />
            <Button
              type="button"
              variant="ghost"
              aria-pressed={customSelected}
              className="h-10 w-full justify-start gap-3 rounded-lg px-2.5 font-normal aria-pressed:bg-foreground/[0.06]"
              onClick={() => setView('custom')}
            >
              <span className="flex size-7 items-center justify-center text-muted-foreground">
                <Plus aria-hidden className="size-4" />
              </span>
              <span className="flex-1 text-left">{t('design.customSize', 'Custom size')}</span>
              {customSelected ? <Check aria-hidden className="size-4" /> : null}
            </Button>
          </>
        ) : (
          <form
            className="p-2"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (validWidth && validHeight && !disabled)
                select({ mode: 'custom', width: draftWidth, height: draftHeight });
            }}
          >
            <div className="mb-4 flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('common.back', 'Back')}
                className="size-7 rounded-full"
                onClick={() => setView('presets')}
              >
                <ArrowLeft aria-hidden className="size-4" />
              </Button>
              <span className="text-[13px] font-medium">
                {t('design.customSize', 'Custom size')}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(['width', 'height'] as const).map((dimension) => (
                <label
                  key={dimension}
                  className="flex min-w-0 flex-col gap-2 text-xs text-muted-foreground"
                >
                  {dimension === 'width'
                    ? t('design.width', 'Width')
                    : t('design.height', 'Height')}
                  <div className="relative">
                    <Input
                      type="number"
                      min={1}
                      max={4096}
                      step={1}
                      required
                      autoFocus={dimension === 'width'}
                      aria-describedby={`${id}-hint`}
                      aria-invalid={
                        draft[dimension] !== '' &&
                        !(dimension === 'width' ? validWidth : validHeight)
                      }
                      value={draft[dimension]}
                      className="h-9 select-text rounded-lg pr-8 tabular-nums aria-invalid:border-destructive/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      onChange={(event) => setDraft({ ...draft, [dimension]: event.target.value })}
                    />
                    <span
                      aria-hidden
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px]"
                    >
                      px
                    </span>
                  </div>
                </label>
              ))}
            </div>
            <p
              id={`${id}-hint`}
              aria-live="polite"
              className={cn(
                'mb-4 mt-2 text-[11px]',
                invalidDraft ? 'text-destructive' : 'text-muted-foreground'
              )}
            >
              {invalidDraft
                ? t(
                    'design.invalidSize',
                    'Canvas width and height must be integers from 1 to 4096.'
                  )
                : t('design.sizeHint', '1–4096 px per side')}
            </p>
            <Button
              type="submit"
              disabled={!validWidth || !validHeight || disabled}
              className="h-8 w-full rounded-lg"
            >
              {t('design.applySize', 'Apply size')}
            </Button>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}
