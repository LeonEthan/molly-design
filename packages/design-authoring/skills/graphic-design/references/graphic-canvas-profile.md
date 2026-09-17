# Graphic canvas profile

This document defines the product boundary and the discipline for claiming
support. It does not duplicate the field whitelist. Exact syntax and capability
records belong to the platform's machine-readable Active Profile and its
conformance tests.

## Product boundary

Molly creates and edits one **static visual canvas** through a Bento-derived
editor and renderer. The Agent-facing files are a YAML artwork projection
(`design.yaml` with `format: molly-canvas/1`, `media/`). After a successful import, the
platform visual document (BentoDoc) remains the single editable truth. The YAML
projection and Agent drafts are not a second editable truth.

The target vocabulary is high-coverage static graphic semantics, including where
useful:

- plain and structured text, typography, and text layout;
- geometric and freeform shapes, paths, lines, arrows, and connectors;
- images, fit, crop, masks, opacity, and visual effects;
- icons and vector artwork;
- tables, charts, and data graphics;
- groups, transforms, fills, borders, shadows, layering, and clipping.

This is a **target vocabulary**, not an assertion that every item is currently
Active. Presentation-only semantics are outside the profile: multiple slides,
masters, layouts, speaker notes, transitions, animation timelines, presenter
state, and PPT/PPTX round-trip. Audio, video, scripts, embedded web content,
remote assets, and remote fonts are also out of scope for the static canvas.

## Three distinct states

Use these terms consistently:

- **Target**: desirable static semantics that fit the product boundary.
- **Candidate**: syntax or an implementation exists, but the full lifecycle has
  not been proven.
- **Active**: the exact element/property combination has a declared render
  result, declared edit operations, and passing end-to-end conformance.

Never turn Target or Candidate into a support claim. Validator acceptance
establishes only syntax admission; it does not establish import preservation,
rendering, persistence, or editability.

## Active Profile record

The platform's machine-readable capability record is the sole authority for
production authoring. Each Active combination must identify at least:

- element kind and admitted properties or property combinations;
- import mapping and canonical representation;
- render fidelity: exact or a specifically defined approximation;
- supported edit operations, such as move, resize, rotate, content, style, data,
  or structure edits;
- save/reopen and export behavior;
- conformance fixture or test evidence;
- unsupported combinations and failure behavior.

Editability is a set of operations, not one boolean. A table whose bounds can
move but whose cells cannot be edited must not be described simply as
“editable.” A chart decomposed into stable text and shape primitives may be
described as an editable decomposition, but not as a native data-editable chart.

If the platform does not expose an Active record for a requested combination,
treat it as unsupported. Do not infer support from Bento UI controls, TypeScript
types, a successful validator parse, an external example, or a visually
plausible preview.

## End-to-end activation rule

A capability becomes Active only when the same fixture completes this lifecycle
without unreported loss:

```text
validate → import → canonical document → Bento projection/render
         → declared editor operations → save/reopen → export
```

The preview and final export must use equivalent rendering semantics. Stable IDs
and source mappings must survive import and persistence wherever an editable
decomposition creates multiple primitives.

Silent drops, placeholders, property resets, ephemeral editor-only mutations,
and flattening that is not declared in the capability record fail activation.
Unknown or unverified input fails closed rather than degrading to something that
merely renders.

## Write from the admitted projection

The bundled format guidance in
[artwork-format.md](artwork-format.md) describes the YAML artwork files Molly
admits. Existing projected documents may carry editable Bento fields that the
compact guide does not enumerate. Preserve those fields rather than assuming
their omission means unsupported. Do not treat an external presentation
catalogue as authoring permission.
