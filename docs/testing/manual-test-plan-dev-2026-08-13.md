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

- [ ] I ett server action-anrop (t.ex. publicera event, redigera scheman/workstations), försök skicka ett malformat `tenantId` (t.ex. via devtools-nätverksflik, ändra payload till en icke-UUID-sträng eller en OR-injektionssträng).
- [ ] Förväntat: request avvisas direkt (valideringsfel), inte ett 500 eller — värre — genomsläpp till fel tenants data.
- [ ] Verifiera normalflödet fortfarande funkar: publicera ett event, redigera ett schema, redigera en workstation — allt som tenant_admin i din egen tenant.

## 3. SEC-04 — telefonnummer måste faktiskt tillhöra personen (official invite)

- [ ] Skapa en ny official-invite med ett telefonnummer.
- [ ] Bekräfta inbjudan (`/officials/confirm`-flödet) med **testtelefonnumret som faktiskt fick SMS:et**. Förväntat: fungerar, official kopplas till rätt user.
- [ ] Försök bekräfta samma inbjudan igen, eller med ett **annat** telefonnummer än det som bjöds in. Förväntat: nekas — kan inte kapa någon annans invite.
- [ ] Verifiera RPC-flödet end-to-end (två nya migrations: 0017 confirm_official_invite_rpc, 0018 confirm_official_invite_by_phone_rpc) — dvs. att en official verkligen hamnar med rätt `user_id` kopplad efter bekräftelse, inte bara att UI:t säger OK.

## 4. SEC-05 — sms_opt_out respekteras vid annonser

Bakgrund: officials sms_opt_out lades till i SEC-04 men användes aldrig vid utskick; SEC-05 lägger till samma kolumn för participants och filtrerar båda.

- [ ] Sätt `sms_opt_out = true` på en testofficial och en test-participant-rad (participanter skapas/hanteras via tenant_admin-UI eller direkt i DB — de loggar inte in själva än, men raden och telefonnumret används för SMS-utskick).
- [ ] Skicka en announcement till **officials**-kanalen. Förväntat: opt-out-officialen får **ingen** SMS; övriga officials får SMS som vanligt.
- [ ] Skicka en announcement till **participants**-kanalen. Förväntat: opt-out-participantraden får **ingen** SMS; övriga får SMS.
- [ ] Verifiera att announcementen ändå sparas/publiceras korrekt i UI (opt-out ska bara påverka SMS-leverans, inte announcement-posten själv).
- [ ] Regression: en official/participant **utan** opt-out ska fortfarande få SMS som tidigare.

## 5. Allmän regressionsrunda (låg risk, men rör kärnflöden)

- [ ] Logga in som tenant_admin: bekräfta att EVT-01/EVT-02, WS-01/WS-02, OFF-01, SCHED-01, COMM-01 laddar och fungerar som innan.
- [ ] Logga in som system_admin (SYS-01/SYS-02 om byggda): åtkomst till flera tenants fungerar.
- [ ] SMS-OTP-inloggning (testnumret) fungerar fortfarande end-to-end.

---

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

### Övrigt

- Prod kör mot ett annat Container App/miljö men samma kodbas — inga kända kod-skillnader förutom env-variabler, så SEC-02-guard-logiken (auth-checks, tenantId-validering) bör bete sig identiskt. Den delen av testplanen (avsnitt 1–2) är alltså representativ för prod redan via dev-test.
- Dubbelkolla inte bara att appen fungerar, utan att **prod-migrationerna körs i rätt ordning före** prod-deployen av koden — annars pekar koden på ett schema som inte finns än (t.ex. SEC-05:s `sms_opt_out`-filter på participants-tabellen som kräver migration 0019).
