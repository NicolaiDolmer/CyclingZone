// <cz-portrait register="flat|planes|ink|hybrid" width="400"> — male rider, front bust, 400×500. Production register is 'hybrid'.
// Construction: skull top y52, brow y140, eye line y156, nose base y200, mouth y226, chin y252. Face width 150 at cheekbones.
// Eyes one eye-width apart (34). Ears sit between brow line and nose base, attached behind the head silhouette.
(function () {
  const C = {
    skin: '#e3b08c', skinShade: '#c98f6b', skinDeep: '#a9734f', lip: '#b97b66', beard: '#5a4a3a',
    hair: '#4a3a2a', hairShade: '#33271b', hairHi: '#6a5640',
    navy: '#0e0f15', navyShade: '#22253a', chalk: '#f4f2ec', chalkShade: '#d9d4c6', gold: '#e8c547',
    iris: '#3f5647', pupil: '#1a1410', white: '#f5f1e8', ink: '#2b2118', inkKit: '#06070b', inkChalk: '#8e8878',
  };
  // mirror a path across x=200
  const M = (d) => d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (m, x, y) => `${(400 - parseFloat(x)).toFixed(1)},${y}`);
  const P = {
    face: 'M130,150 C130,95 158,50 200,50 C242,50 270,95 270,150 C270,178 264,196 254,212 L244,236 C232,250 214,254 200,254 C186,254 168,250 156,236 L146,212 C136,196 130,178 130,150 Z',
    jawShadeR: 'M256,212 L244,236 C232,250 214,254 200,254 L200,246 C214,246 228,242 238,230 Z',
    neck: 'M170,232 L170,306 L230,306 L230,232 Z',
    neckShadeTop: 'M170,232 L170,270 C182,275 218,275 230,270 L230,232 Z',
    trap: 'M170,288 C144,294 100,306 74,324 C56,338 50,380 48,500 L352,500 C350,380 344,338 326,324 C300,306 256,294 230,288 Z',
    sleeveL: 'M122,314 C104,340 96,376 96,420 L94,500 L48,500 C50,380 56,338 74,324 C88,318 104,316 122,314 Z',
    seamL: 'M122,314 C104,340 96,376 96,420',
    collar: 'M164,282 C178,298 222,298 236,282 L240,292 C222,312 178,312 160,292 Z',
    collarTop: 'M164,282 C178,298 222,298 236,282',
    hair: 'M130,150 C128,110 142,44 200,42 C258,44 272,110 270,150 C266,126 260,108 248,102 C236,96 222,98 214,104 C206,98 190,96 176,100 C160,104 150,112 144,124 C138,134 132,142 130,150 Z',
    hairSideL: 'M124,150 C123,140 126,130 132,124 L138,128 C134,136 130,146 128,158 Z',
    hairlineL: 'M176,100 C160,104 148,112 142,124 C134,134 128,142 124,150',
    hairTop1: 'M150,74 C170,60 200,56 230,64', hairTop2: 'M160,66 C190,50 224,52 252,70', hairTop3: 'M206,102 C222,94 240,98 254,106',
    earL: 'M140,146 C124,140 112,158 116,176 C118,190 126,200 136,200 L142,200 L142,148 Z',
    earInL: 'M128,158 C122,166 122,178 126,188 M132,168 C128,174 128,182 132,190',
    browL: 'M154,144 C160,134 178,131 192,136 C188,140 172,140 158,146 Z',
    eyeL: 'M158,158 C166,148 184,147 191,156 C185,165 166,166 158,158 Z',
    eyeTopL: 'M158,158 C166,148 184,147 191,156',
    lidL: 'M160,150 C168,140 184,139 193,149',
    lowerL: 'M162,163 C170,168 182,168 189,161',
    noseBridge: 'M200,146 C202,166 205,182 210,196',
    noseSide: 'M200,146 C203,164 206,180 211,196 C208,203 202,205 196,204 C198,186 199,166 200,146 Z',
    noseUnder: 'M184,200 C190,208 210,208 216,200 C210,203 190,203 184,200 Z',
    noseLine: 'M197,148 C195,168 193,184 188,196 C184,202 190,206 200,205 C210,206 216,202 212,196',
    nostrilL: 'M187,198 C185,201 186,204 190,204', nostrilR: 'M213,198 C215,201 214,204 210,204',
    philtrum: 'M196,206 L195,220 M204,206 L205,220',
    lipUp: 'M176,226 C186,220 194,222 200,224 C206,222 214,220 224,226 C214,227 186,227 176,226 Z',
    lipLow: 'M178,227 C186,236 214,236 222,227 C214,229 186,229 178,227 Z',
    mouthLine: 'M176,226 C190,227.5 210,227.5 224,226',
    lipLowLine: 'M184,232 C192,236 208,236 216,232',
    chinShade: 'M170,240 C180,250 220,250 230,240 C222,254 178,254 170,240 Z',
    sideShadeR: 'M240,100 C268,130 272,190 250,236 C258,200 254,150 240,100 Z',
    socketL: 'M154,148 C164,142 184,142 194,148 C186,150 168,151 154,148 Z',
    underLip: 'M182,238 C190,242 210,242 218,238 C210,244 190,244 182,238 Z',
    cheekR: 'M236,168 C250,188 250,214 238,232 C246,214 248,190 236,168 Z',
    browRidgeR: 'M212,142 C226,136 246,138 258,148 C246,144 228,144 212,148 Z',
    templeR: 'M256,124 C266,134 272,146 272,160 C268,148 262,136 256,124 Z',
    stubble: 'M146,206 C160,238 180,252 200,252 C220,252 240,238 254,206 C250,232 226,246 200,246 C174,246 150,232 146,206 Z',
    adam: 'M196,266 C199,272 201,272 204,266',
    sterno: 'M184,246 C186,266 190,286 194,300',
  };
  let uid = 0;

  function portrait(register = 'flat', opts = {}) {
    if (opts.view === 'tq') return portraitTQ(register, opts);
    const id = 'p' + (uid++);
    const ink = register === 'ink', planes = register === 'planes', hybrid = register === 'hybrid';
    const ow = Number(opts.outline || 1);
    const mood = opts.mood || 'neutral';
    const tq = opts.view === 'tq', helmet = !!opts.helmet, bad = opts.bad || '';
    const inkCol = bad === 'black' ? '#000000' : (opts.inkColor || C.ink);
    const S = (c, w = 1.1) => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
    const O = (d, c = inkCol, k = 1) => hybrid ? `<path d="${d}" ${S(c === C.ink ? inkCol : c, ow * k)}/>` : '';
    const FT = tq ? 'transform="translate(4,0) scale(0.9,1)"' : '';
    const MO = {
      happy: { line: 'M172,222 C184,231 216,231 228,222', up: 'M172,222 C184,217 194,220 200,221 C206,220 216,217 228,222 C216,224 184,224 172,222 Z', low: 'M174,223 C184,236 216,236 226,223 C216,226 184,226 174,223 Z', cheek: 'M184,198 C174,210 172,220 176,226', lowLid: 'M160,161 C170,157 182,157 190,159' },
      neutral: { line: 'M176,226 C190,227.5 210,227.5 224,226', up: P.lipUp, low: P.lipLow, cheek: '', lowLid: '' },
      down: { line: 'M178,229 C190,224 210,224 222,229', up: 'M178,229 C186,222 194,224 200,225 C206,224 214,222 222,229 C214,227 186,227 178,229 Z', low: 'M180,229 C188,236 212,236 220,229 C212,230 188,230 180,229 Z', cheek: '', lowLid: '' },
    }[mood];
    const browL = mood === 'down' ? 'M154,142 C160,132 178,128 192,138 C188,142 172,140 158,144 Z' : P.browL;
    const o = [];
    o.push(`<defs><clipPath id="${id}f"><path d="${P.face}"/></clipPath><clipPath id="${id}t"><path d="${P.trap}"/></clipPath><clipPath id="${id}h"><path d="${P.hair}"/></clipPath><clipPath id="${id}eL"><path d="${P.eyeL}"/></clipPath><clipPath id="${id}eR"><path d="${M(P.eyeL)}"/></clipPath><clipPath id="${id}sR"><path d="${M(P.sleeveL)}"/></clipPath></defs>`);
    o.push(`<path d="${P.trap}" fill="${C.navy}"/>`);
    o.push(`<rect x="246" y="280" width="110" height="230" fill="${C.navyShade}" clip-path="url(#${id}t)"/>`);
    o.push(`<g clip-path="url(#${id}t)"><path d="${P.sleeveL}" fill="${C.chalk}"/><path d="${M(P.sleeveL)}" fill="${C.chalk}"/><rect x="286" y="300" width="80" height="210" fill="${C.chalkShade}" clip-path="url(#${id}sR)"/>`);
    if (ink) o.push(`<path d="${P.sleeveL}" ${S(C.inkChalk)}/><path d="${M(P.sleeveL)}" ${S(C.inkChalk)}/>`);
    else o.push(`<path d="${P.seamL}" ${S(C.chalkShade, 1.4)}/><path d="${M(P.seamL)}" ${S(C.chalkShade, 1.4)}/>`);
    o.push(O(P.sleeveL, C.inkChalk), O(M(P.sleeveL), C.inkChalk));
    o.push(`</g>`);
    o.push(`<path d="M200,310 L200,500" ${S(C.navyShade, 1.2)}/>`);
    if (ink) o.push(`<path d="${P.trap}" ${S(C.inkKit)}/>`);
    o.push(O(P.trap, C.inkKit));
    if (tq) o.push(`<ellipse cx="152" cy="104" rx="34" ry="50" fill="${C.hairShade}"/>`);
    if (!tq) o.push(`<path d="${P.earL}" fill="${C.skinShade}"/>`);
    o.push(`<path d="${M(P.earL)}" fill="${C.skinShade}"/>`);
    if (planes) o.push(`${tq ? '' : `<path d="${P.earInL}" ${S(C.skinDeep, 1.3)}/>`}<path d="${M(P.earInL)}" ${S(C.skinDeep, 1.3)}/>`);
    if (ink) o.push(`${tq ? '' : `<path d="${P.earL}" ${S(C.ink)}/><path d="${P.earInL}" ${S(C.ink, 0.9)}/>`}<path d="${M(P.earL)}" ${S(C.ink)}/><path d="${M(P.earInL)}" ${S(C.ink, 0.9)}/>`);
    o.push(tq ? '' : O(P.earL), O(M(P.earL)), tq ? '' : O(P.earInL, C.ink, 0.7), O(M(P.earInL), C.ink, 0.7));
    o.push(`<path d="${P.neck}" fill="${C.skin}"/><path d="${P.neckShadeTop}" fill="${C.skinShade}"/><rect x="214" y="232" width="16" height="76" fill="${C.skinShade}"/>`);
    if (planes) o.push(`<path d="${P.sterno}" ${S(C.skinShade, 1.2)} opacity=".6"/><path d="${P.adam}" ${S(C.skinShade, 1.4)}/>`);
    if (ink) o.push(`<path d="M170,244 L170,306 M230,244 L230,306" ${S(C.ink)}/><path d="${P.adam}" ${S(C.ink, 0.9)}/>`);
    o.push(O('M170,244 L170,306 M230,244 L230,306'));
    o.push(`<path d="${P.collar}" fill="${C.navy}"/><path d="${P.collarTop}" ${S(C.gold, 2.2)}/>`);
    if (ink) o.push(`<path d="${P.collar}" ${S(C.inkKit)}/>`);
    o.push(O(P.collar, C.inkKit));
    o.push(`<path d="${P.face}" fill="${C.skin}"/>`);
    o.push(`<g clip-path="url(#${id}f)"><path d="${P.sideShadeR}" fill="${C.skinShade}"/>`);
    if (bad === 'soft') o.push(`<defs><radialGradient id="${id}g" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#f6d2b6"/><stop offset="0.5" stop-color="${C.skin}"/><stop offset="1" stop-color="${C.skinDeep}"/></radialGradient></defs><path d="${P.face}" fill="url(#${id}g)"/><path d="${P.cheekR}" fill="${C.skinDeep}" opacity=".7"/><path d="${M(P.cheekR)}" fill="${C.skinDeep}" opacity=".5"/><path d="${P.socketL}" fill="${C.skinDeep}" opacity=".6"/><path d="${M(P.socketL)}" fill="${C.skinDeep}" opacity=".6"/><ellipse cx="168" cy="118" rx="22" ry="10" fill="#fff" opacity=".35"/>`);
    if (bad === 'face') o.push(`<ellipse cx="160" cy="186" rx="20" ry="11" fill="#e07a7a" opacity=".55"/><ellipse cx="240" cy="186" rx="20" ry="11" fill="#e07a7a" opacity=".55"/>`);
    if (!planes) o.push(`<path d="${P.chinShade}" fill="${C.skinShade}"/>`);
    if (planes) o.push(`<path d="${P.browRidgeR}" fill="${C.skinShade}"/><path d="${P.underLip}" fill="${C.skinShade}"/><path d="${P.stubble}" fill="${C.beard}" opacity=".14"/>`);
    if (MO.cheek) o.push(`<path d="${MO.cheek}" ${S(C.skinShade, 1.6)}/><path d="${M(MO.cheek)}" ${S(C.skinShade, 1.6)}/>`);
    o.push(`</g>`);
    o.push(`<g ${FT}>`);
    if (tq) o.push(`<path d="M197,150 C191,170 186,186 178,196 C175,202 182,206 194,205 C206,206 212,202 210,196" ${S(ink || hybrid ? inkCol : C.skinShade, ink ? 1.1 : hybrid ? ow * 0.8 : 2)}/><path d="M180,198 C186,206 208,206 214,198 C208,201 186,201 180,198 Z" fill="${C.skinShade}"/>`);
    else if (ink) o.push(`<path d="${P.noseLine}" ${S(C.ink)}/><path d="${P.nostrilL}" ${S(C.ink)}/><path d="${P.nostrilR}" ${S(C.ink)}/>`);
    else o.push(`<path d="${P.noseSide}" fill="${C.skinShade}"/><path d="${P.noseUnder}" fill="${planes ? C.skinDeep : C.skinShade}"/>`);
    if (planes) o.push(`<path d="${P.nostrilL}" ${S(C.skinDeep, 1.3)}/><path d="${P.nostrilR}" ${S(C.skinDeep, 1.3)}/>`);
    if (!tq) o.push(O(P.noseLine, C.ink, 0.8), O(P.nostrilL, C.ink, 0.8), O(P.nostrilR, C.ink, 0.8));
    o.push(`<path d="${browL}" fill="${C.hairShade}"/><path d="${M(browL)}" fill="${C.hairShade}"/>`);
    const eye = (mirror) => {
      const es = bad === 'face' ? 1.5 : 1;
      const d = mirror ? M(P.eyeL) : P.eyeL, cx = mirror ? 225 : 175, clip = mirror ? `${id}eR` : `${id}eL`, top = mirror ? M(P.eyeTopL) : P.eyeTopL;
      if (bad === 'face') { o.push(`<g transform="translate(${cx},156) scale(${es}) translate(${-cx},-156)">`); }
      o.push(`<path d="${d}" fill="${C.white}"/>`);
      o.push(`<g clip-path="url(#${clip})"><circle cx="${cx}" cy="156" r="7.4" fill="${C.iris}"/><circle cx="${cx}" cy="156" r="3.3" fill="${C.pupil}"/><circle cx="${cx - 2.4}" cy="153" r="1.3" fill="#fff"/>`);
      if (!ink) o.push(`<path d="${top}" ${S(C.hairShade, 1.4)}/>`);
      o.push(`</g>`);
      if (ink) o.push(`<path d="${d}" ${S(C.ink)}/><path d="${top}" ${S(C.ink, 1.9)}/>`);
      o.push(O(d, C.ink, 0.8));
      if (planes || ink) o.push(`<path d="${mirror ? M(P.lidL) : P.lidL}" ${S(planes ? C.skinShade : C.ink, planes ? 1.5 : 0.8)}/>`);
      if (planes) o.push(`<path d="${mirror ? M(P.lowerL) : P.lowerL}" ${S(C.skinShade, 1.2)} opacity=".8"/>`);
      if (MO.lowLid && !hybrid) o.push(`<path d="${mirror ? M(MO.lowLid) : MO.lowLid}" ${S(C.skinShade, 1.6)}/>`);
      if (bad === 'face') o.push(`</g>`);
    };
    eye(false); eye(true);
    if (bad === 'face') o.push(`<path d="M176,222 C186,238 214,238 224,222 Z" fill="#3a2020"/><path d="M180,224 L220,224 L218,229 L182,229 Z" fill="#fff"/>`);
    else if (ink) o.push(`<path d="${MO.line}" ${S(C.ink, 1.3)}/><path d="${P.lipLowLine}" ${S(C.ink, 0.8)}/>`);
    else o.push(`<path d="${MO.up}" fill="#a86d5a"/><path d="${MO.low}" fill="${C.lip}"/>`);
    o.push(O(MO.line, C.ink, 0.9));
    if (planes) o.push(`<path d="${P.philtrum}" ${S(C.skinShade, 1)} opacity=".6"/>`);
    o.push(`</g>`);
    o.push(`<g ${tq ? 'transform="translate(-5,0)"' : ''}>`);
    o.push(`<path d="${P.hair}" fill="${C.hairShade}"/><path d="${P.hair}" fill="${C.hair}" transform="translate(-8,-4)" clip-path="url(#${id}h)"/>`);
    o.push(`<g clip-path="url(#${id}h)"><path d="${P.hairTop1}" ${S(C.hairHi, 2.2)}/><path d="${P.hairTop2}" ${S(C.hairHi, 1.6)}/>`);
    if (planes) o.push(`<path d="${P.hairTop3}" ${S(C.hairShade, 1.6)}/><path d="M150,132 C160,116 178,106 198,104" ${S(C.hairShade, 1.4)}/>`);
    o.push(`</g>`);
    if (ink) o.push(`<path d="${P.hair}" ${S(C.ink)}/><path d="${P.hairTop1}" ${S(C.ink, 0.7)}/>`);
    o.push(O(P.hair));
    if (helmet) o.push(helmetFront(opts.helmetStyle || 'a', S, O));
    o.push(`</g>`);
    const jawLine = 'M130,150 C130,178 136,196 146,212 L156,236 C168,250 186,254 200,254 C214,254 232,250 244,236 L254,212 C264,196 270,178 270,150';
    if (ink) o.push(`<path d="${jawLine}" ${S(C.ink)}/>`);
    o.push(O(jawLine));
    return `<svg viewBox="0 0 400 500" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto"><g data-layer="rider/${register}/front/${mood}">${o.join('')}</g></svg>`;
  }

  // Road helmet, front view, four designs. Shell covers hair to just above the brow; straps hug the jaw edge and meet under the chin.
  function helmetFront(style, S, O) {
    const strap = `<path d="M134,196 C136,214 142,228 152,240 C160,250 176,258 200,260 C224,258 240,250 248,240 C258,228 264,214 266,196" ${S(C.navy, 2.4)}/>`;
    const shell = 'M124,140 C114,88 140,24 200,22 C260,24 286,88 276,140 C264,116 240,106 200,106 C160,106 136,116 124,140 Z';
    const right = 'M200,22 C260,24 286,88 276,140 C264,116 240,106 200,106 Z';
    const brim = 'M124,140 C136,116 160,106 200,106 C240,106 264,116 276,140';
    let g = '';
    if (style === 'a') {
      g = `<path d="${shell}" fill="${C.navy}"/><path d="${right}" fill="${C.navyShade}"/>`;
      [[-40, 4], [0, 0], [40, 4]].forEach(([dx, dy]) => g += `<path d="M${200 + dx * 0.9},${96 + dy} L${200 + dx * 0.7},${48 + dy * 2}" ${S(C.chalk, 5)}/>`);
      g += `<path d="${brim}" ${S(C.chalk, 8)}/><path d="${brim}" ${S(C.gold, 2)} transform="translate(0,-6)"/>`;
    } else if (style === 'b') {
      g = `<path d="${shell}" fill="${C.navy}"/><path d="${right}" fill="${C.navyShade}"/>`;
      [-56, -30, -8, 8, 30, 56].forEach((dx) => g += `<path d="M${200 + dx * 0.95},${100 - Math.abs(dx) * 0.15} L${200 + dx * 0.8},${76 - Math.abs(dx) * 0.15}" ${S(C.chalk, 6)}/>`);
      [-36, -12, 12, 36].forEach((dx) => g += `<path d="M${200 + dx * 0.9},${64 - Math.abs(dx) * 0.1} L${200 + dx * 0.75},${40}" ${S(C.chalk, 6)}/>`);
      g += `<path d="M200,106 L200,24" ${S(C.gold, 3)}/>`;
    } else if (style === 'c') {
      g = `<path d="${shell}" fill="${C.navy}"/><path d="M124,140 C114,88 140,24 200,22 L200,106 C160,106 136,116 124,140 Z" fill="${C.chalk}"/><path d="M200,22 L200,106" ${S(C.gold, 3)}/>`;
      [[-30, 0], [30, 0]].forEach(([dx]) => g += `<path d="M${200 + dx * 0.9},96 L${200 + dx * 0.72},50" ${S(dx < 0 ? C.chalkShade : C.navyShade, 5)}/>`);
    } else {
      g = `<path d="${shell}" fill="${C.navy}"/><path d="${right}" fill="${C.navyShade}"/><path d="M124,140 C114,88 140,24 200,22 C260,24 286,88 276,140" ${S(C.gold, 2.5)}/>`;
    }
    return g + strap + O(shell, C.inkKit);
  }

  // Three-quarter bust: front-view feature paths projected onto an ellipsoid head (a=70 half-width, c=58 depth) rotated 35°.
  function portraitTQ(register, opts = {}) {
    const id = 'q' + (uid++);
    const hybrid = register === 'hybrid', ink = register === 'ink';
    const ow = Number(opts.outline || 1), helmet = !!opts.helmet, mood = opts.mood || 'neutral';
    const inkCol = opts.inkColor || C.ink;
    const S = (c, w = 1.1) => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
    const O = (d, c = inkCol, k = 1) => (hybrid || ink) ? `<path d="${d}" ${S(c, (ink ? 1.1 : ow) * k)}/>` : '';
    const th = 35 * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th), CX = 200, A = 70, D = 58;
    const proj = (x, y) => { const u = Math.max(-1, Math.min(1, (x - CX) / A)); const z = D * Math.sqrt(Math.max(0, 1 - u * u)) * (y < 100 ? 0.75 : 1); return [CX - 14 + (x - CX) * cs + z * sn, y]; };
    const R = (d) => d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (m, x, y) => { const [px, py] = proj(+x, +y); return `${px.toFixed(1)},${py}`; });
    const o = [];
    const face = 'M156,150 C154,100 172,52 210,50 C252,50 282,92 282,148 C282,178 274,198 262,214 L250,236 C240,250 224,254 212,254 C198,254 184,246 174,232 L162,210 C156,196 155,172 156,150 Z';
    const hair = 'M156,150 C150,106 166,42 210,42 C258,40 288,100 282,148 C276,126 266,108 254,102 C240,96 226,98 218,104 C208,100 192,100 180,106 C166,112 160,128 156,150 Z';
    const neck = 'M182,232 C194,236 214,238 236,232 L240,306 L186,306 Z';
    const trap = 'M186,290 C154,296 108,310 82,326 C62,340 56,380 54,500 L354,500 C352,380 346,340 326,326 C300,310 260,298 240,290 Z';
    const sleeveL = 'M128,314 C108,340 100,376 100,420 L98,500 L54,500 C56,380 62,340 82,326 C94,318 110,316 128,314 Z';
    const sleeveR = 'M272,314 C292,340 300,376 300,420 L302,500 L354,500 C352,380 346,340 326,326 C314,318 298,316 272,314 Z';
    const collar = 'M176,282 C190,300 228,300 244,284 L248,294 C230,312 188,312 170,292 Z';
    o.push(`<defs><clipPath id="${id}f"><path d="${face}"/></clipPath><clipPath id="${id}t"><path d="${trap}"/></clipPath><clipPath id="${id}h"><path d="${hair}"/></clipPath><clipPath id="${id}sR"><path d="${sleeveR}"/></clipPath></defs>`);
    o.push(`<path d="${trap}" fill="${C.navy}"/><rect x="250" y="280" width="110" height="230" fill="${C.navyShade}" clip-path="url(#${id}t)"/>`);
    o.push(`<g clip-path="url(#${id}t)"><path d="${sleeveL}" fill="${C.chalk}"/><path d="${sleeveR}" fill="${C.chalk}"/><rect x="290" y="300" width="80" height="210" fill="${C.chalkShade}" clip-path="url(#${id}sR)"/>${O(sleeveL, C.inkChalk)}${O(sleeveR, C.inkChalk)}</g>`);
    o.push(`<path d="M204,310 L204,500" ${S(C.navyShade, 1.2)}/>${O(trap, C.inkKit)}`);
    const ear = 'M280,148 C294,140 306,158 302,178 C300,192 292,202 282,202 L276,202 L276,152 Z';
    o.push(`<path d="${ear}" fill="${C.skinShade}"/>${O(ear)}${O('M290,160 C296,168 296,180 292,190', inkCol, 0.7)}`);
    o.push(`<path d="${neck}" fill="${C.skin}"/><path d="M182,232 C194,236 214,238 236,232 L237,270 C218,276 198,274 184,268 Z" fill="${C.skinShade}"/><path d="M222,236 L240,306 L222,306 Z" fill="${C.skinShade}"/>`);
    o.push(O('M184,246 L186,306 M238,246 L240,306'));
    o.push(`<path d="${collar}" fill="${C.navy}"/><path d="M176,282 C190,300 228,300 244,284" ${S(C.gold, 2.2)}/>${O(collar, C.inkKit)}`);
    o.push(`<path d="${face}" fill="${C.skin}"/>`);
    o.push(`<g clip-path="url(#${id}f)"><path d="M156,150 C154,100 172,52 210,50 C190,64 176,100 174,150 C173,186 178,214 190,242 L174,232 L162,210 C156,196 155,172 156,150 Z" fill="${C.skinShade}"/><path d="M184,240 C198,250 224,252 240,244 C226,256 200,256 184,240 Z" fill="${C.skinShade}"/></g>`);
    const eyeL = R(P.eyeL), eyeR = R(M(P.eyeL)), topL = R(P.eyeTopL), topR = R(M(P.eyeTopL));
    const [cxL] = proj(175, 156), [cxR] = proj(225, 156);
    const drawEye = (d, top, cx, r, key) => { o.push(`<path d="${d}" fill="${C.white}"/><clipPath id="${id}${key}"><path d="${d}"/></clipPath><g clip-path="url(#${id}${key})"><circle cx="${cx.toFixed(1)}" cy="156" r="${r}" fill="${C.iris}"/><circle cx="${cx.toFixed(1)}" cy="156" r="${r * 0.45}" fill="${C.pupil}"/><circle cx="${(cx - 2).toFixed(1)}" cy="153" r="1.2" fill="#fff"/><path d="${top}" ${S(C.hairShade, 1.4)}/></g>${O(d, inkCol, 0.8)}`); };
    drawEye(eyeL, topL, cxL, 6.2, 'a'); drawEye(eyeR, topR, cxR, 7.4, 'b');
    const browL = mood === 'down' ? 'M154,142 C160,132 178,128 192,138 C188,142 172,140 158,144 Z' : P.browL;
    o.push(`<path d="${R(browL)}" fill="${C.hairShade}"/><path d="${R(M(browL))}" fill="${C.hairShade}"/>`);
    const nose = R('M199,148 C196,166 192,184 186,196 C183,202 190,206 200,205 C210,206 216,202 212,196');
    o.push(`<path d="${nose} L${proj(200, 176)[0].toFixed(1)},176 Z" fill="${C.skinShade}" opacity=".5"/>${O(nose, inkCol, 0.9)}${O(R(P.nostrilR), inkCol, 0.7)}`);
    const MO = { happy: 'M172,222 C184,231 216,231 228,222', neutral: 'M176,226 C190,227.5 210,227.5 224,226', down: 'M178,229 C190,224 210,224 222,229' }[mood];
    const lipLow = { happy: 'M174,223 C184,236 216,236 226,223 C216,226 184,226 174,223 Z', neutral: P.lipLow, down: 'M180,229 C188,236 212,236 220,229 C212,230 188,230 180,229 Z' }[mood];
    o.push(`<path d="${R(lipLow)}" fill="${C.lip}"/>${O(R(MO), inkCol, 0.9)}`);
    if (mood === 'happy') o.push(`<path d="${R('M216,198 C226,210 228,220 224,226')}" ${S(C.skinShade, 1.6)}/>`);
    o.push(`<path d="${hair}" fill="${C.hairShade}"/><path d="${hair}" fill="${C.hair}" transform="translate(-8,-4)" clip-path="url(#${id}h)"/><g clip-path="url(#${id}h)"><path d="M170,78 C192,60 220,56 250,66" ${S(C.hairHi, 2.2)}/><path d="M182,68 C210,52 242,56 268,76" ${S(C.hairHi, 1.6)}/></g>${O(hair)}`);
    if (helmet) o.push(helmetTQ(opts.helmetStyle || 'a', S, O));
    o.push(O('M156,150 C155,172 156,196 162,210 L174,232 C184,246 198,254 212,254 C224,254 240,250 250,236 L262,214 C274,198 282,178 282,148'));
    return `<svg viewBox="0 0 400 500" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto"><g data-layer="rider/${register}/tq/${mood}">${o.join('')}</g></svg>`;
  }
  function helmetTQ(style, S, O) {
    const shell = 'M148,140 C138,88 162,24 216,22 C272,24 300,88 290,140 C278,116 254,106 216,106 C180,106 160,116 148,140 Z';
    return `<path d="${shell}" fill="${C.navy}"/><path d="M216,22 C272,24 300,88 290,140 C278,116 254,106 216,106 Z" fill="${C.navyShade}"/><path d="M208,106 L210,24" ${S(C.gold, 3)}/><path d="M280,198 C278,216 272,230 262,242 C252,252 236,258 214,260" ${S(C.navy, 2.4)}/>${O(shell, C.inkKit)}`;
  }

  // Same language on other assets: road helmet (side) and jersey flat (front). outline = ink weight, 0 for none.
  function asset(kind = 'helmet', outline = 1) {
    const S = (c, w) => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
    const O = (d, c) => outline ? `<path d="${d}" ${S(c, outline)}/>` : '';
    if (kind === 'helmet') {
      const shell = 'M36,140 C36,90 80,44 160,40 C240,36 300,78 306,124 C308,146 296,158 276,160 L60,160 C44,160 36,152 36,140 Z';
      const shade = 'M200,160 L276,160 C296,158 308,146 306,124 C300,100 282,82 262,72 C252,110 234,140 200,160 Z';
      const vents = ['M110,70 C126,58 146,52 166,52 L168,66 C150,66 132,72 118,82 Z', 'M186,52 C206,54 226,62 242,76 L232,88 C218,76 202,68 184,66 Z', 'M258,88 C272,100 282,116 286,132 L272,136 C268,122 260,110 248,100 Z'];
      return `<svg viewBox="0 0 340 200" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto"><g data-layer="helmet/road/side"><path d="${shell}" fill="#0e0f15"/><path d="${shade}" fill="#22253a"/>${vents.map((v) => `<path d="${v}" fill="#f4f2ec"/>`).join('')}<path d="M60,157 L276,157" ${S('#e8c547', 3)}/><path d="M72,160 C78,182 92,192 108,190" ${S('#0e0f15', 3)}/>${O(shell, '#06070b')}${vents.map((v) => O(v, '#8e8878')).join('')}</g></svg>`;
    }
    const body = 'M100,38 C120,62 180,62 200,38 L192,92 L192,222 L108,222 L108,92 Z';
    const sleeveL = 'M68,52 L100,38 L108,92 L74,102 Z', sleeveR = 'M232,52 L200,38 L192,92 L226,102 Z';
    return `<svg viewBox="0 0 300 240" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto"><g data-layer="jersey/front"><path d="${sleeveL}" fill="#f4f2ec"/><path d="${sleeveR}" fill="#f4f2ec"/><path d="M232,52 L200,38 L192,92 L226,102 Z" fill="#d9d4c6" opacity=".6"/><path d="${body}" fill="#0e0f15"/><path d="M150,56 L192,92 L192,222 L150,222 Z" fill="#22253a"/><path d="M100,38 C120,62 180,62 200,38" ${S('#e8c547', 3)}/><path d="M150,58 L150,222" ${S('#22253a', 1.5)}/>${O(body, '#06070b')}${O(sleeveL, '#8e8878')}${O(sleeveR, '#8e8878')}</g></svg>`;
  }
  class CZAsset extends HTMLElement {
    static get observedAttributes() { return ['kind', 'outline', 'width']; }
    connectedCallback() { this.render(); }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    render() { const w = this.getAttribute('width'); this.style.display = 'block'; if (w) this.style.width = w + 'px'; this.innerHTML = asset(this.getAttribute('kind') || 'helmet', Number(this.getAttribute('outline') ?? 1)); }
  }
  if (!customElements.get('cz-asset')) customElements.define('cz-asset', CZAsset);
  window.czAsset = asset;

  class CZPortrait extends HTMLElement {
    static get observedAttributes() { return ['register', 'width', 'outline', 'mood', 'view', 'helmet', 'helmet-style', 'helmetstyle', 'hstyle', 'ink-color', 'bad']; }
    connectedCallback() { this.render(); }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    render() {
      const w = this.getAttribute('width');
      this.style.display = 'block';
      if (w) { this.style.width = w + 'px'; this.style.height = (w * 1.25) + 'px'; }
      this.innerHTML = portrait(this.getAttribute('register') || 'flat', { outline: this.getAttribute('outline') || 1, mood: this.getAttribute('mood') || 'neutral', view: this.getAttribute('view') || 'front', helmet: this.hasAttribute('helmet') && this.getAttribute('helmet') !== 'off', inkColor: this.getAttribute('ink-color') || undefined, bad: this.getAttribute('bad') || '', helmetStyle: this.getAttribute('helmet-style') || this.getAttribute('helmetstyle') || this.getAttribute('hstyle') || 'a' });
    }
  }
  if (!customElements.get('cz-portrait'), CZPortrait) customElements.define('cz-portrait', CZPortrait);
  window.czPortrait = portrait;
})();
