# ADR-0005: Turneringsappens backend blir en delad turneringsmotor för Viadal

|                |                                                                       |
| -------------- | --------------------------------------------------------------------- |
| Status         | Accepterad (2026-11-16)                                               |
| Datum          | 2026-11-13                                                            |
| Berör          | Turneringsappen (.NET + Angular) och Viadal (React/HeroUI + Supabase) |
| Beslutsfattare | Frida, med mandat från Peter (scope och nivåer, 2026-11-16)           |

Lägg den här filen i båda repona, under `docs/adr/`. Avsnitt markerade **[att verifiera]** bygger på antaganden om nuvarande kod som ska kontrolleras innan implementation.

---

## 1. Bakgrund

- Turneringsappen är en fristående app för utslagsturneringar mellan kollegor: .NET-backend, Angular-framände och egen databas. Den ska fortsätta leva på egen hand.
- Viadal är en multi-tenant-app för sportevent med tre kundnivåer: **standard, premium och professional**.
- Idé: officials (de som arbetar under ett event) ska kunna köra turneringar mellan sig, till exempel under raster. Funktionen ska ingå i **premium och professional, inte i standard**.
- De två systemen är byggda på olika plattformar med olika databaser och olika inloggning.

Frågan är hur turneringsfunktionen ska komma in i Viadal utan att reglerna för turneringar (lottning, byes, deadlines, matchlägen, konflikter) behöver finnas på två ställen.

## 2. Beslut

**Turneringsappens .NET-backend blir en turneringsmotor som kan betjäna flera klienter.**

- Den fristående turneringsappen och Viadal är båda klienter till samma motor.
- Varje turnering hör till ett **sammanhang** (fristående eller ett specifikt Viadal-event). Motorn håller sammanhangen strikt isär.
- Viadal-användare loggar in i motorn med en **kortlivad token som Viadal utfärdar**. Viadal kontrollerar kundens nivå innan token utfärdas.
- Motorn sparar Viadals officials som **externa referenser**, inte som egna användare.
- Införandet sker stegvis: först länkas den befintliga Angular-appen in från Viadal (steg 3 nedan). En egen turneringsmodul i Viadal, byggd i React och HeroUI, byggs först när funktionen visat sig användas (steg 4).

## 3. Alternativ som övervägts

| Alternativ                                                     | Varför inte (eller inte nu)                                                                                                                                 |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Bara länk med SSO, inga ändringar i motorn                  | Snabbast, men leder till en återvändsgränd: motorn vet inget om sammanhang eller externa spelare. Ingår som första leverans, men byggt enligt detta beslut. |
| 2. Angular-appen som webbkomponent (Angular Elements) i Viadal | Två ramverk på samma sida, stor kodmängd, krockande stilar (Tailwind och Angular Material).                                                                 |
| 3. **En motor, två framändar**                                 | **Valt.** Reglerna finns på ett ställe och det känns inbyggt i Viadal på sikt. Priset är två framändar att underhålla.                                      |
| 4. Bygga om allt i Viadal (Supabase + React)                   | Reglerna hamnar i två kodbaser som glider isär, eftersom den fristående appen ska finnas kvar.                                                              |

## 4. Arkitektur

```mermaid
flowchart LR
  subgraph Viadal["Viadal (app.viadalevent.se)"]
    VW[React-app<br/>officials-vy]
    VS[Server-endpoints<br/>/api/tournament-token<br/>/api/internal/events/:id/officials]
    VDB[(Supabase)]
    VW --> VS --> VDB
  end

  subgraph Motor["Turneringsmotor (.NET)"]
    API[Turnerings-API]
    TDB[(Turneringsdatabas)]
    API --> TDB
  end

  TA[Turneringsappen<br/>Angular, fristående]

  TA -- appens egen inloggning --> API
  VW -- 1. hämta token --> VS
  VW -- 2. öppna appen med token --> TA
  TA -- Viadal-token --> API
  API -- 3. hämta officials<br/>med servernyckel --> VS
```

Drift: motorn körs som en egen container app i samma Azure Container Apps-miljö som Viadal (samma region, `swedencentral`), med en egen subdomän, till exempel `turnering.viadalevent.se`.

## 5. Ändringar i turneringsmotorn

### 5.1 Sammanhang på varje turnering

| Fält          | Typ                           | Exempel          |
| ------------- | ----------------------------- | ---------------- |
| `ContextType` | enum `Standalone` / `Viadal`  | `Viadal`         |
| `ContextId`   | string, null för `Standalone` | Viadals event-id |

- **Varje** fråga mot turneringar filtreras på sammanhanget från inloggningen, aldrig på ett värde som klienten skickar. Lägg det som ett globalt filter (EF Core query filter) så att det inte kan glömmas bort.
- Det ska finnas tester som bevisar att en användare i ett sammanhang inte kan läsa eller ändra något i ett annat.

### 5.2 Externa spelare

| Fält          | Typ                                                   | Exempel                 |
| ------------- | ----------------------------------------------------- | ----------------------- |
| `ExternalRef` | string, unik per sammanhang, null för egna användare  | `viadal:official:8f3c…` |
| `DisplayName` | string                                                | `Anna Berg`             |
| `AvatarUrl`   | string, null om bild saknas (tillagt 2026-11-18, N57) | `https://…/avatars/…`   |

- En spelare är antingen en egen användare i turneringsappen eller en extern referens.
- Namnet och bildlänken sparas för visning. De uppdateras när spelarlistan hämtas på nytt från Viadal.

### 5.3 Inloggning: två scheman

Motorn tar emot två slags tokens, som två autentiseringsscheman i ASP.NET Core:

| Schema       | Utfärdare                                                                            | Används av           |
| ------------ | ------------------------------------------------------------------------------------ | -------------------- |
| `Standalone` | Microsoft Entra ID (inloggning med jobbmejl), validerat med `Microsoft.Identity.Web` | Den fristående appen |
| `Viadal`     | Viadal, se 6.1                                                                       | Officials via Viadal |

Rättigheter beräknas av motorn utifrån token och turneringens data, enligt rolltabellen i `design/SPEC.md` §2. I Viadal-sammanhang gäller dessutom:

- **Begränsningen är eventet.** Bara officials som är anmälda och bekräftade (`invite_status = confirmed`) på just det eventet kan se, starta, spela och följa eventets turneringar. Det gäller även andra officials hos samma kund: att vara official på ett annat event ger ingen åtkomst.
- En official som är anmäld på flera event har separata turneringar per event. Token gäller ett event åt gången (`ctx`), så man byter event i Viadal för att se det eventets turneringar.
- **Inbjudna** finns inte i Viadal-sammanhang. Alla eventets officials kan se eventets turneringar.
- Spelarregistret är eventets officials. Det går inte att lägga till eller ta bort spelare från turneringsmotorn.
- Eventets **admin har ingen särskild roll** i officials turneringar: admin kan varken se, rensa eller ta bort dem (om admin inte själv är official på eventet och deltar som vanligt).

### 5.4 Samtidighet

Varje match har en version (`Version`, en `Guid` som byts vid varje sparning, se `IVersioned` i turneringsappen). Den finns redan och hindrar att två samtidiga anrop skriver över varandra. Det som tillkommer: den som markerar en vinnare skickar versionen hon såg (`If-Match`). Är den inaktuell svarar motorn `409 Conflict`, och klienten visar "Någon hann före" enligt SPEC.md §7.

Det finns **ingen realtidsuppdatering** (ingen SignalR eller polling). Klienten hämtar data när en vy öppnas och när användaren drar för att uppdatera. Krockar fångas av versionskontrollen ovan.

### 5.5 Official som tas bort mitt i en turnering

Om en official tas bort från eventet (`invite_status = removed`) medan en turnering pågår:

- Officialens plats i matcher som **inte är avgjorda** blir en **bye**. Motståndaren går vidare automatiskt.
- Matcher som redan är avgjorda eller låsta lämnas orörda, så att trädet fortfarande går att följa.
- Motorn upptäcker borttagningen genom att hämta spelarlistan från Viadal (6.2) när en pågående turnering öppnas, cachat några minuter. En spelare som saknas i listan räknas som borttagen. Viadal behöver inte meddela motorn separat.

### 5.6 Gallring

Turneringar i Viadal-sammanhang **raderas ett år efter att turneringen avslutats**, inklusive spelarnas namn och referenser. En turnering som aldrig avslutas raderas **ett år efter att den skapades** (beslut 2026-11-17), så att namnen inte ligger kvar längre än i en avslutad. Ett schemalagt jobb sköter det en gång per dygn, se 11.2. Turneringar i den fristående appen omfattas inte av den regeln.

### 5.7 API-ytor (förslag)

| Metod    | Sökväg                        | Syfte                                                                       |
| -------- | ----------------------------- | --------------------------------------------------------------------------- |
| `GET`    | `/api/tournaments`            | Turneringar i inloggningens sammanhang                                      |
| `POST`   | `/api/tournaments`            | Skapa (namn, slutdatum, spelare)                                            |
| `POST`   | `/api/tournaments/{id}/draw`  | Lotta                                                                       |
| `GET`    | `/api/tournaments/{id}`       | Turnering med träd, rundor och matcher                                      |
| `PUT`    | `/api/matches/{id}/winner`    | Sätt eller byt vinnare (`If-Match`)                                         |
| `DELETE` | `/api/matches/{id}/winner`    | Ångra vinnare (`If-Match`)                                                  |
| `POST`   | `/api/tournaments/{id}/clear` | Rensa resultat (arrangör)                                                   |
| `DELETE` | `/api/tournaments/{id}`       | Ta bort (arrangör)                                                          |
| `GET`    | `/api/players`                | Tillgängliga spelare i sammanhanget. I Viadal hämtas de från Viadal, se 6.2 |

Publicera API:t som OpenAPI. Det blir kontraktet för både Angular-appen och en framtida Viadal-modul.

## 6. Ändringar i Viadal

### 6.1 Token för turneringar: `POST /api/tournament-token`

En server-endpoint som körs med officialens vanliga Supabase-session.

1. Hämtar kundens nivå. Om den är `standard`: svarar `403`. Fliken Turneringar ska då inte heller visas i gränssnittet.
2. Kontrollerar att officialen är bekräftad (`invite_status = confirmed`) på eventet.
3. Signerar en JWT:

| Claim     | Värde                                                                    |
| --------- | ------------------------------------------------------------------------ |
| `iss`     | `https://app.viadalevent.se`                                             |
| `aud`     | `tournament-engine`                                                      |
| `sub`     | `viadal:official:{officialId}`                                           |
| `name`    | Officialens visningsnamn                                                 |
| `ctx`     | `viadal:event:{eventId}`                                                 |
| `tenant`  | Tenant-id                                                                |
| `tier`    | `premium` eller `professional`                                           |
| `locale`  | `en` eller `sv`, officialens språkval i Viadal (tillagt 2026-11-18, N55) |
| `palette` | Färgvärdena i kundens palett, se 7.1 (tillagt 2026-11-18, N52)           |
| `exp`     | Nu + 15 minuter                                                          |

- Signera asymmetriskt (ES256 eller RS256). Den privata nyckeln finns bara i Viadal. Viadal publicerar den publika nyckeln på `/.well-known/jwks.json`, och motorn hämtar den därifrån. Det gör nyckelbyte möjligt utan nya deploys.
- Klienten hämtar en ny token innan den gamla går ut.

### 6.2 Spelarlista: `GET /api/internal/events/{eventId}/officials`

- Anropas bara av motorn, server till server, med en servernyckel. Nyckeln förvaras som hemlighet i Azure och i 1Password, inte i koden.
- Returnerar bekräftade officials: `id`, `displayName`, `avatarUrl`. Inga telefonnummer eller e-postadresser. Motorn behöver dem inte.
- `avatarUrl` (tillagt 2026-11-18, N57) är den publika länken till funktionärens profilbild i Viadals bucket `avatars`, eller `null`. Motorn sparar bara länken på spelaren, aldrig bilden, och uppdaterar den vid varje hämtning. För en spelare som inte längre finns i listan töms den. När Viadal raderar bilden (ny bild, anonymiseringen i SEC-09) slutar länken fungera och appen visar initialer. Länken går inte att gissa men är inte skyddad, så den räknas som en personuppgift som lämnar Viadal. Gallringen (5.6) tar bort den tillsammans med spelaren.

### 6.3 Gränssnitt

- Ett kort **Turneringar** i listan "Gå till" på officials startsida, som bara visas för premium och professional. Det ligger sist, efter korten som motsvarar en flik. Ändrat 2026-11-17 från en flik i flikraden: med sex flikar klipptes tre etiketter av på en 375 px bred telefon, och turneringar är något man gör på rasterna, inte en del av arbetet.
- Steg 3: kortet leder till en sida som öppnar turneringsappen med token. Steg 4: sidan blir en egen React-modul.

## 7. Hur token kommer över (steg 3)

Viadal öppnar turneringsappen på `https://turnering.viadalevent.se/viadal#token=…`.

- Token ligger i URL-fragmentet (efter `#`). Fragment skickas inte till servrar och hamnar inte i serverloggar.
- Angular-appen läser fragmentet, sparar token i minnet (inte i localStorage) och tar bort fragmentet ur adressfältet direkt.
- Viadal öppnar appen i en **ny flik med `window.open`**, så att appen har `window.opener` att prata med.
- När token håller på att gå ut ber appen Viadal om en ny via `postMessage` till `window.opener`. Båda sidor kontrollerar `event.origin` mot den andra sidans exakta domän.
- Saknas `window.opener` (Viadal-fliken stängd, eller länken öppnad på annat sätt) skickas officialen tillbaka till Viadal för att öppna turneringen på nytt.
- **Inbäddning (iframe) väljs bort i steg 3.** Den kräver CSP-regler för `frame-ancestors`, krånglar med kakor och ger dålig mobilupplevelse.
- **Turneringsappen har en egen origin, inte en sökväg under Viadals.** Den ligger aldrig på till exempel `app.viadalevent.se/tournament`, eftersom den då kunde läsa officialens Viadal-session. Se 11.3.

### 7.1 Viadals utseende (N52)

En flik som Viadal öppnat visas i Viadals utseende, så att turneringarna känns som en del av Viadal. Den fristående appen behåller sitt eget.

- Claimet `palette` bär **färgvärdena** i kundens palett (`TENANT_PALETTES` i Viadal, "H S% L%"), inte bara palettens namn. Tabellen finns då bara i Viadal, och en ny palett kräver ingen ändring i appen. Ett test i Viadal kan inte se appens repo, så en kopierad tabell hade inte gått att hålla i takt. Paletten går genom samma nivåspärr som i Viadal (`effectivePalette`). Den innehåller inga personuppgifter.
- Appen tar bara emot värden som är exakt sådana tripletter, och bara om alla roller den använder finns med. Allt annat ger Viadals utseende i appens egen blå.
- Viadals typsnitt (Manrope i rubriker, systemtypsnittet i brödtext), radier, kortyta och neutrala färger. Bara ljust läge, eftersom Viadal inte har något mörkt. Valet ljust/mörkt visas inte.
- Utseendet och färgerna ligger fast för en sidladdning, precis som språket. En ny palett syns nästa gång officialen öppnar Turneringar.

## 8. Nivåer

|                                                                                                                                                                          | Standard | Premium | Professional |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------- | ------------ |
| Turneringar mellan officials                                                                                                                                             | –        | ✓       | ✓            |
| Extra (välj en eller två senare): admin-turneringar som del av eventet, matchförslag utifrån pass och tillgänglighet, resultattavla för storskärm, historik mellan event | –        | –       | ✓            |

## 9. Införande

| Steg                    | Innehåll                                                           | Klart när                                                                                    |
| ----------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 1. Motor med sammanhang | 5.1, 5.2, 5.4 och globalt filter, gärna som del av refaktoreringen | Fristående appen fungerar som förut. Testerna för isolering mellan sammanhang går igenom.    |
| 2. Viadal-inloggning    | 5.3, 6.1, 6.2, JWKS                                                | Motorn accepterar en Viadal-token och listar eventets officials. En standard-kund får `403`. |
| 3. Inlänkning           | 6.3 och 7. Viadal-temat lades till 2026-11-18 (7.1)                | Officials på ett premium-event kan skapa, lotta och spela en turnering från Viadal.          |
| 4. Viadal-modul         | React/HeroUI-modul mot samma API                                   | Görs bara om steg 3 visar att funktionen används.                                            |

## 10. Konsekvenser

**Bra**

- Turneringsreglerna finns på ett ställe.
- Viadal behöver inte känna till turneringsdatabasen, och motorn behöver inte känna till Supabase.
- Nivåkontrollen ligger där kundens nivå finns, alltså i Viadal.
- Steg 3 går att bygga utan att Viadals gränssnitt ändras mer än med en flik.

**Mindre bra**

- En tjänst till att drifta, övervaka (Sentry) och hålla vid liv.
- Två framändar att underhålla från steg 4.
- Spelarnamn är en kopia som kan bli inaktuell tills listan hämtas igen.

## 11. Besvarade frågor

| Fråga (besvarad 2026-11-13 om inget annat anges)                                                           | Beslut                                                                                                      | Se   |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---- |
| Ska eventets admin se och kunna rensa officials turneringar?                                               | Nej                                                                                                         | 5.3  |
| Hur länge sparas turneringar efter ett event?                                                              | Ett år efter att turneringen avslutats                                                                      | 5.6  |
| Vad händer om en official tas bort mitt i en turnering?                                                    | Platsen blir en bye                                                                                         | 5.5  |
| Behövs realtidsuppdatering?                                                                                | Nej                                                                                                         | 5.4  |
| Hur loggar man in i den fristående appen?                                                                  | Microsoft-konto med jobbmejl (Entra ID)                                                                     | 5.3  |
| Hur loggar inbjudna utanför företaget in i den fristående appen? (2026-11-06)                              | Som B2B-gäster i företagets Entra ID, inbjudna från appen via Microsoft Graph                               | 11.1 |
| Vilken databas använder turneringsappen? (2026-11-17)                                                      | Azure SQL Database via EF Core                                                                              | 11.2 |
| Kan turneringsappen ligga under Viadals adress, till exempel `app.viadalevent.se/tournament`? (2026-11-17) | Nej. Egen origin: tills vidare Static Web App:ens adress, senare en subdomän som `turnering.viadalevent.se` | 11.3 |
| Ska turneringsappen visas i Viadal-tema via design-tokens i steg 3? (2026-11-17)                           | Först uppskjutet. Ändrat 2026-11-18 (N52): ja, med kundens palett, bara i flikar som Viadal öppnat          | 7.1  |
| Raderas en turnering som aldrig avslutas? (2026-11-17)                                                     | Ja, ett år efter att den skapades                                                                           | 5.6  |

### 11.1 Inbjudna utanför företaget

Beslutat i turneringsappen 2026-11-06 (dess ROADMAP.md, steg D): alternativ (a). Appen tar bara emot konton i den egna Entra-katalogen, och en arrangör bjuder in en extern person från appen via Microsoft Graph. Personen blir B2B-gäst och kopplas via objekt-id:t från Graph, aldrig via e-postadressen. En inbjuden ser bara sina egna turneringar och inga e-postadresser, och bjuder inte in andra. Rollen heter "Invited" i kod och gränssnitt. Påverkar inte Viadal-integrationen.

Alternativen som valdes bort: (b) alla Microsoft-konton och åtkomststyrning i appen, (c) inloggning med engångskod via e-post.

### 11.2 Databas

Bekräftat i koden 2026-11-17: Azure SQL Database (`Microsoft.Sql/servers` i `infra/sqlserver.bicep`, `UseSqlServer` i `Program.cs`), via EF Core. Det ger följande:

- **Versionskontroll (5.4):** `Match` och `Tournament` har en `Guid Version` som concurrency token och byts vid varje sparning. Det valdes framför SQL Servers `rowversion` så att testerna kan köras mot SQLite i minnet. EF Core kastar `DbUpdateConcurrencyException` när versionen är inaktuell, och API:t översätter det till `409 Conflict`. Klienten skickar ännu inte sin version (`If-Match`), så det läggs till i steg 1.
- **Gallring (5.6):** ändrat 2026-11-17. Motorn körs på App Service F1, inte i Container Apps, så det finns ingen miljö att lägga ett Container Apps Job i. I stället anropar ett **schemalagt GitHub Actions-flöde** (`Retention.yml`, en gång per dygn) endpointen `POST /api/internal/retention`, som skyddas av en delad hemlighet (`Retention:Secret`) och gör själva raderingen. En enda anropare gör att gallringen körs exakt en gång, och anropet väcker appen även när ingen använder den. Tiden räknas från när finalen avgjordes (`Match.DecidedAt`, som sätts vid varje sparning), eller från när turneringen skapades om den aldrig avslutades. Spelarna i ett event som inte har några turneringar kvar raderas också; medan eventet används hämtas de på nytt från Viadal (6.2). Flyttar motorn till Container Apps blir flödet ett Container Apps Job.

### 11.3 Egen origin, inte en sökväg under Viadal

Frågan 2026-11-17 var om turneringsappen kan nås på Viadals egen adress, till exempel `app.viadalevent.se/tournament`, i stället för på en egen. Svaret är nej.

Webbläsaren skiljer sidor åt per origin (protokoll, värd och port), inte per sökväg. Under `app.viadalevent.se/tournament` skulle turneringsappens JavaScript köra i samma origin som Viadal. Viadals inloggningskakor från `@supabase/ssr` sätts med `httpOnly: false`, `path: "/"` och 400 dagars livslängd, eftersom webbläsarklienten behöver läsa dem. Turneringsappen skulle då kunna läsa officialens Supabase-session och Viadals `localStorage`, något den aldrig behöver. Ett XSS-fel eller ett komprometterat npm-paket i turneringsappen, som har eget repo, egna beroenden och egen driftsättning, skulle räcka för att ta över Viadal-konton.

Hela upplägget i avsnitt 6 och 7 bygger på att apparna är olika origins: en kortlivad token per event, `postMessage` med kontroll av den andra sidans exakta origin och en servernyckel mellan servrarna. Samma origin skulle göra token överflödig och ge turneringsappen mer än den ska ha.

Det blir dessutom krångligare i drift: Viadals container skulle behöva proxa all trafik till turneringsappen (`rewrites` i Next och nya undantag i `proxy.ts`), och Angular-appen skulle behöva byggas med en annan `base-href` än den fristående appen.

Därför:

- **Tills vidare** nås turneringsappen på Static Web App:ens egen adress (`*.azurestaticapps.net`). Det enda officialen ser av det är adressen i den nya fliken.
- **Senare** får den en subdomän, till exempel `turnering.viadalevent.se`: en CNAME-post i DNS och en egen domän på Static Web App:en, med gratis certifikat. Den ligger under Viadals varumärke men är en egen origin, så kakorna hålls isär. Ingen kod ändras, bara Viadals `TOURNAMENT_APP_URL` och turneringsappens `VIADAL_ORIGIN`.

## 12. Öppna frågor

Inga just nu.

## 13. Till CLAUDE.md

**I turneringsappens repo:**

```md
## Integration med Viadal

- Läs docs/adr/0005-turneringsmotor-viadal.md (samma fil och nummer som i Viadals repo) innan du rör auth, datamodell eller API.
- Varje turnering har ContextType/ContextId. Filtrera alltid på sammanhanget från
  inloggningen, aldrig på ett värde från klienten.
- Spelare kan vara externa (ExternalRef). Anta inte att en spelare är en egen användare.
```

**I Viadals repo:**

```md
## Turneringar (premium/professional)

- Läs docs/adr/0005-turneringsmotor-viadal.md.
- Turneringsdata ägs av turneringsmotorn. Lägg inga turneringstabeller i Supabase.
- /api/tournament-token och /api/internal/events/:id/officials är de enda integrationspunkterna.
```
