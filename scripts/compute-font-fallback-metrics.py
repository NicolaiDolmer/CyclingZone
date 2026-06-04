#!/usr/bin/env python3
"""
Compute size-adjust + ascent/descent/line-gap overrides for a metric-matched
local() fallback face, so swapping a self-hosted webfont in causes ~zero CLS.

Method mirrors @capsizecss/core createFontStack (the engine behind next/font &
fontaine): size-adjust = webfont.xWidthAvg / fallback.xWidthAvg, where xWidthAvg
is the English-frequency-weighted average advance width of the lowercase letters.
Overrides are then the webfont's hhea metrics divided by the size-adjusted em.

Run: python scripts/compute-font-fallback-metrics.py
(needs: pip install fonttools brotli)
"""
from fontTools.ttLib import TTFont

# English lowercase letter frequencies (capsize's weighting table).
FREQ = {
    'a': 0.0668, 'b': 0.0122, 'c': 0.0228, 'd': 0.0348, 'e': 0.1039,
    'f': 0.0182, 'g': 0.0165, 'h': 0.0499, 'i': 0.0570, 'j': 0.0009,
    'k': 0.0063, 'l': 0.0329, 'm': 0.0197, 'n': 0.0552, 'o': 0.0614,
    'p': 0.0158, 'q': 0.0008, 'r': 0.0490, 's': 0.0518, 't': 0.0741,
    'u': 0.0226, 'v': 0.0080, 'w': 0.0193, 'x': 0.0012, 'y': 0.0161,
    'z': 0.0006, ' ': 0.1818,
}

def x_width_avg(font):
    upm = font['head'].unitsPerEm
    cmap = font.getBestCmap()
    hmtx = font['hmtx']
    total_w = 0.0
    total_f = 0.0
    for ch, freq in FREQ.items():
        gid = cmap.get(ord(ch))
        if gid is None:
            continue
        adv = hmtx[gid][0]
        total_w += (adv / upm) * freq
        total_f += freq
    return total_w / total_f  # average advance in em units

def metrics(path, label):
    f = TTFont(path)
    head = f['head']
    hhea = f['hhea']
    os2 = f['OS/2'] if 'OS/2' in f else None
    upm = head.unitsPerEm
    out = {
        'upm': upm,
        'hhea_asc': hhea.ascent, 'hhea_desc': hhea.descent, 'hhea_gap': hhea.lineGap,
        'xavg': x_width_avg(f),
    }
    if os2 is not None:
        out.update({
            'typo_asc': os2.sTypoAscender, 'typo_desc': os2.sTypoDescender,
            'typo_gap': os2.sTypoLineGap,
            'use_typo': bool(os2.fsSelection & (1 << 7)),
        })
    print(f"[{label}] upm={upm} hhea(asc={hhea.ascent} desc={hhea.descent} gap={hhea.lineGap}) "
          f"xWidthAvg={out['xavg']:.5f}em" +
          (f" typo(asc={out.get('typo_asc')} desc={out.get('typo_desc')} gap={out.get('typo_gap')} "
           f"useTypo={out.get('use_typo')})" if os2 is not None else ""))
    return out

def emit(name, web, fallback_name, size_adjust, basis):
    adj_em = web['upm'] * size_adjust
    asc = web['hhea_asc'] / adj_em
    desc = abs(web['hhea_desc']) / adj_em
    gap = web['hhea_gap'] / adj_em
    print(f"\n/* {name} — metric-matched to {fallback_name} ({basis}) */")
    print(f"@font-face {{")
    print(f"  font-family: '{name}';")
    print(f"  src: local('{fallback_name}');")
    print(f"  ascent-override: {asc*100:.2f}%;")
    print(f"  descent-override: {desc*100:.2f}%;")
    print(f"  line-gap-override: {gap*100:.2f}%;")
    print(f"  size-adjust: {size_adjust*100:.2f}%;")
    print(f"}}")

if __name__ == '__main__':
    arial = metrics(r'C:\Windows\Fonts\arial.ttf', 'Arial')
    it = metrics(r'frontend/public/fonts/inter-tight-latin-wght-normal.woff2', 'Inter Tight')

    # Inter Tight is applied as the DATA font with `font-variant-numeric: tabular-nums`
    # (see index.css). Its content is overwhelmingly numeric and lives in width-
    # sensitive columns, so we anchor size-adjust to the TABULAR-DIGIT advance rather
    # than the letter-frequency average, so digits stay (near-)pixel-stable on swap.
    # Inter Tight is a variable font: its tabular digit advance widens with weight
    # (Arial, static, can't track that), so a single fallback can't match every
    # weight. Measured in-browser (the ratio depends on the CSS tnum feature + the
    # weight axis, not raw hmtx) IT-tnum/Arial = w400 1.0799 · w500 1.1088 · w600
    # 1.1377 · w700 1.1658. We anchor at w500 — the centre of the 400–600 range that
    # plain/medium table cells use — keeping that common range within ~±2.7%.
    TNUM_DIGIT_RATIO_W500 = 1.1088
    letter_sa = it['xavg'] / arial['xavg']
    print(f"\n(letter-frequency size-adjust would be {letter_sa*100:.2f}% — used for prose, "
          f"but names sit in truncated cells; digit-anchored wins for the numeric data font)")
    emit('Inter Tight Fallback', it, 'Arial', TNUM_DIGIT_RATIO_W500,
         'tabular-digit ratio @ w500 — CLS-safe for numeric columns')

    # Bebas Neue (wordmark only) intentionally has NO metric fallback face: it is
    # super-condensed, a normal-width local() can't match it without distortion,
    # and the 2 sidebar wordmark sites drive no content reflow. The tailwind
    # `display` stack uses Impact (a naturally-condensed system face) for the swap.
