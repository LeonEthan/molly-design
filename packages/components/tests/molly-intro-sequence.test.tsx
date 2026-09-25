// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { initI18n } from '../src/i18n';
import { IntroSequence } from '../src/components/onboarding/ceremony/intro-sequence';
import { MollySetupArtwork } from '../src/components/onboarding/molly-setup-artwork';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each([
  {
    locale: 'en',
    titles: ['Unexpected connections.', 'Your vision. Your finishing touch.', 'Make your mark.'],
    descriptions: [
      'A reference. A few words. A new beginning.',
      'Create with Molly. Fine-tune every detail.',
      'Your ideas. Your signature.',
    ],
    skip: 'Skip',
    start: 'Start setup',
    callout: 'Make the headline bolder.',
    example: 'Design example',
  },
  {
    locale: 'zh_CN',
    titles: ['让灵感相遇。', '灵感成形，细节由你。', 'Make your mark.'],
    descriptions: [
      '一张参考，一句话，一个新的开始。',
      '与 Molly 一起创作，亲手调整每一处。',
      '做出你的样子。',
    ],
    skip: '跳过',
    start: '开始设置',
    callout: '让标题再大胆一点。',
    example: '创作示意',
  },
] as const)(
  'shows three localized scenes at 0/3/6 seconds and waits for setup ($locale)',
  async ({ locale, titles, descriptions, skip, start, callout, example }) => {
    await initI18n(locale);
    vi.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    const root = createRoot(container);
    const entries: string[] = [];
    try {
      await act(async () => root.render(<IntroSequence onStart={() => entries.push('setup')} />));
      for (const [index, scene] of ['inspiration', 'creation', 'expression'].entries()) {
        expect(container.querySelector('h1')?.textContent).toBe(titles[index]);
        expect(container.textContent).toContain(descriptions[index]);
        expect(container.querySelector('main img')?.getAttribute('src')).toContain(
          `molly-intro-${scene}.png`
        );
        expect(container.querySelector('.molly-intro-count')?.textContent).toBe(
          `0${index + 1} / 03`
        );
        const selectors = container.querySelectorAll<HTMLButtonElement>(
          '.molly-intro-segments button'
        );
        expect(selectors).toHaveLength(3);
        expect(selectors[index].getAttribute('aria-current')).toBe('step');
        expect(selectors[index].getAttribute('aria-label')).toContain(titles[index]);
        expect(container.querySelector('.molly-intro-footer > button')?.textContent).toBe(
          index === 2 ? start : skip
        );
        if (index === 1) {
          expect(container.textContent).toContain(callout);
          expect(container.textContent).toContain(example);
        }
        if (index < 2) {
          await act(async () => vi.advanceTimersByTime(2999));
          expect(container.querySelector('h1')?.textContent).toBe(titles[index]);
          await act(async () => vi.advanceTimersByTime(1));
        }
      }
      expect(entries).toEqual([]);
      await act(async () =>
        container.querySelector<HTMLButtonElement>('.molly-intro-footer > button')!.click()
      );
      expect(entries).toEqual(['setup']);
      await act(async () => vi.advanceTimersByTime(30000));
      expect(container.querySelector('h1')?.textContent).toBe(titles[2]);
      expect(entries).toEqual(['setup']);
    } finally {
      act(() => root.unmount());
    }
  }
);

it('keeps the opening still until playing and permits an immediate skip', async () => {
  await initI18n('en');
  vi.useFakeTimers();
  const container = document.createElement('div');
  const root = createRoot(container);
  let destination = 'opening';
  try {
    await act(async () =>
      root.render(
        <IntroSequence
          playing={false}
          onStart={() => {
            destination = 'setup';
          }}
        />
      )
    );
    await act(async () => vi.advanceTimersByTime(10000));
    expect(container.querySelector('h1')?.textContent).toBe('Unexpected connections.');
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.molly-intro-footer > button')!.click()
    );
    expect(destination).toBe('setup');
  } finally {
    act(() => root.unmount());
  }
});

it('retains the editorial setup artwork independently of the new opening', async () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<MollySetupArtwork />));
    expect(container.querySelector('img')?.getAttribute('src')).toContain('molly-editorial-v3.png');
  } finally {
    act(() => root.unmount());
  }
});

it('stops automatic advancement even when the active segment is selected, and permits revisiting every scene', async () => {
  await initI18n('en');
  vi.useFakeTimers();
  const container = document.createElement('div');
  const root = createRoot(container);
  const selectors = () =>
    container.querySelectorAll<HTMLButtonElement>('.molly-intro-segments button');
  try {
    await act(async () => root.render(<IntroSequence onStart={() => {}} />));
    await act(async () => vi.advanceTimersByTime(2999));
    await act(async () => selectors()[0].click());
    await act(async () => vi.advanceTimersByTime(30000));
    expect(container.querySelector('h1')?.textContent).toBe('Unexpected connections.');
    for (const index of [2, 1, 0]) {
      await act(async () => selectors()[index].click());
      expect(container.querySelector('.molly-intro-count')?.textContent).toBe(`0${index + 1} / 03`);
      expect(container.querySelector('.molly-intro-footer > button')?.textContent).toBe(
        index === 2 ? 'Start setup' : 'Skip'
      );
      await act(async () => vi.advanceTimersByTime(30000));
      expect(selectors()[index].getAttribute('aria-current')).toBe('step');
    }
    await act(async () => root.render(<IntroSequence playing={false} onStart={() => {}} />));
    await act(async () => root.render(<IntroSequence playing onStart={() => {}} />));
    await act(async () => vi.advanceTimersByTime(30000));
    expect(selectors()[0].getAttribute('aria-current')).toBe('step');
  } finally {
    act(() => root.unmount());
  }
});

it('honors reduced motion on entry and on preference changes without losing manual selection', async () => {
  await initI18n('en');
  vi.useFakeTimers();
  class MotionPreference extends EventTarget {
    matches = true;
    media = '(prefers-reduced-motion: reduce)';
    onchange = null;
    addListener() {}
    removeListener() {}
    set(value: boolean) {
      this.matches = value;
      this.dispatchEvent(new Event('change'));
    }
  }
  const preference = new MotionPreference();
  vi.spyOn(window, 'matchMedia').mockReturnValue(preference);
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<IntroSequence onStart={() => {}} />));
    await act(async () => vi.advanceTimersByTime(30000));
    expect(container.querySelector('.molly-intro-count')?.textContent).toBe('01 / 03');
    await act(async () => preference.set(false));
    await act(async () => vi.advanceTimersByTime(3000));
    expect(container.querySelector('.molly-intro-count')?.textContent).toBe('02 / 03');
    await act(async () => preference.set(true));
    await act(async () => vi.advanceTimersByTime(30000));
    expect(container.querySelector('.molly-intro-count')?.textContent).toBe('02 / 03');
    await act(async () =>
      container.querySelectorAll<HTMLButtonElement>('.molly-intro-segments button')[2].click()
    );
    expect(container.querySelector('.molly-intro-footer > button')?.textContent).toBe(
      'Start setup'
    );
    await act(async () => preference.set(false));
    await act(async () =>
      container.querySelectorAll<HTMLButtonElement>('.molly-intro-segments button')[0].click()
    );
    await act(async () => vi.advanceTimersByTime(30000));
    expect(container.querySelector('.molly-intro-count')?.textContent).toBe('01 / 03');
  } finally {
    act(() => root.unmount());
  }
});
