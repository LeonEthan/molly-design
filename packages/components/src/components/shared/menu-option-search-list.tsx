import { Fragment, useMemo, useState, type ReactNode } from 'react';

import { filterFuzzyOptions, shouldOfferOptionSearch } from '@/lib/fuzzy-option-filter';
import { DropdownMenuLabel, DropdownMenuSearchInput } from '@/ui/dropdown-menu';

export type MenuSearchableOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  group?: string;
};

export type MenuOptionSearchListProps<TOption extends MenuSearchableOption> = {
  options: ReadonlyArray<TOption>;
  /**
   * The row itself, so each menu keeps its own row grammar (icons, checks).
   * `select` is handed in rather than taken as a second prop: Enter on the
   * search field and a click on the row must be the same action, and two props
   * naming it separately is how they stop being.
   */
  renderOption: (option: TOption, select: () => void) => ReactNode;
  onSelect: (option: TOption) => void;
  searchPlaceholder: string;
  emptyText: string;
};

/**
 * Body for a menu whose option list can be long enough that scrolling it is not
 * a way to find anything — an agent provider may publish dozens of models.
 *
 * Renders as the whole content of a `DropdownMenuContent` / `SubContent` given
 * `flex flex-col overflow-y-hidden p-0`: the search row stays put while only
 * the list below it scrolls. Below `OPTION_SEARCH_MIN_OPTIONS` the field is not
 * rendered at all and the list reads exactly as it did before.
 *
 * Options that name two or more `group`s render under a label per group, in
 * first-appearance order; within a group the search ranking is preserved.
 */
export function MenuOptionSearchList<TOption extends MenuSearchableOption>({
  options,
  renderOption,
  onSelect,
  searchPlaceholder,
  emptyText,
}: MenuOptionSearchListProps<TOption>) {
  const [query, setQuery] = useState('');
  const searchable = shouldOfferOptionSearch(options.length);

  const filtered = useMemo(
    () =>
      filterFuzzyOptions(options, query, (option) => ({
        primary: option.label,
        // The id behind a pretty label and the provider's own blurb are worth
        // finding by, but never ahead of a visible name.
        secondary: [option.value, option.description, option.group],
      })),
    [options, query]
  );
  const grouped = useMemo(() => new Set(options.map((option) => option.group)).size > 1, [options]);
  const sections = useMemo(
    () => (grouped ? groupOptions(filtered) : [{ group: undefined, options: [...filtered] }]),
    [filtered, grouped]
  );

  const submitTopMatch = () => {
    const top = filtered.find((option) => !option.disabled);
    if (top) onSelect(top);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {searchable ? (
        <DropdownMenuSearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={searchPlaceholder}
          onSubmit={submitTopMatch}
          // The width floor belongs to the field, not the list: a menu with no
          // search field keeps the menu surface's own narrow minimum.
          className="min-w-56 border-b border-border/40 px-2.5 py-2"
        />
      ) : null}
      <div className="scroll-pro scrollbar-pro min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-1.5 [scrollbar-gutter:auto]">
        {filtered.length === 0 ? (
          <div className="px-2.5 py-2 text-[0.8rem] text-muted-foreground">{emptyText}</div>
        ) : (
          sections.map((section) => (
            <Fragment key={section.group ?? ''}>
              {section.group !== undefined ? (
                <DropdownMenuLabel className="px-2.5 pb-1 pt-2 text-[11px] font-normal normal-case tracking-normal text-muted-foreground">
                  {section.group}
                </DropdownMenuLabel>
              ) : null}
              {section.options.map((option) => renderOption(option, () => onSelect(option)))}
            </Fragment>
          ))
        )}
      </div>
    </div>
  );
}

function groupOptions<TOption extends MenuSearchableOption>(
  options: readonly TOption[]
): Array<{ group: string | undefined; options: TOption[] }> {
  const byGroup = new Map<string | undefined, TOption[]>();
  for (const option of options) {
    const members = byGroup.get(option.group);
    if (members) members.push(option);
    else byGroup.set(option.group, [option]);
  }
  return [...byGroup].map(([group, members]) => ({ group, options: members }));
}
