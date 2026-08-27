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
      Men se grant-fyndet nedan: mot en ren lokal build failar seed ändå
      (`42501 permission denied for table tenants`, verifierat 2026-08-27 även
      med overriden på plats). **Snabbaste vägen till data är i praktiken
      `psql -U postgres` direkt** — den rollen har alla privilegier. En
      `tenants`-rad, ett `events`, ett `event_stages` och en `user_roles`-rad
      räcker för Del 3; se uppsättningen i Del 3-loggen nedan.
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

- [ ] `supabase db reset` (se seed-noten i Del 2 om du behöver data)
- [ ] **Skaffa en grön baslinje innan du bryter något.** På en ren lokal build
      svarar PostgREST `403 / 42501` på varje tabell — plattformens grants
      saknas (körningen 2026-08-27: `service_role` hade SELECT på 0 av 15
      tabeller). Utan baslinje går det inte att skilja ditt brott från
      grants-luckan. Sätt dem i sessionen, **inte som migration**:
      `docker exec supabase_db_sports-event-manager psql -U postgres -c "grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;"`
      De försvinner vid nästa `db reset` och måste sättas om. Verifiera sedan
      med en curl som ska ge `200` innan du går vidare.
- [ ] **Starta dev-servern mot lokal stack.** `next dev` vägrar en andra
      instans i samma katalog oavsett port, så stoppa en redan körande server
      först (`kill $(lsof -ti :3000)`). Den som redan kör läser `.env.local`
      och pekar mot **dev-molnet** — mot den syns brottet aldrig. Starta med
      override:
      `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \`
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=$(supabase status -o json | python3 -c "import json,sys; print(json.load(sys.stdin)['ANON_KEY'])") \`
      `SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o json | python3 -c "import json,sys; print(json.load(sys.stdin)['SERVICE_ROLE_KEY'])") \`
      `npx next dev`
- [ ] **Lägg den trasiga migrationen utanför repot** — i en scratchpad, inte i
      `supabase/migrations/`. En medvetet trasig fil i repot kan följa med en
      commit eller en `db push`. Applicera den med
      `docker exec -i supabase_db_… psql -U postgres < fil.sql`.
- [ ] Simulera en dålig migration: skriv en ny migrationsfil som medvetet gör
      något fel som appen märker. **Välj vägen med omsorg** — de flesta
      läsvägar failar tyst, se varningen nedan. Ett byte av kolumnnamn som en
      _sidas_ `select` läser räcker INTE.
- [ ] **`supabase db reset`, inte `db push`.** `db push` går alltid mot det
      länkade remote-projektet (dev eller prod) — det finns ingen lokal push.
      Lokalt applicerar man migrationer genom att spela om hela sviten. Det
      betyder också att varje iteration kostar en full replay, vilket är en
      reell faktor i återhämtningstiden. Vill du iterera snabbare: kör SQL:en
      direkt mot databasen först
      (`docker exec supabase_db_sports-event-manager psql -U postgres -c "..."`),
      och `db reset` en gång på slutet för att verifiera från rent läge.
- [ ] Bekräfta att appen faktiskt går sönder på det sätt du förväntade.
      **Går den inte sönder är det ett fynd, inte ett misslyckat uppsättning** —
      skriv upp det och byt väg.
- [ ] Ta tid från här. Skriv forward-fix-migrationen som återställer läget
- [ ] Notera hur lång tid det tog och vad som var svårt

> **Läsvägar larmar sedan PR #76 (F-REL-10, stängt 2026-08-27).** Tidigare gjorde
> 15 läsningar i 9 filer `const { data } = await supabase…` utan att
> destrukturera `error`, och sedan `?? []` — en failad fråga blev en tom lista,
> sidan svarade 200 och Sentry fick ingenting. Det blockerade förmiddagens
> körning. Efter #76 kastar läsvägarna, och samma brott
> (`event_stages.venue` → `location`) ger nu **HTTP 500 med `42703` i
> serverloggen**, verifierat samma dag. `src/query-error-handling.test.ts` är
> lint-guarden som håller formen borta.
>
> Ett `drop function`-brott mot en RPC fungerar fortfarande som alternativ och
> är snabbare att verifiera (`HTTP 404 / PGRST202`, se Del 2).

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

| Migration | Varför ingen down finns                                                                                                                                                                                                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0003`    | Droppar `assignments.workstation` och `.todo`. Innehållet är borta; en down ger tillbaka tomma kolumner.                                                                                                                                                                                      |
| `0008`    | Droppar `events.category_type` efter en backfill smalare än droppen. Droppen tog aldrig effekt (F-REL-09, nummerkollision); `0034` gör den skarpt — dev och prod 2026-08-27. Inget data förlorat (F-REL-08, mätt: varje rad höll default-värdet). En down kan ändå inte återskapa innehållet. |
| `0009`    | Remappar `invite_status`. En reverse kan inte skilja migrationens rader från appens senare confirmations.                                                                                                                                                                                     |
| `0012`    | Droppar `slot_index` → kastar bort vilken lane varje official står på, vilket inte kan räknas om.                                                                                                                                                                                             |
| `0014`    | `DELETE FROM workstations WHERE stage_id IS NULL` + FK:n cascadar nu till `assignments`. Raderna finns inte kvar.                                                                                                                                                                             |
| `0015`    | Äger `logos`-bucketen. En down som tar bucketen tar även varje uppladdad logo.                                                                                                                                                                                                                |

Två down-fällor i den reversibla delen: `0007` och `0021` släpper `NOT NULL`. En
down som återinför constraintet **failar** om NULL-rader skapats sedan dess.
Det failar synligt, vilket är bättre än tyst — men det betyder att downen inte
kan köras utan att först städa raderna.

---

## Logg

Datum, vem som körde, och vad som kom ut av del 3. Fyll på nedåt.

| Datum      | Vem   | Del 1                                             | Del 2                 | Del 3: tid till fix                               | Vad som saknade dokumentation                                                                                                                                                                       |
| ---------- | ----- | ------------------------------------------------- | --------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-26 | Frida | **FAIL** — se fynden nedan                        | ej körd än            | ej körd än                                        | CLI:n låg kvar länkad mot prod från förra sessionen. Rutinen bör börja med att verifiera länkning, inte anta dev.                                                                                   |
| 2026-08-27 | Frida | **PASS mot prod** — 17 statements kvar, inga fynd | **PASS med två fynd** | **Kunde inte köras** — se F-REL-10                | Att `db push` matchar på nummer och inte innehåll, och därför kan rapportera framgång utan att göra något. Ledde till att Del 0 skrevs.                                                             |
| 2026-08-27 | Frida | (ej omkörd — PASS ovan gäller)                    | (ej omkörd)           | **PASS — 28 s** (apply + verifiera, se förbehåll) | Att lokal stack saknar plattformens grants och därför inte har någon grön baslinje. Att `next dev` vägrar en andra instans i samma katalog oavsett port, och att `.env.local` pekar mot dev-molnet. |

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
avvaktar: dess ledger står på 0032, så en push där applicerar även kollegans 0033.

Del 0 i detta dokument skrevs som direkt följd.

**Prod klar samma dag.** `0033` (kollegans PERF-02-RPC, godkänd av hen för
prod) och `0034` pushade tillsammans — prods ledger stod på 0032, så båda
saknades. `--dry-run` först, som listade exakt dessa två och inget annat.

Verifierat **mot prods schema**, inte mot pushens utdata:

| Kontroll                          | Förväntat | Faktiskt |
| --------------------------------- | --------- | -------- |
| `events.category_type` finns      | 0         | 0        |
| `save_assignments_batch` finns    | 1         | 1        |
| Ledger senaste                    | 0034      | 0034     |
| Events kvar                       | 5         | 5        |
| `event_stages.race_type = 'time'` | 2         | 2        |

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

### Körning 2026-08-27 — Del 3 kunde inte köras

Startläget sattes upp: en medvetet dålig migration som döper om
`event_stages.venue` → `location`, applicerad mot lokal stack. Brottet
verifierades på API-nivå — PostgREST svarar **`HTTP 400 / 42703`,
`column event_stages.venue does not exist`**.

**Appen visade ingenting.** Ingen krasch, inget felmeddelande, inget i Sentry.
Sidorna svarade 200 med tomma listor.

Orsaken är F-REL-10: läsvägarna destrukturerar bara `data`, aldrig `error`, och
coalescar sedan med `?? []`. En failad fråga blir därmed omöjlig att skilja från
en tom tabell. **15 läsningar i 9 filer**, verifierade individuellt — inklusive
hela admin-ytan (dashboard, event, officials, workstations ×2, communication,
scheduling ×3). En andra, mildare klass följs av `if (!x) notFound()`; de failar
högt men med vilseledande 404.

Övningen är därmed **blockerad på F-REL-10**, inte bara ej utförd. Del 3 kräver
per konstruktion att man kan bekräfta att appen går sönder på det sätt
`Blast:`-raden förutsade — och för de flesta läsvägar går det inte att bekräfta
något alls.

Två fynd som gäller oavsett:

1. **`supabase db push` finns inte för lokal stack.** Rutinen sa så; det är fel.
   `db push` går alltid mot det länkade remote-projektet. Lokalt applicerar man
   via `db reset`, vilket betyder att varje iteration kostar en full replay av
   hela sviten — en reell faktor i återhämtningstid som rutinen inte nämnde.
   Rättat i stegen ovan.
2. **Att välja brott är inte trivialt.** Instruktionens eget exempel ("byt namn
   på en kolumn en server action läser") pekar mot en väg som visade sig vara
   osynlig. Stegen anger nu att man ska välja en skrivväg eller en RPC tills
   F-REL-10 är åtgärdad.

### Körning 2026-08-27 (eftermiddag) — Del 3 genomförd, PASS

Kördes om efter att F-REL-10 stängdes i PR #76 (`08fc115`). **Samma brott som
blockerade förmiddagens körning valdes med avsikt** — `event_stages.venue` →
`location` — just för att det är den enda chansen att regressionstesta #76 mot
det fall som tidigare var osynligt.

**Resultat: appen larmar nu.**

| Yta                                  | Före #76       | Nu      |
| ------------------------------------ | -------------- | ------- |
| `admin/event` (läser `venue`)        | 200, tom lista | **500** |
| `event-info` (läser `venue`)         | 200, tom lista | **500** |
| `admin/dashboard` (läser ej `venue`) | 200            | 200     |

Serverloggen innehåller den faktiska felkoden — `42703, column
event_stages.venue does not exist` — och inget av felet läcker till klientens
HTML. Blast-radien matchar `Blast:`-raden exakt: bara de sidor som namnger den
omdöpta kolumnen går sönder.

**Tid till fix: 28 sekunder** (13:22:27 → 13:22:55). Forward-fixen var en
idempotent `alter table ... rename column` bakom en
`information_schema`-kontroll, så en omkörning mot en redan lagad databas är en
no-op. Ingen dataförlust: värdet `'Stora Torget'` överlevde båda namnbytena.

**Förbehåll om siffran.** 28 s mäter _applicera och verifiera_, inte "tid till
fix i prod". Diagnosen var redan gjord, stacken var varm, och brottet var
skrivet av samma person som lagade det. I en verklig incident dominerar
diagnostiden — och varje lokal iteration kostar en full `db reset`-replay av
hela sviten. Nästa körning bör låta någon annan välja brottet för att få en
siffra som betyder något.

**Svaren på övningens tre frågor:**

1. _Tid från trasig till pushad fix:_ 28 s lokalt för själva fixen. Inte pushad
   till prod — övningen kräver det inte, och en `db push` hade applicerat en
   medvetet trasig migration.
2. _Vilka steg saknade dokumentation:_ grants-baslinjen och dev-server-konflikten,
   båda nedan.
3. _Går fixen att göra utan lokal stack uppe?_ **Nej.** `db diff` behöver
   Docker för shadow-schemat, `db reset` är enda lokala appliceringsvägen, och
   utan lokal stack finns ingen plats att verifiera fixen innan prod. Det är en
   beroendekedja värd att känna till kl 22 en lördag: Docker måste upp först.

Två fynd:

1. **Lokal stack har ingen grön baslinje utan plattformens grants.** På en ren
   `db reset` svarade PostgREST `HTTP 403 / 42501 permission denied` på **alla
   15 tabeller** i `public` — `service_role` hade SELECT på noll av dem. Innan
   det åtgärdades gick det inte att skilja "min trasiga migration" från "grants
   saknas", vilket gör hela övningen meningslös. Löstes i sessionen genom att ge
   DML på hela `public` till `anon`, `authenticated` och `service_role` via
   `psql -U postgres` (kommandot står i Del 3-stegen ovan) — **medvetet inte som
   migration**, det är beslutet på Trello-kortet "Grants: lokal build inte
   körbar utan plattformens defaults". Detta är samma rot som Del 2:s fynd 2 och
   onsdagens diff-fynd 3, men konsekvensen är större än där beskriven: det är
   inte bara seed som failar, utan varje anrop appens klienter gör. Grants
   nollställs vid varje `db reset` och måste sättas om.
2. **`next dev` vägrar en andra instans i samma katalog, oavsett port.** Felet
   är "Another next dev server is already running" även med `-p 3100`, så en
   redan körande server måste stoppas. Den som redan kör läser `.env.local`,
   som pekar mot **dev-molnet** — kör man Del 3 mot den testar man fel databas
   och brottet syns aldrig. Env-override krävs vid start:
   `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` plus lokal `ANON_KEY` och
   `SERVICE_ROLE_KEY` från `supabase status -o json`.

**Uppsättning som fungerade** (för nästa körning): minimal data via
`psql -U postgres` istället för `npm run seed:dev` — en `tenants`-rad, ett
`events`, ett `event_stages` med `venue` satt, plus en `user_roles`-rad som gör
testanvändaren `tenant_admin`. Inloggning via test-OTP mot
`/auth/v1/verify` (`+46700000001` / `000000`, se `[auth.sms.test_otp]` i
`supabase/config.toml`) ger en session utan Twilio; sessionen packas till en
`sb-127-auth-token`-cookie som `base64-`-prefixad JSON för att nå sidorna med
curl. Den vägen kringgår både grants-problemet och behovet av en webbläsare.

**Den trasiga migrationen och forward-fixen låg i scratchpad, aldrig i
`supabase/migrations/`.** Det är med avsikt: en medvetet trasig migration i
repot riskerar att följa med en commit eller en `db push`. `db reset` städar
den, och `git status` var ren efteråt.
