import { describe, expect, it } from 'vitest';
import { getDesignPanelDefaultSizes } from '../src/components/sessions/design-panel-sizes';

describe('canvas-first design panel defaults', () => {
  it('gives the canvas most of a wide window', () => {
    expect(getDesignPanelDefaultSizes(2482)).toEqual({ main: 22, sidebar: 78 });
  });

  it('keeps the conversation near its reading width on a laptop', () => {
    expect(getDesignPanelDefaultSizes(1440)).toEqual({ main: 32, sidebar: 68 });
  });

  it('never lets the conversation take more than 40% on small windows', () => {
    expect(getDesignPanelDefaultSizes(900)).toEqual({ main: 40, sidebar: 60 });
    expect(getDesignPanelDefaultSizes(0)).toEqual({ main: 40, sidebar: 60 });
  });
});
