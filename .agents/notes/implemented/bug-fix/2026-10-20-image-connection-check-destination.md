# Image checks stay on the typed destination

Status: implemented
Translation: pending

## Abstract

The image connection form was sending a saved key to a different protocol when the address stayed the same, wiping a key typed before the address, and treating a missing model list as “address not found.” A saved key is now used only for its own protocol and address. A typed key is cleared when the protocol changes. A key typed while the address is empty stays through every character of that first address, including a prefix that already parses, and is committed when the field blurs. The check waits for that commit. Save stays disabled unless the draft has a typed key, a stored key for the same protocol and address, or an explicit removal. Optional model-list 404/405/501 responses stay silent. Field order is unchanged: the base URL stays under More options, collapsed when a saved address is that protocol's provider root and open for an empty or custom address.

## Evidence and decision

`checkRequest` reused `expectedRevision` whenever the address matched, so switching DashScope to OpenAI Images kept the saved key. Main now refuses that check with `needs_key` and does not call the network. The form also disables Save until a key is typed for the new protocol or address.

The address field used to clear `apiKey` on every edit. It stays under More options, after the key. A key entered while the address is empty follows the characters of that first address and is committed on blur, so `https://i` is not a destination. A key entered for an address already in the field is cleared when that address changes. Connect does not persist a new row with no key.

`runModelListHttpCheck` reports 404/405/501 as `unsupported` because `GET /models` is optional. The shared check line stays silent for that reason. The form does not add a separate image failure line.

## Verification and limits

Component tests cover the empty default, the kept first key, the protocol switch, and a silent missing model list. The Electron image-check test covers a DashScope key that is not sent when the check asks for OpenAI Images. No live provider was called.
