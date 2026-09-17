# YAML artwork snapshot contract

Status: implemented
Translation: current

[中文](2026-09-14-yaml-authoring-snapshot.zh.md)

## Abstract

The `@geon/design-authoring` collect, validate, import and export seam now admits only the YAML artwork projection: `design.yaml`, one `pages/canvas.yaml` page, and local `media/`. Elements use Bento `id` / `kind`. Leftover `.pptd`, PPTD v2 syntax, and `elementId` / `elementType` fail closed. BentoDoc remains the editable canonical; YAML is not a second canonical blob. Omitted `fontFamily` is not written as MiSans; the product default family name is bundled, OFL-licensed Inter. This note covers the snapshot seam ([#37](https://github.com/LeonEthan/Geon/issues/37)) only. Turns are [#38](https://github.com/LeonEthan/Geon/issues/38), preview [#39](https://github.com/LeonEthan/Geon/issues/39), skills [#40](https://github.com/LeonEthan/Geon/issues/40), and live fingerprints the [follow-on note](2026-09-14-drop-live-pptd-kimi-fingerprints.md) ([#41](https://github.com/LeonEthan/Geon/issues/41)).

## Decision

Linked to the approved [graphic design platform](../../../../specs/graphic-design-platform.md) 2026-09-14 revision and the snapshot contract decision recorded by this note.

The public seam is `collectAuthoring` / `intakeAuthoring` / `exportAuthoring` (`exportPptd` is a deprecated alias). Validation uses kernel replay and discards the replay result; it never silently repairs output. Array order is z-order; omitted `zIndex` is filled from the array index, and an explicit `zIndex` is kept. A missing page background still becomes white solid, matching the existing importer exception. Inter is allowed as an unregistered default family name; font bytes are not embedded in every projection.

A long-lived dual admission of PPTD plus YAML was rejected: leftover `.pptd` is not a valid entry. No DSG / `.dsg` format was invented. Vendored Bento was not edited (static-v1 may still derive MiSans at render); the authoring layer does not write that default back into YAML or BentoDoc.

## Verification and limits

`packages/design-authoring` intake, roundtrip, and skill-script tests cover YAML roundtrip, PPTD rejection, and omitted fonts. Turn collection is [#38](https://github.com/LeonEthan/Geon/issues/38), preview [#39](https://github.com/LeonEthan/Geon/issues/39), skills [#40](https://github.com/LeonEthan/Geon/issues/40), and live fingerprints [#41](https://github.com/LeonEthan/Geon/issues/41). Blind eval is [#42](https://github.com/LeonEthan/Geon/issues/42).
