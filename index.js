var express = require('express');
var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');

//var serveIndex = require('serve-index');

var app = express();

//顺序不能换
//app.use(serveIndex('./public'));
//app.use(express.static('./public'));

app.use(express.static(path.join(__dirname, 'public')));

var options = {
    key  : fs.readFileSync('./cert/mycert.key'),
    cert : fs.readFileSync('./cert/mycert.pem')
};

var https_server = https.createServer(options, app);
https_server.listen(8443, '0.0.0.0');

var http_server = http.createServer(app);
http_server.listen(8080, '0.0.0.0');

