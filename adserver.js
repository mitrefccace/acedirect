var express = require('express');
var asteriskManager = require('asterisk-manager');
var nconf = require('nconf');
var util = require('util');
var log4js = require('log4js');
var fs = require('fs');
var request = require('request');
var jwt = require('jsonwebtoken');
var bodyParser = require('body-parser');
var socketioJwt = require('socketio-jwt');
var zendeskApi = require('node-zendesk');
var https = require('https');
var cio = require('socket.io-client');
var redis = require("redis");
var cookieParser = require('cookie-parser'); // the session is stored in a cookie, so we use this to parse it
var session = require('express-session');
var openamAgent = require('@forgerock/openam-agent');
var url = require('url');
var randomstring = require("randomstring");
var csrf = require('csurf');
var cors = require('cors');
var mysql = require('mysql');
var MongoClient = require('mongodb').MongoClient;
var dbConnection = null;
var dbconn = null;

// Clam AV
const NodeClam = require('clamscan');
const ClamScan = new NodeClam().init({
    remove_infected: true, // If true, removes infected files
    quarantine_infected: false, // False: Don't quarantine, Path: Moves files to this place.
    scan_log: null, // Path to a writeable log file to write scan results into
    debug_mode: true ,// Whether or not to log info/debug/error msgs to the console
    file_list: null, // path to file containing list of files to scan (for scan_files method)
    scan_recursively: true, // If true, deep scan folders recursively
    clamscan: {
        path: '/usr/bin/clamscan', // Path to clamscan binary on your server
        db: null, // Path to a custom virus definition database
        scan_archives: true, // If true, scan archives (ex. zip, rar, tar, dmg, iso, etc...)
        active: true // If true, this module will consider using the clamscan binary
    },
    clamdscan: {
        socket: false, // Socket file for connecting via TCP
        host: false, // IP of host to connect to TCP interface
        port: false, // Port of host to use when connecting via TCP interface
        timeout: 60000, // Timeout for scanning files
        local_fallback: true, // Do no fail over to binary-method of scanning
        path: '/usr/bin/clamdscan', // Path to the clamdscan binary on your server
        config_file: null, // Specify config file if it's in an unusual place
        multiscan: true, // Scan using all available cores! Yay!
        reload_db: false, // If true, will re-load the DB on every call (slow)
        active: true,// If true, this module will consider using the clamdscan binary
        bypass_test: false, // Check to see if socket is available when applicable
    },
    preference: 'clamdscan' // If clamdscan is found and active, it will be used by default
});

//For fileshare
//var upload = multer();


//CLEAN UP function; must be at the top!
//for exits, abnormal ends, signals, uncaught exceptions
var cleanup = require('./cleanup').Cleanup(myCleanup);
function myCleanup() {
  //clean up code on exit, exception, SIGINT, etc.
  console.log('');
  console.log('***Exiting***');

  //MySQL DB cleanup
  if (dbConnection) {
    console.log('Cleaning up MySQL DB connection...');
    dbConnection.destroy();
  }

  //MongoDB cleanup
  if (dbconn) {
    console.log('Cleaning up MongoDB connection...');
    dbconn.close();
  }

  console.log('byeee.');
  console.log('');
}


//after hours vars
var isOpen = true;
var startTimeUTC = "14:00"; //hh:mm in UTC
var endTimeUTC = "21:30"; //hh:mm in UTC

// Declaration for Asterisk Manager Interface see init_ami()
var ami = null;

// Contains login name => JSON data passed from browser
var rStatusMap = 'statusMap';

// Contains the VRS number mapped to the Zendesk ticket number
var rVrsToZenId = 'vrsToZenId';

// Contains the consumer extension mapped to {"secret":extensionpassword, "inuse":true|false}
var rConsumerExtensions = 'consumerExtensions';

// Contains the consumer extension(nnnnn) mapped to the VRS number (nnnnnnnnnn)
// Redis will double map these key values meaning both will exist
// key:value nnnnn:mmmmmmmmmm and mmmmmmmmmm:nnnnn
var rExtensionToVrs = 'extensionToVrs';

// Contains the consumer extension(nnnnn) mapped to the preferred language
var rExtensionToLanguage = 'extensionToLanguage';

// Maps Linphone caller extension to agent extension
var rLinphoneToAgentMap = 'linphoneToAgentMap';

// Maps consumer extension to CSR extension
var rConsumerToCsr = 'consumerToCsr';

// Map of Agent information, key agent_id value JSON object
var rAgentInfoMap = 'agentInfoMap';

// Map of Token to status, key token value {status, date}.
var rTokenMap = 'tokenMap';

//keeps track of number of consumers in complaint queue, send to agent on login
var complaint_queue_count = 0;

//keeps track of number of consumers in general queue, send to agent on login
var general_queue_count = 0;

//file share
let sharingAgent= [];
let sharingConsumer = [];
let fileToken = [];
var incomingVRS;

// Initialize log4js
var logname = 'ad-server';
log4js.configure({
	appenders: {
	  ad_server: {
		type: 'dateFile',
		filename: 'logs/' + logname + '.log',
		pattern: '-yyyy-MM-dd',
		alwaysIncludePattern: false,
		maxLogSize: 20480,
		backups: 10
	  }
	},
	categories: {
	  default: {
		appenders: ['ad_server'],
		level: 'error'
	  }
	}
  });

// Get the name of the config file from the command line (optional)
nconf.argv().env();

var cfile = '../dat/config.json';

// Validate the incoming JSON config file
try {
	var content = fs.readFileSync(cfile, 'utf8');
	var myjson = JSON.parse(content);
	console.log("Valid JSON config file");
} catch (ex) {
    console.log("");
	console.log("*******************************************************");
	console.log("Error! Malformed configuration file: " + cfile);
	console.log('Exiting...');
	console.log("*******************************************************");
    console.log("");
	process.exit(1);
}

var logger = log4js.getLogger('ad_server');

nconf.file({
	file: cfile
});

//the presence of a populated the 'cleartext' field in config.json means that the file is in clear text
//REMOVE the field or set it to "" if config.json is encoded
var clearText = false;
if (typeof (nconf.get('common:cleartext')) !== "undefined"  && nconf.get('common:cleartext') !== ""   ) {
	console.log('common:cleartext field is in config.json. assuming file is in clear text');
	clearText = true;
}

var colorConfigs = {};

//append a suffix to make REDIS maps specific to this server
var pfx = process.env.LOGNAME;
if (pfx == undefined)
  pfx = '';
else
  pfx = pfx + '_';
rStatusMap = pfx + rStatusMap;
rVrsToZenId = pfx + rVrsToZenId;
rConsumerExtensions = pfx + rConsumerExtensions;
rExtensionToVrs = pfx + rExtensionToVrs;
rExtensionToLanguage = pfx + rExtensionToLanguage;
rLinphoneToAgentMap = pfx + rLinphoneToAgentMap;
rConsumerToCsr = pfx + rConsumerToCsr;
rAgentInfoMap = pfx + rAgentInfoMap;
rTokenMap = pfx + rTokenMap;

// Set log4js level from the config file
logger.level = getConfigVal('common:debug_level'); //log level hierarchy: ALL TRACE DEBUG INFO WARN ERROR FATAL OFF
logger.trace('TRACE messages enabled.');
logger.debug('DEBUG messages enabled.');
logger.info('INFO messages enabled.');
logger.warn('WARN messages enabled.');
logger.error('ERROR messages enabled.');
logger.fatal('FATAL messages enabled.');
logger.info('Using config file: ' + cfile);

var queuesComplaintNumber = getConfigVal('asterisk:queues:complaint:number');

//global vars that don't need to be read every time
var jwtKey = getConfigVal('web_security:json_web_token:secret_key');
var jwtEnc = getConfigVal('web_security:json_web_token:encoding');

//NGINX path parameter
var nginxPath = getConfigVal('nginx:ad_path');
if (nginxPath.length === 0) {
  //default for backwards compatibility
  nginxPath = "/ACEDirect";
}

//outbound videomail timeout parameter
var outVidTimeout = getConfigVal('videomail:outbound_timeout_secs');
if (!outVidTimeout) {
  //default if not there
  outVidTimeout = 45 * 1000; //ms
} else {
  outVidTimeout = outVidTimeout * 1000; //ms
}
logger.debug('outVidTimeout: ' + outVidTimeout);

//stun & turn params
var stunFQDN = getConfigVal('asterisk:sip:stun');
var stunPort = getConfigVal('asterisk:sip:stun_port');
var turnFQDN = getConfigVal('asterisk:sip:turn');
var turnPort = getConfigVal('asterisk:sip:turn_port');
var turnUser = getConfigVal('asterisk:sip:turn_user');
var turnCred = getConfigVal('asterisk:sip:turn_cred');
if (!stunFQDN) {
  console.log('ERROR: dat/config.json is missing asterisk:sip:stun');
  process.exit(0);
}
if (!stunPort) {
  console.log('ERROR: dat/config.json is missing asterisk:sip:stun_port');
  process.exit(0);
}
if (!turnFQDN) {
  console.log('ERROR: dat/config.json is missing asterisk:sip:turn');
  process.exit(0);
}
if (!turnPort) {
  turnPort = ""; //blank is valid for this one
}
if (!turnUser) {
  console.log('ERROR: dat/config.json is missing asterisk:sip:turn_user');
  process.exit(0);
}
if (!turnCred) {
  console.log('ERROR: dat/config.json is missing turn_cred');
  process.exit(0);
}

//busylight parameter
var busyLightEnabled = getConfigVal('busylight:enabled');
if (busyLightEnabled.length === 0) {
  //default for backwards compatibility
  busyLightEnabled = true;
} else {
  busyLightEnabled = (busyLightEnabled === 'true');
}
logger.debug('busyLightEnabled: ' + busyLightEnabled);

//busylight awayBlink parameter (blink while Away, if callers are in queue)
var awayBlink= getConfigVal('busylight:awayBlink');
if (awayBlink.length === 0) {
  //default to on
  awayBlink = true;
} else {
  awayBlink = (awayBlink === 'true');
}
logger.debug('awayBlink: ' + awayBlink);

var agentPath = getConfigVal('nginx:agent_route');
if (agentPath.length === 0) {
  agentPath = "/agent";
}

var consumerPath = getConfigVal('nginx:consumer_route');
console.log(consumerPath.length);
if (consumerPath.length === 0) {
  consumerPath = "/complaint";
}

//signaling server
var signalingServerPublic = getConfigVal('signaling_server:public');
var signalingServerPort = getConfigVal('signaling_server:port');
var signalingServerProto = getConfigVal('signaling_server:proto');
var signalingServerDevUrl = getConfigVal('signaling_server:dev_url');

var queuesVideomailNumber = getConfigVal('asterisk:queues:videomail:number');

//get complaint redirect options
var complaintRedirectActive = (getConfigVal('complaint_redirect:active') === 'true');
var complaintRedirectDesc = getConfigVal('complaint_redirect:desc');
var complaintRedirectUrl = getConfigVal('complaint_redirect:url');

// translation server
var translationServerUrl = getConfigVal('translation_server:protocol') + '://' + getConfigVal('translation_server:private_ip') + ':' + getConfigVal('translation_server:port');

//get the ACE Direct version and year
var version = getConfigVal('common:version');
var year = getConfigVal('common:year');
logger.info("This is ACE Direct v" + version + ", Copyright " + year + ".");

// Create a connection to Redis
var redisClient = redis.createClient(getConfigVal('database_servers:redis:port'), getConfigVal('database_servers:redis:host'));

redisClient.on("error", function (err) {
    logger.error("");
    logger.error("**********************************************************");
    logger.error("REDIS CONNECTION ERROR: Please make sure Redis is running.");
    logger.error("**********************************************************");
    logger.error("");
	logger.error(err);
    console.error("");
    console.error("**********************************************************");
    console.error("REDIS CONNECTION ERROR: Please make sure Redis is running.");
    console.error("**********************************************************");
    console.error("");
    console.error(err);
    log4js.shutdown(function() { process.exit(-99); });
});

//catch Redis warnings
redisClient.on("warning", function(wrn) {
  logger.warn('REDIS warning: ' + wrn);
});

redisClient.auth(getConfigVal('database_servers:redis:auth'));

redisClient.on('connect', function () {
	logger.info("Connected to Redis");

	//Delete all values in REDIS maps at startup
	redisClient.del(rTokenMap);
	redisClient.del(rStatusMap);
	redisClient.del(rVrsToZenId);
	redisClient.del(rConsumerExtensions);
	redisClient.del(rExtensionToVrs);
	redisClient.del(rExtensionToLanguage);
	redisClient.del(rLinphoneToAgentMap);
	redisClient.del(rConsumerToCsr);
	redisClient.del(rAgentInfoMap);

	// Populate the consumerExtensions map
	prepareExtensions();
});

// Load the Zendesk login parameters
var zenUrl = getConfigVal('zendesk:protocol') + '://' + getConfigVal('zendesk:private_ip') + ':' + getConfigVal('zendesk:port') + '/api/v2';
var zenUserId = getConfigVal('zendesk:user_id');
var zenToken = getConfigVal('zendesk:token');

logger.info('Zendesk config:');
logger.info('URL: ' + zenUrl);
logger.info('UserID: ' + zenUserId);
logger.info('Token: ' + zenToken);

// Instantiate a connection to Zendesk
var zendeskClient = zendeskApi.createClient({
	username: zenUserId,
	token: zenToken,
	remoteUri: zenUrl
});

var dbHost = getConfigVal('database_servers:mysql:host');
var dbUser = getConfigVal('database_servers:mysql:user');
var dbPassword = getConfigVal('database_servers:mysql:password');
var dbName = getConfigVal('database_servers:mysql:ad_database_name');
var dbPort = parseInt(getConfigVal('database_servers:mysql:port'));
var vmTable = "videomail";

// Create MySQL connection and connect to the database
dbConnection = mysql.createConnection({
	host: dbHost,
	user: dbUser,
	password: dbPassword,
	database: dbName,
	port: dbPort
});

//better error checking for MySQL connection
dbConnection.connect(function(err) {
  if (err !== null) {
    //MySQL connection ERROR
    console.error('');
    console.error('*************************************');
    console.error('ERROR connecting to MySQL. Exiting...');
    console.error('*************************************');
    console.error('');
    console.error(err);
    logger.error('');
    logger.error('*************************************');
    logger.error('ERROR connecting to MySQL. Exiting...');
    logger.error('*************************************');
    logger.error('');
    logger.error(err);
    log4js.shutdown(function() { process.exit(-1); });
  } else {
    //SUCCESSFUL connection
  }
});

// Pull MongoDB configuration from config.json file
var mongodbUriEncoded = nconf.get('database_servers:mongodb:connection_uri');
var logCallData = nconf.get('database_servers:mongodb:logCallData');
var mongodb;
var colCallData = null;

//Connect to MongoDB
if (typeof mongodbUriEncoded !== 'undefined' && mongodbUriEncoded) {
	var mongodbUri = getConfigVal('database_servers:mongodb:connection_uri');
	// Initialize connection once
	MongoClient.connect(mongodbUri, {forceServerObjectId:true, useNewUrlParser: true, useUnifiedTopology: true}, function (err, database) {
		if (err) {
			logger.error('*** ERROR: Could not connect to MongoDB. Please make sure it is running.');
			console.error('*** ERROR: Could not connect to MongoDB. Please make sure it is running.');
			process.exit(-99);
		}

		console.log('MongoDB Connection Successful');
		mongodb = database.db();
                dbconn = database;

		// Start the application after the database connection is ready
		//httpsServer.listen(port);
		//console.log('https web server listening on ' + port);

		// prepare an entry into MongoDB to log the acedirect restart
		var data = {
				"Timestamp": new Date(),
				"Role":"acedirect",
				"Purpose": "Restarted"
		};

		if (logCallData) {
			// first check if collection "events" already exist, if not create one
			mongodb.listCollections({name: 'calldata'}).toArray((err, collections) => {
				console.log("try to find calldata collection, colCallData length: " + collections.length);
				if (collections.length == 0) {	// "stats" collection does not exist
					console.log("Creating new calldata colleciton in MongoDB");
					mongodb.createCollection("calldata",{capped: true, size:1000000, max:5000}, function(err, result) {
						if (err) throw err;
        					console.log("Collection calldata is created capped size 100000, max 5000 entries");
						colCallData = mongodb.collection('calldata');
					});
				}
				else {
					// events collection exist already
					console.log("Collection calldata exists");
					colCallData = mongodb.collection('calldata');
					// insert an entry to record the start of ace direct
					colCallData.insertOne(data, function(err, result) {
						if(err){
							console.log("Insert a record into calldata collection of MongoDB, error: " + err);
							logger.debug("Insert a record into calldata collection of MongoDB, error: " + err);
							throw err;
						}
					});
				}

			});
		}
	});
} else {
	console.log('Missing MongoDB Connection URI in config');
	logger.error('Missing MongoDB Connection URI in config');
	//httpsServer.listen(port);
	//console.log('https web server listening on ' + port);
}

var credentials = {
	key: fs.readFileSync(getConfigVal('common:https:private_key')),
	cert: fs.readFileSync(getConfigVal('common:https:certificate'))
};

var agent = new openamAgent.PolicyAgent({
	serverUrl: 'https://' + getConfigVal('nginx:fqdn') + ":" + getConfigVal('nginx:port') + '/' + getConfigVal('openam:path'),
	privateIP: getConfigVal('nginx:private_ip'),
	errorPage: function () {
		return '<html><body><h1>Access Error</h1></body></html>';
	}
});
var cookieShield = new openamAgent.CookieShield({
	getProfiles: false,
	cdsso: false,
	noRedirect: false,
	passThrough: false
});

var app = express();

app.use(cookieParser()); // must use cookieParser before expressSession
app.use(session({
	secret: getConfigVal('web_security:session:secret_key'),
	resave: getConfigVal('web_security:session:resave'),
	rolling: getConfigVal('web_security:session:rolling'),
	saveUninitialized: getConfigVal('web_security:session:save_uninitialized'),
	cookie: {
		maxAge: parseFloat(getConfigVal('web_security:session:max_age')),
		httpOnly: getConfigVal('web_security:session:http_only'),
		secure: getConfigVal('web_security:session:secure')
	}
}));

app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({
	'extended': 'true'
})); // parse application/x-www-form-urlencoded
app.use(bodyParser.json()); // parse application/json
app.use(bodyParser.json({
	type: 'application/vnd.api+json'
})); // parse application/vnd.api+json as json
app.use(csrf({
	cookie: true
}));

var fqdn = '';
if (nconf.get('nginx:fqdn')) {
	fqdn = getConfigVal('nginx:fqdn');
} else {
    logger.error('******************************************************');
    logger.error('ERROR nginx:fqdn parameter required in dat/config.json');
    logger.error('******************************************************');
    logger.error('Exiting...');
    log4js.shutdown(function() { process.exit(-1); });
}
// Remove the newline
var fqdnTrimmed = fqdn.trim();
var fqdnUrl = 'https://' + fqdnTrimmed + ':*';

logger.info('FQDN URL: ' + fqdnUrl);

//Note: privacy video file must be configured and served by media server
var privacy_video_url = '';
if (nconf.get('media_server:privacy_video_url')) {
  privacy_video_url = getConfigVal('media_server:privacy_video_url');
} else {
  privacy_video_url = 'file:///tmp/media/videoPrivacy.webm'; //default to this if not in config.json
}
// Remove the newline
var privacy_video_url = privacy_video_url.trim();

var httpsServer = https.createServer(credentials, app);

//constant to identify provider devices in AMI messages
var PROVIDER_STR = "Provider";

var io = require('socket.io')(httpsServer, {
	cookie: false,
	origins: fqdnUrl
}); //path: '/TEST',
// io.set removed in socket.io 3.0. Origins now set in options during socket.io module inclusion.
//io.set('origins', fqdnUrl);

app.use(cors({
	'origin': fqdnUrl
}));

httpsServer.listen(parseInt(getConfigVal('ace_direct:https_listen_port')));
logger.info("https web server listeningprocess on " + parseInt(getConfigVal('ace_direct:https_listen_port')));
console.log("https web server listeningprocess on " + parseInt(getConfigVal('ace_direct:https_listen_port')));
logger.info('Config file: ' + cfile);

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Validates the token, if valid go to connection.
// If token is not valid, no connection will be established.
io.use(socketioJwt.authorize({
	secret: ((jwtEnc == 'base64') ? Buffer.alloc(jwtKey.length, jwtKey , jwtEnc ): jwtKey),
	timeout: parseInt(getConfigVal('web_security:json_web_token:timeout')), // seconds to send the authentication message
	handshake: getConfigVal('web_security:json_web_token:handshake')
}));

// Note - socket only valid in this block
io.sockets.on('connection', function (socket) {

	// We will see this on connect or browser refresh
	logger.info('NEW CONNECTION');
	logger.info(socket.request.connection._peername);

    //emit AD version and year to clients
	socket.emit('adversion', {"version":version,"year":year});

	// emit
	if (getConfigVal('translation_server:enabled') === 'true') {
		socket.emit('enable-translation');
	}

	var token = socket.decoded_token;
	logger.info('connected & authenticated: ' + token.username + " - " + token.first_name + " " + token.last_name);
	logger.info("ExpiresIn: " + (token.exp - token.iat) + " seconds");

	// Handle incoming Socket.IO registration requests from a client - add to the room
	socket.on('register-client', function (data) {
		logger.info("Adding client socket to room:");
		logger.info(socket.id);
		logger.info(socket.request.connection._peername);

		// Add this socket to the room
		socket.join('my room');
	});

	socket.on('begin-file-share', function(data) {

		if (sharingAgent.length == 0) {
			//first element
			sharingAgent[0] = token.extension;
			sharingConsumer[0] = incomingVRS;
			fileToken[0] = '';
		} else {
			for (let i = 0; i <= sharingAgent.length; i++) {
				if (i == sharingAgent.length) {
					//end of the list
					sharingAgent[i] = token.extension;
					sharingConsumer[i] = incomingVRS;
					fileToken[i] = '';
					break;
				} else if (sharingAgent[i] == '') {
					//fil any gaps
					sharingAgent[i] = token.extension;
					sharingConsumer[i] = incomingVRS;
					fileToken[i] = '';
					break;
				}
			}
		}

		//these should always be in sync
		//but is that guarunteed?
		console.log(sharingAgent);
		console.log(sharingConsumer);
		console.log(fileToken);

		for (let i = 0; i < sharingAgent.length; i++){
			console.log(sharingAgent[i] + ' and ' + sharingConsumer[i] + " can share files");
		}
	});

	socket.on('call-ended', function(data) {
		console.log('call ended');

		for (let i = 0; i < sharingAgent.length; i++) {
			if (token.extension == sharingAgent[i] || token.vrs == sharingConsumer[i]) {
				//empty
				sharingAgent[i] = '';
				sharingConsumer[i] = '';
				fileToken[i]='';
			}
		}
		//check if the whole array is ''
		let isEmpty=true;
		for (let i = 0; i < sharingAgent.length; i++) {
			if (sharingAgent[i] !== '' ){
				isEmpty=false;
				break;
			}
		}
		if (isEmpty){
			sharingAgent = [];
			sharingConsumer = [];
			fileToken = [];
		}
		//console.log(sharingAgent);
		//console.log(sharingConsumer);
		//console.log(fileToken);
	});

	//Handle multiple files
	socket.on('get-file-list-agent', function(data){
		console.log('AGENT HAS UPLOADED FILE');
		let vrsNum =  (token.vrs) ? token.vrs : data.vrs;
		let  url = 'https://' + getConfigVal('common:private_ip') + ':' + getConfigVal('user_service:port');
		url += '/fileListByVRS?vrs=' + vrsNum;
			request({
				url: url,
				json: true
			}, function (error, response, results) {
				if (error) {
					console.log("Error");
				} else {
					if(results.message == "Success"){
						let latestResult = results.result[results.result.length-1];

						console.log('last 5 results: ');
						console.log( results.result.slice(Math.max(results.result.length - 5, 0)) );

						redisClient.hget(rConsumerToCsr, Number(data.vrs), function (err, agentExtension) {
							var vrs = null;
							console.log("Token is " + JSON.stringify(token) + "\n and data is " + JSON.stringify(data));

							// populate fileToken in the same spot as the uploader
							let uploader;
							if (token.vrs == undefined) {
								uploader = token.extension;
							} else {
								uploader = token.vrs;
							}

							for (let i = 0; i < sharingAgent.length; i++) {
								//console.log('comparing ' + sharingAgent[i] + ' to ' +uploader);
								//console.log('and ' +sharingConsumer[i]+ ' to ' +uploader);
								if (sharingAgent[i] == uploader) {
									fileToken[i] = latestResult.id;
									console.log(sharingAgent[i] + ' shared file');
									console.log('with id: ');
									console.log(fileToken[i]);
									break;
								}
							}
							console.log('agents: ' +sharingAgent);
							console.log('consumers: ' +sharingConsumer);
							console.log('file ID: ' +fileToken);

							//if (token.vrs) {
								//vrs = token.vrs;
							if(token.phone){
								vrs = token.phone.replace(/-/g,"");
							} else {
								vrs = data.vrs;
							}
							console.log("Sending file list message to " + vrsNum + " with " + JSON.stringify(latestResult));

							io.to(Number(vrsNum)).emit('fileListConsumer', (latestResult) );
						});
					}else{
						console.log("Unkonwn error in get-file-list-agent");
						console.log(results);
					}
				}
			});
	});

	socket.on('get-file-list-consumer', function(data){
		console.log('CONSUMER HAS UPLOADED FILE');
		let vrsNum =  (token.vrs) ? token.vrs : data.vrs;
		let  url = 'https://' + getConfigVal('common:private_ip') + ':' + getConfigVal('user_service:port');
		url += '/fileListByVRS?vrs=' + vrsNum;
			request({
				url: url,
				json: true
			}, function (error, response, results) {
				if (error) {
					console.log("Error");
				} else {
					if(results.message == "Success"){
						let latestResult = results.result[results.result.length-1];

						console.log('last 5 results: ');
						console.log( results.result.slice(Math.max(results.result.length - 5, 0)) );

						redisClient.hget(rConsumerToCsr, Number(data.vrs), function (err, agentExtension) {
							var vrs = null;
							console.log("Token is " + JSON.stringify(token) + "\n and data is " + JSON.stringify(data));

							// populate fileToken in the same spot as the uploader
							let uploader;
							if (token.vrs == undefined) {
								uploader = token.extension;
							} else {
								uploader = token.vrs;
							}

							for (let i = 0; i < sharingAgent.length; i++) {
								//console.log('comparing ' + sharingAgent[i] + ' to ' +uploader);
								//console.log('and ' +sharingConsumer[i]+ ' to ' +uploader);
								if (sharingConsumer[i] == uploader) {
									fileToken[i] = latestResult.id;
									console.log(sharingConsumer[i]+ ' shared file');
									console.log('with id: ');
									console.log(fileToken[i]);
									break;
								}
							}
							console.log('agents: ' +sharingAgent);
							console.log('consumers: ' +sharingConsumer);
							console.log('file ID: ' +fileToken);

							//if (token.vrs) {
								//vrs = token.vrs;
							if(token.phone){
								vrs = token.phone.replace(/-/g,"");
							} else {
								vrs = data.vrs;
							}
							console.log("Sending file list message to " + vrsNum + " with " + JSON.stringify(latestResult));

							io.to(Number(vrsNum)).emit('fileListAgent', (latestResult) );
						});
					}else{
						console.log("Unknown error in get-file-list-consumer");
						console.log(results);
					}
				}
			});
	});

	//Handle new multi party invite since we need to manually tell the agent a call is coming.
	socket.on('multiparty-invite', function (data){
		io.to(Number(data.extensions)).emit('new-caller-ringing', {
			'phoneNumber': data.extensions,
			'callerNumber' : data.callerNumber
		  });
	});

	socket.on('requestScreenshare', function(data){
		console.log("Receiving screenshare request to " + data.agentNumber);
		io.to(Number(data.agentNumber)).emit('screenshareRequest', {
			'agentNumber' : data.agentNumber
		});
	});

	socket.on('screenshareResponse', function(data){
		console.log('Received agent screenshare reply');
		io.to(Number(data.number)).emit('screenshareResponse', {
			'permission' : data.permission
		});
	});

	//Fired at end of call when new call history is added
	socket.on('callHistory', function(data){
		console.log('callhistory for ' + token.username);
		mongodb.listCollections({name: token.username + 'callHistory'}).toArray((err, collections) => {
			if (collections.length == 0) {	// "stats" collection does not exist
				console.log("Creating new " + token.username + "callHistory colleciton in MongoDB");
				mongodb.createCollection(token.username + "callHistory",{capped: true, size:1000000, max:5000}, function(err, result) {
					if (err) throw err;
						console.log("Collection " + token.username + "callHistory is created capped size 100000, max 5000 entries");
					colCallHistory = mongodb.collection(token.username + 'callHistory');
				});
			}
			else {
				// events collection exist already
				colCallHistory = mongodb.collection(token.username + 'callHistory');
				//colCallHistory.remove({});
				// insert an entry to record the start of ace direct
				colCallHistory.insertOne(data, function(err, result) {
					if(err){
						console.log("Insert a record into " + token.username + "callHistory collection of MongoDB, error: " + err);
						logger.debug("Insert a record into " + token.username + "callHistory collection of MongoDB, error: " + err);
						throw err;
					}
				});
			}

		});
	});

	socket.on('getCallHistory', function(){
		console.log('callhistory for ' + token.username);
		mongodb.listCollections({name: token.username + 'callHistory'}).toArray((err, collections) => {
			if (collections.length == 0) {
				console.log("Creating new " + token.username + "callHistory colleciton in MongoDB");
				mongodb.createCollection(token.username + "callHistory",{capped: true, size:1000000, max:5000}, function(err, result) {
					if (err) throw err;
						console.log("Collection callHistory is created capped size 100000, max 5000 entries");
					colCallHistory = mongodb.collection(token.username + 'callHistory');
				});
			}
			else {
				// events collection exist already
				console.log("Collection " + token.username + "callHistory exists");
				colCallHistory = mongodb.collection(token.username + 'callHistory');
				// insert an entry to record the start of ace direct
				colCallHistory.find({}).toArray(function(err, result) {
					if(err){
						console.log("Insert a record into " + token.username + "callHistory collection of MongoDB, error: " + err);
						logger.debug("Insert a record into " + token.username + "callHistory collection of MongoDB, error: " + err);
						throw err;
					}else{
						socket.emit('returnCallHistory', result);
					}
				});
			}

		});
	});

	socket.on('set-shortcuts', function(data){
		// first check if collection already exist, if not create one
		mongodb.listCollections({name: token.username + 'shortcuts'}).toArray((err, collections) => {
			if (collections.length == 0) {	// "stats" collection does not exist
				console.log("Creating new shortcuts colleciton in MongoDB");
				mongodb.createCollection(token.username + "shortcuts", function(err, result) {
					if (err) {
						console.log('error creating collection: ' +err);
						throw err;
					}
					console.log("Collection " + token.username + "shortcuts is created");
					colShortcuts = mongodb.collection(token.username + 'shortcuts');
				});
			}
			else {
				//collection exist already
				//console.log("Collection shortcuts exists");
				colShortcuts = mongodb.collection(token.username + 'shortcuts');

				//updates the shortcut if it exists. create a new document if not
				colShortcuts.updateOne(
					{_id: data._id},
					{$set: {task:data.task, shortcut:data.shortcut}},
					{upsert: true}
				);
			}

		});
	});

	socket.on('get-shortcuts', function(){
		mongodb.listCollections({name: token.username + 'shortcuts'}).toArray((err, collections) => {
			if (collections.length == 0) {	// collection does not exist
				console.log("Creating new shortcuts colleciton in MongoDB");
				mongodb.createCollection(token.username + "shortcuts", function(err, result) {
					if (err) {
						console.log('error creating collection: ' +err);
						throw err;
					}
					console.log("Collection shortcuts is created");
					colShortcuts = mongodb.collection(token.username + 'shortcuts');
				});
			}
			else {
				//console.log("Collection shortcuts exists");
				colShortcuts = mongodb.collection(token.username + 'shortcuts');

				colShortcuts.find({}).toArray(function(err, result) {
					if(err){
						console.log("error getting shortcuts: " + err);
						throw err;
					}else{
						socket.emit('receive-shortcuts', result);
					}
				});
			}

		});
	});

	socket.on('reset-shortcuts', function() {
		console.log('resetting shortcuts');
		colShortcuts = mongodb.collection(token.username + 'shortcuts');
		colShortcuts.deleteMany({});
	});

	//Get all agents statuses and extensions.  Used for multi party option dropdown.
	/*socket.on('ami-req', function(message){
		if(message === 'agent'){
			socket.emit('agent-resp', {
				'agents' : Agents
			});
		}
	});*/

	// Handle incoming Socket.IO registration requests from an agent - add to the room
	socket.on('register-agent', function (data) {
		logger.info("Adding agent socket to room named: " + token.extension);
		logger.info(socket.id);
		logger.info(socket.request.connection._peername);

		// Add this socket to the room
		socket.join(token.extension);

		//register agent to asterisk.
		setInitialLoginAsteriskConfigs(token);

		io.to(token.extension).emit('lightcode-configs', colorConfigs);
		var skinny = getConfigVal('skinny_mode:agent');
		io.to(token.extension).emit('skinny-config', skinny);

		var caption_agent = getConfigVal('caption_mode:agent');
		io.to(token.extension).emit('caption-config', caption_agent);

		var url = 'https://' + getConfigVal('common:private_ip') + ':' + getConfigVal('agent_service:port');
		if (url) {
			url += '/getallscripts/';

			request({
				url: url,
				json: true
			}, function (error, response, data) {
				if (error) {
					logger.error("ERROR: /getallscripts/");
					data = {
						"message": "failed"
					};
					io.to(token.extension).emit('script-data', data);
				} else {
					io.to(token.extension).emit('script-data', data);
				}
			});
		}
	});


        /* pause/unpause a queue
           For example...
           b: "true" , "false"
           ext: "33001"
           qname: "ComplaintsQueue"
        */
        function pauseQueue(b,ext,qname) {
          logger.info('pauseQueue() , ' + b.toString() + ' , ' +  ext + ', ' + qname);
          ami.action({
            "Action": "QueuePause",
            "ActionId": "1000",
            "Interface": "PJSIP/" + ext,
            "Paused": b.toString(),
            "Queue": qname,
            "Reason": "QueuePause in pause-queue event handler"
          }, function (err, res) {});
        }

	/*
	 * Handler catches a Socket.IO message to pause both queues. Note, we are
	 * pausing both queues, but, the extension is the same for both.
	 */
	socket.on('pause-queues', function () {

		// Pause the first queue
		if (token.queue_name) {
                  logger.info('PAUSING QUEUE: PJSIP/' + token.extension + ', queue name ' + token.queue_name);
                  pauseQueue(true,token.extension,token.queue_name);
		}

		// Pause the second queue (if not null)
		if (token.queue2_name) {
                  logger.info('PAUSING QUEUE: PJSIP/' + token.extension + ', queue name ' + token.queue2_name);
                  pauseQueue(true,token.extension,token.queue2_name);
		}
	});

	// Sets the agent state to READY
	socket.on('ready', function () {
		logger.info('State: READY - ' + token.username);
		redisClient.hset(rStatusMap, token.username, "READY", function (err, res) {
			sendAgentStatusList(token.username, "READY");
			redisClient.hset(rTokenMap, token.lightcode, "READY");
		});

	});

	// Sets the agent state to AWAY
	socket.on('away', function () {
		logger.info('State: AWAY - ' + token.username);
		redisClient.hset(rStatusMap, token.username, "AWAY", function (err, res) {
			sendAgentStatusList(token.username, "AWAY");
			redisClient.hset(rTokenMap, token.lightcode, "AWAY");
		});
	});

	// Sets the agent state to WRAPUP
	socket.on('wrapup', function () {

                pauseQueue(true,token.extension,token.queue_name); //pause agent during wrapup mode
                pauseQueue(true,token.extension,token.queue2_name); //pause agent during wrapup mode

		logger.info('State: WRAPUP - ' + token.username);
		redisClient.hset(rStatusMap, token.username, "WRAPUP", function (err, res) {
			sendAgentStatusList(token.username, "WRAPUP");
			redisClient.hset(rTokenMap, token.lightcode, "WRAPUP");
		});
	});

	// Sets the agent state to INCALL
	socket.on('incall', function (data) {
		logger.info('State: INCALL - ' + token.username);
		if (data.vrs) {
			// Dealing with a WebRTC consumer, otherwise, it is a Linphone
			socket.join(Number(data.vrs));
		}
		redisClient.hset(rStatusMap, token.username, "INCALL", function (err, res) {
			sendAgentStatusList(token.username, "INCALL");
			redisClient.hset(rTokenMap, token.lightcode, "INCALL");
		});
	});

	// Sets the agent state to INCOMINGCALL
	socket.on('incomingcall', function () {
		logger.info('State: INCOMINGCALL - ' + token.username);
		redisClient.hset(rStatusMap, token.username, "INCOMINGCALL", function (err, res) {
			sendAgentStatusList(token.username, "INCOMINGCALL");
			redisClient.hset(rTokenMap, token.lightcode, "INCOMINGCALL");
		});
	});

	// Sets the agent state to MISSEDCALL
	socket.on('missedcall', function () {
		logger.info('State: MISSEDCALL - ' + token.username);
		redisClient.hset(rStatusMap, token.username, "MISSEDCALL", function (err, res) {
			sendAgentStatusList(token.username, "MISSEDCALL");
			redisClient.hset(rTokenMap, token.lightcode, "MISSEDCALL");
		});
	});

	// Sends request for agent assistance to the Management Portal
	socket.on('request-assistance', function () {
		logger.info('Request Assistance - ' + token.username + ':' + token.extension);
		var url = 'https://' + getConfigVal('common:private_ip') + ':' + getConfigVal('management_portal:https_listen_port') + '/agentassist'; //assumes managementportal is co-located with adserver
		request({
			url: url,
			qs: {
				extension: token.extension
			},
			json: true
		}, function (err, res, data) {
			if (err) {
				logger.error('Error - Request Assistance: ' + err);
				io.to(token.extension).emit('request-assistance-response', {
					'message': 'An Error Occured'
				});
			} else {
				io.to(token.extension).emit('request-assistance-response', data);
			}

		});
	});

	/*
	 * Handler catches a Socket.IO message to unpause both queues. Note, we are
	 * unpausing both queues, but, the extension is the same for both.
	 */
	socket.on('unpause-queues', function () {

		if (token.queue_name) {
                  logger.info('UNPAUSING QUEUE: PJSIP/' + token.extension + ', queue name ' + token.queue_name);
                  pauseQueue(false,token.extension,token.queue_name);
		}

		if (token.queue2_name) {
                  logger.info('UNPAUSING QUEUE: PJSIP/' + token.extension + ', queue name ' + token.queue2_name);
                  pauseQueue(false,token.extension,token.queue2_name);
		}
	});

	socket.on('get_color_config', function () {
		loadColorConfigs();
	});
	socket.on('send-name', function(data){
		io.to(Number(data.vrs)).emit('agent-name', data);
	});
	socket.on('save-grid-layout', function (data) {
		var requestJson = {};
		requestJson.agent_id = token.agent_id;
		requestJson.layout = data.gridLayout;
		request({
			method: 'POST',
			url: 'https://' + getConfigVal('common:private_ip') + ':' + getConfigVal('agent_service:port') + '/updateLayoutConfig',
			headers: {
				'Content-Type': 'application/json'
			},
			body: requestJson,
			json: true
		}, function (error, response, data) {
			if (error) {
				logger.error("save-grid-layout ERROR: " + error);
				io.to(token.extension).emit('save-grid-layout-error', 'Error');
			} else {
				io.to(token.extension).emit('save-grid-layout-success', 'Success');
			}
		});
	});

	socket.on('get-dial-in-number', function(data) {
		var dialInNumber;
		var obj = {
			'Action':'Command',
			'command':'database show global/dialin'
		};

		ami.action(obj, function(err, res) {
			if (err) {
				console.log('error getting dial-in number');
				console.log(JSON.stringify(err));
			} else {
				console.log('success getting dial-in number');
				var outputValues = Object.values(res.output[0]);
				var num = '';

				for (var i = 0; i < outputValues.length; i++) {
					if (!isNaN(outputValues[i]) && outputValues[i] !==' ') {
						num = num+outputValues[i];
					}
				}

				if (num.length == 10) {
					dialInNumber = num.slice(0,3)+"-"+num.slice(3,6)+"-"+num.slice(6);
				} else {
					dialInNumber = 'UNKNOWN';
				}

				io.to(data.extension).emit('dialin-number', {'number': dialInNumber});
			}
		});
	});

	// Handler catches a Socket.IO disconnect
	socket.on('disconnect', function () {
		logger.info('DISCONNECTED');
		logger.info(socket.id);
		logger.info(socket.request.connection._peername);

		//Removes user from statusMap
		if ("username" in token) {
			logout(token);
		}

		//Remove the consumer from the extension map.
		if (token.vrs) {
			redisClient.hget(rExtensionToVrs, Number(token.vrs), function (err, ext) {

                        regex_str =  "/^PJSIP/" + ext + "-.*$/";
                        ami.action({
                                "Action": "Hangup",
                                "ActionID": "4",
                                "Channel": regex_str
                        }, function (err, res) {
                          if (err) {
                            logger.info('ERROR in hangup');
                          } else {
                            logger.info('SUCCESS hangup');
                          }
                        });

				redisClient.hget(rConsumerExtensions, Number(ext), function (err, reply) {
					if (err) {
						logger.error("Redis Error" + err);
					} else if (reply) {
						var val = JSON.parse(reply);
						val.inuse = false;
						redisClient.hset(rConsumerExtensions, Number(ext), JSON.stringify(val));
						redisClient.hset(rTokenMap, token.lightcode, "OFFLINE");
                                                redisClient.hdel(rExtensionToVrs, Number(ext));
												redisClient.hdel(rExtensionToVrs, Number(token.vrs));
												redisClient.hdel(rExtensionToLanguage, Number(ext));
					}
				});
			});
		}

	});

	// ######################################################
	// All Socket.IO events below are ACD-specific

	/*
	 * Flow from consumer portal
	 * 1. Consumer provides VRS #, email, complaint, sends to node server.
	 * 2. Node server does a VRS lookup, creates a Zendesk ticket, then
	 * returns VRS data and Zendesk ticket number.
	 */

	// Handler catches a Socket.IO event (ad-ticket) to create a Zendesk ticket based on incoming info.
	socket.on('ad-ticket', function (data) {
		logger.info('Received a Zendesk ticket request: ' + JSON.stringify(data));
		logger.info('Session Token: ' + JSON.stringify(token));

		processConsumerRequest(data);
	});

	// Handler catches a Socket.IO event (modify-ticket) to modify an existing Zendesk ticket based on incoming info.
	socket.on('modify-ticket', function (data) {
		logger.info('Received a Zendesk UPDATE ticket request: ' + JSON.stringify(data));
		logger.info('Session Token: ' + JSON.stringify(token));

		updateZendeskTicket(data);
	});

	//defaults to false
	var isMuted = getConfigVal('agent_incall_audio:mute_all_audio');
    socket.emit('mute-options', {'isMuted':isMuted});

    var saveChatHistory = getConfigVal('agent_chat:save_agent_chats');
    socket.emit('save-chat-value', {'isSaved':saveChatHistory});

	// direct messaging between agents
	socket.on('check-agent-chat-status', function(data) {
		if (saveChatHistory == 'true'){
			//if collection with data participants exists, send collection
			//if not, create collection
			var chatMembers = [data.destext, data.senderext];

			if (chatMembers.length < 2) {
				console.log("ERROR");
			} else {
				chatMembers = chatMembers.sort();
				var extensionsChat = chatMembers.toString();

				mongodb.listCollections({name: extensionsChat + 'chatHistory'}).toArray((err, collections) => {
					if (collections.length == 0) {
						// collection does not exist
						console.log("Creating new chatHistory colleciton in MongoDB");

						if (err) throw err;

						colChatHistory = mongodb.collection(extensionsChat + 'chatHistory');
						console.log("Collection "+extensionsChat+"chatHistory is created ");

						socket.emit('begin-agent-chat');
					}
					else {
						// collection exist already
						colChatHistory = mongodb.collection(extensionsChat + 'chatHistory');

						socket.emit('continue-agent-chat', {'destExt': data.destext});
					}
				});
			}
		}
	});

	socket.on('get-agent-chat', function(data) {
		if (saveChatHistory == 'true'){
			var chatMembers = [data.destext, data.senderext];
			chatMembers = chatMembers.sort();
			var extensionsChat = chatMembers.toString();

			colChatHistory = mongodb.collection(extensionsChat + 'chatHistory');

			colChatHistory.find({}).sort({$natural:-1}).limit(100).toArray(function(err, result) {
				//only load the last 100 chats to prevent lagging
				if(err) {
					console.log("Get agent chat error: " + err);
					logger.debug("Get agent chat error: " + err);
					throw err;
				} else {
					socket.emit('load-agent-chat-messages', result);
				}
			});
		}
	});

	socket.on('upload-agent-message', function(data) {
		io.to(Number(data.destext)).emit('new-agent-chat', data);

		if (saveChatHistory == 'true'){
			var chatMembers = [data.destext, data.senderext];
			chatMembers = chatMembers.sort();
			var extensionsChat = chatMembers.toString();

			colChatHistory = mongodb.collection(extensionsChat + 'chatHistory');
			colChatHistory.insertOne(data, function(err, result) {
				if(err){
					console.log("Insert a record into chatHistory collection of MongoDB, error: " + err);
					logger.debug("Insert a record into chatHistory collection of MongoDB, error: " + err);
					throw err;
				}
			});
		}
	});

	//for testing only-- drop all chatHistory collections
	socket.on('clear-chat-messages', function() {

		mongodb.listCollections().toArray(function(err, results) {
			if(err) throw err;

			for (var i = 0; i < results.length; i++) {
				if (results[i].name.includes('chatHistory')) {
					colChatHistory = mongodb.collection(results[i].name);
					console.log(results[i].name);
					colChatHistory.drop(function (err, success) {
						if (err) throw err;
						if (success) console.log('collection dropped');
					});
				}
			}
		});
	});

	socket.on('get-my-chats', function(data) {
		if (saveChatHistory == 'true'){
			var chats = [];

			mongodb.listCollections().toArray((err, results) =>{
				if(err) throw err;

				for (var i = 0; i < results.length; i++) {
					if (results[i].name.includes(data.ext) && results[i].name.includes('chatHistory')) {
						chats.push(results[i].name);
					}
				}

				//get the last document from those chats
				var totalChats=chats.length;
				for (var i = 0; i < chats.length; i++) {
					colChatHistory = mongodb.collection(chats[i]);

					colChatHistory.find().sort({$natural: -1}).limit(1).next().then(
						function(doc) {
							socket.emit('my-chats', {'doc':doc, "total": totalChats});
						},
						function(err) {
							console.log('Error:', err);
						}
					);
				}
			});
		}
	});

	//RTT for agent to agent chat
	socket.on('agent-chat-typing', function (data) {
		var ext = data.ext;
		var msg = data.rttmsg;
		//Replace html tags with character entity code
		msg = msg.replace(/</g, "&lt;");
		msg = msg.replace(/>/g, "&gt;");
		io.to(Number(ext)).emit('agent-typing', {
			"typingmessage": data.displayname + ' is typing...',
			"displayname": data.displayname,
			"rttmsg": msg
		});
	});

	//RTT for agent to agent chat
	socket.on('agent-chat-typing-clear', function (data) {
		var ext = data.ext;

		io.to(Number(ext)).emit('agent-typing-clear', {
			"displayname": data.displayname
		});
	});

	socket.on('chat-read', function(data) {
		if (saveChatHistory == 'true'){
			var chatMembers = [data.ext, data.destext];
			chatMembers = chatMembers.sort();
			var extensionsChat = chatMembers.toString();

			mongodb.listCollections({name: extensionsChat + 'chatHistory'}).toArray((err, collections) => {

				colChatHistory = mongodb.collection(extensionsChat + 'chatHistory');
				//console.log('recipient opened message');
				colChatHistory.updateMany(
					{},
					{$set: {hasBeenOpened:true}},
					{}
				);
			});
		}
	});

	socket.on('broadcast-agent-chat', function(data) {
		var broadcastExtensions = [];

		var clients_in_the_room = io.sockets.adapter.rooms['my room'];
		var clients = (clients_in_the_room.sockets);
		var roomKeys = Object.keys(clients);

		//if the socketID matches, add to convo
		for (var i = 0; i < roomKeys.length; i++) {
			var currentRooms = (io.sockets.sockets[roomKeys[i]].rooms);
			broadcastExtensions.push((Object.keys(currentRooms)));
		}

		io.emit('broadcast', data);
		if (saveChatHistory == 'true'){
			//insert the broadcast into each conversation's db
			for (var i = 0; i < broadcastExtensions.length; i++) {
				data.destname = '';
				var currentExt = broadcastExtensions[i][0];

				data.destext=broadcastExtensions[i][0];

				var chatMembers = [currentExt, data.senderext];
				chatMembers = chatMembers.sort();
				var extensionsChat = chatMembers.toString();

				colChatHistory = mongodb.collection(extensionsChat+'chatHistory');
				colChatHistory.insertOne(data, function(err, result) {
					if(err){
						console.log("Insert a record into chatHistory collection of MongoDB, error: " + err);
						logger.debug("Insert a record into chatHistory collection of MongoDB, error: " + err);
						throw err;
					} else {
						console.log('Successfully inserted broadcast message');
					}
				});
			}
		}
	});

	socket.on('update-broadcast-name', function(data) {
		if (saveChatHistory == 'true'){
			console.log('updating destname of broadcast');

			var chatMembers = [data.destext, data.senderext];
			chatMembers = chatMembers.sort();
			var extensionsChat = chatMembers.toString();

			mongodb.listCollections({name: extensionsChat + 'chatHistory'}).toArray((err, collections) => {

				colChatHistory = mongodb.collection(extensionsChat + 'chatHistory');

				colChatHistory.updateOne(
					{displayname: data.sendername, timeSent: data.time},
					{$set: {destname:data.name}},
					{upsert:false}
				);

			});
		}
	});

	// Handler catches a Socket.IO event (register-vrs) to create a new socket to the consumer portal.
	socket.on('register-vrs', function (data) {

		if (token.vrs) {
			logger.info("chat: register-vrs - if() case " + token.vrs);
			socket.join(Number(token.vrs));
			var skinny = getConfigVal('skinny_mode:consumer');
			io.to(token.vrs).emit('skinny-config', skinny);
			var caption_cons = getConfigVal('caption_mode:consumer');
			io.to(token.vrs).emit('caption-config', caption_cons);
		} else {
			logger.info("chat: register-vrs - else() case " + data.vrs);
			socket.join(Number(data.vrs));
		}
	});

	// Handler catches a Socket.IO event (call-initiated) to register the consumer with a JsSIP extension
	socket.on('call-initiated', function (data) {
		logger.info('Received a JsSIP consumer extension creation request: ' + JSON.stringify(data));
		processExtension(data);
	});

	// // Handler catches a Socket.IO event (chat-message) to create a Zendesk ticket based on incoming info.
	socket.on('chat-message', function (data) {
		var vrs = null;
		var msg = data.message;

		//prevent vrs consumer from spoofing a vrs
		if (token.vrs) {
			vrs = token.vrs;
		} else {
			vrs = data.vrs;
		}

		//Replace html tags with character entity code
		msg = msg.replace(/</g, "&lt;");
		msg = msg.replace(/>/g, "&gt;");
		data.message = msg;

		io.to(Number(vrs)).emit('chat-message-new', data);
	});

	socket.on('translate', function (data){
		console.log('Received data is ' + JSON.stringify(data));
			request({
				method: 'GET',
				url: translationServerUrl + '/translate?languageFrom=' + data.fromLanguage + '&text=' + encodeURI(data.message) + '&languageTo=' + data.toLanguage,
				headers: {
					'Content-Type': 'application/json'
				},
			}, function (error, response, newData) {
				if (error) {
					logger.error("translate ERROR: " + error);
					console.error("translate ERROR: " + error);
					socket.emit('chat-message-new-translated', data);
					socket.emit('translate-language-error', error);
				} else {
					let dataObj = JSON.parse(newData);
					console.log('Translation is ' + dataObj.translation);
					data.message = dataObj.translation;
					socket.emit('chat-message-new-translated', data);
				}
			});
	});

	// Handler catches a Socket.IO event (chat-typing) to send the user an 'is typing...' message in the chat window.
	socket.on('chat-typing', function (data) {
		var vrs = null;
		var msg = data.rttmsg;
		if (token.vrs) {
			vrs = token.vrs;
		} else {
			vrs = data.vrs;
		}
		//Replace html tags with character entity code
		msg = msg.replace(/</g, "&lt;");
		msg = msg.replace(/>/g, "&gt;");
		io.to(Number(vrs)).emit('typing', {
			"typingmessage": data.displayname + ' is typing...',
			"displayname": data.displayname,
			"rttmsg": msg
		});
	});

	// Handler catches a Socket.IO event (chat-typing-clear) to clear the 'is typing...' message in the chat window.
	socket.on('chat-typing-clear', function (data) {
		var vrs = null;
		if (token.vrs) {
			vrs = token.vrs;
		} else {
			vrs = data.vrs;
		}
		io.to(Number(vrs)).emit('typing-clear', {
			"displayname": data.displayname
		});
	});

	// Handler catches a Socket.IO event (chat-leave-ack) to leave the ongoing chat.
	socket.on('chat-leave-ack', function (data) {
		logger.info('Received chat-leave-ack' + JSON.stringify(data));

		if (data.vrs) {
			// Dealing with a WebRTC consumer, otherwise, it is a Linphone
			socket.leave(Number(data.vrs));
		}

	});

	/*
	 * Handler catches a Socket.IO event (input-vrs) so we can create the extension to VRS
	 * mapping, and, look up the Zendesk ticket ID number.
	 */
	socket.on('input-vrs', function (data) {

		logger.info('Received input-vrs ' + JSON.stringify(data) + ', calling vrsAndZenLookup() ');

		// Redis rExtensionToVrs must reverse map
		redisClient.hset(rExtensionToVrs, Number(data.extension), Number(data.vrs));
		redisClient.hset(rExtensionToVrs, Number(data.vrs), Number(data.extension));

		vrsAndZenLookup(Number(data.vrs), Number(data.extension));
	});

	//resends agent status list to update colors when the config file changes
	socket.on("update-agent-list", function (data) {
		sendAgentStatusList();
	});

	// ######################################
	// Videomail-specific socket.io events

	//Retrieval of videomail records from the database
	socket.on("get-videomail", function (data) {
		let filterFlag = (data.filter === "ALL"||typeof data.filter === 'undefined')?false:true;
		let sort = (typeof data.sortBy === 'undefined')?[]:data.sortBy.split(" ");

		let vm_sql_select = `SELECT id, extension, callbacknumber, recording_agent, processing_agent,
			received, processed, video_duration, status, deleted, src_channel, dest_channel, unique_id,
			video_filename, video_filepath FROM ${vmTable}`;
		let vm_sql_where = `WHERE deleted = 0`;
		let vm_sql_order = ``;
		let vm_sql_params = [];

		if(filterFlag){
			vm_sql_where += ` and status = ?`;
			vm_sql_params.push(data.filter);
		}
		if(sort.length == 2){
			vm_sql_order = ` ORDER BY ??`;
			vm_sql_params.push(sort[0]);
			if(sort[1] == 'desc')
				vm_sql_order += ` DESC`;
		}

		let vm_sql_query = `${vm_sql_select} ${vm_sql_where} ${vm_sql_order};`;
		dbConnection.query(vm_sql_query, vm_sql_params, function (err, result) {
			if (err) {
				logger.error("GET-VIDEOMAIL ERROR: " + err.code);
			} else {
				io.to(token.extension).emit('got-videomail-recs', result);
			}
		});

		let vm_sql_count_query = `SELECT COUNT(*) AS unreadMail FROM ${vmTable} WHERE UPPER(status)='UNREAD';`;
		dbConnection.query(vm_sql_count_query, function (err, result) {
			if (err) {
				logger.error("COUNT-UNREAD-MAIL ERROR: "+ err.code);
			} else {
				io.to(token.extension).emit('got-unread-count', result[0].unreadMail);
			}
		});

		let vm_sql_deleteOld = `UPDATE ${vmTable} SET deleted = 1, deleted_time = CURRENT_TIMESTAMP,
			deleted_by = 'auto_delete' WHERE (UPPER(status)='READ' OR UPPER(status)='CLOSED') AND
			TIMESTAMPDIFF(DAY, processed, CURRENT_TIMESTAMP) >= 14;`;
		dbConnection.query(vm_sql_deleteOld, function(err, result) {
			if (err) {
				logger.error('DELETE-OLD-VIDEOMAIL ERROR: '+ err.code);
			} else {
				;
			}
		});
	});

	//updates videomail records when the agent changes the status
	socket.on("videomail-status-change", function (data) {
		logger.debug('updating MySQL entry');
		let vm_sql_query = `UPDATE ${vmTable} SET status = ?, processed = CURRENT_TIMESTAMP,
			processing_agent = ? WHERE id = ?;`;
		let vm_sql_params = [data.status, token.extension, data.id];

		logger.debug(vm_sql_query + " " + vm_sql_params);

		dbConnection.query(vm_sql_query, vm_sql_params,function (err, result) {
			if (err) {
				logger.error('VIDEOMAIL-STATUS-CHANGE ERROR: '+ err.code);
			} else {
				logger.debug(result);
				io.to(token.extension).emit('changed-status', result);
			}
		});
	});
	//changes the videomail status to READ if it was UNREAD before
	socket.on("videomail-read-onclick", function (data) {
		logger.debug('updating MySQL entry');

		let vm_sql_query = `UPDATE ${vmTable} SET status = 'READ',
			processed = CURRENT_TIMESTAMP, processing_agent = ? WHERE id = ?;`;
		let vm_sql_params = [token.extension, data.id];

		logger.debug(vm_sql_query + " " + vm_sql_params);

		dbConnection.query(vm_sql_query, vm_sql_params,function (err, result) {
			if (err) {
				logger.error('VIDEOMAIL-READ ERROR: '+ err.code);
			} else {
				logger.debug(result);
				io.to(token.extension).emit('changed-status', result);
			}
		});
	});
	//updates videomail records when the agent deletes the videomail. Keeps it in db but with a deleted flag
	socket.on("videomail-deleted", function (data) {
		logger.debug('updating MySQL entry');

		let vm_sql_query = `UPDATE ${vmTable} SET deleted_time = CURRENT_TIMESTAMP, deleted_by = ?, deleted = 1  WHERE id = ?;`;
		let vm_sql_params = [token.extension, data.id];

		logger.debug(vm_sql_query + " " + vm_sql_params);

		dbConnection.query(vm_sql_query, vm_sql_params,function (err, result) {
			if (err) {
				logger.error('VIDEOMAIL-DELETE ERROR: '+ err.code);
			} else {
				logger.debug(result);
				io.to(token.extension).emit('changed-status', result);
			}
		});
	});

	/**
	 * Socket call for request to obtain file from fileShare
	 */
	socket.on('uploadFile', function (data) {
		console.log("RECEIVED EVENT FILE " + data);
		logger.info("Adding agent socket to room named: " + token.extension);
		logger.info(socket.id);
		logger.info(socket.request.connection._peername);

		// Add this socket to the room
		socket.join(token.extension);

		var url = 'https://' + getConfigVal('common:private_ip') + ':9905';
		if (url) {
			url += '/storeFileName';

			request({
				url: url,
				method: 'POST'
				//TODO Add the file body
			}, function (error, response, data) {
				if (error) {
					logger.error("ERROR: /storeFileName/");
					data = {
						"message": "failed"
					};
					console.log('Error on file share');
					//io.to(token.extension).emit('script-data', data);
				} else {
					//io.to(token.extension).emit('script-data', data);
					console.log('File share connection successful.');
					console.log('RESPONSE ' + JSON.stringify(response));
					socket.emit('postFile', response);
				}
			});
		}
	});

	socket.on('set-agent-language', function(data) {
		console.log('setting language', Number(data.extension), data.language);
		redisClient.hset(rExtensionToLanguage, Number(data.extension), data.language);
	});

	socket.on('translate-caption', function(data) {

		// fixme do we have to test this to avoid hacks or bugs?
		let callerNumber = data.callerNumber.toString();
		let msgid = data.transcripts.msgid;
		let final = data.transcripts.final;

		console.log('translating', data);

		var fromNumber;
		var toNumber;
		var languageFrom;
		var languageTo;

		redisClient.hgetall(rConsumerToCsr, function (err, tuples) {
			if (err) {
				logger.error("Redis Error" + err);
				console.log("Redis Error" + err);
			} else {
				console.log('csr', callerNumber, tuples);
				for (let clientNumber in tuples) {
					agentNumber = tuples[clientNumber];
					console.log(callerNumber, clientNumber + ' => ' + agentNumber, typeof(callerNumber), typeof(agentNumber), callerNumber === agentNumber);
					if (callerNumber === agentNumber) {
						fromNumber = clientNumber;
						toNumber = agentNumber;
					}
					else if (callerNumber === clientNumber) {
						fromNumber = agentNumber;
						toNumber = clientNumber;
						console.log(agentNumber, clientNumber);
					}
				}
				var promises = [
					new Promise( function(resolve,reject) {
						redisClient.hget(rExtensionToLanguage, Number(fromNumber), function (err, language) {
							if (err) {
								logger.error("Redis Error" + err);
								reject(err);
							}
							else {
								languageFrom = language;
								console.log('language from for user', fromNumber, languageFrom);
								if (!languageFrom) {
									languageFrom = 'en'; // default English
								}

								resolve();
							}
						});
					}),
					new Promise( function(resolve,reject) {
						redisClient.hget(rExtensionToLanguage, Number(toNumber), function (err, language) {
							if (err) {
							  logger.error("Redis Error" + err);
							  reject(err);
							}
							else {
								languageTo = language;
								if (!languageTo) {
									languageTo = 'en'; // default English
								}
								resolve();
							}
						});
					})
				];

				Promise.all(promises).then( function(values) {
					console.log('language',fromNumber,toNumber,languageFrom,languageTo);
					console.log('translating', data.transcripts.transcript, 'from', languageFrom, 'to', languageTo);
					let encodedText = encodeURI(data.transcripts.transcript.trim());
					let translationUrl = translationServerUrl + '/translate?languageFrom=' + languageFrom + '&text=' + encodedText + '&languageTo=' + languageTo;
					if (languageTo === languageFrom) {
						console.log('same language!');
						socket.emit('caption-translated', {
							'transcript' : data.transcripts.transcript.trim(),
							'msgid': msgid,
							'final': final
						});
					}
					else {
						console.log('trying', translationUrl);
						request({
							method: 'GET',
								url: translationUrl,
								headers: {
									'Content-Type': 'application/json'
								},
								json: true
						}, function (error, response, data) {
							if (error) {
								logger.error("GET translation: " + error);
								console.error("GET translation error: " + error);
								socket.emit('caption-translated', {
									'transcript' : 'Error using translation server: ' + translationUrl,
									'msgid': msgid,
									'final': final
								});
							} else {
								console.log('received translation', data);
								console.log(languageFrom, languageTo, translationUrl);
								// fixme will this be wrong if multiple clients/agents?
								socket.emit('caption-translated', {
									'transcript' : data.translation,
									'msgid': msgid,
									'final': final
									});
								// io.to(Number(callerNumber)).emit('caption-translated', {
								// 	'transcript' : data.translation,
								// 	'msgid': msgid,
								// 	'final': final
								// 	});
									// console.log(data.translation, 'sent to', callerNumber)

							}
						});
					}
				}).catch(function(err) {
					console.log('Error in translate-caption', err.message); // some coding error in handling happened
				});



			}
		});


	});
});

/**
 * updates and emits All Agents status to 'my room'
 * data is used to update the agent status table
 * of the index page.
 *
 * @param {undefined} Not used.
 * @returns {undefined} Not used
 */
function sendAgentStatusList(agent, value) {
	if (agent) {
		redisClient.hget(rAgentInfoMap, agent, function (err, agentInfo) {
			if (agentInfo) {
				var agentInfoJSON = JSON.parse(agentInfo);
				agentInfoJSON.status = value;
				redisClient.hset(rAgentInfoMap, agent, JSON.stringify(agentInfoJSON), function () {
					redisClient.hvals(rAgentInfoMap, function (err, values) {
						var aList = [];
						for (var id in values) {
							aList.push(JSON.parse(values[id]));
						}
						io.to('my room').emit('agent-status-list', {
							"message": "success",
							"agents": aList
						});
					});
				});
			}
		});
	} else { // forces socket emit without an update to user agent status map.
		redisClient.hvals(rAgentInfoMap, function (err, values) {
			var aList = [];
			for (var id in values) {
				aList.push(JSON.parse(values[id]));
			}
			io.to('my room').emit('agent-status-list', {
				"message": "success",
				"agents": aList
			});
		});
	}
}

/**
 * Event handler to catch the incoming AMI action response. Note, this is
 * a response to an AMI action (request from this node server) and is NOT
 * an Asterisk auto-generated event.
 *
 * @param {type} evt Incoming Asterisk AMI event.
 * @returns {undefined} Not used
 */
function handle_action_response(evt) {
	// logger.info('\n######################################');
	// logger.info('Received an AMI action response: ' + evt);
	// logger.info(util.inspect(evt, false, null));
}

// this method requires "popticket": {"url": "https://someurl.com/...."}, in the config file
function popZendesk(callId,ani,agentid,agentphonenum,skillgrpnum,skillgrpnam,callernam,dnis) {

  var popurl = "";
  if (typeof (nconf.get('popticket:url')) === "undefined") {
    logger.info("popZendesk: popticket:url is not in the config file. Skipping popZendesk...");
    return;
  } else {
    popurl = getConfigVal('popticket:url');
    logger.info("popZendesk: popticket:url is " + popurl);
  }

  var formData = {};
  var properties = {};
  properties.CallId = callId; //REQUIRED. The CallID that identifies call in originating system (Asterisk)
  properties.ANI = ani; //REQUIRED. Phone number of the caller.  Used to locate the caller in Zendesk
  properties.AgentID = agentid; //REQUIRED. The agentid or extension that identifies the answering agent to the phone system (Asterisk).
  properties.AgentPhoneNumber = agentphonenum; //The phone number / extension of the agent that answered call.  Might be same as AgentID.
  properties.SkillGroupNumber = skillgrpnum; //The number of queue or huntgroup of the call
  properties.DTKSkillGroupName = skillgrpnam; //The name of the queue or huntgroup of the call.
  properties.CallerName = callernam; //The name of caller or caller id info if available.
  properties.DNIS = dnis; //The dialed number or destination that caller called/dialed.
  properties.Language = "asl_call_center"; //required by FCC
  formData.m_eventName = "DTK_EXT_TELEPHONY_CALL_ANSWERED";
  formData.m_properties = {};
  formData.m_properties.Properties = properties;
  logger.info("popZendesk form body: " + JSON.stringify(formData));

	request({
		method: 'POST',
		url: popurl,
		headers: {
			'Content-Type': 'application/json'
		},
		body: formData,
		json: true
	}, function (error, response, data) {
		if (error) {
			logger.error("");
			logger.error("*****************************");
			logger.error("ERROR - could not pop Zendesk");
			logger.error("*****************************");
			logger.error("");
			logger.error("popZendesk ERROR: " + error);
		} else {
			logger.info("popZendesk Success ");
		}
	});
}

/**
 * Insert a call data record into calldata collection of MongoDB
 *
 * @param {string} eventType One of these event types: "Handled", "Web", "Videomail", "Abandoned"
 */
function insertCallDataRecord (eventType, vrs) {
	if (logCallData) {
		colCallData = mongodb.collection('calldata');

		var data = {"Timestamp": new Date(), "Event": eventType};
		if (vrs != null) {
			data.vrs = vrs;

			console.log("INSERTING CALL DATA " + JSON.stringify(data, null, 2));
			colCallData.insertOne(data, function(err, result) {
				if(err){
					console.log("Insert a call data record into calldata collection of MongoDB, error: " + err);
					logger.debug("Insert a call data record into calldata collection of MongoDB, error: " + err);
				}
			});
		}
	}
}

/**
 * Event handler to catch the incoming AMI events. Note, these are the
 * events that are auto-generated by Asterisk (don't require any AMI actions
 * sent by this node server). Only concerned with the DialEnd and Hangup events.
 *
 * PLEASE NOTE! Only the AMI events we care about will be passed to this method. To see the events
 * or add more events, modify init_ami().
 *
 * @param {type} evt Incoming Asterisk event.
 * @returns {undefined} Not used
 */
function handle_manager_event(evt) {

  logger.info('\n\n######################################');
  logger.info('Received an AMI event: ' + evt.event);
  logger.info(util.inspect(evt, false, null));
  //console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>The event is " + evt.event);
  switch (evt.event) {

	case ('VarSet'):
		let channel = evt.channel.split(/[\/,-]/);
        if(channel[1]  && (channel[1].startsWith("ProviderPurple") || channel[1].startsWith("ProviderZVRS")) && evt.variable && evt.variable.bridgepeer == ''){
			let agentExt = evt.value.split(/[\/,-]/);
			console.log("sending new-peer to", agentExt[1]);
			if(agentExt[1])
				io.to(agentExt[1]).emit('new-peer',{});
		}
		break;


    // Sent by Asterisk when the call is answered
    case ('DialEnd'):
      // Make sure this is an ANSWER event only
      if (evt.dialstatus === 'ANSWER') {

        logger.info('DialEnd / ANSWER: evt.context is: >' + evt.context + '< , evt.channel is: >' + evt.channel + '<');
		logger.info("Event is " + JSON.stringify(evt, null, 2));

		if (evt.context === 'from-internal' && evt.destchannel.includes(PROVIDER_STR)) {

			let channel = evt.channel;
			let channelExt = channel.split(/[\/,-]/);
			io.to(Number(channelExt[1])).emit('outbound-answered', {});
		}
        /*
         * For the complaints queue, we do the following:
         * - Get the extension number (channel field?)
         * - Look up the corresponding VRS (extensionToVrs map)
         * - Do a VRS lookup
         * - Use the extension and VRS to find the corresponding Zendesk ticket (zenIdToExtensionData map)
         *
         * Note, calls from WebRTC go to the complaints queue, while calls from the Zphone go to the
         * 'Provider_Complaints' queue (corresponds to option #5 on the Zphone).
         */
        if (evt.context == 'from-internal' || evt.context === 'Complaints' || evt.context === 'Provider_Complaints') {
          // Case #5

          logger.info('DialEnd processing from a Complaints queue call. evt.context is: ' + evt.context + ' , evt.channel is: ' + evt.channel);

          // Format is PJSIP/nnnnn-xxxxxx, we want to strip out the nnnnn only
          var extString = evt.channel;
          var extension = extString.split(/[\/,-]/);
          var isOurPhone = false;

          //is this one of our phones? one that we expect?
          if ( extension[1].startsWith(PROVIDER_STR) ) {
            isOurPhone = true;
            logger.info('Matched on ' + extension[1] + ', setting extension[1] to ' + evt.calleridnum);
            extension[1] = evt.calleridnum;
          } else {
			logger.info("No phone match, but this could be a WebRTC extension: " + extension[1] + ". leaving extension[1] alone to continue processing...");
		  }

          var destExtString = evt.destchannel;
		  var destExtension = destExtString.split(/[\/,-]/);
          redisClient.hset(rConsumerToCsr, Number(extension[1]), Number(destExtension[1]));
          logger.info('Populating consumerToCsr: ' + extension[1] + ' => ' + destExtension[1]);
          logger.info('Extension number: ' + extension[1]);
		  logger.info('Dest extension number: ' + destExtension[1]);

          if (extension[1].length >= 10) {
            //pop here, because we already have the consumer phone number
			popZendesk(evt.destuniqueid,extension[1],destExtension[1],destExtension[1],"","","","");

			console.log("CONSUMER VRS NUMBER " + extension[1]);
          }

          redisClient.hget(rExtensionToVrs, Number(extension[1]), function (err, vrsNum) {
            if (!err && vrsNum) {
              // Call new function
			  logger.info('Calling vrsAndZenLookup with ' + vrsNum + ' and ' + destExtension[1]);
			//   console.log("HAVE VRS NUMBER " + vrsNum);
			//   console.log("INSERTING WEB CALL HANDLED");
			  insertCallDataRecord("Handled", vrsNum);
			  insertCallDataRecord("Web", vrsNum);

              //mapped consumer extension to a vrs num. so now we can finally pop
              popZendesk(evt.destuniqueid,vrsNum,destExtension[1],destExtension[1],"","","","");

              vrsAndZenLookup(Number(vrsNum), Number(destExtension[1]));
            } else if ( isOurPhone ) {
              vrsAndZenLookup(Number(extension[1]), Number(destExtension[1]));
			  io.to(Number(destExtension[1])).emit('no-ticket-info', {});
			  console.log("OUR PHONE " + extension[1]);
            } else {
              // Trigger to agent to indicate that we don't have a valid VRS, agent will prompt user for VRS
			  io.to(Number(destExtension[1])).emit('missing-vrs', {});
			  console.log("MISSING VRS NUMBER ");
            }
		  });

          //tell CSR portal that a complaints queue call has connected
          io.to(Number(destExtension[1])).emit('new-caller-complaints', evt.context);
        } else if (evt.context === 'Provider_General_Questions' || evt.context === 'General_Questions') {
          /*
           * This case occurs when a user calls from a Zphone and presses
           * option #4.
           */
          // Case #4

          /*
           * For the general questions queue, we do the following:
           * - Get the extension number (destchannel field?)
           * - Create an entry in the linphoneToAgentMap (linphone extension => dest agent extension)
           * - Emit a missing-vrs message to the correct agent portal (we don't have VRS for the Linphone caller)
           * - Emit a new-caller-general to the correct agent portal
           */

		  //console.log("INSERTING HARDWARE OR SOFTPHONE CALL HANDLED");
		  insertCallDataRecord("Handled", evt.calleridnum);

          if (JSON.stringify(evt.channel).indexOf(PROVIDER_STR) !== -1) {
            // This is a Zphone or Sorenson call

            logger.info('DialEnd processing from a General Questions queue call. evt.context is: ' + evt.context + ' , evt.channel is: ' + evt.channel);

            // Format is PJSIP/ZVRS-xxxxxx or PJSIP/Sorenson2-nnnnnn, we want to strip out the xxxxxx only
            var extString = evt.channel;
            var extension = extString.split(/[\/,-]/);
            var callType = null;

            logger.info('extension[1] is >' + extension[1] + '<');
            if (extension[1].startsWith(PROVIDER_STR)) {
              callType = extension[1];
              logger.info('Matched on ' + extension[1] + ', setting extension[1] to ' + evt.calleridnum);
              extension[1] = evt.calleridnum;
            }

            var destExtString = evt.destchannel;
            var destExtension = destExtString.split(/[\/,-]/);
            redisClient.hset(rConsumerToCsr, Number(extension[1]), Number(destExtension[1]));
            logger.info('Populating consumerToCsr: ' + extension[1] + ' => ' + destExtension[1]);
            logger.info('Extension number: ' + extension[1]);
            logger.info('Dest extension number: ' + destExtension[1]);

            //pop zendesk
            if (extension[1].length >= 10) {
              //pop here, because we already have the consumer phone number
              popZendesk(evt.destuniqueid,extension[1],destExtension[1],destExtension[1],"","","","");
            }

            redisClient.hget(rExtensionToVrs, Number(extension[1]), function (err, vrsNum) {
              if (!err && vrsNum) {
                // Call new function
                logger.info('Calling vrsAndZenLookup with ' + vrsNum + ' and ' + destExtension[1]);

                //mapped consumer extension to a vrs num. so now we can finally pop
                popZendesk(evt.destuniqueid,vrsNum,destExtension[1],destExtension[1],"","","","");

                vrsAndZenLookup(Number(vrsNum), Number(destExtension[1]));
              } else if (callType.startsWith(PROVIDER_STR) && extension[1] !== null) {
                vrsAndZenLookup(Number(extension[1]), Number(destExtension[1]));
                io.to(Number(destExtension[1])).emit('no-ticket-info', {});
              } else {
                // Trigger to agent to indicate that we don't have a valid VRS, agent will prompt user for VRS
                io.to(Number(destExtension[1])).emit('missing-vrs', {});
              }
            });
            //tell CSR portal that a complaints queue call has connected
            io.to(Number(destExtension[1])).emit('new-caller-general', evt.context);
          } else {
            // This is a Linphone call
            logger.info('DialEnd processing from a General Questions queue call, but UNKNOWN DEVICE. evt.context is: ' + evt.context + ' , evt.channel is: ' + evt.channel);
            logger.info('Proceeding anyway...');
            var agentString = evt.destchannel;
            var agentExtension = agentString.split(/[\/,-]/);
            var linphoneString = evt.channel;
            var linphoneExtension = linphoneString.split(/[\/,-]/);

            logger.info('Adding to linphoneToAgentMap: ' + Number(linphoneExtension[1]) + ' =>' + agentExtension[1]);

            redisClient.hset(rLinphoneToAgentMap, Number(linphoneExtension[1]), Number(agentExtension[1]));

            logger.info('Sending new-caller-general to agent: ' + agentExtension[1]);

            // Trigger to agent to indicate that we don't have a valid VRS, agent will prompt user for VRS
            io.to(Number(agentExtension[1])).emit('missing-vrs', {});
            io.to(Number(agentExtension[1])).emit('new-caller-general', evt.context);

            /** HOT FIX NOT IN GITHUB; MUST CARRY FORWARD */
            if (evt.calleridnum) {
              popZendesk(evt.destuniqueid, evt.calleridnum, agentExtension[1], agentExtension[1],"","","","");

			  // Save handled call??? What is in calleridnum ?
			  //insertCallDataRecord("Handled", evt.calleridnum);
            }
            /** HOT FIX NOT IN GITHUB; MUST CARRY FORWARD */

          }
        } else {
          // if we don't recognize the evt.context, then we will assume a web call (and allow chat)
          logger.info('DialEnd processing from a UNKNOWN queue call. evt.context is: ' + evt.context + ' , evt.channel is: ' + evt.channel);

          // Format is PJSIP/nnnnn-xxxxxx, we want to strip out the nnnnn only
          var extString = evt.channel;
          var extension = extString.split(/[\/,-]/);
          var isOurPhone = false;

          //is this one of our phones? one that we expect?
          if ( extension[1].startsWith(PROVIDER_STR) ) {
            isOurPhone = true;
            logger.info('Matched on ' + extension[1] + ', setting extension[1] to ' + evt.calleridnum);
            extension[1] = evt.calleridnum;
          } else {
            logger.info("No phone match, but this could be a WebRTC extension: " + extension[1] + ". leaving extension[1] alone to continue processing...");
          }

          var destExtString = evt.destchannel;
          var destExtension = destExtString.split(/[\/,-]/);
          redisClient.hset(rConsumerToCsr, Number(extension[1]), Number(destExtension[1]));
          logger.info('Populating consumerToCsr: ' + extension[1] + ' => ' + destExtension[1]);
          logger.info('Extension number: ' + extension[1]);
          logger.info('Dest extension number: ' + destExtension[1]);

          if (extension[1].length >= 10) {
            //pop here, because we already have the consumer phone number
            popZendesk(evt.destuniqueid,extension[1],destExtension[1],destExtension[1],"","","","");
          }

          redisClient.hget(rExtensionToVrs, Number(extension[1]), function (err, vrsNum) {
            if (!err && vrsNum) {
              // Call new function
              logger.info('Calling vrsAndZenLookup with ' + vrsNum + ' and ' + destExtension[1]);

			  insertCallDataRecord("Handled", vrsNum);

              //mapped consumer extension to a vrs num. so now we can finally pop
              popZendesk(evt.destuniqueid,vrsNum,destExtension[1],destExtension[1],"","","","");

              vrsAndZenLookup(Number(vrsNum), Number(destExtension[1]));
            } else if ( isOurPhone ) {
              vrsAndZenLookup(Number(extension[1]), Number(destExtension[1]));
              io.to(Number(destExtension[1])).emit('no-ticket-info', {});
            } else {
              // Trigger to agent to indicate that we don't have a valid VRS, agent will prompt user for VRS
              io.to(Number(destExtension[1])).emit('missing-vrs', {});
            }

          });
          //tell CSR portal that a complaints queue call has connected
          io.to(Number(destExtension[1])).emit('new-caller-complaints', evt.context);
        }
      }

      break;

      // Sent by Asterisk when the caller hangs up
    case ('Hangup'):
      var extString = evt.channel;
	  var extension = extString.split(/[\/,-]/);

      logger.info('HANGUP RECEIVED: evt.context:' + evt.context + ' , evt.channel:' + evt.channel);
	  logger.info('HANGUP RECEIVED calleridnum: ' + evt.calleridnum);

	  if (evt.context === 'Provider_Videomail') {
		console.log("VIDOEMAIL evt: " +  JSON.stringify(evt, null, 2));
		insertCallDataRecord("Videomail", evt.calleridnum);
	  }
      else if ( evt.connectedlinenum == queuesComplaintNumber || evt.exten === queuesComplaintNumber ) {
        // Consumer portal ONLY! Zphone Complaint queue calls will go to the next if clause
		logger.info('Processing Hangup from a Complaints queue call');
		logger.info('HANGUP RECEIVED COMPLAINTS QUEUE calleridnum: ' + evt.calleridnum);

        if (evt.context == 'from-internal' && evt.channelstatedesc == "Ringing") {
            //this is a missed call from the consumer portal
            var channelStr = evt.channel;
            var agentExtension = (channelStr.split(/[\/,-]/))[1];

            logger.info('**********************************');
            logger.info('**********************************');
            logger.info('**********************************');
            logger.info('**********************************');
            logger.info('');
            logger.info('Abandoned call for agent: ' + agentExtension);
            logger.info('');
            logger.info('**********************************');
            logger.info('**********************************');
            logger.info('**********************************');
            logger.info('**********************************');

			//this agent(agentExtension) must now go to away status
			console.log(agentExtension+ ' missed a call from the consumer portal');
            io.to(Number(agentExtension)).emit('new-missed-call', {"max_missed":getConfigVal('missed_calls:max_missed_calls')}); //should send missed call number
            redisClient.hget(rTokenMap, agentExtension, function (err, tokenMap) {
              if (err) {
                logger.error("Redis Error: " + err);
              } else {
                tokenMap = JSON.parse(tokenMap);
                if (tokenMap !== null && tokenMap.token)
                  redisClient.hset(rTokenMap, tokenMap.token, "MISSEDCALL");
              }
            });
        } else {
			//regular consumer portal hangup
			if (extension[1].startsWith(PROVIDER_STR)) {
			extension[1] = evt.calleridnum;
			logger.info('Matched on ZVRS, setting extension[1] to ' + evt.calleridnum);
			}

			logger.info('Hangup extension number: ' + extension[1]);

			redisClient.hget(rConsumerExtensions, Number(extension[1]), function (err, reply) {
			if (err) {
				logger.error("Redis Error" + err);
			} else if (reply) {
				var val = JSON.parse(reply);
				val.inuse = false;
				redisClient.hset(rConsumerExtensions, Number(extension[1]), JSON.stringify(val));
			}
			});

			logger.info('extensionToVrs contents:');
			redisClient.hgetall(rExtensionToVrs, function (err, reply) {
			for (var id in reply) {
				logger.info(id + ' => ' + reply[id]);
			}
			});

			redisClient.hexists(rExtensionToVrs, Number(extension[1]), function (err, reply) {
			if (reply === 1) {
				logger.info('extensionToVrsMap contains ' + extension[1]);
			} else {
				logger.info('extensionToVrsMap does not contain ' + extension[1]);
			}
			});

			redisClient.hget(rExtensionToVrs, Number(extension[1]), function (err, vrsNum) {
			if (!err && vrsNum) {
				logger.info('Sending chat-leave for socket id ' + vrsNum);
				io.to(Number(vrsNum)).emit('chat-leave', {
				"vrs": vrsNum
				});

				// Remove the extension when we're finished
				redisClient.hdel(rExtensionToVrs, Number(extension[1]));
				redisClient.hdel(rExtensionToVrs, Number(vrsNum));
			} else {
				logger.error("Couldn't find VRS number in extensionToVrs map for extension ");
			}
			});
		}
      } else if (evt.context === 'Provider_General_Questions' || evt.context === 'General_Questions' || evt.context === 'Provider_Complaints' || evt.context === 'Complaints') {
        // This Provider context check for this block of code may be obsolete.
		// Not call transfer
		// Zphone option #4 or 5
		logger.info('HANGUP Zphone option 4 or 5 calleridnum: ' + evt.calleridnum);

        var linphoneString = evt.channel;
        var linphoneExtension = linphoneString.split(/[\/,-]/);

        logger.info('Processing Hangup for a Provider_General_Questions queue call');
        logger.info('Linphone extension number: ' + linphoneExtension[1]);

        var agentExtension = 0;

        redisClient.hget(rLinphoneToAgentMap, Number(linphoneExtension[1]), function (err, agentExtension) {
          if (agentExtension !== null) {
            // Remove the entry
            redisClient.hdel(rLinphoneToAgentMap, Number(linphoneExtension[1]));
          } else {
            redisClient.hget(rConsumerToCsr, Number(evt.calleridnum), function (err, agentExtension) {
              //Remove rConsumerToCsr redis map on hangups.
              redisClient.hdel(rConsumerToCsr, Number(evt.calleridnum));
            });
          }
        });
      } else if (evt.context === 'from-internal' && evt.connectedlinenum === queuesVideomailNumber) {
		logger.info('Processing Hangup from a WebRTC Videomail call (Consumer hangup)');
        logger.info('VIDEOMAIL WebRTC HANGUP calleridnum: ' + evt.calleridnum);

        redisClient.hget(rConsumerExtensions, Number(evt.calleridnum), function (err, reply) {
          if (err) {
            logger.error("Redis Error" + err);
          } else if (reply) {
            var val = JSON.parse(reply);
            val.inuse = false;
            redisClient.hset(rConsumerExtensions, Number(evt.calleridnum), JSON.stringify(val));
          }
        });

        logger.info('extensionToVrs contents:');
        redisClient.hgetall(rExtensionToVrs, function (err, reply) {
          for (var id in reply) {
            logger.info(id + ' => ' + reply[id]);
          }
        });

        redisClient.hexists(rExtensionToVrs, Number(evt.calleridnum), function (err, reply) {
          if (reply === 1) {
            logger.info('extensionToVrsMap contains ' + evt.calleridnum);
          } else {
            logger.info('extensionToVrsMap does not contain ' + evt.calleridnum);
          }
        });

        redisClient.hget(rExtensionToVrs, Number(evt.calleridnum), function (err, vrsNum) {
          if (!err && vrsNum) {

			console.log("VIDOEMAIL WebRTC evt: " +  JSON.stringify(evt, null, 2));
			insertCallDataRecord("Videomail", vrsNum);

            // Remove the extension when we're finished
            redisClient.hdel(rExtensionToVrs, Number(evt.calleridnum));
            redisClient.hdel(rExtensionToVrs, Number(vrsNum));
          } else {
            logger.error("Couldn't find VRS number in extensionToVrs map for extension ");
          }
        });

      } else if (evt.context === 'from-internal') {
        if (evt.channelstatedesc === 'Ringing') {
		  //this is an abandoned call
          var channelStr = evt.channel;
          var agentExtension = (channelStr.split(/[\/,-]/))[1];

          logger.info('**********************************');
          logger.info('**********************************');
          logger.info('**********************************');
          logger.info('**********************************');
          logger.info('');
          logger.info('Abandoned call for agent: ' + agentExtension);
          logger.info('');
          logger.info('**********************************');
          logger.info('**********************************');
          logger.info('**********************************');
          logger.info('**********************************');

		  // calleridnum is for agent, connectedlinenum is for caller
		  logger.info('HANGUP RECEIVED ABANDONED CALL calleridnum & : connectedlinenum' + evt.calleridnum + " connectedlinenum " + evt.connectedlinenum);
		  insertCallDataRecord('Abandoned', evt.connectedlinenum);

          //this agent(agentExtension) must now go to away status
          io.to(Number(agentExtension)).emit('new-missed-call', {"max_missed":getConfigVal('missed_calls:max_missed_calls')}); //should send missed call number
          redisClient.hget(rTokenMap, agentExtension, function (err, tokenMap) {
            if (err) {
              logger.error("Redis Error: " + err);
            } else {
              tokenMap = JSON.parse(tokenMap);
              if (tokenMap !== null && tokenMap.token)
                redisClient.hset(rTokenMap, tokenMap.token, "MISSEDCALL");
            }
          });

        }
      } else if (evt.context === 'from-phones') {
        if (evt.channelstatedesc === 'Busy') {
          //This is a hangup from an outbound call that did not connect (i.e., Busy)
          logger.info('Extension ' + extension[1] + ' tried an outbound call, but it did not connect. Emitting chat-leave...');
          io.to(Number(extension[1])).emit('chat-leave', {
            "extension": extension[1],
            "vrs": ""
          });
        }
      } else {
          //if we get here, it is a hangup that we are ignoring, probably because we don't need it
          logger.info('Not processing hangup.  evt string values... evt.context:' + evt.context + ' , evt.channel:' + evt.channel);
		  logger.info('HANGUP RECEIVED IGNORING calleridnum: ' + evt.calleridnum);
      }

      break;

      // Sent by Asterisk when a call is transferred
    case ('AttendedTransfer'):
      logger.info('Processing AttendedTransfer');

      var extString = evt.origtransfererchannel;
      var extension = extString.split(/[\/,-]/);

      logger.info('Received a transfer request from: ' + extension[1] + ' to: ' + evt.secondtransfererexten);
      logger.info('Caller extension: ' + evt.origtransfererconnectedlinenum);
      logger.info('Queue name: ' + evt.transfereecontext);

      redisClient.hexists(rConsumerExtensions, Number(evt.origtransfererconnectedlinenum), function (err, reply) {
        if (err) {
          logger.error("Redis Error" + err);
        } else {
          if (reply === 1 && evt.transfereecontext === 'Complaints') {
            // WebRTC call
            logger.info('Received a WebRTC transfer');

            /*
             * Need to send the following:
             *  - new-caller-complaints
             *  - ad-vrs
             *  - ad-zendesk
             *  - chat-leave (Maybe change to call end)
             */

            /*
             * Get the original extension number so we can look up the corresponding VRS.
             */
            var origExtString = evt.origtransfererchannel;
            var origExtension = origExtString.split(/[\/,-]/);

            // Use the origExtension to look up the VRS number.
            redisClient.hget(rExtensionToVrs, Number(evt.origtransfererconnectedlinenum), function (err, vrsNum) {
              if (err) {
                logger.error("Redis Error" + err);
              } else {
                /*
                 * First find the destination channel (who we are transferring to), should look like this:
                 * transfertargetchannel: 'PJSIP/nnnnn-00000031
                 * We only want the nnnnn extension to for a Socket.IO endpoint
                 */
                var destExtString = evt.transfertargetchannel;
                var destExtension = destExtString.split(/[\/,-]/);

                // Tell the CSR portal that a complaints queue call has connected
                io.to(Number(destExtension[1])).emit('new-caller-complaints', evt.context);

                // Calling the lookup with the VRS and extension, we should generate the ad-vrs and ad-zendesk
                // function vrsAndZenLookup(vrsNum, destAgentExtension) {
                vrsAndZenLookup(vrsNum, Number(destExtension[1]));

                io.to(Number(origExtension[1])).emit('chat-leave', {
                  "vrs": vrsNum
                });
              }
            });

          } else if (evt.transfereecontext === 'Provider_General_Questions' || evt.transfereecontext === 'General_Questions') {
            // Zphone #4
            logger.info('Received a Zphone transfer - general questions');

            var destExtension = evt.secondtransfererconnectedlinenum;

            logger.info('destExtension: ' + destExtension);

            io.to(Number(destExtension)).emit('no-ticket-info', {});

            logger.info('Sending no-ticket-info to: ' + destExtension);

            // Tell CSR portal that a complaints queue call has connected
            io.to(Number(destExtension)).emit('new-caller-general', evt.context);
            logger.info('Sending new-caller-general to: ' + destExtension);

            logger.info("Calling vrsAndZenLookup() for: " + evt.origtransfererconnectedlinenum + ',' + destExtension);
            vrsAndZenLookup(evt.origtransfererconnectedlinenum, Number(destExtension));

            io.to(Number(evt.origtransfererconnectedlinenum)).emit('chat-leave', {
              "vrs": evt.origtransfererconnectedlinenum
            });
            logger.info('Sending chat-leave to: ' + evt.origtransfererconnectedlinenum);

            // Need to update the consumerToCsr map so that the chat-leave goes to the right agent
            redisClient.hexists(rConsumerToCsr, Number(evt.origtransfererconnectedlinenum), function (err, reply) {
              if (reply === 1) {
                redisClient.hset(rConsumerToCsr, Number(evt.origtransfererconnectedlinenum), Number(evt.secondtransfererconnectedlinenum));
                logger.info('Inside if(), updating consumerToCsr hash with: ' + evt.origtransfererconnectedlinenum + ' => ' + evt.secondtransfererconnectedlinenum);
              }
            });
          } else if (evt.transfereecontext === 'Provider_Complaints' || evt.transfereecontext === 'Complaints') {
            // Zphone #5

            logger.info('Received a Zphone transfer - provider');

            var destExtension = evt.secondtransfererconnectedlinenum;
            logger.info('destExtension: ' + destExtension);

            io.to(Number(destExtension)).emit('no-ticket-info', {});

            logger.info('Sending no-ticket-info to: ' + destExtension);

            // Tell CSR portal that a complaints queue call has connected
            io.to(Number(destExtension)).emit('new-caller-complaints', evt.context);

            logger.info('Sending new-caller-complaints to: ' + destExtension);

            logger.info("Calling vrsAndZenLookup() for: " + evt.origtransfererconnectedlinenum + ',' + destExtension);
            vrsAndZenLookup(evt.origtransfererconnectedlinenum, Number(destExtension));

            io.to(Number(evt.origtransfererconnectedlinenum)).emit('chat-leave', {
              "vrs": evt.origtransfererconnectedlinenum
            });

            logger.info('Sending chat-leave to: ' + evt.origtransfererconnectedlinenum);

            // Need to update the consumerToCsr map so that the chat-leave goes to the right agent
            redisClient.hexists(rConsumerToCsr, Number(evt.origtransfererconnectedlinenum), function (err, reply) {
              if (reply === 1) {
                redisClient.hset(rConsumerToCsr, Number(evt.origtransfererconnectedlinenum), Number(evt.secondtransfererconnectedlinenum));
                logger.info('Inside if(), updating consumerToCsr hash with: ' + evt.origtransfererconnectedlinenum + ' => ' + evt.secondtransfererconnectedlinenum);
              }
            });
          } else if (evt.transfereecontext === 'Linphone') {
            // Need to see what this means
          } else {
            logger.info('Unable to identify transferred call');
          }

        }
      });

      break;

      // Sent by Asterisk when a phone rings
    case ('Newstate'):
      logger.info('Processing Newstate');
      // channelstate: 5 equals "Ringing"
      if (evt.channelstate === "5") {
        // Format is PJSIP/nnnnn-xxxxxx, we want to strip out the nnnnn only
        var extString = evt.channel;
        var extension = extString.split(/[\/,-]/)[1];
        var callerExt = evt.connectedlinenum;

        redisClient.hget(rExtensionToVrs, Number(callerExt), function (err, phoneNum) {
          if (err) {
            logger.error("Redis Error: " + err);
          } else {
            if (!phoneNum)
              phoneNum = callerExt;
            logger.info("New caller Ringing: to:" + extension + ", from: " + phoneNum);
            io.to(Number(extension)).emit('new-caller-ringing', {
              'phoneNumber': phoneNum
            });

            redisClient.hget(rTokenMap, extension, function (err, tokenMap) {
              if (err) {
                logger.error("Redis Error: " + err);
              } else {
                tokenMap = JSON.parse(tokenMap);
                if (tokenMap !== null && tokenMap.token)
                  redisClient.hset(rTokenMap, tokenMap.token, "INCOMINGCALL");
              }
            });
          }
        });

      }
	  break;

	//sent by asterisk when a caller leaves the queue before they were connected
	case('QueueCallerAbandon'):
		var data = {"position": evt.position, "extension": evt.calleridnum, "queue": evt.queue};
		sendEmit('queue-caller-abandon',data);

		console.log("ABANDONED evt: " +  JSON.stringify(evt, null, 2));

		let ext = evt.calleridnum;
		let vrs;
		redisClient.hget(rExtensionToVrs, Number(ext), function (err, vrsNum) {
			if (!err && vrsNum) {
				logger.info('ABANDONED WebRTC VRS NUMBER ' + vrsNum);
				vrs = vrsNum;

				insertCallDataRecord('Abandoned', vrs);
			}
		});

	break;
	//sent by asterisk when a caller joins the queue
	case('QueueCallerJoin'):
		if(evt.queue === "ComplaintsQueue") complaint_queue_count = evt.count;
		if(evt.queue === "GeneralQuestionsQueue") general_queue_count = evt.count;
		var data = {"position": evt.position, "extension": evt.calleridnum, "queue": evt.queue, "count": evt.count};
		sendEmit('queue-caller-join',data);
		break;
	//sent by aasterisk a caller leaves the queue (either by abandoning or being connected)
	case('QueueCallerLeave'):
		if(evt.queue === "ComplaintsQueue") complaint_queue_count = evt.count;
		if(evt.queue === "GeneralQuestionsQueue") general_queue_count = evt.count;
		var data = {"position": evt.position, "extension": evt.calleridnum,"queue": evt.queue, "count": evt.count};
		sendEmit('queue-caller-leave',data);
		break;

    default:
      logger.warn('AMI unhandled event: ' + evt.event);
      break;
  }
}

/**
 * Instantiate the Asterisk connection.
 * @returns {undefined} Not used
 */
function init_ami() {

	if (ami === null) {

		try {
			ami = new asteriskManager(parseInt(getConfigVal('asterisk:ami:port')),
				getConfigVal('asterisk:sip:private_ip'),
				getConfigVal('asterisk:ami:id'),
				getConfigVal('asterisk:ami:passwd'), true);
			ami.keepConnected();

			// Define event handlers here

      //add only the manager ami events we care about
      //ami.on('managerevent', handle_manager_event);
      ami.on('dialend', handle_manager_event);
      ami.on('varset', handle_manager_event);
      ami.on('hangup', handle_manager_event);
      ami.on('attendedtransfer', handle_manager_event);
      ami.on('newstate', handle_manager_event);
      ami.on('queuecallerabandon',handle_manager_event);
      ami.on('queuecallerjoin',handle_manager_event);
      ami.on('queuecallerleave',handle_manager_event);

      //handle the response
			ami.on('response', handle_action_response);

			logger.info('Connected to Asterisk');

		} catch (exp) {
			logger.error('Init AMI error');
		}
	}
}

/**
 * Initialize the AMI connection.
 */
init_ami();

//polling methods

//for the consumer portal when a customer is waiting in queue and no agents are available (i.e., not AWAY)
setInterval(function () {
  redisClient.hgetall(rAgentInfoMap, function (err, data) {
    if (data) {
      agents_logged_in = false;
      for (var prop in data) {
        if (Object.prototype.hasOwnProperty.call(data, prop)) {
          obj = JSON.parse(data[prop]);
          astatus = obj.status;
          astatus = astatus.toUpperCase();
          if (astatus !== 'AWAY') {
            agents_logged_in = true;
            break;
          }
        }
      }
      sendEmit('agents',{'agents_logged_in': agents_logged_in});
    } else {
      sendEmit('agents',{'agents_logged_in':false});
    }
  });
}, 5000);

setInterval(function () {
  // Keeps connection from Inactivity Timeout
  dbConnection.ping();
}, 60000);

setInterval(function () {
  //query for after hours
  var ohurl = 'https://' + getConfigVal('common:private_ip') + ":" + parseInt(getConfigVal('agent_service:port')) + '/operatinghours';
  request({
    method: 'GET',
      url: ohurl,
      headers: {
        'Content-Type': 'application/json'
      },
      json: true
  }, function (error, response, data) {
    if (error) {
      logger.error("GET operatinghours: " + error);
    } else {
      isOpen = data.isOpen;

      //operating hours
      startTimeUTC = data.start; //hh:mm in UTC
      endTimeUTC = data.end; //hh:mm in UTC

    }
    sendEmit("call-center-closed", {'closed':!isOpen});
  });

}, 5000);

/**
 * Calls the RESTful service running on the provider host to verify the agent
 * username and password.
 *
 * @param {type} username Agent username
 * @param {type} callback Returns retrieved JSON
 * @returns {undefined} Not used
 */
function getUserInfo(username, callback) {
	var url = 'https://' + getConfigVal('common:private_ip') + ":" + parseInt(getConfigVal('agent_service:port')) + '/getagentrec/' + username;
	request({
		url: url,
		json: true
	}, function (error, response, data) {
		if (error) {
			logger.error("login ERROR: " + error);
			data = {
				"message": "failed"
			};
		} else {
			logger.info("Agent Verify: " + data.message);
		}
		callback(data);
	});
}


/**
 * Removes the interface (e.g. SIP/6001) from Asterisk when the agent logs out.
 *
 * @param {type} token Session token for this user.
 * @returns {undefined} N/A
 */
function logout(token) {
	//removes username from statusMap
	if (token.username !== null) {
		redisClient.hdel(rStatusMap, token.username);
		redisClient.hdel(rAgentInfoMap, token.username);
		redisClient.hset(rTokenMap, token.lightcode, "OFFLINE");

		sendAgentStatusList();

		// Note, we need to remove from both queues, same extension.
		if (token.queue_name) {
			logger.info('REMOVING QUEUE: PJSIP/' + token.extension + ', queue name ' + token.queue2_name);

			ami.action({
				"Action": "QueueRemove",
				"Interface": "PJSIP/" + token.extension,
				"Paused": "true",
				"Queue": token.queue_name
			}, function (err, res) {});
		}

		if (token.queue2_name) {
			logger.info('REMOVING QUEUE: PJSIP/' + token.extension + ', queue name ' + token.queue2_name);

			ami.action({
				"Action": "QueueRemove",
				"Interface": "PJSIP/" + token.extension,
				"Paused": "true",
				"Queue": token.queue2_name
			}, function (err, res) {});
		}
	}

}

/**
 * Calls the RESTful service running on the provider host to verify VRS number.
 * Note, this is an emulated VRS check.
 *
 * @param {type} phoneNumber
 * @param {type} callback
 * @returns {undefined}
 */
function getCallerInfo(phoneNumber, callback) {
	var url = 'https://' + getConfigVal('common:private_ip') + ':' + getConfigVal('user_service:port');

	//remove the leading characters and 1 before the VRS number (if it's there)

	phoneNumber = phoneNumber.toString();
	while (phoneNumber.length > 10) {
		phoneNumber = phoneNumber.substring(1);
	}
	url += "/vrsverify/?vrsnum=" + phoneNumber;

	request({
		url: url,
		json: true
	}, function (error, response, data) {
		if (error) {
			logger.error("ERROR: /getAllVrsRecs");
			var data = {
				"message": "failed"
			};
		}
		logger.info("VRS lookup response: " + data.message);
		callback(data);
	});
}

/**
 * Looks in the call_block table of the mysql db to see if VRS number is blocked.  Reason is irrelevant here.
 *
 * @param {type} phoneNumber
 * @param {type} callback
 * @returns {boolean}
 */
function checkIfBlocked(phoneNumber, callback) {
	dbConnection.query('SELECT reason FROM call_block WHERE vrs = ?', phoneNumber, function (err, result) {
		if (err) {
			logger.error('Call block lookup error: '+ err.code);
			callback(true); // default to blocked if there is a DB error
		} else {
			callback(result.length > 0); // true if at least one row with that number, false otherwise
		}
	});

}

/**
 * Makes a REST call to retrieve the script associated with the specified
 * queueName (e.g. InboundQueue) and queueType (e.g. General).
 *
 * @param {type} queueName Name of the queue.
 * @param {type} queueType Type of queue.
 * @param {type} callback
 * @returns {undefined} N/A
 */
function getScriptInfo(queueName, queueType, callback) {
	var url = 'https://' + getConfigVal('common:private_ip') + ':' + getConfigVal('agent_service:port');

	if (queueType && queueName) {
		url += '/getscript/?queue_name=' + queueType + '&type=' + queueName;

		request({
			url: url,
			json: true
		}, function (error, response, data) {
			if (error) {
				logger.error("ERROR: from /getscript/");
				data = {
					"message": "failed"
				};
			} else {
				logger.info("Script lookup response: " + data.message + JSON.stringify(data.data[0]));
			}
		});

	}
}

/**
 * Do the following here:
 * 1. Lookup and verify VRS number, retrieve VRS data
 * 2. Create Zendesk ticket, retrieve ID
 * 3. Send VRS data and Zendesk ticket ID back to consumer
 *
 * @param {type} data JSON data coming from consumer
 * @returns {undefined}
 */
function processConsumerRequest(data) {
	var resultJson = {};

	logger.info('processConsumerRequest - incoming ' + JSON.stringify(data));

	// Do the VRS lookup first
	getCallerInfo(data.vrs, function (vrsinfo) {

		if (vrsinfo.message === 'success') {



			logger.info('Config lookup:');
			logger.info('queuesComplaintNumber: ' + queuesComplaintNumber);

			logger.info('VRS contents: ' + JSON.stringify(vrsinfo));

			/*
			 * If we get here, we have a valid VRS lookup. Extract the
			 * data to send back to the consumer portal. Note, the data.*
			 * fields are coming from the initial request while the vrsinfo.*
			 * fields are coming from the VRS lookup. We're merging the
			 * two sources here.
			 */
			var ticketId = 0;

			var ticket = {
				"ticket": {
					"subject": data.subject,
					"description": data.description,
					"requester": {
						"name": vrsinfo.data[0].first_name,
						"email": vrsinfo.data[0].email,
						"phone": data.vrs,
						"user_fields": {
							"last_name": vrsinfo.data[0].last_name
						}
					}
				}
			};

			logger.info('Populated ticket: ' + JSON.stringify(ticket));

			// Create a Zendesk ticket
			zendeskClient.tickets.create(ticket, function (err, req, result) {
				if (err) {
					logger.error('Zendesk create ticket failure');
					return handleError(err);
				}

				logger.info(JSON.stringify(result, null, 2, true));
				logger.info('Ticket ID: ' + result.id);

				ticketId = result.id;

				resultJson = {
					"message": vrsinfo.message,
					"vrs": vrsinfo.data[0].vrs,
					"username": vrsinfo.data[0].username,
					"first_name": vrsinfo.data[0].first_name,
					"last_name": vrsinfo.data[0].last_name,
					"address": vrsinfo.data[0].address,
					"city": vrsinfo.data[0].city,
					"state": vrsinfo.data[0].state,
					"zip_code": vrsinfo.data[0].zip_code,
					"email": vrsinfo.data[0].email,
					"zendesk_ticket": ticketId,
					"subject": data.subject,
					"description": data.description,
					"queues_complaint_number": queuesComplaintNumber
				};

				logger.info('vrsToZenId map addition: ' + data.vrs + ' => ' + ticketId);
				logger.info('EMIT: ad-ticket-created: ' + JSON.stringify(resultJson));

				redisClient.hset(rVrsToZenId, vrsinfo.data[0].vrs, ticketId);

				io.to(Number(vrsinfo.data[0].vrs)).emit('ad-ticket-created', resultJson);
			});
		} else {
			logger.warn('Consumer portal VRS lookup failed');

			// Send this back to the portal via Socket.IO
			resultJson = {
				"message": "failure"
			};

			io.to('my room').emit('ad-ticket-created', resultJson);
			logger.info('EMIT: ad-ticket-created: ' + resultJson);
		}
	});
}

/**
 * Update an existing Zendesk ticket.
 *
 * @param {type} data Ticket data
 * @returns {undefined} N/A
 */
function updateZendeskTicket(data) {
	var ticketId = data.ticketId;

	var ticket = {
		"ticket": {
			"subject": data.subject,
			"description": data.description,
			"requester": {
				"name": data.name,
				"email": data.email,
				"phone": data.phone,
				"user_fields": {
					"last_name": data.last_name
				}
			},
			"status": data.status,
			"comment": data.comment,
			"resolution": data.resolution
		}
	};

	logger.info('\n****** Zendesk update in ticket: ' + JSON.stringify(ticket));
	logger.info('\n****** Zendesk update in data: ' + JSON.stringify(data));

	// Update a Zendesk ticket
	zendeskClient.tickets.update(ticketId, ticket, function (err, req, result) {
		if (err) {
			logger.error('***** Zendesk update ticket failure');
			return handleError(err);
		}

		logger.info('***** Zendesk update results: ' + JSON.stringify(result));

		logger.info('EMIT: ad-zendesk-update-success: ');
		io.to(Number(data.destexten)).emit('ad-zendesk-update-success', result);
	});
}

/**
 * Do the following here:
 * 1. Lookup next available JsSIP extension
 * 2. Send extension and password back to consumer for registration
 *
 * @param {type} data JSON data coming from consumer with vrs number
 * @returns {undefined}
 */
function processExtension(data) {
	var resultJson = {};

	logger.info('processExtension - incoming ' + JSON.stringify(data));
	console.log('processExtension - incoming ' + JSON.stringify(data));

	var asteriskPublicHostname = getConfigVal('asterisk:sip:public');
	var stunServer = getConfigVal('asterisk:sip:stun') + ":" + getConfigVal('asterisk:sip:stun_port');

	//if wsPort is "", then it defaults to no port in the wss url
	var wsPort = getConfigVal('asterisk:sip:ws_port');
	if (wsPort !== "") {
		wsPort = parseInt(wsPort);
	}

        //get SIP proxy config vars
        var ps_proto = getConfigVal('proxy_server:proto');
        var ps_public = getConfigVal('proxy_server:public');
        var ps_port = getConfigVal('proxy_server:port');
        var ps_path = getConfigVal('proxy_server:path');

	var queuesVideomailNumber = getConfigVal('asterisk:queues:videomail:number');
	var queuesVideomailMaxrecordsecs = getConfigVal('videomail:max_record_secs');

	logger.info('Config lookup:');
	logger.info('asteriskPublicHostname: ' + asteriskPublicHostname);
	logger.info('stunServer: ' + stunServer);
	logger.info('wsPort: ' + wsPort);
	logger.info('queuesComplaintNumber: ' + queuesComplaintNumber);
	logger.info('queuesVideomailNumber: ' + queuesVideomailNumber);

	try {
		findNextAvailableExtension(function (nextExtension) {
			findExtensionPassword(nextExtension, function (extensionPassword) {
				if(nextExtension == 0) {
					resultJson = {'message':'OutOfExtensions'};
				} else {
					resultJson = {
						"message":"success",
						"vrs": data.vrs,
						"extension": nextExtension,
                                                "ps_proto": ps_proto,
                                                "ps_public": ps_public,
                                                "ps_port": ps_port,
                                                "ps_path": ps_path,
						"asterisk_public_hostname": asteriskPublicHostname,
						"stun_server": stunServer,
						"ws_port": wsPort,
						"password": extensionPassword,
						"signaling_server_public": signalingServerPublic,
						"signaling_server_port": signalingServerPort,
						"signaling_server_proto": signalingServerProto,
						"signaling_server_dev_url": signalingServerDevUrl,
					        "privacy_video_url": privacy_video_url,
						"queues_complaint_number": queuesComplaintNumber,
						"queues_videomail_number": queuesVideomailNumber,
						"queues_videomail_maxrecordsecs": queuesVideomailMaxrecordsecs,
						"complaint_redirect_active": complaintRedirectActive,
						"complaint_redirect_desc": complaintRedirectDesc,
						"complaint_redirect_url": complaintRedirectUrl
					};

					logger.info('Extension to VRS Mapping: ' + nextExtension + ' => ' + data.vrs);

					redisClient.hset(rExtensionToVrs, Number(nextExtension), Number(data.vrs));
					redisClient.hset(rExtensionToVrs, Number(data.vrs), Number(nextExtension));
					if (data.language) {
						redisClient.hset(rExtensionToLanguage, Number(nextExtension), data.language);
					}
					else {
						logger.error("Language has not been specified for extension", Number(nextExtension));
					}

				}

				logger.info('EMIT: extension-created: ' + JSON.stringify(resultJson));
				io.to(Number(data.vrs)).emit('extension-created', resultJson);
			});
		});
	} catch (err) {
		logger.warn('Extension registration failed');
		// Send this back to the portal via Socket.IO
		resultJson = {
			"message": "failure"
		};

		io.to(Number(data.vrs)).emit('extension-created', resultJson);
		logger.info('EMIT: extension-created: ' + resultJson);
	}
}
/**
 *
 * @param {string} filter
 * @returns {boolean} filter formatted for mysql query
 */
function processFilter(filter) {
	if (filter === 'ALL') {
		return (false);
	} else {
		return ("'" + filter + "'");
	}
}

/**
 *
 * @param {type} err
 * @returns {undefined}
 */
function handleError(err) {
	console.log(err);
	process.exit(-1);
}

/**
 * Loads a new config file color config file into memory.
 *
 * @returns {undefined}
 */
function loadColorConfigs() {
	var colorfile = '../dat/color_config.json';
	try {
		var content = fs.readFileSync(colorfile, 'utf8');
		myjson = JSON.parse(content);
		colorConfigs = myjson.statuses;
		sendEmit("lightcode-configs", colorConfigs);
	} catch (ex) {
		logger.error("Error in " + colorfile);
	}
}

/**
 * sends an emit message for all connections.
 *
 * @returns {undefined}
 */
function sendEmit(evt, message) {
	try {
		io.sockets.emit(evt, message);
	} catch (exp) {
		logger.error('Socket io emit error ');
	}
}

/**
 * Populates the consumerExtensions hash map with a range of valid extensions.
 *
 * @returns {undefined} N/A
 */
function prepareExtensions() {
  var start_extension = getConfigVal('asterisk:extensions:start_number');
  var end_extension = getConfigVal('asterisk:extensions:end_number');
  var secret = getConfigVal('asterisk:extensions:secret');
  logger.info('Extensions start: ' + start_extension + " end: " + end_extension);
  for (var num = parseInt(start_extension); num <= parseInt(end_extension); num++) {
    var data = {
      "secret": secret,
      "inuse": false
    };
    redisClient.hset(rConsumerExtensions, Number(num), JSON.stringify(data));
  }
}

/**
 * Checks the consumerExtensions map and returns the next extension in the hash
 * map that isn't in use.
 *
 * @returns {Number} Next available extension.
 */
function findNextAvailableExtension(callback) {
	var nextExtension = 0;
	redisClient.hgetall(rConsumerExtensions, function (err, reply) {
		if (err) {
			logger.error("Redis Error" + err);
		} else if (reply) {
			for (var id in reply) {
				logger.info(id + ' => ' + reply[id]);
				var val = JSON.parse(reply[id]);
				if (val.inuse === false) {
					logger.info('Found an open extension in consumerExtensions: ' + id);
					val.inuse = true;
					redisClient.hset(rConsumerExtensions, Number(id), JSON.stringify(val));
					nextExtension = id;
					break;
				}
			}
		}
		return callback(nextExtension);
	});
}

/**
 * Returns the Asterisk password from the consumerExtensions hash for the given extension.
 *
 * @param {Number} extension Incoming consumer extension number.
 * @returns {String} Asterisk password assigned to this extension.
 */
function findExtensionPassword(extension, callback) {

	var password = 'unknown';

	logger.info('Entering findExtensionPassword() for extension: ' + extension);

	redisClient.hget(rConsumerExtensions, Number(extension), function (err, reply) {
		if (err) {
			logger.error("Redis Error" + err);
		} else if (reply) {
			logger.info('Found a match in the consumerExtensions map');
			var json = JSON.parse(reply);
			password = json.secret;
			logger.info('Found a match in the consumerExtensions map with password: ' + password);
		}
		return callback(password);
	});
}

/**
 * Perform VRS lookup and Zendesk ticket creation.
 *
 * @param {type} vrsNum Incoming VRS number.
 * @param {type} destAgentExtension Extension of the agent supporting this call.
 * @returns {undefined}
 */
function vrsAndZenLookup(vrsNum, destAgentExtension) {

	logger.info('Performing VRS lookup for number: ' + vrsNum + ' to agent ' + destAgentExtension);
	console.log('Performing VRS lookup for number: ' + vrsNum + ' to agent ' + destAgentExtension);

	if (vrsNum) {
		logger.info('Performing VRS lookup for number: ' + vrsNum + ' to agent ' + destAgentExtension);
		incomingVRS=vrsNum; //for file share
		// Do the VRS lookup
		getCallerInfo(vrsNum, function (vrsinfo) {

			logger.info('vrsinfo: ' + JSON.stringify(vrsinfo));

			if (vrsinfo.message === 'success') {

				logger.info('#### EMIT to room ' + destAgentExtension);
				logger.info('VRS lookup success');
				logger.info('#### EMIT VRS contents: ' + JSON.stringify(vrsinfo));

				// EMIT HERE ad-vrs
				io.to(Number(destAgentExtension)).emit('ad-vrs', vrsinfo);
			} else if (vrsinfo.message === 'vrs number not found') {

				logger.info('#### EMIT missing-vrs');
				io.to(Number(destAgentExtension)).emit('missing-vrs', vrsinfo);
			}
		});
	} else if (vrsNum === 0 || vrsNum === null) {
		logger.info('#### EMIT missing-vrs - blank case');
		io.to(Number(destAgentExtension)).emit('missing-vrs', {
			"message": "vrs number not found"
		});
	} else {
		logger.error('Could not find VRS in vrsAndZenLookup()');
	}

	redisClient.hget(rVrsToZenId, vrsNum, function (err, zenTicketId) {
		if (zenTicketId) {
			logger.info('Performing Zendesk ticket lookup for ticket: ' + zenTicketId);

			zendeskClient.tickets.show(zenTicketId, function (err, statusList, body, responseList, resultList) {
				var resultJson = {
					"message": "failure"
				};
				if (err) {
					logger.error('##### Zendesk error: ' + err);
				} else {
					logger.info('zendeskLookup() result: ' + JSON.stringify(body, null, 2, true));
					resultJson = body;
				}

				// emit here
				// EMIT HERE ad-zendesk
				logger.info('#### EMIT to room: ' + destAgentExtension);
				logger.info('#### EMIT Zendesk show resultJson: ' + JSON.stringify(resultJson));
				io.to(Number(destAgentExtension)).emit('ad-zendesk', resultJson);
			});
		} else {
			logger.error('Could not find Zendesk ticket ID in vrsAndZenLookup()');
		}
	});
}

function setInitialLoginAsteriskConfigs(user) {


	logger.info("queue_name: " + user.queue_name);
	logger.info("queue2_name: " + user.queue2_name);

	var interfaceName = 'PJSIP/' + user.extension;
	var queueList = {
		"queue_name": user.queue_name,
		"queue2_name": user.queue2_name
	};

	//Keep agent info in memory for agent status calls.
	var agentInfo = {
		"status": "Away",
		"username": user.username,
		"name": user.first_name + " " + user.last_name,
		"extension": user.extension,
		"queues": []
	};
	if (queueList.queue_name) {
		agentInfo["queues"].push({
			"queuename": queueList.queue_name
		});
	}
	if (queueList.queue2_name) {
		agentInfo["queues"].push({
			"queuename": queueList.queue2_name
		});
	}
	redisClient.hset(rAgentInfoMap, user.username, JSON.stringify(agentInfo));
	sendAgentStatusList(user.username, "AWAY");

}

/**
 * Function to decode the Base64 configuration file parameters.
 * @param {type} encodedString Base64 encoded string.
 * @returns {unresolved} Decoded readable string.
 */
function decodeBase64(encodedString) {
	var decodedString = null;
	if (clearText) {
		decodedString = encodedString;
	} else {
		decodedString = Buffer.alloc(encodedString.length, encodedString, 'base64');
	}
	return (decodedString.toString());
}

/**
 * Function to verify the config parameter name and
 * decode it from Base64 (if necessary).
 * @param {type} param_name of the config parameter
 * @returns {unresolved} Decoded readable string.
 */
function getConfigVal(param_name) {
  var val = nconf.get(param_name);
  var decodedString = null;
  if (typeof val !== 'undefined' && val !== null) {
    //found value for param_name
    if (clearText) {
      decodedString = val;
    } else {
      decodedString = Buffer.alloc(val.length, val, 'base64');
    }
  } else {
    //did not find value for param_name
    logger.error('');
    logger.error('*******************************************************');
    logger.error('ERROR!!! Config parameter is missing: ' + param_name);
    logger.error('*******************************************************');
    logger.error('');
    decodedString = "";
  }
  return (decodedString.toString());
}

//Used for getting all agents for multi-party dropdown
//Load available agents for multi-party
//Need common_private_ip and agent_service_port
function getAgentsFromProvider(callback){
	var url = 'https://' + getConfigVal(COMMON_PRIVATE_IP) + ":" + parseInt(getConfigVal(AGENT_SERVICE_PORT)) + "/getallagentrecs";
	request({
		url: url,
		json: true
	}, function (err, res, data){
		if(err) {
			data = {
				"message": "failed"
			};
		} else {
			console.log(JSON.stringify(data));
			callback(data);
		}
	});
}

function createToken() {
	//should Check for duplicate tokens
	return randomstring.generate({
		length: 12,
		charset: 'alphabetic'
	});
}

var ctoken = jwt.sign({
	tokenname: "servertoken"
}, Buffer.alloc(jwtKey.length, jwtKey , jwtEnc  ));

// Allow cross-origin requests to be received from Management Portal
// Used for the force logout functionality since we need to send a POST request from MP to acedirect outlining what user(s) to forcefully logout
app.use(function (err, req, res, next) {
	let mp = 'https://' + getConfigVal("common:private_ip") + ':' + getConfigVal("management_portal:https_listen_port");
	res.setHeader('Access-Control-Allow-Origin', mp);
	next();
});

app.use(function (err, req, res, next) {
	if (err.code !== 'EBADCSRFTOKEN') return next(err);
	// handle CSRF token errors here
	res.status(200).json({
		"message": "Form has been tampered"
	});
});

/**
 * Handles the forceful logout request from Management Portal
 */
app.post('/forcelogout', function (req, res) {
	let body = req.body;
	let agents = body.agents;
	let forceLogoutPassword = req.headers.force_logout_password;
	// Check that the received force logout password matches the one we have in the config
	// This verifies that the request is being made internally and is a valid request
	if (forceLogoutPassword === getConfigVal('management_portal:force_logout_password')){
		// Loop through all of the agents and log them out one by one
		agents.forEach(function(agent){
			// Emit the forceful logout event to each agent by extension
			io.to(Number(agent.extension)).emit('force-logout');
		});
	}
});

/**
 * Checks to see if the number is blocked and, if it is not blocked, calls the RESTful service to verify the VRS number.
 * If it is blocked, return 401 and send the FCC URL for the front end to redirect to.
 */
app.post('/consumer_login', function (req, res) {
	// All responses will be JSON sets response header.
	res.setHeader('Content-Type', 'application/json');
	var vrsnum = req.body.vrsnumber;
	if (/^\d+$/.test(vrsnum)) {
		checkIfBlocked(vrsnum, function(isBlocked) {
			if (isBlocked) {
				res.status(401).json({'message': 'Number blocked', 'redirectUrl': complaintRedirectUrl});
			}
			else {
				getCallerInfo(vrsnum, function (vrs) {
					if (vrs.message === 'success') {
						req.session.role = "VRS";
						req.session.vrs = vrs.data[0].vrs;
						req.session.first_name = vrs.data[0].first_name;
						req.session.last_name = vrs.data[0].last_name;
						req.session.email = vrs.data[0].email;
						res.status(200).json({
							"message": "success"
						});
					} else {
						res.status(200).json(vrs);
					}

				});
			}
		});
	} else {
		res.status(200).json({
			"message": "Error: Phone number format incorrect"
		});
	}
});

app.use(function (req, res, next) {
        res.locals = {
                "nginxPath":nginxPath,
                "busyLightEnabled":busyLightEnabled,
                "awayBlink":awayBlink,
                "outVidTimeout":outVidTimeout,
                "stunFQDN":stunFQDN,
                "stunPort":stunPort,
                "turnFQDN":turnFQDN,
                "turnPort":turnPort,
                "turnUser":turnUser,
                "turnCred":turnCred
        };
        next();
});

/**
 * Handles all GET request to server
 * determines if user can procede or
 * before openam cookie shield is enforced
 */


//Redirects / to /Complaint
app.get('/', function (req, res, next) {
	res.redirect('fcc');
});

//redirects to the fcc mockup page
app.get('/fcc', function(req,res,next){
	res.render('pages/fcc_mockup');

});

/**
 * Handles a GET request for /Compaint. Checks user has
 * a valid session and displays page.
 *
 * @param {string} '/Complaint'
 * @param {function} function(req, res)
 */
app.get(consumerPath, function (req, res, next) {


	if (req.session.role === 'VRS') {
		res.render('pages/complaint_form');
	} else {
		res.render('pages/complaint_login', {
			csrfToken: req.csrfToken()
		});
	}
});

/**
 * Handles a GET request for /logout.
 * Destroys Cookies and Sessions for OpenAM and ACEDirect
 *
 * @param {string} '/logout'
 * @param {function} function(req, res)
 */

app.get('/logout', function (req, res) {
	request({
		method: 'POST',
		url: 'https://' + getConfigVal('nginx:private_ip') + ':' + getConfigVal('nginx:port') + '/' + getConfigVal('openam:path') + '/json/sessions/?_action-logout',
		headers: {
			'host': url.parse('https://' + getConfigVal('nginx:fqdn')).hostname,
			'iplanetDirectoryPro': req.session.key,
			'Content-Type': 'application/json'
		}
	}, function (error, response, data) {
		if (error) {
			logger.error("logout ERROR: " + error);
		} else {
            var domaintemp = getConfigVal('nginx:fqdn');
            var n1 = domaintemp.indexOf(".");
			res.cookie('iPlanetDirectoryPro', 'cookievalue', {
				maxAge: 0,
				domain: domaintemp.substring(n1+1),
				path: "/",
				value: ""
			});
			req.session.destroy(function (err) {
				if (err) {
					logger.error("logout session destroy error: " + err);
				}
				res.redirect(req.get('referer'));
			});
		}
	});
});

/**
 * Handles a GET request for token and returnes a valid JWT token
 * for Manager's with a valid session.
 *
 * @param {string} '/token'
 * @param {function} function(req, res)
 */
app.get('/token', function (req, res) {
	if (req.session.role === 'VRS') {
		res.setHeader('Content-Type', 'application/json');
		var vrsnum = req.session.vrs;
		if (/^\d+$/.test(vrsnum)) {
			getCallerInfo(vrsnum, function (vrs) {
				if (vrs.message === 'success') {

                    //add isOpen flag; notifies Consumers who try to connect after hours
                    vrs.data[0].isOpen = isOpen;

                    //add start/end time; operating hours
                    vrs.data[0].startTimeUTC = startTimeUTC; //hh:mm in UTC
                    vrs.data[0].endTimeUTC = endTimeUTC; //hh:mm in UTC

					var token = jwt.sign(vrs.data[0], Buffer.alloc(jwtKey.length, jwtKey , jwtEnc  ), {
						expiresIn: "2000"
					});
					res.status(200).json({
						message: "success",
						token: token
					});
				} else {
					res.status(200).json(vrs);
				}
			});
		} else {
			res.status(200).json({
				"message": "Error: Phone number format incorrect"
			});
		}
	} else if (req.session.role === 'AD Agent') {
		var payload = {};
		payload.agent_id = req.session.agent_id;
		payload.username = req.session.username;
		payload.first_name = req.session.first_name;
		payload.last_name = req.session.last_name;
		payload.role = req.session.role;
		payload.email = req.session.email;
		payload.phone = req.session.phone;
		payload.organization = req.session.organization;
		payload.queue_name = req.session.queue_name;
		payload.queue2_name = req.session.queue2_name;
		payload.extension = req.session.extension;
		payload.layout = req.session.layout;
		payload.lightcode = req.session.lightcode;
		payload.asteriskPublicHostname = req.session.asteriskPublicHostname;
		payload.stunServer = req.session.stunServer;
		payload.wsPort = req.session.wsPort;
		payload.signalingServerPublic = req.session.signalingServerPublic;
		payload.signalingServerPort = req.session.signalingServerPort;
		payload.signalingServerProto= req.session.signalingServerProto;
		payload.signalingServerDevUrl = req.session.signalingServerDevUrl;
                payload.privacy_video_url = privacy_video_url;
		payload.queuesComplaintNumber = req.session.queuesComplaintNumber;
		payload.extensionPassword = req.session.extensionPassword;
		payload.complaint_queue_count = complaint_queue_count;
		payload.general_queue_count = general_queue_count;

		var queueList = {
			"queue_name": payload.queue_name,
			"queue2_name": payload.queue2_name
		};
		var agentInfo = {
			"status": "Away",
			"username": payload.username,
			"name": payload.first_name + " " + payload.last_name,
			"extension": payload.extension,
			"queues": []
		};
		if (queueList.queue_name) {
			agentInfo["queues"].push({
				"queuename": queueList.queue_name
			});
		}
		if (queueList.queue2_name) {
			agentInfo["queues"].push({
				"queuename": queueList.queue2_name
			});
		}
		redisClient.hset(rAgentInfoMap, payload.username, JSON.stringify(agentInfo));
		sendAgentStatusList(payload.username, "AWAY");

		var token = jwt.sign(payload, Buffer.alloc(jwtKey.length, jwtKey  , jwtEnc  ), {
			expiresIn: "2000"
		});
		res.status(200).json({
			message: "success",
			token: token
		});

	} else {
		req.session.destroy(function (err) {
			res.redirect('');
		});
	}
});

/* NGINX location redirect for forcing
 * openam-agent to include NGINX path in parameters.
 *
 * @param {string} '/ACEDirect*'
 * @param {function} 'agent.shield(cookieShield)'
 * @param {function} function(req, res)
 */
app.get(nginxPath+'*', agent.shield(cookieShield), function (req, res) {
	res.redirect(nginxPath+agentPath);
});


/**
 * Handles a GET request for /Agent prior to OpenAM Cookie Shield.
 * @param {string} '/Agent'
 * @param {function} function(req, res, next)
 */

app.get(agentPath, function (req, res, next) {
	if (req.session.data) {
		if (req.session.data.uid) {
			return next(); //user is logged in go to next()
		}
	}
	res.redirect('.' + nginxPath + agentPath);
});

/**
 * Handles a GET request for /agent. Checks user has
 * a valid session and displays page.
 *
 * @param {string} '/agent'
 * @param {function} 'agent.shield(cookieShield)'
 * @param {function} function(req, res)
 */
app.get(agentPath, agent.shield(cookieShield), function (req, res) {
	if (req.session.role === 'AD Agent') {
		res.render('pages/agent_home');
	} else {
		res.redirect('./login');
	}
});

/**
 * Handles a GET request for /login prior to OpenAM Cookie Shield.
 * @param {string} '/login'
 * @param {function} function(req, res, next)
 */

app.get('/login', function (req, res, next) {
	if (req.session.data) {
		if (req.session.data.uid) {
			return next(); //user is logged in go to next()
		}
	}
	res.redirect('.' + nginxPath + agentPath);
});

/**
 * Handles a get request for login. Creates
 * valid session for authenticated users.
 *
 * @param {string} '/login'
 * @param {function} 'agent.shield(cookieShield)'
 * @param {function} function(req, res)
 */
app.get('/login', agent.shield(cookieShield), function (req, res) {
	var username = req.session.data.uid;
	getUserInfo(username, function (user) {
		if (user.message === "success") {
			redisClient.hget(rStatusMap, user.data[0].username, function (err, status) {
				if (status !== null) {
					res.render('pages/agent_duplicate_login', {
						'user': user.data[0].username
					});
				} else if (user.data[0].role === "ACL Agent") {
					res.redirect(complaintRedirectUrl);
				} else if (user.data[0].role === "Manager") {
					logger.info("Manager");
					req.session.id = user.data[0].agent_id;
					req.session.role = user.data[0].role;
					res.redirect('/ManagementPortal');
				} else if (user.data[0].role === "AD Agent") {
					redisClient.hget(rTokenMap, user.data[0].extension, function (err, tokenMap) {
						tokenMap = JSON.parse(tokenMap);
						var d = new Date();
						var now = d.getTime();
						//Delete Token if its older than 24 hours
						if (tokenMap !== null && now > (tokenMap.date + 86400000)) {
							redisClient.hdel(rTokenMap, tokenMap.token);
							tokenMap = {};
						}
						//Create new token if token didn't exist or expired
						if (tokenMap === null || Object.keys(tokenMap).length === 0) {
							var token = createToken();
							tokenMap = {
								"token": token,
								"date": now
							};
							redisClient.hset(rTokenMap, user.data[0].extension, JSON.stringify(tokenMap));

						}
						var asteriskPublicHostname = getConfigVal('asterisk:sip:public');
						var stunServer = getConfigVal('asterisk:sip:stun') + ":" + getConfigVal('asterisk:sip:stun_port');

						var wsPort = getConfigVal('asterisk:sip:ws_port');
						if (wsPort !== "") {
							wsPort = parseInt(wsPort);
						}

						var extensionPassword = getConfigVal('asterisk:extensions:secret');

						redisClient.hset(rTokenMap, tokenMap.token, "AWAY");
						//Adds user to statusMap.
						//Tracks if user is already logged in elsewhere
						redisClient.hset(rStatusMap, user.data[0].username, "AWAY");
						//setInitialLoginAsteriskConfigs(user.data[0]); moved to /agent
						req.session.agent_id = user.data[0].agent_id;
						req.session.username = user.data[0].username;
						req.session.first_name = user.data[0].first_name;
						req.session.last_name = user.data[0].last_name;
						req.session.role = user.data[0].role;
						req.session.email = user.data[0].email;
						req.session.phone = user.data[0].phone;
						req.session.organization = user.data[0].organization;
						req.session.queue_name = user.data[0].queue_name;
						req.session.queue2_name = user.data[0].queue2_name;
						req.session.extension = user.data[0].extension;
						req.session.layout = user.data[0].layout;
						req.session.lightcode = tokenMap.token;
						req.session.asteriskPublicHostname = asteriskPublicHostname;
						req.session.stunServer = stunServer;
						req.session.wsPort = wsPort;
						req.session.signalingServerPublic = signalingServerPublic;
						req.session.signalingServerPort = signalingServerPort;
						req.session.signalingServerProto= signalingServerProto;
						req.session.signalingServerDevUrl= signalingServerDevUrl;
						req.session.privacy_video_url = privacy_video_url;
						req.session.queuesComplaintNumber = queuesComplaintNumber;
						req.session.extensionPassword = extensionPassword;
						req.session.complaint_queue_count = complaint_queue_count;
						req.session.general_queue_count = general_queue_count;
						res.redirect('.' + agentPath);
					});
				} else {
					res.render('pages/agent_account_pending', {
						'user': user.data[0].username
					});
				}
			});
		} else {
			res.render('pages/agent_account_pending', {
				'user': username
			});
		}
	});
});

app.get('/updatelightconfigs', function (req, res) {
	loadColorConfigs();
	res.send('OK');
});

/**
 * Handles a GET request for /getVideoamil to retrieve the videomail file
 * @param {string} '/getVideomail'
 * @param {function} function(req, res)
 */
app.get('/getVideomail', agent.shield(cookieShield),function (req, res) {
	logger.debug("/getVideomail");
	var videoId = req.query.id;
	logger.debug("id: " + videoId);
	var agentExt = req.session.extension;
	//Wrap in mysql query
	dbConnection.query('SELECT video_filepath AS filepath, video_filename AS filename FROM videomail WHERE id = ?', videoId, function (err, result) {
		if (err) {
			logger.error('GET VIDEOMAIL ERROR: '+ err.code);
		} else {
			var videoFile = result[0].filepath + result[0].filename;
			try {
				var stat = fs.statSync(videoFile);
				// Added Accept-Ranges bytes to header so seek bar & setting video.currentTime works in Chrome without always going to time zero.
				res.writeHead(200, {
					'Content-Type': 'video/webm',
					'Content-Length': stat.size,
					'Accept-Ranges': 'bytes'
				});
				var readStream = fs.createReadStream(videoFile);
				readStream.pipe(res);
			} catch (err) {
				io.to(Number(agentExt)).emit('videomail-retrieval-error', videoId);
			}
		}
	});
});

//For fileshare
//TODO Needs middleware for agent and consumer
//Use app,get for cooki to see if auth,  If not kicked
var multer = require('multer');
var upload = multer({dest: 'uploads/'});
app.post('/fileUpload', upload.single('uploadfile'), function(req, res) {

	let uploadedBy = req.session.vrs || ((req.session.role == 'AD Agent') ? req.body.vrs : false);

	//sometimes the consumer doesn't have it's vrs number in req.session
	//also sometimes the req.session doesn't update?? **** This is the issue
	//this is rare and hard to reproduce, but this will catch it when/if it does
	if (uploadedBy == undefined) {
		uploadedBy = req.session.data.valid;
	}

	console.log("Uploaded by " + uploadedBy);
	console.log("SESSION " + JSON.stringify(req.session));


	
	
	if(uploadedBy){
		console.log("Valid agent " + uploadedBy);
		let uploadMetadata = {};

		if (uploadedBy === true) {
			//this means vrs isn't in the req.session
			//this is a weird workaround that finds the vrs
			//by looking at the agent extension and finding the vrs associated with it

			let uploadAgentExt = req.session.extension;

			for (let i = 0; i < sharingAgent.length; i++){
				if (sharingAgent[i] == uploadAgentExt) {
					uploadMetadata.vrs = sharingConsumer[i];
					break;
				}
			}
		} else {
			uploadMetadata.vrs = uploadedBy;
		}
		uploadMetadata.filepath = __dirname + '/' + req.file.path;
		uploadMetadata.originalFilename = req.file.originalname;
		uploadMetadata.filename = req.file.filename;
		// 'encoding' is deprecated — since July 2015
		uploadMetadata.encoding = req.file.encoding;
		uploadMetadata.mimetype = req.file.mimetype;
		uploadMetadata.size = req.file.size;

		ClamScan.then(async clamscan => {
			try {
				console.log('scanning', uploadMetadata.filepath, 'as', require("os").userInfo().username, fs.existsSync(uploadMetadata.filepath));
		 
				// You can re-use the `clamscan` object as many times as you want
				// const version = await clamscan.get_version();
				// console.log(`ClamAV Version: ${version}`);
				
				const {is_infected, file, viruses} = await clamscan.is_infected(uploadMetadata.filepath);
				if (is_infected) {
					console.log(`${req.file.originalname} is infected with ${viruses}!`);
					res.status(400).send("Error scanning file i");
				}
				else {
					console.log(`${req.file.originalname} passed inspection!`);
					request({
						method: 'POST',
						url: 'https://' + getConfigVal('common:private_ip') + ':' + getConfigVal('user_service:port') + '/storeFileInfo',
						headers: {
							'Content-Type': 'application/json'
						},
						body: uploadMetadata,
						json: true
					}, function (error, response, data) {
						if (error) {
							res.status(500).send("Error");
						} else {
							res.status(200).send("Success");
						}
					});
				}
			} catch (err) {
				// Handle any errors raised by the code in the try block
				console.log('Error using Clam AV:', err)
				res.status(400).send("Error scanning file");
			}
		}).catch(err => {
			// Handle errors that may have occurred during initialization
			console.log('Error initializing Clam AV:', err)
			res.status(400).send("Error scanning file");
		});
		
	}else{
		console.log("Not valid agent");
		res.status(403).send("Unauthorized");
	}
});

//Download
app.get('/downloadFile',/*agent.shield(cookieShield) ,*/function(req, res) {

	if (sharingAgent !== undefined && sharingConsumer !== undefined) {
		for (let i = 0; i < sharingAgent.length; i++) {

				//make sure the agent is in a call with the consumer who sent the file
				if (req.session.extension == sharingAgent[i] || req.session.vrs == sharingConsumer[i]){

					console.log('In valid session');

					console.log('Comparing file IDs');
					//console.log(fileToken[i] + " vs " +req.query.id.split('"')[0]);
					if (fileToken[i] == (req.query.id).split('"')[0]) { //remove the filename from the ID if it's there
						console.log('allowed to download');

						let documentID = req.query.id;
						let  url = 'https://' + getConfigVal('common:private_ip') + ':' + getConfigVal('user_service:port');
						url += '/storeFileInfo?documentID=' + documentID;

						request({
							url: url,
							json: true
						}, function (error, response, data) {
							if (error) {
								res.status(500).send("Error");
							} else {
								if(data.message == "Success"){
									let filepath = data.filepath;
									let filename = data.filename;
									var readStream = fs.createReadStream(filepath);
									res.attachment(filename);
									readStream.pipe(res);
								}else{
									res.status(500).send("Error");
								}
							}
						});
						break;
					} else{
						console.log('Not authorized to download this file');
						break;
					}
				} else {
					console.log('Not authorized to download');
				}
		}
	} else {
		console.log('Not authorized to download');
	}
});

app.get('/getagentstatus/:token', function (req, res) {
	var resObj = {
		"status": "Unknown",
		"r": 0,
		"g": 0,
		"b": 0,
		"blink": false,
		"stop": true
	};

	var token = req.params.token;
	if (token) {
		redisClient.hget(rTokenMap, token, function (err, status) {
			if (err) {
				logger.error('ERROR - /getagentstatus: ' + err);
				res.status(501).send(resObj);
			} else if (status !== null) {
				switch (status) {
					case 'AWAY':
						resObj.status = status;
						resObj.r = 255;
						resObj.g = 165;
						resObj.b = 0;
						resObj.blink = false;
						resObj.stop = false;
						break;
					case 'READY':
						resObj.status = status;
						resObj.r = 0;
						resObj.g = 255;
						resObj.b = 0;
						resObj.blink = false;
						resObj.stop = false;
						break;
					case 'INCOMINGCALL':
						resObj.status = status;
						resObj.r = 255;
						resObj.g = 0;
						resObj.b = 0;
						resObj.blink = true;
						resObj.stop = false;
						break;
					case 'INCALL':
						resObj.status = status;
						resObj.r = 255;
						resObj.g = 0;
						resObj.b = 0;
						resObj.blink = false;
						resObj.stop = false;
						break;
					case 'WRAPUP':
						resObj.status = status;
						resObj.r = 0;
						resObj.g = 0;
						resObj.b = 255;
						resObj.blink = false;
						resObj.stop = false;
						break;
					default:
						resObj.status = status;
				}
				res.send(resObj);
			} else {
				res.status(401).send("Invalid");
			}
		});
	} else {
		res.send(resObj);
	}
});

// catch 404 and forward to error handler
app.use(function (req, res, next) {
	var err = new Error('Not Found');
	err.status = 404;
	next(err);
});


// error handler
app.use(function (err, req, res, next) {
	if (err.status === 404) {
		res.status(err.status);
		res.render('pages/404');
	} else {
		// render the error page
		res.status(err.status || 500);
		res.render('pages/error');
	}
});

//do it here, after socket is established
loadColorConfigs();
