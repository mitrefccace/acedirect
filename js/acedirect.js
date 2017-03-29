var socket;
var extensionMe;
var queueNameMe;
var channelMe;
var ticketTabFade;

$(document).ready(function () {
	connect_socket();
	$("#debugtab").hide();
	$('#scriptstab').hide();
	$("#geninfotab").hide();
	$("#complaintstab").hide();
	$("[data-mask]").inputmask();

	clearScreen();

	$.getJSON("./resources/licenses.json", function (data) {
		$.each(data.license, function (i) {
			$("#licModalBody").append("<h3>" + data.license[i].name + "<h3><pre>" + data.license[i].pre + "</pre>");
		});
	});

	if (window.addEventListener) {
		var state = 0, theCode = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
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
	if (sessionStorage.getItem('accesstoken') === null)
		logout();
	console.log('connect_socket');
	socket = io.connect('https://' + window.location.host+'/agent', {
		query: 'token=' + sessionStorage.accesstoken,
		forceNew: true
	});

	socket.on('connect', function () {
		debugtxt('connect', { "no": "data" });
		console.log('authenticated');

		//get the payload form the token
		var payload = jwt_decode(sessionStorage.accesstoken);
		$('#loginModal').modal('hide');
		$('#statusmsg').text(""); //clear status text

		//populate call agent information
		$('#txtAgentDisplayName').val(payload.username);
		$('#txtAgentFirstname').val(payload.first_name);
		$('#txtAgentLastname').val(payload.last_name);
		$('#txtAgentRole').val(payload.role);
		$('#txtAgentEmail').val(payload.email);
		$('#txtAgentPhone').val(payload.phone);
		$('#displayname').val(payload.first_name + ' ' + payload.role);
		$('#agentname-sidebar').html(payload.first_name + " " + payload.last_name);
		$('#agentname-header').html(payload.first_name + " " + payload.last_name);
		$('#agentname-headerdropdown').html(payload.first_name + " " + payload.last_name);
		$('#agentrole-headerdropdown').html("<small>" + payload.role + "</small>");

		if (payload.queue_name === "ComplaintsQueue" || payload.queue2_name === "ComplaintsQueue") {
			$('#sidebar-complaints').show();
		}
		if (payload.queue_name === "GeneralQuestionsQueue" || payload.queue2_name === "GeneralQuestionsQueue") {
			$('#sidebar-geninfo').show();
		}



		socket.emit('register-client', { "hello": "hello" });
		socket.emit('register-agent', { "hello": "hello" });

		extensionMe = payload.extension; //e.g. 6001
		queueNameMe = payload.queue_name; //e.g. InboundQueue
		channelMe = payload.channel; //e.g. SIP/7001

		pauseQueues();
	}).on('disconnect', function () {
		debugtxt('disconnect');
		console.log('disconnected');
		logout("disconnected");
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
	}).on('new-caller', function (data) { // a new caller has connected
		debugtxt('new-caller', data);

		//filter out messages not destined for me
		if (data.id != extensionMe) {
			return;
		}

		clearScreen();

		$('#callerFirstName').val(data.data[0].first_name);
		$('#callerLastName').val(data.data[0].last_name);
		$('#callerAddress1').val(data.data[0].address);
		$('#callerCity').val(data.data[0].city);
		$('#callerState').val(data.data[0].state);
		$('#callerZipcode').val(data.data[0].zip_code);
		$('#callerPhone').val(data.data[0].vrs);
		$('#callerEmail').val(data.data[0].email);

		$('#inboundnumber').text(data.srcPhoneNum);
		$('#outboundnumber').text($('#destexten').val());

		if (data.vrscaller) {
			$('#inbounddhohlabel').show();
		} else {
			$('#outbounddhohlabel').show();
		}

		$('#duration').timer('reset');
		inCall();
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
		ticketTabFade = setInterval(function () {
			$('#ticketTab').fadeTo("slow", 0.1).fadeTo("slow", 1.0);
		}, 1000);
	}).on('chat-leave', function (data) {
		debugtxt('chat-leave', data);
		$('#duration').timer('pause');
		$('#user-status').text('Wrap Up');
		$('#status-icon').removeClass("text-green");
		$('#status-icon').removeClass("text-yellow");
		$('#status-icon').addClass("text-red");
		$('#complaintsInCall').hide();
		$('#geninfoInCall').hide();
		socket.emit('wrapup', null);
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
		socket.emit('register-vrs', { "vrs": data.data[0].vrs });
	}).on('missing-vrs', function (data) {
		debugtxt('missing-vrs', data);
		//show modal to get VRS from user
		$(".modal-backdrop").remove();
		if (data.message) {
			$('#ivrsmessage').text(data.message);
			$('#ivrsmessage').show();
		}
		$('#myVrsModal').modal({ show: true, backdrop: 'static', keyboard: false });
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
			tabledata = { data: [] };
			for (var i = 0; i < data.agents.length; i++) {
				var name, status, extension, queues = "";
				name = data.agents[i].name;
				status = data.agents[i].status;
				if (status === "READY") {
					status = "<div style='display:inline-block'><i class='fa fa-circle text-green'></i>&nbsp;&nbsp;Ready</div>";
				} else if (status === "AWAY") {
					status = "<div style='display:inline-block'><i class='fa fa-circle text-yellow'></i>&nbsp;&nbsp;Away</div>";
				} else if (status === "INCALL") {
					status = "<div style='display:inline-block'><i class='fa fa-circle text-red'></i>&nbsp;&nbsp;In Call</div>";
				} else if (status === "WRAPUP") {
					status = "<div style='display:inline-block'><i class='fa fa-circle text-red'></i>&nbsp;&nbsp;Wrap Up</div>";
				} else {
					status = "<div style='display:inline-block'><i class='fa fa-circle text-white'></i>&nbsp;&nbsp;Unknown</div>";
				}

				extension = data.agents[i].extension;
				for (var j = 0; j < data.agents[i].queues.length; j++) {
					queues += data.agents[i].queues[j].queuename + "<br>";
				}
				queues = queues.replace(/<br>\s*$/, "");
				tabledata['data'].push({ "status": status, "name": name, "extension": extension, "queues": queues });
			}

			$('#agenttable').dataTable().fnClearTable();
			$('#agenttable').dataTable().fnAddData(tabledata.data);
		}
	}).on('new-caller-ringing', function (data) {
		debugtxt('new-caller-ringing', data);
		$('#myRingingModalPhoneNumber').html(data.phoneNumber)
		$('#myRingingModal').modal({ show: true, backdrop: 'static', keyboard: false });
	}).on('request-assistance-response', function (data) {
		debugtxt('request-assistance-response', data);
		//alert(data.message);
	});


}

$('#agenttable').DataTable({
	aaData: null,
	aoColumns: [
		{ "mDataProp": "status" },
		{ "mDataProp": "name" },
		{ "mDataProp": "extension" },
		{ "mDataProp": "queues" }
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
		socket.emit('input-vrs', { "vrs": ivrsnum, "extension": extensionMe });
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
		socket.emit('chat-typing', { "displayname": displayname, "vrs": vrs, rttmsg: value });
	} else {
		socket.emit('chat-typing-clear', { "displayname": displayname, "vrs": vrs });
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
	socket.emit('chat-message', { "message": msg, "timestamp": timestamp, "displayname": displayname, "vrs": vrs });
});

$('#ticketTabTitle').click(function () {
	$('#ticketTab').removeClass("bg-pink");
	clearInterval(ticketTabFade);
});

function requestAssistance() {
	socket.emit('request-assistance', null);
}

function logout(msg) {
	//clear the token from session storage
	sessionStorage.clear();
	//disconnect socket.io connection
	if (socket)
		socket.disconnect();
	//display the login screen to the user.
	if (msg) {
		window.location.replace("/login.html?message=" + msg);
	} else {
		window.location.replace("/login.html");
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
		var ticket = { "destexten": extensionMe, "vrs": phone, "status": "new", "ticketId": id, "subject": subject, "description": description, "name": fname, "email": email, "phone": phone, "last_name": lname, "resolution": resolution, "comment": { "public": true, "body": description } };
		socket.emit('ad-ticket', ticket);
	} else {
		socket.emit('modify-ticket', { "destexten": extensionMe, "vrs": phone, "status": "new", "ticketId": id, "subject": subject, "description": description, "name": fname, "email": email, "phone": phone, "last_name": lname, "resolution": resolution, "comment": { "public": true, "body": description } });
	}

}

function inCall() {
	$('#user-status').text('In Call');
	$('#status-icon').removeClass("text-green");
	$('#status-icon').addClass("text-red");
	var param1 = [{ "Interface": "SIP/" + extensionMe, "Queue": "" }, { "Interface": "", "Queue": "" }];
	socket.emit('pause-queues', param1);
}

function inCallADComplaints() {
	pauseQueues();
	$('#myRingingModalPhoneNumber').html('');
	$('#myRingingModal').modal('hide');
	$('#user-status').text('In Call');
	$('#status-icon').removeClass("text-green");
	$('#status-icon').removeClass("text-yellow");
	$('#status-icon').addClass("text-red");
	$('#complaintsInCall').show();
	socket.emit('incall', null);
}

function inCallADGeneral() {
	pauseQueues();
	$('#myRingingModalPhoneNumber').html('');
	$('#myRingingModal').modal('hide');
	$('#user-status').text('In Call');
	$('#status-icon').removeClass("text-green");
	$('#status-icon').removeClass("text-yellow");
	$('#status-icon').addClass("text-red");
	$('#geninfoInCall').show();
	socket.emit('incall', null);
}

function pauseQueues() {
	$('#user-status').text('Away');
	$('#status-icon').removeClass("text-green");
	$('#status-icon').addClass("text-yellow");

	socket.emit('pause-queues', null);
	socket.emit('away', null);
}

function unpauseQueues() {
	$('#user-status').text('Ready');
	$('#status-icon').removeClass("text-yellow");
	$('#status-icon').addClass("text-green");

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

// Debug Functions for sidebar.
function cleardbgtxt() {
	$('#dbgtxt').html('');
}

function debugtxt(title, data) {
	var dt = new Date();
	var time = dt.getHours() + ":" + dt.getMinutes() + ":" + dt.getSeconds();
	$('#dbgtxt').html('<span style="color:green">' + time + ": " + title + '</span><br>' + JSON.stringify(data) + '<br>----------------<br>' + $('#dbgtxt').html());
}