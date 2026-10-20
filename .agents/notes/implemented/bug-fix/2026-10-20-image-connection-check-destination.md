# Image checks stay on the typed destination

Status: implemented
Translation: pending

## Abstract

The image connection form was sending a saved key to a different protocol when the address stayed the same, wiping a key typed before the address, and treating a missing model list as “address not found.” A saved key is now used only for its own protocol and address. A typed key is cleared when the protocol changes. A key typed while the address is empty stays until that first valid address is replaced. Optional model-list 404/405/501 responses stay silent.

## Evidence and decision

`checkRequest` reused `expectedRevision` whenever the address matched, so switching DashScope to OpenAI Images kept the saved key. Main now refuses that check with `needs_key` and does not call the network. The form also disables Save until a key is typed for the new protocol or address.

The address field used to clear `apiKey` on every edit, and it sat below the key, so completing an empty address deleted the key just entered. The address is now the field above the key. A key entered while the address is empty follows that address. A key entered for an address already in the field is cleared when that address changes.

`runModelListHttpCheck` reports 404/405/501 as `unsupported` because `GET /models` is optional. Those results no longer use the not-found line. A non-unsupported 404, a rejected key, and an unreachable host still use the plain image-check copy.

## Verification and limits

Component tests cover the empty default, the kept first key, the protocol switch, and a silent missing model list. The Electron image-check test covers a DashScope key that is not sent when the check asks for OpenAI Images. No live provider was called.
