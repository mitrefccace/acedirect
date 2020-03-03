var socket;
var asterisk_sip_uri;
var exten;
var abandoned_caller;
var videomailflag = false;
var switchQueueFlag = false;
var isOpen = true;
var startTimeUTC = "14:00"; //start time in UTC
var endTimeUTC = "21:30"; //end time in UTC
var skinny = false;

$(document).ready(function () {
	//formats the phone number.
	$("[data-mask]").inputmask();

	//JSSIP components
	$('#login-full-background').hide();
	$('#login-box').hide();
	$('#webcam').removeAttr("hidden");
	$('#webcam').show();

	$('#complaint').keyup(function () {
		var left = 2000 - $(this).val().length;
		if (left < 0) {
			left = 0;
		}
		$('#complaintcounter').text(left);
	});

	$('#newchatmessage').keyup(function () {
		var left = 500 - $(this).val().length;
		if (left < 0) {
			left = 0;
		}
		$('#chatcounter').text(left);
	});
	connect_socket();

	// chat-transcript toggle
	$('#chat-tab').on('click', function(){
		$('#chat-body').css('display', 'block')
		$('#chat-footer').css('display', 'block')
		$('#trans-body').css('display', 'none')
	});
	$('#trans-tab').on('click', function(){
		$('#chat-body').css('display', 'none')
		$('#chat-footer').css('display', 'none')
		$('#trans-body').css('display', 'block')
	});
});


function connect_socket() {
	console.log('connect_socket to ');
	console.log(window.location.host);
	$.ajax({
		url: './token',
		type: 'GET',
		dataType: 'json',
		success: function (data) {
			console.log(JSON.stringify(data));
			if (data.message === "success") {
				socket = io.connect('https://' + window.location.host, {
					path: nginxPath + '/socket.io',
					query: 'token=' + data.token,
					forceNew: true
				});

				//update the version and year in the footer
				socket.on('adversion', function (data) {
					$('#ad-version').text(data.version);
					$('#ad-year').text(data.year);
				});

				socket.on('connect', function () {
					console.log("got connect");
					console.log('authenticated');

					var payload = jwt_decode(data.token);
					$('#firstName').val(payload.first_name);
					$('#lastName').val(payload.last_name);
					$('#callerPhone').val(payload.vrs);
					$('#callerEmail').val(payload.email);
					$('#displayname').val(payload.first_name + ' ' + payload.last_name);
					isOpen = payload.isOpen;
					if (!isOpen) { //after hours processing; if after hours, then show this modal
						$("#afterHoursModal").modal({
							backdrop: "static"
						});
						$("#afterHoursModal").modal("show");
					}

					//get the start/end time strings for the after hours dialog
					var tz = convertUTCtoLocal(payload.startTimeUTC).split(' ')[2];
					startTimeUTC = convertUTCtoLocal(payload.startTimeUTC).substring(0, 8); //start time in UTC
					endTimeUTC = convertUTCtoLocal(payload.endTimeUTC).substring(0, 8); //end time in UTC
					$('#ah-start-time').text(startTimeUTC);
					$('#ah-end-time').text(endTimeUTC + " " + tz);


					socket.emit('register-client', {
						"hello": "hello"
					});
					socket.emit('register-vrs', {
						"hello": "hello"
					});
				}).on('ad-ticket-created', function (data) {
					console.log("got ad-ticket-created");
					$('#userformoverlay').removeClass("overlay").hide();
					if (data.zendesk_ticket) {
						$('#firstName').val(data.first_name);
						$('#lastName').val(data.last_name);
						$('#callerPhone').val(data.vrs);
						$('#callerEmail').val(data.email);
						$('#ticketNumber').text(data.zendesk_ticket);
					} else {
						$("#ZenDeskOutageModal").modal('show');
						$('#userformbtn').prop("disabled", false);
					}
				}).on('extension-created', function (data) {
					console.log("got extension-created");
					if (data.message === 'success') {
						$('#outOfExtensionsModal').modal('hide');
						var extension = data.extension; //returned extension to use for WebRTC
						exten = data.extension;
						$('#display_name').val(data.extension);
						if (data.ws_port !== "")
							$('#ws_servers').attr("name", "wss://" + data.asterisk_public_hostname + ":" + data.ws_port + "/ws");
						else
							$('#ws_servers').attr("name", "wss://" + data.asterisk_public_hostname + "/ws");

						$('#my_sip_uri').attr("name", "sip:" + data.extension + "@" + data.asterisk_public_hostname);

						//is this a videomail call or complaint call?
						if (videomailflag)
							asterisk_sip_uri = "sip:" + data.queues_videomail_number + "@" + data.asterisk_public_hostname;
						else
							asterisk_sip_uri = "sip:" + data.queues_complaint_number + "@" + data.asterisk_public_hostname;

						//get the max videomail recording seconds
						maxRecordingSeconds = data.queues_videomail_maxrecordsecs;

						//get complaint redirect options
						complaintRedirectActive = data.complaint_redirect_active;
						complaintRedirectDesc = data.complaint_redirect_desc;
						complaintRedirectUrl = data.complaint_redirect_url;
						$("#redirecttag").attr("href", complaintRedirectUrl);
						$("#redirectdesc").text("Redirecting to " + complaintRedirectDesc + " ...");

						$('#sip_password').attr("name", data.password);
						$("#pc_config").attr("name", "stun:" + data.stun_server);
						register_jssip(); //register with the given extension
						start_call(asterisk_sip_uri); //calling asterisk to get into the queue
					} else if (data.message === 'OutOfExtensions') {
						console.log('out of extensions...')
						//Try again in 10 seconds.
						$('#outOfExtensionsModal').modal({
							show: true,
							backdrop: 'static',
							keyboard: false
						});
						let i = 10;
						var newExtensionRetryCounter = setInterval(function () {

								document.getElementById("newExtensionRetryCounter").innerHTML =  i;
								i-- || (clearInterval(newExtensionRetryCounter), extensionRetry());
							}, 1000);
					} else {
						console.log('Something went wrong when getting an extension')
					}
				}).on('chat-message-new', function (data) {
					var msg = data.message;
					var displayname = data.displayname;
					var timestamp = data.timestamp;

					msg = msg.replace(/:\)/, '<i class="fa fa-smile-o fa-2x"></i>');
					msg = msg.replace(/:\(/, '<i class="fa fa-frown-o fa-2x"></i>');

					var msgblock = document.createElement('div');
					var msginfo = document.createElement('div');
					var msgsender = document.createElement('span');
					var msgtime = document.createElement('span');
					var msgtext = document.createElement('div');

					if ($("#displayname").val() === displayname) {
						$(msgsender).addClass("direct-chat-name pull-right").html(displayname).appendTo(msginfo);
						$(msgtime).addClass("direct-chat-timestamp pull-left").html(timestamp).appendTo(msginfo);
						$(msginfo).addClass("direct-chat-info clearfix").appendTo(msgblock);
						$(msgtext).addClass("direct-chat-text").html(msg).appendTo(msgblock);
						$(msgblock).addClass("direct-chat-msg right").appendTo($("#chat-messages"));
					} else {
						$('#rtt-typing').html('');

						$(msgsender).addClass("direct-chat-name pull-left").html(displayname).appendTo(msginfo);
						$(msgtime).addClass("direct-chat-timestamp pull-right").html(timestamp).appendTo(msginfo);
						$(msginfo).addClass("direct-chat-info clearfix").appendTo(msgblock);
						$(msgtext).addClass("direct-chat-text").html(msg).appendTo(msgblock);
						$(msgblock).addClass("direct-chat-msg").appendTo($("#chat-messages"));
					}

					$("#chat-messages").scrollTop($("#chat-messages")[0].scrollHeight);

				}).on('typing', function (data) {
					if ($("#displayname").val() !== data.displayname) {
						$('#rtt-typing').html(data.displayname + ": " + data.rttmsg);
					}
				}).on('typing-clear', function (data) {
					if ($("#displayname").val() !== data.displayname) {
						$('#rtt-typing').html('');
					}
				}).on('disconnect', function () {
					console.log('disconnected');
					unregister_jssip();
					logout("disconnected");
				}).on("unauthorized", function (error) {
					if (error.data.type === "UnauthorizedError" || error.data.code === "invalid_token") {
						logout("Session has expired");
					}
				}).on("caption-config", function (data) {
					if(data == 'false'){
						$('#caption-settings').css('display', 'none');
						$('#transcriptoverlay').css('display', 'none');
						$('#mute-captions').css('display', 'none');
						$('#trans-tab').css('display', 'none');
						$('#chat-tab').removeClass('tab active-tab');
					}
				}).on("skinny-config", function (data) {
					if (data === "true") {
						$("#ticket-section").attr("hidden", true);
						$("#vrs-info-box").attr("hidden", true);
						$("#video-section").removeClass(function (index, className) {
							return (className.match(/\bcol-\S+/g) || []).join(' ');
						});
						$("#video-section").addClass("col-lg-7");
						$("#chat-section").removeClass(function (index, className) {
							return (className.match(/\bcol-\S+/g) || []).join(' ');
						});
						$("#chat-section").addClass("col-lg-5");
						$("#caption-settings").attr("hidden", true);
						$("#trans-tab").attr("hidden", true);
						skinny = true;
					} else {
						$("#ticket-section").removeAttr("hidden");
						$("#vrs-info-box").removeAttr("hidden");
						$("#video-section").removeClass(function (index, className) {
							return (className.match(/\bcol-\S+/g) || []).join(' ');
						});
						$("#video-section").addClass("col-lg-5");
						$("#chat-section").removeClass(function (index, className) {
							return (className.match(/\bcol-\S+/g) || []).join(' ');
						});
						$("#chat-section").addClass("col-lg-3");
						$("#callbutton").attr("disabled", "disabled");
						$("#newchatmessage").attr("disabled", "disabled");
						$("#chat-send").attr("disabled", "disabled");
						$("#caption-settings").removeAttr("hidden");
						$("#trans-tab").removeAttr("hidden");
						skinny = false;
					}
				}).on('queue-caller-join', function (data) {
					if (data.extension == exten && data.queue == "ComplaintsQueue") {
						set_queue_text(--data.position); //subtract because asterisk wording is off by one
					}
					console.log("queue caller join");
				}).on('queue-caller-leave', function (data) {
					if (data.queue == "ComplaintsQueue") {
						var current_position = $("#pos-in-queue").text();
						if (!abandoned_caller) { //abandoned caller triggers both leave and abandon event. this prevents duplicate removes.
							set_queue_text(--current_position);
						}
						console.log("queue caller leave");
						abandoned_caller = false;
					}
				}).on('queue-caller-abandon', function (data) {
					if (data.queue == "ComplaintsQueue") {
						var current_position = $("#pos-in-queue").text();
						current_position++;
						if (current_position > data.position) { //checks if the abandoned caller was ahead of you
							var current_position = $("#pos-in-queue").text();
							set_queue_text(--current_position);
						}
						console.log("queue caller abandon");
						abandoned_caller = true;
					}
				}).on("agent-name", function (data) {
					if (data.agent_name != null || data.agent_name != "" || data.agent_name != undefined) {
						var firstname = data.agent_name.split(" ");
						$("#agent-name").text(firstname[0]);
						$("#agent-name-box").show();
					}
				}).on("agents", function (data) {
                                  if (data.agents_logged_in) {
	                            $("#agents-avail").text('');
                                  } else {
	                            $("#agents-avail").text('No representatives are available to take your call at this time.');
                                  }
                                }).on("chat-leave", function (error) {
					//clear chat
					$('#chatcounter').text('500');
					$('#chat-messages').html('');
					$('#caption-messages').html('');
					$('#rtt-typing').html('');
					$('#newchatmessage').val('');

					//reset buttons and ticket form
					$('#ticketNumber').text('');
					$('#complaintcounter').text('2,000');
					$('#complaint').val('');
					$('#subject').val('');

					if (complaintRedirectActive) {
						$("#callEndedModal").modal('show');
						setTimeout(function () {
							window.location = complaintRedirectUrl;
						}, 5000);
					}
				}).on('error', function (reason) {
					if (reason.code === "invalid_token") {
						logout("Session has expired");
					} else {
						logout("An Error Occurred: " + JSON.stringify(reason));
					}
				});

			} else {
				//need to handle bad connections?
			}
		},
		error: function (xhr, status, error) {
			console.log('Error');
			$('#message').text('An Error Occured.');
		}
	});

}

$("#callbutton").click(function () {
	videomailflag = false;
	$('#record-progress-bar').hide();
	$('#vmsent').hide();
	$("#callbutton").prop("disabled", true);
	$('#videomailbutton').prop("disabled", true);
	$("#queueModal").modal({
		backdrop: "static"
	});
	$("#queueModal").modal("show");
	$("#dialboxcallbtn").click(); //may or may not be dead code
	var vrs = $('#callerPhone').val().replace(/^1|[^\d]/g, '');
	socket.emit('call-initiated', {
		"vrs": vrs
	}); //sends vrs number to adserver
	console.log('call-initiated event for complaint');
	enable_chat_buttons();
});

$("#videomailbutton").click(function () {
	$('#videomailModal').modal('show');
});

function startRecordingVideomail(switchQueueFlag) {
	if (switchQueueFlag) {
		$('#videomailModal').modal('hide');
		transfer_to_videomail();
	} else {
		$('#videomailModal').modal('hide');
		$('#vmwait').show();
		swap_video();
		$('#vmsent').hide();
		videomailflag = true;
		$('#record-progress-bar').show();
		$('#callbutton').prop("disabled", true);
		$('#userformbtn').prop("disabled", true);
		//dial into the videomail queue
		$("#videomailbutton").prop("disabled", true);
		var vrs = $('#callerPhone').val().replace(/^1|[^\d]/g, '');
		socket.emit('call-initiated', {
			"vrs": vrs
		}); //sends vrs number to adserver
		console.log('call-initiated event for videomail');
	}
	switchQueueFlag = false;
}

$('#userform').submit(function (evt) {
	evt.preventDefault();
	var subject = $('#subject').val();
	var complaint = $('#complaint').val();
	var vrs = $('#callerPhone').val().replace(/^1|[^\d]/g, '');

	socket.emit('ad-ticket', {
		"vrs": vrs,
		"subject": subject,
		"description": complaint
	});
	$('#userformoverlay').addClass("overlay").show();
	$('#userformbtn').prop("disabled", true);
	$("#callbutton").removeAttr("disabled");

});

function extensionRetry() {
	//$('#newExtensionRetryCounter').timer('remove');
	clearInterval(newExtensionRetryCounter);
	var vrs = $('#callerPhone').val().replace(/^1|[^\d]/g, '');
	socket.emit('call-initiated', {
		"vrs": vrs
	});
}

//Logout the user
$("#notMyInfoLink").click(function (e) {
	e.preventDefault();
	//clear the token from session storage
	sessionStorage.clear();
	//disconnect socket.io connection
	if (socket)
		socket.disconnect();
	//display the login screen to the user.
	window.location.href = './logout'
});

$("#newchatmessage").on('change keydown paste input', function () {
	var value = $("#newchatmessage").val();
	var displayname = $('#displayname').val();
	if (value.length > 0) {
		socket.emit('chat-typing', {
			"displayname": displayname,
			rttmsg: value
		});
	} else {
		socket.emit('chat-typing-clear', {
			"displayname": displayname
		});
	}
});

$('#chatsend').submit(function (evt) {
	evt.preventDefault();

	var msg = $('#newchatmessage').val();
	var displayname = $('#displayname').val();
	var date = moment();
	var timestamp = date.format("D MMM h:mm a");

	$('#newchatmessage').val('');
	$('#chatcounter').text('500');
	console.log("sent message");
	isTyping = false;
	socket.emit('chat-message', {
		"message": msg,
		"timestamp": timestamp,
		"displayname": displayname
	});
});

// Event listener for the full-screen button
function enterFullscreen() {
	var webcam_container = document.getElementById("fullscreen-element");
	var consumer_view = document.getElementById("remoteView");

	if (!document.fullscreenElement && !document.mozFullScreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
		if (webcam_container.requestFullscreen) {
			webcam_container.requestFullscreen();
		} else if (webcam_container.msRequestFullscreen) {
			webcam_container.msRequestFullscreen();
		} else if (webcam_container.mozRequestFullScreen) {
			webcam_container.mozRequestFullScreen();
		} else if (webcam_container.webkitRequestFullscreen) {
			webcam_container.webkitRequestFullscreen();
		}

		$("#remoteView").css("object-fit", "cover");
	} else {

		if (document.exitFullscreen) {
			document.exitFullscreen();
		} else if (document.msExitFullscreen) {
			document.msExitFullscreen();
		} else if (document.mozCancelFullScreen) {
			document.mozCancelFullScreen();
		} else if (document.webkitExitFullscreen) {
			document.webkitExitFullscreen();
		}

		$("#remoteView").css("object-fit", "contain");
	}
}

var fade_timer = null;

function clearFadeTimer() {
	if (fade_timer) {
		clearTimeout(fade_timer);
		fade_timer = 0;
	}
}

function fade(type = 'out') {
	$('#call-option-buttons button').each(function (i) {
		$(this).css('animation', `fade-${type} 0.${i+2}s ease-out forwards`);
	});

	if(type == 'out') {
		$('#transcriptoverlay').css('bottom', '10px')
	} else {
		$('#transcriptoverlay').css('bottom', '65px')
	}
}

$('#fullscreen-element').mousemove(function () {
	clearFadeTimer();
	fade('in');
	fade_timer = setTimeout(fade, 3000);
});

$('#fullscreen-element').mouseleave(function () {
	clearFadeTimer();
	fade_timer = setTimeout(fade, 500);
});

function exit_queue() {
	$('#queueModal').modal('hide');
	terminate_call();
}

function set_queue_text(position) {
	if (position == 0) $("#queue-msg").text("There are no callers ahead of you.");
	else if (position == 1) $("#queue-msg").html('There is <span id="pos-in-queue"> 1 </span> caller ahead of you.');
	else if (position > 1) $("#pos-in-queue").text(position);
	else $("#queue-msg").text("One of our agents will be with you shortly."); //default msg
}

//enables chat buttons on a webrtc call when it is accepted
function enable_chat_buttons() {
	$("#newchatmessage").removeAttr("disabled");
	$("#chat-send").removeAttr("disabled");
	$("#newchatmessage").attr("placeholder", "Type Message ...");
	$("#characters-left").removeAttr("hidden");
	$("#characters-left").show();

}

//disables chat buttons
function disable_chat_buttons() {
	$("#newchatmessage").attr("disabled", "disabled");
	$("#chat-send").attr("disabled", "disabled");
	$("#newchatmessage").attr("placeholder", "Chat disabled");
	$("#characters-left").hide();

}

//restores default buttons after a call is completed
function enable_initial_buttons() {
	if (skinny) {
		$("#callbutton").removeAttr("disabled");
		$("#videomailbutton").removeAttr("disabled");
	} else {
		$("#userformbtn").removeAttr("disabled");
		$("#callbutton").attr("disabled", "disabled");
		$("#videomailbutton").removeAttr("disabled");
	}

}

//convert UTC hh:mm to current time in browser's timezone, e.g., 01:00 PM EST
//accepts UTC hh:mm, e.g., 14:00
//returns hh:mm in browser timezone, e.g., 09:00 AM EST
function convertUTCtoLocal(hhmmutc) {
	var hh = parseInt(hhmmutc.split(":")[0]); //e.g., 14
	var mins = hhmmutc.split(":")[1]; //e.g., 00
	var todaysDate = new Date();
	var yyyy = todaysDate.getFullYear().toString();
	var mm = (todaysDate.getMonth() + 1).toString();
	var dd = todaysDate.getDate().toString();
	var dte = mm + '/' + dd + '/' + yyyy + ' ' + hh + ':' + mins + ' UTC';
	var converteddate = new Date(dte);
	var newdte = converteddate.toString(); //Wed Jan 24 2018 09:00:00 GMT-0500 (EST)
	var arr = newdte.split(" ");
	var newhh = arr[4].split(":")[0];
	var newmin = arr[4].split(":")[1];
	var ampm = "AM";
	if (newhh > 11) ampm = "PM";
	if (newhh > 12) newhh -= 12;
	return newhh + ":" + newmin + " " + ampm + " " + arr[6].replace('(', '').replace(')', '');
}
