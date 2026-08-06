// #3402 — Sæsondokumentarens delbare kort: klient-side PNG-eksport tegnet
// direkte med Canvas 2D-API'et. Samme begrundelse og mønster som #3397's
// Hero & Agony-kort (heroAgonyExport.js — endnu ikke merget da denne slice
// blev skrevet, så koden her er en selvstændig, parallel implementering,
// IKKE en import af den unmergede fil): ingen ny npm-afhængighed (et
// html-to-image-bibliotek som html2canvas/dom-to-image trækker DOM-kloning +
// webfont-inlining ind for ét typografisk kort), native canvas giver fuld
// pixel-kontrol.
//
// FAST mørk editorial-palette, uafhængig af brugerens lys/mørk-tema-valg —
// et kort delt til Discord/socialt skal se ens ud uanset hvilket tema
// eksportøren havde åbent (samme industri-konvention som ethvert andet
// OG-billede/share-kort). Værdierne er de SAMME literal hex/rgb som appens
// eget mørke tema allerede bruger (frontend/src/index.css
// `:root[data-theme="dark"]`), bare pinnet i stedet for læst live fra
// CSS custom properties.
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
      document.fonts.load('400 64px "Bebas Neue"'),
      document.fonts.load('600 20px "Inter Tight"'),
      document.fonts.load('400 26px "Inter Tight"'),
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
 * Tegner sæsondokumentar-kortet til et frisk, ikke-monteret <canvas> og
 * returnerer det. Al tekst kommer ind FÆRDIG-oversat — dette modul digter
 * intet, det placerer bogstaver (samme hallucinations-garde som resten af
 * #3402: strukturen leverer facts, canvas'et layouter dem).
 *
 * @param {object} args
 * @param {string} args.eyebrow    fx "SEASON 3 DOCUMENTARY" (allerede oversat/uppercased af kaldestedet)
 * @param {string} args.teamName
 * @param {Array<{label:string, value:string}>} args.stats  op til 4 linjer, fx signing/biggest result/rival
 * @param {string} [args.meta]     fx "Division 3 · #1"
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function drawSeasonDocumentaryCanvas({ eyebrow, teamName, stats = [], meta }) {
  await ensureFontsReady();
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Ydre hairline-ramme — ingen skygger/gradients (PAGE_TEMPLATES.md).
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, WIDTH - 2, HEIGHT - 2);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  let y = 96;
  ctx.fillStyle = PALETTE.text3;
  ctx.font = "600 20px 'Inter Tight', Arial, sans-serif";
  ctx.fillText(String(eyebrow || "").toUpperCase(), PAD_X, y);

  y += 24;
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_X, y);
  ctx.lineTo(WIDTH - PAD_X, y);
  ctx.stroke();

  y += 72;
  ctx.fillStyle = PALETTE.text1;
  ctx.font = "400 64px 'Bebas Neue', Impact, 'Arial Narrow', sans-serif";
  const teamLines = wrapText(ctx, teamName, WIDTH - PAD_X * 2, 2);
  for (const line of teamLines) {
    ctx.fillText(line, PAD_X, y);
    y += 62;
  }

  if (meta) {
    y += 4;
    ctx.fillStyle = PALETTE.text2;
    ctx.font = "400 24px 'Inter Tight', Arial, sans-serif";
    ctx.fillText(meta, PAD_X, y);
    y += 20;
  }

  // Stat-rækker — label venstre, værdi højre, hver adskilt af en hairline
  // (samme "linje-liste"-mønster som SeasonRecapHero's highlight-ol).
  y += 36;
  const rowH = 62;
  const maxRows = Math.min(stats.length, 4);
  for (let i = 0; i < maxRows; i++) {
    const s = stats[i];
    ctx.strokeStyle = PALETTE.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_X, y);
    ctx.lineTo(WIDTH - PAD_X, y);
    ctx.stroke();

    const rowY = y + 40;
    ctx.textAlign = "left";
    ctx.fillStyle = PALETTE.text3;
    ctx.font = "600 18px 'Inter Tight', Arial, sans-serif";
    ctx.fillText(String(s.label || "").toUpperCase(), PAD_X, rowY - 20);

    ctx.fillStyle = PALETTE.text1;
    ctx.font = "500 28px 'Inter Tight', Arial, sans-serif";
    const valueLines = wrapText(ctx, s.value, WIDTH - PAD_X * 2, 1);
    ctx.fillText(valueLines[0] || "—", PAD_X, rowY + 12);

    y += rowH;
  }

  const footerY = HEIGHT - 56;
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_X, footerY - 32);
  ctx.lineTo(WIDTH - PAD_X, footerY - 32);
  ctx.stroke();

  ctx.fillStyle = PALETTE.text3;
  ctx.font = "500 18px 'Inter Tight', Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("cyclingzone.org", PAD_X, footerY);

  ctx.fillStyle = PALETTE.accent;
  ctx.font = "600 18px 'Inter Tight', Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("CYCLING ZONE", WIDTH - PAD_X, footerY);
  ctx.textAlign = "left";

  return canvas;
}

/** Renders + serialiserer kortet til en PNG-Blob. */
export async function exportSeasonDocumentaryPng(args) {
  const canvas = await drawSeasonDocumentaryCanvas(args);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas.toBlob returned null"));
    }, "image/png");
  });
}

/** Trigger et browser-download af en Blob — samme "ét klik → fil"-mønster som resten af appens eksport-affordances. */
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
