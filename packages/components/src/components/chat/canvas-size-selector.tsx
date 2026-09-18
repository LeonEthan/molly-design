import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { SegmentedControl } from '@/components/shared/segmented-control';

/** Hide the number spinners: the steppers read as clutter at 32px and the
 * field clamps to 1–4096 on the consumer side anyway. */
const numberInputClassName =
  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

export function CanvasSizeSelector({
  mode,
  width,
  height,
  disabled,
  onChange,
}: {
  mode: 'auto' | 'custom';
  width: number;
  height: number;
  disabled: boolean;
  onChange: (size: { mode: 'auto' | 'custom'; width: number; height: number }) => void;
}) {
  const { t } = useTranslation();
  const [focusWidth, setFocusWidth] = useState(false);
  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) setFocusWidth(false);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          disabled={disabled}
        >
          <span>{t('design.size', 'Canvas size')}:</span>
          <span className="tabular-nums">
            {mode === 'auto' ? t('design.autoSize', 'Auto') : `${width} × ${height}`}
          </span>
          <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="flex w-[248px] flex-col gap-3 p-3">
        <SegmentedControl
          ariaLabel={t('design.size', 'Canvas size')}
          size="sm"
          className="w-full"
          value={mode}
          options={[
            { value: 'auto', label: t('design.autoSize', 'Auto') },
            { value: 'custom', label: t('design.customSize', 'Custom') },
          ]}
          onChange={(value) => {
            // Only a fresh switch to Custom should steal focus; reopening the
            // popover on an already-custom size must not yank it from the trigger.
            if (value === 'custom') setFocusWidth(true);
            onChange({ mode: value, width, height });
          }}
        />
        {mode === 'custom' ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-end gap-2">
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-[10px] font-semibold uppercase leading-[14px] tracking-[0.6px] text-muted-foreground">
                  {t('design.width', 'Width')}
                </span>
                <Input
                  disabled={disabled}
                  type="number"
                  min={1}
                  max={4096}
                  step={1}
                  value={width}
                  autoFocus={focusWidth}
                  className={numberInputClassName}
                  onChange={(event) =>
                    onChange({ mode, width: Number(event.target.value), height })
                  }
                />
              </label>
              <span aria-hidden className="pb-2 text-muted-foreground">
                ×
              </span>
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-[10px] font-semibold uppercase leading-[14px] tracking-[0.6px] text-muted-foreground">
                  {t('design.height', 'Height')}
                </span>
                <Input
                  disabled={disabled}
                  type="number"
                  min={1}
                  max={4096}
                  step={1}
                  value={height}
                  className={numberInputClassName}
                  onChange={(event) =>
                    onChange({ mode, width, height: Number(event.target.value) })
                  }
                />
              </label>
            </div>
            <p className="text-[11px] leading-4 text-muted-foreground">
              {t('design.sizeHint', '1–4096 px per side')}
            </p>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
