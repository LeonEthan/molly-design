# Model picker keeps three levels

Status: implemented
Translation: pending
PR: [#176](https://github.com/LeonEthan/molly-design/pull/176)

## Abstract

After a fresh model connection, or when a model supports only one reasoning
effort, the composer menu dropped Agent and Reasoning and opened as a Model
list. The control now always shows Agent, Reasoning, and Model on the first
click, including when each level has a single option. Provider remains a
scope of Model and still appears only when more than one connection exists.
An in-canvas composer shows the session agent and does not switch it.

## Decision

The home and canvas composers share `DesktopRunConfigMenu`. Hiding Reasoning
when `options.length` was 1, and never rendering Agent, left only Model once
a single connection was configured. The unselected Molly catalog publishes
`off` as that model's only effort, which is the fresh-connect case.

Showing the row is separate from inventing efforts. Reasoning options stay
limited to the selected model's supported levels. A level with one option
still has a row and a submenu. When the model publishes no effort, that
submenu is one disabled "Not available" row. The home composer can change
Agent; a canvas session lists only its current agent and does not switch it.

## Verification

A component test opens the menu with one agent, one reasoning effort, and one
model, and again with the unselected sentinel plus two models from one
connection. Both must show Agent, Reasoning, and Model, and neither shows
Provider. The in-canvas path (no agent-change callback) lists only the
session agent. An empty thought-level selector shows the disabled
"Not available" row. Manual checks on the Mac home and canvas composers
were not run here.
