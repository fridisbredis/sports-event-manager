# Rollback rehearsal

Syfte: öva återhämtning från en dålig migration **innan** det händer i prod, och
verifiera att `supabase/migrations/` faktiskt bygger samma schema som prod kör.
Detta är den kvarstående delen av MNT-07 ("rollback rehearsal" och "clean
database build compared against production schema") efter att forward-fix-
konventionen landade i PR #68.

**Kör mot lokal stack med syntetisk data. Aldrig mot en kopia av prod-data.**
Prod innehåller riktiga telefonnummer och omfattas av retentionsbesluten i
SEC-09/F-SEC-10 — en prod-kopia i en testmiljö är en ny personuppgifts-
behandling, inte ett gratis testverktyg. `npm run seed:dev` ger den realistiska
data som behövs, och vägrar av konstruktion att köra mot annat än dev eller
localhost.

Rytm: kör hela rutinen **före varje prod-release som innehåller en migration**,
och som helhet minst en gång före Viadal 2026.

---

## Del 1 — Clean build vs prod-schema

Verifierar att migrationssviten är den enda källan till prod-schemat, dvs att
inget har smugit in via en manuell SQL-session. Detta har hänt: migration 0032
var applicerad på prod men saknades i `schema_migrations` (hittad 2026-08-26 vid
F-REL-05).

- [ ] `supabase start` — Docker-stacken måste vara uppe; `db diff` bygger ett
      shadow-schema lokalt från `supabase/migrations` för att kunna jämföra
- [ ] `supabase db reset` — replayar alla migrationer från noll. Detta är i sig
      halva testet: failar replayen är sviten trasig oavsett vad prod säger
- [ ] Bekräfta att den går igenom utan fel, och notera sista migrationsnumret
- [ ] `supabase link --project-ref rauvaxuypujbeintnnoe` (prod)
- [ ] `supabase db diff --linked --schema public` — förväntat resultat: **tom diff**.
      Kommandot jämför shadow-schemat (byggt från migrationsfilerna) mot prods
      liveschema, vilket är precis den jämförelse MNT-07 efterfrågar
- [ ] Om diffen inte är tom: stanna. Läs den rad för rad och avgör per skillnad om
      det är (a) drift i prod från en manuell session, eller (b) en migration som
      inte gör vad den utger sig för. Båda är fynd som ska in i
      `docs/quality-requirements.md`, inte något man tystar med en ny migration.
- [ ] `supabase link --project-ref lhflutwvwvzawzbcuwup` (tillbaka till dev — lätt att glömma)

> Kör `db diff` mot prod **read-only**. Kommandot skriver ingenting, men var
> säker på att du inte råkar köra `db push` i samma terminal direkt efter.

---

## Del 2 — Rehearsal: additiv migration

Den enkla klassen. Syfte är att bekräfta att `Rollback:`-raden i headern
faktiskt fungerar som skriven.

- [ ] Välj den senaste migrationen med `Forward-fix: additive` i headern
- [ ] `supabase db reset` för ett känt utgångsläge
- [ ] `npm run seed:dev` mot den lokala stacken
- [ ] Kör den `Rollback:`-SQL som står i migrationens header, ordagrant
- [ ] Verifiera att den går igenom utan fel
- [ ] Kör appen (`npm run dev`) och bekräfta vad som går sönder — jämför med vad
      `Blast:`-raden lovade. Stämmer de inte överens är headern fel och ska rättas.
- [ ] `supabase db reset` för att städa

---

## Del 3 — Rehearsal: forward-fix under tidspress

Det här är den övning som faktiskt betyder något. Additiva rollbacks är lätta;
det svåra är att skriva en ny migration framåt medan appen är trasig.

- [ ] `supabase db reset` + `npm run seed:dev`
- [ ] Simulera en dålig migration: skriv en ny migrationsfil som medvetet gör
      något fel som appen märker — t.ex. lägg en `NOT NULL`-kolumn utan default
      på `officials`, eller byt namn på en kolumn en server action läser
- [ ] `supabase db push` mot **lokal** stack
- [ ] Bekräfta att appen faktiskt går sönder på det sätt du förväntade
- [ ] Ta tid från här. Skriv forward-fix-migrationen som återställer läget
- [ ] Notera hur lång tid det tog och vad som var svårt

Det som ska komma ut av övningen är inte en grön bock utan tre svar:

1. Hur lång tid tar det från "appen är trasig i prod" till "fixen är pushad"?
2. Vilka steg saknar dokumentation (var behövde du gissa)?
3. Går det att göra fixen utan att först ha en lokal stack uppe? Om nej — det är
   en beroendekedja värd att skriva ner innan man behöver den kl 22 en lördag.

Skriv svaren i loggen nedan. Om något steg saknade dokumentation, uppdatera
`.claude/CLAUDE.md` — det är hela poängen med övningen.

---

## Del 4 — Vad som INTE går att reversera

De sex migrationerna nedan har ingen korrekt down. Detta är fastställt (se
F-REL-05, analys 2026-08-26), inte en uppgift som väntar på någon. Om en incident
rör någon av dem är forward-fix enda vägen — och för `0009` gäller att en
naiv reverse aktivt korrumperar giltig data.

| Migration | Varför ingen down finns                                                                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0003`    | Droppar `assignments.workstation` och `.todo`. Innehållet är borta; en down ger tillbaka tomma kolumner.                                                                          |
| `0008`    | Droppar `events.category_type` efter en backfill smalare än droppen. Inget data förlorat i praktiken (F-REL-08, mätt) — men kolumnen är borta, så en down kan inte återskapa den. |
| `0009`    | Remappar `invite_status`. En reverse kan inte skilja migrationens rader från appens senare confirmations.                                                                         |
| `0012`    | Droppar `slot_index` → kastar bort vilken lane varje official står på, vilket inte kan räknas om.                                                                                 |
| `0014`    | `DELETE FROM workstations WHERE stage_id IS NULL` + FK:n cascadar nu till `assignments`. Raderna finns inte kvar.                                                                 |
| `0015`    | Äger `logos`-bucketen. En down som tar bucketen tar även varje uppladdad logo.                                                                                                    |

Två down-fällor i den reversibla delen: `0007` och `0021` släpper `NOT NULL`. En
down som återinför constraintet **failar** om NULL-rader skapats sedan dess.
Det failar synligt, vilket är bättre än tyst — men det betyder att downen inte
kan köras utan att först städa raderna.

---

## Logg

Datum, vem som körde, och vad som kom ut av del 3. Fyll på nedåt.

| Datum | Vem | Del 1 | Del 2 | Del 3: tid till fix | Vad som saknade dokumentation |
| ----- | --- | ----- | ----- | ------------------- | ----------------------------- |
|       |     |       |       |                     |                               |
