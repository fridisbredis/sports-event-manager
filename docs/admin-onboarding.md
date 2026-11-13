# Viadal – admin-onboarding

Nov 13, 2026 · @Frida

En steg-för-steg-guide för dig som är ny admin för en förening eller arrangör i Viadal. Översikten visar fem steg från eventinställningar till publicering. Du kan gå mellan stegen, men de bygger på varandra: schemat kräver arbetsområden och bekräftade funktionärer.

## Innan du börjar

- **Inloggning:** du loggar in med ditt mobilnummer och en engångskod som kommer via SMS. Det finns inget lösenord.
- **Dator för planering:** bygg event och schema på en dator. Mobilen fungerar för att titta på bemanningen på plats, men schemat går bara att redigera på en större skärm.
- **Ordningen spelar roll:** etapper → arbetsområden → funktionärer → schema. Arbetsområden kräver etapper, och bara bekräftade funktionärer kan planeras in.

## 1. Evenemangsinställningar

Gå till **Alla event** och välj **Skapa event**. Ge eventet ett namn. Om samma namn redan används får du en varning, men du kan ändå skapa eventet med det namnet.

Under **Kopiera från** kan du utgå från ett tidigare event. Det senaste eventet väljs som utgångspunkt när det finns ett; välj vilka delar som ska följa med (detaljer, etapper, distanser, infosektioner, arbetsområden, checklistor och funktionärer) och ange nya datum för etapperna. Välj **Inget (tomt event)** för att börja från noll.

Eventet skapas som **utkast**. Admins kan arbeta med utkastet, och bekräftade funktionärer kan se eventinformationen även innan publicering. Deltagarnas registreringssida och deltagarsidor blir tillgängliga först när eventet publiceras. Antalet oarkiverade event är begränsat per nivå: Standard 1, Premium 5 och Professional 20. Arkivera ett event för att frigöra en plats.

Under **Evenemangsinställningar** beskriver du eventet med namn, evenemangstyp, plats, logotyp och beskrivning. Distanser läggs till på tävlingsetapperna. **Infosektioner** är informationskort som kan innehålla rubrik, text, bild och länk, till exempel praktisk information om hur man hittar till eventet. Det finns ingen separat lista över faciliteter längre; lägg sådan information i en infosektion.

Det viktigaste här är **etapperna**. En etapp är en fas i eventet, till exempel uppbyggnad, själva tävlingen eller nedmontering. Varje etapp har en typ. Schemaintervallet anger hur schemat delas upp i tidsluckor; det är 60 minuter i den nuvarande versionen och går inte att ändra. Etapperna är av två typer:

- **Tävling** – själva loppet. Syns för deltagarna och har en formell start- och sluttid samt distanser.
- **Ej tävling** – arbete som bara rör funktionärer, till exempel uppbyggnad och nedmontering.

Lägg till etapper med **+ Lägg till etapp**. Ett event måste ha minst en tävlingsetapp för att kunna publiceras. Ett flerdagarslopp som Viadal är en tävlingsetapp som sträcker sig över flera dagar.

Klicka **Spara** för att spara eventuppgifter, etapper och logotyp. Infosektioner hanteras separat: när du sparar en infosektion i dess dialogruta, tar bort den eller ändrar ordning sparas ändringen direkt. Appen varnar om du försöker lämna sidan med osparade ändringar i eventuppgifterna.

## 2. Lägg upp arbetsområden

Skapa de platser och uppgifter som funktionärerna ska bemanna. Ange öppettider och hur många som kan arbeta samtidigt. Gå till **Arbetsområden** och välj **Lägg till arbetsområde**.

**Korttext för översikten:** Skapa platser och uppgifter som ska bemannas. Ange öppettider och högsta antal funktionärer samtidigt.

**Begreppshjälp – arbetsområde:** En plats eller uppgift som funktionärer bemannar, till exempel en depå, tidtagning eller sociala medier. Varje arbetsområde hör till en etapp.

För varje arbetsområde anger du:

- **Etapp** – vilken etapp området hör till. Samma sorts arbete i två etapper blir två arbetsområden.
- **Öppettider** – ett eller flera tidsfönster då området kan bemannas. Använd **Följ etappens tider** om området är öppet hela etappen. Om etappen är längre än ett dygn och tidsfönstret kortare än ett dygn kan du kryssa i **Återkommer dagligen** för att upprepa samma tider varje dag, så slipper du skriva in dem en gång per dag. För tävlingsetapper får öppettiderna börja upp till en timme före start och sluta upp till en timme efter mål.
- **Högsta antal funktionärer samtidigt** – ett tak, inte ett krav. "Upp till 3" betyder att det är helt i sin ordning att bara ha en person där på natten.
- **Checklistor / att göra** – avbockningspunkter och anteckningar som funktionären ser när hen har ett pass där. Checklistorna är information för funktionären; appen sparar inte vad som har bockats av.

Ett arbetsområde utan öppettider kan inte bemannas. Det kan ändå visas i schemat, men tidsluckorna går inte att använda förrän du har lagt in öppettider.

## 3. Bjud in funktionärer

Gå till **Funktionärer** och välj **Lägg till funktionär**. Ange namn och mobilnummer, så skickas en inbjudan via SMS.

- Personen har status **Inbjuden** tills hen har öppnat länken, verifierat sitt nummer och bekräftat att hen kan. Då blir statusen **Bekräftad**.
- Bara **bekräftade** funktionärer kan planeras in i schemat. Hör av dig till dem som fortfarande står som inbjudna, eller välj **Skicka inbjudan igen**.
- Du själv står redan med i listan (markerad **Du**) och kan alltid planeras in.
- Har ni haft event tidigare kan du hämta funktionärer därifrån med **Lägg till från andra event**.
- Behöver någon fler hjälpa till att planera kan du välja **Gör till admin** på en funktionär. Hur många admins ni kan ha beror på er nivå (se tabellen längre ner).

Ett mobilnummer kan bara finnas en gång inom er organisation.

## 4. Bygg schemat

I översiktens femstegsguide visas schemaläggningen som låst tills eventet har arbetsområden och bekräftade funktionärer.

Gå till **Schemaläggning**, välj etapp och välj dag. Schemat har två vyer som visar samma data, och en ändring i den ena syns direkt i den andra:

- **Per arbetsområde** – en rad per arbetsområde med antal inplanerade mot taket (till exempel 1/3). Fäll ut raden för att se en rad per plats och klicka i en tidslucka för att välja bland de funktionärer som är lediga just då.
- **Per person** – en kolumn per funktionär. Klicka i en tidslucka för att välja bland de arbetsområden som är öppna just då. Här ser du också hur mycket var och en jobbar.

På dator kan du redigera schemat. På mobil visas i stället en läsvy för att kontrollera bemanningen på plats; den ingår i Premium och Professional.

Det här visar schemat för att hjälpa dig:

- Tidsluckor utanför ett arbetsområdes öppettider är gråade och går inte att använda.
- Att planera in fler än taket går, men området markeras som **över kapacitet**.
- Du kan markera en funktionär som **otillgänglig** under en viss tid, till exempel efter ett nattpass.

Klicka **Spara** när du är klar. Funktionärerna ser sina pass under Mitt schema så fort schemat är sparat.

## 5. Publicera

När eventet har ett namn och minst en tävlingsetapp kan du välja **Publicera** under **Översikt** eller **Evenemangsinställningar**. Översikten visar vad som saknas om det inte går.

- Bekräftade funktionärer kan se eventinformationen även när eventet är ett utkast. Publicering öppnar deltagarnas registreringssida och deltagarsidor; det kräver Premium och är inte tillgängligt innan publicering.
- Du kan fortsätta redigera efter publicering, och du kan avpublicera igen.

**Begreppshjälp – publicerat:** Deltagarnas registreringssida och deltagarsidor är öppna. Funktionärer kan se eventet redan som utkast.

## Efter grundstegen

### Lägg till deltagare (Premium)

Under **Deltagare** finns startlistan för eventets tävlingsetapper. Du kan **Importera från Race Results** eller lägga till deltagare en och en med **Lägg till deltagare**. Deltagarna öppnar registreringslänken eller QR-koden för att göra anspråk på sin plats i startlistan och skapa sitt konto.

### Kommunicera under eventet

Under **Kommunikation** väljer du kanal (funktionärer eller deltagare), skriver ett meddelande och väljer **Publicera**. Meddelandet syns i appen. Funktionärer med SMS aktiverat får även SMS och, om de har slagit på det, en pushnotis. För deltagarkanalen skickas SMS bara till deltagare som har registrerat sitt konto, har ett mobilnummer och inte har tackat nej till SMS. Kanalerna är envägs: bara admins skriver. Deltagarkanalen öppnar först när eventet är publicerat.

### Inställningar för hela organisationen

Under **Inställningar** väljer du organisationens färgtema, som används i vyerna för alla era event. Färgtemat ingår från Premium.

## Vad som ingår i vilken nivå

| Funktion                                     | Standard | Premium | Professional |
| -------------------------------------------- | :------: | :-----: | :----------: |
| Event, arbetsområden, funktionärer, schema   |    ✓     |    ✓    |      ✓       |
| Publicering, deltagare och registreringssida |          |    ✓    |      ✓       |
| Schema i mobilen                             |          |    ✓    |      ✓       |
| Eget färgtema                                |          |    ✓    |      ✓       |
| Eget SMS-avsändarnamn (ställs in av oss)     |          |         |      ✓       |
| Antal admins                                 |    1     |    3    |      10      |

Funktioner som inte ingår i er nivå visas gråade och märkta med nivån, så att du ser vad som finns.

## Vanliga frågor

**Varför syns inte en funktionär i schemat?** Hen har inte bekräftat sin inbjudan ännu. Kontrollera statusen under Funktionärer.

**Varför går ett arbetsområde inte att bemanna i schemat?** Det saknar öppettider, eller så hör det till en annan etapp än den du har valt. Arbetsområden utan öppettider kan visas, men deras tidsluckor är inte valbara.

**Varför kan jag inte klicka i en tidslucka?** Arbetsområdet är stängt den tiden. Ändra öppettiderna under Arbetsområden om det behöver vara öppet.

**Kan jag ändra saker efter att schemat är byggt?** Ja. Om du sänker taket eller krymper öppettiderna för ett område som redan har inplaneringar visar schemat det som över kapacitet eller utanför öppettid. Inget försvinner i tysthet.
