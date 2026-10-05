import { describe, expect, it } from 'vitest';
import { createMollyThemeCssVariables } from '../vscode-theme-css';
import { DEFAULT_VSCODE_THEME_SELECTION } from '../theme-selection-storage';
import {
  getBundledVSCodeThemeByIdSync,
  isSelectableBundledVSCodeThemeId,
} from './bundled-vscode-themes';

/**
 * Chrome contract for the Molly "Atelier" themes.
 *
 * Authority: .agents/notes/proposed/feature/2026-10-04-atelier-redesign.md
 * (owner-approved 2026-10-04 overhaul that supersedes the 2026-09-16 monochrome
 * record). Bone paper and near-black grounds, warm ink, primary actions as the
 * ink inversion, tonal selection, and a single vermilion reserved for focus and
 * the active-tab accent. Signal red/green and the retained --status-merged
 * exceptions are unchanged.
 */

const EXPECTED_MOLLY_LIGHT_CHROME: Record<string, string> = {
  '--background': '42 27.8% 92.9%',
  '--foreground': '60 2.6% 7.6%',
  '--card': '45 40% 98%',
  '--card-foreground': '60 2.6% 7.6%',
  '--popover': '45 40% 98%',
  '--muted': '42 27.8% 92.9%',
  '--muted-foreground': '45 3.9% 40.4%',
  '--secondary': '42 27.8% 92.9%',
  '--secondary-foreground': '60 2.6% 7.6%',
  '--destructive': '11 88.9% 54.1%',
  '--destructive-foreground': '45 40% 98%',
  '--button-secondary': '42 27.8% 92.9%',
  '--button-secondary-foreground': '60 2.6% 7.6%',
  '--button-secondary-hover': '40 22.2% 89.4%',
  '--hover': '40 22.2% 89.4%',
  '--hover-foreground': '60 2.6% 7.6%',
  '--highlight': '11.9 81.5% 51.4%',
  '--highlight-foreground': '45 40% 98%',
  '--selection': '41.5 21.3% 88%',
  '--selection-foreground': '60 2.6% 7.6%',
  '--selection-inactive': '42 27.8% 92.9%',
  '--selection-inactive-foreground': '60 2.6% 7.6%',
  '--bottom-bar': '45 40% 98%',
  '--bottom-bar-foreground': '45 3.9% 40.4%',
  '--tab-bar': '45 40% 98%',
  '--tab-active': '45 40% 98%',
  '--tab-active-foreground': '60 2.6% 7.6%',
  '--tab-inactive': '42 27.8% 92.9%',
  '--tab-inactive-foreground': '45 3.9% 40.4%',
  '--tab-hover': '40 22.2% 89.4%',
  '--tab-hover-foreground': '60 2.6% 7.6%',
  '--tab-border': '40 18.2% 87.1%',
  '--tab-active-accent': '11.9 81.5% 51.4%',
  '--primary': '60 2.6% 7.6%',
  '--primary-foreground': '45 40% 98%',
  '--button-hover': '60 2.4% 16.5%',
  '--status-info': '60 2.6% 7.6%',
  '--status-success': '148.1 79.4% 38%',
  '--status-warning': '40.1 100% 30.2%',
  '--status-danger': '11 88.9% 54.1%',
  '--status-merged': '334.3 48.4% 42.5%',
  '--border': '40 18.2% 87.1%',
  '--input': '45 40% 98%',
  '--switch-track': '41.5 14.3% 82.2%',
  '--input-foreground': '60 2.6% 7.6%',
  '--input-placeholder': '43.6 5.6% 61.8%',
  '--input-border': '41.5 14.3% 82.2%',
  '--ring': '11.9 81.5% 51.4%',
  '--sidebar-background': '45 40% 98%',
  '--sidebar-foreground': '60 2.6% 7.6%',
  '--sidebar-foreground-muted': '43.6 5.6% 61.8%',
  '--sidebar-primary': '60 2.6% 7.6%',
  '--sidebar-primary-foreground': '45 40% 98%',
  '--sidebar-hover': '40 22.2% 89.4%',
  '--sidebar-hover-foreground': '60 2.6% 7.6%',
  '--sidebar-highlight': '11.9 81.5% 51.4%',
  '--sidebar-highlight-foreground': '45 40% 98%',
  '--sidebar-selection': '41.5 21.3% 88%',
  '--sidebar-selection-foreground': '60 2.6% 7.6%',
  '--sidebar-border': '40 18.2% 87.1%',
  '--sidebar-ring': '11.9 81.5% 51.4%',
  '--code-background': '42 27.8% 92.9%',
  '--code-foreground': '60 2.6% 7.6%',
  '--code-border': '41.5 14.3% 82.2%',
  '--code-added': '148.1 79.4% 38%',
  '--code-removed': '11 88.9% 54.1%',
  '--modified-file': '40.1 100% 30.2%',
  '--scrollbar-thumb': '45 8.7% 91%',
  '--scrollbar-thumb-hover': '45 4.9% 83.9%',
  '--scrollbar-thumb-active': '40 2.4% 75.5%',
  '--input-field': '45 40% 98%',
};

const EXPECTED_MOLLY_DARK_CHROME: Record<string, string> = {
  '--background': '240 4.3% 4.5%',
  '--foreground': '42.9 20% 93.1%',
  '--card': '240 2.4% 8%',
  '--card-foreground': '42.9 20% 93.1%',
  '--popover': '240 2.4% 8%',
  '--muted': '240 3.9% 15.1%',
  '--muted-foreground': '260 2% 70%',
  '--secondary': '240 3.9% 15.1%',
  '--secondary-foreground': '42.9 20% 93.1%',
  '--destructive': '11 88.9% 54.1%',
  '--destructive-foreground': '240 4.3% 4.5%',
  '--button-secondary': '240 3.9% 15.1%',
  '--button-secondary-foreground': '42.9 20% 93.1%',
  '--button-secondary-hover': '240 3.4% 17.5%',
  '--hover': '240 3.9% 15.1%',
  '--hover-foreground': '42.9 20% 93.1%',
  '--highlight': '12.6 100% 59%',
  '--highlight-foreground': '240 4.3% 4.5%',
  '--selection': '240 3.9% 15.1%',
  '--selection-foreground': '42.9 20% 93.1%',
  '--selection-inactive': '240 3.9% 15.1%',
  '--selection-inactive-foreground': '42.9 20% 93.1%',
  '--bottom-bar': '240 4.3% 4.5%',
  '--bottom-bar-foreground': '260 2% 70%',
  '--tab-bar': '240 4.3% 4.5%',
  '--tab-active': '240 2.4% 8%',
  '--tab-active-foreground': '42.9 20% 93.1%',
  '--tab-inactive': '240 4.3% 4.5%',
  '--tab-inactive-foreground': '260 2% 70%',
  '--tab-hover': '240 3.9% 15.1%',
  '--tab-hover-foreground': '42.9 20% 93.1%',
  '--tab-border': '240 3.9% 15.1%',
  '--tab-active-accent': '12.6 100% 59%',
  '--primary': '42.9 20% 93.1%',
  '--primary-foreground': '240 4.3% 4.5%',
  '--button-hover': '42.9 12.3% 88.8%',
  '--status-info': '42.9 20% 93.1%',
  '--status-success': '148.1 79.4% 38%',
  '--status-warning': '48.8 54.9% 47.8%',
  '--status-danger': '11 88.9% 54.1%',
  '--status-merged': '48.8 54.9% 47.8%',
  '--border': '240 3.9% 15.1%',
  '--input': '240 2.4% 8%',
  '--switch-track': '240 3.6% 22%',
  '--input-foreground': '42.9 20% 93.1%',
  '--input-placeholder': '252 2% 49.2%',
  '--input-border': '240 3.6% 22%',
  '--ring': '12.6 100% 59%',
  '--sidebar-background': '240 2.4% 8%',
  '--sidebar-foreground': '42.9 20% 93.1%',
  '--sidebar-foreground-muted': '252 2% 49.2%',
  '--sidebar-primary': '42.9 20% 93.1%',
  '--sidebar-primary-foreground': '240 4.3% 4.5%',
  '--sidebar-hover': '240 3.9% 15.1%',
  '--sidebar-hover-foreground': '42.9 20% 93.1%',
  '--sidebar-highlight': '12.6 100% 59%',
  '--sidebar-highlight-foreground': '240 4.3% 4.5%',
  '--sidebar-selection': '240 3.9% 15.1%',
  '--sidebar-selection-foreground': '42.9 20% 93.1%',
  '--sidebar-border': '240 3.9% 15.1%',
  '--sidebar-ring': '12.6 100% 59%',
  '--code-background': '240 2.4% 8%',
  '--code-foreground': '42.9 20% 93.1%',
  '--code-border': '240 3.6% 22%',
  '--code-added': '148.1 79.4% 38%',
  '--code-removed': '11 88.9% 54.1%',
  '--modified-file': '48.8 54.9% 47.8%',
  '--scrollbar-thumb': '240 3.9% 15.1%',
  '--scrollbar-thumb-hover': '240 3.6% 22%',
  '--scrollbar-thumb-active': '240 2.2% 36.1%',
  '--input-field': '240 2.4% 8%',
};

const lightness = (channel: string) => Number.parseFloat(channel.split(' ')[2]);

const variablesOf = (themeId: string, syntax: boolean): Record<string, string> => {
  const theme = getBundledVSCodeThemeByIdSync(themeId);
  expect(theme, themeId).toBeDefined();
  const variables = createMollyThemeCssVariables(theme!);
  return Object.fromEntries(
    Object.entries(variables).filter(([key]) => key.startsWith('--syntax-') === syntax)
  );
};

describe('molly atelier themes', () => {
  it('registers both themes as selectable bundled themes', () => {
    expect(isSelectableBundledVSCodeThemeId('molly-light')).toBe(true);
    expect(isSelectableBundledVSCodeThemeId('molly-dark')).toBe(true);
    expect(getBundledVSCodeThemeByIdSync('molly-light')?.type).toBe('light');
    expect(getBundledVSCodeThemeByIdSync('molly-dark')?.type).toBe('dark');
  });

  it('is the fixed default theme selection', () => {
    expect(DEFAULT_VSCODE_THEME_SELECTION).toEqual({
      lightThemeId: 'molly-light',
      darkThemeId: 'molly-dark',
    });
  });

  it('resolves molly-light chrome to the Atelier channels', () => {
    expect(variablesOf('molly-light', false)).toEqual(EXPECTED_MOLLY_LIGHT_CHROME);
  });

  it('resolves molly-dark chrome to the Atelier channels', () => {
    expect(variablesOf('molly-dark', false)).toEqual(EXPECTED_MOLLY_DARK_CHROME);
  });

  it('keeps the ground/panel ordering (panels lift above the ground in light, ground sinks below panels in dark)', () => {
    const light = variablesOf('molly-light', false);
    const dark = variablesOf('molly-dark', false);
    expect(lightness(light['--background'])).toBeLessThan(lightness(light['--card']));
    expect(lightness(dark['--background'])).toBeLessThan(lightness(dark['--card']));
  });

  it('keeps primary as the ink inversion and reserves vermilion for focus and the active-tab accent', () => {
    for (const id of ['molly-light', 'molly-dark']) {
      const vars = variablesOf(id, false);
      expect(vars['--primary']).toBe(vars['--foreground']);
      expect(vars['--tab-active-accent']).toBe(vars['--ring']);
      expect(Number.parseFloat(vars['--ring'])).toBeLessThan(15);
      expect(vars['--selection']).not.toBe(vars['--primary']);
    }
  });

  it('resolves syntax colors from the forked themes (content, not chrome)', () => {
    // Light keeps the Vitesse lineage from lody-light; dark keeps Vesper's.
    expect(Object.keys(variablesOf('molly-light', true)).sort()).toEqual([
      '--syntax-attr',
      '--syntax-builtin',
      '--syntax-comment',
      '--syntax-function',
      '--syntax-keyword',
      '--syntax-number',
      '--syntax-string',
      '--syntax-title',
      '--syntax-variable',
    ]);
    expect(Object.keys(variablesOf('molly-dark', true)).length).toBeGreaterThanOrEqual(8);
  });
});
