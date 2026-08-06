// Hero & Agony (#3397) — client-side PNG export of the moment-card, drawn
// directly with the Canvas 2D API. No new npm dependency: an html-to-image
// library (html2canvas/dom-to-image) pulls in DOM-cloning + webfont-inlining
// complexity a night-wave v1 doesn't need for a single typographic card;
// native canvas gives full pixel control and matches the issue's own AC
// ("klient-side render er fint i v1" — the server-side @vercel/og track is
// tracked separately as #1299).
//
// FIXED dark editorial palette, independent of the viewer's light/dark theme
// preference — a card shared to Discord should look the same regardless of
// which theme the exporting manager had open (same reasoning as any OG-image/
// share-card convention elsewhere in the industry). Values below are the
// SAME literal hex/rgb the app's own dark theme already uses
// (frontend/src/index.css `:root[data-theme="dark"]`), just pinned rather
// than read live from CSS custom properties.
const PALETTE = Object.freeze({
  bg: "#161824",
  border: "#2a2d3a",
  text1: "#ededf2",
  text2: "#9da0b3",
  text3: "#888ba0",
  accent: "rgb(232, 197, 71)",
});

const WIDTH = 1200;
const HEIGHT = 675;
const PAD_X = 72;

async function ensureFontsReady() {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load('400 84px "Bebas Neue"'),
      document.fonts.load('600 22px "Inter Tight"'),
      document.fonts.load('400 30px "Inter Tight"'),
    ]);
    await document.fonts.ready;
  } catch {
    // Best-effort — canvas falder tilbage til browserens generiske sans hvis
    // Bebas/Inter Tight ikke nåede at indlæse. Ingen synlig fejl for brugeren.
  }
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

/**
 * Tegner Hero & Agony-kortet til et frisk, ikke-monteret <canvas> og
 * returnerer det. Al tekst kommer ind FÆRDIG-oversat/interpoleret — dette
 * modul digter intet, det placerer bogstaver.
 *
 * @param {object} args
 * @param {string} args.eyebrow   "HERO" | "AGONY" (allerede oversat/uppercased af kaldestedet)
 * @param {string} args.headline  rytter- eller holdnavn (Bebas)
 * @param {string} args.subline   den valgte moments sætning
 * @param {string} args.meta      "{raceName} · Stage {n}"-linje
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function drawHeroAgonyCanvas({ eyebrow, headline, subline, meta }) {
  await ensureFontsReady();
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Ydre hairline-ramme — ingen skygger/gradients (PAGE_TEMPLATES.md: "no
  // gradients · no drop shadows · no rounded-2xl").
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, WIDTH - 2, HEIGHT - 2);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  let y = 104;
  ctx.fillStyle = PALETTE.text3;
  ctx.font = "600 22px 'Inter Tight', Arial, sans-serif";
  ctx.fillText(String(eyebrow || "").toUpperCase(), PAD_X, y);

  y += 26;
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_X, y);
  ctx.lineTo(WIDTH - PAD_X, y);
  ctx.stroke();

  y += 84;
  ctx.fillStyle = PALETTE.text1;
  ctx.font = "400 76px 'Bebas Neue', Impact, 'Arial Narrow', sans-serif";
  const headlineLines = wrapText(ctx, headline, WIDTH - PAD_X * 2, 2);
  for (const line of headlineLines) {
    ctx.fillText(line, PAD_X, y);
    y += 74;
  }

  y += 4;
  ctx.fillStyle = PALETTE.text2;
  ctx.font = "400 29px 'Inter Tight', Arial, sans-serif";
  const sublineLines = wrapText(ctx, subline, WIDTH - PAD_X * 2, 3);
  for (const line of sublineLines) {
    y += 40;
    ctx.fillText(line, PAD_X, y);
  }

  const footerY = HEIGHT - 56;
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_X, footerY - 32);
  ctx.lineTo(WIDTH - PAD_X, footerY - 32);
  ctx.stroke();

  ctx.fillStyle = PALETTE.text3;
  ctx.font = "500 20px 'Inter Tight', Arial, sans-serif";
  ctx.fillText(meta || "", PAD_X, footerY);

  ctx.fillStyle = PALETTE.accent;
  ctx.font = "600 20px 'Inter Tight', Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("CYCLING ZONE", WIDTH - PAD_X, footerY);
  ctx.textAlign = "left";

  return canvas;
}

/**
 * Renders + serialiserer kortet til en PNG-Blob.
 * @returns {Promise<Blob>}
 */
export async function exportHeroAgonyPng(args) {
  const canvas = await drawHeroAgonyCanvas(args);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas.toBlob returned null"));
    }, "image/png");
  });
}

/**
 * Trigger et browser-download af en Blob — samme "ét klik → fil"-mønster som
 * resten af appens eksport-affordances.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
