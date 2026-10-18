// #6836: i18nServer flertal efter sprogets regler.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMessage } from "./i18nServer.js";

test("#6836: flertal følger sprogets regler (fransk 'one' dækker 0)", () => {
  const tpl = "{count, plural, one {# coureur} other {# coureurs}}";
  assert.equal(formatMessage(tpl, { count: 0 }, null, "fr"), "0 coureur");
  assert.equal(formatMessage(tpl, { count: 2 }, null, "fr"), "2 coureurs");
  assert.equal(formatMessage("{count, plural, one {# rider} other {# riders}}", { count: 0 }, null, "en"), "0 riders");
  assert.equal(formatMessage("{count, plural, one {# rider} other {# riders}}", { count: 0 }), "0 riders");
});
