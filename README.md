# phonekey

Firefox on Linux cannot use a passkey kept on a phone: it has no FIDO hybrid
transport (the "use a phone" QR code of other browsers, Bugzilla 1543674).
phonekey adds it for signing in to web sites. When a site asks for a passkey,
a prompt over the page offers to use a phone or a security key. For the phone,
a QR code appears; scan it with the phone's camera, the phone checks that it
is near the computer over Bluetooth and signs in through the relay server of
the phone's vendor. A security key goes to Firefox's own handling.

The Bluetooth and FIDO work is done by the
[hybrid-passkey](https://github.com/renaudallard/hybrid-passkey) native
helper, which [Towa](https://github.com/renaudallard/Towa) uses too.

## Requirements

*   Linux with Bluetooth (BlueZ).
*   The public suffix list in `/usr/share/publicsuffix` (the `publicsuffix`
    package on Debian and Ubuntu, `publicsuffix-list-dafsa` on Fedora).
*   A phone with Bluetooth and internet access.
*   Firefox 128 or later (tested with 157).

## Installation

1.  Install the helper in any directory, for example `~/.local/bin`. Its
    [releases](https://github.com/renaudallard/hybrid-passkey/releases/latest)
    have it prebuilt for x86-64 (`hybrid-passkey-amd64`), for distributions
    with glibc 2.34 or later, and its README says how to build it:

        install -m 755 hybrid-passkey-amd64 ~/.local/bin/hybrid-passkey

    phonekey 0.1.0 used the older `towa-passkey` helper, 0.2.0 and later
    need hybrid-passkey.
2.  Register it for the current user:

        hybrid-passkey --install

    This writes `~/.mozilla/native-messaging-hosts/hybrid_passkey.json` and
    removes `towa_passkey.json` left by the older helper.
3.  Install `phonekey.xpi` from the
    [releases](https://github.com/renaudallard/phonekey/releases/latest), it
    is signed by Mozilla. `./build.sh` builds an unsigned `phonekey.xpi` from
    the source, which release builds of Firefox refuse. On ESR, Developer
    Edition and Nightly, setting `xpinstall.signatures.required` to false in
    `about:config` allows it, or load `src/manifest.json` from
    `about:debugging`.

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

## Password managers

Password managers that handle passkeys, such as Bitwarden, take the request
first. Their option to use a device or hardware key hands it to phonekey.
Turning off their passkey handling (in Bitwarden, **Ask to save and use
passkeys**) brings up phonekey's prompt directly.

## Limitations

*   Sign-in only, passkeys cannot be created on the phone through phonekey.
*   Passkey requests from frames, conditional requests (passkey autofill) and
    silent requests keep Firefox's own handling.
*   WebAuthn extensions (prf, largeBlob) are not passed to the phone, and
    related origin requests are not supported.

## License

BSD 2-Clause, see [LICENSE](LICENSE).
