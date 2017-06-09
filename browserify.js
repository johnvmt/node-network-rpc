// Runs from npm install
var path = require('path');
var fs = require('fs');
var browserify = require('browserify');

var pkgConfig = require(path.join(__dirname, 'package.json'));

var packageName = pkgConfig.name.replace(/[^a-z0-9]+/gi, '').toLowerCase(); // remove non-alphanumeric characters, convert to lowercase
var inFile = pkgConfig.main;
var outFile = packageName + '.min.js';
var standalone = packageName;
var mapFile = standalone + '.js.map';

var b = browserify({standalone: standalone, debug: true});
b.add(inFile);

b.plugin('minifyify', {map: mapFile});

//b.ignore('fauxmongo');
b.bundle(function (err, src, map) {
	fs.writeFileSync(mapFile, map);
	console.log("Out file: ", getFilesizeInBytes(outFile), "bytes");
}).pipe(fs.createWriteStream(outFile));

function getFilesizeInBytes(filename) {
	var stats = fs.statSync(filename);
	return  stats['size'];
}