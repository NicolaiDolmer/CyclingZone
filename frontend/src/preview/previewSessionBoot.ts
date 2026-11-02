/// <reference types="vite/client" />
// #3430: kører seedet som side-effekt på modul-load. supabase-js læser sessionen
// fra localStorage allerede når lib/supabase.ts evalueres (statisk import), altså
// FØR installPreviewMock() (dynamisk import) når at køre. main.jsx importerer
// derfor dette modul FØRST. Bag VITE_PREVIEW_MOCK: i production konstant-folder
// Vite guarden til false, så kroppen tree-shakes væk (ingen session, ingen kode).
import { seedPreviewSession } from "./previewSession.ts";

if (import.meta.env.VITE_PREVIEW_MOCK) {
  seedPreviewSession(
    typeof localStorage === "undefined" ? undefined : localStorage,
    import.meta.env.VITE_SUPABASE_URL,
  );
}
