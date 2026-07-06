# Ändringslogg — Viadal wireframes

_Sammanfattning av ändringar gjorda efter HTML-exporten (för genomgång med Frida)._

## Filstädning
- Konsoliderat till **en** EventAdmin-fil: tog bort den gamla dubbletten, döpte om v2 till huvudfilen "Viadal Wireframes - EventAdmin_view", och rensade bort den kvarvarande print-varianten samt den gamla fristående HTML-exporten.

## EVT-02 (Event configuration) — helt omgjord
- Nu **11 states** med riktiga Viadal 2026-data (Type "Time run", datum 3–9 aug 2026, schemagranularitet 60 min, facility-chips, samt etapperna Förberedelser / 6dagars / Efterarbete).
- Innehåller: draft-editable, published-editable, publish-blocked och no-race-stage (båda med grå Publish-knapp och samma text "At least one Race stage is required to publish"), facility-added, facility-empty-list, stages-list-collapsed, stages-list-one-row-expanded, add-stage-modal (Race + Non-race) samt unsaved-changes-guard.
- **Delete** visas nu som en dämpad länk (destruktiv åtgärd).

## Nytt dokument — System Admin
- Separat fil "Viadal Wireframes - SystemAdmin_view" med samma visuella språk.
- **SYS-01 Tenant management**: filled / empty / create-tenant-modal.
- **SYS-02 Tenant detail**: active / inactive / feature tier som single-select.
- Ingen Save-knapp — ändringar sparas direkt.

## COMM-01 (Communication) — tillagd i EventAdmin
- States: participant-channel, officials-channel, empty, unsaved-changes-guard.
- Segmented-väljare Participants/Officials + composer + timeline.

## ACCT-01 (Personligt konto) — tillagd i EventAdmin
- States: notifications-on, notifications-off, schedule-section-empty, unsaved-changes-guard.
- Kontonamn satt till **Peter Thörn**.

## Att flagga (öppen punkt)
- ACCT-01:s länk **"View my schedule"** ska peka på **MSCH-01** (användarens eget schema) med data för den inloggade användaren. Den skärmen är **inte byggd ännu**.
