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

const settingsOf = win => JSON.parse(win.localStorage.getItem('matlogg.settings') || '{}');
const daysAgo = n => { const x = new Date(); x.setDate(x.getDate()-n); return iso(x); };
/* som pullMerge i appen: molnets data slås ihop med autosynken avstängd */
function syncMerge(win, state){
  win.eval('syncSuppress = true');
  try{ return win.mergeSynced(JSON.parse(JSON.stringify(state))); } finally { win.eval('syncSuppress = false'); }
}

console.log('\n16. Enhetsval på en ny enhet tömmer inte målen på de andra');
{
  const desk = boot({ 'matlogg.settings': { kcalGoal:'2100', proteinGoal:'150', targetWeight:'69', up: Date.now()-86400000 } });
  const phone = boot({});                                            // ny telefon, aldrig inloggad
  click(phone, q(phone, '[data-act="method"][data-m="manuell"]'));  // enhetens eget val före inloggningen
  syncMerge(phone, desk.collectState());                             // loggar in: hämtar molnet
  check('telefonen fick datorns mål', settingsOf(phone).kcalGoal === '2100', settingsOf(phone).kcalGoal);
  check('telefonens eget val är kvar', settingsOf(phone).addMethod === 'manuell', settingsOf(phone).addMethod);
  syncMerge(desk, phone.collectState());                             // datorn hämtar det telefonen skickade
  const ds = settingsOf(desk);
  check('datorns mål är kvar efter synken', ds.kcalGoal === '2100' && ds.proteinGoal === '150' && ds.targetWeight === '69', JSON.stringify(ds));
  click(phone, q(phone, '#tab-mal'));                                // ett riktigt målbyte ska däremot vinna
  const g = q(phone, '#g-kcal'); g.value = '2300'; g.dispatchEvent(new phone.Event('input'));
  syncMerge(desk, phone.collectState());
  check('ett ändrat mål på telefonen når datorn', settingsOf(desk).kcalGoal === '2300', settingsOf(desk).kcalGoal);
  desk.close(); phone.close();
}

console.log('\n17. AI-modellen är enhetens eget val');
{
  const desk = boot({ 'matlogg.apikey':'sk-ant-test' });
  const phone = boot({ 'matlogg.apikey':'sk-ant-test', 'matlogg.aimodel':'claude-sonnet-5-5' });
  const sel = q(desk, '#ai-model'); sel.value = 'claude-haiku-5-5'; sel.dispatchEvent(new desk.Event('change'));
  check('modellen skickas inte till molnet', !('aimodel' in desk.collectState()));
  // så skickar en äldre version, med nyare inställningar
  syncMerge(phone, { aimodel:'claude-haiku-5-5', settings:{ kcalGoal:'2000', up: Date.now() } });
  check('telefonens modell är kvar', JSON.parse(phone.localStorage.getItem('matlogg.aimodel')) === 'claude-sonnet-5-5',
    phone.localStorage.getItem('matlogg.aimodel'));
  desk.close(); phone.close();
}

console.log('\n18. Felskrivna tal stoppas överallt — även "6OO" med bokstaven O');
{
  const win = boot({ 'matlogg.settings': { addMethod:'manuell' } });
  q(win, '#m-desc').value = 'Pasta'; q(win, '#m-kcal').value = '6OO';
  click(win, q(win, '#m-add'));
  check('"6OO" sparas inte som 6 kcal', !(meals(win)[TODAY]||[]).length, JSON.stringify(meals(win)[TODAY]));
  check('besked om att skriva ett tal', /Skriv ett tal/.test(toastText(win)), toastText(win));
  q(win, '#m-kcal').value = '3OO';
  click(win, q(win, '#m-part'));
  check('"+ Del" stoppar också', win.eval('manualParts.length') === 0);
  q(win, '#m-kcal').value = '600';
  click(win, q(win, '#m-add'));
  click(win, q(win, '[data-act="edit-meal"]'));
  q(win, '#edit-kcal').value = 'abc';
  click(win, q(win, '[data-act="edit-save"]'));
  check('redigering med "abc" blir inte 0', (meals(win)[TODAY]||[])[0].kcal === 600, (meals(win)[TODAY]||[])[0].kcal);
  check('redigeringen är kvar öppen', !!q(win, '#edit-kcal'));
  check('"1 200" och "12,5" godtas fortfarande', !win.badNumber({ value:'1 200' }) && !win.badNumber({ value:'12,5' }));
  win.close();
}

console.log('\n19. Vald måltidstyp överlever en synk-omritning under redigering');
{
  const win = boot({ 'matlogg.meals': { [TODAY]: [Object.assign({}, LUNCH)] } });
  click(win, q(win, '[data-act="edit-meal"]'));
  click(win, q(win, '.pill[data-etype="middag"]'));
  win.backgroundRender();                                            // en annan enhet ändrade något
  check('middag är fortfarande vald', q(win, '.pill[data-etype="middag"]').classList.contains('active'));
  click(win, q(win, '[data-act="edit-save"]'));
  check('sparad som middag', (meals(win)[TODAY]||[])[0].type === 'middag', (meals(win)[TODAY]||[])[0].type);
  win.close();
}

console.log('\n20. "Återställ standardlistan" ger originalet även på en ny enhet');
{
  const win = boot({});
  win.confirm = () => true;
  click(win, q(win, '#tab-skafferi'));
  q(win, '#nf-name').value = 'Quinoa'; q(win, '#nf-kcal').value = '120'; q(win, '#nf-protein').value = '4';
  click(win, q(win, '#food-add'));
  click(win, q(win, '[data-act="food-reset"]'));
  const f = JSON.parse(win.localStorage.getItem('matlogg.foods'));
  check('det egna livsmedlet är borta', !f.some(x => x.name==='Quinoa'), f.map(x => x.name).join(','));
  check('standardlistan är komplett', f.length === 16, f.length);
  win.close();
}

console.log('\n21. Dagens måltider ligger direkt under lägg till-kortet');
{
  const win = boot({ 'matlogg.meals': { [TODAY]: [Object.assign({}, LUNCH)], [YEST]: [Object.assign({}, LUNCH, { id:'y1' })] } });
  const after = (a, b) => !!(a.compareDocumentPosition(b) & win.Node.DOCUMENT_POSITION_FOLLOWING);
  const add = q(win, '#m-add'), list = q(win, '[data-act="edit-meal"]'), quick = q(win, '.quick-card');
  check('listan kommer efter lägg till-knappen', after(add, list));
  check('listan kommer före snabbvalen', after(list, quick));
  win.close();
}

console.log('\n22. Ta bort och lägga till går att ångra');
{
  const win = boot({ 'matlogg.meals': { [TODAY]: [Object.assign({}, LUNCH), { id:'m2', type:'lunch', desc:'Äpple', kcal:50, protein:0, up:1 }] } });
  const undo = () => q(win, '.toast-undo');
  click(win, q(win, '[data-act="del-meal"][data-id="seed-1"]'));
  check('borttagen direkt, utan fråga', (meals(win)[TODAY]||[]).length === 1);
  check('notisen har Ångra', !!undo());
  const deletedAt = JSON.parse(win.localStorage.getItem('matlogg.tombstones')).meals['seed-1'];
  click(win, undo());
  const back = meals(win)[TODAY]||[];
  check('måltiden är tillbaka på sin plats', back.length === 2 && back[0].id === 'seed-1', back.map(e => e.id).join(','));
  syncMerge(win, { tombstones: { meals: { 'seed-1': deletedAt } } });   // raderingen hann synka till molnet före ångringen
  check('den överlever raderingen från molnet', (meals(win)[TODAY]||[]).some(e => e.id==='seed-1'));
  click(win, q(win, '.chip[data-act="quick"]'));
  click(win, q(win, '.chip[data-act="quick"]'));                    // dubbeltryck
  check('dubbeltrycket gav två nya rader', (meals(win)[TODAY]||[]).length === 4);
  click(win, undo());
  check('Ångra tog bort den senaste', (meals(win)[TODAY]||[]).length === 3);
  win.close();
}
{
  const win = boot({ 'matlogg.meals': { [TODAY]: [Object.assign({}, LUNCH), { id:'m2', type:'lunch', desc:'Äpple', kcal:50, protein:0, up:1 }] } });
  click(win, q(win, '[data-act="merge-group"]'));
  check('ihopslaget till en rad', (meals(win)[TODAY]||[]).length === 1);
  click(win, q(win, '.toast-undo'));
  const ids = (meals(win)[TODAY]||[]).map(e => e.id).join(',');
  check('Ångra ger tillbaka originalraderna', ids === 'seed-1,m2', ids);
  win.close();
}
{
  const win = boot({ 'matlogg.body': [{ id:'b1', date:YEST, weight:84, waist:null, up:1 }] });
  const rows = k => JSON.parse(win.localStorage.getItem(k) || '[]').length;
  click(win, q(win, '#tab-kropp'));
  click(win, q(win, '[data-act="del-measure"]'));
  check('mätningen borttagen utan fråga', rows('matlogg.body') === 0);
  click(win, q(win, '.toast-undo'));
  check('Ångra ger tillbaka mätningen', rows('matlogg.body') === 1);
  click(win, q(win, '#tab-skafferi'));
  click(win, q(win, '[data-act="food-del"]'));
  check('livsmedlet borttaget utan fråga', rows('matlogg.foods') === 15);
  click(win, q(win, '.toast-undo'));
  check('Ångra ger tillbaka livsmedlet', rows('matlogg.foods') === 16);
  win.close();
}

console.log('\n23. Sök bland allt du ätit och lägg till');
{
  const seed = {};
  for(let i=1; i<=15; i++) seed[daysAgo(i)] = [{ id:'r'+i, type:'lunch', desc:'Rätt '+i, kcal:400, protein:20, up:1 }];
  seed[daysAgo(40)] = [{ id:'ks', type:'frukost', desc:'Frukostskål', kcal:300, protein:30, up:1,
    items:[{ name:'Kvarg (mager)', unit:'g', kcal:60, protein:11, amount:250 }, { name:'Banan', unit:'st', kcal:105, protein:1.3, amount:1 }] }];
  seed[daysAgo(60)] = [{ id:'l1', type:'middag', desc:'Linsgryta', kcal:550, protein:28, up:1 }];
  seed[daysAgo(70)] = [{ id:'l2', type:'middag', desc:'Linsgryta', kcal:500, protein:25, up:1 }];
  const win = boot({ 'matlogg.meals': seed });
  check('Linsgryta finns inte bland snabbvalen', !Array.from(win.document.querySelectorAll('.chip')).some(c => /Linsgryta/.test(c.textContent)));
  const s = q(win, '#q-search');
  s.value = 'lins'; s.dispatchEvent(new win.Event('input'));
  const hits = Array.from(win.document.querySelectorAll('[data-act="search-add"]'));
  check('sökningen hittar den i hela historiken', hits.length === 1 && /Linsgryta/.test(hits[0].textContent), hits.map(h => h.textContent).join(' | '));
  check('träffen visar hur ofta den ätits', hits[0] && /2 gånger/.test(hits[0].textContent), hits[0] && hits[0].textContent);
  check('träffen har värdena från senaste gången', hits[0] && /550/.test(hits[0].textContent));
  s.value = 'kvarg'; s.dispatchEvent(new win.Event('input'));
  const k = q(win, '[data-act="search-add"]');
  check('en ingrediens hittar måltiden den ingår i', k && /Frukostskål/.test(k.textContent), k && k.textContent);
  click(win, k);
  const added = (meals(win)[TODAY]||[])[0];
  check('träffen lades till idag', added && added.desc === 'Frukostskål');
  check('ingredienserna följde med', added && added.items && added.items.length === 2);
  check('sökrutan tömdes efteråt', q(win, '#q-search').value === '');
  check('kvittens med Ångra', /Frukostskål/.test(toastText(win)) && !!q(win, '.toast-undo'), toastText(win));
  win.close();
}

console.log('\n24. Målträff och svit i Trender');
{
  const m = (id, protein, kcal) => [{ id:id, type:'lunch', desc:'Mat '+id, kcal:kcal, protein:protein, up:1 }];
  const win = boot({
    'matlogg.meals': { [daysAgo(1)]: m('a',120,1800), [daysAgo(2)]: m('b',130,2300), [daysAgo(3)]: m('c',90,1900), [TODAY]: m('t',40,500) },
    'matlogg.settings': { proteinGoal:'100', kcalGoal:'2000', up:1 }
  });
  click(win, q(win, '#tab-trender'));
  const txt = q(win, '#tab-content').textContent;
  check('proteinmålet: 2 av 3 avslutade dagar', /Proteinmålet nått\s*2 av 3 dagar/.test(txt), (txt.match(/Proteinmålet.{0,30}/)||[''])[0]);
  check('energimålet: 2 av 3 dagar', /Inom energimålet\s*2 av 3 dagar/.test(txt), (txt.match(/Inom energimålet.{0,30}/)||[''])[0]);
  check('svit: 2 dagar i rad', /2 dagar i rad/.test(txt), (txt.match(/.{0,20}i rad/)||[''])[0]);
  win.close();
}

console.log('\n26. En ihopsatt måltid går att dela upp i separata rader igen');
{
  const KEBAB = { id:'k1', type:'lunch', desc:'Kebab med ris', kcal:900, protein:40, up:1,
    parts:[{ desc:'Kebab', kcal:600, protein:34 }, { desc:'Ris', kcal:300, protein:6 }] };
  const FRUKT = { id:'f1', type:'frukost', desc:'Frukt', kcal:50, protein:1, up:1 };
  const win = boot({ 'matlogg.meals': { [TODAY]: [FRUKT, KEBAB] } });
  click(win, q(win, '[data-act="edit-meal"][data-id="k1"]'));
  const btn = q(win, '[data-act="edit-split-rows"]');
  check('knappen "Dela upp i 2 separata rader" visas', btn && /2 separata rader/.test(btn.textContent), btn && btn.textContent);
  const d1 = q(win, '#ep-desc-1');
  d1.value = 'Ris 1 dl'; d1.dispatchEvent(new win.Event('input'));
  const k1 = q(win, '#ep-kcal-1');
  k1.value = '150'; k1.dispatchEvent(new win.Event('input'));
  click(win, btn);
  let m = meals(win)[TODAY];
  check('två rader i stället för en', m.length === 3 && m[1].desc === 'Kebab' && m[2].desc === 'Ris 1 dl', JSON.stringify(m.map(e => e.desc)));
  check('ändringen före uppdelningen följde med', m[2].kcal === 150 && m[1].kcal === 600 && m[2].type === 'lunch');
  check('raderna är vanliga rader utan delar', !m[1].parts && !m[2].parts);
  check('originalet ligger i raderingsloggen', !!JSON.parse(win.localStorage.getItem('matlogg.tombstones')).meals.k1);
  click(win, q(win, '.toast-undo'));
  m = meals(win)[TODAY];
  check('Ångra ger tillbaka den hela måltiden på samma plats', m.length === 2 && m[1].id === 'k1' && m[1].parts.length === 2, JSON.stringify(m.map(e => e.id)));
  check('de uppdelade raderna raderas vid ångra', !JSON.parse(win.localStorage.getItem('matlogg.tombstones')).meals.k1);
  win.close();
}
{
  const SKAL = { id:'s1', type:'frukost', desc:'Frukostskål', kcal:255, protein:29, up:1,
    items:[{ name:'Kvarg (mager)', unit:'g', kcal:60, protein:11, amount:250 }, { name:'Banan', unit:'st', kcal:105, protein:1.3, amount:1 }] };
  const win = boot({ 'matlogg.meals': { [TODAY]: [SKAL] } });
  click(win, q(win, '[data-act="edit-meal"]'));
  click(win, q(win, '[data-act="edit-split-rows"]'));
  const m = meals(win)[TODAY];
  check('skafferimåltiden blir en rad per ingrediens', m.length === 2 && /Kvarg/.test(m[0].desc) && /Banan/.test(m[1].desc), JSON.stringify(m.map(e => e.desc)));
  check('varje rad behåller sin ingrediens (mängden går att ändra)', m[0].items && m[0].items.length === 1 && m[0].kcal === 150);
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

  console.log('\n25. Foto av maten fyller i beskrivning, kcal och protein');
  {
    const win = boot({ 'matlogg.apikey':'sk-ant-test', 'matlogg.settings': { addMethod:'ai' } });
    let sent = null;
    const answer = obj => async (url, opts) => { sent = JSON.parse(opts.body); return { ok:true, json: async () => obj }; };
    win.imageToJpegBase64 = async () => 'QUJD';   // jsdom har ingen canvas — själva krympningen provas på telefonen
    win.fetch = answer({ stop_reason:'end_turn', content:[{ type:'text', text:'{"desc":"Lax med potatis","kcal":620,"protein":42}' }] });
    check('fotoknappen finns i AI-läget', !!q(win, '#ai-photo'));
    await win.runPhotoEstimate({ name:'mat.jpg' });
    const img = sent && sent.messages[0].content.find(c => c.type==='image');
    check('bilden skickades som jpeg', !!img && img.source.media_type==='image/jpeg' && img.source.data==='QUJD');
    check('beskrivningen fylldes i', q(win, '#m-desc').value === 'Lax med potatis', q(win, '#m-desc').value);
    check('kcal och protein fylldes i', q(win, '#m-kcal').value === '620' && q(win, '#m-protein').value === '42');
    q(win, '#m-desc').value = 'lax, potatis och sås';
    await win.runPhotoEstimate({ name:'mat.jpg' });
    check('egen beskrivning skrivs inte över', q(win, '#m-desc').value === 'lax, potatis och sås');
    check('egen beskrivning skickas med som ledtråd', /lax, potatis och sås/.test(sent.messages[0].content.find(c => c.type==='text').text));
    // textuppskattningen går genom samma kod efter omskrivningen
    q(win, '#m-desc').value = '2 ägg';
    win.fetch = answer({ stop_reason:'end_turn', content:[{ type:'text', text:'{"kcal":156,"protein":13}' }] });
    await win.runEstimate();
    check('textuppskattningen fungerar som förut', q(win, '#m-kcal').value === '156' && typeof sent.messages[0].content === 'string');
    win.fetch = answer({ stop_reason:'refusal', content:[] });
    await win.runEstimate();
    check('en vägran ger begripligt besked', /ville inte/.test(q(win, '#ai-status').textContent), q(win, '#ai-status').textContent);
    win.close();
  }

  const aiAnswer = obj => async () => ({ ok:true, json: async () => ({ stop_reason:'end_turn', content:[{ type:'text', text: JSON.stringify(obj) }] }) });
  const setVal = (win, s, v) => { const el = q(win, s); el.value = v; el.dispatchEvent(new win.Event('input')); };

  console.log('\n27. Delar går att byta namn på och lägga till när man redigerar (utan AI)');
  {
    const win = boot({ 'matlogg.meals': { [TODAY]: [{ id:'p1', type:'lunch', desc:'Kebab med ris', kcal:900, protein:40, up:1 }] } });
    click(win, q(win, '[data-act="edit-meal"]'));
    check('en vanlig måltid har knappen "Dela upp i delar"', !!q(win, '[data-act="edit-to-parts"]'));
    await win.editToParts();
    check('utan AI blir hela måltiden första delen', q(win, '#ep-desc-0') && q(win, '#ep-desc-0').value === 'Kebab med ris' && q(win, '#ep-kcal-0').value === '900');
    setVal(win, '#ep-desc-0', 'Kebab'); setVal(win, '#ep-kcal-0', '600'); setVal(win, '#ep-protein-0', '34');
    q(win, '#ep-new-desc').value = 'Ris';
    click(win, q(win, '[data-act="edit-save"]'));
    check('en halvskriven ny del stoppar Spara', /Tryck \+/.test(toastText(win)) && !meals(win)[TODAY][0].parts, toastText(win));
    q(win, '#ep-new-kcal').value = '300'; q(win, '#ep-new-protein').value = '6';
    await win.addEditPart();
    check('den nya delen lades till', q(win, '#ep-desc-1') && q(win, '#ep-desc-1').value === 'Ris');
    check('summan räknas om', /900 kcal/.test(q(win, '#ei-sum').textContent), q(win, '#ei-sum').textContent);
    click(win, q(win, '[data-act="edit-save"]'));
    const e = meals(win)[TODAY][0];
    check('sparad med två delar och eget namn kvar', e.parts && e.parts.length === 2 && e.desc === 'Kebab med ris' && e.kcal === 900 && e.protein === 40, JSON.stringify(e));
    win.close();
  }

  console.log('\n28. AI:n delar upp maten när man lägger till — delarna sparas med');
  {
    const win = boot({ 'matlogg.apikey':'sk-ant-test', 'matlogg.settings': { addMethod:'ai' } });
    win.fetch = aiAnswer({ kcal:900, protein:40, parts:[{ desc:'Kebab', kcal:600, protein:34 }, { desc:'Ris, 2 dl kokt', kcal:310, protein:6 }] });
    q(win, '#m-desc').value = 'kebab med ris';
    await win.runEstimate();
    check('totalen blir delarnas summa', q(win, '#m-kcal').value === '910' && q(win, '#m-protein').value === '40', q(win, '#m-kcal').value);
    check('statusraden visar delarna', /Kebab 600 kcal · Ris, 2 dl kokt 310 kcal/.test(q(win, '#ai-status').textContent), q(win, '#ai-status').textContent);
    click(win, q(win, '#m-add'));
    let e = meals(win)[TODAY][0];
    check('måltiden sparades med delar', e.parts && e.parts.length === 2 && e.desc === 'kebab med ris' && e.kcal === 910, JSON.stringify(e));

    // justerad total: delarna skalas så att de fortfarande summerar rätt
    q(win, '#m-desc').value = 'kebab med ris';
    await win.runEstimate();
    q(win, '#m-kcal').value = '819';
    click(win, q(win, '#m-add'));
    e = meals(win)[TODAY][1];
    check('justerad total: delarna skalas om', e.parts && e.parts[0].kcal + e.parts[1].kcal === 819 && e.kcal === 819 && e.parts[0].kcal === 540, JSON.stringify(e.parts));

    // ändrad beskrivning efter uppskattningen: delarna stämmer inte längre
    q(win, '#m-desc').value = 'kebab med ris';
    await win.runEstimate();
    q(win, '#m-desc').value = 'kebab med pommes';
    click(win, q(win, '#m-add'));
    e = meals(win)[TODAY][2];
    check('ändrad beskrivning: inga gamla delar följer med', !e.parts, JSON.stringify(e));

    // "+ Del" med en uppdelad uppskattning ger två delar, inte en klump
    q(win, '#m-desc').value = 'kebab med ris';
    await win.runEstimate();
    click(win, q(win, '#m-part'));
    check('"+ Del" lägger in AI:ns delar var för sig', win.eval('manualParts.length') === 2, win.eval('JSON.stringify(manualParts)'));

    // en enda sak blir ingen uppdelning
    win.eval('manualParts = []; render()');
    win.fetch = aiAnswer({ kcal:156, protein:13, parts:[{ desc:'2 ägg', kcal:156, protein:13 }] });
    q(win, '#m-desc').value = '2 ägg';
    await win.runEstimate();
    click(win, q(win, '#m-add'));
    e = meals(win)[TODAY][3];
    check('en sak: inga delar', e.desc === '2 ägg' && !e.parts, JSON.stringify(e));
    win.close();
  }

  console.log('\n29. Dela upp en redan loggad måltid med AI');
  {
    const win = boot({ 'matlogg.apikey':'sk-ant-test', 'matlogg.meals': { [TODAY]: [{ id:'p1', type:'lunch', desc:'Kebab med ris', kcal:900, protein:40, up:1 }] } });
    let sent = null;
    win.fetch = async (url, opts) => { sent = JSON.parse(opts.body);
      return aiAnswer({ parts:[{ desc:'Kebab', kcal:620, protein:35 }, { desc:'Ris', kcal:300, protein:6 }] })(); };
    click(win, q(win, '[data-act="edit-meal"]'));
    await win.editToParts();
    check('AI:n fick måltidens total', sent && /900 kcal och 40 g protein/.test(sent.messages[0].content));
    const kc = [q(win, '#ep-kcal-0').value, q(win, '#ep-kcal-1').value].map(Number), pr = [q(win, '#ep-protein-0').value, q(win, '#ep-protein-1').value].map(Number);
    check('delarna summerar till den loggade totalen', kc[0]+kc[1] === 900 && pr[0]+pr[1] === 40, kc+' / '+pr);
    check('beskrivningen står kvar', q(win, '#edit-desc').value === 'Kebab med ris');
    // ny del där AI:n uppskattar kcal och protein
    win.fetch = aiAnswer({ kcal:120, protein:1 });
    q(win, '#ep-new-desc').value = 'vitlökssås';
    await win.addEditPart();
    check('ny del med tomma värden uppskattas av AI:n', q(win, '#ep-desc-2') && q(win, '#ep-kcal-2').value === '120');
    click(win, q(win, '[data-act="edit-split-rows"]'));
    const m = meals(win)[TODAY];
    check('och sedan delas upp i tre rader', m.length === 3 && m[2].desc === 'vitlökssås' && m.reduce((a, e) => a+e.kcal, 0) === 1020, JSON.stringify(m.map(e => e.desc+' '+e.kcal)));
    win.close();
  }

  console.log('\n' + (fail ? '✗ '+fail+' fel' : '✓ allt gick igenom') + '  ('+pass+' kontroller)');
  process.exit(fail ? 1 : 0);
})();
