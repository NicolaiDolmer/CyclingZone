// Før/efter-billeder: FØR = appen i preview-mock (prod-kontakter), EFTER = skitse i sketches/.
// Nummer, navn og én sætning brændes ind øverst. node compose.cjs (preview-server på :5173)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const FLAGS = require('./prodflags.cjs'); const HERE = __dirname; const OUT = path.join(HERE, 'foer-efter'); fs.mkdirSync(OUT, { recursive: true });
const FIX = [
 [1,'traen-nu-efter-tryk','/training?trainNow=instant','trainnow','Træn nu: efter trykket','Efter trykket viser hovedet hvad der skete (klokkeslæt, Gemt, link til kvitteringen), guld-knappen og forklaringen forsvinder, og rækkerne viser træthed nu.'],
 [2,'kvitteringen','/training?tab=report&receipt=complete',null,'Kvitteringen i spillerens sprog','Én sætning om dagen og én række pr. rytter med evne fra og til; tælleværk og systemord som "Rider receipts" og "Training slots recorded" går ud.'],
 [3,'udvikling-et-sted','/training?tab=development',null,'Udvikling ét sted med ét skøn','Rating nu, ét skøn for hvor rytteren er på vej hen og næste point pr. evne står samlet, i stedet for tre forskellige potentialtal på fire flader.'],
 [4,'profilfaner-paa-mobil','/riders/rider-1?tab=training','tabclick','Rytterprofilens faner på mobil','Efter et fanetryk står fanens indhold øverst under en fast rytterbjælke, i stedet for 750 px hero før indholdet.'],
 [5,'indstillinger','/profile',null,'Indstillinger: ét navn og én Gem','Siden hedder det samme som menupunktet, og alle felter gemmes med én knap i bunden i stedet for tre separate gem-knapper.'],
];
(async () => { const b = await chromium.launch();
  const ctx = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true, locale:'en-US' });
  await ctx.addInitScript(FLAGS); const p = await ctx.newPage(); fs.mkdirSync(path.join(HERE,'before'),{recursive:true}); fs.mkdirSync(path.join(HERE,'after'),{recursive:true});
  for (const [n,, url, mode] of FIX) {
    await p.goto('http://localhost:5173'+url, { waitUntil:'networkidle' }); await p.waitForTimeout(2200);
    if (mode==='trainnow') { await p.getByRole('button',{name:/train now/i}).first().click(); await p.waitForTimeout(500); await p.getByRole('dialog').getByRole('button',{name:/train now/i}).click(); await p.waitForTimeout(3000); }
    if (mode==='tabclick') { await p.getByRole('tab',{name:/^overview/i}).first().click().catch(()=>{}); await p.waitForTimeout(500); await p.getByRole('tab',{name:/^training/i}).first().click().catch(()=>{}); await p.waitForTimeout(800); }
    await p.screenshot({ path: path.join(HERE,'before',`fix${n}.png`) });
  }
  await p.route('http://localhost:5173/__sk/**', r => { const f = path.join(HERE,'sketches', r.request().url().split('/__sk/')[1]); r.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.css')?'text/css':'text/html' }); });
  for (const [n] of FIX) { await p.goto(`http://localhost:5173/__sk/s${n}.html`); await p.waitForTimeout(600); await p.screenshot({ path: path.join(HERE,'after',`fix${n}.png`) }); }
  const cp = await b.newPage({ viewport:{width:900,height:1000}, deviceScaleFactor:2 }); const img = f => 'data:image/png;base64,'+fs.readFileSync(f).toString('base64');
  for (const [n,slug,,,name,line] of FIX) {
    await cp.setContent(`<html><body style="margin:0;background:#e9e6de;font-family:system-ui,sans-serif;color:#15161c"><div id="w" style="width:860px;padding:20px">
     <div style="font-size:22px;font-weight:700">${n} · ${name}</div><div style="font-size:15px;margin-top:6px;line-height:1.4">${line}</div>
     <div style="display:flex;gap:40px;margin-top:16px">${[['FØR (i dag, preview-mock med prod-kontakter)',`before/fix${n}.png`],['EFTER (skitse)',`after/fix${n}.png`]].map(([l,f])=>`<div><div style="font-size:12px;font-weight:700;letter-spacing:.06em;margin-bottom:6px">${l}</div><img src="${img(path.join(HERE,f))}" style="width:390px;height:844px;display:block;border:1px solid #c9c4b8"></div>`).join('')}</div>
     <div style="font-size:11px;margin-top:10px;color:#5b5a55">390 × 844 · syntetiske ryttere fra preview-mocken · gennemgang 4/4, 16/11</div></div></body></html>`);
    await (await cp.$('#w')).screenshot({ path: path.join(OUT, `${String(n).padStart(2,'0')}-${slug}.png`) }); console.log('ok', n);
  }
  await b.close(); })();
