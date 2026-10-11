# Canvas click-to-edit: research and phased proposal

Status: proposed
Translation: current

[中文](2026-10-10-canvas-click-to-edit.zh.md)

## Abstract

Molly's canvas could reference selected elements precisely, but every AI
request was finished in the conversation panel, targeted only whole elements,
handled one target per request, and gave no feedback at the target. Lovart,
Higgsfield and the Codex app all keep the request and its result at the thing
clicked. This note records that research and a five-phase proposal; the owner
approved phase A on 2026-10-10 and it is implemented in
[canvas inline ask](../../implemented/feature/2026-10-10-canvas-inline-ask.md).
Phase B is implemented in
[canvas numbered notes](../../implemented/feature/2026-10-11-canvas-numbered-notes.md);
phases C and E remain proposals, and the research comes from public documentation,
not hands-on use.

## Research (public sources, 2026-10-10)

| Product | Target | Where the prompt goes | What comes back |
| --- | --- | --- | --- |
| Lovart | Mark (M or Cmd/Ctrl-click) recognises an object inside an image without a mask, up to 10 marks per prompt; Edit Elements splits a flat image into movable layers; Edit Text rewrites copy inside an image | The mark appears in the input; Tab opens Quick Edit presets or a custom prompt | Local, in-place edit of the target; undo and edit history |
| Higgsfield | Draw-to-Edit rough brush/sketch on the image; Layers (separation, edit text, regional edit, relight, remove background) | Prompt plus explicit model choice | Only the painted region is regenerated |
| Codex app | Annotation mode: click an element or drag an area | Comment at the target, saved as a numbered marker; Adjust previews font/colour/spacing live | Comments are addressed together from chat, referenced by number |

Sources: Lovart advanced AI editing docs and changelog (Touch Edit, Edit
Element, Edit Text, Chat with Canvas), Lovart blog "iteration loop ai design
touch edit", Higgsfield Layers and Nano Banana Pro Inpaint pages, Codex in-app
browser documentation and release notes. Higgsfield's region workflow and the
payload Codex sends to its agent are not publicly documented.

## Gaps in Molly (2026-10-10)

1. The request is finished away from the click point.
2. Nothing smaller than an element can be targeted.
3. One target per request; no batch of numbered notes.
4. During a run the whole canvas is read-only with no target-scoped progress;
   afterwards nothing shows which elements changed or whether elements outside
   the selection were touched.
5. AI actions are the same for every element kind.

## Phases

- **A. Inline ask** — implemented (see link above).
- **B. Numbered pins, one batched turn.** Implemented, see
  [canvas numbered notes](../../implemented/feature/2026-10-11-canvas-numbered-notes.md).
  Cmd/Ctrl-click drops numbered pins
  with their own instruction; "Send N notes" sends one turn with N references
  and one "Before Molly's edit" restore point. Reuses multi-reference parsing.
  Fits current Spec intent.
- **C. Marks inside an image.** A point, box or scribble on a selected image is
  rendered onto a copy attached as a reference image ("edit only where marked")
  and applied through the existing image edit tool. Avoids the Spec's "no mask
  editor" by adding only an annotated reference. Automatic object recognition
  (Lovart Cmd-click) is out of scope: it needs a segmentation model. Changes
  Spec intent.
- **D. Feedback at the target.** Implemented except hold-to-compare, see
  [canvas target feedback](../../implemented/feature/2026-10-10-canvas-target-feedback.md).
  A working outline on referenced elements during
  a run; afterwards fading "changed" outlines, hold-to-compare against "Before
  Molly's edit", and an advisory element-ID diff that reports changes outside
  the selection without blocking or repairing. Changes Spec intent.
- **E. Kind-aware actions.** Presets per element kind (remove background,
  replace object, relight; "Make wording editable" to add `textCopy`; "Split
  into layers" via the layered workflow), plus Tab presets in the inline ask.
  Offer only what the tools can actually do. Fits current Spec intent.

Deliberately excluded: variant/candidate grids (candidate workflows are
retired), element-only locking during runs (the Spec requires serial editing of
one artwork), and silently rebasing stale references (the Spec requires an
explicit stale-selection message).

Suggested order: A → D → B → C → E. Proposed measures: time from selection to
send, share of AI edits started from the canvas, and how often the out-of-scope
diff fires on the design-quality eval cases.
