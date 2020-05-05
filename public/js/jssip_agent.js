var ua;
var my_sip_uri = document.getElementById("my_sip_uri");
var ws_servers = document.getElementById("ws_servers");
var pc_config = document.getElementById("pc_config");
var sip_password = document.getElementById("sip_password");
var currentSession, toggleInterval;
var remoteStream = document.getElementById("remoteView");
var selfStream = document.getElementById("selfView");
var call_option_buttons = document.getElementById("call-option-buttons");
var mute_audio_button = document.getElementById("mute-audio");
var hide_video_button = document.getElementById("hide-video");
var mute_audio_icon = document.getElementById("mute-audio-icon");
var mute_captions_button = document.getElementById("mute-captions");
var mute_captions_icon = document.getElementById("mute-captions-off-icon");
var transcript_overlay = document.getElementById("transcriptoverlay");
var hide_video_icon = document.getElementById("mute-camera-off-icon");
var hold_button = document.getElementById("hold-call");
var debug = true; //console logs event info if true
var jssip_debug = false; //enables debugging logs from jssip library if true NOTE: may have to refresh a lot to update change
var socket_js = null;


//setup for the call. creates and starts the User Agent (UA) and registers event handlers
function register_jssip() {
	if (jssip_debug) JsSIP.debug.enable('JsSIP:*');
	else JsSIP.debug.disable('JsSIP:*');

	// Create our JsSIP instance and run it:
	socket_js = new JsSIP.WebSocketInterface(ws_servers.getAttribute("name"));

	var configuration = {
		sockets: [socket_js],
		uri: my_sip_uri.getAttribute("name"),
		password: sip_password.getAttribute("name"),
	};

	ua = new JsSIP.UA(configuration);
	ua.start();

	ua.on('connected', function (e) {
		console.log("\nJSSIP UA CONNECTED: " + e + "\n");
	});

	ua.on('registered', function (e) {
		console.log("\nJSSIP UA REGISTERED: " + e + "\n");
	});

	// Caption block start ----------
	ua.on('newMessage', function (e) {
		if (debug) console.log("\nUA - NEWMESSAGE");

		try {
			var transcripts = JSON.parse(e.message._request.body)
			if (transcripts.transcript) {
				var tDiv = document.getElementById(transcripts.msgid);

				if (!tDiv) {
					var temp = document.createElement("div");

					temp.id = transcripts.msgid;
					temp.innerHTML = transcripts.transcript;
					temp.classList.add("transcripttext");
					document.getElementById("transcriptoverlay").appendChild(temp);
				} else {
					tDiv.innerHTML = transcripts.transcript;

					if (transcripts.final) {
						setTimeout(function () { tDiv.remove() }, 5000);

						$('#caption-messages').append("<div class='agent-scripts'><div class='direct-chat-text'>" + transcripts.transcript + "</div></div>");
						$("#caption-messages").scrollTop($("#caption-messages")[0].scrollHeight);
					}
				}
			}

		} catch (err) {
			console.log(err);
		}

	}); // Caption block end -------------


	//the event handlers for UA events
	ua.on('newRTCSession', function (e) {
		currentSession = e.session;
		if (debug) console.log("\nUA - NEWRTCSESSION : \nORIGINATOR:\n" + e.originator + "\nSESSION:\n" + e.session + "\nREQUEST:\n" + e.request);

		currentSession.on('accepted', function (e) {
			if (debug) console.log('\nCURRENTSESSION -  ACCEPTED: \nRESPONSE: \n' + e.response + "\nORIGINATOR:\n" + e.originator);
			toggle_incall_buttons(true);
			mirrorMode("remoteView", false)
			start_self_video();
			$("#start-call-buttons").hide();
			$('#outboundCallAlert').hide();// Does Not /Exist - ybao: recover this to remove the Calling screen
		});

		currentSession.on('ended', function (e) {
			if (debug) console.log('\nCURRENTSESSION -  ENDED: \nORIGINATOR: \n' + e.originator + '\nMESSAGE:\n' + e.message + "\nCAUSE:\n" + e.cause);
			terminate_call();
			clearScreen();
			clearInterval(toggleInterval);
			$('#duration').timer('pause');
			$('#user-status').text('Wrap Up');
			$('#complaintsInCall').hide();
			$('#geninfoInCall').hide();
			socket.emit('wrapup', null);
			changeStatusIcon(wrap_up_color, "wrap-up", wrap_up_blinking);
			changeStatusLight('WRAP_UP');
			$('#modalWrapup').modal({
				backdrop: 'static',
				keyboard: false
			});
		});
		currentSession.on('failed', function (e) {
			sc1 = '';
			rs1 = '';
			if (e.response) {
				sc1 = e.response.status_code;
				rs1 = e.response.reason_phrase;
			}
			if (debug) console.log('\nCURRENTSESSION -  FAILED: \nMESSAGE:\n' + e.message + "\nCAUSE:\n" + e.cause + "\nORIGINATOR:\n" + e.originator + "\nRESPONSE.status_code:\n" + sc1 + "\nRESPONSE.reason_phrase:\n" + rs1);
			terminate_call();
			$('#user-status').text('Ready');
			changeStatusIcon(ready_color, "ready", ready_blinking);
			changeStatusLight('READY');
			$('#outboundCallAlert').hide(); // Does not exist - ybao: recover this to remove Calling screen
			$('#duration').timer('pause');
		});

		currentSession.on('sdp', function (e) {
			// MW, this breaks z70 videomail. 
			//e.sdp = edit_request_with_packetizationmode(e.sdp);
		});
		//event listener for remote video. Adds to html page when ready.
		//NOTE: has to be both here and in accept_call() because currentSession.connection is not established until after ua.answer() for incoming calls
		if (currentSession.connection) currentSession.connection.ontrack = function (e) {
			if (debug) console.log("STARTING REMOTE VIDEO\ne.streams: " + e.streams + "\ne.streams[0]: " + e.streams[0]);
			remoteStream.srcObject = e.streams[0];
			let rPromise = remoteStream.play();
			rPromise.then(function () {
				console.log("Video stream has started.");
				setTimeout(function(){calibrateVideo(2000)}, 1000)
			})
		};
	});
}

//makes a call
//@param other_sip_uri: is the sip uri of the person to call
function start_call(other_sip_uri) {
	disable_persist_view();
	var options = {
		'mediaConstraints': {
			'audio': true,
			'video': true
		},
		'pcConfig': {
			'rtcpMuxPolicy': 'negotiate',
			'iceServers': [{
				'urls': [
					pc_config.getAttribute('name')
				]
			}]
		}
	};

	ua.call(other_sip_uri, options);
}

function calibrateVideo(duration) {
	if (currentSession) {
			let muted = currentSession.isMuted();
			if (!muted.video){
					console.log("Calibrate Start Video Stream for " + duration + "ms");
					enable_video_calibrate()
					setTimeout(function () {
							console.log("Calibrate End  video stream.")
							disable_video_calibrate();
					}, duration)
			}
	}
}


function toggleSelfview(duration) {
	if (currentSession) {
		let muted = currentSession.isMuted();
		if (!muted.video) {
			console.log("Toggle Video Stream for " + duration + "ms");
			currentSession.mute({ audio: false, video: true });
			setTimeout(function () {
				currentSession.unmute({ audio: false, video: true })
			}, duration)
		}
	}
}

//answers an incoming call
function accept_call() {
	stopVideomail();
	disable_persist_view();
	document.getElementById("persistCameraCheck").disabled = true;
	if (currentSession) {
		var options = {
			'mediaConstraints': {
				'audio': true,
				'video': true
			},
			'pcConfig': {
				'rtcpMuxPolicy': 'negotiate',
				'iceServers': [{
					'urls': [
						pc_config.getAttribute('name')
					]
				}]
			}
		};
		currentSession.answer(options);
		//event listener for remote video. Adds to html page when ready.
		//NOTE: needs to be both here and in the newRTCSession event listener because currentSession.connection is not established until after ua.answer() for incoming calls
		if (currentSession.connection) currentSession.connection.ontrack = function (e) {
			if (debug) console.log("STARTING REMOTE VIDEO\ne.streams: " + e.streams + "\ne.streams[0]: " + e.streams[0]);
			mirrorMode('remoteView', false);
			remoteStream.srcObject = e.streams[0];
			let remotePlayPromise = remoteStream.play();
			remotePlayPromise.then(function () {
				console.log("Video stream has started.");
				setTimeout(function(){calibrateVideo(2000)}, 1000)
			});
		}
	}
}

//Functions for enabling and disabling persist view
function enable_persist_view() {
	document.getElementById("persistCameraCheck").disabled = false;
	if (navigator.mediaDevices === undefined) {
		navigator.mediaDevices = {};
	}

	navigator.mediaDevices.getUserMedia({
		audio: false,
		video: true
	}).then((stream) => {
		if ("srcObject" in selfStream) {
			remoteStream.srcObject = stream;
		} else {
			remoteStream.src = window.URL.createObjectURL(stream);
		}

		backupStream = stream;
		window.self_stream = stream;

		return new Promise(resolve => remoteStream.onplaying = resolve);
	}).then(() => {
		mirrorMode("remoteView", true);
	}).catch(function (err) {
		console.log(err.name + ": " + err.message);
	});
}

function disable_persist_view() {
	selfStream.setAttribute("hidden", true);
	// Clear transcripts at the end of the call
	$('#transcriptoverlay').html('');

	hide_video_button.setAttribute("onclick", "javascript: enable_video_privacy();");
	hide_video_icon.style.display = "none";

	//stops remote track
	if (remoteView.srcObject) {
		if (remoteView.srcObject.getTracks()) {
			//Below line specifically releases webcam light
			if (remoteView.srcObject.getTracks()[0]) {
				console.log("Stopping stream");
				remoteView.srcObject.getTracks()[0].stop();
			}
			if (remoteView.srcObject.getTracks()[1]) remoteView.srcObject.getTracks()[1].stop();
		}
	}

	//stops the camera from being active
	if (window.self_stream) {
		if (window.self_stream.getVideoTracks()) {
			if (window.self_stream.getVideoTracks()[0]) {
				window.self_stream.getVideoTracks()[0].stop();
			}
		}
	}

	if (remoteView.srcObject) {
		let tracks = remoteView.srcObject.getTracks();
		tracks.forEach(function (track) {
			if (track.kind === 'video') {
				if (track.enabled) {
					track.stop();
					track.enabled = false;
				}
			}
		});
	}

	window.self_stream = null;

	JsSIP.Utils.closeMediaStream(selfStream);
	JsSIP.Utils.closeMediaStream(remoteStream);
	JsSIP.Utils.closeMediaStream(window.self_stream);
	console.log("Current session " + currentSession);
	if (currentSession) {
		console.log("Current session connection " + currentSession.connection);
	}

	removeElement("selfView");
	removeElement("remoteView");
	addElement("webcam", "video", "remoteView");
	remoteView.setAttribute("autoplay", "autoplay");
	remoteView.setAttribute("poster", "images/acedirect-logo.png");
	mirrorMode("remoteView", false);
	addElement("webcam", "video", "selfView");
	selfView.setAttribute("style", "right: 11px");
	selfView.setAttribute("autoplay", "autoplay");
	selfView.setAttribute("muted", true);
	selfView.setAttribute("hidden", true);
	mirrorMode("selfView", true)
	selfView.muted = true;
	remoteStream = document.getElementById("remoteView");
	selfStream = document.getElementById("selfView");
	console.log("All streams " + selfStream + "\n" + remoteStream + "\n" + window.self_stream);

	toggle_incall_buttons(false);
}




function enable_video_calibrate() {
	if (currentSession) {
			currentSession.mute({audio: false,video: true});
			// the following piece of code does not seem to stop the video at remote side
			if (window.self_stream) {
					if (window.self_stream.getVideoTracks()) {
							if (window.self_stream.getVideoTracks()[0]) {
									window.self_stream.getVideoTracks()[0].stop();
							}
					}
			}
			selfStream.srcObject = null;
			mirrorMode("selfView", false);
			selfStream.src = "images/calibrate5.webm";
			//selfStream.src = "images/videoPrivacy.webm";
			selfStream.type = 'type="video/webm"';
			selfStream.setAttribute("loop", "true");

			var playPromise = selfStream.play();
			if (playPromise !== undefined) {
					playPromise.then(function () {
							currentSession.unmute({audio: false, video: true});
					}).catch(function (error) {
							console.error('ERROR - this browser does not support play() Promise');
					});
			}

			selfStream.onplay = function () {
					var stream = selfStream.captureStream();
					stream.onactive = function () {         // without onactive the tracks of captured stream may be empty
							var tracks = stream.getTracks();
							Promise.all(currentSession.connection.getSenders().map(sender =>
									sender.replaceTrack(stream.getTracks().find(t => t.kind == sender.track.kind), stream)));
					}
			};
	}
}

function disable_video_calibrate(){
	if (currentSession) {
			currentSession.mute({audio: false,video: true});
			if (navigator.mediaDevices === undefined) {
					navigator.mediaDevices = {};
			}
			if (navigator.mediaDevices.getUserMedia === undefined) {
					navigator.mediaDevices.getUserMedia = function (constraints) {
							var getUserMedia = navigator.msGetUserMedia || navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
							if (!getUserMedia) {
									return Promise.reject(new Error('getUserMedia is not implemented in this browser'));
							}
							return new Promise(function (resolve, reject) {
									getUserMedia.call(navigator, constraints, resolve, reject);
							});
					}
			}

			navigator.mediaDevices.getUserMedia({audio: true,video: true})
			  .then(function (stream) {
				   selfStream.removeAttribute("hidden");
				   if ("srcObject" in selfStream) {
					  selfStream.srcObject = stream;
				   } else {
					  selfStream.src = window.URL.createObjectURL(stream);
				   }
				   window.self_stream = stream;
				   selfStream.onloadedmetadata = function (e) {
					 selfStream.play();
					 Promise.all(currentSession.connection.getSenders().map(sender =>
					   sender.replaceTrack(stream.getTracks().find(t => t.kind == sender.track.kind), stream)));
				   };
				   mirrorMode("selfView", true);
			  }).catch(function (err) {
				   console.log(err.name + ": " + err.message);
			  });
			currentSession.unmute({audio: false,video: true});
	}
}




//starts the local streaming video. Works with some older browsers, if it is incompatible it logs an error message, and the selfStream html box stays hidden
function start_self_video() {
	if (selfStream.hasAttribute("hidden")) //then the video wasn't already started
	{
		// Older browsers might not implement mediaDevices at all, so we set an empty object first
		if (navigator.mediaDevices === undefined) {
			navigator.mediaDevices = {};
		}

		// Some browsers partially implement mediaDevices. We can't just assign an object
		// with getUserMedia as it would overwrite existing properties.
		// Here, we will just add the getUserMedia property if it's missing.
		if (navigator.mediaDevices.getUserMedia === undefined) {
			navigator.mediaDevices.getUserMedia = function (constraints) {
				// First get ahold of the legacy getUserMedia, if present
				var getUserMedia = navigator.msGetUserMedia || navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

				// Some browsers just don't implement it - return a rejected promise with an error
				// to keep a consistent interface
				if (!getUserMedia) {
					return Promise.reject(new Error('getUserMedia is not implemented in this browser'));
				}

				// Otherwise, wrap the call to the old navigator.getUserMedia with a Promise
				return new Promise(function (resolve, reject) {
					getUserMedia.call(navigator, constraints, resolve, reject);
				});
			}
		}

		navigator.mediaDevices.getUserMedia({
			audio: true,
			video: true
		})
			//navigator.mediaDevices.getUserMedia({ audio: false, video: true })
			.then(function (stream) {
				selfStream.removeAttribute("hidden");
				// Older browsers may not have srcObject
				if ("srcObject" in selfStream) {
					selfStream.srcObject = stream;
					console.log("using srcObject");
				} else {
					// Avoid using this in new browsers, as it is going away.
					selfStream.src = window.URL.createObjectURL(stream);
					console.log("using src");
				}

				// backup the camera video stream
				var senders = currentSession.connection.getSenders();
				var tracks = stream.getTracks();
				var videoTrack = stream.getVideoTracks()[0];
				var audioTrack = stream.getAudioTracks()[0];

				backupStream = stream;

				window.self_stream = stream;
				selfStream.onloadedmetadata = function (e) {
					selfStream.play();
				};
			})
			.catch(function (err) {
				console.log(err.name + ": " + err.message);
			});
	}
}

//toggles showing the call option buttons at the bottom of the video window (ie end call, mute, etc).
//The buttons themselves are in acedirect and the complaint_form, this simply un-hides them
//@param make_visible: boolean whether or not to show the call option buttons
function toggle_incall_buttons(make_visible) {
	if (make_visible) call_option_buttons.style.display = "block";
	else call_option_buttons.style.display = "none";
}

//handles cleanup from jssip call. removes the session if it is active and removes video.
function terminate_call() {
	if (currentSession) {
		if (!currentSession.isEnded()) currentSession.terminate();
	}
	remove_video();
	disable_chat_buttons();
	enable_initial_buttons();
	$("#start-call-buttons").show();
	$("#transcriptoverlay").html('');

	exitFullscreen();
	//Check if persist needs to be enabled and undisable the status dropdown
	document.getElementById("statusDropdownMenuButton").disabled = false;
	if (document.getElementById("persistCameraCheck").checked == true) {
		enable_persist_view();
	}
	document.getElementById("persistCameraCheck").disabled = false;
}

//terminates the call (if present) and unregisters the ua
function unregister_jssip() {
	terminate_call();
	if (ua) {
		ua.unregister();
		ua.terminateSessions();
		ua.stop();
	}
	localStorage.clear();
	sessionStorage.clear();
}

//removes both the remote and self video streams and replaces it with default image. stops allowing camera to be active. also hides call_options_buttons.
function remove_video() {
	selfStream.setAttribute("hidden", true);
	//selfStream.pause();  //not needed? was potentially causing an exception
	//remoteStream.pause();  //not needed? was potentially causing an exception
	//selfStream.src = "";  //not needed? was potentially causing an exception
	//remoteView.src = "";  //not needed? was potentially causing an exception

	// Clear transcripts at the end of the call
	$('#transcriptoverlay').html('');

	console.log('Disabling video privacy button');
	hide_video_button.setAttribute("onclick", "javascript: enable_video_privacy();");
	hide_video_icon.style.display = "none";

	//stops remote track
	if (remoteView.srcObject) {
		if (remoteView.srcObject.getTracks()) {
			if (remoteView.srcObject.getTracks()[0]) remoteView.srcObject.getTracks()[0].stop();
			if (remoteView.srcObject.getTracks()[1]) remoteView.srcObject.getTracks()[1].stop();
		}
	}

	//stops the camera from being active
	if (window.self_stream) {
		if (window.self_stream.getVideoTracks()) {
			if (window.self_stream.getVideoTracks()[0]) {
				window.self_stream.getVideoTracks()[0].stop();
			}
		}
	}
	removeElement("selfView");
	removeElement("remoteView");
	addElement("webcam", "video", "remoteView");
	remoteView.setAttribute("autoplay", "autoplay");
	remoteView.setAttribute("poster", "images/acedirect-logo.png");
	addElement("webcam", "video", "selfView");
	selfView.setAttribute("style", "right: 11px");
	selfView.setAttribute("autoplay", "autoplay");
	selfView.setAttribute("muted", true);
	selfView.setAttribute("hidden", true);
	selfView.muted = true;
	remoteStream = document.getElementById("remoteView");
	selfStream = document.getElementById("selfView");

	toggle_incall_buttons(false);
}

//swaps remote and local videos for videomail recording
//puts user's own video in the big video
function swap_video() {
	//local becomes remote and remote becomes local
	$('#remoteView').attr('id', 'tempView');
	$('#selfView').attr('id', 'remoteView');
	$('#tempView').attr('id', 'selfView');

	$('#selfView').attr('width', 0);
	$('#selfView').attr('height', 0);
	$('#selfView').attr('muted', true);
	$('#selfView').attr('hidden', true);
}

// Adds an element to the document
function addElement(parentId, elementTag, elementId, html) {
	var p = document.getElementById(parentId);
	var newElement = document.createElement(elementTag);
	newElement.setAttribute('id', elementId);
	newElement.setAttribute('class', elementId);
	newElement.setAttribute('name', elementId);
	newElement.innerHTML = html;
	p.appendChild(newElement);
}

// Removes an element from the document
function removeElement(elementId) {
	var element = document.getElementById(elementId);
	element.pause();
	element.removeAttribute('src');
	element.parentNode.removeChild(element);
}

//mutes self audio so remote cannot hear you
function mute_audio() {
	if (currentSession) {
		currentSession.mute({
			audio: true,
			video: false
		});
		mute_audio_button.setAttribute("onclick", "javascript: unmute_audio();");
		mute_audio_icon.classList.add("fa-microphone-slash");
		mute_audio_icon.classList.remove("fa-microphone");
	}
}

//unmutes self audio so remote can hear you
function unmute_audio() {
	if (currentSession) {
		currentSession.unmute({
			audio: true,
			video: false
		});
		mute_audio_button.setAttribute("onclick", "javascript: mute_audio();");
		mute_audio_icon.classList.add("fa-microphone");
		mute_audio_icon.classList.remove("fa-microphone-slash");
	}
}

function mute_captions() {
	if (mute_captions_icon.style.display === "none") {
		mute_captions_icon.style.display = "block";
		transcript_overlay.style.display = "none"
	} else {
		mute_captions_icon.style.display = "none";
		transcript_overlay.style.display = "block";
	}
}

//hides self video so remote cannot see you
function hide_video() {

	if (currentSession) {
		currentSession.mute({
			audio: false,
			video: true
		});
		console.log("Hide video reached");
		selfStream.setAttribute("hidden", true);

	}
}

//unhides self video so remote can see you
function unhide_video() {
	if (currentSession) {
		currentSession.unmute({
			audio: false,
			video: true
		});
		console.log("Unhide video reached");
		selfStream.removeAttribute("hidden");
	}
}

function enable_video_privacy() {

	if (currentSession) {
		currentSession.mute({
			audio: false,
			video: true
		});


		console.log('Enabling video privacy');
		hide_video_button.setAttribute("onclick", "javascript: disable_video_privacy();");
		hide_video_icon.style.display = "block";

		// the following piece of code does not seem to stop the video at remote side
		if (window.self_stream) {
			if (window.self_stream.getVideoTracks()) {
				if (window.self_stream.getVideoTracks()[0]) {
					window.self_stream.getVideoTracks()[0].stop();
					console.log("videotrack[0] stopped");
				}
			}
		}

		selfStream.srcObject = null;
		//selfStream.classList.remove('mirror-mode');
		mirrorMode("selfView", false);
		selfStream.src = "images/videoPrivacy.webm";
		console.log("Using self-constructed 30sec video audio clip with SAR 1:1 DAR 4:3 resolution 640:480");


		selfStream.type = 'type="video/webm"';
		selfStream.setAttribute("loop", "true");

		//important - play() returns a Promise (async)
		var playPromise = selfStream.play();
		if (playPromise !== undefined) {
			playPromise.then(function () {
				//do not unmute until play() Promise returns
				currentSession.unmute({
					audio: false,
					video: true
				});
			}).catch(function (error) {
				console.error('ERROR - this browser does not support play() Promise');
			});
		}

		selfStream.onplay = function () {
			// Set the source of one <video> element to be a stream from another.
			console.log("selfStream onPlay()");
			var stream = selfStream.captureStream();
			stream.onactive = function () {		// without onactive the tracks of captured stream may be empty
				// replace remote screen to be the captured stream
				var tracks = stream.getTracks();
				Promise.all(currentSession.connection.getSenders().map(sender =>
					sender.replaceTrack(stream.getTracks().find(t => t.kind == sender.track.kind), stream)));
				console.log("Replaced tracks with recorded privacy video");
			}
		};
	}
}

function disable_video_privacy() {
	if (currentSession) {
		currentSession.mute({
			audio: false,
			video: true
		});
		console.log('Disabling video privacy');
		hide_video_button.setAttribute("onclick", "javascript: enable_video_privacy();");

		/* DO WE REALLY NEED TO GET USER MEDIA AGAIN? */

		// Older browsers might not implement mediaDevices at all, so we set an empty object first
		if (navigator.mediaDevices === undefined) {
			navigator.mediaDevices = {};
		}

		// Some browsers partially implement mediaDevices. We can't just assign an object
		// with getUserMedia as it would overwrite existing properties.
		// Here, we will just add the getUserMedia property if it's missing.
		if (navigator.mediaDevices.getUserMedia === undefined) {
			navigator.mediaDevices.getUserMedia = function (constraints) {
				// First get ahold of the legacy getUserMedia, if present
				var getUserMedia = navigator.msGetUserMedia || navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

				// Some browsers just don't implement it - return a rejected promise with an error
				// to keep a consistent interface
				if (!getUserMedia) {
					return Promise.reject(new Error('getUserMedia is not implemented in this browser'));
				}

				// Otherwise, wrap the call to the old navigator.getUserMedia with a Promise
				return new Promise(function (resolve, reject) {
					getUserMedia.call(navigator, constraints, resolve, reject);
				});
			}
		}

		navigator.mediaDevices.getUserMedia({
			audio: true,
			video: true
		})
			.then(function (stream) {
				selfStream.removeAttribute("hidden");
				// Older browsers may not have srcObject
				if ("srcObject" in selfStream) {
					selfStream.srcObject = stream;
				} else {
					// Avoid using this in new browsers, as it is going away.
					selfStream.src = window.URL.createObjectURL(stream);
				}
				window.self_stream = stream;
				selfStream.onloadedmetadata = function (e) {
					// update selfStream to play camera stream
					selfStream.play();
					// replace remote track to camera stream
					Promise.all(currentSession.connection.getSenders().map(sender =>
						sender.replaceTrack(stream.getTracks().find(t => t.kind == sender.track.kind), stream)));
				};
				//selfStream.classList.add("mirror-mode");
				mirrorMode("selfView", true);
				console.log("Replaced tracks with user media");
			})
			.catch(function (err) {
				console.log(err.name + ": " + err.message);
			});

		hide_video_icon.style.display = "none";

		currentSession.unmute({
			audio: false,
			video: true
		});
	}
}

// times out and ends call after 30 or so seconds. agent gets event "ended" with cause "RTP Timeout".
// puts session on hold
function hold() {
	if (currentSession) {
		var options = {
			'useUpdate': true
		};
		currentSession.hold(options);
		hold_button.setAttribute("onclick", "javascript: unhold();");
		hold_button.innerHTML = "Unhold";
	}
}

//resumes session
function unhold() {
	if (currentSession) {
		currentSession.unhold();
		hold_button.setAttribute("onclick", "javascript: hold();");
		hold_button.innerHTML = "Hold";
	}
}

//this function may or may not solve our H264 codec issue. Calls to this function are currently commented out as it seems to not be helping.
//Edits the request to remove H264 modes other than 97, and adds H264 mode 97
//@ param request is the request message to edit
//@ return request_lines.join(' ') the edited request
function edit_request(request) {
	console.log("EDITING REQUEST");
	var video_section = false; //if we've reached the "m=video" section. Don't want to add H264 to the audio section
	var added_new_codec = false; //if we've added the new codec. If we reach the end and havent added it, we append it to the end of the file (possibly in the wrong order)

	if (request !== undefined) {
		var request_lines = request.split('\n');
		for (var i = 0; i < request_lines.length; i++) {
			if (request_lines[i].includes("m=video")) {
				request_lines[i] = request_lines[i].replace(" 126", ""); //getting rid of other h264
				request_lines[i] = request_lines[i].replace(" 99", ""); //getting rid of other h264
				request_lines[i] = request_lines[i].replace(" 97", ""); //getting rid of 97 so we don't have it twice
				request_lines[i] = request_lines[i] + " 97"; //adding h264 97
				video_section = true;
			}

			//getting rid of h264
			if (request_lines[i].includes("H264/90000")) {
				request_lines.splice(i, 1);
				i--; //preventing wrong index because line was deleted
			}
			if ((request_lines[i].includes("a=rtcp-fb:99")) || (request_lines[i].includes("a=rtcp-fb:126")) || (request_lines[i].includes("a=rtcp-fb:97"))) {
				request_lines.splice(i, 1);
				i--;
			}
			if ((request_lines[i].includes("a=fmtp:99")) || (request_lines[i].includes("a=fmtp:126")) || (request_lines[i].includes("a=fmtp:97"))) {
				request_lines.splice(i, 1);
				i--;
			}

			//adding h264 97
			if (video_section) {
				//we want to add the lines in the correct order. "a=fmtp" lines should be added where all the other "a=fmtp" lines are
				if (request_lines[i].includes("a=fmtp")) {
					//we want to add the new line at the end of all the "a=fmtp" lines
					if (request_lines[i + 1].includes("a=fmtp") == false) {
						request_lines[i] = request_lines[i] + "\na=fmtp:97 profile-level-id=42e01f;level-asymmetry-allowed=1";
						added_new_codec = true;
					}
				}
				if (request_lines[i].includes("a=rtcp")) {
					if (request_lines[i + 1].includes("a=rtcp") == false) {
						request_lines[i] = request_lines[i] + "\na=rtcp-fb:97 nack\na=rtcp-fb:97 nack pli\na=rtcp-fb:97 ccm fir\na=rtcp-fb:97 goog-remb";
						added_new_codec = true;
					}
				}
				if (request_lines[i].includes("a=rtpmap")) {
					if (request_lines[i + 1].includes("a=rtpmap") == false) {
						request_lines[i] = request_lines[i] + "\na=rtpmap:97 H264/90000";
						added_new_codec = true;
					}
				}
			}
		}
		var new_request = request_lines.join('\n');
		if (!added_new_codec) {
			new_request = new_request + "a=fmtp:97 profile-level-id=42e01f;level-asymmetry-allowed=1\na=rtcp-fb:97 nack\na=rtcp-fb:97 nack pli\na=rtcp-fb:97 ccm fir\na=rtcp-fb:97 goog-remb\na=rtpmap:97 H264/90000";
		}
	} else {
		var new_request = request;
	}

	return new_request;
}

//
// This function is added to address the issue that Chrome 66, 67 cannot handle incoming SDP without packetization-mode
// or with packetization-mode=0. When this issue happens, Chrome fails peerConnection.SetLocalDescription() call, which
// further causes JSSIP 500 Internal Error towards incoming request.
//
// This bug affects ZVRS Z20 (no packetization-mode) and ZVRS i3 (packetization-mode=0), along with Global Android device
//
// The fix: adding or replacing the packetization-mode so that the incoming SDP always contains packetization-mode=1.
//
//
//
function edit_request_with_packetizationmode(request) {
	console.log("EDITING REQUEST with packetization-mode=1");

	if (request !== undefined) {
		var request_lines = request.split('\n');
		for (var i = 0; i < request_lines.length; i++) {
			if (request_lines[i].includes("profile-level-id")) {
				if (!request_lines[i].includes("packetization-mode")) { // add if does not include - Z20
					request_lines[i] = request_lines[i] + ";packetization-mode=1";
					console.log("ADD incoming SDP with packetization-mode=1");
				}

				if (request_lines[i].includes("packetization-mode=0")) { // change it to packetiation-mode 1
					request_lines[i].replace("packetization-mode=0", "packetization-mode=1");
					console.log("REPALCE with packetization-mode=1");
				}
			}

		}
		var new_request = request_lines.join('\n');
	} else {
		var new_request = request;
	}

	return new_request;
}

// Used to exit fullscreen if active when call is teminated
function exitFullscreen() {
	if (document.fullscreenElement) {
		document.exitFullscreen();
	} else if (document.msExitFullscreen) {
		document.msExitFullscreen();
	} else if (document.mozCancelFullScreen) {
		document.mozCancelFullScreen();
	} else if (document.webkitExitFullscreen) {
		document.webkitExitFullscreen();
	}
}

function changeCaption(id) {
	var value = id.split('-')[1];
	var target = id.split('-')[0];

	if (target == 'bg') {
		var alpha = $('#opacity-slider-agent').val();
		if (alpha == 0) {
			alpha = 1;
			$('#opacity-slider-agent').val(1);
		}
		var color;
		switch (value) {
			case 'black':
				color = 'rgba(0,0,0,' + alpha + ')';
				break;
			case 'grey':
				color = 'rgba(128,128,128,' + alpha + ')';
				break;
			case 'white':
				color = 'rgba(255,255,255,' + alpha + ')';
				break;
		}
		document.documentElement.style.setProperty('--caption-bg-color', color);
	} else if (target == 'font') {
		document.documentElement.style.setProperty('--caption-font-color', value);
	} else {
		document.documentElement.style.setProperty('--caption-font-size', id + 'rem');
	}
}

$('#bg-transparent').click(function () {
	$('#opacity-slider-agent').val(0);
	$('#opacity-slider-agent').trigger('mousemove');
})

$('#opacity-slider-agent').on('change mousemove', function () {
	var alpha = $(this).val();
	var current = document.documentElement.style.getPropertyValue('--caption-bg-color');
	if (current == '') { current = 'rgba(128,128,128,0'; }
	var color = current.substring(0, current.lastIndexOf(',') + 1) + alpha + ')';
	document.documentElement.style.setProperty('--caption-bg-color', color);
})


function mirrorMode(elementName, isMirror) {
	let videoElements = document.getElementsByClassName(elementName);
	for (let i = 0; i < videoElements.length; i++) {
		let v = videoElements[i];
		if (isMirror) {
			console.log("Adding Mirror Mode to " + elementName)
			v.classList.add('mirror-mode');
		} else {
			console.log("Removing Mirror Mode from " + elementName)
			v.classList.remove('mirror-mode');
		}
	}
}

var demo_running = false;
function testCaptions() {

	if (!demo_running) {
		demo_running = true;
		var temp = document.createElement("div");
		temp.classList.add("transcripttext");

		document.getElementById("transcriptoverlay").appendChild(temp);
		temp.innerHTML = 'Hi - I am having trouble with captions on my TV';

		var count = 0;
		var intervalId = window.setInterval(function () {
			switch (count) {
				case 0:
					temp.innerHTML = "They were working fine all day yesterday, but, stopped at 4:00";
					break;
				case 1:
					temp.innerHTML = 'Do you think that will fix the problem?';
					break;
				case 2:
					temp.innerHTML = 'Looks like that did it, everything seems to be working again';
					break;
				case 3:
					temp.innerHTML = 'Thanks for the help and have a nice day';
					break;
			}
			count++;

			if (count > 4) {
				window.clearInterval(intervalId);
				temp.innerHTML = '';
				demo_running = false;
			}
		}, 6000);
	} else { console.log('demo running'); }
}
