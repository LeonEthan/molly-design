// @vitest-environment jsdom

import React, { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfigId, AgentConfigMeta, MachineId } from '@molly/shared';
import { encodeMollyModelOption, MOLLY_UNSELECTED_MODEL } from '@molly/shared/embedded-harness';

vi.mock('../src/components/onboarding/onboarding-shell', () => ({
  OnboardingShell: ({
    title,
    description,
    children,
    primaryAction,
    secondaryAction,
  }: {
    title: string;
    description: string;
    children: ReactNode;
    primaryAction: ReactNode;
    secondaryAction: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{description}</p>
      {children}
      {secondaryAction}
      {primaryAction}
    </main>
  ),
  OnboardingBackButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>Back</button>
  ),
  OnboardingNextButton: ({
    finish: _finish,
    label,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { finish?: boolean; label?: string }) => (
    <button {...props}>{label ?? 'Finish'}</button>
  ),
}));

import {
  getOnboardingDefaultModelId,
  getOnboardingDefaultThinking,
  ProvidersScreenView,
} from '../src/components/onboarding/screens/providers-screen';
import { getOnboardingMollyConfigs } from '../src/components/onboarding/onboarding-agent';
import { initI18n } from '../src/i18n';

const machineId = 'machine-1' as MachineId;

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((item) =>
    item.textContent?.includes(label)
  );
  if (!button) throw new Error(`Expected button containing "${label}"`);
  return button;
}

describe('ProvidersScreenView', () => {
  let root: Root | undefined;
  let container: HTMLDivElement;

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await initI18n('en');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  async function renderView(props: Partial<Parameters<typeof ProvidersScreenView>[0]>) {
    const calls = { back: 0, skip: 0, next: 0 };
    await act(async () =>
      root?.render(
        <ProvidersScreenView
          languageReady={false}
          imageReady={false}
          modelReady={false}
          mollyAvailable={false}
          onBack={() => {
            calls.back += 1;
          }}
          onSkip={() => {
            calls.skip += 1;
          }}
          onNext={() => {
            calls.next += 1;
          }}
          {...props}
        />
      )
    );
    return calls;
  }

  it('shows the Connect your models copy with no Molly chip list', async () => {
    await renderView({ mollyAvailable: true });
    expect(container.querySelector('h1')?.textContent).toBe('Connect your models');
    expect(container.textContent).toContain('You need a language model and an image model');
    expect(container.textContent).not.toContain('Select the built-in Molly');
    expect(container.querySelector('[aria-pressed]')).toBeNull();
  });

  it.each([
    [{}, false],
    [{ languageReady: true, imageReady: true, mollyAvailable: true }, false],
    [{ languageReady: true, modelReady: true, mollyAvailable: true }, false],
    [{ imageReady: true, modelReady: true, mollyAvailable: true }, false],
    [{ languageReady: true, imageReady: true, modelReady: true }, false],
    [{ languageReady: true, imageReady: true, modelReady: true, mollyAvailable: true }, true],
  ] as const)('gates Finish on both models and an eligible Molly: %s', async (props, enabled) => {
    await renderView(props);
    expect(findButton(container, 'Finish').disabled).toBe(!enabled);
  });

  it('explains only when no eligible built-in Molly exists', async () => {
    await renderView({});
    expect(container.textContent).toContain('built-in Molly catalog is not available');
    await act(async () =>
      root?.render(
        <ProvidersScreenView
          languageReady
          imageReady
          modelReady
          mollyAvailable
          onBack={() => undefined}
          onSkip={() => undefined}
          onNext={() => undefined}
        />
      )
    );
    expect(container.textContent).not.toContain('built-in Molly catalog is not available');
  });

  it('wires Skip and Back without requiring readiness', async () => {
    const calls = await renderView({});
    await act(async () => findButton(container, 'Skip for now').click());
    await act(async () => findButton(container, 'Back').click());
    expect(calls).toEqual({ back: 1, skip: 1, next: 0 });
  });
});

describe('getOnboardingMollyConfigs', () => {
  const molly: AgentConfigMeta = {
    id: 'molly-b' as AgentConfigId,
    machineId,
    name: 'Molly B',
    description: undefined,
    cliType: 'builtin',
    agentType: 'molly',
    env: {},
  };

  it('keeps only eligible local built-in Molly configs, sorted by name then id', () => {
    const mollyA = { ...molly, id: 'molly-a' as AgentConfigId, name: 'Molly A' };
    const retired = { ...molly, id: 'retired' as AgentConfigId, agentType: 'claude' };
    const remote = { ...molly, id: 'remote' as AgentConfigId, machineId: 'remote' as MachineId };
    const overridden = {
      ...molly,
      id: 'override' as AgentConfigId,
      runtimeOverrides: {},
    } as unknown as AgentConfigMeta;
    expect(
      getOnboardingMollyConfigs([molly, retired, remote, overridden, mollyA], machineId)
    ).toEqual([mollyA, molly]);
    expect(getOnboardingMollyConfigs([molly], null)).toEqual([]);
  });
});

describe('getOnboardingDefaultModelId', () => {
  const options = [
    { value: MOLLY_UNSELECTED_MODEL, label: 'Select a connection and model' },
    { value: encodeMollyModelOption('conn-a', 'alpha/1'), label: 'alpha' },
    { value: encodeMollyModelOption('conn-b', 'beta/1'), label: 'beta' },
  ];

  it('picks the first offered model of a ready connection', () => {
    expect(getOnboardingDefaultModelId(options, new Set(['conn-b']))).toBe(
      encodeMollyModelOption('conn-b', 'beta/1')
    );
    expect(getOnboardingDefaultModelId(options, new Set(['conn-b', 'conn-a']))).toBe(
      encodeMollyModelOption('conn-a', 'alpha/1')
    );
  });

  it('returns null until a ready connection has a projected model', () => {
    expect(getOnboardingDefaultModelId(options, new Set(['conn-missing']))).toBeNull();
    expect(getOnboardingDefaultModelId(options, new Set())).toBeNull();
    expect(getOnboardingDefaultModelId([options[0]!], new Set(['conn-a']))).toBeNull();
  });
});

describe('getOnboardingDefaultThinking', () => {
  it('prefers medium and falls back to the model’s first level', () => {
    expect(getOnboardingDefaultThinking(['off', 'medium', 'high'])).toBe('medium');
    expect(getOnboardingDefaultThinking(['off', 'high'])).toBe('off');
    expect(getOnboardingDefaultThinking(undefined)).toBe('medium');
  });
});
