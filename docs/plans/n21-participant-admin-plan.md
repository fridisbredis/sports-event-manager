# N21 — Deltagar-admin (PART-01): implementationsplan

**Kort:** N21 "Participants admin (PART-01): import from Race Results", arbetspaket
v1.5 (artifact `2eBcTpeqoyiSx54gCxxR2h`, item `N21`).
Tier: Premium och Professional.
**Status:** plan, inte påbörjad. Skriven 2026-10-16 mot `main` @ `e814e36`.
Kortets text är läst ur artifactens databas, inte ur PDF-översikten.

**Kortet står på `Question for Peter` sedan 2026-10-19.** De tre frågorna i §2 är
ställda som kommentarer på kortet. Fråga 2 blockerar steg 1; fråga 1 utreder jag
själv; fråga 3 ligger som förslag hos Peter.

---

## 1. Utgångsläge — verifierat, inte antaget

| Påstående                                 | Verifierat                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `participants` finns sedan migration 0001 | Ja — `supabase/migrations/0001_initial_schema.sql`                                                                                                                                                                                                                                    |
| Kolumner i dev live                       | `id, tenant_id, user_id, name, phone, bib, category, race_results_url, created_at, sms_opt_out, privacy_accepted_at, gdpr_warning_sent_at`                                                                                                                                            |
| `name` och `phone` är `NOT NULL`          | Ja, i live-schemat (dev) — inte bara i migrationsfilen                                                                                                                                                                                                                                |
| RLS på `participants`                     | **Live** (dev): `tenant_admin_manage_participants` (ALL) har redan `OR is_system_admin()`; `participant_read_own` (SELECT) på `user_id = auth.uid()`. Migrationsfilen 0002 saknar `is_system_admin()` — live är alltså nyare än filen. Ingen `tenant_member_read_participants` finns. |
| Enda index                                | `(tenant_id)` — `0001_initial_schema.sql:88`                                                                                                                                                                                                                                          |
| `participant`-rollen                      | Finns i `user_roles`-CHECK (`0001:33`) och i `resolvePostLoginRedirect` (`src/lib/auth/tenant.ts:63`), men rutten `/<tenant>/participant` existerar inte                                                                                                                              |
| Deltagare i prod                          | **0 rader** — ingen bakåtkompatibilitet att ta hänsyn till                                                                                                                                                                                                                            |
| Ingen app-kod rör deltagare               | `race_results_url` förekommer bara i `src/types/database.ts`                                                                                                                                                                                                                          |
| Race-etapp identifieras av                | `event_stages.stage_type = 'race'`                                                                                                                                                                                                                                                    |

### Två fynd som planen bygger på

**a) `phone NOT NULL` blockerar hela kortet.** Peter valde väg 2 (import utan
telefonnummer). Det går inte att skriva en enda importerad rad förrän kolumnen
är nullable. Detta är steg 1.

**b) Latent bugg i GDPR-anonymiseringen.** `anonymize_inactive_users()`
(migration 0029) kör `update public.participants set name = null, phone = null`
mot en tabell där båda är `NOT NULL`. Verifierat mot den live-deployade
funktionskroppen i dev, inte bara migrationsfilen. Den har aldrig smällt
eftersom `where`-satsen kräver `p.user_id is not null` och ingen deltagare har
någonsin haft ett `user_id` (deltagarinloggning finns inte). Steg 1 gör `phone`
nullable och tar därmed bort halva felet; `name` bör göras nullable i samma
migration, annars ligger buggen kvar och väntar på den dag deltagarinloggning
införs. Det är samma migration, samma tabell, samma resonemang — rätt ställe att
städa det.

---

## 2. Kortets tre frågor

Alla tre är ställda som kommentarer på kortet 2026-10-19, med analysen nedan som
underlag. Fråga 1 och 2 är **förutsättningar för datamodellen** — de avgör hur
nyckeln ser ut. Fråga 3 är ett förslag hos Peter.

**1. "Does the API give a stable participant ID, and do fields differ between
races? Check one more race than Viadal."**
Utredningsuppgift, hör till steg 2 och kräver inget av vårt schema. Spiken
tittade bara på Viadal (`361004`). Att kolla minst ett lopp till är poängen —
fältuppsättningen (`BIB`, `FLNAME`, `NATION.FLAG`, `KonM/K`, `AGEGROUP.NAME`,
`CLUB`) är sannolikt konfigurerad per lopp, inte global. **Svaret avgör om
`external_id` i steg 1 överhuvudtaget kan vara unik nyckel.** Om API:et inte ger
ett stabilt ID faller upsert-strategin och återimporten måste matcha på
`(bib, stage)` i stället, med de krockar det innebär.

**2. "Same person in two Race stages with different Race Results links: one entry
with two stages, or two entries?"**
Detta är den enda fråga som ändrar tabellformen, och den avgör steg 1:

- _Två rader_ (en per etapp): `stage_id` som kolumn på `participants`, precis som
  planen nedan beskriver. Enkelt, men samma person finns flera gånger och ett
  framtida användarkonto måste kopplas till flera rader.
- _En rad med flera etapper_: kräver en kopplingstabell
  `participant_stages (participant_id, stage_id)` och att identiteten blir
  person, inte anmälan.

Kortet säger "Several Race stages = one merged list, each entry keeps its Race
stage" och "Model prepared for linking a user account later". Formuleringen
"each entry keeps its Race stage" (singular) lutar åt två rader, men
"förberedd för användarkoppling" lutar åt det motsatta. **Fråga Peter innan
steg 1 skrivs** — det är dyrt att byta efteråt.

Min rekommendation: kopplingstabell. En person som springer två etapper är en
person, och det är den modellen som bär telefonkoppling och inloggning senare
utan en till migration.

**3. "On re-run, people no longer on the Race Results list (struck): not decided,
please propose."**
Mitt förslag: **markera, radera aldrig.** Lägg till `withdrawn_at timestamptz`
som sätts när en rad som tidigare kom från Race Results saknas i ett nytt svar.
Raden ligger kvar, visas nedtonad med en "struken"-markering och filtreras bort
som standard. Skälen:

- en radering är inte återställbar om importen kördes mot fel lopp eller ett
  halvt API-svar
- samma resonemang som `remove_official` (0025) och GDPR-anonymiseringen (0029)
  redan använder i den här koden: behåll raden, flagga tillståndet
- en struken deltagare kan komma tillbaka; då nollas `withdrawn_at` igen
- manuellt tillagda rader (`source = 'manual'`) ska aldrig strykas av importen

### Fortfarande öppet (blockerar inte start)

- **`docs/gap-list-v1.5.md` och `docs/open-actions-v1.5.md`** (kortets `source`
  pekar på O14–O20 och F21) finns inte i repot. Be Peter om dem om något nedan
  känns underbestämt.
- **PART-01 finns inte som skärmspec.** `docs/ia/screen-map.md` har bara
  deltagarskärmar som placeholders (☐). Kortet säger "built like the officials
  roster", vilket är den förlaga planen använder.

---

## 3. Stegen

Varje steg är en egen commit. Branch: `feat/n21-participant-admin`.

### Steg 1 — Migration: gör importen möjlig

Ny migration (timestamp-namn, med Forward-fix-block i headern enligt
konventionen från 0033).

```sql
alter table public.participants alter column phone drop not null;
alter table public.participants alter column name  drop not null;
```

**Om `phone`: kortet säger "phone (always present, empty until filled)".** Det
beskriver _fältet i UI:t_ — kolumnen ska alltid visas, aldrig döljas — inte att
kolumnen måste vara `NOT NULL`. Alternativet vore `default ''`, men en tom
sträng som "inget telefonnummer" är sämre: den är osann mot
`get_user_id_by_phone`-uppslagen och mot den framtida telefonkopplingen, och
`''` kan dessutom råka bli unik-krockande om vi någonsin indexerar på phone.
NULL betyder "okänt", vilket är exakt vad det är. UI:t visar tomt fält i båda
fallen. Nämn valet för Peter om han läser migrationen bokstavligt.

Plus de nya kolumnerna kortet kräver:

- `club text`
- `nation text` — lagra landskoden (`IS`), inte Race Results `[img:...]`-strängen
- `gender text` — `KonM/K` ger `M`/`K`
- `stage_id uuid references public.event_stages(id) on delete cascade` — varje
  rad visar vilken etapp den hör till (**förutsatt svaret "två rader" på fråga 2
  — annars kopplingstabell i stället, se §2**)
- `source text not null default 'manual'` — `'manual' | 'race_results'`, så
  återimporten vet vilka rader den äger
- `external_id text` — Race Results radidentitet, för upsert vid återimport
  (**förutsatt att fråga 1 bekräftar ett stabilt ID**)
- `extra jsonb not null default '{}'` — kortets "Remaining Race Results fields
  stored as 'other' and shown read-only". jsonb just för att fältuppsättningen
  skiljer sig mellan lopp (fråga 1) — det är precis vad kolumnen ska absorbera.
  Kortet säger uttryckligen **"No 'add column' function"**: `extra` renderas som
  text, aldrig som redigerbara fält, och adminen kan inte befordra en nyckel till
  en riktig kolumn.
- `withdrawn_at timestamptz` — struken ur Race Results-listan, se förslaget på
  fråga 3 i §2

`category` används för kortets "class" (`AGEGROUP.NAME`) — kolumnen finns redan
sedan 0001 och behöver inte döpas om.

Index: `(tenant_id, stage_id)` för listan, och en unik partiell nyckel för
upserten:

```sql
create unique index participants_rr_identity
  on public.participants (tenant_id, stage_id, external_id)
  where source = 'race_results';
```

**Varför unikt på `external_id` och inte på `bib`:** startnummer återanvänds
mellan etapper, och kortet säger att alla etapper ska bli en gemensam lista.
Unikt på bib per tenant skulle krocka så fort två etapper har en startnummer-1.

**Lägg också till `WITH CHECK` på `tenant_admin_manage_participants`.** Policyn
har bara `USING` idag. För en `FOR ALL`-policy betyder det att `USING` används
som fallback vid INSERT i Postgres — men det är implicit, och vi är på väg att
göra tabellen skrivbar på riktigt för första gången. Skriv ut det.

Verifiera efter push mot `information_schema` — `db push` matchar på nummer och
hoppar tyst över kolliderande migrationer.

### Steg 2 — Race Results-klienten (ren, testbar, utan DB)

**Källan är `event_stages.results_url`, inte ett separat event-ID.** Kortet:
"Import from the Race Results participant list of every Race stage's Race Results
link (from event config)". Den kolumnen finns redan (migration 20261013093537,
kort N7, status `done`) och fylls i EVT-02:s etappdialog. Importen ska alltså:

1. läsa alla etapper med `stage_type = 'race'` och `results_url is not null`
2. extrahera Race Results event-ID ur varje URL
3. hämta deltagarlistan per etapp

Det betyder att **ingen ny kolumn för event-ID behövs** — men också att importen
är beroende av att adminen har fyllt i länken per etapp. Saknas den, ska UI:t
säga det tydligt ("ingen Race Results-länk på den här etappen") i stället för att
visa en tom import.

Att parsa ut event-ID ur URL:en är en egen liten funktion med egna tester:
länkarna admins klistrar in kommer i flera former (`my.raceresult.com/361004/`,
`.../361004/participants#0_66036E`, med eller utan `https://`).

`src/lib/race-results/client.ts`. Tvåstegsanropet från spiken:

1. `GET https://my.raceresult.com/<eventId>/RRPublish/data/config?page=participants`
   → plocka `key` och värdservern
2. `GET https://<server>/<eventId>/RRPublish/data/list?key=<key>&listname=...&contest=0&r=all`

Fallgropar som spiken redan betalat för att lära sig, och som måste kodas:

- `my.` svarar 301 — redirecten **måste** följas till den server configen pekar ut
- `key` är obligatorisk; utan den: `{"error":"no key given"}`
- svaret är positionsbaserat per `listname` — fältordningen är inte garanterad
  mellan listor, så mappa via configens fältnamn, hårdkoda inte index

`src/lib/race-results/parse.ts` — ren funktion, rådata → `ParsedParticipant[]`.
Här hör enhetstesterna hemma, med en committad fixtur av ett verkligt svar.
Normalisera `NATION.FLAG` (`[img:/graphics/flags/IS.svg]` → `IS`) här.

**Bär risken från spikens §6 vidare:** API:et är odokumenterat och okontrakterat.
Därför manuell import på admins kommando, aldrig en live-synk. Varje nätverksfel
ska ge ett översatt felmeddelande, inte en kraschad sida (jfr F-REL-10 — tysta
frågefel som renderade tomt).

### Steg 3 — Tier-grind

`src/lib/tiers/features.ts`: lägg till `participants: 'premium'` i
`TIER_FEATURES`. Modellen är cumulative, så "Premium och Professional" blir
exakt rätt, och `tiersWithFeature` genererar SYS-02-beskrivningen automatiskt.

Till skillnad från N18 (ren läsvy) har N21 **mutationer**. Grinden måste därför
sitta på två ställen — jfr kommentaren i
[scheduling/page.tsx:172-177](<src/app/(tenant)/[tenantSlug]/admin/scheduling/page.tsx#L172-L177>):

1. sidan/navigationen (Standard ser ingen deltagarflik alls)
2. **varje server action** — annars kan en Standard-tenant posta direkt mot den

### Steg 4 — Sidan (PART-01)

`src/app/(tenant)/[tenantSlug]/admin/participants/page.tsx`, speglad på
officials-sidan: `getAdminTenant(tenantSlug)`, RLS-klient via
`createSupabaseServerClient` (inte service role — se SEC-03), `notFound()` när
tenant saknas.

**Pagination, inte bara ett tak.** Officials använder `checkReadCeiling` med ett
tak på 500 och motiverar det med 10–15 funktionärer. Deltagare är en annan
storleksordning: 42 i dag för Viadal, men ingen övre gräns i sak.
`checkReadCeiling` säger själv i sin docstring att den inte är pagination.
Använd `src/lib/pagination.ts` (mönstret finns på communication- och
announcements-sidorna) — och behåll `checkReadCeiling` som skyddsnät ovanpå.

Kolumner enligt kortets "core fields": startnummer, namn, klass, klubb, nation,
kön, telefon (alltid synlig, tom tills vidare) och Race-etapp. `extra`-fälten
visas read-only, utan möjlighet att göra dem till kolumner. Filter på etapp, och
ett filter som döljer strukna (fråga 3). Mobil: samma responsiva ansats som de
nyss landade admin-skärmarna (`#298`, `#299`).

UI-komponenter: `Input/Select` m.fl. från `@/components/ui/form-fields` och
`AppCard`/`CARD_SURFACE` — aldrig rå HeroUI, aldrig egna `rounded-xl`.

**Kopiera inte OFF-01:s N+1-mönster.** Officials-sidan hämtar detaljrader med
`Promise.all` över hela listan
([page.tsx:52-62](<src/app/(tenant)/[tenantSlug]/admin/officials/page.tsx#L52-L62>))
och kommentaren där säger uttryckligen att det bara är försvarbart vid 10–15
rader. Deltagarlistan är större — allt som ska visas per rad måste komma med i
huvudfrågan.

Registrera i navigationen: en rad i
`src/app/(tenant)/[tenantSlug]/admin/_components/sidebar-nav.tsx` (jfr `:63`),
bakom samma tier-grind som sidan.

### Steg 5 — Importflödet

**Välj server actions, inte route handlers.** Kortet säger "byggd som
officials-sidan", men OFF-01 muterar via REST-route handlers
(`src/app/api/officials/*`) — det är projektets _äldre_ mönster. Allt nyare
(workstations, event, N20:s system-admin) använder server actions. Följ
officials-sidan i _utseende och sidstruktur_, inte i mutationsmekanik.

Server action i `.../participants/actions.ts`: zod-validering,
`hasAdminAccessToTenant`, `hasFeature(tier, 'participants')`, `translateDbError`.
Returform `{} | { error: string }` — tom objektlitteral vid succé, inte
`{ ok: true }`. Avsluta med `revalidatePath` + `updateTag` (inte
`revalidateTag`), enligt mönstret i
`src/app/(tenant)/[tenantSlug]/admin/workstations/actions.ts`.

Flödet: admin väljer etapp(er) bland dem som har en Race Results-länk →
förhandsgranskning ("12 nya, 30 uppdaterade, 2 strukna") → bekräfta → skriv.
Förhandsgranskningen är inte pynt: API:et är okontrakterat, och adminen ska se
vad som kommer att hända innan en etapp skrivs över.

**Skrivningen måste vara en RPC, inte en sekvens av `.insert()`.** Importen rör
många rader över flera etapper; en halvt genomförd import är precis det
`docs/patterns/atomic-multi-table-writes.md` (REL-01) finns för. En
`import_participants(p_tenant_id, p_stage_id, p_rows jsonb)` som gör
`insert ... on conflict (tenant_id, stage_id, external_id) do update` ger både
atomicitet och återimport-semantiken kortet beskriver: nya läggs till, ändrad
data skriver över vår.

Dokumentera `p_rows`-kontraktet i ett `COMMENT ON FUNCTION` — generade typer ser
inte in i en jsonb-parameter (F-REL-16).

RPC:n gör tre saker per etapp, i en transaktion:

1. upsert av rader som finns i svaret
2. `withdrawn_at = now()` på `source = 'race_results'`-rader för den etappen som
   _inte_ finns i svaret (fråga 3)
3. `withdrawn_at = null` på rader som kommit tillbaka

Manuellt tillagda deltagare (`source = 'manual'`) får **inte** röras av något av
stegen. Det är innebörden av kortets "Manual entries get a separate ID series".

**En etapp i taget, inte alla i ett anrop.** Varje etapp är ett separat
HTTP-anrop mot ett opålitligt API; om etapp 3 av 6 timeoutar ska de två första
ligga kvar. Anropa RPC:n per etapp och rapportera per etapp i UI:t.

### Steg 6 — Lägg till en deltagare manuellt

Formulär i samma mönster som funktionärsinbjudan, men utan SMS — det finns inget
telefonnummer och ingen inloggning för deltagare ännu. `source = 'manual'`.

### Steg 7 — i18n

Nya nycklar i **både** `public/locales/en/admin.json` och
`public/locales/sv/admin.json` — full paritet krävs sedan #215 och testas av
`src/lib/i18n/locale-parity.test.ts`. Ny `participants`-sektion plus
`navigation.participants`.

### Steg 8 — Tester

- enhet: `parse.ts` mot committad fixtur (nationsflagga, kön, saknade fält)
- enhet: tier-grinden nekar Standard
- komponent: listan renderar, etappfiltret filtrerar
- integration: RPC:ns upsert — återimport uppdaterar `race_results`-rader och
  lämnar `manual` orörda
- guard-test mot tyst fel vid nätverksfel (F-REL-10-mönstret)

Inga datum-literaler i tester — härled relativt som seeden gör.

---

## 4. Ordning och beroenden

```
Steg 1 (migration)  ──┬── Steg 4 (sidan) ── Steg 5 (import) ── Steg 6 (manuell)
                      │
Steg 2 (RR-klient) ───┘
Steg 3 (tier) ── oberoende, kan tas först
Steg 7 (i18n) ── löpande per steg
Steg 8 (tester) ── löpande per steg
```

Steg 1 blockerar allt som skriver. Steg 2 är helt fristående och kan byggas och
testas utan databas — bra första steg om du vill ha något körbart tidigt.

## 5. Beroendet på N7/N14 är redan uppfyllt

Importkällan är `event_stages.results_url`, som kom med **N7** ("Race Results link
per Race stage", status `done`, migration 20261013093537) och renderas av **N14**
("Race Results link for officials", status `done`). Båda är klara, så N21 har
ingen blockerare där — men det är värt att veta att importen läser en kolumn som
_admins fyller i för hand_. Är länken fel eller tom finns inget att importera, och
felet syns först i importdialogen.

Deltagarnas egna `race_results_url` (kolumnen på `participants` sedan 0001) är en
annan sak: en länk per deltagare till deras personliga resultat. Den konstrueras
per startnummer enligt spikens §3 och hör till det här kortet.

## 6. Att göra innan kod

- [ ] **Fråga Peter om fråga 2** (en rad med flera etapper, eller en rad per
      etapp). Detta är den enda frågan som ändrar tabellformen och måste vara
      besvarad innan steg 1 skrivs. Min rekommendation: kopplingstabell.
- [ ] **Utred fråga 1** (stabilt deltagar-ID, fältskillnader mellan lopp) genom
      att köra klienten från steg 2 mot minst ett lopp till än Viadal. Kan göras
      direkt — steg 2 kräver varken databas eller migration.
- [ ] **Svara på fråga 3** på kortet (förslag finns i §2, strykning via
      `withdrawn_at`) och låt Peter bekräfta.
- [ ] Sätt kortets status till `question` om fråga 2 blir hängande, annars
      `doing` när steg 1 börjar.
- [ ] Be Peter om `gap-list-v1.5.md` / `open-actions-v1.5.md` vid behov
- [ ] `git fetch` och jämför mot `origin/main` innan filer öppnas för ändring
