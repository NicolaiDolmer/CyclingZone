// Klik-flows i område 4: Træn nu -> kvittering, rapport, dagsvalg. node flow.cjs <ud-mappe>
const { chromium } = require('playwright'); const FLAGS = require('./prodflags.cjs');
const OUT = process.argv[2];
(async () => { const b = await chromium.launch();
  for (const [vp, opts] of [['390',{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}],['1440',{viewport:{width:1440,height:900}}]]) {
    const ctx = await b.newContext({...opts, locale:'en-US'}); await ctx.addInitScript(FLAGS);
    const p = await ctx.newPage(); const go = async u => { await p.goto('http://localhost:5173'+u,{waitUntil:'networkidle'}).catch(()=>{}); await p.waitForTimeout(2000); };
    const shot = async n => { await p.screenshot({path:`${OUT}/flow-${n}-${vp}.png`, fullPage: vp==='390'}); console.log('shot', n, vp); };
    // 1) Træn nu, før og efter tryk
    await go('/training?trainNow=instant'); await shot('train-before');
    const btn = p.getByRole('button', { name: /train now/i }).first();
    console.log('train-now enabled?', await btn.isEnabled().catch(()=>'n/a'));
    const t0 = Date.now(); await btn.click().catch(e=>console.log('click fail', e.message.slice(0,80)));
    await p.waitForTimeout(600); await shot('train-confirm'); 
    const confirm = p.getByRole('dialog').getByRole('button').filter({hasText:/train|confirm|yes/i}).first();
    if (await confirm.count()) { await confirm.click(); console.log('confirmed'); }
    await p.waitForTimeout(2500); console.log('ms', Date.now()-t0); await shot('train-after');
    // 2) Kvittering (rapport-fanen med mock-kvittering)
    await go('/training?tab=report&receipt=complete'); await shot('receipt-complete');
    await go('/training?tab=report&receipt=pending'); await shot('receipt-pending');
    // 3) Dagsvalg: åbn rytterens dagspanel
    await go('/training'); const row = p.getByRole('button', { name: /recovery/i }).first();
    if (await row.count()) { await row.click(); await p.waitForTimeout(800); await shot('day-recovery'); }
    const edit = p.getByRole('button', { name: /^edit/i }).first(); if (await edit.count()) { await edit.click(); await p.waitForTimeout(800); await shot('fatigue-edit'); await p.keyboard.press('Escape'); }
    const asst = p.getByRole('button', { name: /assistant/i }).first(); if (await asst.count()) { await go('/training'); await p.getByRole('button', { name: /assistant/i }).first().click(); await p.waitForTimeout(800); await shot('assistant'); }
    await ctx.close(); }
  await b.close(); })();
