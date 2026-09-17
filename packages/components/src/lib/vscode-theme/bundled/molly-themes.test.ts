import { describe, expect, it } from 'vitest';
import { createMollyThemeCssVariables } from '../vscode-theme-css';
import { DEFAULT_VSCODE_THEME_SELECTION } from '../theme-selection-storage';
import {
  getBundledVSCodeThemeByIdSync,
  isSelectableBundledVSCodeThemeId,
} from './bundled-vscode-themes';

/**
 * Frozen chrome contract for the Molly monochrome themes.
 *
 * Authority: .agents/notes/proposed/feature/2026-09-16-monochrome-chrome-visual-refresh.zh.md
 * (in-repo decision record with the token mapping table). The full user-approved
 * frozen spec and the interactive demo live locally under
 * output/visual-refresh-demo/ — that directory is gitignored (generated
 * artifacts), so committed code cites the note, not the output path.
 *
 * These expectations are the source of truth for the black/white Figma-language
 * palette: greys resolve to exact HSL channels, --primary/--selection/--ring are
 * the solid foreground inversion, and the only chromatic values are the red/green
 * signal pair plus the retained theme magenta for --status-merged (documented
 * exception — it is git/syntax territory, not chrome).
 */

const EXPECTED_MOLLY_LIGHT_CHROME: Record<string, string> = {
  '--background': '0 0% 96.1%', // canvas ground #f5f5f5 (lighter than panels in light)
  '--foreground': '0 0% 11.8%', // #1e1e1e
  '--card': '0 0% 100%', // panel #ffffff
  '--card-foreground': '0 0% 11.8%',
  '--popover': '0 0% 100%',
  '--muted': '0 0% 96.1%',
  '--muted-foreground': '0 0% 43.5%', // fg-2 #6f6f6f
  '--secondary': '0 0% 96.1%',
  '--secondary-foreground': '0 0% 11.8%',
  '--destructive': '11 88.9% 54.1%', // signal red #f24822
  '--destructive-foreground': '0 0% 100%',
  '--button-secondary': '0 0% 96.1%',
  '--button-secondary-foreground': '0 0% 11.8%',
  '--button-secondary-hover': '0 0% 92.2%',
  '--hover': '0 0% 92.2%', // #ebebeb
  '--hover-foreground': '0 0% 11.8%',
  '--highlight': '0 0% 11.8%',
  '--highlight-foreground': '0 0% 100%',
  '--selection': '0 0% 11.8%', // solid inversion (black row, white text)
  '--selection-foreground': '0 0% 100%',
  '--selection-inactive': '0 0% 96.1%',
  '--selection-inactive-foreground': '0 0% 11.8%',
  '--bottom-bar': '0 0% 100%',
  '--bottom-bar-foreground': '0 0% 43.5%',
  '--tab-bar': '0 0% 100%',
  '--tab-active': '0 0% 100%',
  '--tab-active-foreground': '0 0% 11.8%',
  '--tab-inactive': '0 0% 96.1%',
  '--tab-inactive-foreground': '0 0% 43.5%',
  '--tab-hover': '0 0% 92.2%',
  '--tab-hover-foreground': '0 0% 11.8%',
  '--tab-border': '0 0% 89.8%', // #e5e5e5
  '--tab-active-accent': '0 0% 11.8%', // black top border on active tab
  '--primary': '0 0% 11.8%', // inverted foreground = primary
  '--primary-foreground': '0 0% 100%',
  '--button-hover': '0 0% 20%', // #333333
  '--status-info': '0 0% 11.8%',
  '--status-success': '148.1 79.4% 38%', // signal green #14ae5c
  '--status-warning': '40.1 100% 30.2%', // #9a6700
  '--status-danger': '11 88.9% 54.1%',
  '--status-merged': '334.3 48.4% 42.5%', // retained theme magenta (exception)
  '--border': '0 0% 89.8%',
  '--input': '0 0% 100%', // raised field
  '--switch-track': '0 0% 85.1%', // #d9d9d9
  '--input-foreground': '0 0% 11.8%',
  '--input-placeholder': '0 0% 63.9%', // #a3a3a3
  '--input-border': '0 0% 85.1%',
  '--ring': '0 0% 11.8%', // 2px solid focus ring
  '--sidebar-background': '0 0% 100%',
  '--sidebar-foreground': '0 0% 11.8%',
  '--sidebar-foreground-muted': '0 0% 63.9%',
  '--sidebar-primary': '0 0% 11.8%',
  '--sidebar-primary-foreground': '0 0% 100%',
  '--sidebar-hover': '0 0% 92.2%',
  '--sidebar-hover-foreground': '0 0% 11.8%',
  '--sidebar-highlight': '0 0% 11.8%',
  '--sidebar-highlight-foreground': '0 0% 100%',
  '--sidebar-selection': '0 0% 11.8%',
  '--sidebar-selection-foreground': '0 0% 100%',
  '--sidebar-border': '0 0% 89.8%',
  '--sidebar-ring': '0 0% 11.8%',
  '--code-background': '0 0% 96.1%',
  '--code-foreground': '0 0% 11.8%',
  '--code-border': '0 0% 85.1%',
  '--code-added': '148.1 79.4% 38%',
  '--code-removed': '11 88.9% 54.1%',
  '--modified-file': '40.1 100% 30.2%',
  '--scrollbar-thumb': '0 0% 92.9%',
  '--scrollbar-thumb-hover': '0 0% 86.3%',
  '--scrollbar-thumb-active': '0 0% 78%',
  '--input-field': '0 0% 100%',
};

const EXPECTED_MOLLY_DARK_CHROME: Record<string, string> = {
  '--background': '0 0% 11.8%', // canvas ground #1e1e1e (darker than panels)
  '--foreground': '0 0% 100%',
  '--card': '0 0% 17.3%', // panel #2c2c2c
  '--card-foreground': '0 0% 100%',
  '--popover': '0 0% 17.3%',
  '--muted': '0 0% 22%', // #383838
  '--muted-foreground': '0 0% 72.2%', // fg-2 #b8b8b8
  '--secondary': '0 0% 22%',
  '--secondary-foreground': '0 0% 100%',
  '--destructive': '11 88.9% 54.1%',
  '--destructive-foreground': '0 0% 17.3%',
  '--button-secondary': '0 0% 22%',
  '--button-secondary-foreground': '0 0% 100%',
  '--button-secondary-hover': '0 0% 26.7%', // #444444
  '--hover': '0 0% 22%',
  '--hover-foreground': '0 0% 100%',
  '--highlight': '0 0% 100%',
  '--highlight-foreground': '0 0% 17.3%',
  '--selection': '0 0% 100%', // solid inversion (white row, dark text)
  '--selection-foreground': '0 0% 17.3%',
  '--selection-inactive': '0 0% 22%',
  '--selection-inactive-foreground': '0 0% 100%',
  '--bottom-bar': '0 0% 11.8%',
  '--bottom-bar-foreground': '0 0% 72.2%',
  '--tab-bar': '0 0% 11.8%',
  '--tab-active': '0 0% 17.3%',
  '--tab-active-foreground': '0 0% 100%',
  '--tab-inactive': '0 0% 11.8%',
  '--tab-inactive-foreground': '0 0% 72.2%',
  '--tab-hover': '0 0% 22%',
  '--tab-hover-foreground': '0 0% 100%',
  '--tab-border': '0 0% 22%',
  '--tab-active-accent': '0 0% 100%',
  '--primary': '0 0% 100%', // inverted foreground = primary
  '--primary-foreground': '0 0% 17.3%',
  '--button-hover': '0 0% 89.8%', // #e5e5e5
  '--status-info': '0 0% 100%',
  '--status-success': '148.1 79.4% 38%',
  '--status-warning': '48.8 54.9% 47.8%', // #bda437
  '--status-danger': '11 88.9% 54.1%',
  '--status-merged': '48.8 54.9% 47.8%', // forked Vesper merge yellow (exception)
  '--border': '0 0% 22%',
  '--input': '0 0% 17.3%',
  '--switch-track': '0 0% 30.2%', // #4d4d4d
  '--input-foreground': '0 0% 100%',
  '--input-placeholder': '0 0% 50.2%', // #808080
  '--input-border': '0 0% 30.2%',
  '--ring': '0 0% 100%',
  '--sidebar-background': '0 0% 17.3%',
  '--sidebar-foreground': '0 0% 100%',
  '--sidebar-foreground-muted': '0 0% 50.2%',
  '--sidebar-primary': '0 0% 100%',
  '--sidebar-primary-foreground': '0 0% 17.3%',
  '--sidebar-hover': '0 0% 22%',
  '--sidebar-hover-foreground': '0 0% 100%',
  '--sidebar-highlight': '0 0% 100%',
  '--sidebar-highlight-foreground': '0 0% 17.3%',
  '--sidebar-selection': '0 0% 100%',
  '--sidebar-selection-foreground': '0 0% 17.3%',
  '--sidebar-border': '0 0% 22%',
  '--sidebar-ring': '0 0% 100%',
  '--code-background': '0 0% 17.3%',
  '--code-foreground': '0 0% 100%',
  '--code-border': '0 0% 30.2%',
  '--code-added': '148.1 79.4% 38%',
  '--code-removed': '11 88.9% 54.1%',
  '--modified-file': '48.8 54.9% 47.8%',
  '--scrollbar-thumb': '0 0% 23.9%',
  '--scrollbar-thumb-hover': '0 0% 30.2%',
  '--scrollbar-thumb-active': '0 0% 38%',
  '--input-field': '0 0% 17.3%',
};

const variablesOf = (themeId: string, syntax: boolean): Record<string, string> => {
  const theme = getBundledVSCodeThemeByIdSync(themeId);
  expect(theme, themeId).toBeDefined();
  const variables = createMollyThemeCssVariables(theme!);
  return Object.fromEntries(
    Object.entries(variables).filter(([key]) => key.startsWith('--syntax-') === syntax)
  );
};

describe('molly monochrome themes', () => {
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

  it('resolves molly-light chrome to the frozen monochrome channels', () => {
    expect(variablesOf('molly-light', false)).toEqual(EXPECTED_MOLLY_LIGHT_CHROME);
  });

  it('resolves molly-dark chrome to the frozen monochrome channels', () => {
    expect(variablesOf('molly-dark', false)).toEqual(EXPECTED_MOLLY_DARK_CHROME);
  });

  it('keeps the canvas/panel ordering of the demo (canvas darker than panels in dark, lighter in light)', () => {
    const light = variablesOf('molly-light', false);
    const dark = variablesOf('molly-dark', false);
    // Light: ground 96.1% is lighter than the 100% panel.
    expect(light['--background']).toBe('0 0% 96.1%');
    expect(light['--card']).toBe('0 0% 100%');
    // Dark: ground 11.8% is darker than the 17.3% panel.
    expect(dark['--background']).toBe('0 0% 11.8%');
    expect(dark['--card']).toBe('0 0% 17.3%');
  });

  it('resolves selection and ring to the solid foreground inversion', () => {
    const light = variablesOf('molly-light', false);
    const dark = variablesOf('molly-dark', false);
    expect(light['--selection']).toBe(light['--foreground']);
    expect(light['--selection-foreground']).toBe(light['--card']);
    expect(light['--ring']).toBe(light['--foreground']);
    expect(dark['--selection']).toBe(dark['--foreground']);
    expect(dark['--selection-foreground']).toBe(dark['--card']);
    expect(dark['--ring']).toBe(dark['--foreground']);
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
