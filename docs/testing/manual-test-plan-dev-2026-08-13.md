# Manuell testplan — dev, 2026-08-13

Senaste dev-deploy: run #31692648914 (2026-08-13 10:47), innehåller SEC-02 t.o.m. SEC-05 + RLS-integrationstestfixarna. Detta är den första manuella genomgången sen dessa landade.

Dev-URL: https://sports-event-manager-dev.lemonbay-48b8af2a.swedencentral.azurecontainerapps.io

Testtelefon (SMS-OTP bypass): `46768109304`, kod `000000`.

**Observera:** Participant-inloggning är inte implementerad än — bara system_admin, tenant_admin och official kan logga in. Där testfall nedan ursprungligen förutsatte "logga in som participant" är de omskrivna till att testa participant som **datarad** (t.ex. sms_opt_out, RLS) istället för en levande inloggningssession.

---

## 1. SEC-02 — official-sidor kan inte längre nås av fel roll (viktigast att verifiera)

Bakgrund: layouten var enda spärren; de fem official-sidorna läste data utan egen guard. Den nya guarden, `canViewOfficialSurfaces` (`src/lib/auth/tenant.ts`), tillåter **explicit** både `official` OCH `tenant_admin` (plus global system_admin) — designen är att en tenant_admin ska kunna se officials-vyerna, t.ex. för felsökning. Det som ska blockeras är roller **utan** någon av dessa två roller i tenanten: alltså participant, eller en användare utan `user_roles`-rad i den tenanten alls, eller en tenant_admin/official-roll som hör till en **annan** tenant.

- [x] **tenant_admin ska INTE testas som "fel roll"** — det är avsedd åtkomst. Verifiera istället att tenant*admin \_kan* nå alla fem sidorna (regressionstest, inte säkerhetstest). — Testat 2026-08-13: tenant_admin i Testklubben kommer åt official-sidorna som förväntat.
- [x] Eftersom participant-inloggning saknas (se anteckning ovan), testa "fel roll" genom att logga in som **tenant_admin/official i Tenant A** och försöka nå official-URL:er för **Tenant B** (en annan tenant du inte har någon roll i). Detta är den enda praktiskt körbara varianten av "obehörig användare" tills participant-login finns. — Testat 2026-08-13.
- [x] Försök navigera direkt till varje official-URL för Tenant B (inte via UI-länkar, skriv URL:en manuellt):
  - HOME-01 (official-hem)
  - INFO-01
  - MYSCH-01
  - ANN-01 (official-vy)
  - ACCT-01
- [x] Förväntat: nekad åtkomst / redirect på **varje** sida, inte bara den första. — Testat 2026-08-13: 404 på samtliga fem.
- [x] Logga in som **official** i samma tenant, verifiera att samma fem sidor fungerar normalt (ingen regression). — Testat 2026-08-13 (official i Eddos).
- [x] Logga in som **tenant_admin** i samma tenant, verifiera att samma fem sidor OCKSÅ fungerar normalt (avsedd åtkomst, inte en läcka). — Testat 2026-08-13 (tenant_admin i Testklubben).
- [x] Testa en **suspenderad tenant** (`is_active = false`): system_admin ska fortfarande kunna administrera den; tenant_admin/official i den tenanten ska nekas. — Testat 2026-08-13 mot Testklubben: tenant_admin och official fick 404 på både dashboard och officials-sidorna medan suspenderad; system_admin (tillfällig roll i annan tenant) kom åt Testklubben ändå och kunde reaktivera den via "Activate"-knappen; åtkomst återställdes korrekt för tenant_admin/official efteråt.
- [x] Testa en användare som är `system_admin` i **flera tenants** — verifiera inloggning/åtkomst fungerar utan 403 (regression som nämns i commit 9e37827). — Testat 2026-08-13: system_admin-rad tillagd i en tenant utöver den befintliga tenant_admin-rollen i Testklubben (olika tenant_id, unique constraint är per (user_id, tenant_id)); inloggning/åtkomst fungerade utan 403.
- [x] Testa unconfirmed official-fixen: satt `invite_status` till `invited` för en official (Eddos) och verifierat nekad åtkomst till official-sidorna tills `confirmed` igen. — Testat 2026-08-13.
- [ ] Note: fullständig verifiering av "participant kan inte nå official-sidor" kräver participant-inloggning, som inte finns än. Lägg till detta testfall i planen när participant-login byggs.

## 2. SEC-02 — tenantId-injektion i guards

- [x] I ett server action-anrop (publicera event, redigera scheman, redigera workstations), försök skicka ett malformat `tenantId` via devtools-nätverksflik → Copy as fetch → manipulerad payload. Testat lokalt (localhost:3000) 2026-08-14, tenant_admin i Testklubben:
  - `saveAssignments` (SCHED, `/testklubben/admin/scheduling`) med `tenantId: "not-a-uuid"` → HTTP 200 (RSC-transport), body `{"error":"Not authorized"}`. Kontrolltest med korrekt tenantId gick igenom till affärslogiken (nådde slot-konflikt-check).
  - `saveEvent` (EVT, `/testklubben/admin/event`) med `tenantId: "not-a-uuid"` → samma resultat, `{"error":"Not authorized"}`. Denna action saknar en egen lokal `tenantIdSchema.safeParse()` i actionfilen (till skillnad från övriga), men fångas ändå av UUID-checken inne i `hasAdminAccessToTenant`.
  - `updateWorkstation` (WS, `/testklubben/admin/workstations/<id>`) testad med både `tenantId: "not-a-uuid"` och OR-injektionssträngen `tenantId: "' OR '1'='1"` → båda gav samma resultat, `{"error":"Not authorized"}`.
- [x] Förväntat uppfyllt: ingen 500, inget genomslag till databas/RPC eller fel tenants data. HTTP 200 i svaret är förväntad Next.js Server Actions-transportkonvention (fel signaleras i body, inte statuskod) — inte en läcka.
- [x] Verifiera normalflödet fortfarande funkar: publicera ett event, redigera ett schema, redigera en workstation — allt som tenant_admin i din egen tenant. — Testat 2026-08-14: samtliga tre flöden fungerar normalt i UI efter injektionstesterna, ingen regression.
- [ ] Detta test kördes mot localhost, inte dev-deploy. Enligt avsnitt 6 nedan bör guard-logiken bete sig identiskt i dev/prod (ingen kod-skillnad), men note:a om ni vill köra om mot dev-URL:en för fullständig spårbarhet.

## 3. SEC-04 — telefonnummer måste faktiskt tillhöra personen (official invite)

- [x] Skapa en ny official-invite med ett telefonnummer. — Testat 2026-08-13: HTTP 200, raden skapad med `invite_status = 'invited'`, och SMS levererat till ett riktigt nummer från dev-avsändaren +46728101619 (alltså inte via OTP-testnumret, se avsnitt 6).
- [x] Bekräfta inbjudan (`/officials/confirm`-flödet) med **testtelefonnumret som faktiskt fick SMS:et**. Förväntat: fungerar, official kopplas till rätt user. — Testat 2026-08-13: HTTP 200. `user_id` satt, `invite_token` nullad, och exakt en ny `user_roles`-rad med rollen `official` i rätt tenant. Telefonen hade noll roller innan, så rollen kan bara ha kommit från inbjudan.
- [x] Försök bekräfta samma inbjudan igen, eller med ett **annat** telefonnummer än det som bjöds in. Förväntat: nekas — kan inte kapa någon annans invite. — Testat 2026-08-13: återanvänd länk visar "invalid or expired"-skärmen; bekräftelseförsök från ett **annat** inloggat nummer gav 403 `phone_mismatch` och lämnade raden orörd (fortfarande `invited`, `user_id` NULL, namnet oförändrat).
- [ ] Verifiera RPC-flödet end-to-end (två nya migrations: 0017 confirm_official_invite_rpc, 0018 confirm_official_invite_by_phone_rpc) — dvs. att en official verkligen hamnar med rätt `user_id` kopplad efter bekräftelse, inte bara att UI:t säger OK. — Delvis 2026-08-13: **0017 verifierad** end-to-end mot databasen. **0018 är inte verifierad** — den vägen kräver rader med `invite_status = 'invited'` och `invite_token IS NULL`, ett tillstånd ingen applikationsväg skapar, så den kan bara testas med handplanterade rader. Lämnas ikryssad-fri tills det görs.

## 4. SEC-05 — sms_opt_out respekteras vid annonser

Bakgrund: officials sms_opt_out lades till i SEC-04 men användes aldrig vid utskick; SEC-05 lägger till samma kolumn för participants och filtrerar båda.

- [x] Sätt `sms_opt_out = true` på en testofficial och en test-participant-rad (participanter skapas/hanteras via tenant_admin-UI eller direkt i DB — de loggar inte in själva än, men raden och telefonnumret används för SMS-utskick). — Testat 2026-08-14: testade med sig själv som tenant_admin + official i samma tenant (testklubben), se not nedan om setup.
- [x] Skicka en announcement till **officials**-kanalen. Förväntat: opt-out-officialen får **ingen** SMS; övriga officials får SMS som vanligt. — Testat 2026-08-14: skickade "hoppla" medan opted-out, inget SMS mottaget. Korrekt.
- [ ] Skicka en announcement till **participants**-kanalen. Förväntat: opt-out-participantraden får **ingen** SMS; övriga får SMS. — **Blockerad 2026-08-14:** ingen tenant-admin-UI för att skapa/hantera participant-rader finns än (bekräftat: inga träffar i src/ förutom announcement-kanalen och send-logiken). Kräver en direkt SQL-insert i `participants` för att testa idag; skjutet upp till participant-hantering (UI/CRUD) är byggd, se [[project_participant_login_missing]]-anteckningen.
- [x] Verifiera att announcementen ändå sparas/publiceras korrekt i UI (opt-out ska bara påverka SMS-leverans, inte announcement-posten själv). — Testat 2026-08-14: "hoppla"-raden sparades i announcements-tabellen med sms_sent=false som vanligt, trots att inget SMS gick ut.
- [x] Regression: en official/participant **utan** opt-out ska fortfarande få SMS som tidigare. — Testat 2026-08-14: togglade tillbaka sms_opt_out=false, näst påföljande announcement ("hej igen") levererades.

**Setup-anteckning:** `user_roles` har unik constraint per `(user_id, tenant_id)`, inte per `(user_id, tenant_id, role)` — en användare kan alltså inte ha två roller (t.ex. tenant_admin + official) i samma tenant via user_roles. Testet gjordes genom att lägga till en `officials`-rad med `user_id` satt till den befintliga tenant_admin-användaren i testklubben; `canViewOfficialSurfaces` (`src/lib/auth/tenant.ts:163`) släpper redan igenom tenant_admin till official-ytorna (inklusive account-sidan) utan egen official-rad i user_roles, så bara officials-raden behövdes.

**Bugg hittad och fixad (2026-08-14):** efter att opt-out slogs av igen mottogs "hej igen" 4 ggr, "hoppla" 3 ggr och "Hej hopp!" 3 ggr enligt Twilio-loggarna, trots att varje announcement bara skapade en rad i `announcements` (verifierat via SQL) och `/api/announcements` bara anropar `client.messages.create()` en gång per rad i mottagarfrågan.

Root cause: testklubben-tenanten hade 4 `officials`-rader med samma telefonnummer (`+46768109304`) — 3 med `invite_status = 'removed'` (från tidigare testning) och 1 `confirmed`. Mottagarfrågan i `src/app/api/announcements/route.ts:30-34` filtrerade bara på `tenant_id` och `sms_opt_out`, inte på `invite_status` — så borttagna officials med återanvänt/kvarvarande telefonnummer fick fortfarande annonsutskick. Detta är en verklig bugg, inte en Twilio-artefakt.

Fix: la till `.eq('invite_status', 'confirmed')` på officials-frågan (gäller bara officials-kanalen — participants har ingen invite_status-kolumn). Nya tester tillagda i `route.test.ts` som täcker både att removed officials exkluderas och att participants-frågan inte filtrerar på invite_status. Alla 14 tester i `route.test.ts` passerar.

## 5. Allmän regressionsrunda (låg risk, men rör kärnflöden)

- [x] Logga in som tenant_admin: bekräfta att EVT-01/EVT-02, WS-01/WS-02, OFF-01, SCHED-01, COMM-01 laddar och fungerar som innan. — Testat 2026-08-17 mot dev-URL:en: samtliga sju admin-skärmar laddar och fungerar (spara event, skapa workstation, lägga till official, tilldela slot, skicka announcement). Se begränsningsnoten nedan om rollisolering. Bonus: verifierade även migration 0020 end-to-end i OFF-01 — försök att lägga till en official med ett telefonnummer som redan finns aktivt stoppades med 409 ("An official with this phone number already exists"), inte 500; efter att den befintliga officialen tagits bort (soft delete, `invite_status = 'removed'`) gick samma nummer att återanvända. Det är precis vad det partiella indexet är designat för.
- [x] Logga in som system_admin (SYS-01/SYS-02 om byggda): åtkomst till flera tenants fungerar. — Testat 2026-08-17: inloggning landar på `/admin` (system_admin vinner över tenant_admin i post-login-routingen, `src/lib/auth/tenant.ts:17`); tenantlistan visar samtliga tenants. Tre tenants där kontot saknar `user_roles`-rad identifierades via SQL och `/admin/<tenantId>` laddade för alla tre — global åtkomst fungerar, ingen 403.
- [x] SMS-OTP-inloggning (testnumret) fungerar fortfarande end-to-end. — Testat 2026-08-17: upprepade inloggningar med `46768109304` / `000000` fungerar. **Obs:** testnumret går via Supabase Test Phone Numbers och aldrig genom Twilio, så detta verifierar OTP-flödet, inte faktisk SMS-leverans — se avsnitt 6.

**Navigationsgap upptäckt 2026-08-17 (produktfråga, inte bugg):** som system_admin finns ingen länk från SYS-02 in i en tenants admin-ytor — SYS-02 visar bara aktivering och tier. Skärmarna är åtkomliga (`hasAdminAccessToTenant` i `src/app/(tenant)/[tenantSlug]/admin/layout.tsx:32` släpper igenom global system_admin), men bara genom att skriva URL:en manuellt. Om en system_admin ska kunna felsöka en tenant behöver det en länk. Tas upp med Peter.

**Begränsning i tenant_admin-testet (2026-08-17):** testkontot (`46768109304`) håller både `tenant_admin` i Testklubben och den `system_admin`-rad som lades till 2026-08-13 (se avsnitt 1, rad om flera tenants). system_admin ger global åtkomst till alla tenant-ytor, så genomklickningen i punkt 1 verifierar att skärmarna **laddar och fungerar**, men isolerar inte tenant_admin-behörigheten — en guard-regression som felaktigt nekar tenant_admin skulle maskeras av system_admin-rollen. Raden behölls medvetet (borttagning valdes bort). Kör om punkt 1 med ett konto utan system_admin-rad när ett sådant finns, eller efter att participant/official-testkonton byggts ut.

## Om något fallerar

Notera: skärm-ID, roll som var inloggad, exakt URL/åtgärd, och om det är en **åtkomst-läcka** (allvarligt, stoppa och rapportera direkt) eller bara ett UI-fel.

---

## 6. Dev vs. prod — vad som beter sig annorlunda (läs innan ni taggar en release)

Dev-testning ovan verifierar **logiken**. Den verifierar INTE följande, som skiljer sig mellan miljöerna och kan dölja eller maskera buggar:

### SMS-leverans (SEC-05, SEC-04)

- Dev-inloggning går via Supabase Test Phone Numbers (`46768109304` / kod `000000`) och **går aldrig genom Twilio alls**. SEC-04/SEC-05-testerna ovan för official-invite och opt-out-SMS måste alltså skickas till ett **riktigt telefonnummer** på dev-numret (+46728101619), inte testnumret — annars testar ni bara OTP-bypasspatchen, inte den faktiska SMS-leveransen eller opt-out-filtreringen i Twilio-anropet.
- Dev och prod har **separata Twilio Messaging Services** (dev: +46728101619, prod: +46766900096) och separata Twilio-konton/credentials via olika GitHub Secrets (`TWILIO_*` för dev, `PROD_TWILIO_*` för prod). En bugg i hur `sms_opt_out`-filtret byggs kan i teorin bete sig identiskt i båda, men själva leveransen (rate limits, avsändarregistrering, ev. spam-filter på det specifika numret) är otestad förrän ni kör mot prod-numret.
- Prod hade tidigare en tillfällig Test Phone Number-genväg för Fridas eget nummer — enligt CLAUDE.md ska den vara borttagen innan riktiga användare, men **verifiera det explicit** innan release: kolla Supabase prod-projektets Auth-inställningar för kvarvarande test-nummer.

### Databas / migrationer

- Dev och prod är **separata Supabase-projekt** (dev: `lhflutwvwvzawzbcuwup`, prod: i Stockholm). Migrationerna 0017, 0018, 0019 är redan körda mot prod, så schemat är i synk — detta är inte en blockare för release.
- Ändå värt en snabb koll innan release: verifiera i Supabase prod-projektets Table Editor/SQL Editor att `sms_opt_out` faktiskt finns på både `officials` och `participants`, och att RPC:erna `confirm_official_invite_rpc`/`confirm_official_invite_by_phone_rpc` existerar — bara för att bekräfta att "körd migration" också betyder "rätt version av migrationen", inte bara att en tidigare variant kördes.
- **Verifiera aldrig migrationsstatus enbart via `supabase_migrations.schema_migrations` eller MCP:s `list_migrations`** — den tabellen kan ligga ur synk med det faktiska schemat om en migration körts manuellt (SQL Editor / `execute_sql`) utan `supabase migration up`. Kolla istället det faktiska schemat direkt (`pg_indexes`, `information_schema`, etc.) när du behöver veta om en ändring verkligen finns. Exempel 2026-08-17: `0020_officials_unique_active_phone.sql` (partiellt unikt index på `officials(tenant_id, phone)` där `invite_status <> 'removed'`) — migrationstabellen sa "ej körd" i både dev och prod, men schemat visade att indexet **redan fanns i dev** (kollega hade applicerat det manuellt). Bokföringen i dev rättades med `supabase migration repair --status applied 0020` (ingen DDL kördes om). Prod saknade indexet på riktigt — kvar att göra, se nedan.
- **0020 är blockerad på kod-deploy, inte tvärtom:** appen har idag ingen hantering av unique-constraint-krocken (`23505`) vid dubblett-telefonnummer på `officials`. Om indexet skapas i prod innan hanteringskoden (try/catch → 409 med tydligt felmeddelande) är deployad, kommer admins få råa 500-fel istället för ett begripligt "telefonnumret används redan". **Ordning: deploya hanteringskoden först, applicera 0020 på prod sedan.** Kör även prerequisite-dubblettkollen i migrationsfilens kommentar (rader 27–31) mot prod innan indexet skapas, annars misslyckas `CREATE UNIQUE INDEX` om det redan finns dubbletter.

### Övrigt

- Prod kör mot ett annat Container App/miljö men samma kodbas — inga kända kod-skillnader förutom env-variabler, så SEC-02-guard-logiken (auth-checks, tenantId-validering) bör bete sig identiskt. Den delen av testplanen (avsnitt 1–2) är alltså representativ för prod redan via dev-test.
- Dubbelkolla inte bara att appen fungerar, utan att **prod-migrationerna körs i rätt ordning före** prod-deployen av koden — annars pekar koden på ett schema som inte finns än (t.ex. SEC-05:s `sms_opt_out`-filter på participants-tabellen som kräver migration 0019).

## 7. Telefonnummer-validering per land (officials-invite + inloggning)

Bakgrund: tidigare validerades telefonnummer bara med `min(8)` tecken, ingen formatkontroll. Ett brittiskt nummer med 11 siffror såg ut som ett fel (svenska nummer är 10 siffror), vilket avslöjade att valideringen inte var landsmedveten. Ny lösning: `src/lib/phone.ts` med `libphonenumber-js`, en landsväljare (SE/NO/DK/FI/GB, Sverige förvalt) i både OFF-01:s "Lägg till official"-formulär och inloggningssidan, och normalisering till E.164 utan `+` (samma format som `auth.users.phone`) innan lagring — kritiskt för att inte bryta SEC-04:s telefonnummer-matchning.

- [ ] OFF-01: lägg till en official med ett **svenskt** nummer i nationellt format (`070...`, utan landskod). Förväntat: godkänns, lagras och SMS skickas som vanligt.
- [ ] OFF-01: byt landsväljaren till **Norge**, **Danmark** och **Finland** i tur och ordning, ange ett giltigt nummer för respektive land i nationellt format. Förväntat: godkänns för alla fyra länder.
- [ ] OFF-01: byt landsväljaren till **United Kingdom**, ange ett giltigt brittiskt mobilnummer (`07...`, 11 siffror nationellt). Förväntat: godkänns — detta var det ursprungliga buggfallet, ska inte längre flaggas som fel längd.
- [ ] OFF-01: ange ett nummer som är **för kort eller har fel format** för det valda landet (t.ex. ett danskt nummer medan Sverige är valt). Förväntat: fältet visar ett valideringsfel direkt i UI (`invalidPhone`), submit-knappen är avstängd, ingen POST skickas.
- [ ] OFF-01: försök skicka ett tekniskt giltigt men fel-format-nummer direkt mot `/api/officials` (förbigå UI:t, t.ex. via devtools). Förväntat: `400` med `code: "invalid_phone"`, ingen rad skapad.
- [ ] OFF-01: regression — dubblett-telefonnummer-kollen (migration 0020, se avsnitt 5) ska fortfarande ge `409 duplicate_phone` efter normalisering, inte bara på den råa inmatade strängen.
- [ ] Officials-tabellen: verifiera att befintliga rader med olika lagringsformat (med och utan `+`, t.ex. Supabase-testnumret `+46768109304` jämfört med ett nyare `46767230714`) nu visas **konsekvent formaterade** (`+46 76 810 93 04`) i tabellen, admin-account-sidan och official-account-sidan — detta är bara en visningsändring, verifiera i databasen att det **lagrade** värdet är oförändrat.
- [ ] Inloggningssidan: verifiera att landsväljaren har rätt förval baserat på webbläsarens språk (t.ex. svensk webbläsare → Sverige förvalt), och att man kan byta land manuellt innan man begär kod.
- [ ] Inloggningssidan: begär en OTP-kod med ett nummer skrivet i nationellt format (`070...` med Sverige valt). Förväntat: fungerar identiskt med att skriva `+4670...` sedan tidigare — normaliseringen sker innan `signInWithOtp` anropas.
- [ ] Inloggningssidan: verifiera att "Code sent to"-texten visar det normaliserade E.164-numret, inte den råa inmatningen.
- [ ] Regression: SEC-04:s hela invite-bekräftelse-flöde (avsnitt 3) ska fortfarande fungera för en official som bjudits in via den nya landsväljaren — dvs. att normaliseringen verkligen producerar samma sträng som `auth.users.phone` så `confirm_official_invite`-RPC:erna inte ger `phone_mismatch` på ett giltigt försök.
