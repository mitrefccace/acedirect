var ua;
var my_sip_uri = document.getElementById("my_sip_uri");
var ws_servers = document.getElementById("ws_servers");
var pc_config = document.getElementById("pc_config");
var sip_password = document.getElementById("sip_password");
var currentSession;
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
var recording_progress_bar = document.getElementById("recording-progress-bar");
var debug = true; //console logs event info if true
var jssip_debug = false; //enables debugging logs from jssip library if true NOTE: may have to refresh a lot to update change
var maxRecordingSeconds = 90;

//VIDEOMAIL recording progress bar
var recordId = null;

function startRecordProgress() {
	if ($('#record-progress-bar').css('display') == 'none')
		return;

	if (recordId)
		return;
	$('#vmsent').hide();
	$('#vmwait').hide();
	$('#callbutton').prop("disabled", true);
	$('#videomailbutton').prop("disabled", true);
	$('#userformbtn').prop("disabled", true);
	var secremain = maxRecordingSeconds;
	var seconds = 0;
	recordId = setInterval(myFunc, 1000);
	seconds = 0;

	function myFunc() {
		if (seconds >= maxRecordingSeconds) {
			terminate_call();
			stopRecordProgress();
		} else {
			seconds++;
			secremain--;
			percentage = (seconds / maxRecordingSeconds) * 100;
			$('#record-progress-bar').css('width', percentage.toFixed(0) + '%');
			$('#secsremain').html('&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;' + secremain + ' seconds remaining');
			$('#recordicon').show();
		}
	}
}

function stopRecordProgress() {
	$('#record-progress-bar').hide();
	$('#secsremain').html('');
	$('#recordicon').hide();
	$('#record-progress-bar').css('width', '0%');
	$('#record-progress-bar').hide();
	$('#userformbtn').prop("disabled", false);

	if (recordId) {
		$('#vmsent').hide();
		$('#vmwait').hide();
		$('#vmsent').attr('hidden', false);
		$('#vmsent').show();
		setTimeout(function () {
			$("#vmsent").fadeTo(3000, 0).slideUp(500, function () {
				$(this).remove();
				//this append must be in sync with .ejs file element
				$("#vmsent_placeholder").append('<div class="alert alert-success" alert-dismissable id="vmsent" style="margin-top: 10px;" hidden> <a class="close" onclick="$(\'#vmsent\').hide();" style="text-decoration:none">×</a> <strong>Success!</strong> Videomail sent. </div>');
			});
		}, 1000);

		clearInterval(recordId);
		recordId = null;
		if (complaintRedirectActive) {
			$("#redirecttag").attr("href", complaintRedirectUrl);
			$("#redirectdesc").text("Redirecting to " + complaintRedirectDesc + " ...");
			$("#callEndedModal").modal('show');
			setTimeout(function () {
				window.location = complaintRedirectUrl;
			}, 5000);
		}
	}
}


//setup for the call. creates and starts the User Agent (UA) and registers event handlers
function register_jssip() {
	if (jssip_debug) JsSIP.debug.enable('JsSIP:*');
	else JsSIP.debug.disable('JsSIP:*');

	// Create our JsSIP instance and run it:
	var socket = new JsSIP.WebSocketInterface(ws_servers.getAttribute("name"));

	var configuration = {
		sockets: [socket],
		uri: my_sip_uri.getAttribute("name"),
		password: sip_password.getAttribute("name"),
	};

	ua = new JsSIP.UA(configuration);
	ua.start();

	ua.on('newMessage', function (e) {
		if (debug) console.log("\nUA - NEWMESSAGE");
		try {
			if (typeof e.message._request.body === "undefined" ) {
				console.log('NO CAPTIONS SENT');
			} else if (e.message._request.body == 'STARTRECORDING') {
				startRecordProgress();
			} else {
				var transcripts = JSON.parse(e.message._request.body);

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
							$('#caption-messages').append("<div class='agent-scripts'><div class='direct-chat-text'>" + transcripts.transcript + "</div></div>")
							setTimeout(function () { tDiv.remove() }, 5000);
						}
					}
				}
			}
		} catch (err) {
			console.log(err);
		}
	 //Caption block end --------------

	});

ua.on('newRTCSession', function (e) {

	currentSession = e.session;

	currentSession.on('accepted', function (e) {

		if (debug) console.log('\nCURRENTSESSION -  ACCEPTED: \nRESPONSE: \n' + e.response + "\nORIGINATOR:\n" + e.originator);
		toggle_incall_buttons(true);
		start_self_video();
		$("#start-call-buttons").hide();
	});
	currentSession.on('ended', function (e) {
		if (debug) console.log('\nCURRENTSESSION -  ENDED: \nORIGINATOR: \n' + e.originator + '\nMESSAGE:\n' + e.message + "\nCAUSE:\n" + e.cause);
		terminate_call();
		clearScreen();

		unregister_jssip();
		stopRecordProgress();

	});
	currentSession.on('failed', function (e) {
		if (debug) console.log('\nCURRENTSESSION -  FAILED: \nMESSAGE:\n' + e.message + "\nCAUSE:\n" + e.cause + "\nORIGINATOR:\n" + e.originator);
		terminate_call();

	});
	currentSession.on('reinvite', function (e) {
		if (debug) console.log('\nCURRENTSESSION -  REINVITE ');
		$("#queueModal").modal("hide"); //reinvite is the only flag we get that the call is fully connected. so we have to hide the modal here.
	});
	//event listener for remote video. Adds to html page when ready.
	//NOTE: has to be both here and in accept_call() because currentSession.connection is not established until after ua.answer() for incoming calls
	if (currentSession.connection) currentSession.connection.ontrack = function (e) {
		if (debug) console.log("STARTING REMOTE VIDEO\ne.streams: " + e.streams + "\ne.streams[0]: " + e.streams[0]);
		remoteStream.srcObject = e.streams[0];
		//remoteStream.play(); //trying without, per VATRP example
		toggleSelfview();
	};

});
}

//makes a call
//@param other_sip_uri: is the sip uri of the person to call
function start_call(other_sip_uri) {
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

	if (debug) console.log("CALL FROM " + my_sip_uri.getAttribute("name") + " TO " + other_sip_uri);
	ua.call(other_sip_uri, options);
}


function toggleSelfview() {
	setTimeout(function () {
		hide_video();
		setTimeout(function () {
			unhide_video();
		}, 1000);
	}, 3000);
}

//answers an incoming call
function accept_call() {
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
			remoteStream.srcObject = e.streams[0];
			remoteStream.play();
			$('#remoteView').removeClass('mirror-mode');
			toggleSelfview();
		};
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


function transfer_to_videomail() {
	if (currentSession) {
		currentSession.sendDTMF(1);

		$('#vmwait').show();
		swap_video();
		$('#vmsent').hide();
		videomailflag = true;
		$('#record-progress-bar').show();
		$('#callbutton').prop("disabled", true);
		$('#userformbtn').prop("disabled", true);
		$("#videomailbutton").prop("disabled", true);

	}
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
	$("#agent-name-box").hide();
	$("#agent-name").text("");
	exitFullscreen();
	$('#transcriptoverlay').html('');

        if (complaintRedirectActive || !isOpen) {
          $("#redirecttag").attr("href", complaintRedirectUrl);
          $("#redirectdesc").text("Redirecting to " + complaintRedirectDesc + " ...");
          $("#callEndedModal").modal('show');
          setTimeout(function () {
            window.location = complaintRedirectUrl;
          }, 5000);
        }
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
	selfStream.pause();
	remoteStream.pause();
	//selfStream.src = ""; //removed- causing exceptions on hangup
	//remoteView.src = ""; //removed- causing exceptions on hangup

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
				console.log("consumer removed camera");
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
	selfView.classList.add("mirror-mode");
	selfView.muted = true;
	selfView.setAttribute("hidden", true);
	remoteStream = document.getElementById("remoteView");
	selfStream = document.getElementById("selfView");

	toggle_incall_buttons(false);

}

//swaps remote and local videos for videomail recording
//puts Consumer's own video in the big video
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
	newElement.innerHTML = html;
	p.appendChild(newElement);
}

// Removes an element from the document
function removeElement(elementId) {
	var element = document.getElementById(elementId);
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

//hide/unhide captions
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
		selfStream.classList.remove("mirror-mode");
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
				selfStream.classList.add("mirror-mode")
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

// Used to exit fullscreen if active when call is teminated
function exitFullscreen() {
	if (document.fullscreen) {
		if (document.exitFullscreen) {
			document.exitFullscreen();
		} else if (document.msExitFullscreen) {
			document.msExitFullscreen();
		} else if (document.mozCancelFullScreen) {
			document.mozCancelFullScreen();
		} else if (document.webkitExitFullscreen) {
			document.webkitExitFullscreen();
		}
	}
}

// Change the style of the video captions
function changeCaption(id) {
	var value = id.split('-')[1];
	var target = id.split('-')[0];

	// change css variable value
	if (target == 'bg') {
		var alpha = $('#opacity-slider-consumer').val();
		if (alpha == 0) {
			alpha = 1;
			$('#opacity-slider-consumer').val(1);
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
	$('#opacity-slider-consumer').val(0);
	$('#opacity-slider-consumer').trigger('mousemove');
})

$('#opacity-slider-consumer').on('change mousemove', function () {
	var alpha = $(this).val();
	var current = document.documentElement.style.getPropertyValue('--caption-bg-color');
	if (current == '') { current = 'rgba(128,128,128,0'; }
	var color = current.substring(0, current.lastIndexOf(',') + 1) + alpha + ')';
	document.documentElement.style.setProperty('--caption-bg-color', color);
})

// Run caption demo
var demo_running = false;
function testCaptions() {

	if (!demo_running) {
		demo_running = true;

		var temp = document.createElement("div");
		temp.classList.add("transcripttext");

		document.getElementById("transcriptoverlay").appendChild(temp);
		temp.innerHTML = 'Hello, how can I help you today?';
		var count = 0;
		var intervalId = window.setInterval(function () {
			switch (count) {
				case 0:
					temp.innerHTML = "No problem, I'll just need your account number";
					break;
				case 1:
					temp.innerHTML = 'You are all set. Thank you for your patience';
					break;
				case 2:
					temp.innerHTML = 'Is there anything else I can help you with today?';
					break;
				case 3:
					temp.innerHTML = 'Have a nice day.';
					break;
			}
			count++;

			if (count > 4) {
				window.clearInterval(intervalId);
				temp.innerHTML = ''
				demo_running = false;
			}
		}, 6000);
	} else { console.log('demo running') }


}

	// Clear caption text
