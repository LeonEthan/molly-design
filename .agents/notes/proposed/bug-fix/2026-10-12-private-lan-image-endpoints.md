# Private LAN image-service endpoints

Status: proposed
Translation: pending

## Abstract

Real image-service testing exposed a contract mismatch: image settings accepted
an HTTP LAN address and enabled Save, while the protected connection schema
rejected it before IPC. The form then reported a credential-storage error even
though the encrypted store remained readable and unchanged.

On 2026-10-13 the user approved the concrete image-only RFC1918 IPv4 HTTP patch
for the isolated runtime test profile, including rebuilding and real-service
regression. This approval does not approve the full platform Spec or a public
release; the Spec remains draft. No credentials, actual service addresses or
captured conversations belong in this record.

## Proposed change and reuse

Reuse the existing image URL normalizer and browser hostname classifier rather
than adding a network service, DNS resolver or proxy. Add an image endpoint
schema that applies the normalizer's rules to settings, protected metadata,
checks and frozen run/host contracts. HTTPS and existing loopback HTTP remain
accepted. The image-only addition is HTTP at standard dotted-decimal RFC1918
IPv4 literals; IPv6 LAN HTTP is deferred until needed. Named LAN hosts, public HTTP,
link-local/CGNAT addresses and ambiguous IPv4 spellings remain rejected.

The generic model endpoint schema cannot be reused unchanged because it rejects
the requested LAN service, and widening it would also change model, OAuth and
external MCP credential transport. Those contracts stay unchanged. Image forms
reuse the image schema for validation and free discovery, show address errors
before submission and explain that HTTP does not encrypt keys or image traffic.
Changing an endpoint still requires explicit replacement credentials. There is
no TLS bypass, transport redirection, automatic paid retry or new storage.

The hostname helper uses the existing package-import-map pattern through
`#browser-url`. An extensionless relative import passed the bundler-based tests
but broke Node's native TypeScript test execution; a package mapping resolves the
same source without a new dependency or loader. The reused browser error class
keeps its public readonly field through an explicit constructor assignment,
which also runs under Node's existing type-stripping test mode.

The legacy URL/settings normalizers and public metadata decoder stay permissive
to preserve historical readability and encrypted migration backups. They confer
no endpoint authority: readiness and protected connection/check/run contracts
apply the strict image schema. Historical public or named LAN HTTP values cannot
authorize credential use; stored values are never guessed or silently repaired.

## Validation and limits

All 144 targeted shared/settings tests passed after the native import repair:
99 shared contract/browser URL tests and 45 settings tests. They cover image endpoint boundaries,
historical decoding without readiness/authority, protected save/check and run/host
consistency, unchanged model/OAuth/MCP restrictions, form validation,
disabled invalid Save and explicit credential replacement for a valid LAN image
service. Shared/component type checks, scoped type-aware lint, i18n, public
boundary, formatting, diff and documentation checks passed. Lint retained nine
existing warnings and documentation retained fourteen size warnings; neither
reported errors. A subsequent full check exposed the native Node import issue
described above. Its three affected Electron suites passed all 93 tests after the
mapping/field repair; the complete Electron package suite passed all 380 tests
(361 type-stripping and 19 existing type-transforming tests). The imports-only
manifest change passed offline lockfile validation without a lockfile diff.
The final full repository check, packaging and installed-build validation remain
with the owning task.

Synthetic test keys and example addresses prove validation behavior; they do not
prove a real provider, TLS trust, image quality or installed-build operation.
No real generation/edit request was sent by this patch task. The user approved
isolated runtime testing after rebuilding. An independent read-only security review recommended the IPv4-only scope and
keeping historical decoding separate from credential authority. Final review and
validation remain with the owning task.

The intended behavior is recorded in the draft
[graphic-design platform Spec](../../../../specs/graphic-design-platform.md#built-in-image-tools).
