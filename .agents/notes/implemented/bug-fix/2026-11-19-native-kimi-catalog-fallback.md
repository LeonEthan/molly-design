# Build-time fallback for the native Kimi catalog

Status: implemented
Date: 2026-11-19
Translation: pending

## Abstract

Desktop E2E Daily failed during clean builds after Pi's `k3.1-pro` catalog changed its output-token metadata to 1,048,576. Molly now keeps the metadata Pi delivers and uses a verified, checked-in copy of the Pi entry when refresh fails without previous build output. The snapshot lets a clean build restore the same native model offline and requires review when its Pi engine changes.

## Decision

Pi 1.4.0 restores cached models but its remote catalog parser does limited shape checking. Molly keeps the overlay version, engine, identity, protocol and endpoint guards, plus text, image and reasoning requirements. The overlay accepts only declared model fields to preserve the selected connection and model. Pi's own schemas validate pricing, image limits, thinking and compatibility values. Offline verification checks that the target survives intact alongside the original catalog.

The previous-output fallback remains the first choice after a failed refresh. It requires a valid checksum and cannot serve a clean checkout. The checked-in entry comes from the same Pi catalog endpoint and uses the same offline verification and sealed resource manifest. Removing the fixed token limit handles valid catalog changes while the snapshot covers an unavailable or incompatible response. This revises the [Pi 1.4.0 overlay decision](../architecture/2026-10-27-pi-1-4-0-k3-1-pro.md) for [#49](https://github.com/LeonEthan/molly-design/issues/49).

The build coordinator supplies the fallback after refresh fails. A static import from the shared resolver put the checkout snapshot into a chunk loaded by the worker. The coordinator now reads the snapshot from the checkout, and the worker restores only the selected overlay through the sealed resource manifest.

## Evidence

Deterministic tests cover the 1,048,576-token response, metadata changes, rejection of undeclared model fields on refresh and restore, a failed refresh on a clean build, and native offline restoration. The Daily desktop build command completed from clean harness output on macOS arm64 with pi.dev reachable and with pi.dev requests blocked. Both runs verified the sealed CLI and staged Electron overlays. The blocked run matched the checked-in entry.

The bundle regression checks the worker's esbuild inputs for the checkout entry. Clean online and blocked CLI harness builds passed the worker probe and contained only the selected checksum-listed overlay resource.
