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
var videomail_status_buttons = document.getElementById("videomail-status-buttons");
var sortFlag = "id desc";
var filter = "ALL";
var telNumber;

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
					$('#displayname').val("CSR " + payload.first_name);
					$('#agentname-sidebar').html(payload.first_name + " " + payload.last_name);
					$('#agentname-header').html(payload.first_name + " " + payload.last_name);
					$('#agentname-headerdropdown').html(payload.first_name + " " + payload.last_name);
					$('#agentrole-headerdropdown').html("<small>" + payload.role + "</small>");
					$('#ws_servers').attr("name", "wss://" + payload.asteriskPublicHostname + ":" + payload.wsPort + "/ws");
					$('#my_sip_uri').attr("name", "sip:" + payload.extension + "@" + payload.asteriskPublicHostname);
					$('#sip_password').attr("name", payload.extensionPassword);
					$("#pc_config").attr("name", "stun:" + payload.stunServer);
					$("#complaints-queue-num").text(payload.complaint_queue_count);
					$("#general-queue-num").text(payload.general_queue_count);

					if (payload.queue_name === "ComplaintsQueue" || payload.queue2_name === "ComplaintsQueue") {
						$('#sidebar-complaints').show();
					}
					if (payload.queue_name === "GeneralQuestionsQueue" || payload.queue2_name === "GeneralQuestionsQueue") {
						$('#sidebar-geninfo').show();
					}

					if (payload.layout||sessionStorage.layout) {
						var layout = typeof sessionStorage.layout !== "undefined" ? sessionStorage.layout : payload.layout;
						loadGridLayout(JSON.parse(layout));
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
					socket.emit('get-videomail', {
						"extension": extensionMe,
						"sortBy": "id desc",
						"filter": "ALL"
					});
					setInterval(function () {
						socket.emit('get-videomail', {
							"extension": extensionMe,
							"sortBy": sortFlag,
							"filter": filter
						});
					}, 5000);
					toggle_videomail_buttons(false);
					console.log('Sent a get-videomail event');
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
				}).on('new-caller-general', function (endpoint_type) { // a new general caller has connected
					debugtxt('new-caller-general', data);
					$('#duration').timer('reset');
					inCallADGeneral(endpoint_type);
				}).on('new-caller-complaints', function (endpoint_type) {
					// a new complaints caller has connected
					debugtxt('new-caller-complaints', data);
					$('#duration').timer('reset');
					inCallADComplaints(endpoint_type);
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
					$('#modalWrapup').modal({
						backdrop: 'static',
						keyboard: false
					});
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
					var vrs = $('#callerPhone').val();
					var agent_name = $("#agentname-sidebar").text();
					socket.emit('send-name',{"agent_name": agent_name , "vrs": vrs});
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
					$('#myRingingModalPhoneNumber').html(data.phoneNumber);
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
				}).on('skinny-config', function (data) {
					if (data == "true") {
						$("#gsscriptbox").attr("hidden", true);
						$("#gsdetailsbox").attr("hidden", true);
					} else {
						$("#gsscriptbox").removeAttr("hidden");
						$("#gsdetailsbox").removeAttr("hidden");
					}
				}).on('got-videomail-recs', function (data) {
					updateVideomailTable(data);
				}).on('got-unread-count', function (data) {
					updateVideomailNotification(data);
				}).on('changed-status', function () {
					getVideomailRecs();
				}).on('videomail-retrieval-error', function (data) {
					$('#videomailErrorBody').html('Unable to locate videomail with ID ' + data + '.');
					$('#videomailErrorModal').modal('show');
					stopVideomail();
				}).on('queue-caller-join',function(data){
					if(data.queue == "ComplaintsQueue") {
						$("#complaints-queue-num").text(data.count);
					}
					else if(data.queue == "GeneralQuestionsQueue") {
						$("#general-queue-num").text(data.count);
					}
				}).on('queue-caller-leave',function(data){
					if(data.queue == "ComplaintsQueue") {
						$("#complaints-queue-num").text(data.count);
					}
					else if(data.queue == "GeneralQuestionsQueue") {
						$("#general-queue-num").text(data.count);
					}
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
		window.location.href = './logout';
		//window.location.replace("?message=" + msg);
	} else {
		window.location.href = './logout';
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

function inCallADComplaints(endpoint_type) {
	socket.emit('pause-queues', null);
	$('#myRingingModalPhoneNumber').html('');
	$('#myRingingModal').modal('hide');
	$('#user-status').text('In Call');
	$('#complaintsInCall').show();
	changeStatusIcon(in_call_color, "in-call", in_call_blinking);
	changeStatusLight('IN_CALL');
	socket.emit('incall', null);
	if(endpoint_type === "Provider_Complaints"){
		disable_chat_buttons();
		$("#newchatmessage").attr("placeholder","Chat disabled for Provider endpoints");
	}
	else{ //should be webrtc 
		enable_chat_buttons();
	}


}

function inCallADGeneral(endpoint_type) {
	socket.emit('pause-queues', null);
	$('#myRingingModalPhoneNumber').html('');
	$('#myRingingModal').modal('hide');
	$('#user-status').text('In Call');
	$('#geninfoInCall').show();
	changeStatusLight('IN_CALL');
	changeStatusIcon(in_call_color, "in-call", in_call_blinking);
	socket.emit('incall', null);
	if(endpoint_type === "Provider_General_Questions"){
		disable_chat_buttons();
		$("#newchatmessage").attr("placeholder","Chat disabled for provider endpoints");
	}
	else{ //should be webrtc 
		enable_chat_buttons();
	}
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

//i == 1: go to Ready; i == 0: go to Away
function finished(i) {
	$('#destexten').val('');
	clearScreen();
	if (i == 1)
		unpauseQueues();
	else
		pauseQueues();
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
	$('#rtt-typing').html('');
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

	$('#modalWrapup').modal('hide');
}

function changeStatusLight(state) {
	this.agentStatus = state;
	busylight.light(state);
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

//update colors to custom config colors.
//NOTE: text has the class "text-colorname" and buttons have the class "btn-colorname"
function updateColors(data) {
	//remove colors from status icons
	$("#away-icon").removeClass(function (index, className) {
		return (className.match(/\btext-\S+/g) || []).join(' ');
	});
	$("#ready-icon").removeClass(function (index, className) {
		return (className.match(/\btext-\S+/g) || []).join(' ');
	});
	$("#status-icon").removeClass(function (index, className) {
		return (className.match(/\btext-\S+/g) || []).join(' ');
	});

	//remove colors from wrapup modal
	$("#away-btn").removeClass(function (index, className) {
		return (className.match(/\bbtn-\S+/g) || []).join(' ');
	});
	$("#away-color").removeClass(function (index, className) {
		return (className.match(/\btext-\S+/g) || []).join(' ');
	});
	$("#ready-color").removeClass(function (index, className) {
		return (className.match(/\btext-\S+/g) || []).join(' ');
	});
	$("#ready-btn").removeClass(function (index, className) {
		return (className.match(/\bbtn-\S+/g) || []).join(' ');
	});
	$("#wrapup-color").removeClass(function (index, className) {
		return (className.match(/\btext-\S+/g) || []).join(' ');
	});

	//get new colors from json config file, save to local variables
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

	//add new text-colors to away and ready icons
	if (away_blinking) {
		$('#away-icon').addClass("text-" + away_color + "-blinking");
		if (!($("#away-icon").hasClass("status-margin"))) $('#away-icon').addClass("status-margin");
		$("#away-icon").removeClass("fa");
		$("#away-icon").removeClass("fa-circle");
	} else {
		$('#away-icon').addClass("text-" + away_color);
		if (!($("#away-icon").hasClass("fa"))) $("#away-icon").addClass("fa");
		if (!($("#away-icon").hasClass("fa-circle"))) $("#away-icon").addClass("fa-circle");
		$("#away-icon").removeClass("status-margin");
	}
	if (ready_blinking) {
		if (!($("#ready-icon").hasClass("status-margin"))) $('#ready-icon').addClass("status-margin");
		$('#ready-icon').addClass("text-" + ready_color + "-blinking");
		$("#ready-icon").removeClass("fa");
		$("#ready-icon").removeClass("fa-circle");
	} else {
		$('#ready-icon').addClass("text-" + ready_color);
		if (!($("#ready-icon").hasClass("fa"))) $("#ready-icon").addClass("fa");
		if (!($("#ready-icon").hasClass("fa-circle"))) $("#ready-icon").addClass("fa-circle");
		$("#ready-icon").removeClass("status-margin");
	}
	//add colors to wrapup model
	if (wrap_up_color == "white") $('#wrapup-color').addClass("text-gray");
	else $('#wrapup-color').addClass("text-" + wrap_up_color);
	if (away_color == "white") $('#away-color').addClass("text-gray");
	else $('#away-color').addClass("text-" + away_color);
	if (ready_color == "white") $('#ready-color').addClass("text-gray");
	else $('#ready-color').addClass("text-" + ready_color);
	$('#away-btn').addClass("btn-" + away_color);
	$('#ready-btn').addClass("btn-" + ready_color);

	//add new color to status-icon element
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
		if (!($("#status-icon").hasClass("status-margin-small"))) $("#status-icon").addClass("status-margin-small");

	} else {
		$('#status-icon').addClass("text-" + newColor);
		if (!($("#status-icon").hasClass("fa"))) $("#status-icon").addClass("fa");
		if (!($("#status-icon").hasClass("fa-circle"))) $("#status-icon").addClass("fa-circle");
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

//####################################################################
//Videomail functionality: mostly sending socket.io events to adserver

function getVideomailRecs() {
	socket.emit('get-videomail', {
		"extension": extensionMe,
		"sortBy": sortFlag,
		"filter": filter
	});
	console.log('Sent a get-videomail event');
}

//Play selected videomail when a row of the table is clicked
$('#Videomail_Table tbody').on('click', 'tr', function () {
	var tableData = $(this).children("td").map(function () {
		return $(this).text();
	}).get();

	console.log('Click event for playing video');
	console.log('vidId: ' + tableData[5]);
	$("#videomailId").attr("name", tableData[5]);
	$("#callbacknum").attr("name", tableData[0]);
	playVideomail(tableData[5], tableData[2], tableData[3]); //vidId, vidDuration vidStatus);
});

//Sorting the videomail table
$('#vmail-vrs-number').on('click', function () {
	var sort = sortButtonToggle($(this).children("i"));
	if (sort == "asc") {
		sortFlag = "callbacknumber asc";
	} else if (sort == "desc") {
		sortFlag = "callbacknumber desc";
	}
	socket.emit('get-videomail', {
		"extension": extensionMe,
		"sortBy": sortFlag,
		"filter": filter
	});
});

$('#vmail-date').on('click', function () {
	var sort = sortButtonToggle($(this).children("i"));
	if (sort == "asc") {
		sortFlag = "unix_timestamp(received) asc";
	} else if (sort == "desc") {
		sortFlag = "unix_timestamp(received) desc";
	}
	socket.emit('get-videomail', {
		"extension": extensionMe,
		"sortBy": sortFlag,
		"filter": filter
	});
});

$('#vmail-duration').on('click', function () {
	var sort = sortButtonToggle($(this).children("i"));
	if (sort == "asc") {
		sortFlag = "video_duration asc";
	} else if (sort == "desc") {
		sortFlag = "video_duration desc";
	}
	socket.emit('get-videomail', {
		"extension": extensionMe,
		"sortBy": sortFlag,
		"filter": filter
	});
});

$('#vmail-status').on('click', function () {
	var sort = sortButtonToggle($(this).children("i"));
	if (sort == "asc") {
		sortFlag = "status asc";
	} else if (sort == "desc") {
		sortFlag = "status desc";
	}
	socket.emit('get-videomail', {
		"extension": extensionMe,
		"sortBy": sortFlag,
		"filter": filter
	});
});

function sortButtonToggle(buttonid) {
	if ($(buttonid).attr("class") == 'fa fa-sort') {
		$(buttonid).addClass('fa-sort-asc').removeClass('fa-sort');
		return ("asc");
	} else if ($(buttonid).attr("class") == 'fa fa-sort-desc') {
		$(buttonid).addClass('fa-sort-asc').removeClass('fa-sort-desc');
		return ("asc");
	} else if ($(buttonid).attr("class") == 'fa fa-sort-asc') {
		$(buttonid).addClass('fa-sort-desc').removeClass('fa-sort-asc');
		return ("desc");
	}
}

//Update the records in the videomail table
function updateVideomailTable(data) {
	console.log("Refreshing videomail");
	$("#videomailTbody").html("");
	var table;
	var row;
	var numberCell;
	var receivedCell;
	var durationCell;
	var statusCell;
	for (var i = 0; i < data.length; i++) {
		var vidId = data[i].id;
		var vidNumber = data[i].callbacknumber;
		if (vidNumber) {
			vidNumber = vidNumber.toString();
			if (vidNumber[0] === '1') vidNumber = vidNumber.slice(1, vidNumber.length);
			vidNumber = '(' + vidNumber.substring(0, 3) + ') ' + vidNumber.substring(3, 6) + '-' + vidNumber.substring(6, vidNumber.length);
		}
		var vidReceived = data[i].received;
		var vidDuration = data[i].video_duration;
		var vidStatus = data[i].status;
		var vidFilepath = data[i].video_filepath;
		var vidFilename = data[i].video_filename;
		table = document.getElementById("videomailTbody");
		row = table.insertRow(table.length);
		numberCell = row.insertCell(0);
		receivedCell = row.insertCell(1);
		durationCell = row.insertCell(2);
		statusCell = row.insertCell(3);
		filepathCell = row.insertCell(4);
		filepathCell.setAttribute('hidden', true);
		idCell = row.insertCell(5);
		idCell.setAttribute('hidden', true);
		filepathCell.innerHTML = vidFilepath + vidFilename;
		idCell.innerHTML = vidId;
		numberCell.innerHTML = vidNumber;
		receivedCell.innerHTML = vidReceived;
		durationCell.innerHTML = vidDuration;

		if (vidStatus === 'UNREAD')
			statusCell.innerHTML = '<span style="font-weight:bold">' + vidStatus + '</span>';
		else
			statusCell.innerHTML = vidStatus;
	}
}

//Notification for unread videomail
function updateVideomailNotification(data) {
	$("#unread-mail-count").html(data);
	if (data === 0)
		$("#unread-mail-count").html("");
}

//Filter videomail by status
function filterVideomail(mailFilter) {
	filter = mailFilter;
	socket.emit('get-videomail', {
		"extension": extensionMe,
		"sortBy": sortFlag,
		"filter": filter
	});
}

function processFilter(filter) {
	if (filter == 'ALL') {
		return ('');
	} else {
		return ('AND status = ' + filter);
	}
}

//Show videomail sidebar tab
function showVideoMailTab() {
	if ($('#agents-tab').hasClass('active')) {
		if (document.getElementById("ctrl-sidebar").hasAttribute('control-sidebar-open')) {
			$('.nav-tabs a[href="#control-sidebar-agents-tab"]').removeClass('active');
		}
	}
	$('.nav-tabs a[href="#control-sidebar-videomail-tab"]').tab('show');
	$('.nav-tabs a[href="#control-sidebar-videomail-tab"]').addClass('active');
}

//Show agent info sidebar tab
function showAgentsTab() {
	if ($('#videomail-tab').hasClass('active')) {
		if (document.getElementById("ctrl-sidebar").hasAttribute('control-sidebar-open')) {
			$('.nav-tabs a[href="#control-sidebar-agents-tab"]').removeClass('active');
		}
	}
	$('.nav-tabs a[href="#control-sidebar-agents-tab"]').tab('show');
	$('.nav-tabs a[href="#control-sidebar-agents-tab"]').addClass('active');
}

//Play the selected videomail
function playVideomail(id, duration, vidStatus) {
	console.log('Playing video mail with id ' + id);
	remoteView.removeAttribute("autoplay");
	remoteView.removeAttribute("poster");
	remoteView.setAttribute("src", './getVideomail?id=' + id + '&ext=' + extensionMe);
	remoteView.setAttribute("onended", "change_play_button()");
	toggle_videomail_buttons(true);
	updateVideoTime(duration, "vmail-total-time");
	if (vidStatus === "UNREAD") {
		videomail_read_onclick(id);
	}
}

//Update the time progress in the videomail seekbar
function updateVideoTime(time, elementId) {
	var minutes = Math.floor(time / 60);
	var seconds = Math.round(time - minutes * 60);
	var timeStr = "";
	if (seconds < 10) {
		timeStr = minutes.toString() + ":0" + seconds.toString();
	} else if (seconds === 60) {
		timeStr = (minutes + 1).toString() + ":00";
	} else {
		timeStr = minutes.toString() + ":" + seconds.toString();
	}
	document.getElementById(elementId).innerHTML = timeStr;
}

//Display the videomail control buttons
function toggle_videomail_buttons(make_visible) {
	if (make_visible) videomail_status_buttons.style.display = "block";
	else videomail_status_buttons.style.display = "none";
}

//Exit videomail view and return to call view
function stopVideomail() {
	console.log("Videomail view has been stopped, back to call view");
	remoteView.setAttribute("src", "");
	remoteView.removeAttribute("src");
	remoteView.removeAttribute("onended");
	remoteView.setAttribute("autoplay", "autoplay");
	remoteView.setAttribute("poster", "images/AD-logo.png");
	toggle_videomail_buttons(false);
}

//Callback for videomail
function videomailCallback(callbacknum) {
	stopVideomail();
	var videophoneNumber = callbacknum.match(/\d/g);
	videophoneNumber = videophoneNumber.join('');
	start_call(videophoneNumber);
	$('#duration').timer('reset');
	$('#outboundCallAlert').show();
	$('#user-status').text('In Call');
	changeStatusIcon(in_call_color, "in-call", in_call_blinking);
	changeStatusLight('IN_CALL');
	socket.emit('incall', null);
}

//Socket emit for changing status of a videomail
function videomail_status_change(id, videoStatus) {
	socket.emit('videomail-status-change', {
		"id": id,
		"extension": extensionMe,
		"status": videoStatus
	});
	console.log('Emitted a socket videomail-status-change');
}

//Marks the videomail read when the agent clicks it and doesn't close the videomail view
function videomail_read_onclick(id) {
	socket.emit('videomail-read-onclick', {
		"id": id,
		"extension": extensionMe
	});
	console.log('Emitted a socket videomail-read-onclick');
}

//Socket emit for deleting a videomail
function videomail_deleted(id) {
	socket.emit('videomail-deleted', {
		"id": id,
		"extension": extensionMe
	});
	console.log('Emitted a socket videomail-deleted');
}

//Videomail play button functionality
function play_video() {
	console.log('video paused: ' + remoteView.paused);
	if (remoteView.paused == true) { // play the video
		remoteView.play();
		document.getElementById("play-video-icon").classList.remove("fa-play");
		document.getElementById("play-video-icon").classList.add("fa-pause");
	} else { // pause the video
		remoteView.pause();
		document.getElementById("play-video-icon").classList.add("fa-play");
		document.getElementById("play-video-icon").classList.remove("fa-pause");
	}
}

function change_play_button() {
	console.log("Video ended");
	document.getElementById("play-video-icon").classList.add("fa-play");
	document.getElementById("play-video-icon").classList.remove("fa-pause");
}

//Seekbar functionality
var seekBar = document.getElementById("seek-bar");
// Event listener for the seek bar
seekBar.addEventListener("change", function () {
	// Calculate the new time
	var time = remoteView.duration * (seekBar.value / 100);

	// Update the video time
	remoteView.currentTime = time;
});

// Update the seek bar as the video plays

remoteView.addEventListener("timeupdate", function () {
	// Calculate the slider value
	var value = (100 / remoteView.duration) * remoteView.currentTime;

	// Update the slider value
	seekBar.value = value;

	//update the current time info
	updateVideoTime(remoteView.currentTime, "vmail-current-time");
});

// Event listener for the full-screen button
function enterFullscreen() {
	if (remoteView.requestFullscreen) {
		remoteView.requestFullscreen();
	} else if (remoteView.mozRequestFullScreen) {
		remoteView.mozRequestFullScreen(); // Firefox
	} else if (remoteView.webkitRequestFullscreen) {
		remoteView.webkitRequestFullscreen(); // Chrome and Safari
	}
}

function showDialpad() {
	$('#modalDialpad').modal({
		backdrop: 'static',
		keyboard: false
	});
}

$("#sidebar-dialpad .dropdown-menu").click(function (e) {
	e.stopPropagation();
});
$("#accept-btn").click(function () {
	$('#myRingingModalPhoneNumber').html('');
	$('#myRingingModal').modal('hide');
	$("#hide-video-icon").css("display", "none");
});

$("#decline-btn").click(function () {
	$('#myRingingModalPhoneNumber').html('');
	$('#myRingingModal').modal('hide');
});

//Dialpad functionality
$(".keypad-button").click(function (e) {
	var etemp = $(e.currentTarget);
	etemp.css("background-color", "Gray");
	setTimeout(() => {
		etemp.css("background-color", "White")
	}, 500);
	var el = etemp.find('.big');
	var text = el.text().trim();
	telNumber = $('#phone-number');
	$(telNumber).val(telNumber.val() + text);
});

$('#phone-number-delete-btn').click(function (e) {
	$('#phone-number').val(
		function (index, value) {
			return value.substr(0, value.length - 1);
		})
});

$("#button-call").click(function () {
	$('#modalDialpad').modal('hide');
	telNumber = $('#phone-number');
	start_call($(telNumber).val());
	$(telNumber).val('');
	$('#duration').timer('reset');
	$('#user-status').text('In Call');
	changeStatusIcon(in_call_color, "in-call", in_call_blinking);
	changeStatusLight('IN_CALL');
	socket.emit('incall', null);
	toggle_incall_buttons(true);
	$('#outboundCallAlert').show();
});

var options = {
	cellHeight: 40,
	verticalMargin: 10
};
var grid = $('.grid-stack').gridstack(options);

var serializedGridData = [];
var loadingGridLayout = false;

function saveGridLayout() {
	serializedGridData = _.map($('.grid-stack > .grid-stack-item:visible'), function (el) {
		el = $(el);
		var node = el.data('_gridstack_node');
		return {
			id: el[0].id,
			visible: el[0].visible,
			x: node.x,
			y: node.y,
			width: node.width,
			height: node.height
		};
	});

	sessionStorage.layout = JSON.stringify(serializedGridData);
	socket.emit('save-grid-layout', {'gridLayout':serializedGridData});
};

//if(typeof sessionStorage.layout == 'object')
//	loadGridLayout(sessionStorage.layout);

function loadGridLayout(layout) {
	sessionStorage.layout = JSON.stringify(layout); 
	loadingGridLayout = true;
	var grid = $('.grid-stack').data('gridstack');
	grid.batchUpdate();

	layout.forEach(function (el) {
		grid.update($('#' + el.id), el.x, el.y, el.width, el.height)
	});

	grid.commit();
	resizeVideo();
	resizeChat();
	loadingGridLayout = false;
}
resizeVideo();
resizeChat();
$('.grid-stack').on('change', function (event, items) {
	if (!loadingGridLayout) {
		saveGridLayout();
	}
	resizeVideo();
	resizeChat();
});

function resizeVideo(){
	var contentHeight = $("#gsvideobox").height() - 50;
	$('#VideoBox').css("height", contentHeight + "px");
	$('#remoteView').css("height", contentHeight-125 + "px");
}

function resizeChat(){
	var contentHeight = $("#gschatbox").height();

	var chatheaderHeight = $("#chat-header").outerHeight();
	var rtttypinHeight = $("#rtt-typing").outerHeight();
	var chatfooterheight = $("#chat-footer").outerHeight();
	var parts = chatheaderHeight + rtttypinHeight + chatfooterheight;

	var padding = 30;
	
	// userchat is overall chat box content, chatmessages is only the messages area
	$('#userchat').css("height", contentHeight - padding + "px");
	$('#chat-messages').css("height", contentHeight - parts - padding + "px");
}

function resetLayout(){
	var defaultLayout = [{"id":"gsvideobox","x":0,"y":0,"width":8,"height":16},{"id":"gschatbox","x":8,"y":0,"width":4,"height":10}];
	loadGridLayout(defaultLayout);
	resizeVideo();
	resizeChat();
}

//enables chat buttons on a webrtc call when it is accepted
function enable_chat_buttons(){
	$("#newchatmessage").removeAttr("disabled");  
	$("#chat-send").removeAttr("disabled");  
	$("#newchatmessage").attr("placeholder","Type Message ...");
	$("#characters-left").show();

}

//disables chat buttons 
function disable_chat_buttons(){
	$("#newchatmessage").attr("disabled","disabled");  
	$("#chat-send").attr("disabled","disabled");  
	$("#newchatmessage").attr("placeholder","Chat disabled");
	$("#characters-left").hide();

}

function enable_initial_buttons(){}
