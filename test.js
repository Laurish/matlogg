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
  check('kvittensen varnar att det inte är idag', /inte idag/.test(toastText(win)), toastText(win));
  win.close();
}

console.log('\n2c. Flera dygn i bakgrunden: tillbaka till idag även från en vald dag');
{
  const win = boot(seedYesterday());
  click(win, q(win, '[data-act="prev"]'));             // stod på igår när telefonen lades ifrån
  shiftClock(win, 3);
  win.dispatchEvent(new win.Event('focus'));
  const today3 = iso(new win.Date());
  click(win, q(win, '.chip[data-act="quick"]'));
  check('vyn hoppade till dagens datum', (meals(win)[today3]||[]).length === 1, Object.keys(meals(win)).join(','));
  check('inget hamnade på den gamla dagen', (meals(win)[YEST]||[]).length === 1);
  win.close();
}

console.log('\n2d. Timmar frusen över ett dygnsbyte: tillbaka till idag');
{
  const win = boot(seedYesterday());
  click(win, q(win, '[data-act="prev"]'));
  win.localStorage.setItem('matlogg.lastActive', JSON.stringify(Date.now() - 8*3600*1000));
  shiftClock(win, 1);
  win.dispatchEvent(new win.Event('pageshow'));         // appen väcks
  const tomorrow = iso(new win.Date());
  click(win, q(win, '.chip[data-act="quick"]'));
  check('vyn hoppade till dagens datum', (meals(win)[tomorrow]||[]).length === 1, Object.keys(meals(win)).join(','));
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
  check('svepet kvitterade vilken dag som visas', /Visar/.test(toastText(win)), toastText(win));
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
console.log('\n7. Utkast från en annan dag byter inte dag tyst — kortet frågar');
{
  const draft = { desc:'halvskriven middag', kcal:'', protein:'', mealType:'middag',
      builderRows:[], manualParts:[], day:YEST, at:Date.now()-60000 };
  const win = boot({ 'matlogg.draft': draft });
  const todayLabel = new win.Date(TODAY+'T12:00:00').toLocaleDateString('sv-SE',{weekday:'short',day:'numeric',month:'long'});
  check('appen öppnas på idag', dateLabel(win) === todayLabel, dateLabel(win));
  check('texten återställdes', q(win, '#m-desc').value === 'halvskriven middag');
  check('kortet frågar vilken dag måltiden hör till', !!q(win, '[data-act="draft-day"]'));
  click(win, q(win, '#m-add'));
  check('utan val hamnar måltiden på idag', (meals(win)[TODAY]||[]).length === 1 && !(meals(win)[YEST]||[]).length,
    Object.keys(meals(win)).join(','));
  check('frågan försvann när måltiden sparats', !q(win, '[data-act="draft-day"]'));
  win.close();

  const win2 = boot({ 'matlogg.draft': draft });
  click(win2, q(win2, '[data-act="draft-day"]'));      // ett tryck: logga på utkastets dag
  check('vyn bytte till utkastets dag', dateLabel(win2).indexOf(String(parseInt(YEST.split('-')[2],10))) >= 0, dateLabel(win2));
  check('texten följde med', q(win2, '#m-desc').value === 'halvskriven middag', q(win2, '#m-desc').value);
  click(win2, q(win2, '#m-add'));
  check('måltiden hamnade på utkastets dag', (meals(win2)[YEST]||[]).length === 1, Object.keys(meals(win2)).join(','));
  check('kvittensen varnar att det inte är idag', /inte idag/.test(toastText(win2)), toastText(win2));
  win2.close();
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
console.log('\n11. Komma som decimaltecken (svenskt tangentbord) accepteras');
{
  const win = boot({ 'matlogg.settings': { addMethod:'skafferi' } });
  win.document.querySelector('#b-food').value = 'f-agg';   // Ägg: 78 kcal / 6,3 g per st
  q(win, '#b-amount').value = '1,5';
  click(win, q(win, '#b-add-row'));
  check('raden med "1,5" lades till', !!q(win, '.builder-row'), toastText(win));
  click(win, q(win, '#m-add'));
  const saved = (meals(win)[TODAY]||[])[0];
  check('mängden tolkades som 1.5', saved && saved.items[0].amount === 1.5, saved && JSON.stringify(saved.items));
  check('kcal räknades ut från 1,5 st', saved && saved.kcal === 117, saved && saved.kcal);
  win.close();
}
{
  const win = boot({ 'matlogg.settings': { addMethod:'manuell' } });
  q(win, '#m-desc').value = 'Gröt';
  q(win, '#m-kcal').value = '450,7';
  q(win, '#m-protein').value = 'abc';
  click(win, q(win, '#m-add'));
  check('obegripligt tal stoppas med besked', !(meals(win)[TODAY]||[]).length && /tal/.test(toastText(win)), toastText(win));
  q(win, '#m-protein').value = '12,4';
  click(win, q(win, '#m-add'));
  const saved = (meals(win)[TODAY]||[])[0];
  check('kcal "450,7" blev 451', saved && saved.kcal === 451, saved && saved.kcal);
  check('protein "12,4" blev 12', saved && saved.protein === 12, saved && saved.protein);
  win.close();
}

console.log('\n12. Molnsynk skriver inte över enhetens egna val');
{
  const win = boot({ 'matlogg.settings': { addMethod:'manuell', theme:'dark', kcalGoal:'2000', up: 1000 } });
  const changed = win.mergeSynced({ settings: { addMethod:'ai', theme:'light', kcalGoal:'2300', up: Date.now() } });
  check('merge rapporterar ändring', changed === true);
  const s = JSON.parse(win.localStorage.getItem('matlogg.settings'));
  check('kcal-målet togs från molnet', s.kcalGoal === '2300', s.kcalGoal);
  check('inmatningsmetoden är kvar lokal', s.addMethod === 'manuell', s.addMethod);
  check('temat är kvar lokalt', s.theme === 'dark', s.theme);
  win.close();
}

console.log('\n13. Molnets enhetsval smittar inte en enhet som aldrig valt något');
{
  const win = boot({ 'matlogg.settings': { kcalGoal:'2000', up: 1000 } });
  win.mergeSynced({ settings: { addMethod:'ai', theme:'dark', collapseQuick:true, kcalGoal:'2300', up: Date.now() } });
  const s = JSON.parse(win.localStorage.getItem('matlogg.settings'));
  check('kcal-målet togs från molnet', s.kcalGoal === '2300', s.kcalGoal);
  check('inmatningsmetoden följde inte med', s.addMethod === undefined, s.addMethod);
  check('temat följde inte med', s.theme === undefined, s.theme);
  check('ihopfällt kort följde inte med', s.collapseQuick === undefined, s.collapseQuick);
  win.close();
}

console.log('\n14. Gamla sparade modellnamn byts mot dagens');
{
  const win = boot({ 'matlogg.aimodel': 'claude-haiku-4-5-20251001', 'matlogg.apikey': 'sk-ant-test' });
  check('lagrat modellnamn uppdaterades', JSON.parse(win.localStorage.getItem('matlogg.aimodel')) === 'claude-haiku-5-5',
        win.localStorage.getItem('matlogg.aimodel'));
  const sel = q(win, '#ai-model');
  check('väljaren visar den nya modellen', !!sel && sel.value === 'claude-haiku-5-5', sel && sel.value);
  win.close();
  const win2 = boot({ 'matlogg.aimodel': 'nagot-okant', 'matlogg.apikey': 'sk-ant-test' });
  check('okänt namn faller tillbaka på standardmodellen', JSON.parse(win2.localStorage.getItem('matlogg.aimodel')) === 'claude-opus-5-5');
  win2.close();
}

console.log('\n15. Kroppsmätning: tomt formulär och text i talfält säger till i stället för att tyst spara skräp');
{
  const win = boot({});
  click(win, q(win, '#tab-kropp'));
  click(win, q(win, '#b-add'));
  const bodyRows = () => JSON.parse(win.localStorage.getItem('matlogg.body') || '[]');
  check('tomt formulär sparar inget', bodyRows().length === 0);
  check('tomt formulär ger besked', /Fyll i vikt/.test(toastText(win)), toastText(win));
  q(win, '#b-weight').value = 'åttiofyra';
  click(win, q(win, '#b-add'));
  check('text i viktfältet stoppas', /Skriv ett tal/.test(toastText(win)), toastText(win));
  check('inget sparades', bodyRows().length === 0);
  q(win, '#b-weight').value = '84,5';
  click(win, q(win, '#b-add'));
  check('84,5 sparades som 84.5', bodyRows().length === 1 && bodyRows()[0].weight === 84.5, JSON.stringify(bodyRows()));
  check('kvittens efter sparad mätning', /Mätning sparad/.test(toastText(win)), toastText(win));
  win.close();
}

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
