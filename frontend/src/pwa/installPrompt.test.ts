// #6584 · capture af beforeinstallprompt + platform-detektion + SW-gaten.
import test from "node:test";
import assert from "node:assert/strict";
import {
  __resetInstallPromptForTests,
  captureInstallPrompt,
  detectInstallPlatform,
  hasDeferredPrompt,
  isIosDevice,
  isStandalone,
  promptInstall,
  subscribeInstallPrompt,
} from "./installPrompt.ts";
import { serviceWorkerSkipReason } from "./serviceWorker.ts";

function fakeWindow() {
  const target = new EventTarget();
  return target as unknown as Window;
}

function fakePromptEvent(outcome: "accepted" | "dismissed") {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
    prompted: number;
  };
  event.prompted = 0;
  event.prompt = async () => {
    event.prompted += 1;
  };
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

test("captures beforeinstallprompt, blocks the mini-infobar and prompts once", async () => {
  __resetInstallPromptForTests();
  const win = fakeWindow();
  let installed = 0;
  let changes = 0;
  captureInstallPrompt(win, () => {
    installed += 1;
  });
  subscribeInstallPrompt(() => {
    changes += 1;
  });
  assert.equal(hasDeferredPrompt(), false);

  const event = fakePromptEvent("accepted");
  win.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(hasDeferredPrompt(), true);

  assert.equal(await promptInstall(), "accepted");
  assert.equal(event.prompted, 1);
  assert.equal(hasDeferredPrompt(), false);
  assert.equal(await promptInstall(), "unavailable");

  win.dispatchEvent(new Event("appinstalled"));
  assert.equal(installed, 1);
  assert.ok(changes >= 3);
});

test("a dismissed browser dialog reports 'dismissed'", async () => {
  __resetInstallPromptForTests();
  const win = fakeWindow();
  captureInstallPrompt(win, () => {});
  win.dispatchEvent(fakePromptEvent("dismissed"));
  assert.equal(await promptInstall(), "dismissed");
});

test("platform: a captured prompt wins, iOS gets the guide, the rest nothing", () => {
  const android = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36";
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
  const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
  assert.equal(detectInstallPlatform({ userAgent: android, maxTouchPoints: 5, hasDeferredPrompt: true }), "prompt");
  assert.equal(detectInstallPlatform({ userAgent: android, maxTouchPoints: 5, hasDeferredPrompt: false }), "none");
  assert.equal(detectInstallPlatform({ userAgent: iphone, maxTouchPoints: 5, hasDeferredPrompt: false }), "ios");
  assert.equal(isIosDevice(ipad, 5), true);
  assert.equal(isIosDevice(ipad, 0), false);
});

test("standalone detection: display-mode or the iOS flag", () => {
  const mm = (match: boolean) => () => ({ matches: match });
  assert.equal(isStandalone({ matchMedia: mm(true), navigator: {} } as unknown as Window), true);
  assert.equal(isStandalone({ matchMedia: mm(false), navigator: {} } as unknown as Window), false);
  assert.equal(isStandalone({ matchMedia: mm(false), navigator: { standalone: true } } as unknown as Window), true);
});

test("service worker registers only in a real production browser", () => {
  const nav = (extra: Record<string, unknown> = {}) => ({ serviceWorker: {}, ...extra }) as unknown as Navigator;
  assert.equal(serviceWorkerSkipReason({ isProd: false, nav: nav() }), "dev");
  assert.equal(serviceWorkerSkipReason({ isProd: true, nav: null }), "unsupported");
  assert.equal(serviceWorkerSkipReason({ isProd: true, nav: {} as Navigator }), "unsupported");
  assert.equal(serviceWorkerSkipReason({ isProd: true, nav: nav({ webdriver: true }) }), "automation");
  assert.equal(serviceWorkerSkipReason({ isProd: true, nav: nav() }), null);
});
