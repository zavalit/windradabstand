#!/usr/bin/env node
'use strict'

// Based on the idea of: https://github.com/bundesAPI/deutschland/blob/main/src/deutschland/geo.py

const { fetchCached, Progress } = require('../lib/helper.js');
const config = require('../config.js');
const gunzip = require('util').promisify(require('zlib').gunzip);
const { } = require('big-data-tools');
const { setMaxIdleHTTPParsers } = require('http');


const MAXLEVEL = 15
const URL = 'https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/tiles/v1/bm_web_de_3857/'
const BBOX = [5.8, 47.2, 15.1, 55.1]
let headers = {
	'Referer': 'https://adv-smart.de/map-editor/map',
	'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_' + Math.floor(Math.random() * 16)  + '_7) AppleWebKit/'+ Math.floor(Math.random() * 536) + '.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
}

const todos = [];
for (let z = 0; z <= MAXLEVEL; z++) {
	const tileMin = deg2tile(BBOX[0], BBOX[3], z).map(Math.floor);
	const tileMax = deg2tile(BBOX[2], BBOX[1], z).map(Math.floor);
	for (let x = tileMin[0]; x <= tileMax[0]; x++) {
		for (let y = tileMin[1]; y <= tileMax[1]; y++) {
			todos.push({ x, y, z });
		}
	}
}
const showProgress = Progress(todos.length);

const putToFilesystem = async ({ x, y, z }, i) => {
	if (i % 100 === 0) showProgress(i);

	const url = `${URL}${z}/${x}/${y}.pbf`
	const filename = config.getFilename.alkisCache(`${z}/${x}/${y}.pbf`)
	
	const headers = {
		'Referer': 'https://adv-smart.de/map-editor/map',
		'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_' + Math.floor(Math.random() * 16)  + '_7) AppleWebKit/'+ Math.floor(Math.random() * 536) + '.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
	}

	await fetchCached(filename, url, headers);
}

console.log('todos.length', todos.length)
const chunkSize = 300
const todoChunks = []
for (let i = 0; i < todos.length; i += chunkSize) {
     const chunk = todos.slice(i, i + chunkSize);
     todoChunks.push(chunk)
 }

const delay = (ms, cb) => setTimeout(cb, ms)

// todos.forEach(async ({ x, y, z }, i) => {
// 	if (i % 100 === 0) showProgress(i);

// 	if(i % 1000 === 0) {
// 		console.log('delay')
// 		delay(1000, storeNextChunk(i))
// 	}
// })


const sleep = (ms) => {
	return new Promise((resolve) => setTimeout(resolve, ms));
 };
 
 let now = Date.now()
 
 const action = async () => {
	  for (let i = 1; i < todos.length; i++){
			if (i % 100 === 0) showProgress(i);
			if(i % 1000 === 0 && Date.now() - now > 100 * 1000) {
				console.log('start sleep after',  Date.now() - now)
				now = Date.now()				
				await sleep(10 * 1000)
				
				headers = {
					'Referer': 'https://adv-smart.de/map-editor/map',
					'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_' + Math.floor(Math.random() * 16)  + '_7) AppleWebKit/'+ Math.floor(Math.random() * 536) + '.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
					}
			} 

			const {x,y,z} = todos[i]
			const url = `${URL}${z}/${x}/${y}.pbf`
			const filename = config.getFilename.alkisCache(`${z}/${x}/${y}.pbf`)
				
			await fetchCached(filename, url, headers);
			
	  }
}
action()




function deg2tile(lon_deg, lat_deg, zoom) {
	let n = 2 ** zoom
	return [
		(lon_deg + 180) / 360 * n,
		(1 - Math.asinh(Math.tan(lat_deg * Math.PI / 180)) / Math.PI) / 2 * n
	]
}
