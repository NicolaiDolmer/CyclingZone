// #2039: Browser-oversættelse (Chrome/Google Translate) muterer DOM'en under
// React ved at wrappe tekst-noder i <font>-elementer. React's næste commit kalder
// så removeChild/insertBefore på noder oversætteren allerede har flyttet → throw
// "NotFoundError: ... not a child of this node" → fuldskærms-crash (CYCLINGZONE-1P).
//
// Den PRIMÆRE fix er at <html lang> matcher indholdet (LanguageProvider, #2039) så
// auto-translate ikke trigges. Dette er belt-and-suspenders for MANUEL oversættelse
// + extensions: gør removeChild/insertBefore graceful når noden ikke (længere) er et
// barn, i stedet for at vælte appen. Ændrer KUN adfærd i den ellers-kastende sti —
// i alle korrekte tilfælde delegeres uændret til originalen.
//
// `proto` injiceres i tests; defaulter til Node.prototype. Returnerer true hvis
// patchen blev installeret, false hvis allerede installeret / intet proto.
export function installTranslationResilience(
  proto = (typeof Node !== "undefined" ? Node.prototype : null),
) {
  if (!proto || proto.__czTranslationResilience) return false;

  const originalRemoveChild = proto.removeChild;
  proto.removeChild = function removeChild(child) {
    if (child && child.parentNode !== this) {
      // Allerede flyttet/fjernet af oversætteren — no-op i stedet for throw.
      return child;
    }
    return originalRemoveChild.apply(this, arguments);
  };

  const originalInsertBefore = proto.insertBefore;
  proto.insertBefore = function insertBefore(newNode, referenceNode) {
    if (referenceNode && referenceNode.parentNode !== this) {
      // Reference-noden er flyttet af oversætteren — append i stedet for throw.
      // Append (ref=null) holder noden i træet; rækkefølgen selv-retter ved næste render.
      return originalInsertBefore.call(this, newNode, null);
    }
    return originalInsertBefore.apply(this, arguments);
  };

  proto.__czTranslationResilience = true;
  return true;
}
