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
localhost — men **den väljer dev om du inte säger annat**, se Del 2 för hur den
tvingas mot lokal stack.

Rytm: kör hela rutinen **före varje prod-release som innehåller en migration**,
och som helhet minst en gång före Viadal 2026.

---

## Del 0 — Checklista kring `db push` mot prod

Kort lista att gå igenom varje gång en migration ska till prod. Den finns för
att `db push` **kan rapportera framgång utan att ha gjort någonting** — se
varningen efter listan.

**Före push:**

- [ ] `cat supabase/.temp/project-ref` — vet vilken miljö du står i
- [ ] `select version, name from supabase_migrations.schema_migrations order by version desc limit 5;`
      mot prod. Kontrollera att inget av dina migrationsnummer redan är taget,
      och notera vilka migrationer pushen kommer att applicera — det är
      **alla** som saknas i prods ledger, inte bara din egen. Är någon av dem
      en kollegas: stäm av att den är prod-redo innan du pushar den åt dem.
- [ ] `git pull` på main och kontrollera att ditt filnamnsprefix fortfarande är
      högst. Nummer ska tas mot `origin/main`, aldrig mot din egen branch.
- [ ] `supabase db reset` lokalt — hela sviten inklusive din migration ska
      replaya rent
- [ ] Är migrationen `destructive`: kör snapshot-`select`:en som `Data:`-raden
      hänvisar till, mot **prod**, och spara utdatan. Raden ska vila på något du
      själv har tittat på, inte på en mätning från en annan dag eller miljö.

**Efter push:**

- [ ] **Verifiera mot schemat att ändringen faktiskt skedde.** Lita inte på
      `Finished supabase db push`. För en droppad kolumn:
      `select count(*) from information_schema.columns where table_schema = 'public' and table_name = '<tabell>' and column_name = '<kolumn>';`
      → ska ge `0`. Ger den `1` är det ett incidentspår, inte ett omtag.
- [ ] Kör Del 1 nedan (`db diff --linked` mot prod). Det är det egentliga
      slutbeviset: din ändring ska inte längre synas i diffen.
- [ ] `supabase link --project-ref lhflutwvwvzawzbcuwup` — **tillbaka till dev.**
      Glöms lätt, och nästa `db push` går då mot prod.
- [ ] `npm run db:types` behövs bara om dev ändrats. Den läser dev, inte prod —
      har du redan pushat till dev är typerna aktuella.
- [ ] Fyll i loggen längst ner.

> **Varför verifieringssteget finns.** `db push` matchar migrationer på
> **versionsnummer, aldrig på filinnehåll**. Ligger numret redan i målmiljöns
> `schema_migrations` hoppas filen över och kommandot svarar "Remote database is
> up to date" — utan fel, utan varning. Detta hände 2026-08-27 med `0034` (då
> döpt `0033`, ett nummer kollegans PERF-02-migration redan hade tagit på dev),
> och är den mest sannolika förklaringen till att `0008`:s `DROP COLUMN` aldrig
> tog effekt: kolumnen återskapades förmodligen aldrig — den droppades aldrig.
> Med tre personer som arbetar parallellt är nummerkollision normalfallet, inte
> olyckan, och den failar tyst.

---

## Del 1 — Clean build vs prod-schema

Verifierar att migrationssviten är den enda källan till prod-schemat, dvs att
inget har smugit in via en manuell SQL-session — och att inget som sviten säger
är gjort i själva verket hoppades över. Båda riktningarna har inträffat:
migration 0032 var applicerad på prod men saknades i `schema_migrations` (hittad
2026-08-26 vid F-REL-05), och `0008`:s `DROP COLUMN` stod som applicerad utan
att ha utförts (F-REL-09, se nummerkollisionen i Del 0).

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
- [ ] Behöver du data: **`npm run seed:dev` går mot dev-molnet som standard, inte
      mot lokal stack.** Skriptet läser hårdkodat `.env.local` och tar
      `NEXT_PUBLIC_SUPABASE_URL` därifrån. Tvinga den lokalt med env-override
      (`config()` i skriptet saknar `override: true`, så shell-miljön vinner):
      `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \`
      `SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o json | python3 -c "import json,sys; print(json.load(sys.stdin)['SERVICE_ROLE_KEY'])") \`
      `npm run seed:dev`
      Men se grant-fyndet nedan: mot en ren lokal build failar seed ändå.
- [ ] Kör den `Rollback:`-SQL som står i migrationens header, ordagrant
- [ ] Verifiera att den går igenom utan fel
- [ ] Bekräfta vad som går sönder och jämför med `Blast:`-raden. Stämmer de inte
      överens är headern fel och ska rättas. Rör migrationen en RPC går det
      snabbare att curl:a PostgREST än att starta appen:
      `curl -s -o /dev/null -w "%{http_code}\n" -X POST \`
      `http://127.0.0.1:54321/rest/v1/rpc/<funktion> -H "apikey: $KEY" \`
      `-H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{}'`
- [ ] `supabase db reset` för att städa, och bekräfta att objektet är tillbaka

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
| `0008`    | Droppar `events.category_type` efter en backfill smalare än droppen. Droppen tog aldrig effekt (F-REL-09, nummerkollision); `0034` gör den skarpt — dev och prod 2026-08-27. Inget data förlorat (F-REL-08, mätt: varje rad höll default-värdet). En down kan ändå inte återskapa innehållet. |
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

| Datum      | Vem   | Del 1                             | Del 2      | Del 3: tid till fix | Vad som saknade dokumentation                                                                                                          |
| ---------- | ----- | --------------------------------- | ---------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-26 | Frida | **FAIL** — se fynden nedan        | ej körd än | ej körd än          | CLI:n låg kvar länkad mot prod från förra sessionen. Rutinen bör börja med att verifiera länkning, inte anta dev.                       |
| 2026-08-27 | Frida | **PASS mot prod** — 17 statements kvar, inga fynd | **PASS med två fynd** | ej körd än | Att `db push` matchar på nummer och inte innehåll, och därför kan rapportera framgång utan att göra något. Ledde till att Del 0 skrevs. |

### Körning 2026-08-26 — Del 1 resultat

`db reset` **PASS**: alla 32 migrationer replayade rent från noll mot lokal
stack. Sviten är internt konsistent.

`db diff --linked --schema public` mot prod: **inte tom.** 184 statements,
varav 164 grants. Fyra fynd:

1. **`events.category_type` finns kvar i både dev och prod** trots att `0008`
   kör `ALTER TABLE events DROP COLUMN IF EXISTS category_type` — och `0008`
   **är** registrerad i `supabase_migrations.schema_migrations`. Läcker in i
   `src/types/database.ts` (3 rader) eftersom `npm run db:types` genererar från
   dev. Ingen appkod läser den. **Detta upphäver premissen i F-REL-08:**
   kolumnen droppades aldrig i praktiken, så inget data kunde gå förlorat.
   Slutsatsen står, skälet ändras. → F-REL-09, orsak fastställd 2026-08-27.
2. **`pg_net` ligger i `public`-schemat i prod.** `0029` skapar extensionen utan
   `with schema`, så placeringen blev plattformens default. Supabase
   rekommenderar `extensions`. Ingen funktionell påverkan i dag. **Fortfarande
   öppen.**
3. **164 grant-rader** för `anon` / `authenticated` / `service_role` på i stort
   sett varje tabell. Supabases automatiska default-grants, som
   migrationsfilerna aldrig deklarerar — förväntat brus, inte drift. Värt att
   veta ändå: `anon` har `insert`/`update`/`delete` på allt, så **RLS är det
   enda som skyddar**, aldrig grants. Jämför SEC-03/ADR-0001.
4. `remove_official` och `anonymize_inactive_users` — signatur, security definer
   och search_path stämmer exakt med `0025` / `0029`. Bara textnormalisering av
   funktionskroppen skiljer. **Ingen funktionell drift.**

### Körning 2026-08-27 — orsaken till fynd 1

Fynd 1 var inte manuell återskapning. `db push` av migrationen som skulle
droppa kolumnen svarade **"Remote database is up to date" och applicerade
ingenting** — filen hette `0033`, ett nummer som kollegans
`0033_save_assignments_batch_rpc` (PERF-02) redan hade i dev:s ledger. `db push`
matchar på versionsnummer, aldrig på filinnehåll.

Samma mekanism förklarar med stor sannolikhet `0008`: numret var upptaget,
pushen tyst, `DROP COLUMN` aldrig utförd. Kolumnen återuppstod inte — den
försvann aldrig. Att `src/types/database.ts` fick tillbaka raderna 2026-08-18 i
en orelaterad commit följer också av detta: `db:types` läser dev, där kolumnen
alltid funnits.

Omdöpt till `0034`, pushad till dev och **verifierad mot
`information_schema`** — inte mot pushens utdata. Kolumnen är borta på dev;
`src/types/database.ts` tappade de tre raderna, `tsc --noEmit` rent. Prod
avvaktar: dess ledger står på 0032, så en push där applicerar även kollegans
0033.

Del 0 i detta dokument skrevs som direkt följd.

**Prod klar samma dag.** `0033` (kollegans PERF-02-RPC, godkänd av hen för
prod) och `0034` pushade tillsammans — prods ledger stod på 0032, så båda
saknades. `--dry-run` först, som listade exakt dessa två och inget annat.

Verifierat **mot prods schema**, inte mot pushens utdata:

| Kontroll                            | Förväntat | Faktiskt |
| ----------------------------------- | --------- | -------- |
| `events.category_type` finns        | 0         | 0        |
| `save_assignments_batch` finns      | 1         | 1        |
| Ledger senaste                      | 0034      | 0034     |
| Events kvar                         | 5         | 5        |
| `event_stages.race_type = 'time'`   | 2         | 2        |

Snapshot före push (alla fem prod-event höll `category_type = 'distance'`,
alltså 0006:s default — värdet var aldrig medvetet satt) togs enligt Del 0:s
krav för `destructive`.

**`db diff --linked` mot prod efter push: 17 icke-grant statements, noll
`category_type`-rader** — ned från 184 vid onsdagens körning. De 17 är de två
redan kända icke-fynden: `pg_net` i `public` (fynd 2, **fortfarande öppen**)
och Postgres egen normalisering av `anonymize_inactive_users` /
`remove_official`. **Del 1 är därmed PASS mot prod:** migrationssviten beskriver
prods schema, vilket är MNT-07:s "clean database build compared against
production schema".

### Körning 2026-08-27 — Del 2 resultat

Objekt: `0033_save_assignments_batch_rpc.sql`, enda migrationen med
`Forward-fix: additive` — och den första som skrevs under konventionen, alltså
precis den man vill testa först.

**Headern höll, båda raderna:**

- `Rollback:`-SQL:en kördes ordagrant och fungerade — funktionen fanns (1),
  `DROP FUNCTION`, funktionen borta (0). Ingen felstavad signatur, inget
  saknat argument. Efter `db reset` är den tillbaka.
- `Blast:`-raden lovade PostgREST 404 på varje schemaläggnings-save. Verifierat
  med ett direktanrop mot den droppade RPC:n: **HTTP 404, `PGRST202`**. Stämmer
  exakt.

**Fynd 1 — dokumentationsfel i denna rutin (rättat ovan).** Steget sa
"`npm run seed:dev` mot den lokala stacken", men skriptet läser hårdkodat
`.env.local` och gick mot dev-molnet. Det räddades bara av att
tenant `seed-klubben` redan fanns där, annars hade övningen skrivit testdata i
dev. Kräver env-override, vilket nu står i steget.

**Fynd 2 — lokal build ≠ prod, trots att alla migrationer replayas rent.**
`service_role`, `anon` och `authenticated` har på en ren lokal build bara
`REFERENCES/TRIGGER/TRUNCATE` på `public.tenants` — **ingen
SELECT/INSERT/UPDATE/DELETE**. Seed-skriptet failar därför med `42501
permission denied for table tenants` mot lokal stack, medan samma skript
fungerar mot dev och prod. Skillnaden är Supabase-plattformens default-grants,
som ingen migration deklarerar.

Detta är samma sak som fynd 3 i onsdagens diff, men konsekvensen är större än
"brus": **Del 1 mäter schemat, inte behörigheterna.** Tabeller, kolumner,
constraints och funktioner stämmer mot prod — grants gör det inte, och de
filtrerades bort ur diffen med `^grant `. Filtret är fortfarande rätt för att
hitta drift, men en grön Del 1 betyder inte att lokal stack beter sig som prod.
Del 2 hittade alltså något Del 1 inte kan se.

Öppen fråga, inte åtgärdad här: ska en migration deklarera de grants appen
faktiskt behöver, så att lokal build blir körbar utan plattformens hjälp? Det
gör lokal utveckling förutsägbar, men lägger till 100+ rader som duplicerar
något Supabase redan gör i dev och prod. Värt ett eget kort.
