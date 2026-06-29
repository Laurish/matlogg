# Matlogg

En liten app för att logga **energi, protein och kroppsmått**. Hela appen ligger i en enda fil
([matlogg.html](matlogg.html)) – ingen installation, inget byggsteg, inget konto. All data sparas
lokalt i webbläsarens `localStorage` på din enhet.

## Köra appen

Öppna bara `matlogg.html` i webbläsaren (dubbelklick). Det fungerar offline – det enda som kräver
internet är den valfria AI-uppskattningen.

## Funktioner

- **Idag** – logga måltider per måltidstyp, se dagens kcal/protein mot dina mål.
  - **AI-uppskattning** av kcal/protein från fritext (kräver egen Anthropic API-nyckel, sparas bara lokalt).
  - **Snabbval** av tidigare loggade måltider.
  - **Bygg från skafferiet** – välj livsmedel + mängd, appen räknar ut och summerar flera ingredienser till en måltid.
  - Redigera eller ta bort loggade måltider.
- **Kropp** – registrera vikt och midjemått, se grafer med glidande medel.
- **Trender** – snitt och utveckling över 7 / 30 / 90 dagar.
- **Mål** – dagliga kcal-/proteinmål och kroppsmål (mållinjer i graferna). Valfri **hyllning med
  ljud** när dagens proteinmål nås (kan slås av/på).
- **Skafferi** – eget livsmedelsbibliotek med näringsvärden per 100 g / 100 ml / styck. Förfyllt med
  vanliga baslivsmedel som du kan ändra, ta bort eller återställa.

> **Kokt vs okokt:** baslivsmedel där man portionerar på rå/torr vara (ris, pasta, potatis, kyckling)
> anges som **okokt/rå** – väg upp innan tillagning. Vissa finns även som "(kokt)" om du hellre väger efter.

## Säkerhetskopiering

Eftersom data ligger i `localStorage` (knutet till hur appen öppnas) bör du då och då
**Exportera säkerhetskopia** längst ner i appen. Backup-filen (`matlogg-backup-ÅÅÅÅ-MM-DD.json`)
kan importeras igen i vilken version som helst och slås ihop med befintliga data. API-nyckeln ingår
**inte** i exporten. Backup-filerna är `.gitignore`:ade eftersom de innehåller personlig data.

## Framtid: köra appen på fler ställen

Idag körs appen lokalt från filen. För att kunna nå den från **flera enheter** (t.ex. mobilen) och
**installera den som app** (egen ikon på hemskärmen, eget fönster) behöver den serveras över **https**:

- **Lokalt test:** kör en enkel server i mappen, t.ex. `npx serve` eller `python -m http.server`,
  och öppna `http://localhost:...`. (localhost räknas som säkert, så installation funkar där.)
- **På nätet:** lägg filerna på en gratis statisk värd med https – t.ex. GitHub Pages, Netlify eller
  Cloudflare Pages. Då blir den installerbar var som helst.

Browsers tillåter PWA-installation bara i ett "säkert sammanhang" (https eller localhost), därför
syns ingen installationsknapp när filen öppnas direkt via `file://`.

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
