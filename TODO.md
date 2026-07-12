# Att göra i framtiden

## 0. Fynd från kodgranskning (2026-07-06) — status 2026-07-12

1. ✅ **Åtgärdat:** appfilen är omdöpt till `index.html` och `sw.js` precachar rätt filer.
2. ✅ **Åtgärdat:** sw-fetch returnerar `Response.error()` som sista utväg.
3. Kvarstår (valfritt): Fraunces laddas från Google Fonts → offline faller den tillbaka till
   Georgia. Vill man ha typsnittet offline i PWA:n: self-hosta woff2 och precacha i `sw.js`.
4. Rutin: **bumpa `CACHE_VERSION`** i `sw.js` vid varje release (nu v3), annars ser installerade
   appar gammal version tills stale-while-revalidate hinner ikapp (en extra laddning).

## 1. Supabase-synk + mobilapp (PWA)

**Mål:** logga på datorn och se det på mobilen automatiskt, och kunna installera appen på
hemskärmen. `localStorage` blir offline-cache, Supabase blir källan som synkar.

**Förutsättning / kostnad:** ryms i Supabase Free. Rekommendation: **återanvänd det befintliga
footrest-projektet** och lägg matlogg i en egen tabell → bara 1 projekt, garanterat gratis.
(Alternativt nytt projekt: footrest + matlogg = 2, ryms också i free; ett tredje kräver Pro.)

### Arkitektur: en state-rad per användare (last-write-wins)

För en personlig enanvändar-app är det enklaste och fullt tillräckligt att spara hela appens
tillstånd som ett JSON-dokument, en rad per användare. Vid konflikt vinner senaste skrivning
(`updated_at`), med den befintliga merge-logiken (se import i `matlogg.html`) som fallback för
rena tillägg.

> Uppgraderingsväg om det skaver: normalisera till separata tabeller (`meals`, `body`, `foods`,
> `settings`) med per-rad-tidsstämplar och tombstones för raderingar. Mer kod, bättre vid
> samtidiga offline-ändringar på flera enheter. Inte nödvändigt för en användare.

### Vad som INTE ska synkas

- **Anthropic API-nyckeln** (`matlogg.apikey`) stannar bara i `localStorage`. Synka aldrig upp den.

### Steg

1. **Projekt:** återanvänd footrest-projektet (lägg till tabell nedan) — undviker 2-projektsgränsen helt.
2. **Databas:** kör SQL:en nedan (tabell + Row Level Security).
3. **Auth:** aktivera Email (magic link / passwordless) i Supabase → Authentication. Lägg till
   appens URL under "Redirect URLs" (både `http://localhost:...` för test och den hostade https-URL:en).
4. **Klient:** ladda `@supabase/supabase-js` via CDN i `matlogg.html`, lägg in `SUPABASE_URL` +
   anon-nyckel (anon-nyckeln är ofarlig att bädda in **när RLS är på**).
5. **Synkmodul:** logga in/ut, `pull()`, debouncad `push()`, `merge()` (återanvänd import-logiken),
   enkel konflikthantering.
6. **UI:** liten "Synk"-sektion (t.ex. nära säkerhetskopiering): e-postfält → skicka magic link,
   inloggningsstatus, samt manuella knappar "Skicka till molnet" / "Hämta från molnet" som fallback.
7. **Hosting:** lägg de statiska filerna på GitHub Pages / Netlify / Cloudflare Pages (gratis https).
   Då blir appen även installerbar som PWA på mobilen.
8. **Behåll** export/import som offline-säkerhetskopia.

### SQL (tabell + RLS)

```sql
create table public.matlogg_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.matlogg_state enable row level security;

create policy "select egen rad" on public.matlogg_state
  for select using (auth.uid() = user_id);
create policy "insert egen rad" on public.matlogg_state
  for insert with check (auth.uid() = user_id);
create policy "update egen rad" on public.matlogg_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

`data` innehåller `{ meals, body, settings, foods, aimodel }` — samma form som dagens export
(utan `apiKey`).

### Synkflöde (skiss)

```
Vid inloggning / appstart (inloggad):
  remote = select * from matlogg_state where user_id = auth.uid()
  om remote saknas och lokalt finns data  -> push(lokalt)            (första uppladdning)
  om remote finns och lokalt tomt          -> ersätt lokalt med remote, render
  om båda finns                            -> merge(remote in i lokalt), render, push(merged)

Vid varje save() (debouncat ~1–2 s, om inloggad):
  upsert matlogg_state { user_id, data: helaTillståndet, updated_at: now() }

Konflikt:
  jämför remote.updated_at mot senast hämtade -> last-write-wins
  manuella knappar låter användaren tvinga riktning vid behov

merge():
  återanvänd reglerna från importData(): måltider per id, kroppsmätning per datum, skafferi per id
```

### Realtid (valfritt, nice-to-have)

Prenumerera på den egna raden via Supabase Realtime så att andra öppna enheter uppdateras direkt
när något ändras. Inte nödvändigt för grundsynk.

### Att tänka på

- **Origin-byte:** flytt från `file://` till hostad https-URL = nytt origin = `localStorage`
  följer inte med. Gör en export → import en gång vid övergången (synken tar sedan över).
- **Free-projekt pausas efter ~1 vecka utan aktivitet** — daglig användning håller det vaket;
  pausat projekt väcks med en knapptryckning.
- **RLS måste vara på innan anon-nyckeln bäddas in** i klienten.

**Uppskattad insats:** måttlig (auth + tabell/RLS + push/pull/merge + liten UI). Ingen ombyggnad
av befintlig logik krävs — synken läggs ovanpå nuvarande `load`/`save`.
