import test from "node:test";
import assert from "node:assert/strict";

import { clampText, clampEmbed, clampEmbedPayload, DISCORD_EMBED_LIMITS } from "./discordEmbedLimits.js";

test("clampText — under grænsen er uændret, over grænsen ender på ellipsis", () => {
  assert.equal(clampText("kort", 10), "kort");
  assert.equal(clampText("x".repeat(10), 10), "x".repeat(10)); // præcis grænsen klippes ikke
  const clipped = clampText("x".repeat(11), 10);
  assert.equal(clipped.length, 10); // ALDRIG over grænsen, ellipsis medregnet
  assert.ok(clipped.endsWith("…"));
});

test("clampText — null/undefined/tal bliver til strenge uden at kaste", () => {
  assert.equal(clampText(null, 5), "");
  assert.equal(clampText(undefined, 5), "");
  assert.equal(clampText(1234, 5), "1234");
});

test("clampEmbed — holder title, description, felter og footer inden for Discords grænser", () => {
  const embed = clampEmbed({
    title: "T".repeat(1000),
    description: "D".repeat(9000),
    footer: { text: "F".repeat(5000) },
    author: { name: "A".repeat(1000) },
    fields: Array.from({ length: 40 }, (_, i) => ({
      name: `N${i}`.repeat(400),
      value: "V".repeat(5000),
      inline: true,
    })),
  });

  assert.equal(embed.title.length, DISCORD_EMBED_LIMITS.title);
  assert.equal(embed.description.length, DISCORD_EMBED_LIMITS.description);
  assert.equal(embed.footer.text.length, DISCORD_EMBED_LIMITS.footerText);
  assert.equal(embed.author.name.length, DISCORD_EMBED_LIMITS.authorName);
  assert.equal(embed.fields.length, DISCORD_EMBED_LIMITS.fields);
  for (const field of embed.fields) {
    assert.ok(field.name.length <= DISCORD_EMBED_LIMITS.fieldName);
    assert.ok(field.value.length <= DISCORD_EMBED_LIMITS.fieldValue);
    assert.equal(field.inline, true); // øvrige felt-egenskaber bevares
  }
});

test("clampEmbed — usatte felter forbliver usatte (Discord afviser tom title)", () => {
  const embed = clampEmbed({ description: "kun beskrivelse", color: 0x123456 });
  assert.equal("title" in embed, false);
  assert.equal("fields" in embed, false);
  assert.equal("footer" in embed, false);
  assert.equal(embed.color, 0x123456);
});

test("clampEmbed — muterer ikke input", () => {
  const original = { title: "T".repeat(500), fields: [{ name: "n", value: "v" }] };
  const copy = JSON.parse(JSON.stringify(original));
  clampEmbed(original);
  assert.deepEqual(original, copy);
});

test("clampEmbedPayload — klipper alle embeds og lader payloads uden embeds passere", () => {
  const payload = clampEmbedPayload({
    content: "hej",
    embeds: [{ title: "A".repeat(500) }, { title: "B" }],
  });
  assert.equal(payload.content, "hej");
  assert.equal(payload.embeds[0].title.length, DISCORD_EMBED_LIMITS.title);
  assert.equal(payload.embeds[1].title, "B");

  assert.deepEqual(clampEmbedPayload({ content: "kun tekst" }), { content: "kun tekst" });
  assert.equal(clampEmbedPayload(null), null);
});
