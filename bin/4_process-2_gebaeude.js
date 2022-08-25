#!/usr/bin/env node
'use strict'



const turf = require('@turf/turf');
const config = require('../config.js');
const { processAlkis, GeoPecker } = require('../lib/geohelper.js');



let isResidential = initLookup();
let pecker = GeoPecker(config.getFilename.mapFeature('wohngebiet.gpkg'));

processAlkis({
	slug: 'gebaeudeflaeche',
	ruleTypes: 'wohngebaeude'.split(','),
	filenameIn: config.getFilename.alkisGeo('gebaeudeflaeche.fgb'),
	cbFeature: feature => {
		let residential = isResidential.get(feature.properties.gebaeudefunktion)
		if (residential === undefined) throw Error(`Gebäudefunktion "${feature.properties.gebaeudefunktion}" unbekannt`);
		if (!residential) return;

		if (turf.area(feature) > 1e6) return;

		let p = turf.pointOnFeature(feature).geometry.coordinates;
		if (!pecker(p)) return;
		
		return 'wohngebaeude';
	},
	cbWindEntries: windEntries => windEntries.every(({ wind, distance }) => distance > 10),
})



function initLookup() {
	let isResidential = new Map();
	[
		'Allgemein bildende Schule',
		'Almhütte',
		'Apotheke',
		'Aquarium, Terrarium, Voliere',
		'Asylbewerberheim',
		'Badegebäude für medizinische Zwecke',
		'Badegebäude',
		'Bahnhofsgebäude',
		'Bahnwärterhaus',
		'Bergwerk',
		'Berufsbildende Schule',
		'Betriebsgebäude des Güterbahnhofs',
		'Betriebsgebäude für Flugverkehr',
		'Betriebsgebäude für Schienenverkehr',
		'Betriebsgebäude für Schiffsverkehr',
		'Betriebsgebäude für Straßenverkehr',
		'Betriebsgebäude zu Verkehrsanlagen (allgemein)',
		'Betriebsgebäude zur Schleuse',
		'Betriebsgebäude zur Seilbahn',
		'Betriebsgebäude',
		'Bezirksregierung',
		'Bibliothek, Bücherei',
		'Bootshaus',
		'Botschaft, Konsulat',
		'Brauerei',
		'Brennerei',
		'Burg, Festung',
		'Bürogebäude',
		'Campingplatzgebäude',
		'Dock (Halle)',
		'Einkaufszentrum',
		'Elektrizitätswerk',
		'Empfangsgebäude des botanischen Gartens',
		'Empfangsgebäude des Zoos',
		'Empfangsgebäude Schifffahrt',
		'Empfangsgebäude',
		'Fabrik',
		'Fahrzeughalle',
		'Festsaal',
		'Feuerwehr',
		'Finanzamt',
		'Flughafengebäude',
		'Flugzeughalle',
		'Forschungsinstitut',
		'Freizeit- und Vergnügungsstätte',
		'Freizeit-, Vereinsheim, Dorfgemeinschafts-, Bürgerhaus',
		'Friedhofsgebäude',
		'Garage',
		'Gaststätte, Restaurant',
		'Gaswerk',
		'Gebäude an unterirdischen Leitungen',
		'Gebäude der Abfalldeponie',
		'Gebäude der Kläranlage',
		'Gebäude für andere Erholungseinrichtung',
		'Gebäude für Beherbergung',
		'Gebäude für betriebliche Sozialeinrichtung',
		'Gebäude für Bewirtung',
		'Gebäude für Bildung und Forschung',
		'Gebäude für Erholungszwecke',
		'Gebäude für Fernmeldewesen',
		'Gebäude für Forschungszwecke',
		'Gebäude für Gesundheitswesen',
		'Gebäude für Gewerbe und Industrie',
		'Gebäude für Grundstoffgewinnung',
		'Gebäude für Handel und Dienstleistungen',
		'Gebäude für kulturelle Zwecke',
		'Gebäude für Kurbetrieb',
		'Gebäude für Land- und Forstwirtschaft',
		'Gebäude für religiöse Zwecke',
		'Gebäude für Sicherheit und Ordnung',
		'Gebäude für soziale Zwecke',
		'Gebäude für Sportzwecke',
		'Gebäude für Vorratshaltung',
		'Gebäude für Wirtschaft oder Gewerbe',
		'Gebäude für öffentliche Zwecke',
		'Gebäude im botanischen Garten',
		'Gebäude im Freibad',
		'Gebäude im Stadion',
		'Gebäude im Zoo',
		'Gebäude zum Busbahnhof',
		'Gebäude zum Parken',
		'Gebäude zum S-Bahnhof',
		'Gebäude zum Sportplatz',
		'Gebäude zum U-Bahnhof',
		'Gebäude zur Abfallbehandlung',
		'Gebäude zur Abwasserbeseitigung',
		'Gebäude zur Elektrizitätsversorgung',
		'Gebäude zur Energieversorgung',
		'Gebäude zur Entsorgung',
		'Gebäude zur Freizeitgestaltung',
		'Gebäude zur Gasversorgung',
		'Gebäude zur Müllverbrennung',
		'Gebäude zur Versorgung',
		'Gebäude zur Versorgungsanlage',
		'Gebäude zur Wasserversorgung',
		'Gemeindehaus',
		'Gericht',
		'Geschäftsgebäude',
		'Gewächshaus (Botanik)',
		'Gewächshaus, verschiebbar',
		'Gotteshaus',
		'Hallenbad',
		'Heilanstalt, Pflegeanstalt, Pflegestation',
		'Heizwerk',
		'Hochschulgebäude (Fachhochschule, Universität)',
		'Hotel, Motel, Pension',
		'Hütte (mit Übernachtungsmöglichkeit)',
		'Hütte (ohne Übernachtungsmöglichkeit)',
		'Jagdhaus, Jagdhütte',
		'Jugendfreizeitheim',
		'Jugendherberge',
		'Justizvollzugsanstalt',
		'Kantine',
		'Kapelle',
		'Kaserne',
		'Kaufhaus',
		'Kegel-, Bowlinghalle',
		'Kesselhaus',
		'Kinderkrippe, Kindergarten, Kindertagesstätte',
		'Kino',
		'Kiosk',
		'Kirche',
		'Kloster',
		'Konzertgebäude',
		'Krankenhaus',
		'Kreditinstitut',
		'Kreisverwaltung',
		'Krematorium',
		'Kühlhaus',
		'Laden',
		'Lagerhalle, Lagerschuppen, Lagerhaus',
		'Land- und forstwirtschaftliches Betriebsgebäude',
		'Lokschuppen, Wagenhalle',
		'Markthalle',
		'Messehalle',
		'Moschee',
		'Museum',
		'Mühle',
		'Müllbunker',
		'Obdachlosenheim',
		'Parkdeck',
		'Parkhaus',
		'Parlament',
		'Pflanzenschauhaus',
		'Polizei',
		'Post',
		'Produktionsgebäude',
		'Pumpstation',
		'Pumpwerk (nicht für Wasserversorgung)',
		'Rathaus',
		'Reaktorgebäude',
		'Reithalle',
		'Rundfunk, Fernsehen',
		'Saline',
		'Sanatorium',
		'Scheune und Stall',
		'Scheune',
		'Schloss',
		'Schuppen',
		'Schutzbunker',
		'Schutzhütte',
		'Schöpfwerk',
		'Seniorenfreizeitstätte',
		'Sonstiges Gebäude für Gewerbe und Industrie',
		'Spannwerk zur Drahtseilbahn',
		'Speditionsgebäude',
		'Speichergebäude',
		'Spielkasino',
		'Sport-, Turnhalle',
		'Stall für Tiergroßhaltung',
		'Stall im Zoo',
		'Stall',
		'Stellwerk, Blockstelle',
		'Straßenmeisterei',
		'Synagoge',
		'Sägewerk',
		'Tankstelle',
		'Tempel',
		'Theater, Oper',
		'Tiefgarage',
		'Tierschauhaus',
		'Toilette',
		'Touristisches Informationszentrum',
		'Trauerhalle',
		'Treibhaus',
		'Treibhaus, Gewächshaus',
		'Turbinenhaus',
		'Umformer',
		'Umspannwerk',
		'Veranstaltungsgebäude',
		'Versicherung',
		'Verwaltungsgebäude',
		'Wartehalle',
		'Waschstraße, Waschanlage, Waschhalle',
		'Wasserbehälter',
		'Wassermühle',
		'Wasserwerk',
		'Werft (Halle)',
		'Werkstatt',
		'Wetterstation',
		'Windmühle',
		'Wirtschaftsgebäude',
		'Zollamt',
		'Ärztehaus, Poliklinik',
		'',
		undefined
	].forEach(label => isResidential.set(label, false));

	[
		'Bauernhaus',
		'Ferienhaus',
		'Forsthaus',
		'Gartenhaus',
		'Gebäude für Gewerbe und Industrie mit Wohnen',
		'Gebäude für Handel und Dienstleistung mit Wohnen',
		'Gebäude für öffentliche Zwecke mit Wohnen',
		'Gemischt genutztes Gebäude mit Wohnen',
		'Kinderheim',
		'Land- und forstwirtschaftliches Wohn- und Betriebsgebäude',
		'Land- und forstwirtschaftliches Wohngebäude',
		'Schullandheim',
		'Schwesternwohnheim',
		'Seniorenheim',
		'Studenten-, Schülerwohnheim',
		'Wochenendhaus',
		'Wohn- und Betriebsgebäude',
		'Wohn- und Bürogebäude',
		'Wohn- und Geschäftsgebäude',
		'Wohn- und Verwaltungsgebäude',
		'Wohn- und Wirtschaftsgebäude',
		'Wohngebäude mit Gemeinbedarf',
		'Wohngebäude mit Gewerbe und Industrie',
		'Wohngebäude mit Handel und Dienstleistungen',
		'Wohngebäude',
		'Wohnhaus',
		'Wohnheim',
		'Nach Quellenlage nicht zu spezifizieren',
	].forEach(label => isResidential.set(label, true));

	return isResidential;
}
