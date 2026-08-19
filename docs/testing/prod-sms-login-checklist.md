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
- [ ] Logga ut → skickas till inloggningssidan
- [ ] Tryck "bakåt" efter utloggningen, klicka sedan på något i vyn → du ska
      skickas till inloggningssidan. Se den kända avvikelsen nedan innan du
      rapporterar något här.

> **Känt fel, rapportera inte som nytt:** när du trycker "bakåt" direkt efter
> utloggning visas den inloggade vyn igen, med innehåll. Den är död — så fort du
> klickar på något skickas du till inloggningssidan, och inga nya uppgifter kan
> hämtas. Det är webbläsarens historik som visar en gammal bild, inte att du
> fortfarande är inloggad. Felet är känt sedan 2026-08-19 och ska rättas.
>
> Vad vi däremot vill veta: om du efter "bakåt" faktiskt kan **använda** vyn —
> klicka dig vidare, ladda ny data, spara något, eller se innehåll som
> uppdateras. Då är det ett nytt och allvarligare fel. **Rapportera direkt till
> Frida.**
>
> Praktisk följd: **stäng fliken när du är klar med testet.** Så länge fliken är
> öppen kan den gamla bilden nås med "bakåt". Extra viktigt om du testar på en
> dator som någon annan använder.

## 5. Om något strular

Notera exakt:

- Vilket telefonnummer (de sista siffrorna räcker, behöver inte hela numret)
- Vilken roll du försökte logga in som
- Exakt felmeddelande / vad som hände istället för förväntat
- Om SMS aldrig kom, eller kom från fel nummer → **stanna och rapportera direkt till Frida**, logga inte in ändå

---

**Känd bakgrundsrisk (ej relaterad till ditt test, men bra att veta):** ett fåtal äldre official-rader i prod har telefonnummer lagrade i ett annat format internt, vilket kan ge problem specifikt vid _invite-bekräftelse_ för de kontona (inte vanlig inloggning). Berör inte OTP-inloggningsflödet du testar här.
