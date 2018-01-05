// server.js
// load the things we need
var express = require('express');
var bodyParser = require('body-parser'); // for reading POSTed form data into `req.body`
var cookieParser = require('cookie-parser'); // the session is stored in a cookie, so we use this to parse it
var session = require('express-session');
var app = express();

// must use cookieParser before expressSession
app.use(cookieParser());
app.use(session({ secret: 'open sesame', resave: true, saveUninitialized: true }))

app.use(bodyParser.urlencoded({'extended': 'true'})); // parse application/x-www-form-urlencoded

// set the view engine to ejs
app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/public'));
// use res.render to load up an ejs view file

// login page
// change this page name for whatever page you're working on
app.get('/', function(req, res) {
    res.render('pages/agent_home');
});


app.listen(8005);
console.log('Server is running on port 8005');
