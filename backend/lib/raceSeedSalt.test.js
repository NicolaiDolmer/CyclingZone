import { test } from "node:test";
import assert from "node:assert/strict";

import { raceSeedInput, activeSaltVersion, saltCommitHash } from "./raceSeedSalt.js";
import { stableSeed } from "./raceSimulator.js";

const ENV_KEYS = ["RACE_ENGINE_SEED_SALT", "RACE_ENGINE_SEED_SALT_VERSION"];

function clearSaltEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

test("uden salt-env: legacy-input uændret, ingen aktiv version, ingen commit-hash", () => {
  clearSaltEnv();
  try {
    assert.equal(raceSeedInput("race-1", 2), "race-1:2");
    assert.equal(activeSaltVersion(), null);
    assert.equal(saltCommitHash(), null);
  } finally {
    clearSaltEnv();
  }
});

test("med salt-env: input afviger fra legacy-input, men er stabil for samme salt (repro-AC)", () => {
  clearSaltEnv();
  try {
    process.env.RACE_ENGINE_SEED_SALT = "test-salt-abc";
    const input = raceSeedInput("race-1", 2);
    assert.notEqual(input, "race-1:2");
    // Samme salt → identisk input → identisk stableSeed (repro-AC).
    const input2 = raceSeedInput("race-1", 2);
    assert.equal(input, input2);
    assert.equal(stableSeed(input), stableSeed(input2));
  } finally {
    clearSaltEnv();
  }
});

test("to forskellige salte giver forskellige seed-inputs (og dermed forskellige seeds)", () => {
  clearSaltEnv();
  try {
    process.env.RACE_ENGINE_SEED_SALT = "salt-one";
    const inputA = raceSeedInput("race-1", 2);
    process.env.RACE_ENGINE_SEED_SALT = "salt-two";
    const inputB = raceSeedInput("race-1", 2);
    assert.notEqual(inputA, inputB);
    assert.notEqual(stableSeed(inputA), stableSeed(inputB));
  } finally {
    clearSaltEnv();
  }
});

test("salt-version: default 1 når salt sat uden eksplicit version", () => {
  clearSaltEnv();
  try {
    process.env.RACE_ENGINE_SEED_SALT = "test-salt";
    assert.equal(activeSaltVersion(), 1);
  } finally {
    clearSaltEnv();
  }
});

test("salt-version: respekterer eksplicit sat version", () => {
  clearSaltEnv();
  try {
    process.env.RACE_ENGINE_SEED_SALT = "test-salt";
    process.env.RACE_ENGINE_SEED_SALT_VERSION = "3";
    assert.equal(activeSaltVersion(), 3);
  } finally {
    clearSaltEnv();
  }
});

test("salt-version: ugyldig værdi behandles som 1", () => {
  clearSaltEnv();
  try {
    process.env.RACE_ENGINE_SEED_SALT = "test-salt";
    for (const bad of ["0", "-1", "not-a-number", "1.5", ""]) {
      process.env.RACE_ENGINE_SEED_SALT_VERSION = bad;
      assert.equal(activeSaltVersion(), 1, `version=${JSON.stringify(bad)} bør falde tilbage til 1`);
    }
  } finally {
    clearSaltEnv();
  }
});

test("saltCommitHash: 64 hex-tegn, stabil for samme salt, ændrer sig med salten", () => {
  clearSaltEnv();
  try {
    process.env.RACE_ENGINE_SEED_SALT = "test-salt-abc";
    const h1 = saltCommitHash();
    assert.match(h1, /^[0-9a-f]{64}$/);
    const h2 = saltCommitHash();
    assert.equal(h1, h2, "samme salt skal give identisk hash");

    process.env.RACE_ENGINE_SEED_SALT = "another-salt";
    const h3 = saltCommitHash();
    assert.notEqual(h1, h3, "anden salt skal give anden hash");
  } finally {
    clearSaltEnv();
  }
});

test("tom streng behandles som inaktiv salt (samme som unset)", () => {
  clearSaltEnv();
  try {
    process.env.RACE_ENGINE_SEED_SALT = "";
    assert.equal(raceSeedInput("race-1", 2), "race-1:2");
    assert.equal(activeSaltVersion(), null);
    assert.equal(saltCommitHash(), null);
  } finally {
    clearSaltEnv();
  }
});
