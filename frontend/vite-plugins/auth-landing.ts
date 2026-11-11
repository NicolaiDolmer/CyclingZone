import { loadEnv, type Plugin } from "vite";
import { authStorageKey, landingGuardScript } from "../src/lib/authLanding.ts";

export function authLandingPlugin(): Plugin {
  let script = "";
  return {
    name: "cz-auth-landing",
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir, "VITE_SUPABASE_URL");
      script = landingGuardScript(authStorageKey(env.VITE_SUPABASE_URL));
    },
    transformIndexHtml: {
      order: "pre",
      handler: () => [{ tag: "script", children: script, injectTo: "head-prepend" }],
    },
  };
}
