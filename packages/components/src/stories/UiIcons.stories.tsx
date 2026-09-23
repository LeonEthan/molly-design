import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import * as geometry from '@molly/shared/ui-icons';
import { createUiIcon } from '@/ui/icons';

// Story-only inventory: the product imports individual exports and can tree-shake.
const glyphs = Object.entries(geometry)
  .filter(([name, value]) => name.endsWith('Icon') && Array.isArray(value))
  .map(([name, value]) => ({
    name: name.slice(0, -4),
    Icon: createUiIcon(name, value as readonly geometry.UiIconNode[]),
  }));

function IconCatalog() {
  const [query, setQuery] = useState('');
  return (
    <div className="bg-background text-foreground min-h-screen p-8">
      <h1 className="mb-2 text-2xl font-medium">Molly outline icons</h1>
      <p className="text-muted-foreground mb-6">
        227 SVGs · 24 × 24 grid · 1.5 outline · 16 / 20 / 24px
      </p>
      <input
        aria-label="Filter icons"
        placeholder="Filter icons"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="bg-input-field mb-6 rounded-full border px-4 py-2"
      />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        {glyphs
          .filter(({ name }) => name.toLowerCase().includes(query.toLowerCase()))
          .map(({ name, Icon }) => (
            <div key={name} className="rounded-xl border p-5 text-center">
              <div className="mb-4 flex h-8 items-center justify-center gap-4">
                {[16, 20, 24].map((size) => (
                  <Icon key={size} size={size} />
                ))}
              </div>
              <span className="text-muted-foreground text-xs">{name}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

export default {
  title: 'UI/Molly Icons',
  component: IconCatalog,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof IconCatalog>;
type Story = StoryObj<typeof IconCatalog>;
export const Catalog: Story = {};
