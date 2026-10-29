# Matlogg

En liten app för att logga **energi, protein och kroppsmått**. Hela appen ligger i en enda fil
([index.html](index.html)) – ingen installation, inget byggsteg. All data sparas lokalt i
webbläsarens `localStorage` på din enhet, och kan valfritt synkas mellan enheter via ett
moln-konto (fliken **Mål → Moln-synk**).

## Köra appen

Öppna `index.html` i webbläsaren (dubbelklick), eller besök den hostade versionen (GitHub Pages).
Det fungerar offline – det enda som kräver internet är den valfria AI-uppskattningen.
Från den hostade versionen kan appen **installeras på hemskärmen** (mobil och dator):
Android/Chrome: meny → "Installera app" · iPhone/Safari: Dela → "Lägg till på hemskärmen".

## Funktioner

- **Idag** – logga måltider per måltidstyp, se dagens kcal/protein mot dina mål. Dagens måltider
  ligger direkt under lägg till-kortet.
  - **AI-uppskattning** av kcal/protein från fritext — eller från ett **foto** av maten (📷 Foto:
    AI:n föreslår beskrivning, kcal och protein). Kräver egen Anthropic API-nyckel, sparas bara lokalt.
    Fotot krymps i telefonen innan det skickas och sparas ingenstans.
  - **Snabbval** av tidigare loggade måltider, med **favoriter** (★) som alltid ligger kvar —
    stjärnmärk t.ex. restaurangrätter du ofta äter.
  - **Sök bland allt du ätit** – sökrutan i Snabbval letar i hela historiken, även bland ingredienser
    ("kvarg" hittar frukostskålen kvargen ingick i), och lägger till träffen med ett tryck.
  - **Kopiera från en annan dag** – hämta gårdagens lunch, hela gårdagen, samma dag förra veckan
    eller valfri dag med ett tryck.
  - **Bygg från skafferiet** – välj livsmedel + mängd, appen räknar ut och summerar flera ingredienser till en måltid.
  - Välj inmatningsmetod per måltid: **AI ✨ / Skafferi / Manuellt** — bara den valda metodens
    verktyg visas, så kortet hålls rent.
  - Redigera eller ta bort loggade måltider. Borttagningar och tillägg kan **ångras** direkt i
    notisen (i stället för "Är du säker?"-rutor) — fångar också ett råkat dubbeltryck på ett snabbval.
  - **Måltider i delar** – AI:n delar upp det den uppskattar ("kebab med ris" → kebab + ris) och
    delarna sparas med måltiden. **Finns en del i skafferiet räknar appen med dina värden** — AI:n
    väljer bara livsmedel och mängd (t.ex. "Ris (okokt) 70 g"), och mängden går att ändra efteråt.
    Det som inte finns i skafferiet blir en fri del med AI:ns uppskattning. När du redigerar går
    varje del att döpa om, ändra eller ta bort, och nya delar kan läggas till — skriv namnet (AI:n
    letar i skafferiet) eller välj direkt ur skafferiet. **Dela upp i separata rader** gör om en
    ihopsatt måltid till en rad per del — motsatsen till "slå ihop", och går att ångra. En äldre
    måltid utan delar kan delas upp med **Dela upp i delar**.
- **Kropp** – registrera vikt och midjemått, se grafer med glidande medel.
- **Trender** – veckoöversikt (mån–sön med dagens dag markerad) samt snitt och utveckling
  över 7 / 30 / 90 dagar, och **målträff**: hur många av de loggade dagarna protein- och energimålet
  nåtts, plus hur många dagar i rad du nått proteinmålet.
- På mobilen byter du dag genom att **svepa** vänster/höger på Idag-fliken. Snabbval- och
  kopiera-korten går att fälla ihop, och dagens totalsumma visas under måltidslistan.
  Tal kan skrivas med **komma eller punkt** (1,5 och 1.5 betyder samma sak); felskrivna tal
  ("6OO" med bokstaven O) stoppas med besked. Tema, vald inmatningsmetod, AI-modell och
  ihopfällda kort är **per enhet** och synkas inte — att ändra dem räknas inte som en ändring
  av målen, så de kan aldrig skriva över nyare mål från en annan enhet.
- **Mål** – dagliga kcal-/proteinmål och kroppsmål (mållinjer i graferna). Valfri **hyllning med
  ljud** när dagens proteinmål nås (kan slås av/på).
- **Skafferi** – eget livsmedelsbibliotek med näringsvärden per 100 g / 100 ml / styck. Förfyllt med
  vanliga baslivsmedel som du kan ändra, ta bort eller återställa.

> **Kokt vs okokt:** baslivsmedel där man portionerar på rå/torr vara (ris, pasta, potatis, kyckling)
> anges som **okokt/rå** – väg upp innan tillagning. Vissa finns även som "(kokt)" om du hellre väger efter.

## Säkerhetskopiering

Eftersom data ligger i `localStorage` (knutet till hur appen öppnas) bör du då och då
**Exportera säkerhetskopia** längst ner i appen. Backup-filen (`matlogg-backup-ÅÅÅÅ-MM-DD.json`)
kan importeras igen i vilken version som helst och slås ihop med befintliga data. På telefonen
öppnas dela-arket så att du kan spara filen i Filer/iCloud/Drive; på datorn laddas den ner.
API-nyckeln ingår **inte** i exporten. Backup-filerna är `.gitignore`:ade eftersom de innehåller personlig data.

## Tester

Appen behöver varken npm eller byggsteg – men det finns en testsvit som laddar `index.html`
i en simulerad webbläsare och trycker på appen som en användare gör:

```
npm install     # en gång, hämtar jsdom
npm test
```

Den bevakar mobilflödena där fel är **tysta** – sådant som lägger data på fel datum utan att
något kraschar, och som är svårt att provocera fram för hand: dygnsbyte medan appen ligger
fryst i bakgrunden, utkast som räddas när mobilen dödar fliken, skillnaden mellan ett tryck
och en dragning, och bakgrundssynk som ritar om mitt i en fingertryckning.

> **Den ersätter inte att prova på telefonen.** jsdom räknar ingen CSS, så inget om utseende
> eller träffytor testas. Pekgesterna är simulerade – att *logiken* svarar rätt betyder inte
> att iOS Safari skickar exakt de händelserna. Service workern och Supabase-synken är inte
> med alls.

Kör testerna innan du bumpar `APP_VERSION` / `CACHE_VERSION`.

## Framtid: köra appen på fler ställen

Idag körs appen lokalt från filen. För att kunna nå den från **flera enheter** (t.ex. mobilen) och
**installera den som app** (egen ikon på hemskärmen, eget fönster) behöver den serveras över **https**:

- **Lokalt test:** kör en enkel server i mappen, t.ex. `npx serve` eller `python -m http.server`,
  och öppna `http://localhost:...`. (localhost räknas som säkert, så installation funkar där.)
- **På nätet:** lägg filerna på en gratis statisk värd med https – t.ex. GitHub Pages, Netlify eller
  Cloudflare Pages. Då blir den installerbar var som helst.

Browsers tillåter PWA-installation bara i ett "säkert sammanhang" (https eller localhost), därför
syns ingen installationsknapp när filen öppnas direkt via `file://`.

Appen har nu en **service worker** (`sw.js`) som registreras automatiskt när den serveras över
http(s). Den cachar appfilerna så att appen fungerar helt offline och blir installerbar.
Vid ny release: bumpa `CACHE_VERSION` i `sw.js` så gamla cachade filer rensas.

⚠️ **Obs:** `localStorage` är knutet till *origin*. Data du loggat via `file://` följer inte
automatiskt med till `http://localhost` eller en webbadress. Byter du sätt att öppna appen:
exportera en säkerhetskopia först och importera den på det nya stället.

## Framtid: synk mellan enheter

En riktig **synk-knapp** (att ändringar på datorn dyker upp på mobilen automatiskt) kräver ett
**ställe att lagra datan centralt** – appen kan inte synka enbart från `localStorage`. Alternativ,
från enklast till mest "riktig" synk:

1. **Mappsynk utan server:** spara/läs backup-JSON i en redan synkad mapp (OneDrive, Dropbox,
   iCloud Drive). Ingen server behövs, men det blir manuell export/import.
2. **Hostad backend / synktjänst:** t.ex. Supabase, Firebase eller en liten egen server. Ger
   automatisk synk och inloggning, men kräver ett konto/server och lite mer kod.

Kort sagt: ja, automatisk synk behöver en server eller en molntjänst. Mappsynk är det enklaste
mellansteget om man vill slippa det.

📋 En konkret implementationsplan för Supabase-synk (tabell, RLS, auth, synkflöde, hosting) finns
i [TODO.md](TODO.md).
