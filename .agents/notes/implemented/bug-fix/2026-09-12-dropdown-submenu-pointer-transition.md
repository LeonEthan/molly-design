# Preserve sparse pointer transitions into dropdown submenus

Status: implemented
Date: 2026-09-12
Translation: pending

## Abstract

At compact desktop widths, a left-opening Run configuration submenu could close
between hover and click even though its enabled option was visible to the browser.
The shared trigger now recognizes a pointer transition whose related target is
already inside that trigger's own submenu and leaves the submenu focused. This
preserves existing immediate hover, sibling-submenu coordination, keyboard focus,
and keep-open selection behavior; validation covers the original 900×670 layout
with a real browser pointer.

## Evidence and decision

The installed `567741b` package failed in the synthetic Grok acceptance run rooted
at `folio-installed-grok-stop-v2-liCnIW`. The trace recorded an ordinary Run
configuration click, Agent hover, one enabled unchecked provider option, and then
`<html> intercepts pointer events` followed by the target detaching. The failure
occurred before model execution and completed owned cleanup.

A deterministic replay of the retained trace and a focused Storybook browser case
reproduced the same failure at a 900×670 viewport with the Agent submenu opening to
the left. The baseline target was hit-testable before pointer movement, disproving
the initial clipping hypothesis. Pointer event capture narrowed the transition
further: the trigger's
`pointerleave` already named the Grok submenu row as `relatedTarget`, but Radix had
not observed a leftward `pointermove` within the trigger. Its direction-based grace
path therefore refocused the parent menu and the controlled submenu closed before
the destination received `pointerover`.

Portaling the submenu did not change the failure. Removing the custom submenu
coordinator changed hover timing and was unnecessary. The repair instead keeps the
existing coordinator and prevents the parent-leave path only when `aria-controls`
resolves this trigger's submenu and that exact submenu contains `relatedTarget`.
Transitions elsewhere retain Radix's normal close and grace behavior.

## Verification and limits

`dropdown-submenu-pointer.spec.ts` renders the real `DesktopRunConfigMenu` at the
captured viewport and anchor geometry. It requires a left-opening submenu, verifies
the target center is hit-testable, performs a normal Playwright pointer click, and
observes the selected row's `aria-checked` state. Before the repair it timed out for
30 seconds with the retained interception/detachment sequence; after the repair it
passes in about two seconds. The existing dropdown primitive unit suite remains the
coverage for immediate sibling hover and keyboard focus.

The normal installed `70c9932` package then passed the pointer-only READY2 run at
`folio-installed-grok-stop-v2-pointer-QQ08zh`. With the current artwork open at
900×670, the submenu opened left, its ordinary browser hit test landed inside the
option, pointer selection completed, and reopening showed the persisted checked
state. Session metadata and the same-machine configuration row agreed on the
selected `builtin/grok` ID; no Agent Session, model completion, or image request
started, and cleanup completed without errors.

The earlier READY1 attempt at `folio-installed-grok-stop-v2-pointer-Gp4foE` remains
as a fixture-precondition failure: a shortened synthetic provider name fit in the
312 px available on the right, so the submenu correctly opened right and the probe
stopped before clicking. READY2 restored the exact longer label shape from the
historical failure. These results retain the original installed pointer failure and
the later keyboard-only selection evidence rather than replacing either history.
