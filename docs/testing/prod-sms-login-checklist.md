# Checklista: SMS-inloggning i prod

För kollega som testmanuellt. Syfte: verifiera att inloggning med riktigt telefonnummer och riktig SMS fungerar i prod, för både official- och tenant admin-roll. Detta har inte testats mot skarpa nummer i prod tidigare, bara verifierat att OTP-flödet i sig fungerar.

**Prod-URL:** https://app.viadalevent.se
**Prod SMS-avsändare:** +46766900096 (om SMS:et kommer från ett annat nummer, stanna och rapportera)

---

## 1. Inloggning — official

- [ ] Gå till https://app.viadalevent.se, ange ditt riktiga telefonnummer (svenskt, nationellt format `07...` går bra)
- [ ] Bekräfta att SMS kommer inom rimlig tid (under en minut) från **+46766900096**
- [ ] Ange koden, verifiera att du loggas in och hamnar på rätt startsida för official-rollen (HOME-01)
- [ ] Kontrollera att "Code sent to"-texten visar ditt nummer i normaliserat format (utan mellanslag, utan `+`), oavsett hur du skrev in det

## 2. Inloggning — tenant admin

- [ ] Logga ut, logga in igen med ett konto som har tenant_admin-roll
- [ ] Verifiera att du hamnar på admin-dashboarden, inte official-vyn

## 3. Fel-fall

- [ ] Ange fel OTP-kod → tydligt felmeddelande, ingen inloggning
- [ ] Begär ny kod ("skicka igen") → ny SMS kommer, gamla koden slutar fungera

## 4. Session

- [ ] Ladda om sidan efter inloggning → fortfarande inloggad
- [ ] Logga ut → skickas till inloggningssidan, kan inte navigera tillbaka till inloggad vy med "bakåt"-knappen

## 5. Om något strular

Notera exakt:
- Vilket telefonnummer (de sista siffrorna räcker, behöver inte hela numret)
- Vilken roll du försökte logga in som
- Exakt felmeddelande / vad som hände istället för förväntat
- Om SMS aldrig kom, eller kom från fel nummer → **stanna och rapportera direkt till Frida**, logga inte in ändå

---

**Känd bakgrundsrisk (ej relaterad till ditt test, men bra att veta):** ett fåtal äldre official-rader i prod har telefonnummer lagrade i ett annat format internt, vilket kan ge problem specifikt vid *invite-bekräftelse* för de kontona (inte vanlig inloggning). Berör inte OTP-inloggningsflödet du testar här.
