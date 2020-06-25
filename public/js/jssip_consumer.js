	var ua;
	var my_sip_uri = document.getElementById("my_sip_uri");
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
		$('#vmsent').hide();
		$('#vmwait').hide();

		if (recordId) {
			clearInterval(recordId);
			recordId = null;
			$('#vmsent').show();
			if (complaintRedirectActive || isOpen) {
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
	// This uses the new ACE Kurento object rather than JsSIP
	function register_jssip(myExtension, myPassword) {
		console.log('Registering: ' + myExtension + ',' + myPassword);

		var eventHandlers = {
			'connected': function (e) {
				console.log('--- WV: Connected ---\n');
			},
			'accepted': function (e) {
				console.log('--- WV: UA accepted ---\n');
			},
			'newMessage': function (e) {
				console.log('--- WV: New Message ---\n');
		 		try {
					var transcripts = JSON.parse(e.msg);
					//var transcripts = JSON.parse(e.msg._request.body)
					//var transcripts = JSON.parse(e.message._request.body)
		 			if(transcripts.transcript){
						console.log('--- WV: transcripts.transcript ---\n');
		 				var tDiv = document.getElementById(transcripts.msgid);
		 				if(!tDiv) {
		 					var temp = document.createElement("div");
		 					temp.id = transcripts.msgid;
		 					temp.innerHTML = transcripts.transcript;
		 					temp.classList.add("transcripttext");
		 					document.getElementById("transcriptoverlay").appendChild(temp);
		 				} else {
		 					tDiv.innerHTML = transcripts.transcript;
		 					if(transcripts.final){
								setTimeout(function(){tDiv.remove();},5000);

								//var captionBubble = '<div><b>' +transcripts.timestamp + ':</b>&nbsp;'+transcripts.transcript+'<br/><div>';
								//$(captionBubble).appendTo($("#caption-messages"));
								$('#caption-messages').append("<div class='agent-scripts'><div class='direct-chat-text'>"+transcripts.transcript+"</div></div>");
								$("#caption-messages").scrollTop($("#caption-messages")[0].scrollHeight);
		 					}
		 				}
		 			}
		 		} catch (err) {
		 			console.log(err);
		 		}
			},
			'registerResponse': function (error) {
				console.log('--- WV: Register response:', error || 'Success ---');
				if(!error) {
				}
			},
			'pausedQueue': function (e) {
				console.log('--- WV: Paused Agent Member in Queue ---\n');
			},
			'unpausedQueue': function (e) {
				console.log('--- WV: Unpaused Agent Member in Queue ---\n');
			},
			'callResponse': function (e) {
				console.log('--- WV: Call response ---\n', e);
			},
			'incomingCall': function (call) {
				console.log('--- WV: Incoming call ---\n');
			},
			'progress': function(e) {
				console.log('--- WV: Calling... ---\n');
			},
			'startedRecording': function (e) {
				console.log('--- WV: Started Recording:', (e.success) ? 'Success ---' : 'Error ---');
				if (e.success) {
				}
			},
			'stoppedRecording': function (e) {
				console.log('--- WV: Stopped Recording:', (e.success) ? 'Success ---' : 'Error ---');
				if (e.success) {
				}
			},
			'failed': function(e) {
				console.log('--- WV: Failed ---\n' + e);
			},
			'ended': function(e) {
				console.log('--- WV: Call ended ---\n');

                                terminate_call();
                                clearScreen();
				disable_chat_buttons();
				enable_initial_buttons();
				$("#start-call-buttons").show();
				$("#agent-name-box").hide();
				$("#agent-name").text("");

			},
			'participantsUpdate': function(e) {
				console.log('--- WV: Participants Update ---\n');
				console.log('--- WV: ' + JSON.stringify(e));
				console.log('--- WV: e.participants.length: ' + e.participants.length);
				var partCount = e.participants.filter(t=>t.type == "participant:webrtc").length;

				console.log("--- WV: partCount: " + partCount);

				if (partCount >=2 ) {
					console.log("--- WV: CONNECTED");
					$("#queueModal").modal("hide");

					toggle_incall_buttons(true);
					start_self_video();
					$("#start-call-buttons").hide();
				}

			}

		};
		acekurento.eventHandlers = Object.assign(acekurento.eventHandlers, eventHandlers);
		acekurento.register(myExtension, myPassword, false);
	}

	//makes a call
	/*
	* Use acekurento object to make the call. Not sure about the extension
	*/
	function start_call(other_sip_uri, myExtension) {
          console.log("start_call: " + other_sip_uri);
		  selfStream.removeAttribute("hidden");
		  $("#screenshareButton").removeAttr('disabled');
		  $("#fileInput").removeAttr('disabled');
		  $("#shareFileConsumer").removeAttr('disabled');
		  $("#downloadButton").removeAttr('disabled');
          //acekurento.call(globalData.queues_complaint_number, false);
          acekurento.call(other_sip_uri, false);
	}

	function toggleSelfview() {
		setTimeout(function () {
			hide_video();
			setTimeout(function () {
				unhide_video();
			}, 1000);
		}, 3000);
	}

	//starts the local streaming video. Works with some older browsers, if it is incompatible it logs an error message, and the selfStream html box stays hidden
	function start_self_video() {
          //not needed?
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
		if (acekurento !== null) {
			acekurento.stop(false);
			acekurento = null;
		}
		document.getElementById("screenshareButton").disabled = true;
		$("#screenshareButton").prop('disabled',true);
		$("#fileInput").prop('disabled',true);
		$("#shareFileConsumer").prop('disabled',true);
		$("#downloadButton").prop('disabled',true);
		$("#screenshareButtonGroup").hide();
		clearScreen();
		remove_video();
		disable_chat_buttons();
		enable_initial_buttons();
		$("#start-call-buttons").show();
		$("#agent-name-box").hide();
		$("#agent-name").text("");
		exitFullscreen();
		$('#transcriptoverlay').html('');
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
		remoteView.setAttribute("poster", "images/acedirect-logo-trim.png");
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
                if (acekurento !== null) {
		  acekurento.remoteStream = document.getElementById('remoteView');
                  acekurento.selfStream = document.getElementById('selfView');
                }
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
                if (acekurento !== null) {
                  acekurento.enableDisableTrack(true, true); //mute audio
				  mute_audio_button.setAttribute("onclick", "javascript: unmute_audio();");
                  mute_audio_icon.classList.add("fa-microphone-slash");
                  mute_audio_icon.classList.remove("fa-microphone");
                }
	}

	//unmutes self audio so remote can hear you
	function unmute_audio() {
                if (acekurento !== null) {
                  acekurento.enableDisableTrack(false, true); //unmute audio
                  mute_audio_button.setAttribute("onclick", "javascript: mute_audio();");
                  mute_audio_icon.classList.add("fa-microphone");
                  mute_audio_icon.classList.remove("fa-microphone-slash");
                }
	}

	//hide/unhide captions
	function mute_captions() {
                if(mute_captions_icon.style.display === "none"){
                        mute_captions_icon.style.display = "block";
                        transcript_overlay.style.display = "none";
                } else {
                        mute_captions_icon.style.display = "none";
                        transcript_overlay.style.display = "block";
                }
        }

	//hides self video so remote cannot see you
	function hide_video() {
                if (acekurento !== null) {
                  acekurento.enableDisableTrack(true, false); //mute video
                  selfStream.setAttribute("hidden", true);
                }
	}

	//unhides self video so remote can see you
	function unhide_video() {
                if (acekurento !== null) {
                  acekurento.enableDisableTrack(false, false); //unmute video
                  selfStream.removeAttribute("hidden");
                }
	}

	function enable_video_privacy() {
                if (acekurento !== null) {
				  selfStream.classList.remove("mirror-mode");
                  acekurento.enableDisableTrack(true, false); //mute video
                  hide_video_button.setAttribute("onclick", "javascript: disable_video_privacy();");
                  hide_video_icon.style.display = "block";
                  acekurento.privateMode(true, globalData.privacy_video_url);
                }
	}

	function disable_video_privacy() {
                if (acekurento !== null) {

				  selfStream.classList.add("mirror-mode");
                  acekurento.enableDisableTrack(false, false); //unmute video
                  hide_video_button.setAttribute("onclick", "javascript: enable_video_privacy();");
                  hide_video_icon.style.display = "none";
                  acekurento.privateMode(false);
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
		if(target == 'bg'){
			var alpha = $('#opacity-slider-consumer').val();
			if ( alpha == 0 ) {
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
		} else if(target == 'font'){
			document.documentElement.style.setProperty('--caption-font-color', value);
		} else {
			document.documentElement.style.setProperty('--caption-font-size', id + 'rem');
		}
	}

	$('#bg-transparent').click(function() {
		$('#opacity-slider-consumer').val(0);
		$('#opacity-slider-consumer').trigger('mousemove');
	});

	$('#opacity-slider-consumer').on('change mousemove', function() {
		var alpha = $(this).val();
		var current = document.documentElement.style.getPropertyValue('--caption-bg-color');
		if (current == '') {current = 'rgba(128,128,128,0';}
		var color = current.substring(0,current.lastIndexOf(',')+1) + alpha + ')';
		document.documentElement.style.setProperty('--caption-bg-color', color);
	});

	// Run caption demo
	var demo_running = false;
	function testCaptions() {

		if(!demo_running) {
			demo_running = true;

			var temp = document.createElement("div");
			temp.classList.add("transcripttext");

			document.getElementById("transcriptoverlay").appendChild(temp);
			temp.innerHTML = 'Hello, how can I help you today?';
			var count = 0;
			var intervalId = window.setInterval(function() {
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

				if(count > 4) {
					window.clearInterval(intervalId);
					temp.innerHTML = '';
					demo_running = false;
				}
			}, 6000);
		} else { console.log('demo running'); }


	}

	// Clear caption text
