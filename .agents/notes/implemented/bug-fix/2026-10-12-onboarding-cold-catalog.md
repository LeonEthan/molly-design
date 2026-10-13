# Onboarding cold catalog synchronization

Status: implemented
Translation: pending

## Abstract

The Connect-a-model screen could keep the published built-in Molly unavailable
even with its local workspace and daemon identity ready. Both onboarding catalog
consumers disabled the existing machine Flock room synchronization, so a cold
renderer replica remained empty until another product surface subscribed. Setup
and summary now borrow the same presence-gated room as ordinary catalog consumers.
Deterministic component tests reproduce and fix this boundary; packaged real-data
acceptance remains a separate check and is not established by these fixtures.

## Evidence and ownership

The earlier workspace-binding repair is still necessary and remains in
`routes/onboarding.tsx`. Binding the workspace alone is insufficient: the
renderer must receive the daemon's published catalog. The defect is in the two
onboarding callers' `syncRemote: false` option, not a missing credential or a
missing implicit workspace. The option also suppresses a room routed only to the
local daemon; “remote” in this hook describes synchronization with its transport
peer, not an authenticated product-cloud request.

The regression mounts the production `ProvidersScreen` or `OnboardingOverlay`
with the production machine Flock hooks, empty renderer rows, a bound workspace,
a known local machine and a fixed fresh presence heartbeat. A controlled local
room supplies the published Molly only after an explicit first-sync signal.
Before the fix, the setup screen still has no Molly button after that signal.
With the default subscription, setup exposes the exact published config, requires
the user's explicit selection before enabling Next, and disables Next after the
selected row is deleted. The summary independently recovers its saved selection
when the same local catalog arrives, without mounting the setup screen.

## Reuse and limits

The existing `useMachineFlockAgentConfigsForMachineIds` default already supplies
the required room lease, online-machine gate, row families, eligibility input and
ref-counted sharing. Reusing it directly avoids a new hook, RPC, catalog store,
retry loop or synthesized config. No higher rung of the reuse ladder was rejected:
the existing mechanism fits without adaptation. Provider eligibility, encrypted
connection settings, explicit model choice and Skip behavior remain owned by
their existing modules. No new installation, authentication or inference runs
are triggered by catalog synchronization.

`pnpm --dir packages/components exec vitest run tests/onboarding-catalog-hydration.test.tsx`
first failed at the missing Molly button and then passed after restoring the
default room subscription. This is a deterministic transport-boundary regression,
not proof of credentials, real inference or the exact cause of every earlier
packaged runtime failure. The fake peer carries synthetic public fixture metadata
only; no captured conversations, credentials or machine-local records enter Git.
