// Lets the user pick the phone or Firefox's own handling for a passkey
// request, then shows the QR code and progress. Framed over the page by
// content.js, see background.js.

"use strict";

const kStatusStrings = {
  proximity: "connecting",
  connecting: "connecting",
  authenticating: "connecting",
  connected: "connected",
  confirm: "confirm",
};

let $ = id => document.getElementById(id);
let message = (name, substitution) => browser.i18n.getMessage(name, substitution);

for (let element of document.querySelectorAll("[data-i18n]")) {
  element.textContent = message(element.dataset.i18n);
}

function showScan() {
  $("error").hidden = true;
  $("choose").hidden = true;
  $("scan").hidden = false;
  $("qr").removeAttribute("src");
  $("progress").textContent = message("waiting");
}

let port = browser.runtime.connect({ name: "phonekey-view" });
port.onMessage.addListener(aMessage => {
  if (aMessage.site) {
    $("site").textContent = message("site", aMessage.site);
  } else if (aMessage.phone) {
    showScan();
  } else if (aMessage.qr) {
    // The helper sends SVG text, shown as an image so nothing in it runs.
    $("qr").src = "data:image/svg+xml," + encodeURIComponent(aMessage.qr);
  } else if (kStatusStrings[aMessage.status]) {
    $("progress").textContent = message(kStatusStrings[aMessage.status]);
  } else if (aMessage.error) {
    $("error").textContent = message("phoneError", aMessage.error);
    $("error").hidden = false;
    $("scan").hidden = true;
    $("choose").hidden = false;
  }
});

$("phone").onclick = () => {
  showScan();
  port.postMessage({ phone: true });
};
$("key").onclick = () => port.postMessage({ key: true });
$("cancel").onclick = () => port.postMessage({ cancel: true });
document.addEventListener("keydown", event => {
  if (event.key == "Escape") {
    port.postMessage({ cancel: true });
  }
});
