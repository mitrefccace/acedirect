var express = require('express');
var io = require('socket.io');
var colors = require('colors');
var asteriskManager = require('asterisk-manager');
var nconf = require('nconf');
var util = require('util');
var ami = null;
var cfile = null;
var cio = require('socket.io-client');
var log4js = require('log4js');
var fs = require('fs');
var request = require('request');
var srcPhoneNum = null;
var destPhoneNum = null;
var Map = require('collections/map');
var jwt = require('jsonwebtoken');
var bodyParser = require('body-parser');
var socketioJwt = require('socketio-jwt');
var fs = require('fs');
var ex;
var HashMap = require('hashmap');

// Contains source phone number => dest phone number
var callerMap = new Map();

// Contains queue name => longest wait time
var queueMap = new Map();

// Contains login name => JSON data passed from browser
var statusMap = new HashMap();

// Contains QueueMember.name (e.g. SIP/5001) => InCall (0 | 1)
var queueMemberStatusMap = new HashMap();

// Contains QueueMember.name (e.g. SIP/5001) => InCall (0 | 1)
var queueMemberPstnStatusMap = new HashMap();

// Contains QueueMember.name (e.g. SIP/6001) => InCall (0 | 1)
var queueMemberVideoStatusMap = new HashMap();

// Contains interface name (e.g. SIP/5001) => status (AWAY | READY)
var interfaceStatusMap = new HashMap();

// Contains the user's other extension e.g. SIP/5001 => SIP/6001
var interfacePairMap = new HashMap();

// Contains the channel mapped to queue name (e.g. SIP/5001 => PSTNQueue) 
var channelToQueueMap = new HashMap();

// Contains the outgoing channel (e.g. agent1 => SIP/7001)
var caToOutgoingChannelMap = new HashMap();

// Contains the incoming extension (e.g. agent1 => 6001)
var caToIncomingExtensionMap = new HashMap();

// Contains the channel mapped to the destination number
var channelToExten = new HashMap();

// Initialize log4js
log4js.loadAppender('file');
var logname = 'server';
log4js.configure({
	appenders: [
		{
			type: 'dateFile',
			filename: 'logs/' + logname + '.log',
			pattern: '-yyyy-MM-dd',
			alwaysIncludePattern: false,
			maxLogSize: 20480,
			backups: 10
		}
	]
});

// Get the name of the config file from the command line (optional)
nconf.argv().env();

cfile = 'config.json';

// Validate the incoming JSCON config file
try {
	var content = fs.readFileSync(cfile, 'utf8');
	var myjson = JSON.parse(content);
	console.log("Valid JSON config file");
} catch (ex) {
	console.log("Error in " + cfile);
	console.log('Exiting...');
	console.log(ex);
	process.exit(1);
}

var logger = log4js.getLogger(logname);

nconf.file({file: cfile});
var configobj = JSON.parse(fs.readFileSync(cfile, 'utf8'));

// Set log4js level from the config file
logger.setLevel(nconf.get('debuglevel')); //log level hierarchy: ALL TRACE DEBUG INFO WARN ERROR FATAL OFF
logger.trace('TRACE messages enabled.');
logger.debug('DEBUG messages enabled.');
logger.info('INFO messages enabled.');
logger.warn('WARN messages enabled.');
logger.error('ERROR messages enabled.');
logger.fatal('FATAL messages enabled.');
logger.info('Using config file: ' + cfile);

var dialaroundnums = nconf.get('dialaroundnums');

var app = express();
app.use(express.static(__dirname + '/'));
app.use(bodyParser.urlencoded({'extended': 'true'})); // parse application/x-www-form-urlencoded
app.use(bodyParser.json()); // parse application/json
app.use(bodyParser.json({type: 'application/vnd.api+json'})); // parse application/vnd.api+json as json

var server = app.listen(nconf.get('http:aclport'));
io = io.listen(server);

//Validates the token, if valid go to connection.
//if token is not valid, no connection will be established.
io.use(socketioJwt.authorize({
	secret: Buffer(nconf.get('jsonwebtoken:secretkey'), nconf.get('jsonwebtoken:encoding')),
	timeout: nconf.get('jsonwebtoken:timeout'), // seconds to send the authentication message
	handshake: nconf.get('jsonwebtoken:handshake')
}));

console.log('Config file: ' + cfile);
logger.info('Config file: ' + cfile);

console.log('Server up and listening on port ' + nconf.get('http:aclport'));
logger.info('Server up and listening on port ' + nconf.get('http:aclport'));

// Note - socket only valid in this block
io.sockets.on('connection', function (socket) {

	// We will see this on connect or browser refresh
	logger.info('NEW CONNECTION');
	logger.info(socket.request.connection._peername);

	var token = socket.decoded_token;
	logger.info('connected & authenticated: ' + token.username + " - " + token.first_name + " " + token.last_name);
	logger.info("ExpiresIn:   " + (token.exp - token.iat) + " seconds");

	// Handle incoming Socket.IO registration requests - add to the room
	socket.on('register-client', function (data) {
		logger.info("Adding client socket to room:");
		logger.info(socket.id);
		logger.info(socket.request.connection._peername);

		// Add this socket to the room
		socket.join('my room');
	});

	// Handle incoming Socket.IO outbound call originate request
	socket.on('outbound-call', function (data) {
		logger.info("Received outbound-call socket.io");
		logger.info("....from " + data.username);
		logger.info("...dest exten " + data.exten);
		var channel = caToOutgoingChannelMap.get(data.username);
		logger.info("...out channel " + channel);

		//see if it is an outbound VRS call...
		var url = nconf.get('vrscheck:url') + ":" + nconf.get('vrscheck:port') + "/vrsverify/?vrsnum=" + data.exten;
		request({
			url: url,
			json: true
		},
			function (error, response, data2) {
				if (error) {
					logger.error("ERROR: " + error);
				} else {
					logger.info("VRS lookup response: " + data2.message);
					var ctext = "from-phones";
					if (data2.message === 'success') {
						// outgoing PSTN call
						ctext = "outbound-CA";
					}

					logger.info("ORIGINATE");
					logger.info('Action:Originate');
					logger.info('Channel: ' + channel);
					logger.info('Context: ' + ctext);
					logger.info('Exten: ' + data.exten);
					logger.info('UniqueId: ' + 1);
					logger.info('CallerId: 7032935030');
					logger.info('Timeout: 30000');

					//Linphone to outbound PSTN case
					ami.action({
						"Action": "Originate",
						"Channel": channel,
						"Context": ctext,
						"Exten": data.exten,
						"UniqueId": "1",
						"CallerID": "1112223333", //TODO: hard-coded for now
						"Timeout": "30000",
						"ActionID": "1001",
						"Priority": "1"
					}, function (err, res) {});
				}
			});
	});

	// Handle new incoming messages from Asterisk redirected from below
	socket.on('asterisk-incoming', function (data) {

		// Call the RESTful service to verify the source and dest phone numbers
		getCallerInfo(data.srcPhoneNum, data.destPhoneNum, function (callbackdata) {

			if (callbackdata.message === 'success') {
				callbackdata.srcPhoneNum = data.srcPhoneNum;
				callbackdata.destPhoneNum = data.destPhoneNum;
				callbackdata.id = data.id;

				if (data.srcPhoneNum == callbackdata.data[0].vrs) {
					callbackdata.vrscaller = true;
				} else {
					callbackdata.vrscaller = false;
				}
				// Send the VRS lookup result to the room
				logger.info('VRS Lookup response: ' + JSON.stringify(callbackdata));
				io.to('my room').emit('new-caller', callbackdata);
			} else {
				logger.warn('Emit new-caller failed');
			}
		});
	});


	// Handler catches a Socket.IO message to pause both queues.  
	socket.on('pause-queues', function () {
		logger.info('PAUSING QUEUE: SIP/' + token.extension);
		console.log('PAUSING QUEUE: SIP/' + token.extension);

		ami.action({
			"Action": "QueuePause",
			"ActionId": "1000",
			"Interface": "SIP/" + token.extension,
			"Paused": "true",
			"Queue": nconf.get('queues:inbound:name'),
			"Reason": "QueuePause in pause-queue event handler"
		}, function (err, res) {});
	});

	socket.on('ready', function () {

		logger.info('State: READY - ' + token.username);
		console.log('State: READY - ' + token.username);
		statusMap.set(token.username, "READY");

		interfaceStatusMap.set("SIP/" + token.extension, "READY");

		//TODO Remove this
		interfacePairMap.set("SIP/" + token.extension, "this can be removed");

		channelToQueueMap.set("SIP/" + token.extension, nconf.get('queues:inbound:name'));

	});

	socket.on('away', function () {
		logger.info('State: AWAY - ' + token.username);
		console.log('State: AWAY - ' + token.username);
		statusMap.set(token.username, "AWAY");

		interfaceStatusMap.set("SIP/" + token.extension, "AWAY");

		//TODO Remove this
		interfacePairMap.set("SIP/" + token.extension, "this can be removed");

		channelToQueueMap.set("SIP/" + token.extension, nconf.get('queues:inbound:name'));

	});

	// Handler catches a Socket.IO message to unpause the queues.
	socket.on('unpause-queues', function () {
		logger.info('UNPAUSING QUEUE: SIP/' + token.extension);
		console.log('UNPAUSING QUEUE: SIP/' + token.extension);

		ami.action({
			"Action": "QueuePause",
			"ActionId": "1000",
			"Interface": "SIP/" + token.extension,
			"Paused": "false",
			"Queue": nconf.get('queues:inbound:name'),
			"Reason": "QueuePause in pause-queue event handler"
		}, function (err, res) {});

	});

	// Send the call-ended message
	socket.on('call-ended', function (data) {

		io.to('my room').emit('call-ended', data);

		logger.info('Sending call-ended event');
	});

	// Handler catches a Socket.IO disconnect
	socket.on('disconnect', function () {
		logger.info('DISCONNECTED');
		logger.info(socket.id);
		logger.info(socket.request.connection._peername);
		//Removes user from statusMap
		if ("username" in token) {
			console.log("disconnecting...");
			logout(token);
		}
	});
});

/*
 * Event handler to catch the incoming AMI action response.  Note, this is
 * a response to an AMI action (request from this node server) and is NOT
 * an Asterisk auto-generated event.
 */
function handle_action_response(evt) {

	logger.info('\n######################################');
	logger.info('Received an AMI action response: ' + evt);
	logger.info(util.inspect(evt, false, null));
}

/*
 * Event handler to catch the incoming AMI events.  Note, these are the
 * events that are auto-generated by Asterisk (don't require any AMI actions
 * sent by this node server).
 */

function handle_manager_event(evt) {
	var resString = null;

	if (evt.event === 'DialEnd' || evt.event === 'Newexten' || evt.event === 'Hangup') {

		logger.info('\n######################################');
		logger.info('Received an AMI event: ' + evt.event);
		logger.info(util.inspect(evt, false, null));

		switch (evt.event) {

			// Valid only for ACE to PSTN calls only
			case ('Newexten'):
				if (evt.application === 'GotoIf') {
					// logger.info('**************************************************** Newexten data... ' + evt.exten);
					// logger.info('Sending dest exten to browser so it can dial out: ' + evt.exten);
					// io.to('my room').emit('populate-destexten', {"destexten":evt.exten});

					// Add this channel to the hash so we can track channel to destination extension
					channelToExten.set(evt.channel, evt.exten);
					logger.info('Adding to channelToExten map: ' + evt.channel + " => " + evt.exten + ', size is ' + channelToExten.count());
				}
				break;

				// Sent by Asterisk when the call is answered
			case ('DialEnd'):

				// Use these maps to track status of the user (in/out of a call)
				var string1 = evt.destchannel;
				var channelName = string1.substring(0, 8, string1);
				var channelName2 = interfacePairMap.get(channelName);

				queueMemberStatusMap.set(channelName, 1);

				queueMemberVideoStatusMap.set(channelName, 1);

				queueMemberPstnStatusMap.set(channelName, 1);

				// Use this to pull out the required caller info for display in the browser
				if (evt.dialstatus === 'ANSWER' && evt.destcontext !== 'from-twilio' && evt.destcontext !== 'outbound-CA' && evt.context !== 'outbound-CA') {
					srcPhoneNum = null;
					destPhoneNum = null;

					// Strip off leading '+' sign
					if (evt.calleridnum !== null && evt.calleridnum.charAt(0) === '+') {
						srcPhoneNum = evt.calleridnum.slice(1);
					} else {
						srcPhoneNum = evt.calleridnum;
					}

					// Strip off leading '+' sign
					if (evt.exten !== null && evt.exten !== 'agents') {
						if (evt.exten.charAt(0) === '+') {
							destPhoneNum = evt.exten.slice(1);
						} else {
							destPhoneNum = evt.exten;
						}
					}

					logger.info('srcPhoneNum: ' + srcPhoneNum + ', ' + 'destPhoneNum: ' + destPhoneNum);

					// Strip off leading '1' to align with the database
					if (srcPhoneNum !== null && srcPhoneNum.charAt(0) === '1') {
						srcPhoneNum = srcPhoneNum.slice(1);
					}

					// Strip off leading '1' to align with the database
					if (destPhoneNum !== null && destPhoneNum.charAt(0) === '1') {
						destPhoneNum = destPhoneNum.slice(1);
					}

					logger.info('Map searching for ' + srcPhoneNum);

					if (callerMap.has(srcPhoneNum)) {
						logger.info('Map - Found an entry in the map: ' + callerMap.get(srcPhoneNum));

						destPhoneNum = callerMap.get(srcPhoneNum);

						// TODO evt.destcalleridnum? 
						// resString = {"id":6001, "srcPhoneNum":srcPhoneNum, "destPhoneNum":destPhoneNum};
						resString = {"id": evt.destcalleridnum, "srcPhoneNum": srcPhoneNum, "destPhoneNum": destPhoneNum};
						logger.info('ANSWERED ACE' + JSON.stringify(resString));

						logger.info('EMIT asterisk-incoming: ' + resString);

						// Send the Asterisk event to the localhost
						csocket.emit('asterisk-incoming', resString);

						callerMap.delete(srcPhoneNum);
						logger.info('Map - Clearing map entry: ' + srcPhoneNum);

						if (callerMap.length === 0) {
							logger.info('Map contents: empty');
						} else {
							logger.info('Map contents: ' + callerMap.toJSON());
						}

					} else {
						logger.info('Cannot find a map entry');

						// TODO evt.destcalleridnum?
						// resString = {"id":6001, "srcPhoneNum":srcPhoneNum, "destPhoneNum":destPhoneNum};
						resString = {"id": evt.destcalleridnum, "srcPhoneNum": srcPhoneNum, "destPhoneNum": destPhoneNum};
						logger.info('ANSWERED PSTN ' + JSON.stringify(resString));

						logger.info('EMIT asterisk-incoming: ' + JSON.stringify(resString));

						// Send the Asterisk event to the localhost
						csocket.emit('asterisk-incoming', resString);
					}
				}

				// TODO - Why wouldn't we get a match in this map?
				if (channelToExten.has(evt.channel)) {
					logger.info("Sending to populate-destexten: " + channelToExten.get(evt.channel));

					// TODO evt.destcalleridnum may not be valid outside the if() block above
					// io.to('my room').emit('populate-destexten', {"id":6001, "destexten":channelToExten.get(evt.channel)});   
					// ignore dial-around num
					if (dialaroundnums.indexOf("|" + channelToExten.get(evt.channel) + "|") === -1) {
						io.to('my room').emit('populate-destexten', {"id": evt.destcalleridnum, "destexten": channelToExten.get(evt.channel)});
						logger.info('EMIT populate-destexten if() case: ' + '{"id": ' + evt.destcalleridnum + ',"destexten":' + channelToExten.get(evt.channel) + '}');
					} else {
						logger.info('Ignoring dialaround num: ' + channelToExten.get(evt.channel));
					}
				} else {
					// PSTN initiated side?
					// Populate dest caller number back to browser
					logger.info('DialEnd data... ' + evt.context + ' , ' + evt.destcontext + ' , ' + evt.exten);
					if (evt.dialstatus === 'ANSWER' && evt.destcontext === 'from-internal') {

						logger.info('Sending dest exten to browser so it can dial out: ' + evt.exten);
						logger.info('Checking first char of ' + evt.exten);

						var destinationExtension = evt.exten;

						// evt.exten may be of the form +1... - if so, we want to strip off the first two chars (+1)
						if (destinationExtension.charAt(0) === '+') {
							logger.info('First char IS a +, need to strip off the first two chars');

							destinationExtension = evt.exten.slice(1).slice(1);
							logger.info('Stripped: ' + destinationExtension);
						} else {
							logger.info('First char IS NOT a +, no need to strip it off');
						}

						// TODO evt.destcalleridnum may not be valid outside the if() block above
						// io.to('my room').emit('populate-destexten', {"id":6001, "destexten":(evt.exten.slice(1)).slice(1)});                                

						// var destExten = (evt.exten.slice(1)).slice(1);

						// ignore dial-around num
						if (dialaroundnums.indexOf("|" + destinationExtension + "|") === -1) {
							// Orig
							// io.to('my room').emit('populate-destexten', {"id":evt.destcalleridnum, "destexten":(evt.exten.slice(1)).slice(1)});                                        
							io.to('my room').emit('populate-destexten', {"id": evt.destcalleridnum, "destexten": destinationExtension});

							// Orig
							// logger.info('channelToExten.count()' + channelToExten.count());
							// logger.info('EMIT populate-destexten else() case: ' + '{"id": ' +evt.destcalleridnum + ',"destexten":' + (evt.exten.slice(1)).slice(1) + '}');
							logger.info('EMIT populate-destexten else() case: ' + '{"id": ' + evt.destcalleridnum + ',"destexten":' + destinationExtension + '}');
						} else {
							logger.info('Ignoring dialaround num: ' + destinationExtension);
						}
					}
				}

				break;

				// Sent by Asterisk when the call is ended
			case ('Cdr'):

				// TODO 
				// csocket.emit('call-ended', {"id":6001});

				break;

			case ('QueueMember'):
				// Look at the QueueMember event to determine who is in a call

				break;

			case  ('QueueSummary'):
				// Update the queueMap with the longest hold time value
				break;

			case ('QueueSummaryComplete'):
				// Sent by Asterisk when the last QueueSummary record is sent
				break;

				// Sent by Asterisk when the caller hangs up
			case ('Hangup'):
				logger.info('Processing Hangup');

				logger.info('Map size: ' + caToIncomingExtensionMap.count());

				logger.info("Hangup search: " + caToIncomingExtensionMap.search(Number(evt.calleridnum)));
				logger.info("Keys: " + caToIncomingExtensionMap.keys().toString);

				// Note - evt.calleridnum is a number
				if (caToIncomingExtensionMap.search(Number(evt.calleridnum))) {
					csocket.emit('call-ended', {"id": evt.calleridnum});
					logger.info('EMIT: call-ended ' + '{"id"' + evt.calleridnum + "}");
				} else {
					logger.info('No match in caToIncomingExtensionMap for ' + evt.calleridnum);
				}

				// Catch the Hangup event and remove the channel from the hash
				if (channelToExten.has(evt.channel)) {
					channelToExten.remove(evt.channel);
					logger.info('Removing channel ' + evt.channel + ' from channelToExten map, size is ' + channelToExten.count());
				}

				break;

			default:
				// TODO - Exlude any AMI events we don't need
				logger.warn('AMI unhandled event: ' + evt.event);
				break;
		}
	}
}

/**
 * Instantiate the Asterisk connection.
 * @returns {undefined}
 */
function init_ami() {
	if (ami === null) {

		try {
			ami = new asteriskManager(nconf.get('asterisk:ami:port'),
				nconf.get('asterisk:sip:host'),
				nconf.get('asterisk:ami:id'),
				nconf.get('asterisk:ami:passwd'), true);
			ami.keepConnected();

			// Define event handlers here
			ami.on('managerevent', handle_manager_event);
			ami.on('response', handle_action_response);
		} catch (exp) {
			logger.error('Init AMI error: ' + exp.message.red);
		}
	}
}

/**
 * Initialize the AMI connection.
 */
init_ami();

/**
 * RESTful GET method for client to retrieve config info from the server
 */
app.get('/api/config', function (req, res) {
	logger.info('Entering app.get /api/config...');
	logger.info('app.get /api/config... Received get: ' + req.body);

	res.status(200).send(configobj);
	logger.info('exiting app.get /api/config...');
});

/**
 * Makes a POST request and calls login to validate the agent username and
 * password.  If the username and password is valid, entries are added to 
 * several maps and an AMI action is sent to Asterisk to add the channel 
 * (e.g. SIP/6001) that will be used by this agent.
 * 
 * @param {type} param1
 * @param {type} param2
 */
app.post('/login', function (req, res) {
	//calls login function to validate user with REST call  
	login(req.body.username, req.body.password, function (user) {
		//Testing only. remove or set to false in live environment   
		if (false) {
			var testingonly = {
				agent_id: 0,
				username: "admin",
				first_name: "Kevin",
				last_name: "Spacey",
				role: "administrator",
				phone: "000-000-0000",
				email: "admin@portal.com",
				organization: "Organization Alpha",
				extension: 6001,
				channel: "SIP/7001"
			};
			caToOutgoingChannelMap.set("admin", "SIP/7001");
			var token = jwt.sign(testingonly, Buffer(nconf.get('jsonwebtoken:secretkey'), nconf.get('jsonwebtoken:encoding')), {expiresIn: "1d"});
			res.status(200).json({token: token});

		} else if (user.message === 'success') {
			// Checks statusMap if user already exists
			if (statusMap.has(user.data[0].username)) {
				user.message = "User is logged in on another computer.";
				res.status(200).json(user);
			} 
			else if(user.data[0].role ==="AD Agent"){
				res.status(200).json({"message": "ACE Direct Agents cannot access ACE Connect Lite."});
			}else {
				//Adds user to statusMap. 
				//Tracks if user is already logged in elsewhere
				statusMap.set(user.data[0].username, null);

				logger.info('Login, setting caToOutgoingChannelMap: ' + user.data[0].username + ', ' + user.data[0].channel);
				console.log('Login, setting caToOutgoingChannelMap: ' + user.data[0].username + ', ' + user.data[0].channel);

				// Tracks the outgoing channel for each CA
				caToOutgoingChannelMap.set(user.data[0].username, user.data[0].channel);

				// Tracks the incoming extension for each CA
				logger.info('Populating caToIncomingExtensionMap: ' + user.data[0].username + ' => ' + user.data[0].extension);
				caToIncomingExtensionMap.set(user.data[0].username, user.data[0].extension);
				
				var redirect = null;
                if(user.data[0].role === "Manager"){
                        logger.info("Manager");
                        redirect = nconf.get('managementportal:url');
                        //remove status map key on redirects
                        statusMap.remove(user.data[0].username);
                }

				// profile included in the token, set to expire in 15 seconds
				var token = jwt.sign(user.data[0], Buffer(nconf.get('jsonwebtoken:secretkey'), nconf.get('jsonwebtoken:encoding')), {expiresIn: "15000"});
				res.status(200).json({message: "Success", token: token, redirect: redirect});

				console.log('Adding extension: ' + 'SIP/' + user.data[0].extension + nconf.get('queues:inbound:name'));

				// TODO - Add AMI QueueAdd call here                
				ami.action({
					"Action": "QueueAdd",
					"Interface": "SIP/" + user.data[0].extension,
					"Paused": "true",
					"Queue": nconf.get('queues:inbound:name')
				}, function (err, res) {});

			}
		} else {
			res.status(200).json(user);
		}
	});
});

/**
 * Calls the RESTful service running on the provider host to verify the agent 
 * username and password.  
 * 
 * @param {type} username
 * @param {type} password
 * @param {type} callback
 * @returns {undefined}
 */
function login(username, password, callback) {
	// http://provider.task3acrdemo.com:8084/agentverify/";
	var url = nconf.get('agentservice:url') + ":" + nconf.get('agentservice:port') + "/agentverify/";
	var params = "?username=" + username + "&password=" + password;
	request({
		url: url + params,
		json: true
	}, function (error, response, data) {
		if (error) {
			logger.error("ERROR: " + error);
			data = {"message": "failed"};
		} else {
			logger.info("Agent Verify: " + data.message);
			console.log("Agent Verify: " + JSON.stringify(data));			
		}
		callback(data);
	});
}

/**
 * Removes the interface (e.g. SIP/6001) from Asterisk when the agent logs out.
 * 
 * @param {type} token
 * @returns {undefined}
 */
function logout(token) {
	//removes username from statusMap
	if (token.username !== null) {
		statusMap.remove(token.username);

		// TODO - Add AMI QueueAdd call here                
		ami.action({
			"Action": "QueueRemove",
			"Interface": "SIP/" + token.extension,
			"Paused": "true",
			"Queue": nconf.get('queues:inbound:name')
		}, function (err, res) {});

	}
}

/**
 * Calls the RESTful service running on the provider host to verify VRS number.
 * Note, this is an emulated VRS check.
 * 
 * @param {type} phone1
 * @param {type} phone2
 * @param {type} callback
 * @returns {undefined}
 */
function getCallerInfo(phone1, phone2, callback) {
	// console.log('Entering getCallerInfo()' + phone1 + ' ' + phone2);
	// http://providerhost:port
	var url = nconf.get('vrscheck:url') + ":" + nconf.get('vrscheck:port');

	if (phone1) {
		url += "/vrsverify/?vrsnum=" + phone1;
	} else {
		url += "/getAllVrsRecs";
	}
	request({
		url: url,
		json: true
	}, function (error, response, data) {
		if (error) {
			logger.error("ERROR: " + error);
			data = {"message": "failed"};
		}
		// if(!error && response.statusCode === 200){
		else {
			logger.info("VRS lookup response: " + data.message);
			if (data.message !== 'success' && phone2 !== null) {
				return  getCallerInfo(phone2, null, callback);
			}
		}
		callback(data);
	});
}

/*
 * Use this socket to connect back to this server so that incoming AMI
 * events are accesible to be sent out on the socket.
 */
var ctoken = jwt.sign({tokenname: "servertoken"}, Buffer(nconf.get('jsonwebtoken:secretkey'), nconf.get('jsonwebtoken:encoding')));
var csocket = cio.connect('http://localhost:' + nconf.get('http:aclport'), {reconnect: true, query: 'token=' + ctoken});

