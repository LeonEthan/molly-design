# Copied designs bind the published Molly configuration

Status: implemented
Translation: pending

## Abstract

Save as new design created an editable artwork but published its conversation with
an empty Agent identity. The ordinary model selector could not resolve capabilities,
and sending a message failed the durable history schema before execution. New copies
and missing-metadata association recovery now reuse the same-machine published Molly
configuration. Already-saved empty-identity copies also exposed a continuation preview
whose source-provenance schema rejected them; narrowly accepting their historical source
identity repairs that explicit flow. Model choice and the next turn remain explicit,
and existing historical Session bindings are preserved.

## Evidence and responsibility

The renderer's `useDesignCreation` and `usePendingDesignRecovery` wrote
`cliType: builtin` and an empty `agentType`. A synthetic hook regression reproduced
the creation path and the production input schema's `agentType: too_small` failure
without an external model request. The same blank identity prevented the ordinary
capability selector from reading the configuration-keyed model catalog. Native artwork
copying and the history writer were behaving according to their existing contracts.

The original repair covered publication of new copies. A follow-up audit corrected
the assumption that the visible Continue with Molly entry could already recover old
empty-identity copies: UI eligibility accepted them, but daemon preparation returned
`design_continuation_source_unavailable`, and renderer publication rejected the same
source in its receipt. The shared source schema required a nonempty Agent type even
though this field backs up historical provenance rather than execution identity.

## Reuse and trade-offs

- Reuse `getAllAgentConfigAtom`, the published machine catalog already consumed by
  landing and Session composition. Copy publication records the selected row's
  `cliType`, `agentType` and configuration id, just as ordinary Session creation does.
  No provider, model id, private credential, catalog or dispatch protocol is invented.
  `EmbeddedHarnessCatalogPublisher.publish` already rejects multiple same-machine
  builtin Molly rows with `harness_duplicate_agent_identity`; the renderer consumes
  that existing unique identity instead of adding another catalog preference policy.
- Adapt the existing copy/association flow rather than routing through landing's
  first-message acceptance, which would require a prompt and start a turn. An explicit
  legacy-design continuation keeps its distinct purpose: a new conversation edits the
  existing artwork, while Save as new design creates independent artwork files.
  Landing's `selectedConfig` is component-owned. Its reusable
  `resolvePreferredChatLandingAgentSelection` can fall back to a different Agent type
  and requires machine-list selection context; `selectDesignAgentConfigsForMachine`
  only filters the machine. Neither selects the unique published builtin Molly row
  needed by this copy path. The existing catalog lookup is adapted locally instead.
- Require a same-machine builtin Molly row before creating a new copy. A missing
  catalog is a visible preparation error, rather than an editable copy with an invalid
  conversation. Disabling model connections does not remove the Molly configuration;
  copies do not select a model, infer a default or execute without user input.
- Missing-metadata recovery retains the pending association until the proper catalog
  appears. It does not acknowledge an unconfigured Session or rewrite an existing
  binding. Historical acknowledged blank-identity copies use the existing explicit
  Continue with Molly flow, subject to its machine capability and normal confirmation;
  no automatic migration or model call is added.
- Adapt only `DesignContinuationSourceSchema`: empty `agentType` is accepted for a
  builtin independent artwork whose id equals the source Session, with no Agent
  configuration, parent, project, repository or branch. Nonempty identifiers retain
  their existing syntax; custom/registry, alias artwork and inherited topology cannot
  use this exception. The source's empty value is retained verbatim in the immutable
  receipt. All daemon/renderer source rechecks use that same schema, including its
  existing `.strict()` composition. Owner, machine, target catalog, source-change,
  idle-state, tombstone and publication guards remain in place. Actual target and
  Turn identities remain nonempty and require explicit same-machine Molly selection.
- Reuse the v1 receipt, explicit preview/reconfirmation, guarded publication and normal
  composer. Automatically rebinding old metadata would change historical identity;
  inventing an Agent name would hide the actual source. Neither is necessary. The
  existing [embedded-harness Spec](../../../../specs/molly-embedded-pi-harness.zh.md)
  (User Story 20 and migration section) calls for explicit continuation with preserved
  old data and a new engine context, and does not require a historical copy's missing
  Agent identity to be invented. This repair does not change that intent or approval.

## Verification and limits

The creation hook regression first failed all four original cases. The resulting
six-case suite exercises new/copy Session publication, actual durable history input
validation, model selector catalog resolution, missing/wrong-machine catalog rejection,
late-catalog pending recovery and preservation of an existing blank identity. Four
existing native-canvas integration suites retain attachment, receipt, selection and
navigation coverage with the additional catalog dependency mocked explicitly.

Component type checking passed. The focused five-suite run passed 51 tests, and the
creation suite also passed after strengthening its assertions to use the production
history-write parser and capability selector.

The legacy-source regression was red at three production seams before the compatibility
fix: `pnpm --filter molly exec vitest run src/session/design-continuation-service.test.ts`
returned `design_continuation_source_unavailable`; `pnpm --filter @molly/components exec
vitest run tests/design-continuation-publication.test.ts` returned
`invalid_design_continuation_record`; `pnpm --filter @molly/shared exec vitest run
tests/design-continuation.test.ts` rejected the same receipt. Only each newly added case
failed; existing cases remained passing. No captured user data is used in these fixtures.

After the fix, seven focused suites passed 160 tests: CLI preparation/attachment
inspection (57), shared receipt/context/RPC validation (67), and renderer
publication/RPC/dialog (36). These checks include copy provenance preservation,
unchanged source/history, no accepted next turn, wrong owner/machine/catalog rejection,
unsupported empty-source shapes and refusal of empty execution identities. Shared,
component and CLI type checks passed; focused lint reported no errors. Native
real-provider new-copy and old-copy continuation remain separate acceptance steps;
these synthetic tests do not establish those results. No product Spec intent or
approval was changed, and no release was published.
