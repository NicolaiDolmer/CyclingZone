import test from "node:test";
import assert from "node:assert/strict";
import { renderTypeLabel, renderDmText, renderDmFields, DM_TYPE_EMOJI } from "./discordDmCopy.js";
import { bundledLanguages } from "./i18nServer.js";

// #4734 · En Discord-DM forlader appen som faerdig tekst. Foer denne aendring
// var teksten hardcodet EN for alle; testene her holder fast i at BEGGE sprog
// faktisk kan rendres, og at en manglende noegle aldrig giver en tom besked.

test("renderTypeLabel oversaetter type-praefikset og beholder emojiet", () => {
  assert.equal(renderTypeLabel("auction_won", "en"), "🏆 Auction won");
  assert.equal(renderTypeLabel("auction_won", "da"), "🏆 Auktion vundet");
});

test("renderTypeLabel falder tilbage til selve typen for en ukendt type", () => {
  assert.equal(renderTypeLabel("not_a_real_type", "en"), "not_a_real_type");
});

test("renderDmText rendrer beskeden i modtagerens sprog", () => {
  const spec = { code: "discord.dm.auctionWon", params: { rider: "**Tadej P**" } };
  assert.equal(renderDmText(spec, "en"), "You won the auction for **Tadej P**.");
  assert.equal(renderDmText(spec, "da"), "Du vandt auktionen på **Tadej P**.");
});

test("renderDmText: ukendt sprog falder tilbage til EN, ikke til en tom streng", () => {
  const spec = { code: "discord.dm.auctionWon", params: { rider: "R" } };
  assert.equal(renderDmText(spec, "de"), "You won the auction for R.");
});

test("renderDmText: en literal streng (kanal-broadcast) sendes uaendret igennem", () => {
  assert.equal(renderDmText("**Seller** put **Rider** up for auction!", "da"), "**Seller** put **Rider** up for auction!");
});

test("renderDmText: manglende noegle bruger literalen, ellers noeglen — aldrig tom", () => {
  assert.equal(renderDmText({ code: "discord.dm.doesNotExist", text: "Fallback" }, "da"), "Fallback");
  assert.equal(renderDmText({ code: "discord.dm.doesNotExist" }, "da"), "discord.dm.doesNotExist");
});

test("renderDmFields oversaetter feltnavne men lader vaerdien vaere data", () => {
  const fields = [{ nameCode: "discord.field.finalPrice", value: "12,000 CZ$" }];
  assert.deepEqual(renderDmFields(fields, "en"), [{ name: "Final price", value: "12,000 CZ$", inline: undefined }]);
  assert.deepEqual(renderDmFields(fields, "da"), [{ name: "Slutpris", value: "12,000 CZ$", inline: undefined }]);
});

test("renderDmFields beholder et literalt feltnavn uden kode", () => {
  assert.deepEqual(renderDmFields([{ name: "Value", value: "1" }], "da"), [{ name: "Value", value: "1", inline: undefined }]);
});

// Forward-guard: hvert DM/embed-emoji skal have en type-label i ALLE bundlede
// sprog. Uden den ville en ny type tavst vise sin raa slug ("board_update") i
// spillerens Discord-inbox paa det sprog hvor noeglen mangler.
test("hver DM-type har en oversat label i alle bundlede sprog", () => {
  for (const type of Object.keys(DM_TYPE_EMOJI)) {
    for (const lng of bundledLanguages()) {
      const label = renderTypeLabel(type, lng);
      assert.notEqual(label, type, `discord.typeLabel.${type} mangler i ${lng}`);
      assert.ok(label.includes(DM_TYPE_EMOJI[type]), `emoji mangler for ${type} (${lng})`);
    }
  }
});
