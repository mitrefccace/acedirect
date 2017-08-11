var socket;
var extensionMe;
var queueNameMe;
var channelMe;
var ticketTabFade;
var busylight = new Busylight();
var agentStatus = 'OFF';
var away_color;
var ready_color;
var in_call_color;
var hold_color;
var incoming_call_color;
var transferred_call_color;
var wrap_up_color;
var need_assistance_color;
var missed_call_color;
var away_blinking;
var ready_blinking;
var in_call_blinking;
var hold_blinking;
var incoming_call_blinking;
var transferred_call_blinking;
var wrap_up_blinking;
var need_assistance_blinking;
var missed_call_blinking;

setInterval(function () {
	busylight.light(this.agentStatus);
}, 2000);

$(document).ready(function () {
	connect_socket();
	$("#debugtab").hide();
	$('#scriptstab').hide();
	$("#geninfotab").hide();
	$("#complaintstab").hide();
	$("[data-mask]").inputmask();
	//make boxes draggable
	//$('.box').draggable({
	//	cursor: "crosshair"
	//});

	clearScreen();

	$.getJSON("./resources/licenses.json", function (data) {
		$.each(data.license, function (i) {
			$("#licModalBody").append("<h3>" + data.license[i].name + "<h3><pre>" + data.license[i].pre + "</pre>");
		});
	});

	if (window.addEventListener) {
		var state = 0,
			theCode = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
		window.addEventListener("keydown", function (e) {
			if (e.keyCode === theCode[state]) {
				state++;
			} else {
				state = 0;
			}
			if (state === 10) {
				$("#debugtab").show();
			}
		}, true);
	}
});


function connect_socket() {
	//if (sessionStorage.getItem('accesstoken') === null)
	//	logout();
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
					path: '/ACEDirect/socket.io',
					query: 'token=' + data.token,
					forceNew: true
				});

				socket.on('connect', function () {
					debugtxt('connect', {
						"no": "data"
					});
					console.log('authenticated');

					socket.emit("get_color_config");

					//get the payload form the token
					var payload = jwt_decode(data.token);
					$('#loginModal').modal('hide');
					$('#statusmsg').text(""); //clear status text

					//populate call agent information
					/*seems to be dead code 
					// $('#txtAgentDisplayName').val(payload.username);
					// $('#txtAgentFirstname').val(payload.first_name);
					// $('#txtAgentLastname').val(payload.last_name);
					// $('#txtAgentRole').val(payload.role);
					// $('#txtAgentEmail').val(payload.email);
					// $('#txtAgentPhone').val(payload.phone);
					*/
					$('#displayname').val(payload.first_name + ' ' + payload.role);
					$('#agentname-sidebar').html(payload.first_name + " " + payload.last_name);
					$('#agentname-header').html(payload.first_name + " " + payload.last_name);
					$('#agentname-headerdropdown').html(payload.first_name + " " + payload.last_name);
					$('#agentrole-headerdropdown').html("<small>" + payload.role + "</small>");
					$('#agentlightcode-headerdropdown').html("<small>Light Code: " + payload.lightcode + "</small>");
					$('#ws_servers').attr("name","wss://" + payload.asteriskPublicHostname + "/ws");
					$('#my_sip_uri').attr("name","sip:"+payload.extension+"@"+payload.asteriskPublicHostname);
					$('#sip_password').attr("name",payload.extensionPassword);
					$("#pc_config").attr("name","stun:" + payload.stunServer );																																																	 
					var lighturl = "https://" + window.location.hostname + window.location.pathname + "/" + payload.lightcode;
					lighturl = lighturl.replace('/agent/', '/getagentstatus/');
					$('#agentlightcode').val(lighturl);

					if (payload.queue_name === "ComplaintsQueue" || payload.queue2_name === "ComplaintsQueue") {
						$('#sidebar-complaints').show();
					}
					if (payload.queue_name === "GeneralQuestionsQueue" || payload.queue2_name === "GeneralQuestionsQueue") {
						$('#sidebar-geninfo').show();
					}



					socket.emit('register-client', {
						"hello": "hello"
					});
					socket.emit('register-agent', {
						"hello": "hello"
					});

					extensionMe = payload.extension; //e.g. 6001
					queueNameMe = payload.queue_name; //e.g. InboundQueue
					channelMe = payload.channel; //e.g. SIP/7001
					register_jssip();
					pauseQueues();
				}).on('disconnect', function () {
					debugtxt('disconnect');
					console.log('disconnected');
					unregister_jssip();																							 
					changeStatusLight('OFF_DUTY');
					//logout("disconnected");
				}).on("unauthorized", function (error) {
					debugtxt('unauthorized', error);
					if (error.data.type === "UnauthorizedError" || error.data.code === "invalid_token") {
						logout("Session has expired");
					}
				}).on('error', function (reason) {
					debugtxt('error', reason);

					if (reason.code === "invalid_token") {
						logout("Session has expired");
					} else {
						logout("An Error Occurred: " + JSON.stringify(reason));
					}
				}).on('typing', function (data) {
					debugtxt('typing', data);
					if ($("#displayname").val() !== data.displayname) {
						$('#rtt-typing').html(data.displayname + ": " + data.rttmsg);
					}
				}).on('typing-clear', function (data) {
					debugtxt('typing-clear', data);
					if ($("#displayname").val() !== data.displayname) {
						$('#rtt-typing').html('');
					}
				}).on('new-caller-general', function (data) { // a new general caller has connected
					debugtxt('new-caller-general', data);
					$('#duration').timer('reset');
					inCallADGeneral();
				}).on('new-caller-complaints', function (data) {
					// a new complaints caller has connected
					debugtxt('new-caller-complaints', data);
					$('#duration').timer('reset');
					inCallADComplaints();
				}).on('no-ticket-info', function (data) {
					debugtxt('no-ticket-info', data);
					$('#notickettxt').show();
					$('#ticketTab').addClass("bg-pink");
					/*
					//Removed to stop flashing delay issue.
					ticketTabFade = setInterval(function () {
						$('#ticketTab').fadeTo("slow", 0.1).fadeTo("slow", 1.0);
					}, 1000);
					*/
				}).on('chat-leave', function (data) {
					debugtxt('chat-leave', data);
					$('#duration').timer('pause');
					$('#user-status').text('Wrap Up');
					$('#complaintsInCall').hide();
					$('#geninfoInCall').hide();
					socket.emit('wrapup', null);
					changeStatusIcon(wrap_up_color, "wrap-up", wrap_up_blinking);
					changeStatusLight('WRAP_UP');
					socket.emit('chat-leave-ack', data);
				}).on('chat-message-new', function (data) {
					debugtxt('chat-message-new', data);
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
				}).on('script-data', function (data) {
					debugtxt('script-data', data);
					for (var i in data.data) {
						if (data.data[i].id === 1)
							$('#info_script_content').val(data.data[i].text);
						if (data.data[i].id === 2)
							$('#complaints_script_content').val(data.data[i].text);
						/*
						if(data.data[i].queue_name === "ComplaintsQueue"){
							$('#complaints_scripts_type').append($("<option/>", {
        						value: data.data[i].id,
        						text: data.data[i].type
    						}));
						}
						*/
					}


				}).on('ad-zendesk', function (data) {
					debugtxt('ad-zendesk', data);
					//Place holders
					//$('#assignee').val('');
					//$('#requester').val('');
					//$('#resolution').val('');
					$('#ticketId').val(data.id);
					$('#lastupdated').val(data.updated_at);
					$('#subject').val(data.subject);
					$('#problemdesc').val(data.description);
				}).on('ad-vrs', function (data) {
					debugtxt('ad-vrs', data);
					$('#callerFirstName').val(data.data[0].first_name);
					$('#callerLastName').val(data.data[0].last_name);
					$('#callerPhone').val(data.data[0].vrs);
					$('#callerAddress1').val(data.data[0].address);
					$('#callerCity').val(data.data[0].city);
					$('#callerState').val(data.data[0].state);
					$('#callerZipcode').val(data.data[0].zip_code);
					$('#callerEmail').val(data.data[0].email);

					$('#duration').timer('reset');
					socket.emit('register-vrs', {
						"vrs": data.data[0].vrs
					});
				}).on('missing-vrs', function (data) {
					debugtxt('missing-vrs', data);
					//show modal to get VRS from user
					$(".modal-backdrop").remove();
					if (data.message) {
						$('#ivrsmessage').text(data.message);
						$('#ivrsmessage').show();
					}
					$('#myVrsModal').modal({
						show: true,
						backdrop: 'static',
						keyboard: false
					});
				}).on('ad-zendesk-update-success', function (data) {
					debugtxt('ad-zendesk-update-success', data);
					$('#alertPlaceholder').html('<div id="saveAlert" class="alert alert-success alert-dismissable"><button type="button" class="close" data-dismiss="alert" aria-hidden="true">&times;</button>Success!</div>');
					$('#lastupdated').val(data.updated_at);
				}).on('ad-ticket-created', function (data) {
					debugtxt('ad-ticket-created', data);
					$('#alertPlaceholder').html('<div id="saveAlert" class="alert alert-success alert-dismissable"><button type="button" class="close" data-dismiss="alert" aria-hidden="true">&times;</button>Success!</div>');
					$('#lastupdated').val("");
					$('#subject').val(data.subject);
					$('#problemdesc').val(data.description);
					$('#ticketId').val(data.zendesk_ticket);
				}).on('agent-status-list', function (data) {
					//debugtxt('agent-status-list', data);
					var name, status, extension, queues, tabledata;
					if (data.message === "success") {
						tabledata = {
							data: []
						};
						for (var i = 0; i < data.agents.length; i++) {
							var name, status, extension, queues = "";
							name = data.agents[i].name;
							status = data.agents[i].status;
							if (status === "READY") {
								if (ready_blinking) status = "<div style='display:inline-block'><i class='status-margin-small text-" + ready_color + "-blinking'></i>&nbsp;&nbsp;Ready</div>";
								else status = "<div style='display:inline-block'><i class='fa fa-circle text-" + ready_color + "'></i>&nbsp;&nbsp;Ready</div>";
							} else if (status === "AWAY") {
								if (away_blinking) status = "<div style='display:inline-block'><i class='status-margin-small text-" + away_color + "-blinking'></i>&nbsp;&nbsp;Away</div>";
								else status = "<div style='display:inline-block'><i class='fa fa-circle text-" + away_color + "'></i>&nbsp;&nbsp;Away</div>";
							} else if (status === "INCALL") {
								if (in_call_blinking) status = "<div style='display:inline-block'><i class='status-margin-small text-" + in_call_color + "-blinking'></i>&nbsp;&nbsp;In Call</div>";
								else status = "<div style='display:inline-block'><i class='fa fa-circle text-" + in_call_color + "'></i>&nbsp;&nbsp;In Call</div>";
							} else if (status === "WRAPUP") {
								if (wrap_up_blinking) status = "<div style='display:inline-block'><i class='status-margin-small text-" + wrap_up_color + "-blinking'></i>&nbsp;&nbsp;Wrap Up</div>";
								else status = "<div style='display:inline-block'><i class='fa fa-circle text-" + wrap_up_color + "'></i>&nbsp;&nbsp;Wrap Up</div>";
							} else if (status === "INCOMINGCALL") {
								if (incoming_call_blinking) status = "<div style='display:inline-block'><i class='status-margin-small text-" + incoming_call_color + "-blinking'></i>&nbsp;&nbsp;Incoming Call</div>";
								else status = "<div style='display:inline-block'><i class='fa fa-circle text-" + incoming_call_color + "'></i>&nbsp;&nbsp;Incoming Call</div>";
							} else if (status === "MISSEDCALL") {
								if (missed_call_blinking) status = "<div style='display:inline-block'><i class='status-margin-small text-" + missed_call_color + "-blinking'></i>&nbsp;&nbsp;Missed Call</div>";
								else status = "<div style='display:inline-block'><i class='fa fa-circle text-" + missed_call_color + "'></i>&nbsp;&nbsp;Missed Call</div>";
							} else {
								status = "<div style='display:inline-block'><i class='fa fa-circle text-gray'></i>&nbsp;&nbsp;Unknown</div>";
							}

							extension = data.agents[i].extension;
							for (var j = 0; j < data.agents[i].queues.length; j++) {
								queues += data.agents[i].queues[j].queuename + "<br>";
							}
							queues = queues.replace(/<br>\s*$/, "");
							tabledata['data'].push({
								"status": status,
								"name": name,
								"extension": extension,
								"queues": queues
							});
						}

						$('#agenttable').dataTable().fnClearTable();
						$('#agenttable').dataTable().fnAddData(tabledata.data);
					}
				}).on('new-caller-ringing', function (data) {
					debugtxt('new-caller-ringing', data);
					$('#myRingingModal').addClass('fade');
					changeStatusLight('INCOMING_CALL');
					changeStatusIcon(incoming_call_color, "incoming-call", incoming_call_blinking);
					$('#user-status').text('Incoming Call');
					$('#myRingingModalPhoneNumber').html(data.phoneNumber)
					$('#myRingingModal').modal({
						show: true,
						backdrop: 'static',
						keyboard: false
					});
					socket.emit('incomingcall', null);
				}).on('new-missed-call', function (data) {
					debugtxt('new-missed-call', data);
					//$('#myRingingModal').removeClass('fade');					
					$('#myRingingModal').modal('hide');
					/*
					changeStatusLight('MISSED_CALL');
					changeStatusIcon(missed_call_color, "missed-call", missed_call_blinking);
					$('#user-status').text('Missed Call');
					var missedCallNumber = $('#myRingingModalPhoneNumber').text();
					$('#myMissedCallModalPhoneNumber').html(missedCallNumber)
					$('#myMissedCallModal').modal({
						show: true,
						backdrop: 'static',
						keyboard: false
					});
					socket.emit('missedcall', null);
					socket.emit('pause-queues');
					*/
					unpauseQueues();
				}).on('request-assistance-response', function (data) {
					debugtxt('request-assistance-response', data);
					//alert(data.message);
				}).on('lightcode-configs', function (data) {
					debugtxt('lightcode-configs', data);
					updateColors(data);
					busylight.updateConfigs(data);
				});


			} else {
				//TODO: handle bad connections
			}
		},
		error: function (xhr, status, error) {
			console.log('Error');
			$('#message').text('An Error Occured.');
		}
	});

}

$('#agenttable').DataTable({
	aaData: null,
	aoColumns: [{
			"mDataProp": "status"
		},
		{
			"mDataProp": "name"
		},
		{
			"mDataProp": "extension"
		},
		{
			"mDataProp": "queues"
		}
	],
	searching: false,
	paging: false,
	scrollY: 600,
	order: []
});

$("#ivrsnum").keyup(function (event) {
	if (event.keyCode == 13) {
		$("#submitvrs").click();
	}
});

$('#submitvrs').on('click', function (event) {
	event.preventDefault(); // To prevent following the link (optional)
	var ivrsnum = $('#ivrsnum').val().replace(/^1|[^\d]/g, '');
	if (ivrsnum.length === 10) {
		$(".modal-backdrop").remove();
		socket.emit('input-vrs', {
			"vrs": ivrsnum,
			"extension": extensionMe
		});
		$('#ivrsnum').removeClass('has-error');
		$('#ivrsmessage').text('');
		$('#ivrsmessage').hide();
		$('#myVrsModal').modal('hide');
	} else {
		$('#ivrsnum').addClass('has-error');
		$('#ivrsmessage').text('Invalid phone number format');
		$('#ivrsmessage').show();
	}
});


$("#newchatmessage").on('change keydown paste input', function () {
	var value = $("#newchatmessage").val();
	var displayname = $('#displayname').val();
	var vrs = $('#callerPhone').val();

	if (value.length > 0) {
		socket.emit('chat-typing', {
			"displayname": displayname,
			"vrs": vrs,
			rttmsg: value
		});
	} else {
		socket.emit('chat-typing-clear', {
			"displayname": displayname,
			"vrs": vrs
		});
	}
});

$('#chatsend').submit(function (evt) {
	evt.preventDefault();

	var msg = $('#newchatmessage').val();
	var displayname = $('#displayname').val();
	var vrs = $('#callerPhone').val();
	var date = moment();
	var timestamp = date.format("D MMM h:mm a");

	$('#newchatmessage').val('');
	socket.emit('chat-message', {
		"message": msg,
		"timestamp": timestamp,
		"displayname": displayname,
		"vrs": vrs
	});
});

$('#ticketTabTitle').click(function () {
	$('#ticketTab').removeClass("bg-pink");
	clearInterval(ticketTabFade);
});

function requestAssistance() {
	socket.emit('request-assistance', null);
}

function logout(msg) {
	busylight.light('OFF_DUTY');
	changeStatusLight('OFF_DUTY');
	//clear the token from session storage
	sessionStorage.clear();
	//disconnect socket.io connection
	if (socket)
		socket.disconnect();
	//display the login screen to the user.
	if (msg) {
		window.location.href = './logout'
		//window.location.replace("?message=" + msg);
	} else {
		window.location.href = './logout'
		//window.location.replace("");
	}

}

function modifyTicket() {
	$('#notickettxt').hide();
	var id = $('#ticketId').val();
	var subject = $('#subject').val();
	var description = $('#problemdesc').val();
	var resolution = $('#resolution').val();
	var fname = $('#callerFirstName').val();
	var email = $('#callerEmail').val(); //
	var phone = $('#callerPhone').val();
	var lname = $('#callerLastName').val();

	if (id.trim() === "") {
		var ticket = {
			"destexten": extensionMe,
			"vrs": phone,
			"status": "new",
			"ticketId": id,
			"subject": subject,
			"description": description,
			"name": fname,
			"email": email,
			"phone": phone,
			"last_name": lname,
			"resolution": resolution,
			"comment": {
				"public": true,
				"body": description
			}
		};
		socket.emit('ad-ticket', ticket);
	} else {
		socket.emit('modify-ticket', {
			"destexten": extensionMe,
			"vrs": phone,
			"status": "new",
			"ticketId": id,
			"subject": subject,
			"description": description,
			"name": fname,
			"email": email,
			"phone": phone,
			"last_name": lname,
			"resolution": resolution,
			"comment": {
				"public": true,
				"body": description
			}
		});
	}

}

function inCallADComplaints() {
		socket.emit('pause-queues', null);
	$('#myRingingModalPhoneNumber').html('');
	$('#myRingingModal').modal('hide');
	$('#user-status').text('In Call');
	$('#complaintsInCall').show();
	changeStatusIcon(in_call_color, "in-call", in_call_blinking);
	changeStatusLight('IN_CALL');
	socket.emit('incall', null);
}

function inCallADGeneral() {
	socket.emit('pause-queues', null);
	$('#myRingingModalPhoneNumber').html('');
	$('#myRingingModal').modal('hide');
	$('#user-status').text('In Call');
	$('#geninfoInCall').show();
	changeStatusLight('IN_CALL');
	changeStatusIcon(in_call_color, "in-call", in_call_blinking);
	socket.emit('incall', null);
}

function pauseQueues() {
	$('#user-status').text('Away');
	changeStatusIcon(away_color, "away", away_blinking);
	changeStatusLight('AWAY');
	socket.emit('pause-queues', null);
	socket.emit('away', null);
}

function unpauseQueues() {
	$('#user-status').text('Ready');
	changeStatusIcon(ready_color, "ready", ready_blinking);
	changeStatusLight('READY');
	socket.emit('unpause-queues', null);
	socket.emit('ready', null);
}

function finished() {
	$('#destexten').val('');
	clearScreen();
	unpauseQueues();
	$('#alertPlaceholder').html('');
}

function clearScreen() {
	$('#userform').find('input:text').val('');
	$('#callerEmail').val('');

	$('#callinfodiv').find('input:text').val('');

	$('#inbounddhohlabel').hide();
	$('#outbounddhohlabel').hide();

	$('#outboundnumber').text('');
	$('#inboundnumber').text('');

	$('#duration').timer('reset');
	$('#duration').timer('pause');

	$('#chat-messages').html('');
	$('#newchatmessage').val('');

	$('#ticketForm').find('input:text').val('');
	$('#ticketForm').find('textarea').val('');

	$('#complaintsInCall').hide();
	$('#geninfoInCall').hide();

	$('#ivrsnum').val('');
	$('#ivrsmessage').hide();

	$('#notickettxt').hide();
	$('#ticketTab').removeClass("bg-pink");
	clearInterval(ticketTabFade);
}

function changeStatusLight(state) {
	this.agentStatus = state;
	busylight.light(state);
}



document.getElementById("copyLightcodeButton").addEventListener("click", function () {
	copyToClipboard(document.getElementById("agentlightcode"));
	var x = document.getElementById("snackbar")
	x.innerHTML = "Light Code Copied to Clipboard.";
	x.className = "show";
	setTimeout(function () {
		x.className = x.className.replace("show", "");
	}, 3000);
});

function copyToClipboard(elem) {
	// create hidden text element, if it doesn't already exist
	var targetId = "_hiddenCopyText_";
	var isInput = elem.tagName === "INPUT" || elem.tagName === "TEXTAREA";
	var origSelectionStart, origSelectionEnd;
	if (isInput) {
		// can just use the original source element for the selection and copy
		target = elem;
		origSelectionStart = elem.selectionStart;
		origSelectionEnd = elem.selectionEnd;
	} else {
		// must use a temporary form element for the selection and copy
		target = document.getElementById(targetId);
		if (!target) {
			var target = document.createElement("textarea");
			target.style.position = "absolute";
			target.style.left = "-9999px";
			target.style.top = "0";
			target.id = targetId;
			document.body.appendChild(target);
		}
		target.textContent = elem.textContent;
	}
	// select the content
	var currentFocus = document.activeElement;
	target.focus();
	target.setSelectionRange(0, target.value.length);

	// copy the selection
	var succeed;
	try {
		succeed = document.execCommand("copy");
	} catch (e) {
		succeed = false;
	}
	// restore original focus
	if (currentFocus && typeof currentFocus.focus === "function") {
		currentFocus.focus();
	}

	if (isInput) {
		// restore prior selection
		elem.setSelectionRange(origSelectionStart, origSelectionEnd);
	} else {
		// clear temporary content
		target.textContent = "";
	}
	return succeed;
}

// Debug Functions for sidebar.
function cleardbgtxt() {
	$('#dbgtxt').html('');
}

function debugtxt(title, data) {
	var dt = new Date();
	var time = dt.getHours() + ":" + dt.getMinutes() + ":" + dt.getSeconds();
	$('#dbgtxt').html('<span style="color:green">' + time + ": " + title + '</span><br>' + JSON.stringify(data) + '<br>----------------<br>' + $('#dbgtxt').html());
}

function updateColors(data) {
	//remove current colors from ready away and status-icon
	$("#status-icon").removeClass(function (index, className) {
		return (className.match(/\btext-\S+/g) || []).join(' ');
	});
	$("#away-icon").removeClass(function (index, className) {
		return (className.match(/\btext-\S+/g) || []).join(' ');
	});
	$("#ready-icon").removeClass(function (index, className) {
		return (className.match(/\btext-\S+/g) || []).join(' ');
	});

	//update new statuses colors
	for (var status in data) {
		if (data[status].color.toLowerCase() == "off") {
			data[status].color = "gray";
			data[status].blink = false;
		}

		if (data[status].id.toLowerCase() == "away") {
			away_color = data[status].color;
			away_blinking = data[status].blink;
		} else if (data[status].id.toLowerCase() == "ready") {
			ready_color = data[status].color;
			ready_blinking = data[status].blink;
		} else if (data[status].id.toLowerCase() == "in_call") {
			in_call_color = data[status].color;
			in_call_blinking = data[status].blink;
		} else if (data[status].id.toLowerCase() == "hold") {
			hold_color = data[status].color;
			hold_blinking = data[status].blink;
		} else if (data[status].id.toLowerCase() == "incoming_call") {
			incoming_call_color = data[status].color;
			incoming_call_blinking = data[status].blink;
		} else if (data[status].id.toLowerCase() == "transferred_call") {
			transferred_call_color = data[status].color;
			transferred_call_blinking = data[status].blink;
		} else if (data[status].id.toLowerCase() == "wrap_up") {
			wrap_up_color = data[status].color;
			wrap_up_blinking = data[status].blink;
		} else if (data[status].id.toLowerCase() == "need_assistance") {
			need_assistance_color = data[status].color;
			need_assistance_blinking = data[status].blink;
		} else {
			missed_call_color = data[status].color;
			missed_call_blinking = data[status].blink;
		}
	}

	//add new colors to away and ready
	if (away_blinking) {
		$('#away-icon').addClass("text-" + away_color + "-blinking");
		if (!($("away-icon").hasClass("status-margin"))) $('#away-icon').addClass("status-margin");
		$("#away-icon").removeClass("fa");
		$("#away-icon").removeClass("fa-circle");
	} else {
		$('#away-icon').addClass("text-" + away_color);
		if (!($("away-icon").hasClass("fa"))) $("#away-icon").addClass("fa");
		if (!($("away-icon").hasClass("fa-circle"))) $("#away-icon").addClass("fa-circle");
		$("#away-icon").removeClass("status-margin");
	}
	if (ready_blinking) {
		if (!($("ready-icon").hasClass("status-margin"))) $('#ready-icon').addClass("status-margin");
		$('#ready-icon').addClass("text-" + ready_color + "-blinking");
		$("#ready-icon").removeClass("fa");
		$("#ready-icon").removeClass("fa-circle");
	} else {
		$('#ready-icon').addClass("text-" + ready_color);
		if (!($("ready-icon").hasClass("fa"))) $("#ready-icon").addClass("fa");
		if (!($("ready-icon").hasClass("fa"))) $("#ready-icon").addClass("fa-circle");
		$("#ready-icon").removeClass("status-margin");
	}

	//add new color to status-icon
	if ($("#status-icon").hasClass("currently-away")) changeStatusIcon(away_color, "away", away_blinking);
	else if ($("#status-icon").hasClass("currently-ready")) changeStatusIcon(ready_color, "ready", ready_blinking);
	else if ($("#status-icon").hasClass("currently-in-call")) changeStatusIcon(in_call_color, "in-call", in_call_blinking);
	else if ($("#status-icon").hasClass("currently-hold")) changeStatusIcon(hold_color, "hold", hold_blinking);
	else if ($("#status-icon").hasClass("currently-incoming-call")) changeStatusIcon(incoming_call_color, "incoming-call", incoming_call_blinking);
	else if ($("#status-icon").hasClass("currently-transferred-call")) changeStatusIcon(transferred_call_color, "transferred-call", transferred_blinking);
	else if ($("#status-icon").hasClass("currently-wrap-up")) changeStatusIcon(wrap_up_color, "wrap-up", wrap_up_blinking);
	else if ($("#status-icon").hasClass("currently-need-assistance")) changeStatusIcon(need_assistance_color, "need-assistance", need_assistance_blinking);
	else changeStatusIcon(missed_call_color, "missed-call", missed_call_blinking);

	socket.emit('update-agent-list');
}

function changeStatusIcon(newColor, statusName, blinking) {
	$("#status-icon").removeClass(function (index, className) {
		return (className.match(/\btext-\S+/g) || []).join(' ');
	});
	$("#status-icon").removeClass(function (index, className) {
		return (className.match(/\bcurrently-\S+/g) || []).join(' ');
	});
	if (blinking) {
		$('#status-icon').addClass("text-" + newColor + "-blinking");
		$("#status-icon").removeClass("fa");
		$("#status-icon").removeClass("fa-circle");
		if (!($("status-icon").hasClass("status-margin-small"))) $("#status-icon").addClass("status-margin-small");

	} else {
		$('#status-icon').addClass("text-" + newColor);
		if (!($("status-icon").hasClass("fa"))) $("#status-icon").addClass("fa");
		if (!($("status-icon").hasClass("fa-circle"))) $("#status-icon").addClass("fa-circle");
		$("#status-icon").removeClass("status-margin-small");
	}
	$('#status-icon').addClass("currently-" + statusName);
}


function testLightConnection() {
	$('#busylightModalBody').html(" ");
	$('#busylightModalTestBtn').prop("disabled", true);
	$('#busylightModalBody').html("Checking BusyLight server...");
	$.ajax({
		type: "get",
		url: "https://localhost:6298/",
		timeout: 2000,
		dataType: "jsonp xml",
		success: function (data, text) {

		},
		error: function (request, status, error) {
			$('#busylightModalTestBtn').prop("disabled", false);
			if (status === 'timeout') {
				$('#busylightModalBody').html("BusyLight app is not running.");
				$('#busylightModal').modal('show');
			} else if (status === 'error') {
				var win = window.open('https://localhost:6298/', '_blank');
				if (win) {
					//browser allows popups
					win.focus();
				} else {
					//no pop ups display modal
					$('#busylightModalBody').html(
						"<a href='https://localhost:6298/' target='_blank'>Please visit the Busylight Test Page</a>");
					$('#busylightModal').modal('show');
				}
			} else {
				$('#busylightModalBody').html('Connected to busylight!!!!');

				setTimeout(function () {
					$('#busylightModal').modal('hide');
				}, 1500);
			}
		}
	});
}

testLightConnection();


$("#accept-btn").click(function(){
	$('#myRingingModalPhoneNumber').html('');
	$('#myRingingModal').modal('hide');
	$("#hide-video-icon").css("display","none");
});

$("#decline-btn").click(function(){
	$('#myRingingModalPhoneNumber').html('');
	$('#myRingingModal').modal('hide');
});