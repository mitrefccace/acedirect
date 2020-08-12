var socket;
var extensionMe;
var extensionMePassword;
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
var playingVideomail = false;
var acekurento;
var privacy_video_url = null;
var recipientNumber;
//Used for tracking new videomail
var storedData = document.getElementById("unread-mail-count").innerHTML;
//Used for DTMFpad toggle
var DTMFpad = false;
//Call history values
var callerName = "";
var callerNumber;
var direction;
var duration;
var callDate;
var endpoint;

//shortcut table variables
var shortcutTableLength;
var currentShortcutRow=0;
var isSidebarOpen = false;

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

	// chat-transcript toggle
	$('#chat-tab').on('click', function(){
	  $('#chat-body').css('display', 'block');
	  $('#chat-footer').css('display', 'block');
	  $('#trans-body').css('display', 'none');
	});
	$('#trans-tab').on('click', function(){
	  $('#chat-body').css('display', 'none');
	  $('#chat-footer').css('display', 'none');
	  $('#trans-body').css('display', 'block');
	});

	clearScreen();

	$.getJSON("./resources/licenses.json", function (data) {
		$.each(data.license, function (i) {
			$("#licModalBody").append("<h3>" + data.license[i].name + "<h3><pre>" + data.license[i].pre + "</pre>");
		});
	});

	updateShortcutTable();
	enable_persist_view();
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
					path: nginxPath+'/socket.io',
					query: 'token=' + data.token,
					forceNew: true
				});

				console.log("Function load call history");
				loadCallHistory();

				//update the version and year in the footer
				socket.on('adversion', function (data) {
					$('#ad-version').text(data.version);
					$('#ad-year').text(data.year);
				});

				socket.on('connect', function () {
					debugtxt('connect', {
						"no": "data"
					});
					console.log('authenticated');

					socket.emit("get_color_config");

					//get the payload from the token
					var payload = jwt_decode(data.token);
					console.log("Payload is " + JSON.stringify(payload));
                                        if (!payload.signalingServerProto) {
                                           payload.signalingServerProto = 'wss';
                                        }
				        var signaling_url  = payload.signalingServerProto + '://' + payload.signalingServerPublic + ':' + payload.signalingServerPort + '/signaling';

                                        //see if we should override with a full NGINX route (development only)
                                        var dev_url = payload.signalingServerDevUrl;
                                        dev_url = dev_url.trim();
                                        if(dev_url !== null && dev_url !== '') {
                                          console.log('Using signaling server: ' + dev_url);
                                          signaling_url = dev_url;
                                        }

					console.log('signaling_url: ' + signaling_url);
										
				        acekurento = new ACEKurento({acekurentoSignalingUrl: signaling_url  });
	
					acekurento.remoteStream = document.getElementById('remoteView');
					acekurento.selfStream = document.getElementById('selfView');

					$('#loginModal').modal('hide');
					$('#statusmsg').text(""); //clear status text

					//populate call agent information
					$('#displayname').val("CSR " + payload.first_name);
					$('#agentname-sidebar').html(payload.first_name + " " + payload.last_name);
					$('#agentname-header').html(payload.first_name + " " + payload.last_name);
					$('#agentname-headerdropdown').html(payload.first_name + " " + payload.last_name);
					$('#agentrole-headerdropdown').html("<small>" + payload.role + "</small>");
					$('#my_sip_uri').attr("name", "sip:" + payload.extension + "@" + payload.asteriskPublicHostname);
					$('#signaling_server_public').attr("name", payload.signalingServerPublic);
					$('#signaling_server_port').attr("name", payload.signalingServerPort);
					$('#sip_password').attr("name", payload.extensionPassword);
					$("#pc_config").attr("name", "stun:" + payload.stunServer);
					$("#complaints-queue-num").text(payload.complaint_queue_count);
					$("#general-queue-num").text(payload.general_queue_count);

                                        privacy_video_url = payload.privacy_video_url;
					signalingServerPublic = document.getElementById("signaling_server_public");
					signalingServerPort = document.getElementById("signaling_server_port");

					if (payload.queue_name === "ComplaintsQueue" || payload.queue2_name === "ComplaintsQueue") {
						$('#sidebar-complaints').show();
					}
					if (payload.queue_name === "GeneralQuestionsQueue" || payload.queue2_name === "GeneralQuestionsQueue") {
						$('#sidebar-geninfo').show();
					}

					if (payload.layout || sessionStorage.layout) {
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
					extensionMePassword = payload.extensionPassword;
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
				}).on("unauthorized", function (error) {
					debugtxt('unauthorized', error);
					if (error.data.type === "UnauthorizedError" || error.data.code === "invalid_token") {
						console.log("EXPIRED session");
						logout("Session has expired");
					}
				}).on('error', function (reason) {
					debugtxt('error', reason);

					if (reason.code === "invalid_token") {
						//logout("Session has expired");
						location.reload();
					} else {
						logout("An Error Occurred: " + JSON.stringify(reason));
					}
				}).on("call-center-closed", function (data) {
                                  if (data.closed) {
                                    $("#closed-label").text('Call Center Closed');
                                  } else {
                                    $("#closed-label").text('');
                                  }
                }).on('typing', function (data) {
					debugtxt('typing', data);
					if ($("#displayname").val() !== data.displayname) {
						$("#rtt-typing").html(data.displayname + ": " + data.rttmsg).addClass("direct-chat-text").addClass("direct-chat-timestamp text-bold");
						$("#rtt-typing").appendTo($("#chat-messages"));
					}
				}).on('typing-clear', function (data) {
					debugtxt('typing-clear', data);
					if ($("#displayname").val() !== data.displayname) {
						$("#chat-messages").remove($("#rtt-typing"));					
						$('#rtt-typing').html('').removeClass("direct-chat-text");
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
				}).on('chat-leave', function (data) {
					console.log(acekurento.isMultiparty + " is multiparty");
                                        if (acekurento.activeAgentList)
					  console.log(acekurento.activeAgentList.length + " is number of agents.");
					if(acekurento.activeAgentList  && acekurento.activeAgentList.length < 2){
						debugtxt('chat-leave', data);
						$('#duration').timer('pause');
						$('#user-status').text('Wrap Up');
						$('#complaintsInCall').hide();
						$('#geninfoInCall').hide();
						socket.emit('wrapup', null);
						changeStatusIcon(wrap_up_color, "wrap-up", wrap_up_blinking);
						changeStatusLight('WRAP_UP');
						socket.emit('chat-leave-ack', data);
					}
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
						$('#chat-messages').remove($("#rtt-typing"));
						$("#rtt-typing").html('').removeClass("direct-chat-text");

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
					}
				}).on('ad-zendesk', function (data) {
					debugtxt('ad-zendesk', data);
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
					socket.emit('send-name', {
						"agent_name": agent_name,
						"vrs": vrs
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
					if (data.message === "success") {
						var tabledata = {
							data: []
						};
						//Table for multi party invite
						$('#availableAgents').empty();
						$('#availableAgents').append(
							"<tr><td>Name</td>" +
							"<td>Extension</td>" +
							"<td>Status</td>" + 
							"<td>Multi-Party Invite</td></tr>"
						)
						for (var i = 0; i < data.agents.length; i++) {
							var statusTxt, sColor, queues = "";
							var sBlinking = false;
							switch (data.agents[i].status) {
								case "READY":
									sColor = ready_color;
									sBlinking = ready_blinking;
									statusTxt = "Ready";
									break;
								case "AWAY":
									sColor = away_color;
									sBlinking = away_blinking;
									statusTxt = "Away";
									break;
								case "INCALL":
									sColor = in_call_color;
									sBlinking = in_call_blinking;
									statusTxt = "In Call";
									break;
								case "WRAPUP":
									sColor = wrap_up_color;
									sBlinking = wrap_up_blinking;
									statusTxt = "Wrap Up";
									break;
								case "INCOMINGCALL":
									var inThirdParty = false;

									if(acekurento && acekurento.activeAgentList){
										for(var j = 0; j < acekurento.activeAgentList.length; j++){
											if(acekurento.activeAgentList[j].ext == data.agents[i].extension){
												inThirdParty = true;
											}
										}
									}
									if(inThirdParty){
										sColor = in_call_color;
										sBlinking = in_call_blinking;
										statusTxt = "In Call";
										break;
									} else {
										sColor = incoming_call_color;
										sBlinking = incoming_call_blinking;
										statusTxt = "Incoming Call";
										break;
									}
								case "MISSEDCALL":
									sColor = missed_call_color;
									sBlinking = missed_call_blinking;
									statusTxt = "Missed Call";
									break;
								default:
									sColor = "gray";
									statusTxt = "Unknown";
							}

							var statusDiv = document.createElement('div');
							var statusLightIcon = document.createElement('i');

							$(statusDiv).css('display:inline-block');
							$(statusLightIcon).addClass(getStatusIconClasses(sColor, sBlinking));
							$(statusDiv).append(statusLightIcon);
							$(statusDiv).append("&nbsp;&nbsp;" + statusTxt);

							for (var j = 0; j < data.agents[i].queues.length; j++) {
								queues += data.agents[i].queues[j].queuename + "<br>";
							}

							queues = queues.replace(/<br>\s*$/, "");
							tabledata['data'].push({
								"status": $(statusDiv).html(),
								"name": data.agents[i].name,
								"extension": data.agents[i].extension,
								"queues": queues,
								"multipartyInvite" : (data.agents[i].status == 'READY' && $('#user-status').text() == 'In Call' && $("#agentname-sidebar").text() != data.agents[i].name) 
								? "<Button class=\"demo-btn\" onClick=multipartyinvite(" + data.agents[i].extension + ")><i class=\"fa fa-users\"></i></Button>" 
								: "<Button class=\"secondary\" disabled><i class=\"fa fa-users\"></i></Button>"
							});
							$('#availableAgents').append(
								"<tr><td>" + data.agents[i].name + "</td>" +
								"<td>" + data.agents[i].extension + "</td>" +
								"<td>" + $(statusDiv).html() + "</td>"
							)
							if(data.agents[i].status == "READY" && $('#user-status').text() == 'In Call' && $('agentname-sidebar').text() != data.agents[i].name){
								$('#availableAgents').append(
									"<td><Button class=\"btn btn-default\" onClick=multipartyinvite(" + data.agents[i].extension + ")>Invite to Call</Button></td></tr>"
								)
							}else{
								$('#availableAgents').append("</tr>");
							}
						}

						$('#agenttable').dataTable().fnClearTable();
						if (tabledata.data.length > 0) {
							$('#agenttable').dataTable().fnAddData(tabledata.data);
						}
					}
				}).on('new-caller-ringing', function (data) {
					console.log("New caller ringing event triggered " + data.phoneNumber);
					debugtxt('new-caller-ringing', data);
					$('#myRingingModal').addClass('fade');
					changeStatusLight('INCOMING_CALL');
					changeStatusIcon(incoming_call_color, "incoming-call", incoming_call_blinking);
					$('#user-status').text('Incoming Call');
					if(data.phoneNumber){
						$('#myRingingModalPhoneNumber').html(data.phoneNumber);
						recipientNumber = data.phoneNumber;
						callerNumber = data.phoneNumber;
					} else{
						$('#myRingingModalPhoneNumber').html(data.callerNumber);
					}
					$('#myRingingModal').modal({
						show: true,
						backdrop: 'static',
						keyboard: false
					});
					//Did come with null
					socket.emit('incomingcall', null);
				}).on('new-missed-call', function (data) {
					debugtxt('new-missed-call', data);
					$('#myRingingModal').modal('hide');
					unpauseQueues();
				}).on('outbound-answered', function (data) {
					debugtxt('outbound-answered', data);
					$('#modalOutboundCall').modal('hide');
					console.log("ANSWER -- Option 2: Added asterisk AMI event listener to catch outboud answers. Good: fires when asterisk detects the call has been answered. Bad: not sure what happens if call is never answered. Not sure about multiparty calls.")
					//setTimeout(() => {
					//	calibrateVideo(2000);
					//}, 1000);
				}).on('new-peer', function (data) {
					//new peer is required for out going videomail on purple and zrvs networks
					// if this is done on a convo provider call it could cause black/green video issues.
					//console.log("New peer joined the call for purple and zvrs only");
					//toggleSelfview(200);
				}).on('request-assistance-response', function (data) {
					debugtxt('request-assistance-response', data);
                                        window.setTimeout(function() {
                                          $("#helpalert_placeholder").append('<div id="helpalert" class="alert alert-info" role="alert" >Request received.</div>');
                                          $("#helpalert").show();
                                          $("#helpalert").fadeTo(3000, 0).slideUp(500, function(){
                                            $(this).remove();
                                          });
                                        }, 0);
				}).on('lightcode-configs', function (data) {
					debugtxt('lightcode-configs', data);
					updateColors(data);
					busylight.updateConfigs(data);
				}).on('caption-config', function (data) {
					if(data == 'false') {
						console.log('captions off');
						$('.config-hide').css('display', 'none');
						$('#transcriptoverlay').css('display', 'none');
						$('#mute-captions').css('display', 'none');
					}
				}).on('skinny-config', function (data) {
					if (data === "true") {
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
				}).on('queue-caller-join', function (data) {
					if (data.queue === "ComplaintsQueue") {
						$("#complaints-queue-num").text(data.count);
					} else if (data.queue === "GeneralQuestionsQueue") {
						$("#general-queue-num").text(data.count);
					}
				}).on('queue-caller-leave', function (data) {
					if (data.queue === "ComplaintsQueue") {
						$("#complaints-queue-num").text(data.count);
					} else if (data.queue === "GeneralQuestionsQueue") {
						$("#general-queue-num").text(data.count);
					}
				}).on('force-logout', function(){
					console.log("FORCED logout");
					logout('Forcefully logging out');
				}).on('agent-resp', function(data) { //Load the agent table in the multi party modal
					console.log("The agents are " + JSON.stringify(data));
				}).on('fileList', function(data){
					console.log("Got fileList event");
					$('#fileSent').show();
					document.getElementById("downloadButton").className = "demo-btn"
					document.getElementById("downloadButton").disabled = false;
					$('#downloadButton').html('');
					for(var i = 0; i < data.result.length; i++){
						$('#downloadButton').append('<a class="demo-btn mb-3" target="_blank" href="./downloadFile?id=' + data.result[i].id + '">' + data.result[i].original_filename +'</a><br>');
					}
				}).on('screenshareRequest', function(data){
					$('#screenshareButtons').show()
					console.log('Screenshare buttons enabled');
				});

			} else {
				//we do nothing with bad connections
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
		},
		{
			"mDataProp": "multipartyInvite"
		}
	],
	searching: false,
	paging: false,
	scrollY: 600,
	order: []
});

$("#ivrsnum").keyup(function (event) {
	if (event.keyCode === 13) {
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

function addEmoji(emoji) {
	var value = $('#newchatmessage').val();
	var displayname = $('#displayname').val();
	var vrs = $('#callerPhone').val();

	value = value+emoji;
	$('#newchatmessage').val(value);	

	socket.emit('chat-typing', {
		"displayname": displayname,
		"vrs": vrs,
		rttmsg: value
	});
}

function requestAssistance() {
	socket.emit('request-assistance', null);
}

function getStatusIconClasses(color, blinking) {
	return (blinking) ? "status-margin-small text-" + color + "-blinking" : "fa fa-circle text-" + color;
}

function logout(msg) {
        console.log('logout(): ' + msg);
	busylight.light('OFF_DUTY');
	changeStatusLight('OFF_DUTY');
	//clear the token from session storage
	sessionStorage.clear();
	//disconnect socket.io connection
	if (socket)
		socket.disconnect();
	//display the login screen to the user.
	window.location.href = './logout';

}

function modifyTicket() {
	$('#notickettxt').hide();
	var id = $('#ticketId').val();
	var subject = $('#subject').val();
	var description = $('#problemdesc').val();
	var resolution = $('#resolution').val();
	var fname = $('#callerFirstName').val();
	var email = $('#callerEmail').val();
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
	var vrs = $('#callerPhone').val();
	socket.emit('incall', {'vrs' : vrs});
	if (endpoint_type === "Provider_Complaints") {
		endpoint = "provider";
		disable_chat_buttons();
		$("#newchatmessage").attr("placeholder", "Chat disabled for Provider endpoints");
		$('#remoteView').css('object-fit', ' contain');
	} else { //should be webrtc
		endpoint = "webrtc";
		enable_chat_buttons();
		$('#remoteView').css('object-fit', ' cover');
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
	var vrs = $('#callerPhone').val();
	socket.emit('incall', {'vrs' : vrs});
	if ( endpoint_type === "Provider_General_Questions" || endpoint_type === "General_Questions" ) {
		endpoint = "provider";
		disable_chat_buttons();
		$("#newchatmessage").attr("placeholder", "Chat disabled for provider endpoints");
		$('#remoteView').css('object-fit', ' contain');
	} else { //should be webrtc
		endpoint = "webrtc";
		enable_chat_buttons();
		$('#remoteView').css('object-fit', ' cover');
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
	if(this.agentStatus == 'READY'){
		stopVideomail();
	}
}

//i == 1: go to Ready; i == 0: go to Away
function finished(i) {
	$('#destexten').val('');
	clearScreen();
	if (i === 1)
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

	$('#caption-messages').html('');
        $('#transcriptoverlay').html('');
	$('#chat-messages').html('<div id="rtt-typing"></div>');
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
	$('#modalOutboundCall').modal('hide');
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
		if (data[status].color.toLowerCase() === "off") {
			data[status].color = "gray";
			data[status].blink = false;
		}

		if (data[status].id.toLowerCase() === "away") {
			away_color = data[status].color;
			away_blinking = data[status].blink;
		} else if (data[status].id.toLowerCase() === "ready") {
			ready_color = data[status].color;
			ready_blinking = data[status].blink;
		} else if (data[status].id.toLowerCase() === "in_call") {
			in_call_color = data[status].color;
			in_call_blinking = data[status].blink;
		} else if (data[status].id.toLowerCase() === "hold") {
			hold_color = data[status].color;
			hold_blinking = data[status].blink;
		} else if (data[status].id.toLowerCase() === "incoming_call") {
			incoming_call_color = data[status].color;
			incoming_call_blinking = data[status].blink;
		} else if (data[status].id.toLowerCase() === "transferred_call") {
			transferred_call_color = data[status].color;
			transferred_call_blinking = data[status].blink;
		} else if (data[status].id.toLowerCase() === "wrap_up") {
			wrap_up_color = data[status].color;
			wrap_up_blinking = data[status].blink;
		} else if (data[status].id.toLowerCase() === "need_assistance") {
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
	if (wrap_up_color === "white") $('#wrapup-color').addClass("text-gray");
	else $('#wrapup-color').addClass("text-" + wrap_up_color);
	if (away_color === "white") $('#away-color').addClass("text-gray");
	else $('#away-color').addClass("text-" + away_color);
	if (ready_color === "white") $('#ready-color').addClass("text-gray");
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
   //no longer needed
  ; 
}


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
	if(agentStatus != 'IN_CALL'){
		console.log("Table is "+tableData[3]+" "+tableData[4]+" "+tableData[5]);
		playVideomail(tableData[4], tableData[2], tableData[3]); //vidId, vidDuration vidStatus);
	}
});

//Sorting the videomail table
$('#vmail-vrs-number').on('click', function () {
	var sort = sortButtonToggle($(this).children("i"));
	if (sort === "asc") {
		sortFlag = "callbacknumber asc";
	} else if (sort === "desc") {
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
	if (sort === "asc") {
		sortFlag = "received asc";
	} else if (sort === "desc") {
		sortFlag = "received desc";
	}
	socket.emit('get-videomail', {
		"extension": extensionMe,
		"sortBy": sortFlag,
		"filter": filter
	});
});

$('#vmail-duration').on('click', function () {
	var sort = sortButtonToggle($(this).children("i"));
	if (sort === "asc") {
		sortFlag = "video_duration asc";
	} else if (sort === "desc") {
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
	if (sort === "asc") {
		sortFlag = "status asc";
	} else if (sort === "desc") {
		sortFlag = "status desc";
	}
	socket.emit('get-videomail', {
		"extension": extensionMe,
		"sortBy": sortFlag,
		"filter": filter
	});
});

function sortButtonToggle(buttonid) {
	if ($(buttonid).attr("class") === 'fa fa-sort') {
		$(buttonid).addClass('fa-sort-asc').removeClass('fa-sort');
		return ("asc");
	} else if ($(buttonid).attr("class") === 'fa fa-sort-desc') {
		$(buttonid).addClass('fa-sort-asc').removeClass('fa-sort-desc');
		return ("asc");
	} else if ($(buttonid).attr("class") === 'fa fa-sort-asc') {
		$(buttonid).addClass('fa-sort-desc').removeClass('fa-sort-asc');
		return ("desc");
	}
}

//Update the records in the videomail table
function updateVideomailTable(data) {
	$("#videomailTbody").html("");
	var table;
	var row;
	var numberCell;
	var receivedCell;
	var durationCell;
	var statusCell;
	var callbackCell;
	for (var i = 0; i < data.length; i++) {
		var vidId = data[i].id;
		var vidNumber = data[i].callbacknumber;
		if (vidNumber) {
			vidNumber = vidNumber.toString();
			if (vidNumber[0] === '1') vidNumber = vidNumber.slice(1, vidNumber.length);
			vidNumber = '(' + vidNumber.substring(0, 3) + ') ' + vidNumber.substring(3, 6) + '-' + vidNumber.substring(6, vidNumber.length);
		}

                //convert videomail received time to client browser timezone
		var vidReceived = data[i].received;
                const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                vidReceived = new Date(vidReceived).toLocaleString('en-US', { timeZone: tz }); 

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
		idCell = row.insertCell(4);
		idCell.setAttribute('hidden', true);
		callbackCell = row.insertCell(5);
		//filepathCell = row.insertCell(5);
		//filepathCell.setAttribute('hidden', true);
		//filepathCell.innerHTML = vidFilepath + vidFilename;
		idCell.innerHTML = vidId;
		numberCell.innerHTML = vidNumber;
		receivedCell.innerHTML = vidReceived;
		durationCell.innerHTML = vidDuration;

		if ($('#user-status').text() == 'Away'){
			callbackCell.innerHTML = '<button class=\"demo-btn\" onclick="outbound_call(\'' + data[i].callbacknumber + '\')"><i class="fa fa-phone-square"></i></button>';
		} else{
			callbackCell.innerHTML = '<button><i class="fa fa-phone-square"></i></button>';
		}

		if (vidStatus === 'UNREAD')
			statusCell.innerHTML = '<span style="font-weight:bold">' + vidStatus + '</span>';
		else
			statusCell.innerHTML = vidStatus;
	}
}

//Notification for unread videomail
function updateVideomailNotification(data) {
	if(data != storedData){
		if(data > storedData){
			showAlert('info', 'You have a new unread videomail');
		}
		storedData = data;
	}
	$("#unread-mail-count").html(data);
	if (data === 0){
		$("#unread-mail-count").html("");
	}
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
	if (filter === 'ALL') {
		return ('');
	} else {
		return ('AND status = ' + filter);
	}
}

//Show videomail sidebar tab
function showVideoMailTab() {
	if ($('#videomail-tab').hasClass('active') || $('#agents-tab').hasClass('active') ) {
		// if the sidebar is closing, remove the shortcuts of the tabs
		$('#videomail-tab').attr("accesskey", '');
		$('#agents-tab').attr("accesskey", '');
		$('#shortcuts-tab').attr("accesskey", '');
		updateShortcutTable();
		
		$('#agents-tab').removeClass('active');
		$('#videomail-tab').removeClass('active');
		
		isSidebarOpen = false;
		
	} else {
		// sidebar is opening, re-add the tab shortcuts
		$('#videomail-tab').attr("accesskey", 'm');
		$('#agents-tab').attr("accesskey", 'a');
		$('#shortcuts-tab').attr("accesskey", 'k');
		updateShortcutTable();

		if ($('#agents-tab').hasClass('active')) {
			if (document.getElementById("ctrl-sidebar").hasAttribute('control-sidebar-open')) {
				$('.nav-tabs a[href="#control-sidebar-agents-tab"]').removeClass('active');

				$('#agents-tab').removeClass('active');

				isSidebarOpen = true;
				
			}
		}
		isSidebarOpen = true;
		$('.nav-tabs a[href="#control-sidebar-videomail-tab"]').tab('show');
		$('.nav-tabs a[href="#control-sidebar-videomail-tab"]').addClass('active');
		$('#videomail-tab').addClass('active');
	}

}

//Show agent info sidebar tab
function showAgentsTab() {
	if ( $('#agents-tab').hasClass('active') || $('#videomail-tab').hasClass('active') ) {
		// if the sidebar is closing, remove the tab shortcuts
		$('#videomail-tab').attr("accesskey", '');
		$('#agents-tab').attr("accesskey", '');
		$('#shortcuts-tab').attr("accesskey", '');
		updateShortcutTable();

		$('#agents-tab').removeClass('active');
		$('#videomail-tab').removeClass('active');
		isSidebarOpen = false;
		
	} else {
		// sidebar is opening, re-add the tab shortcuts
		$('#videomail-tab').attr("accesskey", 'm');
		$('#agents-tab').attr("accesskey", 'a');
		$('#shortcuts-tab').attr("accesskey", 'k');
		updateShortcutTable();

		if ($('#videomail-tab').hasClass('active')) {
			if (document.getElementById("ctrl-sidebar").hasAttribute('control-sidebar-open')) {
				$('.nav-tabs a[href="#control-sidebar-agents-tab"]').removeClass('active');
				$('#videomail-tab').removeClass('active')

				isSidebarOpen = true;

			}
		}
		isSidebarOpen = true;
		$('.nav-tabs a[href="#control-sidebar-videomail-tab"]').removeClass('active')
		$('.nav-tabs a[href="#control-sidebar-agents-tab"]').tab('show');
		$('.nav-tabs a[href="#control-sidebar-agents-tab"]').addClass('active');
		$('#agents-tab').addClass('active');
	}

}

//Play the selected videomail
function playVideomail(id, duration, vidStatus) {
	//Start by removing the persist camera and sending agent to away
	disable_persist_view();
	document.getElementById("persistCameraCheck").disabled = true;
	playingVideomail = true;
	pauseQueues();

	console.log('Playing video mail with id ' + id);
	//remoteView.removeAttribute("autoplay");
	remoteView.removeAttribute("poster");
	remoteView.setAttribute("src", './getVideomail?id=' + id + '&ext=' + extensionMe);
	//New attribute for control
	remoteView.setAttribute("controls","controls");
	/*remoteView.setAttribute("onended", "change_play_button()");
	if (document.getElementById("play-video-icon").classList.contains("fa-pause")) {
		document.getElementById("play-video-icon").classList.add("fa-play");
		document.getElementById("play-video-icon").classList.remove("fa-pause");
	}*/
	toggle_incall_buttons(false);
	toggle_videomail_buttons(true);
	updateVideoTime(duration, "vmail-total-time");
	if (vidStatus === "UNREAD") {
		videomail_read_onclick(id);
	}
	seekBar.value = 0;
	remoteView.currentTime = 0;
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
function exitVideomail() {
	stopVideomail()
	document.getElementById("persistCameraCheck").disabled = false;
	if (document.getElementById("persistCameraCheck").checked == true) {
		enable_persist_view();
	}
}

function stopVideomail() {
	console.log("Videomail view has been stopped, back to call view");
	remoteView.setAttribute("src", "");
	remoteView.removeAttribute("src");
	remoteView.removeAttribute("onended");
	remoteView.removeAttribute("controls");
	remoteView.setAttribute("autoplay", "autoplay");
	remoteView.setAttribute("poster", "images/acedirect-logo.png");
	toggle_videomail_buttons(false);
	playingVideomail = false;
}

//Callback for videomail
function videomailCallback(callbacknum) {
	stopVideomail();
	var videophoneNumber = callbacknum.match(/\d/g);
	videophoneNumber = videophoneNumber.join('');
	direction = 'outgoing';
	start_call(videophoneNumber);
	$('#duration').timer('reset');
	$('#outboundCallAlert').show();
	$('#user-status').text('In Call');
	changeStatusIcon(in_call_color, "in-call", in_call_blinking);
	changeStatusLight('IN_CALL');
	var vrs = $('#callerPhone').val();
	socket.emit('incall', {'vrs' : vrs});
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
seekBar.addEventListener("change", function() {
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

// Pause the video when the seek handle is being dragged
seekBar.addEventListener("mousedown", function() {
	//remoteView.pause();
	play_video()
});

// Play the video when the seek handle is dropped
seekBar.addEventListener("mouseup", function() {
	//remoteView.play();
	play_video()
});

// Event listener for the full-screen button
function enterFullscreen() {
	var webcam_container = document.getElementById("fullscreen-element");

	if (!document.fullscreenElement && !document.mozFullScreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement ) {

		if (webcam_container.requestFullscreen) {
			webcam_container.requestFullscreen();
		} else if (webcam_container.msRequestFullscreen) {
			webcam_container.msRequestFullscreen();
		} else if (webcam_container.mozRequestFullScreen) {
			webcam_container.mozRequestFullScreen();
		} else if (webcam_container.webkitRequestFullscreen) {
			webcam_container.webkitRequestFullscreen();
		}
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
	}
}

function toggleDisplay(){
	var video_display = $('#remoteView');

	if(video_display.css('object-fit') == 'contain') {
		video_display.css('object-fit: cover');
	} else {
		video_display.css('object-fit: contain');
	}
}

var fade_timer = null;
function clearFadeTimer(){
	if(fade_timer) {
		clearTimeout(fade_timer);
		fade_timer = 0;
	}
}

function fade(type='out'){
	$('#call-option-buttons button').each(function(i){
		$(this).css('animation', `fade-${type} 0.${i+2}s ease-out forwards`);
	});

	// Videomail status controls. It looks better when button, span, and input are animated separately.
	// Otherwise they animate out of order.
	$('#videomail-status-buttons button').each(function(i){
		$(this).css('animation', `fade-${type} 0.${i+2}s ease-out forwards`);
	});

	$('#videomail-status-buttons span').each(function(i){
		$(this).css('animation', `fade-${type} 0.${i+2}s ease-out forwards`);
	});

	$('#videomail-status-buttons input').each(function(i){
		$(this).css('animation', `fade-${type} 0.${i+2}s ease-out forwards`);
	});

	if(type == 'out') {
		$('#transcriptoverlay').css('bottom', '10px');
	} else {
		$('#transcriptoverlay').css('bottom', '65px');
	}
}

$('#fullscreen-element').mousemove(function(){
	clearFadeTimer();
	fade('in');
	fade_timer = setTimeout(fade, 3000);
});

$('#fullscreen-element').mouseleave(function(){
	clearFadeTimer();
	fade_timer = setTimeout(fade, 500);
});

function showDialpad() {
	$('#modalDialpad').modal({
		backdrop: 'static',
		keyboard: false
	});

	$("#dialpad-tab").trigger("click");

	$('#modalDialpad').on('shown.bs.modal', function() {
		$('#phone-number').focus();
	});
}

function showCallHistory() {
	$('#modalDialpad').modal({
		backdrop: 'static',
		keyboard: false
	});

	$("#callhistory-tab").trigger("click");
}

function showOutboundRinging() {
	$('#modalOutboundCall').modal({
		backdrop: 'static',
		keyboard: false
	});
}

function transferCallModal() {
	$('#modalCallTransfer').modal({
		backdrop: 'static',
		keyboard: false
	})
}

//Logic for multi part calls
function multipartyModal(){
	socket.emit('ami-req', 'agent');
	$('#modalMultiPartyExt').modal({
		backdrop: 'static',
		keyboard: false
	})
}

//Check if status needs to be changed
$('#accept-btn').click(function () {
	$('#user-status').text('In Call');
	changeStatusIcon(in_call_color, "in-call", in_call_blinking);
	changeStatusLight('IN_CALL');
	//Added for multiparty status
	var vrs = $('#callerPhone').val();
	socket.emit('incall', {'vrs' : vrs});
})


function multiPartyClick(){
	multipartyinvite(document.getElementById('inviteExtension').value);
}

//Logic for multi part calls
function retreiveFiles(){
	socket.emit('get-file-list', {vrs : recipientNumber});
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
		etemp.css("background-color", "White");
	}, 500);
	var el = etemp.find('.big');
	var text = el.text().trim();
	telNumber = $('#phone-number');
	$(telNumber).val(telNumber.val() + text);
        $("#phone-number").focus();
});

$('#phone-number-delete-btn').click(function (e) {
	$('#phone-number').val(
		function (index, value) {
			return value.substr(0, value.length - 1);
		});
  $("#phone-number").focus();
});

//pressing Enter in dialpad will dial
// pressing ESC will close
$("#phone-number").keyup(function(event) {
    if (event.keyCode === 13) {
        $("#button-call").click();
    } else if (event.keyCode == 27) {
		$('#dismiss-dialpad-btn').click();
	}
});

$("#button-call").click(function () {
	if($('#phone-number').val() < 10){
		//Phone number is not valid
		$('#invalidNumber').show();
	}else {
		direction = 'outgoing';
		$('#modalDialpad').modal('hide');
		$('#invalidNumber').hide();
		showOutboundRinging();
		telNumber = $('#phone-number');
		callerNumber = $('#phone-number').val();
		start_call($(telNumber).val());
		$(telNumber).val('');
		$('#duration').timer('reset');
		$('#user-status').text('In Call');
		changeStatusIcon(in_call_color, "in-call", in_call_blinking);
		changeStatusLight('IN_CALL');
		var vrs = $('#callerPhone').val();
		socket.emit('incall', {'vrs' : vrs});
		toggle_incall_buttons(true);
		$('#outboundCallAlert').show();
	}
});

//Functionality for videomail hover while in call
$("#videomailTbody").hover(function(){
    if(agentStatus == 'IN_CALL'){
        document.getElementById("videomailTbody").style.cursor = "not-allowed";
    }else{
        document.getElementById("videomailTbody").style.cursor = "pointer";
    }
});

//Functionality for persist camera
$("#persistCameraCheck").click(function(){
	if(document.getElementById("persistCameraCheck").checked == true){
		enable_persist_view();
	}else if(document.getElementById("persistCameraCheck").checked == false){
		disable_persist_view();
	}
});

//Functionality for screenshare
$("#screenShareButton").click(function(){
	if(agentStatus == 'IN_CALL'){
		document.getElementById("screenShareButton").style.cursor = "pointer";
	}else{
		document.getElementById("screenShareButton").style.cursor = "not-allowed";
	}
});

$("#allowScreenshare").click(function(){
	console.log('Allow screenshare');
	socket.emit('screenshareResponse', {'permission' : true, 'number' : recipientNumber});
	$('#screenshareButtons').hide();
});

$("#disallowScreenshare").click(function(){
	console.log('Disallow screenshare');
	socket.emit('screenshareResponse', {'permission' : false, 'number' : recipientNumber});
	$('#screenshareButtons').hide();
});

//Functionality for fileshare
function ShareFile(){
	//console.log("Sending file " + document.getElementById("fileInput").files[0]);
	var vrs = $('#callerPhone').val();
	var formData = new FormData();
	formData.append('uploadfile', $("#fileInput")[0].files[0]);
	//TODO get vrs number
	formData.append("vrs", vrs);
	$.ajax({
		url: './fileUpload',
		type: "POST",
		data: formData,
		contentType: false,
		processData: false,
		success: function (data) {
			console.log(JSON.stringify(data, null, 2))
			//TODO Get unique call identifier
			socket.emit('get-file-list', {"vrs" : vrs});
		},
		error: function (jXHR, textStatus, errorThrown) {
			console.log("ERROR");
		}
	});
}

$("#fullscreen-element").dblclick(function(){
	enterFullscreen();
})

//Alert message function
function showAlert(alertType, alertText){
	$('#generalAlert').attr('class','alert alert-' + alertType + ' alert-dismissible');
	$('#alertText').html(alertText);
	$('#generalAlert').show();
	setTimeout(function(){
		$('#generalAlert').hide();
	},2000)
}

//Keypress for DTMF toggle
$(document).on('keypress', function(e){
	if(e.which == 'k' && agentStatus == 'IN_CALL'){
		if(DTMFpad){
			$('#dtmfpad').hide();
			DTMFpad = false;
		}else{
			$('#dtmfpad').show();
			DTMFpad = true;
		}
	}
})

//Button press for DTMF toggle
$("#toggleDTMF").click(function(){
	if(DTMFpad){
		$('#dtmfpad').hide();
		DTMFpad = false;
	}else{
		$('#dtmfpad').show();
		DTMFpad = true;
	}
})

function DTMFpress(number){
	showAlert('info', 'You pressed key number ' + number);
	acekurento.sendDTMF(number);
}

function changeTabs(id){
	if(id == "callhistory-tab"){
		$('#callCard').hide();
		$('#callhistory').show();
		$('#contact-tab').hide();
		$('#callHistoryBody').show();
	}else if(id == "dialpad-tab"){
		$('#callCard').show();
		$('#callhistory').hide();
		$('#contact-tab').hide();
		$('#callHistoryBody').hide();
	}else if(id == "contact-tab"){
		$('#callCard').hide();
		$('#callhistory').hide();
		$('#contact-tab').show();
		$('#callHistoryBody').hide();
	}
}

function loadCallHistory(){

	var endpointType;
	socket.emit('getCallHistory');
	socket.on('returnCallHistory', function(result){

                $("#callHistoryBody").html("");
  
                var show_records = 20; //num call history records to show
                var count_recs = 0;
		for(var i = result.length - 1; i >= 0; i--){
                        count_recs++;
			if(result[i].endpoint == "webrtc"){
				endpointType = '<i class="fa fa-globe"></i>';
			} else{
				endpointType = '<i class="fa fa-phone"></i>';
			}
			$("#callHistoryBody").append(
				'<tr>' +
					'<th>' + result[i].callerName + '</th>' +
					'<th>' + result[i].callerNumber + '</th>' +
					'<th>' + result[i].direction + '</th>' +
					'<th>' + result[i].duration + '</th>' +
					'<th>' + endpointType + '</th>' + 
					'<th>' + result[i].callDate + '</th>' +
					'<th><button class=\"demo-btn\" onclick="outbound_call(\'' + result[i].callerNumber + '\')"><i class="fa fa-phone-square"></i></button></th>' +
				"</tr>"
			)
                        if (count_recs >= show_records)
                          break;
		}
	});
}

//Callback method
function outbound_call(number){
	$('#modalDialpad').modal('hide');
	showOutboundRinging();
	direction = 'outgoing';
	callerNumber = number;
	endpoint = 'provider';
	start_call(number);
	$('#duration').timer('reset');
	$('#user-status').text('In Call');
	changeStatusIcon(in_call_color, "in-call", in_call_blinking);
	changeStatusLight('IN_CALL');
	var vrs = $('#callerPhone').val();
	socket.emit('incall', {'vrs' : vrs});
	toggle_incall_buttons(true);
	$('#outboundCallAlert').show();
}

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
	socket.emit('save-grid-layout', {
		'gridLayout': serializedGridData
	});
}

function loadGridLayout(layout) {
	sessionStorage.layout = JSON.stringify(layout);
	loadingGridLayout = true;
	var grid = $('.grid-stack').data('gridstack');
	grid.batchUpdate();

	layout.forEach(function (el) {
		grid.update($('#' + el.id), el.x, el.y, el.width, el.height);
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

function resizeVideo() {
	var contentHeight = $("#gsvideobox").height() - 50;
	$('#VideoBox').css("height", contentHeight + "px");
	$('#remoteView').css("height", contentHeight - 125 + "px");
	$('#fullscreen-element').css("height", contentHeight+ "px");

	$('#persistView').css({"height": '100%', "width": '100%', 'object-fit':'cover'});

	$('#VideoBox').attr('style', "background-color:white;"); //doesn't open box if it's collapsed
}

function resizeChat() {
	var contentHeight = $("#gschatbox").height();

	var chatheaderHeight = $("#chat-header").outerHeight();
	var rtttypinHeight = $("#rtt-typing").outerHeight();
	var chatfooterheight = $("#chat-footer").outerHeight();
	var parts = chatheaderHeight + rtttypinHeight + chatfooterheight;

	var padding = 30;

	// userchat is overall chat box content, chatmessages is only the messages area
	$('#userchat').css("height", contentHeight - padding + "px");
	$('#chat-messages').css("height", contentHeight - parts - padding + "px");
	$('#userchat').attr('style', "background-color:white;"); //doesn't open box if it's collapsed
}

function resetLayout() {
	var defaultLayout = [{
		"id": "gsvideobox",
		"x": 0,
		"y": 0,
		"width": 8,
		"height": 16
	}, {
		"id": "gschatbox",
		"x": 8,
		"y": 0,
		"width": 4,
		"height": 10
	}];
	loadGridLayout(defaultLayout);
	resizeVideo();
	resizeChat();
}

//enables chat buttons on a webrtc call when it is accepted
function enable_chat_buttons() {
	$("#newchatmessage").removeAttr("disabled");
	$("#chat-send").removeAttr("disabled");
	$("#chat-emoji").removeAttr("disabled");
	$("#newchatmessage").attr("placeholder", "Type Message ...");
	$("#characters-left").show();

}

//disables chat buttons
function disable_chat_buttons() {
	$("#newchatmessage").attr("disabled", "disabled");
	$("#chat-send").attr("disabled", "disabled");
	$("#chat-emoji").attr("disabled", "disabled");
	$("#newchatmessage").attr("placeholder", "Chat disabled");
	$("#characters-left").hide();

}

function enable_initial_buttons() {}
$("#helpalert").hide();

/* use Enter or ESC keys in change shortcut modal */
$("#modalChangeShortcut").keyup(function(event) {
	if (event.keyCode === 13) {
		$("#update-shortcut-btn").click();
	} else if (event.keyCode == 27) {
		$('#close-shortcut-btn').click();
	}
});

/* click on a row in the shortcuts table to customize shortcut 
*	CANNOT CUSTOMIZE SIDEBAR TAB SHORTCUTS
*/
$('#shortcutsBody').on('click','tr',function() {
	//console.log("CLICK: " +($(this).index()));
	//$('shortcutsBody tbody').removeClass('table table-hover');
	var clickedValue = $(this).find("th").text();
	console.log("clicked value: " + clickedValue);

	var currentShortcut = $(this).find("td").text();
	console.log("current shortcut: " + currentShortcut);

	var clickedID = $("[name="+clickedValue+"]").attr("id");

	if (clickedID == "agents-tab" || clickedID == "videomail-tab" || clickedID == "shortcuts-tab") {

		//error modal
		console.log("cannot customize tab shortcuts")
		$('#shortcutsErrorModal').modal({
			backdrop: 'static',
			keyboard: true
		});

		$('#shortcutsErrorModalBody').html("Cannot customize sidebar tab shortcuts");

		//pressing Enter will close modal
		$("#shortcutsErrorModal").keyup(function(event) {
			if (event.keyCode === 13) {
				$("#shortcuts-error-btn").click();
			}
		});
	} else {

		$('#modalChangeShortcut').modal({
			backdrop: 'static',
			keyboard: true
		});
		//cursor is automatically in textbox
		$('#modalChangeShortcut').on('shown.bs.modal', function() {
			$('#new-shortcut').focus();
		});
	
		$('#current-action').html(clickedValue);
		$('#current-action').attr("value", clickedID);
		$('#new-shortcut').val(currentShortcut);
	}
});

/**
 * @param {string} task task id
 * @param {string} shortcut not case sensitive
 */
function setShortcut(task, shortcut) {
	//multiple tasks can have no shortcut
	if (shortcut == undefined || shortcut == "") {
		shortcut = "";
		$('#'+task).attr("accesskey", shortcut);
		updateShortcutTable();
	} else {
		//check if the shortcut is already being used
		var isShortcutUsed = checkShortcutUse(shortcut);

		if (isShortcutUsed) {
			//error modal
			$('#shortcutsErrorModal').modal({
				backdrop: 'static',
				keyboard: true
			});

			$('#shortcutsErrorModalBody').html("Shortcut in use");

			//pressing Enter will close modal
			$("#shortcutsErrorModal").keyup(function(event) {
				if (event.keyCode === 13) {
					$("#shortcuts-error-btn").click();
				}
			});
		} else {
			//good to go
			$('#'+task).attr("accesskey", shortcut);
			updateShortcutTable();
		}
	}
}
/**
 * 
 * @param {string} task task id
 */
function getShortcut(task) {
	return ($('#'+task).attr("accesskey"))
}

function updateShortcutTable() {
	console.log("UPDATE SHORTCUTS");
	clearShortcutsTable();
	
	//array of all elements with an accesskey
	var taskArray = $("[accesskey]").map(function(){
		return $(this).attr('id');
	}).get();

	 var tableLength = taskArray.length;

	 for (var i = 0; i < tableLength; i++) {

		 if (taskArray[i] != undefined) {

			var taskValue = $('#' + taskArray[i]).attr('name');

			$('#shortcutsBody').append(
					"<tr><th>" +taskValue+ "</th>" +
					"<td>" + getShortcut(taskArray[i]).toUpperCase() + "</td>"
			)				
			
			$('#shortcutsBody').append("<br>"); //spaces the elements out a little		
		 }
		// shortcutTableLength++;
	 }
	 $('#shortcutsTable').append($('#shortcutsBody'));
	 //console.log("STL:" + shortcutTableLength);
}

/**
 * Check if the shortcut is already in use.
 * 
 * Returns true if shortcut is in use, false if not 
 * @param {string} shortcut not case sensitive
 */
function checkShortcutUse(shortcut) {
	var isUsed = false;
	shortcut = shortcut.toUpperCase();

	var accesskeyArray = $("[accesskey]").map(function(){
		return $(this).attr('id');
	}).get();

	var arrayLength = accesskeyArray.length;
	for (var i = 0; i <= arrayLength; i++) {
		if (accesskeyArray[i] != undefined) {
			//console.log('shortcut: ' + shortcut+ ' vs: ' + (getShortcut(accesskeyArray[i])));
			if (getShortcut(accesskeyArray[i]).toUpperCase() == shortcut) {
				isUsed = true;
				console.log('shortcut in use');
				return isUsed;
			}
		}
	}

	return isUsed;
}

function clearShortcutsTable() {
	$('#shortcutsTable tbody').html("");
	//shortcutTableLength=0;
}

function clearShortcuts() {
	var taskArray = $("[accesskey]").map(function () {
		return $(this).attr('id');
	}).get();
	var arrayLength = taskArray.length;

	for (var i = 0; i <= arrayLength; i++) {
		if (taskArray[i] != undefined) {
			if (taskArray[i] == 'agents-tab' || taskArray[i] == "videomail-tab" || taskArray[i] == "shortcuts-tab") {
				//do nothing
			} else {
				setShortcut(taskArray[i], "");
			}
		}
	}
}

function collapseVideoBox() {
    console.log('collapse video box');
    $('#VideoBox').attr('style', "background-color:white;"); //removes the background when collapsing the box
}

function collapseChatBox() {
    console.log('collapse chat box');
    $('#userchat').attr('style', "background-color:white;"); //removes the background when collapsing the box
}

/**
 * Note from Jackie: Customizing keyboard shortcuts using the keyboard isn't working yet.
 * 
 * I added two transparent buttons (commented out in agent_home.ejs)-- one to go up the table and one to go down.
 * Ideally hitting the enter key should act the same as clicking on a row.
 * 
 * I set the accesskeys as = and - to go up and down the table respectively.
 * hitting enter clicks the buttons again instead of clicking on the selected row
 * 
 * There is probably a much better way to do this
 * 
*/

 

// function goDownTable() {
// 	/* hitting enter allows the user to change the shortcut */
	

// 	//TODO: only work if shortcuts tab is active
// 	//$('#shortcutsBody tr').index() = $(this).index()+1;
// 	console.log('test 3');
// 	var previousRow = currentShortcutRow-1;

// 	if (currentShortcutRow == 0) {
// 		console.log('test 4');
// 		console.log('index: ' + $('#shortcutsBody tr:eq('+currentShortcutRow+')').addClass('table table-active').focus());
// 		currentShortcutRow++;
// 	} else if (currentShortcutRow == shortcutTableLength) {
// 		console.log('test 5');
// 		// end of the table
// 		console.log('bottom');
// 		currentShortcutRow = shortcutTableLength;
// 	} else{
// 		console.log('test 6');
// 		console.log('index: ' + $('#shortcutsBody tr:eq('+previousRow+')').removeClass('table table-active').focus());
// 		console.log('index: ' + $('#shortcutsBody tr:eq('+currentShortcutRow+')').addClass('table table-active').focus());
// 		currentShortcutRow++;
// 	}
// 	console.log("previous row: " +previousRow);
// 	console.log("current row: " +currentShortcutRow);
// 	console.log("total length: " +shortcutTableLength);


// 	$('#shortcut-down-btn').on('keyup', function(event) {
// 		console.log('currentShortcutRow: '+currentShortcutRow);
// 		console.log("test 1");
// 		if (event.keyCode === 13 || event.which === 13) {
// 			event.preventDefault();
// 			console.log("ENTER");
// 			$('#shortcutsBody tr').removeClass('table table-hover');

// 			console.log('test 2');
// 			console.log('CURRENT ROW: ' +currentShortcutRow);
			
// 			//pull up the modal to change the shortcut
// 			$('#shortcutsBody tr').removeClass('table table-hover')

// 			var clickedValue = $('#shortcutsBody tr:eq('+currentShortcutRow+')').find("th").text();
// 			console.log('CURRENT ROW: ' +currentShortcutRow);
// 			console.log("clicked value: " + clickedValue);
		
// 			var currentShortcut = $(this).find("td").text();
// 			console.log("current shortcut: " + currentShortcut);
		
// 			var clickedID = $("[name="+clickedValue+"]").attr("id");
		
// 			$('#modalChangeShortcut').modal({
// 				backdrop: 'static',
// 				keyboard: true
// 			});
// 			//cursor is automatically in textbox
// 			$('#modalChangeShortcut').on('shown.bs.modal', function() {
// 				$('#new-shortcut').focus();
// 			});
		
// 			$('#current-action').html(clickedValue);
// 			$('#current-action').attr("value", clickedID);
// 			$('#new-shortcut').val(currentShortcut);


// 			//restart table at top
// 			//currentShortcutRow = 0;
			
// 		}
// 	});
// 	return "down";

// }

// function goUpTable() {
// 	/* hitting enter allows the user to change the shortcut */
// 	$('#shortcut-down-btn').on('keyup', function(event) {
// 		if (event.keyCode === 13 || event.which === 13) {
// 			//pull up the modal to change the shortcut
// 			$('#shortcutsBody tr').removeClass('table table-hover')
			


			
// 			//restart table at top
// 			//currentShortcutRow = 0;
// 		}
// 	});
// 	//TODO: only work if shortcuts tab is active

// 	console.log(currentShortcutRow);
// 	var previousRow = currentShortcutRow+1;
// 	if (currentShortcutRow == shortcutTableLength) {
// 		console.log('bottom');
// 		console.log('index: ' + $('#shortcutsBody tr:eq('+previousRow+')').removeClass('table table-hover'));
// 		console.log('index: ' + $('#shortcutsBody tr:eq('+currentShortcutRow+')').addClass('table table-hover'));
// 		currentShortcutRow--;
// 	} else if (currentShortcutRow == 0) {
// 		//top of the table
// 		console.log('top');
// 		console.log('index: ' + $('#shortcutsBody tr:eq('+currentShortcutRow+')').addClass('table table-hover'));

// 		console.log('index: ' + $('#shortcutsBody tr:eq('+previousRow+')').removeClass('table table-hover'));
// 		console.log('index: ' + $('#shortcutsBody tr:eq('+currentShortcutRow+')').addClass('table table-hover'));
// 		currentShortcutRow = 0;
// 	} else {
// 		console.log('index: ' + $('#shortcutsBody tr:eq('+previousRow+')').removeClass('table table-hover'));
// 		console.log('index: ' + $('#shortcutsBody tr:eq('+currentShortcutRow+')').addClass('table table-hover'));
// 		currentShortcutRow--;
// 	}
// 	console.log("previous row: " +previousRow);
// 	console.log("current row: " +currentShortcutRow);
// 	console.log("total length: " + shortcutTableLength);
// 	return "up";
// }
