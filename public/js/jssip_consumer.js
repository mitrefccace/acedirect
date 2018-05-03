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
	var hide_video_icon = document.getElementById("hide-video-icon");
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
		// $('#callbutton').prop("disabled", true);
		// $('#videomailbutton').prop("disabled", false);
		$('#userformbtn').prop("disabled", false);
		$('#vmsent').hide();
		$('#vmwait').hide();

		if (recordId) {
			clearInterval(recordId);
			recordId = null;
			$('#vmsent').show();
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
			if (complaintForm && e.message.content == 'STARTRECORDING')
				startRecordProgress();
		});
		ua.on('newRTCSession', function (e) {
			//e.request.body = edit_request(e.request.body);
			currentSession = e.session;

			currentSession.on('accepted', function (e) {
				//e.response = edit_response(e.response);
				if (debug) console.log('\nCURRENTSESSION -  ACCEPTED: \nRESPONSE: \n' + e.response + "\nORIGINATOR:\n" + e.originator);
				toggle_incall_buttons(true);
				start_self_video();
				$("#start-call-buttons").hide();
			});
			currentSession.on('ended', function (e) {
				if (debug) console.log('\nCURRENTSESSION -  ENDED: \nORIGINATOR: \n' + e.originator + '\nMESSAGE:\n' + e.message + "\nCAUSE:\n" + e.cause);
				terminate_call();

				unregister_jssip();
				stopRecordProgress();

			});
			currentSession.on('failed', function (e) {
				if (debug) console.log('\nCURRENTSESSION -  FAILED: \nMESSAGE:\n' + e.message + "\nCAUSE:\n" + e.cause + "\nORIGINATOR:\n" + e.originator);
				terminate_call();
				
			});
			currentSession.on('newInfo', function (e) {
				if (debug) console.log('\nCURRENTSESSION -  NEWINFO: \nINFO:\n' + e.info + "\nrequest:\n" + e.request);
				startRecordProgress(); //newInfo gets called repeatedly during a call
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
				remoteStream.play();

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

				toggleSelfview()
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
					//var getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

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
		// if(ua) ua.stop(); 
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
		selfStream.src = "";
		remoteView.src = "";

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
				if (window.self_stream.getVideoTracks()[0]) window.self_stream.getVideoTracks()[0].stop();
			}
		}
		removeElement("selfView");
		removeElement("remoteView");
		addElement("webcam", "video", "remoteView");
		remoteView.setAttribute("autoplay", "autoplay");
		remoteView.setAttribute("poster", "images/acedirect-logo-trim.png");
		addElement("webcam", "video", "selfView");
		selfView.setAttribute("style", "right: 11px");
		selfView.setAttribute("autoplay", "autoplay");
		selfView.setAttribute("muted", true);
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


	//hides self video so remote cannot see you
	function hide_video() {

		if (currentSession) {
			currentSession.mute({
				audio: false,
				video: true
			});
			hide_video_button.setAttribute("onclick", "javascript: unhide_video();");
			selfStream.setAttribute("hidden", true);
			hide_video_icon.style.display = "block";
		}
	}

	//unhides self video so remote can see you
	function unhide_video() {
		if (currentSession) {
			currentSession.unmute({
				audio: false,
				video: true
			});
			hide_video_button.setAttribute("onclick", "javascript: hide_video();");
			selfStream.removeAttribute("hidden");
			hide_video_icon.style.display = "none";
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