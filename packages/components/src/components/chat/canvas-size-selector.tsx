import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';

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
  const modeGroup = useId();
  return (
    <div>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={disabled}
          >
            {t('design.size', 'Canvas size')}: {mode === 'auto' ? 'Auto' : `${width} × ${height}`} ▾
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-64">
          <div
            className="mb-3 flex gap-4"
            role="radiogroup"
            aria-label={t('design.size', 'Canvas size')}
          >
            {(['auto', 'custom'] as const).map((value) => (
              <label key={value} className="flex items-center gap-1 text-sm">
                <input
                  type="radio"
                  name={modeGroup}
                  checked={mode === value}
                  disabled={disabled}
                  onChange={() => onChange({ mode: value, width, height })}
                />
                {value === 'auto' ? 'Auto' : t('design.customSize', 'Custom')}
              </label>
            ))}
          </div>
          {mode === 'custom' ? (
            <>
              <div className="flex items-end gap-2">
                <label className="min-w-0 flex-1 text-sm">
                  {t('design.width', 'Width')}
                  <Input
                    disabled={disabled}
                    type="number"
                    min={1}
                    max={4096}
                    step={1}
                    value={width}
                    onChange={(event) =>
                      onChange({ mode, width: Number(event.target.value), height })
                    }
                  />
                </label>
                <span aria-hidden className="pb-2">
                  ×
                </span>
                <label className="min-w-0 flex-1 text-sm">
                  {t('design.height', 'Height')}
                  <Input
                    disabled={disabled}
                    type="number"
                    min={1}
                    max={4096}
                    step={1}
                    value={height}
                    onChange={(event) =>
                      onChange({ mode, width, height: Number(event.target.value) })
                    }
                  />
                </label>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t('design.sizeHint', '1–4096 px per side')}
              </p>
            </>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}
