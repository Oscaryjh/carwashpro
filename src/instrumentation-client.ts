const browserInjectedAttributes = [
  "__gcrremoteframetoken",
  "__gcruniqueid",
] as const;

for (const attribute of browserInjectedAttributes) {
  document.querySelectorAll(`[${attribute}]`).forEach((element) => {
    element.removeAttribute(attribute);
  });
}
