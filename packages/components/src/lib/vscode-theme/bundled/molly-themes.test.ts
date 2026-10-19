import { describe, expect, it } from 'vitest';
import { hexColorContrastRatio } from '../vscode-theme-color';
import { createMollyThemeCssVariables } from '../vscode-theme-css';
import { DEFAULT_VSCODE_THEME_SELECTION } from '../theme-selection-storage';
import {
  getBundledVSCodeThemeByIdSync,
  isSelectableBundledVSCodeThemeId,
} from './bundled-vscode-themes';

/**
 * Chrome contract for the Molly soft-lime themes.
 *
 * Authority: .agents/notes/proposed/feature/2026-10-18-soft-lime-theme.md
 * (owner-approved 2026-10-18 revision of the 2026-10-04 Atelier record). Warm
 * Paper and Ink grounds keep tonal chrome; a soft lime fill marks only the
 * "selected / act here" controls (primary actions, selected rows and options)
 * with dark olive text, while focus, the active-tab accent and success read in
 * the deeper accent ink. The retained --status-merged exception is unchanged.
 */

const EXPECTED_MOLLY_LIGHT_CHROME: Record<string, string> = {
  '--background': '41.2 47.1% 93.3%',
  '--foreground': '66 12.8% 15.3%',
  '--card': '43.6 57.9% 96.3%',
  '--card-foreground': '66 12.8% 15.3%',
  '--popover': '42.9 100% 98.6%',
  '--muted': '42 37% 89.4%',
  '--muted-foreground': '48 9.9% 39.6%',
  '--secondary': '42 37% 89.4%',
  '--secondary-foreground': '66 12.8% 15.3%',
  '--destructive': '12.4 50.4% 45.1%',
  '--destructive-foreground': '41.2 47.1% 93.3%',
  '--button-secondary': '42 37% 89.4%',
  '--button-secondary-foreground': '66 12.8% 15.3%',
  '--button-secondary-hover': '40.9 30.6% 85.9%',
  '--hover': '42 37% 89.4%',
  '--hover-foreground': '66 12.8% 15.3%',
  '--highlight': '76.3 70.6% 26.7%',
  '--highlight-foreground': '41.2 47.1% 93.3%',
  '--selection': '71.1 52.9% 90%',
  '--selection-foreground': '66 12.8% 15.3%',
  '--selection-inactive': '42 37% 89.4%',
  '--selection-inactive-foreground': '66 12.8% 15.3%',
  '--bottom-bar': '43.6 57.9% 96.3%',
  '--bottom-bar-foreground': '48 9.9% 39.6%',
  '--tab-bar': '43.6 57.9% 96.3%',
  '--tab-active': '43.6 57.9% 96.3%',
  '--tab-active-foreground': '66 12.8% 15.3%',
  '--tab-inactive': '41.2 47.1% 93.3%',
  '--tab-inactive-foreground': '48 9.9% 39.6%',
  '--tab-hover': '42 37% 89.4%',
  '--tab-hover-foreground': '66 12.8% 15.3%',
  '--tab-border': '40.9 30.6% 85.9%',
  '--tab-active-accent': '76.3 70.6% 26.7%',
  '--primary': '74.7 60.2% 65.5%',
  '--primary-foreground': '80 54.5% 8.6%',
  '--button-hover': '75.1 53.6% 59.4%',
  '--status-info': '66 12.8% 15.3%',
  '--status-success': '76.3 70.6% 26.7%',
  '--status-warning': '36.6 66.5% 36.3%',
  '--status-danger': '12.4 50.4% 45.1%',
  '--status-merged': '334.3 48.4% 42.5%',
  '--border': '40.9 30.6% 85.9%',
  '--input': '43.6 57.9% 96.3%',
  '--switch-track': '41.5 25.5% 80%',
  '--input-foreground': '66 12.8% 15.3%',
  '--input-placeholder': '45.7 9.6% 57.1%',
  '--input-border': '41.5 25.5% 80%',
  '--ring': '76.3 70.6% 26.7%',
  '--sidebar-background': '43.6 57.9% 96.3%',
  '--sidebar-foreground': '66 12.8% 15.3%',
  '--sidebar-foreground-muted': '45.7 9.6% 57.1%',
  '--sidebar-primary': '74.7 60.2% 65.5%',
  '--sidebar-primary-foreground': '80 54.5% 8.6%',
  '--sidebar-hover': '42 37% 89.4%',
  '--sidebar-hover-foreground': '66 12.8% 15.3%',
  '--sidebar-highlight': '76.3 70.6% 26.7%',
  '--sidebar-highlight-foreground': '80 54.5% 8.6%',
  '--sidebar-selection': '71.1 52.9% 90%',
  '--sidebar-selection-foreground': '66 12.8% 15.3%',
  '--sidebar-border': '40.9 30.6% 85.9%',
  '--sidebar-ring': '76.3 70.6% 26.7%',
  '--code-background': '42 37% 89.4%',
  '--code-foreground': '66 12.8% 15.3%',
  '--code-border': '41.5 25.5% 80%',
  '--code-added': '76.3 70.6% 26.7%',
  '--code-removed': '12.4 50.4% 45.1%',
  '--modified-file': '36.6 66.5% 36.3%',
  '--scrollbar-thumb': '43.6 21.6% 90%',
  '--scrollbar-thumb-hover': '48 11.9% 83.5%',
  '--scrollbar-thumb-active': '49.1 8.9% 75.9%',
  '--input-field': '43.6 57.9% 96.3%',
};

const EXPECTED_MOLLY_DARK_CHROME: Record<string, string> = {
  '--background': '72 10.6% 9.2%',
  '--foreground': '43.3 32.1% 89%',
  '--card': '70 9.4% 12.5%',
  '--card-foreground': '43.3 32.1% 89%',
  '--popover': '68.6 8.9% 15.5%',
  '--muted': '68.6 8.4% 16.3%',
  '--muted-foreground': '46.4 10.6% 59.2%',
  '--secondary': '68.6 8.4% 16.3%',
  '--secondary-foreground': '43.3 32.1% 89%',
  '--destructive': '12.6 67.5% 62.5%',
  '--destructive-foreground': '80 54.5% 8.6%',
  '--button-secondary': '68.6 8.4% 16.3%',
  '--button-secondary-foreground': '43.3 32.1% 89%',
  '--button-secondary-hover': '67.5 8.2% 19.2%',
  '--hover': '68.6 8.4% 16.3%',
  '--hover-foreground': '43.3 32.1% 89%',
  '--highlight': '78.5 54.5% 67.3%',
  '--highlight-foreground': '80 54.5% 8.6%',
  '--selection': '77.1 35% 15.7%',
  '--selection-foreground': '43.3 32.1% 89%',
  '--selection-inactive': '68.6 8.4% 16.3%',
  '--selection-inactive-foreground': '43.3 32.1% 89%',
  '--bottom-bar': '72 10.6% 9.2%',
  '--bottom-bar-foreground': '46.4 10.6% 59.2%',
  '--tab-bar': '72 10.6% 9.2%',
  '--tab-active': '70 9.4% 12.5%',
  '--tab-active-foreground': '43.3 32.1% 89%',
  '--tab-inactive': '72 10.6% 9.2%',
  '--tab-inactive-foreground': '46.4 10.6% 59.2%',
  '--tab-hover': '68.6 8.4% 16.3%',
  '--tab-hover-foreground': '43.3 32.1% 89%',
  '--tab-border': '67.5 8.2% 19.2%',
  '--tab-active-accent': '78.5 54.5% 67.3%',
  '--primary': '78.5 54.5% 67.3%',
  '--primary-foreground': '80 54.5% 8.6%',
  '--button-hover': '77.5 58.5% 73.5%',
  '--status-info': '43.3 32.1% 89%',
  '--status-success': '78.5 54.5% 67.3%',
  '--status-warning': '35.4 62.6% 60.2%',
  '--status-danger': '12.6 67.5% 62.5%',
  '--status-merged': '35.4 62.6% 60.2%',
  '--border': '67.5 8.2% 19.2%',
  '--input': '70 9.4% 12.5%',
  '--switch-track': '66.7 7.6% 23.3%',
  '--input-foreground': '43.3 32.1% 89%',
  '--input-placeholder': '46.7 8% 44.3%',
  '--input-border': '66.7 7.6% 23.3%',
  '--ring': '78.5 54.5% 67.3%',
  '--sidebar-background': '70 9.4% 12.5%',
  '--sidebar-foreground': '43.3 32.1% 89%',
  '--sidebar-foreground-muted': '46.7 8% 44.3%',
  '--sidebar-primary': '78.5 54.5% 67.3%',
  '--sidebar-primary-foreground': '80 54.5% 8.6%',
  '--sidebar-hover': '68.6 8.4% 16.3%',
  '--sidebar-hover-foreground': '43.3 32.1% 89%',
  '--sidebar-highlight': '78.5 54.5% 67.3%',
  '--sidebar-highlight-foreground': '80 54.5% 8.6%',
  '--sidebar-selection': '77.1 35% 15.7%',
  '--sidebar-selection-foreground': '43.3 32.1% 89%',
  '--sidebar-border': '67.5 8.2% 19.2%',
  '--sidebar-ring': '78.5 54.5% 67.3%',
  '--code-background': '68.6 8.4% 16.3%',
  '--code-foreground': '43.3 32.1% 89%',
  '--code-border': '66.7 7.6% 23.3%',
  '--code-added': '78.5 54.5% 67.3%',
  '--code-removed': '12.6 67.5% 62.5%',
  '--modified-file': '35.4 62.6% 60.2%',
  '--scrollbar-thumb': '67.5 8.7% 18%',
  '--scrollbar-thumb-hover': '66.7 7.6% 23.3%',
  '--scrollbar-thumb-active': '50.8 7.6% 33.5%',
  '--input-field': '70 9.4% 12.5%',
};

const lightness = (channel: string) => Number.parseFloat(channel.split(' ')[2]);

const hslChannelToHex = (channel: string): string => {
  const [hue, saturation, light] = channel.split(' ').map((part) => Number.parseFloat(part));
  const s = saturation / 100;
  const l = light / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)]
    .map((value) => Math.round(value * 255).toString(16).padStart(2, '0'))
    .join('')}`;
};

const contrastOf = (first: string, second: string) =>
  hexColorContrastRatio(hslChannelToHex(first), hslChannelToHex(second));

const variablesOf = (themeId: string, syntax: boolean): Record<string, string> => {
  const theme = getBundledVSCodeThemeByIdSync(themeId);
  expect(theme, themeId).toBeDefined();
  const variables = createMollyThemeCssVariables(theme!);
  return Object.fromEntries(
    Object.entries(variables).filter(([key]) => key.startsWith('--syntax-') === syntax)
  );
};

describe('molly soft-lime themes', () => {
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

  it('resolves molly-light chrome to the soft-lime channels', () => {
    expect(variablesOf('molly-light', false)).toEqual(EXPECTED_MOLLY_LIGHT_CHROME);
  });

  it('resolves molly-dark chrome to the soft-lime channels', () => {
    expect(variablesOf('molly-dark', false)).toEqual(EXPECTED_MOLLY_DARK_CHROME);
  });

  it('keeps the ground/panel ordering (panels lift above the ground in light, ground sinks below panels in dark)', () => {
    const light = variablesOf('molly-light', false);
    const dark = variablesOf('molly-dark', false);
    expect(lightness(light['--background'])).toBeLessThan(lightness(light['--card']));
    expect(lightness(dark['--background'])).toBeLessThan(lightness(dark['--card']));
  });

  it('fills only act-here controls with the lime accent and keeps every fill readable', () => {
    for (const id of ['molly-light', 'molly-dark']) {
      const vars = variablesOf(id, false);
      expect(vars['--primary'], id).not.toBe(vars['--foreground']);
      expect(vars['--sidebar-primary'], id).toBe(vars['--primary']);
      expect(vars['--tab-active-accent'], id).toBe(vars['--ring']);
      expect(vars['--status-success'], id).toBe(vars['--ring']);
      expect(vars['--selection'], id).not.toBe(vars['--primary']);
      expect(vars['--sidebar-selection'], id).toBe(vars['--selection']);
      for (const [text, fill] of [
        ['--primary-foreground', '--primary'],
        ['--destructive-foreground', '--destructive'],
        ['--highlight-foreground', '--highlight'],
        ['--foreground', '--background'],
        ['--muted-foreground', '--background'],
        ['--selection-foreground', '--selection'],
        ['--ring', '--background'],
        ['--ring', '--selection'],
        ['--destructive', '--background'],
      ] as const) {
        expect(contrastOf(vars[text], vars[fill]), `${id} ${text} on ${fill}`).toBeGreaterThanOrEqual(
          4.5
        );
      }
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
