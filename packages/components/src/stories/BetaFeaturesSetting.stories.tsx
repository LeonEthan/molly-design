import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { createStore, Provider, useAtomValue } from 'jotai';
import { BetaFeaturesSection } from '@/components/settings/beta-features-setting';
import {
  developerModeEnabledAtom,
  tasksBetaEnabledAtom,
  tasksFeatureEnabledAtom,
} from '@/atoms/settings';
import { settingContainerClass } from '@/components/settings';

/**
 * The section is invisible unless Developer mode is on, so the interesting
 * states cover each independent beta opt-in plus the derived gates consumed by
 * their product surfaces.
 */
function GateReadout() {
  const tasksEnabled = useAtomValue(tasksFeatureEnabledAtom);
  return (
    <div className="mt-3 space-y-1 text-xs text-muted-foreground">
      <p>
        <span className="font-mono">tasksFeatureEnabledAtom</span> ={' '}
        <span className="font-mono font-semibold">{String(tasksEnabled)}</span>
      </p>
    </div>
  );
}

function Harness({ developerMode, tasksBeta }: { developerMode: boolean; tasksBeta: boolean }) {
  // Seeded once per story: a store rebuilt on every render would throw away the
  // switch the viewer just clicked.
  const [store] = useState(() => {
    const next = createStore();
    next.set(developerModeEnabledAtom, developerMode);
    next.set(tasksBetaEnabledAtom, tasksBeta);
    return next;
  });

  return (
    <Provider store={store}>
      <div className={settingContainerClass}>
        <BetaFeaturesSection />
        <GateReadout />
      </div>
    </Provider>
  );
}

const meta = {
  title: 'Settings/BetaFeaturesSection',
  component: Harness,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Developer mode off: the section and Tasks are absent. */
export const DeveloperModeOff: Story = {
  args: { developerMode: false, tasksBeta: false },
};

/** Developer mode on: the switch is offered, but Tasks stay hidden. */
export const AvailableNotEnabled: Story = {
  args: { developerMode: true, tasksBeta: false },
};

/** Developer mode and the Tasks opt-in are the only combination that enables Tasks. */
export const TasksBetaEnabled: Story = {
  args: { developerMode: true, tasksBeta: true },
};

/**
 * Opt-ins persist while Developer mode is off, so the features are hidden but
 * the choices are restored when Developer mode comes back.
 */
export const OptInRetainedWhileHidden: Story = {
  args: { developerMode: false, tasksBeta: true },
};
