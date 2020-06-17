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
var openamAgent = require('openam-agent');
var url = require('url');
var randomstring = require("randomstring");
var csrf = require('csurf');
var cors = require('cors');
var mysql = require('mysql');

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

// Contains the consumer extension(nnnnn) mapped to the VRS number(mmmmmmmmmm)
// Redis will double map these key values meaning both will exist
// key:value nnnnn:mmmmmmmmmm and mmmmmmmmmm:nnnnn
var rExtensionToVrs = 'extensionToVrs';

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
  })

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


// Set log4js level from the config file
logger.level = getConfigVal('common:debug_level'); //log level hierarchy: ALL TRACE DEBUG INFO WARN ERROR FATAL OFF
logger.trace('TRACE messages enabled.');
logger.debug('DEBUG messages enabled.');
logger.info('INFO messages enabled.');
logger.warn('WARN messages enabled.');
logger.error('ERROR messages enabled.');
logger.fatal('FATAL messages enabled.');
logger.info('Using config file: ' + cfile);

//NGINX path parameter
var nginxPath = getConfigVal('nginx:ad_path');
if (nginxPath.length === 0) {
  //default for backwards compatibility
  nginxPath = "/ACEDirect";
}

var queuesVideomailNumber = getConfigVal('asterisk:queues:videomail:number');

//get complaint redirect options
var complaintRedirectActive = (getConfigVal('complaint_redirect:active') === 'true');
var complaintRedirectDesc = getConfigVal('complaint_redirect:desc');
var complaintRedirectUrl = getConfigVal('complaint_redirect:url');

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

	//Delete all values in statusMap
	redisClient.del(rStatusMap);
	redisClient.del(rVrsToZenId);
	redisClient.del(rConsumerExtensions);
	redisClient.del(rExtensionToVrs);
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
var dbConnection = mysql.createConnection({
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

var httpsServer = https.createServer(credentials, app);

//constant to identify provider devices in AMI messages
var PROVIDER_STR = "Provider";

var io = require('socket.io')(httpsServer, {
	cookie: false
}); //path: '/TEST',
io.set('origins', fqdnUrl);

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
	secret: new Buffer(getConfigVal('web_security:json_web_token:secret_key'), getConfigVal('web_security:json_web_token:encoding')),
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

	/*
	 * Handler catches a Socket.IO message to pause both queues. Note, we are
	 * pausing both queues, but, the extension is the same for both.
	 */
	socket.on('pause-queues', function () {

		// Pause the first queue
		if (token.queue_name) {
			logger.info('PAUSING QUEUE: PJSIP/' + token.extension + ', queue name ' + token.queue_name);

			ami.action({
				"Action": "QueuePause",
				"ActionId": "1000",
				"Interface": "PJSIP/" + token.extension,
				"Paused": "true",
				"Queue": token.queue_name,
				"Reason": "QueuePause in pause-queue event handler"
			}, function (err, res) {});
		}

		// Pause the second queue (if not null)
		if (token.queue2_name) {
			logger.info('PAUSING QUEUE: PJSIP/' + token.extension + ', queue name ' + token.queue2_name);

			ami.action({
				"Action": "QueuePause",
				"ActionId": "1000",
				"Interface": "PJSIP/" + token.extension,
				"Paused": "true",
				"Queue": token.queue2_name,
				"Reason": "QueuePause in pause-queue event handler"
			}, function (err, res) {});
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
		logger.info('State: WRAPUP - ' + token.username);
		redisClient.hset(rStatusMap, token.username, "WRAPUP", function (err, res) {
			sendAgentStatusList(token.username, "WRAPUP");
			redisClient.hset(rTokenMap, token.lightcode, "WRAPUP");
		});
	});

	// Sets the agent state to INCALL
	socket.on('incall', function () {
		logger.info('State: INCALL - ' + token.username);
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

			ami.action({
				"Action": "QueuePause",
				"ActionId": "1000",
				"Interface": "PJSIP/" + token.extension,
				"Paused": "false",
				"Queue": token.queue_name,
				"Reason": "QueuePause in pause-queue event handler"
			}, function (err, res) {});
		}

		if (token.queue2_name) {
			logger.info('UNPAUSING QUEUE: PJSIP/' + token.extension + ', queue name ' + token.queue2_name);

			ami.action({
				"Action": "QueuePause",
				"ActionId": "1000",
				"Interface": "PJSIP/" + token.extension,
				"Paused": "false",
				"Queue": token.queue2_name,
				"Reason": "QueuePause in pause-queue event handler"
			}, function (err, res) {});
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
				redisClient.hget(rConsumerExtensions, Number(ext), function (err, reply) {
					if (err) {
						logger.error("Redis Error" + err);
					} else if (reply) {
						var val = JSON.parse(reply);
						val.inuse = false;
						redisClient.hset(rConsumerExtensions, Number(ext), JSON.stringify(val));
						redisClient.hset(rTokenMap, token.lightcode, "OFFLINE");
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
		console.log('entered get-videomail');
		console.log('test');
		var sortBy = data.sortBy;
		var filterFlag = processFilter(data.filter);
		if (filterFlag) {
			if (sortBy.includes('asc')) {
				sortStr = sortBy.slice(0, sortBy.length - 4);
				queryStr = "SELECT id, extension, callbacknumber, recording_agent, processing_agent, DATE_FORMAT(convert_tz(received,@@session.time_zone,'-04:00'), '%a %m/%d/%Y %h:%i %p') as received, processed, video_duration, status, deleted, src_channel, dest_channel, unique_id, video_filename, video_filepath FROM " + vmTable + " WHERE deleted = 0 and status = " + filterFlag + " ORDER BY " + sortStr + " asc";
				console.log(queryStr);
				dbConnection.query(queryStr, function (err, result) {
					if (err) {
						console.log("GET-VIDEOMAIL ERROR: ", err.code);
					} else {
						io.to(Number(data.extension)).emit('got-videomail-recs', result);
					}
				});
			} else if (sortBy.includes('desc')) {
				sortStr = sortBy.slice(0, sortBy.length - 5);
				queryStr = "SELECT id, extension, callbacknumber, recording_agent, processing_agent, DATE_FORMAT(convert_tz(received,@@session.time_zone,'-04:00'), '%a %m/%d/%Y %h:%i %p') as received, processed, video_duration, status, deleted, src_channel, dest_channel, unique_id, video_filename, video_filepath FROM " + vmTable + " WHERE deleted = 0 and status = " + filterFlag + " ORDER BY " + sortStr + " desc";
				console.log(queryStr);
				dbConnection.query(queryStr, function (err, result) {
					if (err) {
						console.log("GET-VIDEOMAIL ERROR: ", err.code);
					} else {
						io.to(Number(data.extension)).emit('got-videomail-recs', result);
					}
				});
			}

		} else {
			if (sortBy.includes('asc')) {
				sortStr = sortBy.slice(0, sortBy.length - 4);
				queryStr = "SELECT id, extension, callbacknumber, recording_agent, processing_agent, DATE_FORMAT(convert_tz(received,@@session.time_zone,'-04:00'), '%a %m/%d/%Y %h:%i %p') as received, processed, video_duration, status, deleted, src_channel, dest_channel, unique_id, video_filename, video_filepath FROM " + vmTable + " WHERE deleted = 0 ORDER BY " + sortStr + " asc";
				console.log(queryStr);
				dbConnection.query(queryStr, function (err, result) {
					if (err) {
						console.log("GET-VIDEOMAIL ERROR: ", err.code);
					} else {
						io.to(Number(data.extension)).emit('got-videomail-recs', result);
					}
				});
			} else if (sortBy.includes('desc')) {
				sortStr = sortBy.slice(0, sortBy.length - 5);
				queryStr = "SELECT id, extension, callbacknumber, recording_agent, processing_agent, DATE_FORMAT(convert_tz(received,@@session.time_zone,'-04:00'), '%a %m/%d/%Y %h:%i %p') as received, processed, video_duration, status, deleted, src_channel, dest_channel, unique_id, video_filename, video_filepath FROM " + vmTable + " WHERE deleted = 0 ORDER BY " + sortStr + " desc";
				console.log(queryStr);
				dbConnection.query(queryStr, function (err, result) {
					if (err) {
						console.log("GET-VIDEOMAIL ERROR: ", err.code);
					} else {
						io.to(Number(data.extension)).emit('got-videomail-recs', result);
					}
				});
			}
		}
		queryStr = "SELECT COUNT(*) AS unreadMail FROM " + vmTable + " WHERE UPPER(status)='UNREAD';";
		dbConnection.query(queryStr, function (err, result) {
			if (err) {
				console.log("COUNT-UNREAD-MAIL ERROR: ", err.code);
			} else {
				console.log(result);
				io.to(Number(data.extension)).emit('got-unread-count', result[0].unreadMail);
			}
		});
		queryStr = "UPDATE " + vmTable + " SET deleted = 1, deleted_time = CURRENT_TIMESTAMP, deleted_by = 'auto_delete' WHERE (UPPER(status)='READ' OR UPPER(status)='CLOSED') AND TIMESTAMPDIFF(DAY, processed, CURRENT_TIMESTAMP) >= 14;";
		dbConnection.query(queryStr, function(err, result) {
			if (err) {
				console.log('DELETE-OLD-VIDEOMAIL ERROR: ', err.code);
			} else {
				console.log('Deleted old videomail');
			}
		});
	});

	//updates videomail records when the agent changes the status
	socket.on("videomail-status-change", function (data) {
		console.log('updating MySQL entry');
		queryStr = "UPDATE " + vmTable + " SET status = '" + data.status + "', processed = CURRENT_TIMESTAMP, processing_agent = " + data.extension + " WHERE id = " + data.id;
		console.log(queryStr);
		dbConnection.query(queryStr, function (err, result) {
			if (err) {
				console.log('VIDEOMAIL-STATUS-CHANGE ERROR: ', err.code);
			} else {
				console.log(result);
				io.to(Number(data.extension)).emit('changed-status', result);
			}
		});
	});
	//changes the videomail status to READ if it was UNREAD before
	socket.on("videomail-read-onclick", function (data) {
		console.log('updating MySQL entry');
		queryStr = "UPDATE " + vmTable + " SET status = 'READ', processed = CURRENT_TIMESTAMP, processing_agent = " + data.extension + " WHERE id = " + data.id;
		console.log(queryStr);
		dbConnection.query(queryStr, function (err, result) {
			if (err) {
				console.log('VIDEOMAIL-READ ERROR: ', err.code);
			} else {
				console.log(result);
				io.to(Number(data.extension)).emit('changed-status', result);
			}
		});
	});
	//updates videomail records when the agent deletes the videomail. Keeps it in db but with a deleted flag
	socket.on("videomail-deleted", function (data) {
		console.log('updating MySQL entry');
		queryStr = "UPDATE " + vmTable + " SET deleted_time = CURRENT_TIMESTAMP, deleted_by = " + data.extension + ", deleted = 1 WHERE id = " + data.id;
		dbConnection.query(queryStr, function (err, result) {
			if (err) {
				console.log('VIDEOMAIL-DELETE ERROR: ', err.code);
			} else {
				console.log(result);
				io.to(Number(data.extension)).emit('changed-status', result);
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

  logger.info('\n######################################');
  logger.info('Received an AMI event: ' + evt.event);
  logger.info(util.inspect(evt, false, null));

  switch (evt.event) {

    // Sent by Asterisk when the call is answered
    case ('DialEnd'):

      // Make sure this is an ANSWER event only
      if (evt.dialstatus === 'ANSWER') {

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
        if (evt.context === 'Complaints' || evt.context === 'Provider_Complaints') {
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
          }

          redisClient.hget(rExtensionToVrs, Number(extension[1]), function (err, vrsNum) {
            if (!err && vrsNum) {
              // Call new function
              logger.info('Calling vrsAndZenLookup with ' + vrsNum + ' and ' + destExtension[1]);

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

          }
        }
      }

      break;

      // Sent by Asterisk when the caller hangs up
    case ('Hangup'):

      var extString = evt.channel;
      var extension = extString.split(/[\/,-]/);

      if (evt.context === 'Complaints' && extension[1].indexOf(PROVIDER_STR) === -1) {
        // Consumer portal ONLY! Zphone Complaint queue calls will go to the next if clause
        logger.info('Processing Hangup from a Complaints queue call');

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
      } else if (evt.context === 'Provider_General_Questions' || evt.context === 'General_Questions' || evt.context === 'Provider_Complaints' || evt.context === 'Complaints') {
        // Zphone option #4 or 5

        var linphoneString = evt.channel;
        var linphoneExtension = linphoneString.split(/[\/,-]/);

        logger.info('Processing Hangup for a Provider_General_Questions queue call');
        logger.info('Linphone extension number: ' + linphoneExtension[1]);

        var agentExtension = 0;

        redisClient.hget(rLinphoneToAgentMap, Number(linphoneExtension[1]), function (err, agentExtension) {
          if (agentExtension !== null) {
            logger.info('if - sending chat leave to agent extension: ' + agentExtension + ', ' + evt.calleridnum);
            io.to(Number(agentExtension)).emit('chat-leave', {
              "extension": agentExtension,
              "vrs": evt.calleridnum
            });
            // Remove the entry
            redisClient.hdel(rLinphoneToAgentMap, Number(linphoneExtension[1]));
          } else {
            redisClient.hget(rConsumerToCsr, Number(evt.calleridnum), function (err, agentExtension) {
              logger.info('consumerToCsr else if()');
              logger.info('agentExtension: ' + agentExtension);
              logger.info('if - else sending chat leave to agent extension: ' + agentExtension + ', ' + evt.calleridnum);

              io.to(Number(agentExtension)).emit('chat-leave', {
                "extension": agentExtension,
                "vrs": evt.calleridnum
              });
              //Remove rConsumerToCsr redis map on hangups.
              redisClient.hdel(rConsumerToCsr, Number(evt.calleridnum));
            });
          }
        });
      } else if (evt.context === 'from-internal' && evt.connectedlinenum === queuesVideomailNumber) {
        logger.info('Processing Hangup from a WebRTC Videomail call (Consumer hangup)');

        logger.info('VIDEOMAIL Hangup extension number: ' + evt.calleridnum);

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

            /**
            logger.info('Sending chat-leave for socket id ' + vrsNum);
            io.to(Number(vrsNum)).emit('chat-leave', {
              "vrs": vrsNum
            });
            **/

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

          //this agent(agentExtension) must now go to away status
          io.to(Number(agentExtension)).emit('new-missed-call', {}); //should send missed call number
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
      ami.on('dialend', handle_manager_event);
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
setInterval(function () {
  // Keeps connection from Inactivity Timeout
  dbConnection.ping();
}, 60000);

setInterval(function () {
  //query for after hours
  logger.info('GET operatinghours...');
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
      logger.info("GET operatinghours success:");
      logger.info(JSON.stringify(data));
      isOpen = data.isOpen;
      logger.info("isOpen is: " + isOpen);

      //operating hours
      startTimeUTC = data.start; //hh:mm in UTC
      endTimeUTC = data.end; //hh:mm in UTC

    }
  });

}, 15000);

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


			var queuesComplaintNumber = getConfigVal('asterisk:queues:complaint:number');

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

	var asteriskPublicHostname = getConfigVal('asterisk:sip:public');
	var stunServer = getConfigVal('asterisk:sip:stun') + ":" + getConfigVal('asterisk:sip:stun_port');

	//if wsPort is "", then it defaults to no port in the wss url
	var wsPort = getConfigVal('asterisk:sip:ws_port');
	if (wsPort !== "") {
		wsPort = parseInt(wsPort);
	}

	var queuesComplaintNumber = getConfigVal('asterisk:queues:complaint:number');
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
					resultJson = {'message':'OutOfExtensions'}
				} else {
					resultJson = {
						"message":"success",
						"vrs": data.vrs,
						"extension": nextExtension,
						"asterisk_public_hostname": asteriskPublicHostname,
						"stun_server": stunServer,
						"ws_port": wsPort,
						"password": extensionPassword,
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

	if (vrsNum) {
		logger.info('Performing VRS lookup for number: ' + vrsNum + ' to agent ' + destAgentExtension);

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

	if (user.queue_name) {
		logger.info('ADDING QUEUE: PJSIP/' + user.extension + ', queue name ' + user.queue_name);

		ami.action({
			"Action": "QueueAdd",
			"Interface": "PJSIP/" + user.extension,
			"Paused": "true",
			"Queue": user.queue_name
		}, function (err, res) {});
	}

	if (user.queue2_name) {

		logger.info('ADDING QUEUE: PJSIP/' + user.extension + ', queue name ' + user.queue2_name);
		ami.action({
			"Action": "QueueAdd",
			"Interface": "PJSIP/" + user.extension,
			"Paused": "true",
			"Queue": user.queue2_name
		}, function (err, res) {});
	}

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
		decodedString = new Buffer(encodedString, 'base64');
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
  if (typeof val !== 'undefined' && val !== null) {
    //found value for param_name
    var decodedString = null;
    if (clearText) {
      decodedString = val;
    } else {
      decodedString = new Buffer(val, 'base64');
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

function createToken() {
	//should Check for duplicate tokens
	return randomstring.generate({
		length: 12,
		charset: 'alphabetic'
	});
}


var ctoken = jwt.sign({
	tokenname: "servertoken"
}, new Buffer(getConfigVal('web_security:json_web_token:secret_key'), getConfigVal('web_security:json_web_token:encoding')));

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
	console.log('in force logout post request');
	let body = req.body;
	let agents = body.agents;
	console.log(JSON.stringify(agents, null, 2, true));
	agents.forEach(function(agent){
		// Emit the forceful logout event to each agent by extension
		io.to(Number(agent.extension)).emit('force-logout');
	})
});
/**
 * Calls the RESTful service to verify the VRS number.
 */
app.post('/consumer_login', function (req, res) {
	// All responses will be JSON sets response header.
	res.setHeader('Content-Type', 'application/json');
	var vrsnum = req.body.vrsnumber;
	if (/^\d+$/.test(vrsnum)) {
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
	} else {
		res.status(200).json({
			"message": "Error: Phone number format incorrect"
		});
	}
});


app.use(function (req, res, next) {
        res.locals = {
                "nginxPath":nginxPath
        }
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
app.get('/Complaint', function (req, res, next) {


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

					var token = jwt.sign(vrs.data[0], new Buffer(getConfigVal('web_security:json_web_token:secret_key'), getConfigVal('web_security:json_web_token:encoding')), {
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

		var token = jwt.sign(payload, new Buffer(getConfigVal('web_security:json_web_token:secret_key'), getConfigVal('web_security:json_web_token:encoding')), {
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
	res.redirect(nginxPath+'/agent');
});


/**
 * Handles a GET request for /Agent prior to OpenAM Cookie Shield.
 * @param {string} '/Agent'
 * @param {function} function(req, res, next)
 */

app.get('/agent', function (req, res, next) {
	if (req.session.data) {
		if (req.session.data.uid) {
			return next(); //user is logged in go to next()
		}
	}
	res.redirect('.' + nginxPath + '/agent');
});

/**
 * Handles a GET request for /agent. Checks user has
 * a valid session and displays page.
 *
 * @param {string} '/agent'
 * @param {function} 'agent.shield(cookieShield)'
 * @param {function} function(req, res)
 */
app.get('/agent', agent.shield(cookieShield), function (req, res) {
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
	res.redirect('.' + nginxPath + '/agent');
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

						var queuesComplaintNumber = getConfigVal('asterisk:queues:complaint:number');
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
						req.session.queuesComplaintNumber = queuesComplaintNumber;
						req.session.extensionPassword = extensionPassword;
						req.session.complaint_queue_count = complaint_queue_count;
						req.session.general_queue_count = general_queue_count;
						res.redirect('./agent');
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
app.get('/getVideomail', function (req, res) {
	console.log("/getVideomail");
	var videoId = req.query.id;
	console.log("id: " + videoId);
	var agentExt = req.query.ext;
	//Wrap in mysql query
	dbConnection.query('SELECT video_filepath AS filepath, video_filename AS filename FROM videomail WHERE id = ?', videoId, function (err, result) {
		if (err) {
			console.log('GET VIDEOMAIL ERROR: ', err.code);
		} else {
			var videoFile = result[0].filepath + result[0].filename;
			try {
				var stat = fs.statSync(videoFile);
				res.writeHead(200, {
					'Content-Type': 'video/webm',
					'Content-Length': stat.size
				});
				var readStream = fs.createReadStream(videoFile);
				readStream.pipe(res);
			} catch (err) {
				io.to(Number(agentExt)).emit('videomail-retrieval-error', videoId);
			}
		}
	});
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
