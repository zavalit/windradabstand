'use strict'

const fs = require('fs');
const child_process = require('child_process');
const turf = require('@turf/turf');
const miss = require('mississippi2');
const polygonClipping = require('polygon-clipping');
const config = require('../config.js');
const { Progress, getSpawn, calcTemporaryFilename, prefixFilename, GzipFileWriter } = require('./helper.js');
const { basename, extname } = require('path');
const gdal = require('gdal');
const { createGunzip, createGzip } = require('zlib');



const tiny = 1e-6; // tiny distance in degrees, e.g. 1e-6 = 10cm



const BUNDESLAENDER = [
	{ ags: 1, name: 'Schleswig-Holstein' },
	{ ags: 2, name: 'Hamburg' },
	{ ags: 3, name: 'Niedersachsen' },
	{ ags: 4, name: 'Bremen' },
	{ ags: 5, name: 'Nordrhein-Westfalen' },
	{ ags: 6, name: 'Hessen' },
	{ ags: 7, name: 'Rheinland-Pfalz' },
	{ ags: 8, name: 'Baden-Württemberg' },
	{ ags: 9, name: 'Bayern' },
	{ ags: 10, name: 'Saarland' },
	{ ags: 11, name: 'Berlin' },
	{ ags: 12, name: 'Brandenburg' },
	{ ags: 13, name: 'Mecklenburg-Vorpommern' },
	{ ags: 14, name: 'Sachsen' },
	{ ags: 15, name: 'Sachsen-Anhalt' },
	{ ags: 16, name: 'Thüringen' },
]




const mercator = {
	x: v => (v + 180) / 360,
	y: v => 0.5 * (1 - Math.log(Math.tan(Math.PI * (1 + v / 90) / 4)) / Math.PI),
}

const demercator = {
	x: v => v * 360 - 180,
	y: v => (Math.atan(Math.exp((1 - v * 2) * Math.PI)) * 4 / Math.PI - 1) * 90,
}


module.exports = {
	bbox2Tiles,
	bbox4326To3857,
	bboxGeo2WebPixel,
	bboxWebPixel2Geo,
	BundeslandFinder,
	convertGzippedGeoJSONSeq2Anything,
	coords2Feature,
	demercator,
	doBboxOverlap,
	features2Coords,
	generateUnionVRT,
	GeoPecker,
	getBundeslaender,
	getTileBbox,
	intersect,
	mercator,
	mergeFiles,
	ogrGenerateSQL,
	ogrGetLayername,
	ogrLoadGpkgAsGeojsonStream,
	ogrWrapFileDriver,
	processAlkis,
	union,
	unionAndClipFeatures,
	unionAndClipFeaturesDC,
}



function getBundeslaender() {
	// Bundesländer mit BBoxes
	const lookupAGS = new Map(BUNDESLAENDER.map(b => [b.ags, Object.assign({ features: [] }, b)]))
	const featureCollection = JSON.parse(fs.readFileSync(config.getFilename.static('bundeslaender.geojson')));
	featureCollection.features.forEach(feature => {
		// Nur Landflächen
		if (feature.properties.GF !== 4) return;

		const b = lookupAGS.get(parseInt(feature.properties.AGS, 10));
		if (!b) throw Error();
		b.features.push(feature);
	})
	let bundeslaender = Array.from(lookupAGS.values());
	bundeslaender = bundeslaender.map(b => {
		let feature = union(...(b.features));
		feature.properties.ags = b.ags;
		feature.properties.name = b.name;
		feature.bbox = turf.bbox(feature);
		return feature;
	})
	return bundeslaender;
}

function BundeslandFinder() {
	let filenameCache = config.getFilename.helper('bundeslandFinder.json');
	let geoFinder = GeoFinder();

	if (!fs.existsSync(filenameCache)) {
		geoFinder.create(turf.featureCollection(getBundeslaender()), filenameCache)
	}

	geoFinder.load(filenameCache);

	return (lng, lat) => {
		let result = geoFinder.lookupCoordinates(lng, lat);

		if (result.length === 1) return result[0];
		if (result.length === 0) return false;

		console.log();
		console.log(lng, lat);
		console.log(result);
		result.forEach(p => console.log(JSON.stringify(p)));
		throw Error('polygons overlapping?');
	}
}

function GeoFinder() {
	let gridScale = 100; // 100 = 1km
	let grid;

	return {
		create,
		load,
		lookupCoordinates,
		lookupBbox,
	}

	function create(geoJSON, filename) {
		let grid = new Map();
		let [xc, yc] = turf.center(geoJSON).geometry.coordinates;
		let gridCellSize = turf.area(turf.bboxPolygon([xc, yc, xc + 1, yc + 1].map(v => v / gridScale)));
		let progress = Progress(turf.area(geoJSON) / gridCellSize);
		let areaSum = 0;

		geoJSON.features.forEach((f, i) => f.properties._index = i);

		turf.flatten(geoJSON).features.forEach(polygon => {
			let bbox = turf.bbox(polygon);

			let x0 = Math.floor(bbox[0] * gridScale);
			let y0 = Math.floor(bbox[1] * gridScale);
			let x1 = Math.floor(bbox[2] * gridScale);
			let y1 = Math.floor(bbox[3] * gridScale);

			splitRecursive(polygon, x0, y0, x1, y1);

			function splitRecursive(part, x0, y0, x1, y1) {
				if (!part) return;

				if ((x0 === x1) && (y0 === y1)) {
					// single grid cell

					// update progress
					areaSum += turf.area(part);
					progress(areaSum / gridCellSize);

					// check if complete
					let box = turf.bboxPolygon([
						(x0) / gridScale,
						(y0) / gridScale,
						(x1 + 1) / gridScale,
						(y1 + 1) / gridScale,
					])

					if (turf.difference(box, part)) {
						// cleanup geometry
						turf.truncate(part, { precision: 5, mutate: true })
					} else {
						// part covers whole cell
						part.full = true;
					}

					// cleanup data
					part.index = polygon.properties._index;
					delete part.properties;

					let key = x0 + '_' + y0;
					if (!grid.has(key)) grid.set(key, []);
					grid.get(key).push(part);

					return
				}

				if (y1 - y0 > x1 - x0) {
					// split horizontal
					let yc = Math.floor((y0 + y1) / 2);
					split(x0, y0, x1, yc);
					split(x0, yc + 1, x1, y1);
				} else {
					// split vertical
					let xc = Math.floor((x0 + x1) / 2);
					split(x0, y0, xc, y1);
					split(xc + 1, y0, x1, y1);
				}

				function split(x0, y0, x1, y1) {
					let box = turf.bboxPolygon([
						(x0) / gridScale - tiny,
						(y0) / gridScale - tiny,
						(x1 + 1) / gridScale + tiny,
						(y1 + 1) / gridScale + tiny,
					])
					splitRecursive(turf.intersect(box, part), x0, y0, x1, y1);
				}
			}
		})

		console.log();

		let data = {
			features: geoJSON.features,
			grid: Array.from(grid.entries()),
		}

		fs.writeFileSync(filename, JSON.stringify(data));
	}

	function load(filename) {
		let data = JSON.parse(fs.readFileSync(filename));
		data.grid.forEach(entries => {
			entries[1].forEach(entry => {
				entry.feature = data.features[entry.index];
			})
		})
		grid = new Map(data.grid);
	}

	function lookupCoordinates(lng, lat) {
		let point = [lng, lat]
		let x = Math.floor(lng * gridScale);
		let y = Math.floor(lat * gridScale);
		let key = x + '_' + y;
		if (!grid.has(key)) return [];
		return grid.get(key).filter(polygon =>
			polygon.full || turf.booleanPointInPolygon(point, polygon)
		).map(polygon => polygon.feature)
	}

	function lookupBbox(bbox) {
		let x0 = Math.floor(bbox[0] * gridScale);
		let y0 = Math.floor(bbox[1] * gridScale);
		let x1 = Math.floor(bbox[2] * gridScale);
		let y1 = Math.floor(bbox[3] * gridScale);

		let features = new Set();
		for (let y = y0; y <= y1; y++) {
			for (let x = x0; x <= x1; x++) {
				grid.get(x + '_' + y)?.forEach(polygon => features.add(polygon.feature))
			}
		}
		return Array.from(features.values());
	}
}

function GeoPecker(filename) {
	const CELLSIZE = 0.01;
	const CELLCOUNT = 30;
	const RADIUS = CELLSIZE * CELLCOUNT / 2;

	let file = gdal.open(filename, 'r');
	let layer = file.layers.get(0);
	let bbox = [0, 0, 0, 0];
	let grid, xc, yc;

	return check

	function check(point) {
		if (
			(point[0] < bbox[0]) ||
			(point[1] < bbox[1]) ||
			(point[0] > bbox[2]) ||
			(point[1] > bbox[3])
		) createCache(point);

		let x = Math.floor((point[0] - xc) / CELLSIZE);
		let y = Math.floor((point[1] - yc) / CELLSIZE);
		let key = x + '_' + y;
		let cell = grid.get(key);
		if (!cell) return false;

		return cell.p.some(poly => turf.booleanPointInPolygon(point, poly));
	}

	function createCache(p) {
		grid = new Map();
		xc = p[0];
		yc = p[1];

		bbox = [xc - RADIUS, yc - RADIUS, xc + RADIUS, yc + RADIUS];
		layer.setSpatialFilter(...bbox);
		layer.features.forEach(f => {
			f = {
				type: 'Feature',
				geometry: f.getGeometry().toObject()
			}
			turf.flatten(f).features.forEach(polygon => {
				let bbox = turf.bbox(polygon);

				let x0 = Math.max(-CELLCOUNT, Math.floor((bbox[0] - xc) / CELLSIZE));
				let y0 = Math.max(-CELLCOUNT, Math.floor((bbox[1] - yc) / CELLSIZE));
				let x1 = Math.min(CELLCOUNT, Math.floor((bbox[2] - xc) / CELLSIZE));
				let y1 = Math.min(CELLCOUNT, Math.floor((bbox[3] - yc) / CELLSIZE));

				for (let x = x0; x <= x1; x++) {
					for (let y = y0; y <= y1; y++) {
						let key = x + '_' + y;
						let cell = grid.get(key);
						if (!cell) grid.set(key, cell = { p: [] });
						cell.p.push(polygon);
					}
				}
			})
		})

		for (let cell of grid.values()) {
			try {
				cell.p = [coords2Feature(polygonClipping.union(features2Coords(cell.p)))];
			} catch (e) {
				// ignore
			}
		}
	}
}

/**
 * Verarbeitet einen ALKIS-Layer
 * @async
 * @param {string} slug - Name des Layers
 * @param {Array<String>} ruleTypes - Array von Regel-Typen, die berücksichtigt werden sollen
 * @param {Function} cbFeature - Callback, der ein Feature übergibt, das z.B. gesäubert werden kann. Falls false zurückgegeben wird, wird das Feature aussortiert.
 * @param {Function} [cbWindEntries] - optionaler Callback, der die Liste der gefundenen windEntries übergibt. Falls false zurückgegeben wird, wird das Feature aussortiert.
 */

function processAlkis(opt) {
	if (!opt) throw Error('need options');
	if (!opt.slug) throw Error('need slug');
	if (!opt.ruleTypes) throw Error('need ruleTypes');

	opt.slugIn ??= opt.slug;
	opt.slugOut ??= opt.slug;
	opt.filenameIn ??= config.getFilename.alkisGeo(opt.slug + '.fgb');

	if (!opt.cbFeature) throw Error('cbFeature is missing');

	if (!fs.existsSync(opt.filenameIn)) {
		console.log(opt);
		throw Error(opt.filenameIn + ' is missing');
	}

	opt.ruleTypes.forEach(ruleType => {
		if (!config.ruleTypes.find(t => t.slug === ruleType)) {
			throw Error(`ruleType ${ruleType} is not defined in config.js`)
		}
	})
	let ruleTypes = new Set(opt.ruleTypes);

	return new Promise(resolve => {
		console.log('process ' + opt.slugOut);

		//let windSummary = [];
		const filesOut = new Map();

		let pipeline, n;

		if (opt.filenameIn.endsWith('.geojsonl')) {
			pipeline = miss.pipeline(
				fs.createReadStream(opt.filenameIn),
				miss.split()
			)
		} else if (opt.filenameIn.endsWith('.geojsonl.gz')) {
			pipeline = miss.pipeline(
				fs.createReadStream(opt.filenameIn),
				createGunzip(),
				miss.split()
			)
		} else if (opt.filenameIn.endsWith('.fgb')) {
			n = child_process.spawnSync('ogrinfo', ['-so', '-al', opt.filenameIn]);
			n = n.stdout.toString().match(/Feature Count: (\d+)/)[1];
			n = parseInt(n, 10);
			pipeline = miss.pipeline(
				child_process.spawn('ogr2ogr', ['-f', 'GeoJSONSeq', '/vsistdout/', opt.filenameIn]).stdout,
				miss.split()
			)
		} else if (opt.filenameIn.endsWith('.gpkg')) {
			n = child_process.spawnSync('ogrinfo', ['-so', '-al', opt.filenameIn]);
			n = n.stdout.toString().match(/Feature Count: (\d+)/)[1];
			n = parseInt(n, 10);
			pipeline = ogrLoadGpkgAsGeojsonStream(opt.filenameIn)
		} else {
			throw Error('unknown file format');
		}

		let index = 0;
		let progress = new Progress(n);

		miss.each(pipeline, async (line, next) => {
			if (line.length === 0) return next();

			index++;
			if (n && (index % 100 === 0)) progress(index);

			let feature = JSON.parse(line);

			let types = opt.cbFeature(feature);
			if (!types) return next();

			feature.bbox = turf.bbox(feature);

			if (!Array.isArray(types)) types = [types];

			for (let type of types) {
				if (!ruleTypes.has(type)) {
					throw Error(`ruleType ${type} is not defined in processAlkis`)
				}

				feature.properties.type = type;

				if (!filesOut.has(type)) {
					let filename = config.getFilename.rulesGeoBasis(type + '.geojsonl.gz');
					let file = new NDJSONGzipWrite(filename);
					file.filenameGeoJSONSeq = filename;
					file.filenameOut = config.getFilename.rulesGeoBasis(type);
					file.name = type;
					filesOut.set(type, file);
				}
				await filesOut.get(type).write(feature);
			}
			return next();
		}, async () => {
			console.log();
			for (let file of filesOut.values()) {
				await file.close();

				//await convertGzippedGeoJSONSeq2Anything(file.filenameGeoJSONSeq, file.filenameOut + '.fgb');
				//if (opt.generateGPKG) {
				await convertGzippedGeoJSONSeq2Anything(file.filenameGeoJSONSeq, file.filenameOut + '.gpkg');
				//}
			}

			console.log('finished')

			resolve();
		})
	})

	function NDJSONGzipWrite(filename) {
		const streamFile = fs.createWriteStream(filename);
		const streamGzip = createGzip({ level: 3 });
		streamGzip.pipe(streamFile);

		return { write, close }

		function write(obj) {
			return new Promise(res => {
				let buffer = Buffer.from(JSON.stringify(obj) + '\n');
				if (streamGzip.write(buffer)) return res();
				streamGzip.once('drain', res);
			})
		}

		function close() {
			return new Promise(res => {
				streamFile.once('close', res);
				streamGzip.end();
			})
		}
	}
}

async function convertGzippedGeoJSONSeq2Anything(filenameIn, filenameOut, { layerType, dropProperties } = {}) {
	const filenameTmp = calcTemporaryFilename(filenameOut);

	if (fs.existsSync(filenameOut)) fs.rmSync(filenameOut);

	let args = []
	if (dropProperties) args.push('--config', 'ATTRIBUTES_SKIP', 'YES',);
	args.push(
		'--config', 'CPL_VSIL_GZIP_WRITE_PROPERTIES', 'NO',
		'-progress',
		'-nln', 'layer',
		'-lco', 'GEOMETRY_NAME=geometry',
	)
	if (layerType) args.push('-nlt', layerType);
	args.push(filenameTmp, ogrWrapFileDriver(filenameIn));

	//console.log(args)
	process.stdout.write(`generate ${basename(filenameOut)}: `)
	let cp = getSpawn('ogr2ogr', args);
	cp.stdout.pipe(process.stderr);

	await new Promise(res => cp.once('close', () => res()))

	fs.renameSync(filenameTmp, filenameOut);
}

function union(...features) {
	return coords2Feature(polygonClipping.union(features2Coords(features)));
}

function intersect(f1, f2) {
	return coords2Feature(polygonClipping.intersection(features2Coords([f1]), features2Coords([f2])));
}

function features2Coords(features) {
	let coords = [];
	for (let feature of features) {
		if (!feature) continue;
		try {
			feature = turf.rewind(feature, { mutate: true })
		} catch (e) {
			console.dir({ feature }, { depth: 10 });
			throw e;
		}
		switch (feature.geometry.type) {
			case 'Polygon': coords.push(feature.geometry.coordinates); continue
			case 'MultiPolygon': coords = coords.concat(feature.geometry.coordinates); continue
		}
		throw Error(feature.geometry.type);
	}
	return coords;
}

function coords2Feature(coords) {
	let outside = [];
	let inside = [];

	coords.forEach(polygon =>
		polygon.forEach(ring =>
			(turf.booleanClockwise(ring) ? inside : outside).push(ring)
		)
	)

	if (outside.length === 1) {
		return turf.polygon(outside.concat(inside));
	} else if (inside.length === 0) {
		return turf.multiPolygon(outside.map(p => [p]));
	} else {
		coords.forEach(polygon => polygon.forEach((ring, index) => {
			if (turf.booleanClockwise(ring) === (index === 0)) ring.reverse();
		}))
		return turf.multiPolygon(coords);
	}
}

function doBboxOverlap(bbox1, bbox2) {
	if (bbox1[0] > bbox2[2]) return false;
	if (bbox1[1] > bbox2[3]) return false;
	if (bbox1[2] < bbox2[0]) return false;
	if (bbox1[3] < bbox2[1]) return false;
	return true;
}

function isBboxInside(bboxIn, bboxOut) {
	if (bboxIn[0] < bboxOut[0]) return false;
	if (bboxIn[1] < bboxOut[1]) return false;
	if (bboxIn[2] > bboxOut[2]) return false;
	if (bboxIn[3] > bboxOut[3]) return false;
	return true;
}

function bbox2Tiles(bbox, z) {
	const scale = 2 ** z;
	return [
		Math.floor(mercator.x(bbox[0]) * scale),
		Math.floor(mercator.y(bbox[3]) * scale),
		Math.ceil(mercator.x(bbox[2]) * scale),
		Math.ceil(mercator.y(bbox[1]) * scale),
	]
}

function bbox4326To3857(bbox) {
	const scale = 20037508.342789243076588;
	return [
		 (mercator.x(bbox[0])*2 - 1) * scale,
		-(mercator.y(bbox[1])*2 - 1) * scale,
		 (mercator.x(bbox[2])*2 - 1) * scale,
		-(mercator.y(bbox[3])*2 - 1) * scale,
	]
}

function bboxGeo2WebPixel(bbox, scale) {
	return [
		Math.round(mercator.x(bbox[0]) * scale),
		Math.round(mercator.y(bbox[3]) * scale),
		Math.round(mercator.x(bbox[2]) * scale),
		Math.round(mercator.y(bbox[1]) * scale),
	]
}

function bboxWebPixel2Geo(bbox, scale) {
	return [
		demercator.x(bbox[0] / scale),
		demercator.y(bbox[3] / scale),
		demercator.x(bbox[2] / scale),
		demercator.y(bbox[1] / scale),
	]
}

function getTileBbox(x, y, z, b = 0.01) {
	const scale = 2 ** z;
	return [
		demercator.x((x - b) / scale),
		demercator.y((y + 1 + b) / scale),
		demercator.x((x + 1 + b) / scale),
		demercator.y((y - b) / scale),
	]
}

function ogrWrapFileDriver(filenameOriginal) {
	let filename = filenameOriginal;
	let gzip = false;
	if (filename.endsWith('.gz')) {
		gzip = true;
		filename = filename.slice(0, -3);
	}

	let driver;
	switch (extname(filename)) {
		case '.geojsonl': driver = 'GeoJSONSeq:'; break;
		case '.geojson': driver = 'GeoJSON:'; break;
		case '.gpkg':
		case '.fgb':
		case '.vrt':
			driver = '';
			break;
		default: throw Error(`Error with filename: "${filename}"`)
	}

	return driver + (gzip ? '/vsigzip/' : '') + filenameOriginal;
}

function ogrGuessLayername(filename) {
	return basename(filename).split('.').slice(0, -1).join('.');
}

function ogrGetLayername(filename) {
	if (!fs.existsSync(filename)) throw Error(filename);
	if (filename.includes('.geojsonl')) return ogrGuessLayername(filename);

	let result = child_process.spawnSync('ogrinfo', [ogrWrapFileDriver(filename)]);
	result = result.stdout.toString();

	let match = result.match(/\n1: (.*?)( \((.*)\))?\n/);
	
	if (!match) {
		let filesize = fs.statSync(filename).size;
		if ((filesize <= 73728) && filename.endsWith('.gpkg')) return false;

		console.log({ result, match });
		throw Error();
	}
	return match[1];
}

async function generateUnionVRT(filenamesIn, filenameOut) {
	let result = [];
	result.push(`<OGRVRTDataSource>`);
	result.push(`   <OGRVRTUnionLayer name="layer">`);
	for (let filenameIn of filenamesIn) {
		let layername = await ogrGetLayername(filenameIn);
		if (layername === false) continue; // ignore empty files
		result.push(`      <OGRVRTLayer name="${layername}">`)
		result.push(`         <SrcDataSource>${ogrWrapFileDriver(filenameIn)}</SrcDataSource>`)
		result.push(`      </OGRVRTLayer>`);
	}
	result.push(`   </OGRVRTUnionLayer>`);
	result.push(`</OGRVRTDataSource>`);
	fs.writeFileSync(filenameOut, result.join('\n'));
}

async function mergeFiles(filenamesIn, filenameOut) {
	let filenameVRT = filenameOut + '.vrt';
	let filenameTmp = prefixFilename('tmp-', filenameOut);

	await generateUnionVRT(filenamesIn, filenameVRT);

	let cpConvert = getSpawn('ogr2ogr', [
		'-nln', 'layer',
		'-nlt', 'MultiPolygon',
		filenameTmp,
		ogrWrapFileDriver(filenameVRT),
	])
	await new Promise(res => cpConvert.once('close', () => res()));

	fs.rmSync(filenameVRT);
	fs.renameSync(filenameTmp, filenameOut);
}

async function unionAndClipFeatures(filenameIn, filenameClip, filenameOut, bbox) {
	// read features
	// union them all
	// clip by filenameClip
	// to one big multipolygon
	// split it in to multiple polygons

	if (!filenameOut) filenameOut = filenameIn;

	let stream = ogrLoadGpkgAsGeojsonStream(
		filenameIn,
		{ union: true, dropProperties: true, bbox, clipping: filenameClip, explodeCollections:true, makeValid:true }
	);

	let cpJQ = getSpawn('jq', [
		'-cr',
		`.geometry | select(.type == "MultiPolygon") | .coordinates[] | {type:"Feature",geometry:{type:"Polygon",coordinates:.}} | @json`
	]);

	stream.pipe(cpJQ.stdin);
	stream = cpJQ.stdout;

	let filenameTmp = calcTemporaryFilename(filenameOut) + '.geojsonl.gz';
	stream = stream.pipe(createGzip()).pipe(fs.createWriteStream(filenameTmp));

	await new Promise(res => stream.once('close', res));

	if (filenameOut.endsWith('.geojsonl.gz')) {
		fs.renameSync(filenameTmp, filenameOut);
		return;
	}

	if (fs.statSync(filenameTmp).size > 20) {
		let cpOgrOut = getSpawn('ogr2ogr', [
			'-skipfailures',
			'--config', 'CPL_VSIL_GZIP_WRITE_PROPERTIES', 'NO',
			'--config', 'ATTRIBUTES_SKIP', 'YES',
			'-a_srs', 'EPSG:4326',
			'-nln', 'layer',
			'-lco', 'GEOMETRY_NAME=geometry',
			filenameOut,
			ogrWrapFileDriver(filenameTmp),
		])

		await new Promise(res => cpOgrOut.once('close', res));
	}

	fs.rmSync(filenameTmp);
}

async function unionAndClipFeaturesDC(filenameIn, filenameClip, filenameOut) {
	// Wenn man viele Features hat, dann teilt man das Problem in Blöcke, löst es für jeden Block
	// und führt die Ergebnisse zusammen
	const scale = 1;


	if (!filenameIn.endsWith('.gpkg')) throw Error();
	if (!filenameClip.endsWith('.geojson')) throw Error();
	let clipFeature = JSON.parse(fs.readFileSync(filenameClip));
	if (clipFeature.features.length !== 1) throw Error();
	clipFeature = clipFeature.features[0];

	let bboxAll = turf.bbox(clipFeature);
	let [x0, y0, x1, y1] = bboxAll.map(v => Math.floor(v * scale));
	let blocks = [];
	let trashCan = [];

	if (fs.statSync(filenameIn).size > 256 * 1024 * 1024) {
		// split only big files
		for (let x = x0; x <= x1; x++) {
			for (let y = y0; y <= y1; y++) {
				let bbox = [x, y, x + 1, y + 1].map(v => v / scale);
				let bboxClip = [x - 0.1, y - 0.1, x + 1.1, y + 1.1].map(v => v / scale);
				let intersection = turf.intersect(clipFeature, turf.bboxPolygon(bboxClip));
				if (!intersection) continue;

				let tempFilenameBlock = calcTemporaryFilename(filenameOut) + `-block-${x}-${y}.geojsonl.gz`;
				let tempFilenameClip = calcTemporaryFilename(filenameOut) + `-block-${x}-${y}-clip.geojson`;
				fs.writeFileSync(tempFilenameClip, JSON.stringify(intersection));

				trashCan.push(tempFilenameBlock, tempFilenameClip);

				blocks.push({
					bbox,
					name: (x / scale) + ' ' + (y / scale),
					tempFilenameBlock,
					tempFilenameClip,
				})
			}
		}
	} else {
		let tempFilenameBlock = calcTemporaryFilename(filenameOut) + `-all.geojsonl.gz`
		blocks.push({
			bbox: bboxAll,
			name: 'all',
			tempFilenameBlock,
			tempFilenameClip: filenameClip,
		})
		trashCan.push(tempFilenameBlock);
	}

	let tempFilenameOut = prefixFilename('tmpOk-', filenameOut) + '.geojsonl.gz';
	let tempFilenameLeft1 = prefixFilename('tmpLeft-', filenameOut) + '.1.geojsonl.gz';
	let tempFilenameLeft2 = prefixFilename('tmpLeft-', filenameOut) + '.2.geojsonl.gz';

	trashCan.push(tempFilenameOut, tempFilenameLeft1, tempFilenameLeft2);

	let entryCount = 0;
	let fileOut = GzipFileWriter(tempFilenameOut);
	let fileLeft = GzipFileWriter(tempFilenameLeft1);

	for (let i = 0; i < blocks.length; i++) {
		let { bbox, name, tempFilenameBlock, tempFilenameClip } = blocks[i];
		console.log(name, (100 * i / blocks.length).toFixed(1) + '%');

		if (!fs.existsSync(tempFilenameBlock)) {
			await unionAndClipFeatures(filenameIn, tempFilenameClip, tempFilenameBlock, bbox);
		}

		await new Promise(res => {
			miss.each(
				fs.createReadStream(tempFilenameBlock).pipe(createGunzip()).pipe(miss.split('\n')),
				async (line, next) => {
					let bbox = turf.bbox(JSON.parse(line));
					if (isBboxInside(bbox, bboxAll)) {
						entryCount++;
						await fileOut.write(line + '\n');
					} else {
						await fileLeft.write(line + '\n');
					}
					next();
				},
				() => res()
			)
		})
	}

	await fileLeft.close();

	if (fileLeft.getLineCount() > 0) {
		await unionAndClipFeatures(tempFilenameLeft1, filenameClip, tempFilenameLeft2);
	} else {
		fs.renameSync(tempFilenameLeft1, tempFilenameLeft2);
	}

	await new Promise(res => {
		miss.each(
			fs.createReadStream(tempFilenameLeft2).pipe(createGunzip()).pipe(miss.split('\n')),
			async (line, next) => {
				entryCount++;
				await fileOut.write(line + '\n');
				next();
			},
			() => res()
		)
	})

	await fileOut.close();

	if (entryCount > 0) {
		await convertGzippedGeoJSONSeq2Anything(tempFilenameOut, filenameOut, { layerType: 'Polygon' });
	}

	trashCan.forEach(filename => fs.rmSync(filename, { force: true }));
}

/**
 * @param {object} [options] options
 * @param {boolean} [options.dropProperties=false] drop properties and return only geometries
 * @param {array} [options.bbox=false] use a bbox as spatial filter
 * @param {boolean} [options.union=false] merge (Boolean UNION) all geometries to a single multipolygon
 * @param {string} [options.layername=false] set layer name
 * @return {string}
 */
function ogrGenerateSQL({dropProperties = true, bbox = false, union = false, layername = 'layer', makeValid = false} = {}) {
	if (union && !dropProperties) throw Error('can not union, and not drop properties');

	let geometry = makeValid ? 'ST_MakeValid(l.geometry)' : 'l.geometry';
	
	let sql = ['SELECT'];
	if (!dropProperties) {
		sql.push(`l.*`);
	} else if (union) {
		if (makeValid) {
			sql.push(`ST_MakeValid(ST_Union(ST_MakeValid(l.geometry))) AS geometry`);
		} else {
			sql.push(`ST_Union(l.geometry) AS geometry`);
		}
	} else {
		if (makeValid) {
			sql.push(`ST_MakeValid(l.geometry) AS geometry`);
		} else {
			sql.push(`l.geometry AS geometry`);
		}
	}
	sql.push(`FROM "${layername}" l`);
	if (bbox) {
		sql.push(
			`JOIN "rtree_${layername}_geometry" r ON l.fid = r.id`,
			'WHERE r.maxx > ' + bbox[0],
			'AND r.maxy > ' + bbox[1],
			'AND r.minx < ' + bbox[2],
			'AND r.miny < ' + bbox[3],
		)
	}

	return sql.join(' ');
}


/**
 * 
 * @param {string} filenameIn full name of input file
 * @param {object} [options] options
 * @param {boolean} [options.dropProperties=false] drop properties and return only geometries
 * @param {array} [options.bbox=false] use a bbox as spatial filter
 * @param {boolean} [options.union=false] merge (Boolean UNION) all geometries to a single multipolygon
 * @param {string} [options.layername=false] set layer name
 * @param {string} [options.clipping=false] clip results by this geometry
 * @return {stream.Readable}
 */
function ogrLoadGpkgAsGeojsonStream(filenameIn, options = {}) {
	let filenameClip = false;
	if (options.clipping) {
		if (typeof options.clipping === 'string') {
			filenameClip = options.clipping;
		} else throw Error('unknown clipping value')
	}

	let sql = ogrGenerateSQL(options);
	//console.log({ sql });

	let args = [
		'-skipfailures',
		'--config', 'CPL_VSIL_GZIP_WRITE_PROPERTIES', 'NO',
		'--config', 'ATTRIBUTES_SKIP', 'YES',
		'-a_srs', 'EPSG:4326',
		'-dialect', 'SQLite',
		'-sql', sql,
	]
	if (options.explodeCollections) args.push('-explodecollections');
	if (filenameClip) args.push('-clipdst', filenameClip);
	args.push(
		'-f', 'GeoJSONSeq',
		'-nlt', 'MultiPolygon',
		'/vsistdout/',
		ogrWrapFileDriver(filenameIn),
	)

	let cpOgrIn = getSpawn('ogr2ogr', args);

	return cpOgrIn.stdout.pipe(miss.split());
}
