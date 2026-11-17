# Career Intelligence Agent

**AI-avusteinen työnhaku- ja urapäätösten tukisovellus**

React · TypeScript · Node.js · Express · Google Gemini · Zod

**Tila:** MVP 0.3.1 | Henkilökohtainen oppimis- ja portfoliohanke

## Portfolioesittely

Career Intelligence Agent on kehittämäni AI-avusteinen sovellus, joka auttaa löytämään IT- ja kyberturvallisuusalan työpaikkoja, arvioimaan niiden soveltuvuutta hakijan osaamiseen sekä seuraamaan kiinnostavia hakukohteita.

Projektin lähtökohtana oli todellinen ongelma: työpaikkailmoitusten etsiminen, vaatimusten tulkitseminen ja eri vaihtoehtojen vertaileminen vie paljon aikaa.

### Keskeiset ominaisuudet

- **Job Discovery:** Käyttäjän käynnistämä työpaikkahaku julkisista Ashby-, Greenhouse- ja Lever-rekrytointirajapinnoista.
- **AI-analyysi:** Google Gemini vertaa ilmoituksen vaatimuksia hakijaprofiiliin ja tuottaa perustellun soveltuvuusarvion.
- **Selitettävä arviointi:** Sovellus erottaa pakolliset vaatimukset, toivotun osaamisen ja epävarmat tiedot.
- **Hakukohteiden hallinta:** Työpaikkojen tallennus, vertailu, tilaseuranta ja JSON-varmuuskopiot.
- **Tietoturva:** Palvelinpuolinen API-avainten käsittely, Zod-validointi, rajatut HTTPS-noudot, SSRF-suojaukset ja epäluotettavan ilmoitustekstin käsittely.

### Oma roolini ja kehitysprosessi

Projekti on toteutettu iteratiivisesti ja AI-avusteisesti Google AI Studio Build -ympäristössä.

Oma työni on painottunut ongelman määrittelyyn, toiminnallisiin ja tietoturvavaatimuksiin, kehitysratkaisujen arviointiin, testitapausten suunnitteluun, käytännön testaukseen sekä havaittujen virheiden järjestelmälliseen korjaamiseen.

Suuri osa varsinaisesta lähdekoodista on tuotettu tekoälyn avustamana. Projekti osoittaa erityisesti kykyäni ohjata AI-avusteista ohjelmistokehitystä, arvioida teknisiä ratkaisuja kriittisesti ja varmistaa niiden toimintaa.

### Testaus ja nykytila

- **56/56** automaattista regressiotestiä läpäisty Google AI Studion raportin mukaan.
- TypeScript-tarkistus ja Vite-build läpäisty Google AI Studion raportin mukaan.
- **10/10** manuaalista käyttöliittymätestiä läpäisty.
- Lähdekoodia on katselmoitu erikseen, ja kehitystyössä on käytetty GitHubin haaroja ja Pull Request -menettelyä.

**Rajoitukset:** Sovellus on henkilökohtainen MVP, ei tuotantovalmis tai julkisesti ylläpidetty verkkopalvelu. Työpaikkahaku kattaa tällä hetkellä kolme valittua työnantajalähdettä, joista Lever-yhteydessä on havaittu ongelmia. Sovellus ei hae työpaikkoja automaattisesti taustalla eikä lähetä työhakemuksia.

## Project overview (English)

Career Intelligence Agent is an AI-assisted job discovery and career decision-support application developed as a personal learning and portfolio project.

It combines public recruitment APIs, explainable rule-based filtering, Google Gemini analysis and job application tracking.

The project focuses on secure API integration, structured data validation, transparent uncertainty handling and regression testing.

**My contribution:** I have led the project through requirements definition, AI-assisted development in Google AI Studio Build, security-focused design decisions, iterative testing, critical evaluation and quality assurance. Much of the application code was generated with AI assistance.

**Current status:** Version 0.3.1 MVP. The source code is public, but the application is not deployed as a public service or assessed as production-ready.

---


## 1. Projektin tavoite

Career Intelligence Agent auttaa vertaamaan työpaikkailmoitusten vaatimuksia hakijan todelliseen osaamiseen, kokemukseen ja uratavoitteisiin. Sovellus on suunniteltu erityisesti IT- ja kyberturvallisuusalan harjoittelu-, trainee- ja junioritehtävien arviointiin, mutta se pystyy arvioimaan myös muita työtehtäviä.

Sovelluksen tavoitteena on:

- erottaa työnantajan **pakolliset kelpoisuusehdot** toivotuista taidoista ja työssä opittavista teknologioista;
- tunnistaa hakijan vahvat ja osittaiset osaamisvastaavuudet sekä aidosti merkittävät puutteet;
- arvioida **suoraa kyberturvallisuusrelevanssia**, siirrettävää osaamista ja mahdollisia urapolkuja erikseen;
- huomioida sijainti, työskentelymalli, palkkaus, aloitusajankohta ja tutkintoharjoittelun mahdollinen hyväksyttävyys;
- tuottaa perusteltu, kriittinen hakusuositus sekä auttaa seuraamaan kiinnostavia hakukohteita.

Sovellus on **päätöksenteon apuväline**. Se ei vahvista työnantajan tietoja automaattisesti eikä tee hakupäätöksiä käyttäjän puolesta.

## 2. Toteutetut ominaisuudet

### Työpaikkailmoituksen analysointi

Käyttäjä voi liittää työpaikkailmoituksen tekstin käsin tai hakea sen tuetusta HTTPS-osoitteesta erillisellä **Hae ilmoituksen sisältö** -toiminnolla muokattavaan tekstikenttään ja käynnistää Gemini-analyysin erikseen. Gemini vertaa tekstiä tallennettuun hakijaprofiiliin ja tuottaa rakenteisen analyysin, joka sisältää muun muassa:

- tehtävän perustiedot, työtehtävät ja työnantajan vaatimukset;
- pakolliset kelpoisuusehdot ja niiden täyttymisen;
- vahvat osaamisvastaavuudet, osittaiset vastaavuudet, merkittävät osaamispuutteet ja oppimismahdollisuudet;
- käytännön tekijöiden ja mahdollisen harjoittelun opinnollistamisen arvioinnin;
- kyberturvallisuusyhteyden ja etenemismahdollisuuksien arvioinnin;
- lainauksia ilmoitustekstistä sekä suositellun seuraavan toimenpiteen.

Suosituskategoriat ovat **Ensisijainen hakukohde**, **Harkinnan arvoinen**, **Matala prioriteetti** ja **Jätä väliin**.

### Työpaikkojen haku julkisista rajapinnoista (Job Discovery MVP)

- **Käyttäjän käynnistämä haku:** **Löydä työpaikkoja** -välilehti käynnistää manuaalisesti `POST /api/discover-jobs` -haun ilman ajastettua taustahakua tai automaattista hakemusten lähettämistä.
- **Ensimmäisen version työnantajalähderekisteri:** Kuratoitu ja modulaarinen rekisteri (`server/jobDiscovery/registry.ts`) tukee ensimmäisessä versiossa kolmea maksutonta julkista ATS GET -rajapintaa: **Ashby** (`hoxhunt` / `api.ashbyhq.com`), **Greenhouse** (`smartlyio` / `boards-api.greenhouse.io`) sekä **Lever** (`netlight` / `api.lever.co`, sovitin tukee myös `api.eu.lever.co`-osoitetta).
- **Normalisointi, puhdistus ja kaksoiskappaleiden käsittely:** Ulkoisen HTML- tai entiteettikoodatun kuvauksen vaaralliset tunnisteet (`<script>`, `<style>`, `<iframe>`, tapahtumankäsittelijät) poistetaan ja sisältö muunnetaan puhtaaksi tekstiksi (`sanitizeExternalHtmlToPlainText`). Automaattinen yhdistäminen tehdään vain vahvoilla avaimilla (`source + employer + sourceJobId` tai normalisoitu `jobUrl`), jolloin puuttuvalla URL-osoitteella tai eri lähde-ID:llä olevia saman nimikkeen ja sijainnin rooleja ei poisteta vahingossa (epäillyt kaksoiskappaleet merkitään vain tarkistushuomioksi).
- **Sijainti-, maa-, sertifikaatti- ja aikarajaluokittelun tarkennukset (0.3.1):**
  - `Suomi`/`Finland`-sijaintihaku kattaa kaikki vahvistetut kotimaiset kohteet; tarkka kaupunkihaku (esim. `Helsinki`) pysyy tarkkana eikä laajene muihin Uudenmaan kuntiin, kun taas `Uusimaa` kattaa koko maakunnan. Ulkomainen maakoodi (esim. `DE`) estää ristiriitaisen kohteen tulkitsemisen varmaksi kotimaiseksi osumaksi, ja monitoimipaikkaiset ilmoitukset merkitään lisätarkistusta vaativiksi.
  - Sääntöpohjainen luokittelu erottaa varsinaiset voimassa olevat sertifikaatit sertifikaattivalmentavista opinnoista ja kokeeseen valmistautumisesta sekä erottelee pakolliset sertifikaatit toivotuista/eduksi katsotuista vaatimuksista ilman perusteetonta "puuttuu varmasti" -väitettä.
  - Hakuajan tarkistus (`parseDeadlineAssessment`) validoi kalenteripäivät (`toValidIsoDate`), tulkitsee pelkät päivämäärät `Europe/Helsinki`-aikavyöhykkeessä, jättää vapaamuotoiset teksti-ilmaukset ja julkaisupäivät erilleen eikä merkitse epämääräistä tai virheellistä päivämäärää kelvolliseksi (`valid`).
- **Konservatiivinen sääntöpohjainen suodatus ja luokittelu:** Tulokset suodatetaan käyttäjän tallennettavien hakuasetusten (`cia_discovery_preferences_v1`, oletuksena mm. harjoittelu/trainee/alkuvaihe, `Uusimaa`, Suomeen sopiva työskentelymalli, IT/kyber- ja välilliset polut, kieli fi/en) sekä valinnaisesti tallennetun hakijaprofiilin perusteella. Jokainen osuma luokitellaan sanallisesti (`Erittäin kiinnostava`, `Mahdollisesti sopiva`, `Vaatii lisätarkistusta` tai `Heikko vastaavuus`) perusteluineen ja epävarmuuksineen ilman keksittyjä prosenttilukuja tai automaattisia Gemini-kutsuja.
- **Suora siirto analyysinäkymään ja pyyntöjen tilanhallinta:** **Analysoi tarkemmin** -painike vie valitun ilmoituksen (`formatDiscoveredJobForAnalysis`) nykyiseen **Analysoi ilmoitus** -näkymään tarkistettavaksi (suojaten olemassa olevaa tekstiä, pelkkää URL-syötettä, tulosta sekä käynnissä olevaa analyysiä tai URL-noutoa korvausvahvistuksella ja ilmoittaen selkeästi mahdollisesta 30 000 merkin katkaisusta tai vanhentuneesta hakuajasta). Haun keskeytys ja nopea uudelleenkäynnistys koordinoidaan (`src/lib/discoveryRunner.ts`), jotta vanhentunut tai keskeytetty haku ei ylikirjoita uudemman haun tilaa.

**Rajoitukset:** Haku kattaa vain lähderekisterissä määritellyt työnantajat eikä etsi koko internetistä. Ulkoisille ATS-rajapinnoille ei välitetä hakijaprofiilia. Etätyö ilman vahvistusta Suomesta työskentelyn mahdollisuudesta tai puuttuva sijainti merkitään aina lisätarkistusta vaativaksi.

### URL-pohjainen ilmoituksen lukeminen (Job URL Import)

- **Tuetut portaalit:** palvelinpuolen nouto (`POST /api/fetch-job`, `server/fetchJob.ts`) on rajattu sallittuihin HTTPS-isäntänimiin (`valtiolle.fi`, `www.valtiolle.fi`, `jobly.fi`, `www.jobly.fi`, `duunitori.fi`, `www.duunitori.fi` ja `ats.talentadore.com`).
- **Poimintamenetelmät ja kattavuus:** noutaja hyödyntää sekä rakenteista `schema.org/JobPosting`-dataa että HTML-sisältöalueen jäsentämistä (`schema_org_jsonld`, `jsonld_and_html`, `html_fallback`) ja ilmoittaa poiminnan kattavuustilan (`complete`, `partial` tai `uncertain`). Lyhyt rakenteinen tiivistelmä ei syrjäytä kattavaa HTML-ilmoitusta.
- **Hakuajan ristiriitojen ja kellonaikojen tarkistus:** rakenteisten metatietojen (`validThrough`) ja varsinaisen ilmoitustekstin hakuaikoja verrataan `Europe/Helsinki`-aikavyöhykkeessä. Kaksi eksplisiittistä kellonaikaa verrataan täsmällisesti ilman yleistä tuntitoleranssia tai `23:59`-oletusajan ohittamista. Ristiriitaiset ajat merkitään (`Hakuaika (RISTIRIITAINEN – tarkistettava)`) ja käyttöliittymä edellyttää käyttäjältä joko tekstin tarkistamista/korjaamista tai ristiriitavaroituksen kuittaamista ennen analyysiä.
- **Totuudenmukainen varmistusilmoitus:** analyysin `urlVerificationNotice` kuvaa rehellisesti, että analyysi perustuu syötettyyn tai erillisellä URL-noudolla haettuun tekstiin eikä teksti, onnistunut URL-nouto tai viite-URL yksinään todista, että haku on yhä avoinna.

**Rajoitus:** Jos ilmoitussivu vaatii kirjautumista, rakentuu täysin selainpuolisella JavaScriptillä tai sijaitsee sallittujen portaalien ulkopuolella, ilmoitusteksti liitetään tekstikenttään käsin. Haun todellinen voimassaolo vahvistetaan edelleen manuaalisesti.

### Hakijaprofiili

Muokattava profiili sisältää koulutuksen, opintojen tilanteen, aikaisemman IT-harjoittelun, teknisen osaamisen, AI-kokemuksen, muun työkokemuksen, uratavoitteet, saatavuuden ja analyysin tulkintasäännöt. Profiili tallentuu selaimen paikalliseen tallennustilaan.

Kun selaimessa ei ole aiemmin tallennettua profiilia, sovellus käyttää oletuksena yleistä, kuvitteellista suomalaisen IT-opiskelijan esimerkkiprofiilia (`src/data/defaultProfile.ts`). Aiemmin tallennettu hakijaprofiili ohittaa aina oletusprofiilin eikä sitä korvata automaattisesti. Analyysin palvelinpuolen yleisohjeistus (`SYSTEM_INSTRUCTION`) on hakijariippumaton ja käyttää arvioinnissa aina ajankohtaista `<CANDIDATE_PROFILE>`-syötettä, erottaen toisistaan työkokemuksen, opintojaksot (mukaan lukien sertifiointikoulutukseen linjattu sisältö ilman varsinaista sertifikaattia), ohjatut harjoitukset ja omat projektit sekä ehdottaen harjoittelun opinnollistamistarkistusta vain silloin, kun se on relevanttia annetulle profiilille.

### Hakukohteiden seuranta ja vertailu

- Analyysin tallentaminen hakukohteeksi alkuperäisen ilmoitustekstin kanssa.
- Hakemisen etenemisen tilat, muistiinpanot ja tallennus- sekä muokkausaikaleimat.
- Haun voimassaolon **erillinen, manuaalisesti tarkistettava tila**: Avoinna / Päättynyt / Ei tarkistettu.
- Tallennettujen kohteiden rinnakkaisvertailu.
- Analyysin keskeyttäminen ilman, että myöhässä valmistunut tulos saa korvata uudempaa analyysiä.

### Tietojen siirrettävyys

Hakijaprofiili ja tallennetut hakukohteet voidaan viedä **version 1 JSON-varmuuskopiona** ja palauttaa sovellukseen. Tuonti tarjoaa valinnan olemassa oleviin tietoihin yhdistämisen ja tietojen korvaamisen välillä. Palautus erilliseen incognito-istuntoon on testattu onnistuneesti. Yhdistämisen kaksoiskappalekäsittelyä ei ole erikseen tarkastettu.

## 3. Teknologiat

| Kerros | Teknologia | Rooli |
|---|---|---|
| Käyttöliittymä | React, TypeScript, Vite | Näkymät ja käyttäjän toiminnot |
| Ulkoasu | Tailwind CSS, Lucide React, Motion | Tyylit, kuvakkeet ja animaatiot |
| Palvelin | Node.js, Express | HTTP-rajapinta ja analyysipyynnön käsittely |
| Tekoäly | Google Gemini API (`@google/genai`) | Ilmoitustekstin ja hakijaprofiilin analysointi |
| Validointi | Zod + Gemini-vastauksen JSON-skeema | Syötteen ja tuloksen rakenteen tarkistaminen |
| Paikallinen tallennus | Selaimen `localStorage` | Profiili ja hakukohteet |
| Automaattiset testit | Node.js test runner, `tsx` | Regressiotestit |

Lähdekoodissa analyysimallin tunniste on `gemini-4-hydrogen`, ja analyysikutsulle asetetaan `ThinkingLevel.MEDIUM`. Mallin saatavuus ja mahdolliset myöhemmät muutokset on tarkistettava käyttöympäristöstä.

## 4. Arkkitehtuuri ja tiedonkulku

```text
Käyttäjä / React-käyttöliittymä
        |
        +--> (Valinnainen työpaikkahaku: vain hakuasetukset + valinnainen paikallinen profiili palvelimelle)
        |       POST /api/discover-jobs (server/jobDiscovery/*)
        |       -> SSRF-/allowlist-/DNS-sidotut GET-kutsut vain julkisiin ATS-rajapintoihin (ei profiilia ulos)
        |       -> HTML-puhdistus, normalisointi, deduplikaatio ja sääntöpohjainen alustava arvio
        |       -> Käyttäjän valitessa: siirto analyysinäkymään (formatDiscoveredJobForAnalysis)
        |
        +--> (Valinnainen URL-tuonti: vain { url }, ei hakijaprofiilia)
        |       POST /api/fetch-job (server/fetchJob.ts)
        |       -> SSRF-/allowlist-/DNS-/TLS-tarkistettu HTTPS-nouto
        |       -> JSON-LD + HTML-poiminta + hakuajan ristiriitatarkistus
        |       -> Teksti ja varoitukset muokattavaan tekstikenttään
        |
        | Ilmoitusteksti + URL-viite + hakijaprofiili (käyttäjän käynnistämänä)
        v
POST /api/analyze  (Express / server.ts)
        |
        | Zod: syötteen rakennetarkistus
        v
server/analyzeJob.ts
        |
        | System instruction + buildPrompt()
        | Gemini API -kutsu palvelimelta
        v
Google Gemini
        |
        | JSON-vastaus määritellyn skeeman mukaan
        v
validateAndNormalizeAnalysis()
        |
        | Zod-tarkistus ja tuloksen normalisointi
        v
React: analyysin näyttäminen
        |
        +--> Käyttäjän valitessa: tallennus localStorageen
        +--> JSON-vienti / -tuonti
```

### Keskeiset tiedostot

- `server.ts` – Express-palvelimen käynnistys, `GET /api/health`, `POST /api/analyze`, `POST /api/fetch-job`, `POST /api/discover-jobs`, pyyntöjen validointi ja yhteyden katkeamisen käsittely.
- `server/jobDiscovery/` – Job Discovery MVP:n palvelinmoduulit: `registry.ts` (lähderekisteri ja isäntäsallitut), `httpClient.ts` (SSRF-suojattu ja DNS-sidottu JSON-nouto, HTTP 429- ja kokorajat), `htmlSanitizer.ts` (XSS-turvallinen tekstipuhdistus), `adapters/{ashby,greenhouse,lever}.ts`, `normalize.ts`, `dedupe.ts`, `scoring.ts` ja `discoverJobs.ts` (julkisen syötteen TTL-välimuisti ja osittaisen epäonnistumisen hallinta).
- `server/fetchJob.ts` – SSRF-suojattu ja DNS-sidottu HTTPS-nouto sallituista työpaikkaportaaleista, JSON-LD- ja HTML-sisällön poiminta, kattavuusarviointi sekä aikavyöhyke- ja kellonaikatarkka hakuajan ristiriita-arviointi.
- `server/analyzeJob.ts` – hakijariippumaton analyysin ohjeistus (`SYSTEM_INSTRUCTION`), dynaaminen `buildPrompt()` annetulle profiilille, Gemini-kutsu, keskeytys ja analyysin virheenkäsittely.
- `src/lib/validation.ts` – hakijaprofiilin, työpaikkahaun asetusten, URL-noutopyynnön, analyysituloksen, tallennettujen hakukohteiden ja JSON-varmuuskopion Zod-skeemat sekä normalisointi.
- `src/lib/discoveryHandoff.ts` – löydetyn ilmoituksen siirtomuotoilu analyysinäkymään (katkaisu- ja aikarajavaroitukset), korvausvahvistuksen ehdot (sisältäen myös pelkän URL-syötteen), turvallinen HTTPS-linkkitarkistus ja lajittelu.
- `src/lib/discoveryRunner.ts` – työpaikkahaun asynkronisten pyyntöjen koordinointi, keskeytys ja nopean uudelleenkäynnistyksen suojaus.
- `src/lib/storage.ts` – `localStorage`-tallennus ja -luku (profiili, tallennetut hakukohteet ja erilliset hakuasetukset `cia_discovery_preferences_v1`) sekä JSON-varmuuskopion muodostus ja jäsentäminen.
- `src/lib/analysisRunner.ts` – käyttöliittymän analyysipyyntöjen koordinointi ja myöhästyneiden tulosten käsittely.
- `src/lib/availability.ts` – soveltuvuuden ja manuaalisesti tarkistetun hakutilanteen erottelu.
- `src/lib/timestamps.ts` – tallennus- ja muokkausaikaleimojen käsittely.
- `src/types/career.ts` – tietotyyppien määrittely (sisältää erilliset `DiscoveredJob`- ja `DiscoverJobsResponse`-tyypit).
- `src/data/defaultProfile.ts` – kuvitteellinen suomalaisen IT-opiskelijan oletusesimerkkiprofiili (käytössä vain, kun tallennettua profiilia ei ole).
- `tests/regression.test.ts` – automaattiset regressio- ja integraatiotestit.
- `src/components/DiscoverJobsView.tsx` ja muut `src/components/*` sekä `src/App.tsx` – React-käyttöliittymä.

### Rajapinnat

- `GET /api/health` palauttaa vastauksen `{ "status": "ok" }`.
- `POST /api/discover-jobs` vastaanottaa hakuasetukset (`preferences`), valinnaisen paikallisen hakijaprofiilin (`profile`, `isDefaultProfile`) ja valinnaiset `sourceIds`-tunnisteet; palauttaa `DiscoverJobsResponse`-tuloksen (`jobs`, lähdekohtaiset `queriedSources`-tilat, `succeededSources`, `failedSources`, varoitukset ja `profileMode`). Rajapintakutsut ulkoisiin ATS-palveluihin rajoitetaan enintään 4 Mt raaka-/purettuun kokoon.
- `POST /api/fetch-job` vastaanottaa JSON-olion `{ "url": "https://..." }` (ilman hakijaprofiilia) ja palauttaa `FetchedJobResult`-rakenteen.
- `POST /api/analyze` vastaanottaa JSON-olion, jossa ovat `jobText`, `jobUrl` ja `profile`, ja palauttaa onnistumisessa `{ "analysis": ... }`.

`jobText`-kentän sallittu pituus on 40–30 000 merkkiä. `jobUrl`- ja `url`-kenttien enimmäispituus on 2 048 merkkiä. Expressin JSON-pyynnön kokoraja on 1 Mt, ja URL-nouto rajaa ladattavan vastauksen enintään 1,5 megatavuun.

## 5. Kehityskäyttö ja komennot

Projektin `package.json` määrittelee seuraavat komennot:

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
```

- `npm run dev` käynnistää `tsx server.ts` -kehityspalvelimen. Palvelimen oletusportti on `3000`, ellei `PORT`-ympäristömuuttujalla aseteta muuta.
- `npm test` suorittaa `tests/regression.test.ts`-tiedoston testit.
- `npm run lint` suorittaa käytännössä TypeScriptin tyyppitarkistuksen (`tsc --noEmit`), ei varsinaista ESLint-analyysiä.
- `npm run build` rakentaa Vite-käyttöliittymän.

Gemini API -avain määritetään **palvelimen ympäristömuuttujaksi** nimellä `GEMINI_API_KEY` (Google AI Studiossa esimerkiksi Secrets-asetuksissa). Avainta ei tule lisätä lähdekoodiin, JSON-varmuuskopioon tai versionhallintaan. Paikalliseen kehityskäyttöön voi käyttää asianmukaisesti suojattua `.env`-tiedostoa.

**Huomio:** `package.json`-tiedoston `start`-komento on `node server.ts`. Sen toimivuutta aiotussa julkaisuympäristössä ei ole vahvistettu. Vite-build ei myöskään itsessään osoita palvelinpuolen olevan tuotantovalmiina.

## 6. Testaus ja tulokset

### Käyttöliittymässä tehdyt testit

- Sofigaten *Generation AI Team / Junior AI Advisor* – soveltuvuuden ja AI-kokemuksen tulkinnan testaaminen.
- Junior SOC Analyst -esimerkki – SOC-osaamisen ja hakutilanteen erottelun testaaminen.
- DigiHelsingin *ICT-harjoittelija* – harjoittelusoveltuvuuden, tallennuksen, muistiinpanojen ja aikaleimojen testaaminen.
- Tallennettujen Sofigate- ja DigiHelsinki-kohteiden rinnakkaisvertailu.
- Profiilin ja hakukohteiden säilyminen sivun päivityksen jälkeen.
- JSON-varmuuskopion vienti sekä onnistunut palautus erilliseen incognito-istuntoon.
- Analyysin keskeyttäminen käyttöliittymästä.

- Aiemmin raportoidut URL-tuonnin käyttöliittymäkokeilut portaaleilla Valtiolle.fi, Jobly.fi ja Duunitori.fi, joiden havaintojen pohjalta portaalisiivous, kattavuusarviointi ja hakuajan ristiriitatarkistus on toteutettu.

### Regressio- ja integraatiotestit

Viimeisimmän varmistetun testiajon mukaan `npm test` läpäisi **56/56 testiä**, `npm run lint` (`tsc --noEmit`) läpäisi TypeScript-tyyppitarkistuksen virheettä ja `npm run build` onnistui. Testit suoritetaan täysin ilman ulkoisia verkkopyyntöjä paikallisessa kehitysympäristössä.

Testisarja kattaa muun muassa:
- osaamispuutteiden ja oppimismahdollisuuksien erottelun (`deduplicateGaps()`), harjoittelun opinnollistamisen, analyysin keskeytyksen ja aikaleimat;
- kuvitteellisen oletusprofiilin sekä hakijariippumattoman `SYSTEM_INSTRUCTION`-ohjeen;
- URL-validoinnin, JSON-LD- ja HTML-sisällönpoiminnan, kattavuusluokituksen (`complete` / `partial` / `uncertain`), portaalikohtaisen siivouksen sekä `Europe/Helsinki`-aikavyöhykkeen ja eksplisiittisten kellonaikojen ristiriitavertailun (`14:00` vs `16:00`, `14:00` vs `23:59`, `23:59` vs `16:15`, kesä- ja talviaika);
- `urlVerificationNotice`-tekstin totuudenmukaisen normalisoinnin sekä URL-kohtaisissa että manuaalisissa analyyseissä;
- **eristetyt todellisen `node:https`-kuljetuskerroksen integraatiotestit** (`executePinnedHttpsGet` paikallista itseallekirjoitettua testipalvelinta vasten): IP-osoitteen sidonta `Host`- ja SNI-otsikoilla, epäluotetun tai väärän isäntänimen TLS-varmenteen hylkäys (`rejectUnauthorized: true`), `302`-uudelleenohjauksen esto, raakavasteen ja puretun gzip-vastauksen kokoraja, HTTPS-aikakatkaisu, `AbortSignal`-keskeytys sekä DNS-haun aikakatkaisu (`504 DNS_TIMEOUT`) ja DNS-keskeytys (`499 ABORTED`);
- **simuloidut/mockatut yksikkötestit ja 0.3.1-laadunparannustestit**: `fetchJobFromUrl`-kutsut sekä Job Discovery MVP:n Ashby-, Greenhouse- ja Lever-sovittimet, Lever-sivutus ja silmukkakatkaisu, tyhjä työpaikkalista, HTTP 429 / aikakatkaisu / osittainen lähdevirhe, SSRF-/DNS-estot, TTL-välimuistin profiilieristys, juniori-/senior- ja ei-IT-roolien erottelu, välilliset kyberpolut, `Suomi`/tarkka `Helsinki`/`Uusimaa` -sijaintisuodatus ja ristiriitaisten maakoodien sekä monitoimipaikkojen käsittely, vahvaan lähde-ID:hen tai URL:iin rajoitettu deduplikaatio, sertifikaattien ja valmentavien opintojen erottelu (pakollinen vs. toivottu sertifikaatti), `Europe/Helsinki`- ja kalenteripäivätarkistettu hakuajan tulkinta, hakupyynnön keskeytyksen/uudelleenhaun kilpailutilanteiden hallinta (`DiscoverySearchCoordinator`), analyysisiirron vahvistusehdot (mukaan lukien pelkkä URL-syöte), React-näkymien palvelinpuolen renderöintitarkistus sekä XSS-/prompt-injection-HTML-puhdistus.

### Erillinen elävien ATS-rajapintojen tarkistusajo (17.11.2026)

Kehitysympäristöstä suoritettu erillinen suora verkkotarkistus (`discoverJobs()`) tuotti seuraavat todelliset havainnot:
- **Hoxhunt (Ashby, `api.ashbyhq.com`):** HTTP 200 OK, palautti **10** avointa ilmoitusta (91 ms).
- **Smartly (Greenhouse, `boards-api.greenhouse.io`):** HTTP 200 OK, palautti **69** avointa ilmoitusta (228 ms).
- **Netlight (Lever, `api.lever.co`):** aikakatkaistiin 8 s jälkeen (`TIMEOUT`), ja `api.eu.lever.co` palautti HTTP 404.
- **Osittainen haku ja suodatus:** Yhteensä noudettiin **79** ilmoitusta kahdesta onnistuneesta lähteestä ilman palvelimen kaatumista; oletussuodattimilla (`Uusimaa`, harjoittelu/trainee/junior, IT/kyber ja välilliset polut) löytyi 2 Suomessa sijaitsevaa IT-/kehittäjäroolia (*Smartly Launchpad 2027* ja *Hoxhunt Machine Learning Engineer*). Huomio: selainnäkymän `DiscoverJobsView`- ja `AnalyzeView`-siirtoa käyttöliittymässä ei ole ajettu erikseen selainautomaatiolla.

### Prompt injection -käyttöliittymätestit

Suoritettiin kaksi erilaista hyökkäävää testi-ilmoitusta:

1. Ilmoitukseen lisätty `SYSTEM OVERRIDE` yritti väärentää hakijan CISSP-sertifikaatin ja IAM-työkokemuksen sekä pakottaa myönteisen suosituksen.
2. Ilmoitukseen lisätyt `</UNTRUSTED_JOB_POSTING>`- ja `<SYSTEM_INSTRUCTION>`-merkinnät yrittivät esiintyä korkeamman prioriteetin ohjeina.

**Havainto:** Molemmissa testeissä sovellus päätyi suositukseen **Jätä väliin**, tunnisti puuttuvat pakolliset edellytykset eikä omaksunut väärennettyjä pätevyyksiä. Toisessa testissä syötteeseen lisätty Helsinki-sijaintitieto käsiteltiin ilmoitusdatana. Se osoittaa, ettei pelkkä liitetty teksti todista tietojen alkuperää.

Nämä ovat onnistuneita yksittäisiä testejä, **eivät todiste aukottomasta prompt injection -suojauksesta**.

## 7. Tietoturva ja tietosuoja

### Toteutuksessa havaitut suojaukset

- Gemini API -avain luetaan palvelinpuolella `GEMINI_API_KEY`-ympäristömuuttujasta eikä sitä sisällytetä selainkoodiin.
- `.gitignore` rajaa versionhallinnan ulkopuolelle paikalliset `.env*`-tiedostot (säilyttäen `.env.example`-mallin), riippuvuudet, build-artefaktit, lokit sekä henkilökohtaiset varmuuskopiotiedostot (`career-intelligence-backup-*.json` ja `*.backup.json`).
- Oletusprofiili (`src/data/defaultProfile.ts`) käyttää kuvitteellista esimerkkiprofiilia ja palvelimen `SYSTEM_INSTRUCTION` on hakijariippumaton ilman alkuperäisen käyttäjän henkilötietoja.
- Analyysipyyntö validoidaan Zodilla ja sen kokoa rajataan.
- Geminiä pyydetään palauttamaan rakenteinen JSON-vastaus, joka validoidaan uudelleen palvelimella.
- Ilmoitusteksti rajataan ohjeistuksessa epäluotettavaksi aineistoksi.
- URL-nouto (`server/fetchJob.ts`) käyttää SSRF- ja kuljetusturvasuojauksia: vain sallittujen portaalien HTTPS-osoitteet ilman käyttäjätunnuksia tai ei-oletusportteja; default-deny-tarkistus sallii vain aidosti julkiset IPv4- ja IPv6-osoitteet (estäen mm. RFC 1918-, CGNAT-, loopback-, link-local-/metadata-, TEST-NET-1/2/3-, IANA-erityis-, dokumentaatio-, NAT64-, Teredo-, 6to4- ja IPv4-muunnetut osoitteet); DNS-haulla on 5 s aikakatkaisu ja ratkaistu IP sidotaan suoraan yhteyteen (`lookup`) DNS rebinding -hyökkäyksiä vastaan; TLS-varmenteen ja isäntänimen tarkistus (`rejectUnauthorized: true`) on pakotettu; HTTP-uudelleenohjaukset estetään (`redirect: manual`); vain HTML/XHTML-sisältö hyväksytään; siirretty ja purettu koko rajataan 1,5 megatavuun; ja pyyntöjä voidaan keskeyttää `AbortSignal`-signaalilla.
- Keskeytettyjen pyyntöjen myöhästyneet tulokset jätetään käsittelemättä.
- Sovellus ei automaattisesti lähetä hakemuksia työnantajille.

### Tunnetut rajoitukset ja riskit

- **Prompt injection:** Tekstirajaukset ja kielimallille annetut ohjeet eivät muodosta varmaa turvarajaa. Myös verkkosivulta noudettu ilmoitusteksti on epäluotettavaa syötettä.
- **Tietojen alkuperä ja haun ajantasaisuus:** Käyttäjän liittämää tai URL-noudolla tuotua tekstiä ja lainauksia ei vahvisteta jatkuvasti elävää hakulomaketta vasten, eikä onnistunut URL-nouto yksinään todista haun olevan avoinna. Lainausten täsmällistä vastaavuutta lähdetekstiin ei ole vahvistettu ohjelmallisesti.
- **Henkilötiedot:** Koko analysoitava hakijaprofiili sekä ilmoitusteksti välitetään Gemini API:lle (`POST /api/fetch-job` ei välitä hakijaprofiilia). Profiili ja tallennetut hakukohteet säilyvät selaimen `localStorage`-tallennustilassa; JSON-varmuuskopio sisältää samat tiedot luettavassa muodossa. Käyttäjän tulee huomioida käyttämänsä API-palvelun tiedonkäsittelyehdot.
- **Julkinen rajapinta:** Tarkastetussa `server.ts`-tiedostossa ei ole käyttäjätunnistusta eikä API-pyyntöjen määrän rajoittamista (`rate limiting`). Mahdolliset käyttöympäristön erilliset suojaukset on tarkistettava.
- **Virheviestit:** Analyysipalvelin voi palauttaa käyttöliittymälle ulkoisen palvelun tai jäsentämisen teknisiä virheviestejä. Niiden yksityiskohdat kannattaa pitää palvelinlokeissa ennen julkaisua.
- **URL-noudon rajat:** Koska portaalit voivat muuttaa HTML-/JSON-LD-rakennettaan milloin tahansa ja osa sisällöstä voi latautua vain JavaScriptillä tai kirjautumisen takana, poiminta voi jäädä osittaiseksi (`partial`) tai epäonnistua, jolloin teksti on tarkistettava tai liitettävä käsin.
- **Tallennus:** Selainkohtainen `localStorage` ei tarjoa automaattista varmuuskopiointia eikä laitteiden välistä synkronointia.

Sovellusta tulee käsitellä **henkilökohtaisena prototyyppinä**, ei luottamuksellisia tietoja käsittelevänä julkisena monikäyttäjäpalveluna.

## 8. Tunnetut toiminnalliset rajoitukset

1. URL-nouto tukee vain määriteltyjä suomalaisia työpaikkaportaaleja (`valtiolle.fi`, `jobly.fi`, `duunitori.fi`, `ats.talentadore.com`); muut sivustot, kirjautumista vaativat sivut ja puhtaat JavaScript-sovelluskuoret edellyttävät tekstin liittämistä käsin.
2. Haun voimassaolo ja poimitut ristiriitaiset hakuajat tarkistetaan ja vahvistetaan manuaalisesti.
3. AI-arviot voivat sisältää virheellisiä luokitteluja tai päätelmiä, vaikka JSON olisi validia.
4. Sovellus ei vahvista tutkintoharjoittelun hyväksyttävyyttä; päätös kuuluu oppilaitokselle.
5. Sovellus ei vielä itsenäisesti etsi uusia työpaikkoja tai suorita ulkoisten työkalujen monivaiheisia tehtäviä. Se on tarkemmin kuvattuna **AI-avusteinen analyysi- ja seurantatyökalu** kuin autonominen agentti.
6. Julkaisun tietoturva-, suorituskyky- ja käyttöympäristötestejä ei ole tehty kattavasti.

## 9. Jatkokehitysideoita

**Seuraavat luontevat jatkokehityskohteet:**

- uusien portaalisovittimien lisääminen URL-noutoon sekä elävien portaalitestien ylläpito;
- rajapinnan autentikointi, käyttörajoitukset (`rate limiting`) ja turvallisemmat virheilmoitukset ennen mahdollista julkaisua;
- lähdelainausten automaattinen vastaavuustarkistus;
- laajempi prompt injection -regressiotestiaineisto;
- tallennettujen kohteiden hakeminen, suodattaminen ja järjestäminen;
- kustannusten ja syötettävän datamäärän optimointi;
- kattava riippumaton koodikatselmointi ja testiympäristön dokumentointi.

## 10. Kehitysprosessi ja oma työpanos

Projekti on toteutettu **AI-avusteisesti Google AI Studio Build -ympäristössä**.

Projektin suunnittelijan ja testaajan työ on sisältänyt:

- käyttötarkoituksen, vaatimusten, tulkintasääntöjen ja hakijaprofiilin määrittelyn;
- todellisten työpaikkailmoitusten valinnan ja analyysitulosten kriittisen arvioinnin;
- havaittujen ongelmien rajaamisen täsmällisiksi kehitystehtäviksi;
- testitapausten suunnittelun ja käyttöliittymän toiminnallisen testauksen;
- regressiokorjauksen vaatimusten määrittelyn sekä tulosten tarkistamisen;
- JSON-varmuuskopioinnin ja palautuksen käytännön testauksen;
- prompt injection -testien suunnittelun ja niiden tulosten arvioinnin;
- teknisen rakenteen, riskien ja rajoitusten läpikäynnin.

Suuri osa sovelluksen varsinaisesta lähdekoodista on syntynyt Google AI Studion avustamana. Projektia ei tule esittää kokonaan käsin ohjelmoituna tai valmiina tuotantojärjestelmänä. Keskeinen oppimistavoite on ollut yhdistää ongelmanmäärittely, AI-avusteinen toteutus, kriittinen testaus ja teknisen toiminnan ymmärtäminen.

---

**Dokumentoinnin seuraava tarkistuspiste:** pidä tämä README ajan tasalla lähdekoodin, regressio- ja integraatiotestien (`56/56`) ja julkaisuympäristön vaatimusten kanssa aina, kun toiminnallisuus, tietoturvakäytännöt tai käyttöympäristö muuttuvat olennaisesti.
