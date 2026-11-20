from PIL import Image, ImageDraw, ImageFont
import textwrap
SK='/tmp/claude-0/aud/sk'; OUT='/home/user/CyclingZone/pr-screens/ux-16-11/2/foer-efter'
B='/usr/share/fonts/opentype/inter/Inter-Bold.otf'; R='/usr/share/fonts/opentype/inter/Inter-Regular.otf'; M='/usr/share/fonts/opentype/inter/Inter-SemiBold.otf'
items=[
 ('s1','01-auktionstabel-desktop','1 · Auktionstabellen på computer','Højeste bud, tid tilbage og værdi ligger i dag bag vandret rul ved 1280 og 1440 px; efter står beslutningstallene lige efter navnet.'),
 ('s2','02-disponibel-saldo','2 · Disponibel saldo i markedets hoved','Hovedet viser saldoen (500.000), men bud låser penge; efter viser det, hvad spilleren faktisk kan byde for (450.000).'),
 ('s3','03-budraekken','3 · Én budrække','To ens felter med rå tal ("50000") og to verber bliver til ét felt med tusindtal, et valg mellem bud og autobud og saldoen efter buddet.'),
 ('s4','04-tilbudskortet','4 · Tilbudskortet siger, hvad der sker','Sælgeren ser i dag hverken sin egen udbudspris, afstanden til værdien eller pengelåsen; efter står konsekvensen før knappen.'),
 ('s5','05-markedet-samlet','5 · Markedet som ét sted','Bundmenuens "Market" lyser kun på Auktioner, og Transfers kan kun nås via menuen; efter er markedet ét hoved med fire faner.'),
]
for key,name,title,sent in items:
    a=Image.open(f'{SK}/{key}-before.png').convert('RGB'); b=Image.open(f'{SK}/{key}-after.png').convert('RGB')
    if a.width>1000: # desktop: stack vertically
        W=a.width+80; gap=40
        scale=1
        pad=40; labelh=50
        fT=ImageFont.truetype(B,40); fS=ImageFont.truetype(R,26); fL=ImageFont.truetype(M,28)
        lines=textwrap.wrap(sent,95)
        head=40+50+len(lines)*36+30
        H=head+2*(labelh+a.height)+gap+pad
        im=Image.new('RGB',(W,H),'#F3F1EC'); d=ImageDraw.Draw(im)
        d.rectangle([0,0,W,head-10],fill='#161B33'); d.text((pad,30),title,font=fT,fill='#E8C547')
        for i,l in enumerate(lines): d.text((pad,90+i*36),l,font=fS,fill='#FFFFFF')
        y=head+10
        for lab,img in (('FØR',a),('EFTER (skitse)',b)):
            d.text((pad,y),lab,font=fL,fill='#161B33'); y+=labelh; im.paste(img,(pad,y)); d.rectangle([pad-1,y-1,pad+img.width,y+img.height],outline='#C9C4B8'); y+=img.height+gap
    else:
        pad=40; gap=40; labelh=60
        W=a.width*2+gap+2*pad
        fT=ImageFont.truetype(B,52); fS=ImageFont.truetype(R,34); fL=ImageFont.truetype(M,34)
        lines=textwrap.wrap(sent,80)
        head=50+64+len(lines)*46+40
        H=head+labelh+a.height+pad
        im=Image.new('RGB',(W,H),'#F3F1EC'); d=ImageDraw.Draw(im)
        d.rectangle([0,0,W,head-10],fill='#161B33'); d.text((pad,36),title,font=fT,fill='#E8C547')
        for i,l in enumerate(lines): d.text((pad,110+i*46),l,font=fS,fill='#FFFFFF')
        for j,(lab,img) in enumerate((('FØR',a),('EFTER (skitse)',b))):
            x=pad+j*(a.width+gap); d.text((x,head+5),lab,font=fL,fill='#161B33'); im.paste(img,(x,head+labelh)); d.rectangle([x-1,head+labelh-1,x+img.width,head+labelh+img.height],outline='#C9C4B8')
    im.save(f'{OUT}/{name}.png',optimize=True); print(name,im.size)
