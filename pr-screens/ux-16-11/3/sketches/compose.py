# Sætter FØR (rigtig app, preview-mock) og EFTER (skitse) side om side med nummer,
# navn og én sætning brændt ind øverst. Kør fra repo-roden efter shoot.cjs og render.cjs:
#   python3 pr-screens/ux-16-11/3/sketches/compose.py
from PIL import Image, ImageDraw, ImageFont
import os
R = 'pr-screens/ux-16-11/3'
F = '/usr/share/fonts/opentype/inter/'
bold = lambda s: ImageFont.truetype(F + 'Inter-Bold.otf', s)
reg = lambda s: ImageFont.truetype(F + 'Inter-Regular.otf', s)
ITEMS = [
  ('01', 'Fristen er skjult på mobil', 'Låsetiden ligger uden for skærmen i en talrække, der ruller sidelæns uden tegn; efter: 2 × 2 tal og fristen som én linje ved guld-knappen.',
   'raw/09-loeb-live-etape-390-light.png', 0, 's1.png', '01-frist-skjult-paa-mobil.png'),
  ('02', 'Kalenderen skjuler weekenden', 'Måneds-gitteret viser kun man-tor ved 390 px; fre-søn ligger bag et sidelæns rul uden tegn. Efter: liste pr. uge med holdets status på hver række.',
   'raw/01-kalender-390-light.png', 0, 's2.png', '02-kalender-liste-paa-mobil.png'),
  ('03', 'Fire lag navigation før første rytter', 'Faner, Sæson/Dag, Sæson 1/2, matrix-faner og filter står før data (første række y ≈ 872). Efter: løbslisten er første skærm med status pr. løb (#7535-retningen).',
   'raw/03-saesonmatrix-390-light.png', 0, 's3.png', '03-planlaegning-lag.png'),
  ('04', 'Taktik: tre begreber pr. rytter', 'Rolle, intention og ordrer plus holdplan og jagt kræver en forklaringsparagraf og fire knapper pr. rytter. Efter: ét kort pr. rytter med planen langs ruten (#7778 valg 15-16).',
   'raw/08-loeb-kommende-taktik-390-light-full.png', 380, 's4.png', '04-taktik-kort-pr-rytter.png'),
  ('05', 'Flad etape: tom akse og systemtekst', 'Aksen går til 500 m for en etape på 70 m (på 1440 px ca. 250 px tom flade), seks farver for stigninger der ikke findes, og en teknisk forklaring. Efter: lav fast højde, ingen tom forklaring.',
   'raw/13-loeb-slut-endags-390-light-full.png', 880, 's5.png', '05-ruteprofil-skala.png'),
]
os.makedirs(f'{R}/foer-efter', exist_ok=True)
for num, name, sent, before, y_css, after, out in ITEMS:
    b = Image.open(f'{R}/{before}').convert('RGB')
    y = y_css * 2
    b = b.crop((0, y, 780, min(b.height, y + 1688)))
    if b.height < 1688:
        pad = Image.new('RGB', (780, 1688), (244, 242, 236)); pad.paste(b, (0, 0)); b = pad
    a = Image.open(f'{R}/sketches/{after}').convert('RGB')
    W = 40 + 780 + 40 + 780 + 40; HB = 230; HL = 70
    c = Image.new('RGB', (W, HB + HL + 1688 + 40), (255, 255, 255))
    d = ImageDraw.Draw(c)
    d.rectangle((0, 0, W, HB), fill=(26, 31, 56))
    d.text((40, 34), f'{num}', font=bold(64), fill=(232, 197, 71))
    d.text((150, 44), name, font=bold(48), fill=(255, 255, 255))
    # én sætning, ombrudt
    words, lines, cur = sent.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=reg(28)) > W - 190: lines.append(cur); cur = w
        else: cur = t
    lines.append(cur)
    for i, l in enumerate(lines[:3]):
        d.text((150, 118 + i * 36), l, font=reg(28), fill=(220, 222, 235))
    d.text((40, HB + 20), 'FØR · i dag (preview-mock, prod-kontakter 16/11)', font=bold(26), fill=(180, 35, 24))
    d.text((860, HB + 20), 'EFTER · skitse (retning, ikke færdigt design)', font=bold(26), fill=(47, 125, 79))
    c.paste(b, (40, HB + HL)); c.paste(a, (860, HB + HL))
    d.rectangle((40, HB + HL, 40 + 779, HB + HL + 1687), outline=(229, 224, 213), width=2)
    d.rectangle((860, HB + HL, 860 + 779, HB + HL + 1687), outline=(229, 224, 213), width=2)
    c = c.resize((c.width * 3 // 4, c.height * 3 // 4), Image.LANCZOS)
    c.save(f'{R}/foer-efter/{out}', optimize=True)
    print(out, c.size)
