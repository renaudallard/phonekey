/**
 * Answers the passkey requests of web pages with a passkey kept on a phone.
 *
 * content.js hands the request of the page over and frames prompt.html over
 * the page, where the user picks the phone or Firefox's own handling. For
 * the phone, the hybrid-passkey native helper shows a QR code and talks to the
 * phone over Bluetooth and the FIDO hybrid transport.
 */

"use strict";

const kHelper = "hybrid_passkey";
const kPromptURL = browser.runtime.getURL("/prompt.html");

// The request of each tab, by tab id:
// { page, view, helper, origin, options, qr, status }.
let gRequests = new Map();

function send(aPort, aMessage) {
  try {
    aPort?.postMessage(aMessage);
  } catch (ex) {
    // The other side is gone, its disconnect handler cleans up.
  }
}

function disconnect(aPort) {
  try {
    aPort?.disconnect();
  } catch (ex) {
  }
}

/**
 * Tell the page the outcome and close everything of this tab's request.
 *
 * @param aTabId   {Integer}
 * @param aMessage {Object} { credential }, { error } or { passthrough }
 */
function finish(aTabId, aMessage) {
  let request = gRequests.get(aTabId);
  if (!request) {
    return;
  }
  gRequests.delete(aTabId);
  if (aMessage.error) {
    console.log("[phonekey] " + request.origin + ": " + aMessage.error);
  }
  send(request.page, aMessage);
  for (let port of [request.helper, request.view, request.page]) {
    disconnect(port);
  }
}

/**
 * The phone could not be used. The page keeps waiting, so the user can try
 * again or pick Firefox's own handling.
 */
function helperFailed(aRequest, aError) {
  disconnect(aRequest.helper);
  aRequest.helper = null;
  aRequest.qr = null;
  aRequest.status = null;
  console.log("[phonekey] " + aRequest.origin + ": " + aError);
  send(aRequest.view, { error: aError });
}

function startHelper(aTabId, aRequest) {
  let helper;
  try {
    helper = browser.runtime.connectNative(kHelper);
  } catch (ex) {
    helperFailed(aRequest, ex.message);
    return;
  }
  aRequest.helper = helper;
  helper.onMessage.addListener(message => {
    if (aRequest.helper != helper) {
      return;
    }
    if (message.qr) {
      aRequest.qr = message.qr;
      send(aRequest.view, { qr: message.qr });
    } else if (message.status) {
      aRequest.status = message.status;
      send(aRequest.view, { status: message.status });
    } else if (message.credential) {
      finish(aTabId, { credential: message.credential });
    } else {
      helperFailed(aRequest, String(message.error));
    }
  });
  helper.onDisconnect.addListener(port => {
    if (aRequest.helper == helper) {
      helperFailed(aRequest, port.error ? port.error.message : "The passkey helper exited");
    }
  });
  helper.postMessage({ origin: aRequest.origin, options: aRequest.options });
}

/**
 * A passkey request from content.js. Its first message carries the
 * PublicKeyCredentialRequestOptionsJSON of the page.
 */
function onPageConnect(aPort) {
  let sender = aPort.sender;
  let tabId = sender.tab?.id;
  if (tabId === undefined || sender.frameId !== 0) {
    disconnect(aPort);
    return;
  }
  // The origin comes from the tab, never from the page.
  let origin = new URL(sender.url).origin;
  aPort.onMessage.addListener(message => {
    if (!message.options || gRequests.get(tabId)?.page == aPort) {
      return;
    }
    // A new request replaces the previous one of the same tab.
    finish(tabId, { error: "Replaced by a newer passkey request" });
    gRequests.set(tabId, {
      page: aPort, view: null, helper: null, origin, options: message.options, qr: null, status: null,
    });
    send(aPort, { show: true });
  });
  aPort.onDisconnect.addListener(() => {
    if (gRequests.get(tabId)?.page == aPort) {
      finish(tabId, { error: "The page went away" });
    }
  });
}

/**
 * The prompt framed over the page of the same tab.
 */
function onViewConnect(aPort) {
  let tabId = aPort.sender.tab?.id;
  let request = gRequests.get(tabId);
  if (!request || aPort.sender.url != kPromptURL) {
    disconnect(aPort);
    return;
  }
  disconnect(request.view);
  request.view = aPort;
  send(aPort, { site: new URL(request.origin).host });
  if (request.helper) {
    send(aPort, { phone: true });
  }
  if (request.qr) {
    send(aPort, { qr: request.qr });
  }
  if (request.status) {
    send(aPort, { status: request.status });
  }
  aPort.onMessage.addListener(message => {
    if (gRequests.get(tabId) != request) {
      return;
    }
    if (message.phone && !request.helper) {
      startHelper(tabId, request);
    } else if (message.key) {
      finish(tabId, { passthrough: true });
    } else if (message.cancel) {
      finish(tabId, { error: "Cancelled" });
    }
  });
  aPort.onDisconnect.addListener(() => {
    if (request.view == aPort) {
      request.view = null;
    }
  });
}

browser.runtime.onConnect.addListener(port => {
  if (port.name == "phonekey") {
    onPageConnect(port);
  } else if (port.name == "phonekey-view") {
    onViewConnect(port);
  }
});
