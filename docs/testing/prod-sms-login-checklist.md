# Checklista: SMS-inloggning i prod

För kollega som testmanuellt. Syfte: verifiera att inloggning med riktigt telefonnummer och riktig SMS fungerar i prod, för både official- och tenant admin-roll. Detta har inte testats mot skarpa nummer i prod tidigare, bara verifierat att OTP-flödet i sig fungerar.

**Prod-URL:** https://app.viadalevent.se
**Prod SMS-avsändare:** +46766900096 (om SMS:et kommer från ett annat nummer, stanna och rapportera)

**Status 2026-08-19:** Alla punkter testade av Frida. 1–3 OK, inklusive nya "skicka ny kod"-knappen (se nedan). Punkt 4 (bakåtknapp efter utloggning) är en känd bugg — se not under punkten.

---

## 1. Inloggning — official

- [x] Gå till https://app.viadalevent.se, ange ditt riktiga telefonnummer (svenskt, nationellt format `07...` går bra)
- [x] Bekräfta att SMS kommer inom rimlig tid (under en minut) från **+46766900096**
- [x] Ange koden, verifiera att du loggas in och hamnar på rätt startsida för official-rollen (HOME-01)
- [x] Kontrollera att "Code sent to"-texten visar ditt nummer i normaliserat format (utan mellanslag, utan `+`), oavsett hur du skrev in det

## 2. Inloggning — tenant admin

- [x] Logga ut, logga in igen med ett konto som har tenant_admin-roll
- [x] Verifiera att du hamnar på admin-dashboarden, inte official-vyn

## 3. Fel-fall

- [x] Ange fel OTP-kod → tydligt felmeddelande, ingen inloggning
- [x] Begär ny kod ("skicka igen") → ny SMS kommer, gamla koden slutar fungera (knappen fanns inte tidigare, tillagd 2026-08-19)

## 4. Session

- [x] Ladda om sidan efter inloggning → fortfarande inloggad
- [ ] Logga ut → skickas till inloggningssidan, kan inte navigera tillbaka till inloggad vy med "bakåt"-knappen
  - **KÄND BUGG (öppen 2026-08-19):** klickar man bakåt i browsern efter utloggning visas/loggas man in igen. Ett tidigare fixförsök (no-store-header + pageshow-reload) löste inte problemet och skrotades. En kollega tittar på det nu — inte klart för prod-signoff förrän detta är löst.

## 5. Om något strular

Notera exakt:

- Vilket telefonnummer (de sista siffrorna räcker, behöver inte hela numret)
- Vilken roll du försökte logga in som
- Exakt felmeddelande / vad som hände istället för förväntat
- Om SMS aldrig kom, eller kom från fel nummer → **stanna och rapportera direkt till Frida**, logga inte in ändå

---

**Känd bakgrundsrisk (ej relaterad till ditt test, men bra att veta):** ett fåtal äldre official-rader i prod har telefonnummer lagrade i ett annat format internt, vilket kan ge problem specifikt vid _invite-bekräftelse_ för de kontona (inte vanlig inloggning). Berör inte OTP-inloggningsflödet du testar här.
