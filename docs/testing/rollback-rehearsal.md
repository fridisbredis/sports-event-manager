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

- [ ] `cat supabase/.temp/project-ref` — **kolla vad CLI:n är länkad mot innan
      något annat.** Den ligger kvar från förra sessionen och kan vara prod
      (så var den 2026-08-26). Ett `db push` i det läget går mot prod.
- [ ] `supabase start` — Docker-stacken måste vara uppe; `db diff` bygger ett
      shadow-schema lokalt från `supabase/migrations` för att kunna jämföra
- [ ] `supabase db reset` — replayar alla migrationer från noll. Detta är i sig
      halva testet: failar replayen är sviten trasig oavsett vad prod säger
- [ ] Bekräfta att den går igenom utan fel, och notera sista migrationsnumret
- [ ] `supabase link --project-ref rauvaxuypujbeintnnoe` (prod)
- [ ] `supabase db diff --linked --schema public` — förväntat resultat: **tom diff**.
      Kommandot jämför shadow-schemat (byggt från migrationsfilerna) mot prods
      liveschema, vilket är precis den jämförelse MNT-07 efterfrågar
- [ ] **Filtrera bort grants innan du läser diffen.** Supabase sätter default-
      grants för `anon`/`authenticated`/`service_role` som migrationsfilerna
      aldrig deklarerar — 164 rader brus vid körningen 2026-08-26. De riktiga
      fynden drunknar annars. Diffen kommer som JSON på sista raden:
      `supabase db diff --linked --schema public 2>/dev/null | tail -1 \`
      `| python3 -c "import json,sys; d=json.load(sys.stdin)['diff'];`
      `print(chr(10).join(s.strip() for s in d.split(';') if s.strip() and not s.strip().startswith('grant ')))"`
- [ ] Om det som återstår inte är tomt: stanna. Läs rad för rad och avgör per
      skillnad om det är (a) drift i prod från en manuell session, (b) en migration
      som inte gör vad den utger sig för, eller (c) ren textnormalisering av en
      funktionskropp (Postgres skriver om dem — jämför signatur, security
      definer och search_path istället för att diffa texten). (a) och (b) är
      fynd som ska in i `docs/quality-requirements.md`, inte något man tystar
      med en ny migration.
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

| Migration | Varför ingen down finns                                                                                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0003`    | Droppar `assignments.workstation` och `.todo`. Innehållet är borta; en down ger tillbaka tomma kolumner.                                                                                                                                       |
| `0008`    | Droppar `events.category_type` efter en backfill smalare än droppen — men droppen tog aldrig effekt: kolumnen finns kvar i både dev och prod (F-REL-09). Inget data förlorat (F-REL-08). Skulle droppen köras skarpt är den ändå irreversibel. |
| `0009`    | Remappar `invite_status`. En reverse kan inte skilja migrationens rader från appens senare confirmations.                                                                                                                                      |
| `0012`    | Droppar `slot_index` → kastar bort vilken lane varje official står på, vilket inte kan räknas om.                                                                                                                                              |
| `0014`    | `DELETE FROM workstations WHERE stage_id IS NULL` + FK:n cascadar nu till `assignments`. Raderna finns inte kvar.                                                                                                                              |
| `0015`    | Äger `logos`-bucketen. En down som tar bucketen tar även varje uppladdad logo.                                                                                                                                                                 |

Två down-fällor i den reversibla delen: `0007` och `0021` släpper `NOT NULL`. En
down som återinför constraintet **failar** om NULL-rader skapats sedan dess.
Det failar synligt, vilket är bättre än tyst — men det betyder att downen inte
kan köras utan att först städa raderna.

---

## Logg

Datum, vem som körde, och vad som kom ut av del 3. Fyll på nedåt.

| Datum      | Vem   | Del 1                      | Del 2      | Del 3: tid till fix | Vad som saknade dokumentation                                                                                     |
| ---------- | ----- | -------------------------- | ---------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 2026-08-26 | Frida | **FAIL** — se fynden nedan | ej körd än | ej körd än          | CLI:n låg kvar länkad mot prod från förra sessionen. Rutinen bör börja med att verifiera länkning, inte anta dev. |

### Körning 2026-08-26 — Del 1 resultat

`db reset` **PASS**: alla 32 migrationer replayade rent från noll mot lokal
stack. Sviten är internt konsistent.

`db diff --linked --schema public` mot prod: **inte tom.** 184 statements,
varav 164 grants. Fyra fynd:

1. **`events.category_type` finns kvar i både dev och prod** trots att
   `0008` kör `ALTER TABLE events DROP COLUMN IF EXISTS category_type` — och
   `0008` **är** registrerad i `supabase_migrations.schema_migrations` på prod.
   Kolumnen har alltså återskapats manuellt efter migrationen, med CHECK-
   constraint och `NOT NULL DEFAULT 'distance'`. Den läcker in i
   `src/types/database.ts` (3 rader) eftersom `npm run db:types` genererar från
   dev. Ingen appkod läser den (`grep category_type src/` → bara typfilen).
   **Detta upphäver premissen i F-REL-08:** kolumnen droppades aldrig i
   praktiken, så inget data kunde gå förlorat. Slutsatsen står, skälet ändras.
   Öppen fråga: vem återskapade den och varför — troligen ett försök att laga
   något innan `race_type` fanns i UI:t.
2. **`pg_net` ligger i `public`-schemat i prod.** `0029` skapar extensionen utan
   `with schema`, så placeringen blev plattformens default. Supabase
   rekommenderar `extensions`. Ingen funktionell påverkan i dag.
3. **164 grant-rader** för `anon` / `authenticated` / `service_role` på i stort
   sett varje tabell. Detta är Supabases automatiska default-grants som
   migrationsfilerna aldrig deklarerar — förväntat brus i `db diff`, inte drift.
   Värt att veta ändå: `anon` har `insert`/`update`/`delete` på allt, så **RLS är
   det enda som skyddar**, aldrig grants. Jämför SEC-03/ADR-0001.
4. `remove_official` och `anonymize_inactive_users` — signatur, `security
definer` och `search_path` stämmer exakt med `0025` / `0029`. Bara
   textnormalisering av funktionskroppen skiljer. **Ingen funktionell drift.**

Slutsats: rutinen gjorde sitt jobb i första körningen. Fynd 1 är verklig drift
och kräver ett beslut (droppa kolumnen på båda miljöerna via en ny migration,
eller acceptera den och dokumentera varför). Fynd 3 betyder att `db diff` alltid
kommer att vara högljudd — filtrera bort `^grant ` när diffen läses, annars
drunknar de riktiga fynden.
