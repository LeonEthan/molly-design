# Connection form clarity

Status: implemented
Translation: pending

## Abstract

Phase 3 of the UI/UX cleanup reduces the visible model and image connection forms
without changing saved contracts, credential handling or network requests.

## Decisions

Reuse `ModelConnectionForm` and `ImageConnectionForm`, the existing Radix
`Collapsible`, `Field`, `InfoTip`, checks and model suggestions. No new form system,
protocol abstraction or storage is needed. Native model connection names and model
catalog filters move under More options; required compatible-model metadata stays
visible. Draft state remains owned by the form when optional fields unmount.

Provider selection still supplies the existing provider name and default address.
The request destination stays visible, custom addresses remain editable, and a
changed destination still clears the draft key. Key help explains where to obtain
one and that a custom service requires that service's key.

Image connection type stays explicit. Protocol limitations and API path details
move to focusable help; invalid addresses and destination-key requirements remain
inline. Image model suggestions still require an explicit click or manual input.
No default image model, paid probe or automatic retry was added.

The setup strip explicitly labels saved configurations as Configured and image
and Pinterest setup as optional. Key check passed describes the free check only;
existing help explains that model access, billing and image generation/editing
have not been tested. Pinterest cookies still do not establish sign-in.

## Validation

The targeted model, image and readiness suites pass 59 tests, including collapsed
draft preservation, saving without a catalog/check, destination changes, rejected
checks, no automatically chosen image model and no DashScope check. Component
TypeScript, full `pnpm check` (types, lint, tests, translations and boundary guards),
Electron `build:app`, scoped Prettier, `git diff --check` and `pnpm run docs check`
pass. Docs retains existing rule-size warnings, with no errors.

The rebuilt macOS Electron app was checked through its real settings UI: new
provider selection, visible destination, collapsed and expanded More options,
image form and keyboard-focused API path help. Saved image metadata remained
unchanged while the existing free check reported Key check passed. Screenshots
stay outside the repository in the local audit artifact directory; no captured
user data is committed. Native UI was checked in English with the user's existing
font; Chinese copy is covered by translation and component checks. Actual paid
model execution was not tested.

No credentials or artwork were changed and no paid model request was made.
