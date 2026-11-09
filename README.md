# phonekey

Firefox on Linux cannot use a passkey kept on a phone: it has no FIDO hybrid
transport (the "use a phone" QR code of other browsers, Bugzilla 1543674).
phonekey adds it for signing in to web sites. When a site asks for a passkey,
a prompt over the page offers to use a phone or a security key. For the phone,
a QR code appears; scan it with the phone's camera, the phone checks that it
is near the computer over Bluetooth and signs in through the relay server of
the phone's vendor. A security key goes to Firefox's own handling.

The Bluetooth and FIDO work is done by `towa-passkey`, the native helper of
[Towa](https://github.com/renaudallard/Towa), shared by both add-ons. It
uses [libwebauthn](https://github.com/linux-credentials/libwebauthn)
(LGPL-2.1-or-later).

## Requirements

*   Linux with Bluetooth (BlueZ).
*   The public suffix list in `/usr/share/publicsuffix` (the `publicsuffix`
    package on Debian and Ubuntu, `publicsuffix-list-dafsa` on Fedora).
*   A phone with Bluetooth and internet access.
*   Firefox 128 or later (tested with 157).

## Installation

1.  Install the helper in any directory, for example `~/.local/bin`. `bin/`
    has it prebuilt for x86-64 (`towa-passkey-amd64`), for distributions
    with glibc 2.34 or later:

        install -m 755 bin/towa-passkey-amd64 ~/.local/bin/towa-passkey

    Or build it from `helper/towa-passkey` in the Towa repository with
    `cargo build --release`. Helpers from Towa releases up to v1.2.28 only
    accept Microsoft's sign-in page and do not work with phonekey.
2.  Register it for the current user:

        towa-passkey --install

    This writes `~/.mozilla/native-messaging-hosts/towa_passkey.json`. If the
    helper was already registered for Towa, run it again so the manifest also
    allows phonekey.
3.  Build the add-on with `./build.sh`, which writes `phonekey.xpi`. Release
    builds of Firefox only install add-ons signed by Mozilla; on ESR,
    Developer Edition and Nightly, setting `xpinstall.signatures.required` to
    false in `about:config` allows the unsigned file. To try it, load
    `src/manifest.json` from `about:debugging`.

## How it works

*   `src/content.js` replaces `navigator.credentials.get` in the top frame of
    https pages (and http://localhost) and frames `src/prompt.html` over the
    page.
*   `src/background.js` takes the origin from the tab, never from the page,
    and passes it with the request to the helper, which checks the relying
    party id against it as a browser does.
*   `src/prompt.html` lets the user pick the phone or a security key, then
    shows the QR code and progress. If the phone cannot be used, the reason
    is shown and the user can try again or pick something else.

## Limitations

*   Sign-in only, passkeys cannot be created on the phone through phonekey.
*   Passkey requests from frames, conditional requests (passkey autofill) and
    silent requests keep Firefox's own handling.
*   WebAuthn extensions (prf, largeBlob) are not passed to the phone, and
    related origin requests are not supported.
