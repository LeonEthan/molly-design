import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/ui/input';
import { SegmentedControl } from '@/components/shared/segmented-control';

/**
 * Compact dimension field for the landing config row: h-6 speaks the row's
 * pill rhythm, spinner steppers are hidden (clutter at this size; the 1–4096
 * clamp lives on the consumer side), and the W/H prefix disambiguates the
 * two fields without a visible label.
 */
const dimensionInputClassName =
  'h-6 w-14 pl-[18px] pr-1 text-xs tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

const dimensionPrefixClassName =
  'pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 select-none text-[10px] font-semibold text-muted-foreground';

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
  // Focus is the continuation of the Auto -> Custom switch, never a property of
  // the row appearing: initial mount in custom mode must not steal focus.
  const [focusWidth, setFocusWidth] = useState(false);
  const heightInputRef = useRef<HTMLInputElement>(null);
  const sizeHint = t('design.sizeHint', '1–4096 px per side');
  return (
    <div className="flex items-center gap-2">
      <SegmentedControl
        ariaLabel={t('design.size', 'Canvas size')}
        size="sm"
        className="h-6"
        pill
        disabled={disabled}
        value={mode}
        options={[
          { value: 'auto', label: t('design.autoSize', 'Auto') },
          { value: 'custom', label: t('design.customSize', 'Custom') },
        ]}
        onChange={(value) => {
          if (value === 'custom') setFocusWidth(true);
          onChange({ mode: value, width, height });
        }}
      />
      {mode === 'custom' ? (
        <>
          <div className="relative">
            <span aria-hidden className={dimensionPrefixClassName}>
              W
            </span>
            <Input
              aria-label={t('design.width', 'Width')}
              title={sizeHint}
              disabled={disabled}
              type="number"
              min={1}
              max={4096}
              step={1}
              value={width}
              autoFocus={focusWidth}
              className={dimensionInputClassName}
              onChange={(event) =>
                onChange({ mode, width: Number(event.target.value), height })
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') heightInputRef.current?.focus();
              }}
            />
          </div>
          <span aria-hidden className="select-none text-xs text-muted-foreground">
            ×
          </span>
          <div className="relative">
            <span aria-hidden className={dimensionPrefixClassName}>
              H
            </span>
            <Input
              ref={heightInputRef}
              aria-label={t('design.height', 'Height')}
              title={sizeHint}
              disabled={disabled}
              type="number"
              min={1}
              max={4096}
              step={1}
              value={height}
              className={dimensionInputClassName}
              onChange={(event) =>
                onChange({ mode, width, height: Number(event.target.value) })
              }
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
