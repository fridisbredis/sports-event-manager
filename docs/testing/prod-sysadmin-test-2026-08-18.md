# Manuell test i prod — system_admin

**Datum:** 2026-08-18, kompletterad 2026-08-19 (sektion 3 slutförd, sektion 4 och 5)
**Miljö:** prod, https://app.viadalevent.se
**Roll:** system_admin (enda rollraden på testnumret — verifierat via `user_roles`)
**Omfattning:** SYS-01 (tenantlista), SYS-02 (tenantdetalj), inloggning och session

Testet utgick från system_admin-rollen. Tenant_admin- och official-flödena
ligger utanför denna omgång, se "Kan inte testas i denna roll" nedan.

---

## 1. Åtkomstkontroll — KLAR

- [x] Utloggad + direkt till `/admin` → skickas till `/login`, inget innehåll läcker
- [x] Inloggning med testnumret → landar på `/admin` med tenantlistan
- [x] `/admin/<påhittat-uuid>` → 404
- [x] `/admin/inte-ett-uuid` → 404, inget rått felmeddelande

SMS kom inom sekunder från rätt avsändare (+46766900096).

## 2. Tenantlistan, SYS-01 — KLAR

- [x] Namn, slug, status-chip och tier visas för alla tenants
- [x] Status-chip grön "Active" / grå "Inactive" stämmer med data
- [x] Klick på tenantnamn → `/admin/{id}`, rätt tenant
- [x] "Deactivate" → laddningsindikering, chip slår om till "Inactive"
- [x] "Activate" tillbaka → chip slår om till "Active"
- [x] Omladdning efter växling → statusen har sparats

## 3. Skapa tenant — KLAR (F-01, F-02 och en observation)

- [x] "Create tenant" öppnar modalen med fokus i namnfältet
- [x] Tomt namn → "Create" är låst
- [x] Live-förhandsvisning "URL slug: ..." under fältet
- [x] Skapande → modalen stängs, tenanten dyker upp som Active / standard
- [x] Provisionering verifierad via SQL: ett event med `status = 'draft'` plus tre
      stages — Setup (0, non_race), Race (1, race), Teardown (2, non_race)
- [x] Samma namn igen → "A tenant with that name already exists", ingen dubblett
- [x] Enter-tangenten i namnfältet skapar tenanten
- [x] **å/ä/ö i namnet → se F-01 nedan**
- [x] Två olika namn som ger samma slug → blockerat, se F-02
- [x] `Åäö` som enda namn → "Invalid name" i fältet plus error-toast, modalen
      förblir öppen, ingen rad skapad (bekräftat i prod 2026-08-19, verifierat
      med `select ... from public.tenants order by created_at desc limit 5`)
- [x] `Åäö FK` → förhandsvisningen visar `URL slug: -fk` (icke-tom slug med
      inledande bindestreck). Endast avläst, ingen tenant skapad — se F-01.

Verifierings-SQL som användes för provisioneringen:

```sql
select t.name, t.slug, e.name as event_name, e.status,
       es.position, es.name as stage_name, es.stage_type
from public.tenants t
join public.events e on e.tenant_id = t.id
left join public.event_stages es on es.event_id = e.id
where t.slug = '<slug>'
order by es.position;
```

## 4. Tenantdetalj, SYS-02 — KLAR (F-03 avfärdad)

- [x] Rubrik visar tenantnamn, "← Tenants" leder tillbaka till listan
- [x] Aktiveringsväxeln speglar status, hjälptexten byter mellan "can access" / "cannot access"
- [x] Slå av → ladda om → fortfarande av
- [x] Byt tier till premium → bara en radioknapp vald
- [x] Ladda om → premium kvarstår
- [x] Tillbaka till `/admin` → Tier-kolumnen visade **premium**, det nya värdet,
      utan hårdladdning. F-03 avfärdad (2026-08-19).

## 5. Session — GENOMTESTAD (en punkt fallerad: F-06, plus F-07)

- [x] Omladdning av `/admin` → fortfarande inloggad
- [x] "Log out" i sidomenyn → hamnar på `/login`
- [ ] Bakåtknapp efter logout → kommer inte in i `/admin` igen —
      **FALLERAT 2026-08-19, se F-06.** Vyn återställs cachad; först vid en
      klickning sker ett serveranrop som skickar till `/login`, och därefter går
      det att trycka bakåt igen och se vyn på nytt.
- [x] Fel OTP-kod → fel visas och ingen inloggning sker (2026-08-19). Röd toast
      med **"Token has expired or is invalid"**, kvar på kodsteget, och
      `/admin` i ny flik ledde till inloggningssidan — ingen session skapad.
      Godkänd på funktionen, **men "tydligt" brister: se F-07.**
- [x] Ny kodbegäran → nytt SMS kom, och den gamla koden slutade fungera
      (2026-08-19). Kod A avvisades med `403 { "code": "otp_expired" }`, kod B
      loggade in. Ingen spärr slog in vid två begäranden i följd.
      Notera att UI:t saknar en egen "skicka igen"-knapp — se observationen nedan.

Avsnitt 3 (Fel-fall) och 4 (Session) i `prod-sms-login-checklist.md` är
rollagnostiska och bockas av här. Avsnitt 4:s andra punkt är just den som
fallerar — se F-06.

---

## Fynd

### F-01 — `toSlug` tar bort å/ä/ö istället för att translitterera (BETEENDE BEKRÄFTAT, KLASSIFICERING ÖPPEN)

`src/app/(system)/admin/_utils.ts` filtrerar bort allt utanför `a-z0-9-` utan
föregående translitterering. Bekräftat mot live-förhandsvisningen i modalen:

| Namn               | Slug              |
| ------------------ | ----------------- |
| `Växjö Löpning`    | `vxj-lpning`      |
| `Åre Skidfestival` | `re-skidfestival` |
| `Umeå`             | `ume`             |
| `Åäö`              | tom sträng        |
| `Åäö FK`           | `-fk`             |

Slugen sitter i den publika URL:en (`app.viadalevent.se/<slug>/...`), alltså
den adress funktionärer och deltagare får skickad till sig. För svenska
klubb- och tävlingsnamn är detta inte kosmetiskt.

**Ingen befintlig tenant i prod har å/ä/ö i namnet** — kontrollerat 2026-08-18.
En eventuell ändring kräver därför ingen slug-migrering och bryter inga
befintliga länkar.

**Klassificering (Frida, 2026-08-19):** att å/ä/ö filtreras bort är inte en bugg
— `toSlug` gör exakt vad koden säger, och beteendet är byggt så med flit. Fyndet
står kvar som dokumenterat beteende, inte som defekt. Beslut om åtgärd tas
separat och är inte fattat.

Två separata utfall, som kan bedömas olika:

1. **Tecken faller bort men sluggen blir användbar** — `Växjö Löpning` →
   `vxj-lpning`. Fungerande URL, ful men inte trasig. Höjer risken för
   slugkollisioner (`Malmö` och `Malm` ger samma slug), vilket landar i F-02.
2. **Sluggen får trasig form eller blir tom** — `Åäö` → tom sträng, avvisas med
   "Invalid name" och namnet går alltså inte att använda alls. `Åäö FK` → `-fk`,
   som är icke-tom och därför skapas rakt igenom, med `/-fk` som publikt
   URL-segment. Inledande bindestreck är inte den form teckenfiltret försöker
   producera.

Om åtgärd senare beslutas: translitterera med explicit karta för `å ä ö ø æ ß`
plus `normalize('NFD')` för övrig diakritik, före teckenfiltreringen, samt
kollapsa och trimma bindestreck. Ger `Växjö Löpning` → `vaxjo-lopning`,
`Åäö` → `aao`, `Åäö FK` → `aao-fk`. **Regressionsnot:** efter en sådan ändring
gäller inte längre "Invalid name" för `Åäö` — då ska tenanten skapas.

### F-02 — 23505-meddelandet pekar på fel kolumn (BEKRÄFTAD)

`0001_initial_schema.sql:8` har `unique` på **slug**, inte på namn. `createTenant`
översätter 23505 till _"A tenant with that name already exists"_. Två olika namn
som kollapsar till samma slug ger alltså ett felmeddelande som påstår att namnet
är upptaget, vilket är falskt. Hänger ihop med F-01: utan translitterering
kollapsar fler namnpar än nödvändigt.

Reproducerad i UI 2026-08-18: befintlig tenant med slug `eddo-testar`, försök att
skapa `EDDO TESTAR` (annan namnsträng, annat skiftläge, identisk slug) blockerades
med _"A tenant with that name already exists"_. Namnen skiljer sig — meddelandet
stämmer inte. Ingen tenant skapades.

### F-03 — Tier-kolumnen på `/admin` kan visa gammalt värde (AVFÄRDAD)

Misstanken var att `setTenantTier` bara anropar `revalidatePath('/admin/' + tenantId)`
och inte `revalidatePath('/admin')`, till skillnad från `setTenantActive` som
revalidar båda, och att tenantlistans Tier-kolumn därför skulle visa gammalt
värde till nästa hårdladdning.

Testat i prod 2026-08-19: tier bytt till premium på detaljsidan, "← Tenants"
tillbaka till listan utan omladdning — kolumnen visade **premium** direkt.

Varför den uteblivna revalideringen inte biter: `src/app/(system)/layout.tsx`
anropar `supabase.auth.getUser()` via `createSupabaseServerClient()`, som läser
`cookies()`. En layout som läser cookies tvingar dynamisk rendering av allt under
sig, så `/admin` cachas aldrig och frågan mot `tenants` körs om vid varje
rendering. Det finns inget `export const dynamic`/`revalidate` i `(system)` och
ingen middleware. `/admin/page.tsx` använder `createSupabaseServiceClient`, som
är cookie-fri, så sidan har i sig inget dynamiskt API — det är layoutens
auth-gate som gör den dynamisk.

**Lägg inte till `revalidatePath('/admin')` i `setTenantTier` för att "fixa"
detta.** Asymmetrin mot `setTenantActive` är kosmetisk så länge auth-gaten sitter
i layouten. Skulle gaten någon gång flyttas till middleware blir `/admin`
statiskt cachningsbar och då återuppstår risken — värt att komma ihåg vid en
sådan refaktorering.

### F-04 — Tyst fel vid växling från listan (EJ TESTAD, svår att provocera)

`tenant-list.tsx` `handleToggleActive` ignorerar `result.error` och visar ingen
toast. Misslyckas anropet ser användaren ingenting. `tenant-detail.tsx` gör rätt
och anropar `toastError`.

### F-05 — `createTenant` rullar inte tillbaka vid delvis fel (EJ OBSERVERAD)

Misslyckas event- eller stage-insert efter att tenantraden skapats returneras ett
fel, men tenantraden ligger kvar. Resultatet blir en tenant utan event. Inte
observerat under testet — provisioneringen verifierades som korrekt.

### F-06 — Bakåtknappen efter logout visar cachad inloggad vy (BEKRÄFTAD)

Observerat i prod 2026-08-19 som system_admin: efter "Log out" hamnar man på
`/login`, men bakåtknappen visar `/admin` igen med tenantlistan renderad. Vyn är
död — vid första klick sker ett serveranrop som skickar till `/login`. Därefter
går det att trycka bakåt på nytt och se vyn igen.

Mekanism, verifierad i koden: `(system)/admin/_components/sidebar-nav.tsx:13-17`
gör `await supabase.auth.signOut()` följt av `router.push('/login')`.
`router.push` är en mjuk navigering — Next.js klient-Router-Cache behåller det
renderade `/admin`-trädet i minnet och historikposten ligger kvar, så en
bakåtnavigering återställer trädet utan serveranrop. Auth-gaten i
`(system)/layout.tsx` körs därmed aldrig. Samma mönster finns i
`(tenant)/[tenantSlug]/admin/_components/sidebar-nav.tsx:51-56`, alltså gäller
fyndet båda adminytorna.

Konsekvens: ingen behörighet kvarstår — varje anrop mot servern går till `/login`
och sessionscookien är rensad, så inga nya data kan hämtas. Vad som kvarstår är
**redan renderad tenantdata i webbläsarens historik tills fliken stängs**: namn,
slug, status och tier för samtliga tenants. På en delad eller publik dator kan
nästa person trycka bakåt och läsa listan. Det är den klassiska
"bakåtknapp efter logout"-läckan (WSTG-ATHN-06), inte en
behörighetseskalering.

Föreslagen riktning: byt `router.push('/login')` mot
`window.location.replace('/login')` i båda sidomenyerna. `replace` gör dels en
hård navigering, vilket river hela klient-Router-Cachen, dels ersätter den den
aktuella historikposten så att `/admin` inte längre går att nå bakåt.

Notera också att `src/app/api/auth/signout/route.ts` finns men **inte anropas
från någonstans** — död kod. Den gör dessutom utloggningen på en `GET`, vilket
inte bör kopplas in som det står: en tillståndsändring på GET kan triggas av
prefetch eller länkförhandsvisning. Ska den användas bör den bli `POST`.

Osäkerhet värd att nämna: att den hårda navigeringen räcker i alla webbläsare är
inte verifierat. Chrome kan lägga sidor med `Cache-Control: no-store` i sin
bfcache men vräker dem när cookies ändras, vilket signOut gör — men det bör
testas om i prod efter en fix, inte antas.

### F-07 — Inloggningen visar Supabases råa felmeddelande, inte den översatta strängen (BEKRÄFTAD)

Observerat i prod 2026-08-19: fel OTP-kod ger en röd toast med texten
**"Token has expired or is invalid"**. Ingen inloggning skedde, felet är synligt
— men texten är Supabases egen, på engelska, och slår ihop två olika orsaker.
Användaren får ingen ledtråd om koden var felskriven eller för gammal, alltså
inte om hen ska skriva om den eller begära en ny.

Svaret från GoTrue, avläst i nätverksfliken:

```
HTTP 403
{ "code": "otp_expired", "message": "Token has expired or is invalid" }
```

403 är förväntat vid ogiltig token. Att det finns ett maskinläsbart `code` är
viktigt för fixen — se nedan.

Mekanism, verifierad i koden: `(auth)/login/page.tsx:33-41` har en delad
`request()`-hjälpare som gör `toastError(error.message)` — provider-texten går
rakt ut i UI:t. Det gäller **båda** anropen, alltså både `verifyOtp` (fel kod)
och `signInWithOtp` (misslyckad kodbegäran, t.ex. spärr eller ogiltigt nummer).

Två saker gör det till en tydlig defekt och inte en smaksak:

1. **Den översatta strängen finns redan och används inte.**
   `public/locales/en/auth.json:16` har `signIn.invalidCode` = "Invalid code.
   Please try again." och rad 17 `signIn.error`. Ingen av dem anropas från
   `login/page.tsx`. `invite/[token]/_components/invite-form.tsx:50` gör det rätt
   med `toastError(t('confirmation.invalidCode'))` — mönstret finns alltså i
   projektet, inloggningssidan följer det bara inte.
2. **Det bryter mot projektregeln** i CLAUDE.md: _"Never expose raw errors to the
   client."_

Separat men relaterat: `public/locales/sv/` innehåller **bara `common.json`**.
Det finns ingen `sv/auth.json`, så inloggningssidan har ingen svensk
översättning alls — även de korrekt översatta nycklarna faller tillbaka på
engelska. Relevant eftersom `prod-sms-login-checklist.md` går till en
svensktalande testare.

Föreslagen riktning: låt `request()` inte skicka vidare provider-texten. Mappa på
`error.code` till översatta nycklar och logga den råa texten till konsolen, så att
felsökningsvärdet inte försvinner:

| `error.code`                                           | Meddelande                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| `otp_expired`                                          | "Fel eller för gammal kod. Begär en ny kod och försök igen." |
| `over_sms_send_rate_limit` / `over_request_rate_limit` | eget meddelande om att vänta                                 |
| allt annat                                             | `signIn.error` som fallback                                  |

Viktig begränsning: GoTrue använder `otp_expired` för **både** felskriven och
utgången kod, så inte ens koden skiljer fallen åt. Meddelandet måste därför täcka
båda, och "begär en ny kod" är det enda rådet som är korrekt i båda fallen. Att
försöka formulera sig som om vi visste vilket det var blir fel i hälften av
fallen.

Lägg samtidigt upp `public/locales/sv/auth.json`. Verifiera att `code` och
`status` finns på `AuthError` i den `supabase-js`-version projektet använder
innan mappningen skrivs — det är avläst i prod-svaret, inte i typerna.

Allvarlighet: ingen säkerhetspåverkan — GoTrues OTP-fel avslöjar inget om huruvida
numret finns, och ingen session skapades. Det är ett UX- och regelbrott.

### Ej ett fel — rollseparation mellan system_admin och tenant_admin

Det finns ingen navigering från system-adminytan in i en tenants adminvy.
SYS-01 länkar till `/admin/{tenantId}` (SYS-02) och SYS-02 bara tillbaka till
`/admin`. Detta är avsiktlig rollseparation, inte en trasig kedja: system_admin
förvaltar tenants, tenant_admin driver verksamheten inuti en tenant. Att
`requireTenantAdmin` och RLS har `is_system_admin()`-grenar handlar om
dataåtkomst för support, inte om en navigeringsväg. **Lägg inte till en länk.**

### Övrigt att känna till

Det finns ingen `deleteTenant`. `(system)/admin/actions.ts` exporterar bara
`createTenant`, `setTenantActive` och `setTenantTier`. Allt som skapas i prod
blir kvar permanent och kan endast avaktiveras.

**Det finns ingen "skicka igen"-knapp på kodsteget** (observation, ej klassad som
fynd). `(auth)/login/page.tsx:139-146` har bara `changeNumber` ("Use a different
number"). Enda vägen till ett nytt SMS är alltså att gå tillbaka till
nummersteget och begära kod på nytt — vilket fungerar, och den gamla koden
ogiltigförklaras korrekt. Men om det första SMS:et aldrig kom är det inte
självklart för en användare att vägen till ett nytt går via "byt nummer".
`prod-sms-login-checklist.md` beskriver dessutom steget som _"skicka igen"_, vilket
inte motsvarar något i UI:t. Om det ska åtgärdas: en egen "Skicka ny kod"-knapp på
kodsteget som anropar `sendOtp()` igen.

**Modalen varnar inte när namnet ger tom slug** (observation, ej klassad som
fynd). När `toSlug` returnerar tom sträng försvinner raden `URL slug: ...` och
hjälptexten faller tillbaka på "This provisions an empty event draft for the
tenant.". Create är fortfarande klickbar — den låses bara på `!name.trim()` — så
felet kommer först från servern som "Invalid name". Gäller alla namn utan
tillåtna tecken, exempelvis `!!!` eller `---`, och är oberoende av hur F-01
avgörs. Om det ska stramas åt: sätt `isInvalid` och lås Create redan i
`create-tenant-modal.tsx` när namnet är ifyllt men sluggen tom.

---

## Kan inte testas i denna roll

- **Tenant_admin-inloggning** (punkt 2 i `prod-sms-login-checklist.md`) — kräver
  ett konto med tenant_admin-roll. Det finns ingen UI för att tilldela rollen;
  den skapas manuellt med en `user_roles`-insert mot prod-Supabase.
- **Official-invite och HOME-01-landning** — kräver ett separat telefonnummer.
- **Spärr för avaktiverad tenant** — `hasAdminAccessToTenant` släpper igenom
  system_admin även för inaktiva tenants med flit, så spärren kan bara
  verifieras som tenant_admin.

`ROLE_PRIORITY` är `system_admin` 1, `tenant_admin` 2, `official` 3,
`participant` 4. Högst prioriterade roll avgör landningssidan, så ett nummer kan
inte testa två roller samtidigt — rollraden måste tas bort emellan, eller så
används olika nummer.

---

## Nästa steg

**Prod-testomgången är avslutad 2026-08-19.** Sektion 1–5 genomtestade i den
omfattning system_admin-rollen tillåter. Inga kodändringar gjordes under testet.

1. **Åtgärda F-06** i egen session (Coder → Reviewer). Två filer, samma ändring i
   båda: `(system)/admin/_components/sidebar-nav.tsx` och
   `(tenant)/[tenantSlug]/admin/_components/sidebar-nav.tsx`. Testa om i prod
   efteråt — det är ett webbläsarbeteende, enhetstest räcker inte.
2. **Åtgärda F-07** i egen session (Coder → Reviewer). `(auth)/login/page.tsx`
   plus ny `public/locales/sv/auth.json`. Kan gå ihop med F-06 — samma
   auth-område, men två skilda filer och två skilda orsaker, så låt Reviewer se
   dem som en avgränsad ändring var.
3. **Besluta om F-01 ska åtgärdas eller stå kvar som avsett beteende.** Sektion 3
   är färdigtestad — beslutet är inte fattat och ingen kod ska ändras innan det
   är taget.
4. Åtgärda F-02 i egen session (Coder → Reviewer) — meddelandet ska peka på slug,
   inte namn. Fristående från F-01-beslutet, en fil: `actions.ts`.
5. Tenant*admin- och official-flödena enligt `prod-sms-login-checklist.md`, med
   ett separat telefonnummer. F-06 är inlagt som känt fel i checklistans avsnitt 4
   (2026-08-19) — **ta bort den noten när F-06 är åtgärdat**, annars slutar
   testaren rapportera ett fel som ska vara borta. Checklistans avsnitt 3 säger
   *"skicka igen"\_, ett steg som inte finns i UI:t — formuleringen behöver rättas
   till vägen via "Use a different number" innan checklistan skickas ut.

Kvarstående ej testade fynd: F-04 och F-05, båda svåra att provocera manuellt.
Se respektive avsnitt — enhetstester är rimligare än prod-försök.
