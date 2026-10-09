# Resolve local Markdown images through session file previews

Status: implemented
Translation: pending

## Abstract

Assistant replies could contain valid local image files while the chat displayed broken images: Markdown passed `sandbox:/` references directly to browser image elements, where Electron's content policy rejected them. Local Markdown images now resolve through the existing Session file preview and opaque Electron resource URLs. The renderer keeps reads bound to their Session and discards stale image results. Missing files remain visible errors; a separate observed screenshot reference named a file that the Agent had never saved.

## Evidence and decision

The reported reply referenced four images. Three were existing PNG files; the
fourth path did not exist, and the corresponding browser tool had returned an
inline JPEG rather than a saved file. Native renderer diagnostics identified
`sandbox:` image sources rejected by the unchanged `img-src` policy.

A synthetic test through the real Markdown renderer reproduced the faulty
`img.src`: it remained `sandbox:/workspace/artwork/media/draft.png` instead of
the supplied file resource. Changing the content policy would not resolve that
path and would unnecessarily widen image loading. Reusing the existing preview
route also preserves local-machine capability checks and file identity checks.

`parseMarkdownAgentImageHref` recognizes local paths and strips the absolute
`sandbox:/` presentation prefix. It does not turn web URLs or arbitrary schemes
into file reads. `useSessionMarkdownImageResolver` applies the existing Markdown
path normalization exactly once and delegates to `requestFilePreview` with the
Session, machine, and parent owner identity. Only a binary file resource yields
an image URL; no file index, cloud fallback, attachment copy, or new protocol is
introduced.

The renderer receives the resolver through React context because Streamdown's
memoized blocks do not refresh solely when component props change. Image state
belongs to the exact path/resolver pair; late results cannot cross a changed
source or Session. Markdown images retain their existing inline presentation.

## Verification and limits

The initial reproduction failed against the old renderer. The focused Markdown
image, path parsing, and idle rendering suites now pass all 40 tests, including
late reads, resolver changes, missing files, and absence of a Session resolver.
Eight additional integration tests pass with the real renderer and resolver,
covering root/child owner routing, single path decoding, rejected reads, missing
Session metadata/runtime, and nonbinary results.

The rebuilt Electron renderer was loaded into the existing idle conversation.
Visual inspection confirmed both draft images and the final preview rendered
from the unchanged reply, while the missing screenshot path showed the file
preview's explicit not-found error. This acceptance reused existing local files
and did not dispatch a new Agent turn.

No model or image service is called by these regressions. The fix does not save
inline browser screenshots retroactively, rewrite Agent replies, or infer a
replacement file when the named path is absent. Captured conversations and image
bytes are not committed.

## Screenshot reporting follow-up

The browser tool description and its screenshot response now explicitly identify
the returned image as an inline observation without a saved workspace file. The
browser research reference tells the Agent to cite the inspected page, or use
`save_image` and its returned path when a local reference is needed. Local image
links require a successful save or read of that exact path. This clarifies the
existing tool boundary; it adds no persistence, adapter customization, runtime
creative gate, or automatic reconstruction of missing files.

These instructions reduce the observed mistaken claim; they do not guarantee
that a model will always follow them. The historical missing reference remains
an explicit missing-file result. No paid Agent rerun is used to validate this
wording change.

## Draft images in chat follow-up (#104)

Agent replies that announced "Draft A/B" usually named the drafts in prose without
Markdown image syntax, so the chat bubble had nothing to render. The design skills
now tell the Agent to embed each draft it presents with the `absolutePath` returned
by `molly_image` (`graphic-design` layered-workflow reference and `imagegen`).
This recommends a presentation step; it adds no enforcement, persistence, or
automatic attachment of tool results to the chat history.

The renderer also had two silent-blank paths. Markdown's URL sanitizer emptied
`file://` sources before they reached the resolver, so those images never loaded.
Non-resolvable sources such as remote URLs fell through to a bare `<img>` that the
renderer CSP could block without any placeholder. `file://` absolute paths now
resolve through the same owning-session file preview as `sandbox:/` references,
and a failed bare image shows the existing "Unable to load image" placeholder and
logs a warning with its source. Unit tests cover the path mapping, the resolver
route for `file://`, and the placeholder after an image error event.

Limits: no paid Agent turn was run to confirm the Agent now embeds drafts, and the
packaged Electron build was not inspected here. Earlier replies remain as they
were; the chat does not retroactively attach their tool results.
