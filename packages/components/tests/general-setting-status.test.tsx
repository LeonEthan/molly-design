// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { getDesktopNotificationStatusKey } from '../src/components/settings/general-setting';
import { QueuedMessageBehaviorControl } from '../src/components/settings/queued-message-behavior-control';
import { initI18n } from '../src/i18n';
import en from '../../../locales/en.json';
import zh from '../../../locales/zh_CN.json';

vi.mock('../src/components/settings', () => ({ settingContainerClass: '' }));

it.each([
  [false, 'default', false, 'unsupportedDesktop'],
  [true, 'denied', false, 'permissionDeniedStatusDesktop'],
  [true, 'default', false, 'permissionDefault'],
  [true, 'granted', false, 'disabledDesktop'],
  [true, 'granted', true, 'permissionGranted'],
] as const)(
  'distinguishes platform support, system permission and the saved toggle: %s %s %s',
  (supported, permission, enabled, key) => {
    expect(getDesktopNotificationStatusKey({ supported, permission, enabled })).toBe(
      `settings.notifications.${key}`
    );
  }
);

it.each(['en', 'zh_CN'] as const)(
  'keeps the concrete message choices mapped to queue and guide: %s',
  async (language) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    await initI18n(language);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const choices: string[] = [];
    try {
      await act(async () =>
        root.render(
          <QueuedMessageBehaviorControl value="queue" onChange={(value) => choices.push(value)} />
        )
      );
      const copy = language === 'en' ? en : zh;
      const buttons = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
      expect(buttons.map((button) => button.textContent)).toEqual([
        copy['settings.general.sessions.queuedMessageBehavior.queue'],
        copy['settings.general.sessions.queuedMessageBehavior.guide'],
      ]);
      expect(buttons[0].getAttribute('aria-checked')).toBe('true');
      await act(async () => buttons[1].click());
      expect(choices).toEqual(['guide']);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  }
);
