/* Testsvit för Matlogg — körs med `npm test`.
   Laddar den riktiga index.html i en simulerad webbläsare (jsdom) och trycker på appen
   som en användare gör. Fokus ligger på mobilflödena: rätt dag, tryck kontra dragning,
   och de fall där appen tidigare gjorde ingenting utan att säga till.

   Täcker INTE: utseende/layout (jsdom räknar ingen CSS), riktiga pekgester på iOS/Android,
   service workern, eller Supabase-synken (biblioteket kopplas bort här). Prova alltid på
   telefonen också — se avsnittet "Tester" i README. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP = path.join(__dirname, 'index.html');
// synk-biblioteket kopplas bort: testerna gäller appens egen logik, inte molnet
const RAW = fs.readFileSync(APP, 'utf8').replace('<script src="supabase.min.js"></script>', '');

function iso(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
const TODAY = iso(new Date());
const YEST  = (function(){ const d=new Date(); d.setDate(d.getDate()-1); return iso(d); })();

/* Startar en färsk app med valfritt förifyllt localStorage. */
function boot(seed){
  const dom = new JSDOM(RAW, {
    url: 'https://example.test/matlogg/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win){
      Object.keys(seed||{}).forEach(function(k){ win.localStorage.setItem(k, JSON.stringify(seed[k])); });
    }
  });
  return dom.window;
}

/* Flyttar appens klocka framåt N dygn — appen slår upp Date globalt, så det räcker att byta den. */
function shiftClock(win, days){
  const Real = win.__RealDate || win.Date;
  win.__RealDate = Real;
  const off = days*24*3600*1000;
  class FakeDate extends Real {
    constructor(...a){ if(a.length===0) super(Real.now()+off); else super(...a); }
    static now(){ return Real.now()+off; }
  }
  win.Date = FakeDate;
}

const meals      = win => JSON.parse(win.localStorage.getItem('matlogg.meals') || '{}');
const dateLabel  = win => win.document.querySelector('.datelabel').textContent;
const toastText  = win => { const t = win.document.getElementById('toast'); return t ? t.textContent : ''; };
const q          = (win, s) => win.document.querySelector(s);

function touch(win, el, type, x, y){
  const ev = new win.Event(type, { bubbles:true });
  const list = [{ clientX:x, clientY:y }];
  ev.touches = type==='touchend' ? [] : list;
  ev.changedTouches = list;
  el.dispatchEvent(ev);
}
function click(win, el){ el.dispatchEvent(new win.MouseEvent('click', { bubbles:true })); }
/* dragning: webbläsaren skickar ett klick även efteråt — det är det appen måste sortera bort */
function drag(win, el, x0, y0, x1, y1){
  touch(win, el, 'touchstart', x0, y0);
  touch(win, el, 'touchend', x1, y1);
  click(win, el);
}
/* riktigt tryck: ner, upp på nästan samma ställe, sedan klicket */
function tap(win, el, x, y){
  x = x||60; y = y||300;
  touch(win, el, 'touchstart', x, y);
  touch(win, el, 'touchend', x+2, y+3);
  click(win, el);
}

const LUNCH = { id:'seed-1', type:'lunch', desc:'Kycklingsallad', kcal:500, protein:40, up:1 };
const seedYesterday = () => ({ 'matlogg.meals': { [YEST]: [LUNCH] } });

let pass = 0, fail = 0;
function check(name, cond, extra){
  if(cond){ pass++; console.log('  ok   '+name); }
  else { fail++; console.log('  FEL  '+name+(extra?'  → '+extra:'')); }
}

/* ---------------------------------------------------------------- */
console.log('\n1. Kopiera från annan dag hamnar på den visade dagen');
{
  const win = boot(seedYesterday());
  const row = q(win, '.copy-row');
  check('kopieringskortet visas', !!row);
  click(win, row);
  const m = meals(win);
  check('måltiden hamnade på idag', (m[TODAY]||[]).length === 1, JSON.stringify(Object.keys(m)));
  check('originalet ligger kvar på igår', (m[YEST]||[]).length === 1);
  check('kvittensen nämner dagen', /idag/.test(toastText(win)), toastText(win));
  win.close();
}

/* ---------------------------------------------------------------- */
console.log('\n2. Dygnsbyte medan appen ligger i bakgrunden');
{
  const win = boot(seedYesterday());
  const before = dateLabel(win);
  shiftClock(win, 1);                                  // klockan passerar midnatt
  win.dispatchEvent(new win.Event('focus'));
  const after = dateLabel(win);
  check('datumrubriken följde med till nya dygnet', before !== after, before+' → '+after);

  const tomorrow = iso(new win.Date());
  click(win, q(win, '.chip[data-act="quick"]'));       // snabbval gäller alltid visad dag
  check('måltiden hamnade på det NYA dygnet', (meals(win)[tomorrow]||[]).length === 1,
    'nycklar: '+Object.keys(meals(win)).join(','));
  check('inget hamnade på gårdagen', (meals(win)[TODAY]||[]).length === 0);
  win.close();
}

console.log('\n2b. Dygnsbyte när användaren medvetet står på en annan dag');
{
  const win = boot(seedYesterday());
  click(win, q(win, '[data-act="prev"]'));             // gå bakåt till igår
  shiftClock(win, 1);
  win.dispatchEvent(new win.Event('focus'));
  click(win, q(win, '.chip[data-act="quick"]'));
  const keys = Object.keys(meals(win));
  check('vald dag flyttades inte under användaren', !keys.includes(iso(new win.Date())), keys.join(','));
  check('måltiden hamnade på den valda dagen', (meals(win)[YEST]||[]).length === 2, keys.join(','));
  win.close();
}

/* ---------------------------------------------------------------- */
console.log('\n3. Dragning över en rad ska inte utlösa raden');
{
  const win = boot(seedYesterday());
  drag(win, q(win, '.copy-row'), 60, 300, 200, 312);   // tydligt svep åt höger
  check('ingen måltid kopierades av misstag', !(meals(win)[TODAY]||[]).length,
    JSON.stringify(meals(win)[TODAY]||[]));
  check('svepet bytte dag istället', dateLabel(win).length > 0);
  win.close();
}
{
  const win = boot(seedYesterday());
  const label = dateLabel(win);
  drag(win, q(win, '.copy-row'), 60, 300, 95, 340);    // halvdragning: för kort för svep
  check('kort dragning kopierar inget', !(meals(win)[TODAY]||[]).length);
  check('kort dragning byter inte dag', dateLabel(win) === label);
  win.close();
}

console.log('\n4. Vanligt tryck fungerar fortfarande');
{
  const win = boot(seedYesterday());
  tap(win, q(win, '.copy-row'));
  check('trycket kopierade måltiden', (meals(win)[TODAY]||[]).length === 1);
  win.close();
}

console.log('\n4b. Lodrät scroll över en rad utlöser den inte');
{
  const win = boot(seedYesterday());
  const label = dateLabel(win);
  drag(win, q(win, '.copy-row'), 60, 400, 66, 180);
  check('scroll kopierar inget', !(meals(win)[TODAY]||[]).length);
  check('scroll byter inte dag', dateLabel(win) === label);
  win.close();
}

console.log('\n4c. Ett tryck DIREKT efter en scroll ska gå fram');
{
  // regressionsskydd: ett tidsbaserat klickskydd gjorde tryck strax efter en scroll döda
  const win = boot(seedYesterday());
  drag(win, q(win, '.copy-row'), 60, 400, 66, 180);
  tap(win, q(win, '.copy-row'));
  check('trycket efter scrollen registrerades', (meals(win)[TODAY]||[]).length === 1,
    JSON.stringify(meals(win)[TODAY]||[]));
  win.close();
}

/* ---------------------------------------------------------------- */
console.log('\n5. "Lägg till måltid" utan beskrivning säger till');
{
  const win = boot({});
  q(win, '#m-kcal').value = '450';
  click(win, q(win, '#m-add'));
  check('inget sparades', Object.keys(meals(win)).length === 0);
  check('användaren fick besked', /Skriv vad du åt/.test(toastText(win)), toastText(win));

  q(win, '#m-desc').value = 'Gröt';
  click(win, q(win, '#m-add'));
  check('med beskrivning sparas den', (meals(win)[TODAY]||[]).length === 1);
  check('kvittens visar måltidstyp och dag', /idag/.test(toastText(win)), toastText(win));
  win.close();
}

/* ---------------------------------------------------------------- */
console.log('\n6. Skafferibyggaren behåller skriven text');
{
  const win = boot({ 'matlogg.settings': { addMethod:'skafferi' } });
  q(win, '#m-desc').value = 'Frukost med gröt';
  q(win, '#b-amount').value = '80';
  click(win, q(win, '#b-add-row'));
  check('raden lades till', !!q(win, '.builder-row'));
  check('beskrivningen finns kvar', q(win, '#m-desc').value === 'Frukost med gröt', q(win, '#m-desc').value);
  check('mängdfältet tömdes', q(win, '#b-amount').value === '');

  q(win, '#b-amount').value = '2';
  click(win, q(win, '#b-add-row'));
  click(win, q(win, '#m-add'));
  const saved = (meals(win)[TODAY]||[])[0];
  check('måltiden sparades med två ingredienser', saved && saved.items && saved.items.length === 2);
  check('den skrivna beskrivningen användes', saved && saved.desc === 'Frukost med gröt', saved && saved.desc);
  win.close();
}

console.log('\n6b. Knappen gör det som syns på skärmen');
{
  const win = boot({ 'matlogg.settings': { addMethod:'skafferi' } });
  q(win, '#b-amount').value = '80';
  click(win, q(win, '#b-add-row'));
  click(win, q(win, '[data-act="method"][data-m="manuell"]'));
  q(win, '#m-desc').value = 'Pizza';
  q(win, '#m-kcal').value = '900';
  click(win, q(win, '#m-add'));
  const saved = (meals(win)[TODAY]||[])[0];
  check('den skrivna måltiden sparades, inte den dolda skafferiraden', saved && saved.desc === 'Pizza',
    saved && saved.desc);
  win.close();
}

console.log('\n6c. Metodbyte tappar inte det du redan skrivit');
{
  const win = boot({ 'matlogg.settings': { addMethod:'manuell' } });
  q(win, '#m-desc').value = 'Två ägg och rågbröd';
  q(win, '#m-kcal').value = '320';
  q(win, '#m-protein').value = '18';

  click(win, q(win, '[data-act="method"][data-m="ai"]'));
  check('beskrivningen finns kvar i AI-läget', q(win, '#m-desc').value === 'Två ägg och rågbröd', q(win, '#m-desc').value);
  check('kcal finns kvar i AI-läget', q(win, '#m-kcal').value === '320', q(win, '#m-kcal').value);

  // skafferiläget saknar kcal/protein helt — värdena måste bäras med tills vi är tillbaka
  click(win, q(win, '[data-act="method"][data-m="skafferi"]'));
  check('beskrivningen finns kvar i skafferiläget', q(win, '#m-desc').value === 'Två ägg och rågbröd', q(win, '#m-desc').value);
  check('kcal-fältet finns inte i skafferiläget', !q(win, '#m-kcal'));

  click(win, q(win, '[data-act="method"][data-m="manuell"]'));
  check('beskrivningen överlevde hela vändan', q(win, '#m-desc').value === 'Två ägg och rågbröd', q(win, '#m-desc').value);
  check('kcal kom tillbaka', q(win, '#m-kcal').value === '320', q(win, '#m-kcal').value);
  check('protein kom tillbaka', q(win, '#m-protein').value === '18', q(win, '#m-protein').value);

  // efter en sparad måltid ska inget gammalt dyka upp igen vid nästa byte
  click(win, q(win, '#m-add'));
  click(win, q(win, '[data-act="method"][data-m="ai"]'));
  check('fälten är tomma efter att måltiden sparats', q(win, '#m-desc').value === '' && q(win, '#m-kcal').value === '',
    q(win, '#m-desc').value+' / '+q(win, '#m-kcal').value);
  win.close();
}

/* ---------------------------------------------------------------- */
console.log('\n7. Utkast minns vilken dag det hörde till');
{
  const win = boot({
    'matlogg.draft': { desc:'halvskriven middag', kcal:'', protein:'', mealType:'middag',
      builderRows:[], manualParts:[], day:YEST, at:Date.now()-60000 }
  });
  check('appen öppnas på utkastets dag',
    dateLabel(win).indexOf(String(parseInt(YEST.split('-')[2],10))) >= 0, dateLabel(win));
  check('texten återställdes', q(win, '#m-desc').value === 'halvskriven middag');
  click(win, q(win, '#m-add'));
  check('måltiden hamnade på utkastets dag', (meals(win)[YEST]||[]).length === 1,
    Object.keys(meals(win)).join(','));
  win.close();
}

console.log('\n7b. Gammalt utkast återanvänds inte');
{
  const win = boot({
    'matlogg.draft': { desc:'gammalt', kcal:'', protein:'', mealType:'lunch',
      builderRows:[], manualParts:[], day:YEST, at:Date.now()-20*3600*1000 }
  });
  check('gammalt utkast slängdes', !win.localStorage.getItem('matlogg.draft'));
  check('fältet är tomt', q(win, '#m-desc').value === '');
  check('appen står på idag', !q(win, '[data-act="today"]'));
  win.close();
}

/* ---------------------------------------------------------------- */
console.log('\n8. Snabbval kvitterar och hamnar rätt');
{
  const win = boot(seedYesterday());
  const chip = q(win, '.chip[data-act="quick"]');
  check('snabbvalschip finns', !!chip);
  click(win, chip);
  check('lades till på idag', (meals(win)[TODAY]||[]).length === 1);
  check('kvittens visas', /Kycklingsallad/.test(toastText(win)), toastText(win));
  win.close();
}

/* ---------------------------------------------------------------- */
console.log('\n9. Svep avbryter inte en pågående redigering');
{
  const win = boot({ 'matlogg.meals': { [TODAY]: [Object.assign({}, LUNCH)] } });
  click(win, q(win, '[data-act="edit-meal"]'));
  check('redigeringsläge öppnat', !!q(win, '#edit-desc'));
  const content = q(win, '#tab-content');
  touch(win, content, 'touchstart', 60, 300);
  touch(win, content, 'touchend', 260, 305);
  check('svep under redigering byter inte dag', !!q(win, '#edit-desc'));
  q(win, '#edit-kcal').value = '600';
  tap(win, q(win, '[data-act="edit-save"]'));
  check('redigeringen sparades', (meals(win)[TODAY]||[])[0].kcal === 600);
  win.close();
}

/* ---------------------------------------------------------------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function(){
  console.log('\n10. Bakgrundssynk ritar inte om mitt i en tryckning');
  {
    const win = boot(seedYesterday());
    const row = q(win, '.copy-row');
    check('backgroundRender finns', typeof win.backgroundRender === 'function');

    win.backgroundRender();                       // utan pågående tryck: rita om direkt
    check('utan tryck ritas det om direkt', !row.isConnected);

    const row2 = q(win, '.copy-row');
    touch(win, row2, 'touchstart', 60, 300);      // fingret nere
    win.backgroundRender();                       // synken vill rita om just nu
    check('omritningen sköts upp medan fingret är nere', row2.isConnected);

    touch(win, row2, 'touchend', 62, 302);
    click(win, row2);
    check('trycket tappades inte bort', (meals(win)[TODAY]||[]).length === 1,
      JSON.stringify(meals(win)[TODAY]||[]));

    await sleep(400);
    check('den uppskjutna omritningen kom sedan', !row2.isConnected);
    win.close();
  }

  console.log('\n' + (fail ? '✗ '+fail+' fel' : '✓ allt gick igenom') + '  ('+pass+' kontroller)');
  process.exit(fail ? 1 : 0);
})();
