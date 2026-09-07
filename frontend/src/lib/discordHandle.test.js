import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiscordHandle, isValidDiscordHandle, isValidDiscordSnowflake } from "./discordHandle.js";

test("parseDiscordHandle: tom/whitespace-only input rydder feltet", () => {
  assert.deepEqual(parseDiscordHandle(""), { valid: true, value: null });
  assert.deepEqual(parseDiscordHandle("   "), { valid: true, value: null });
  assert.deepEqual(parseDiscordHandle(null), { valid: true, value: null });
  assert.deepEqual(parseDiscordHandle(undefined), { valid: true, value: null });
});

test("parseDiscordHandle: trimmer whitespace fra et ellers gyldigt handle", () => {
  assert.deepEqual(parseDiscordHandle("  nicolai.dolmer  "), { valid: true, value: "nicolai.dolmer" });
});

test("parseDiscordHandle: accepterer 2-32 tegn af smaa bogstaver/tal/punktum/underscore", () => {
  assert.deepEqual(parseDiscordHandle("ab"), { valid: true, value: "ab" });
  assert.deepEqual(parseDiscordHandle("a".repeat(32)), { valid: true, value: "a".repeat(32) });
  assert.deepEqual(parseDiscordHandle("nicolai_dolmer.99"), { valid: true, value: "nicolai_dolmer.99" });
});

test("parseDiscordHandle: afviser under 2 tegn eller over 32 tegn", () => {
  assert.equal(parseDiscordHandle("a").valid, false);
  assert.equal(parseDiscordHandle("a".repeat(33)).valid, false);
});

test("parseDiscordHandle: afviser store bogstaver (Discord-brugernavne er altid lowercase)", () => {
  assert.equal(parseDiscordHandle("Nicolai").valid, false);
});

test("parseDiscordHandle: afviser tegn uden for Discords tilladte saet", () => {
  assert.equal(parseDiscordHandle("nicolai dolmer").valid, false); // mellemrum midt i
  assert.equal(parseDiscordHandle("nicolai@dolmer").valid, false);
  assert.equal(parseDiscordHandle("nicolai#1234").valid, false); // gammel discriminator-form
  assert.equal(parseDiscordHandle("nico-lai").valid, false); // bindestreg ikke tilladt
});

test("isValidDiscordHandle: bekvem boolean-wrapper", () => {
  assert.equal(isValidDiscordHandle("nicolai.dolmer"), true);
  assert.equal(isValidDiscordHandle(""), true); // tomt = gyldigt (rydder feltet)
  assert.equal(isValidDiscordHandle("NICOLAI"), false);
});

test("isValidDiscordSnowflake: kun 17-19-cifrede numeriske ID'er", () => {
  assert.equal(isValidDiscordSnowflake("123456789012345678"), true); // 18 cifre
  assert.equal(isValidDiscordSnowflake("12345678901234567"), true); // 17 cifre
  assert.equal(isValidDiscordSnowflake("1234567890123456789"), true); // 19 cifre
  assert.equal(isValidDiscordSnowflake("1234567890123456"), false); // 16 cifre
  assert.equal(isValidDiscordSnowflake("12345678901234567890"), false); // 20 cifre
  assert.equal(isValidDiscordSnowflake("nicolai.dolmer"), false);
  assert.equal(isValidDiscordSnowflake(null), false);
  assert.equal(isValidDiscordSnowflake(undefined), false);
});
