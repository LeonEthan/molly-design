# Designer batch 6: receipts under the reply, shorter replies, and sleep off by default

Status: implemented
Translation: pending

PR: pending

## Abstract

The four audit items left after batch 5 (#15, #16, #17, #29). The owner asked for all four to be finished without further decisions, so each takes the recommended option below.

## Decisions and reuse

- **Receipts (#16).** The save receipt is stored on the user turn but now renders in the assistant footer row, under the reply. `buildChatStreamItems` hands the outcome from a user turn to the assistant entry that follows it, and keeps it on the user turn when no reply will render, so a stopped turn's diagnostics are never lost. The cache check compares the outcome each item is expected to show. The vague "working draft may have changed" line and its Open draft link are removed: the Spec requires the working file to be preserved, not linked, and the Files panel still reaches it. The candidate "This change wasn't applied" link stays because it tells the user something real.
- **Reply length (#15).** The graphic-design skill's reply and completion sections now size the reply to the request (one or two sentences for a bounded edit), forbid narrating render/preview/check steps, and forbid announcing that nothing is wrong. Required limitation disclosures and honest preview and save claims are kept. This is guidance only and enforces nothing. The effect on real replies is not measured: it needs a paid model run.
- **Selection in the composer (#17).** The audit's concern did not hold up. A canvas selection is already mirrored as a removable mention token that is appended after whatever the user typed, retired when the selection clears, and never adopted if the user attached it explicitly. A new test now pins that an existing draft survives both the mirror and its retirement. A separate chip row above the input would be a new element and a new data path, so it is not built; it needs owner confirmation. Not checked in the running app, because the Mac screen was locked and the canvas cannot render then.
- **Keep awake (#29).** The default is now off, in the main process and in the settings switch. A saved explicit choice is honoured, so only people who never touched the switch see a change: Molly no longer blocks sleep just by being open. Holding the block only while a run is active would be better, but needs a run-state signal; not done.

## Not done

- A separate selection chip row (#17); blocking sleep only during runs (#29).

## Verification

- New tests: stream builder handoff (moves to the reply, stays when no reply renders, does not leak to a later turn, refreshes a cached reply), receipt component, composer draft preservation, and the sleep default plus an explicit saved choice.
- In the app on a clone of the owner's data: "Saved to the current artwork." appears under the replies and the working-draft line is gone.
