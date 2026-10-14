// #6574: skrifttyper til satori som ArrayBuffer. Samme skrifter som appen (Bebas Neue til display,
// Inter Tight til data), men som statiske ttf — se headeren i de indlejrede filer.
import { BEBAS_NEUE_TTF_BASE64 } from "./fonts/bebas-neue-latin.ts";
import { INTER_TIGHT_400_TTF_BASE64 } from "./fonts/inter-tight-400.ts";
import { INTER_TIGHT_700_TTF_BASE64 } from "./fonts/inter-tight-700.ts";

export interface OgFont { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }

function decode(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

let cached: OgFont[] | null = null;

/** Afkodes én gang pr. isolate (varm funktion genbruger dem). */
export function loadFonts(): OgFont[] {
  if (!cached) {
    cached = [
      { name: "Bebas Neue", data: decode(BEBAS_NEUE_TTF_BASE64), weight: 400, style: "normal" },
      { name: "Inter Tight", data: decode(INTER_TIGHT_400_TTF_BASE64), weight: 400, style: "normal" },
      { name: "Inter Tight", data: decode(INTER_TIGHT_700_TTF_BASE64), weight: 700, style: "normal" },
    ];
  }
  return cached;
}
