# Testartikel voor de iframe-embed

Dit is een **testartikel**, geen redactionele publicatie. Het bestaat om de
iframe-embed van NOS Rem Reflex in een realistische artikelopmaak te kunnen
proberen. De runnable versie staat in [public/embed-test.html](../public/embed-test.html)
en is na een deploy te openen op `/embed-test.html`, ook op een telefoon.

Feiten gecheckt op 13 augustus 2026 (bronnen onderaan). Alles tussen
`[[ ... ]]` is een plaatshouder die de redactie zelf vult: quotes en de
sfeerfoto zijn hier bewust niet verzonnen.

---

## Metadata

| Veld                 | Waarde                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Titel**            | Voor het laatst Formule 1 in Zandvoort: rem jij net zo laat als Verstappen?                                                                                                   |
| **Ankeiler**         | Over een week rijdt de Formule 1 voor de laatste keer door de duinen van Zandvoort. Test in ons spel of jij het rempunt van Max Verstappen durft te benaderen.                |
| **Slug**             | `laatste-formule-1-zandvoort-rem-reflex-spel`                                                                                                                                 |
| **Rubriek**          | Sport › Formule 1                                                                                                                                                             |
| **Auteur**           | NOS Sport                                                                                                                                                                     |
| **Publicatiedatum**  | 13 augustus 2026                                                                                                                                                              |
| **Hoofdafbeelding**  | `/images/waar-max-verstappen-remt-circuit-zandvoort-formule-1.webp` (1600×900, 16:9) — gegenereerd met `scripts/build-article-image.mjs`                                      |
| **Alt-tekst**        | Kaart van Circuit Zandvoort met de kwalificatieronde van Max Verstappen in kleur: rood waar hij remt, oranje waar hij uitrolt en groen waar hij vol gas geeft.                |
| **Meta-description** | De Formule 1 verlaat Zandvoort na 2026. Rijd in het NOS-spel Rem Reflex de echte kwalificatieronde van Max Verstappen na en zie hoe dicht je bij zijn rempunt komt.           |
| **Keywords**         | formule 1, dutch grand prix, zandvoort, max verstappen, laatste grand prix nederland, circuit zandvoort, rempunten, telemetrie, f1 spel, rem reflex, kwalificatie, sprintrace |
| **Tags (NOS)**       | Formule 1 · Max Verstappen · Dutch Grand Prix · Zandvoort                                                                                                                     |

---

## Voor het laatst Formule 1 in Zandvoort: rem jij net zo laat als Verstappen?

**Over een week rijdt de Formule 1 voor de laatste keer door de duinen van
Zandvoort. Test in ons spel of jij het rempunt van Max Verstappen durft te
benaderen.**

![Kaart van Circuit Zandvoort met de kwalificatieronde van Max Verstappen in kleur: rood waar hij remt, oranje waar hij uitrolt en groen waar hij vol gas geeft.](/images/waar-max-verstappen-remt-circuit-zandvoort-formule-1.webp)

_Waar Max Verstappen remt op Zandvoort, volgens de telemetrie van zijn snelste kwalificatieronde in 2025. Beeld: NOS · Data: OpenF1_

_[[ Redactie: dit is een eigen datagrafiek, gemaakt uit de telemetrie in het
spel, dus vrij van rechten. Een sfeerfoto van het circuit kan er nog bij of
in de plaats van, met fotocredit. ]]_

Van vrijdag 21 tot en met zondag 23 augustus is Circuit Zandvoort voor het
laatst het decor van de Dutch Grand Prix. Het contract met de Formule 1 loopt
na deze editie af en wordt niet verlengd, waarmee er een einde komt aan de
reeks die in 2021 begon.

Het slotweekend is meteen een primeur: Zandvoort is voor het eerst gastheer van
een sprintweekend. Dat betekent twee keer punten, en één vrije training minder
om de auto goed te zetten.

### Het programma

| Dag                  | Sessie             | Tijd  |
| -------------------- | ------------------ | ----- |
| Vrijdag 21 augustus  | Sprintkwalificatie | 16.30 |
| Zaterdag 22 augustus | Sprintrace         | 12.00 |
| Zaterdag 22 augustus | Kwalificatie       | 16.00 |
| Zondag 23 augustus   | Grand Prix         | 15.00 |

_[[ Redactie: check de tijden nog een keer tegen het definitieve tijdschema en
vul aan met de trainingen. ]]_

### Waarom het stopt

De Dutch Grand Prix verlengde het contract tot en met 2026 en kondigde daarbij
aan dat dit de laatste editie in Zandvoort wordt. Daarmee verdwijnt de race na
zes edities weer van de kalender.

_[[ Redactie: hier een quote van de organisatie of van Verstappen over het
afscheid. Bewust niet verzonnen in dit testartikel. ]]_

### Rem jij net zo laat als Max?

Wie het circuit kent van de tv, weet hoe laat Verstappen durft te remmen voor
de Tarzanbocht. Maar hoe laat is dat precies? In het spel **NOS Rem Reflex**
rijd je zijn echte kwalificatieronde van 2025 na: ronde 17 uit de kwalificatie
van de Dutch Grand Prix, opgehaald uit de officiële telemetrie.

Je houdt het gas ingedrukt zolang Verstappen vol gas geeft, laat los waar hij
uitrolt en trapt op de rem waar hij remt. Na elke bocht zie je jouw lijn naast
die van Max op de baan, met per pedaal het percentage dat je gelijk zat. Wie
alleen gas geeft en nooit remt, komt niet ver: je moet alle drie de pedaalstanden
raken.

Eerst is er een oefenbocht (de Tarzanbocht, die niet meetelt), daarna drie
bochten voor de punten. Je eindscore is te delen via een link.

<!-- EMBED: NOS Rem Reflex.
     De embed toont in een iframe een poster die doorlinkt naar het spel op de
     eigen pagina, omdat het spel het hele scherm nodig heeft (pedalen, kaart,
     camera). De poster is 16:9, dus laat de hoogte met de breedte meelopen. -->

<div style="aspect-ratio: 16 / 9">
  <iframe
    src="https://f1-rem-reflex.vercel.app/"
    title="NOS Rem Reflex: rem jij net zo laat als Max Verstappen?"
    loading="lazy"
    style="width: 100%; height: 100%; border: 0"
  ></iframe>
</div>

Het spel is ook los te spelen: [f1-rem-reflex.vercel.app](https://f1-rem-reflex.vercel.app/).

---

## Bronnen

- [Final race in 2026 — Dutch Grand Prix](https://dutchgp.com/en/final-race-2026/)
- [De Dutch Grand Prix stopt na 2026 — news.verstappen.com](https://news.verstappen.com/nl/article/13502)
- [Formula 1 and FIA announce 2026 Sprint Calendar — formula1.com](https://www.formula1.com/en/latest/article/formula-1-and-fia-announce-2026-sprint-calendar.3PyLPAazrBNe8kQIS3wOfY)
- [Dutch Grand Prix 2026: schedule and sprint timetable](https://worldofspeed.org/f1/dutch-grand-prix-2026-schedule-sprint-tv-guide/)
