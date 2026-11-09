/**
 * Replaces navigator.credentials.get of the page, so a passkey request can
 * be answered with a passkey on a phone, see background.js. Runs at
 * document_start in the top frame, so the page sees the replaced function
 * from its first script on.
 */

"use strict";

(function() {
  let page = window.wrappedJSObject;
  // Missing outside secure contexts.
  let container = page.navigator.credentials;
  if (!container) {
    return;
  }
  let pageGet = container.get;

  function toBase64Url(aBytes) {
    let text = "";
    for (let byte of aBytes) {
      text += String.fromCharCode(byte);
    }
    return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromBase64Url(aText) {
    let text = atob(aText.replace(/-/g, "+").replace(/_/g, "/"));
    let bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      bytes[i] = text.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // A BufferSource of the page, copied into this script's own memory. The
  // copy iterates, slice() would look up the page's constructor, which the
  // Xray wrapper refuses.
  function bytesOf(aSource) {
    if (ArrayBuffer.isView(aSource)) {
      return Uint8Array.from(new Uint8Array(aSource.buffer, aSource.byteOffset, aSource.byteLength));
    }
    return Uint8Array.from(new Uint8Array(aSource));
  }

  // PublicKeyCredentialRequestOptionsJSON for the helper. Extensions are
  // not passed on.
  function optionsToJSON(aPublicKey) {
    let options = { challenge: toBase64Url(bytesOf(aPublicKey.challenge)) };
    for (let name of ["rpId", "timeout", "userVerification"]) {
      if (aPublicKey[name] !== undefined) {
        options[name] = aPublicKey[name];
      }
    }
    if (aPublicKey.allowCredentials) {
      options.allowCredentials = [...aPublicKey.allowCredentials].map(credential => {
        let descriptor = { type: String(credential.type), id: toBase64Url(bytesOf(credential.id)) };
        if (credential.transports) {
          descriptor.transports = [...credential.transports].map(String);
        }
        return descriptor;
      });
    }
    if (aPublicKey.hints) {
      options.hints = [...aPublicKey.hints].map(String);
    }
    return options;
  }

  // A PublicKeyCredential for the page, from the helper's
  // AuthenticationResponseJSON. The prototypes are the page's own, so
  // instanceof checks of the page pass, the own properties shadow their
  // getters.
  function credentialFromJSON(aJSON) {
    let json = {
      id: aJSON.id,
      rawId: aJSON.rawId,
      type: "public-key",
      authenticatorAttachment: "cross-platform",
      response: {
        clientDataJSON: aJSON.response.clientDataJSON,
        authenticatorData: aJSON.response.authenticatorData,
        signature: aJSON.response.signature,
      },
      clientExtensionResults: {},
    };
    let response = {
      clientDataJSON: fromBase64Url(aJSON.response.clientDataJSON),
      authenticatorData: fromBase64Url(aJSON.response.authenticatorData),
      signature: fromBase64Url(aJSON.response.signature),
      userHandle: null,
    };
    if (aJSON.response.userHandle) {
      json.response.userHandle = aJSON.response.userHandle;
      response.userHandle = fromBase64Url(aJSON.response.userHandle);
    }
    let credential = cloneInto({
      id: json.id,
      rawId: fromBase64Url(json.rawId),
      type: json.type,
      authenticatorAttachment: json.authenticatorAttachment,
      response,
      getClientExtensionResults: () => cloneInto({}, window),
      toJSON: () => cloneInto(json, window),
    }, window, { cloneFunctions: true });
    page.Object.setPrototypeOf(credential.response, page.AuthenticatorAssertionResponse.prototype);
    page.Object.setPrototypeOf(credential, page.PublicKeyCredential.prototype);
    return credential;
  }

  let frame = null;
  // The port of the request the frame belongs to, a newer request of the
  // page replaces an older one.
  let current = null;

  function showFrame() {
    if (frame) {
      return;
    }
    frame = document.createElement("iframe");
    frame.src = browser.runtime.getURL("/prompt.html");
    // Important, so the page's own styles for frames cannot hide it.
    let style = {
      position: "fixed", inset: "0", width: "100%", height: "100%", border: "none",
      margin: "0", padding: "0", "z-index": "2147483647",
    };
    for (let [name, value] of Object.entries(style)) {
      frame.style.setProperty(name, value, "important");
    }
    document.documentElement.append(frame);
  }

  function hideFrame() {
    frame?.remove();
    frame = null;
  }

  function askPhone(aOptions, aResolve, aReject) {
    let options;
    try {
      options = optionsToJSON(aOptions.publicKey);
    } catch (ex) {
      aReject(new window.DOMException("Invalid passkey request", "NotAllowedError"));
      return;
    }
    let done = false;
    let port = browser.runtime.connect({ name: "phonekey" });
    current = port;
    function end() {
      done = true;
      if (current == port) {
        hideFrame();
        current = null;
      }
      port.disconnect();
    }
    function fail(aError, aReason) {
      if (done) {
        return;
      }
      end();
      aReject(aReason ?? new window.DOMException(aError, "NotAllowedError"));
    }
    port.onMessage.addListener(message => {
      if (done) {
        return;
      }
      if (message.show) {
        if (current == port) {
          showFrame();
        }
      } else if (message.passthrough) {
        // Firefox's own handling, for a security key.
        end();
        aResolve(pageGet.call(container, aOptions));
      } else if (message.credential) {
        let credential;
        try {
          credential = credentialFromJSON(message.credential);
        } catch (ex) {
          fail("Invalid answer from the passkey helper");
          return;
        }
        end();
        aResolve(credential);
      } else {
        fail(String(message.error));
      }
    });
    port.onDisconnect.addListener(() => fail("Passkey request ended"));
    let signal = aOptions.signal;
    if (signal) {
      if (signal.aborted) {
        fail("Aborted", signal.reason);
        return;
      }
      signal.addEventListener("abort", () => fail("Aborted", signal.reason));
    }
    port.postMessage({ options });
  }

  function get(aOptions) {
    // Conditional requests feed passkey autofill and silent ones must not
    // show anything, leave them and other credential types to Firefox.
    let mediation = aOptions?.mediation;
    if (!aOptions?.publicKey || (mediation !== undefined && mediation != "optional" && mediation != "required")) {
      return pageGet.call(container, aOptions);
    }
    return new page.Promise(exportFunction((resolve, reject) => {
      askPhone(aOptions, resolve, reject);
    }, window));
  }

  exportFunction(get, container, { defineAs: "get" });
})();
