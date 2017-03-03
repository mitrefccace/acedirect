var socket;


$(document).ready(function () {
	//formats the phone number.
	$("[data-mask]").inputmask();

	//JSSIP components
	$('#login-full-background').hide();
	$('#login-box').hide();
	$('#webcam').show();

	$('#complaint').simplyCountable({
		counter: '#complaintcounter',
		maxCount: 2000,
		strictMax: true
	});
	$('#newchatmessage').simplyCountable({
		counter: '#chatcounter',
		maxCount: 500,
		strictMax: true
	});
	connect_socket();
});


function connect_socket() {
	if (sessionStorage.getItem('accesstoken') === null)
		logout();
	console.log('connect_socket to ');
	console.log(window.location.host);
	socket = io.connect('https://' + window.location.host, {
		query: 'token=' + sessionStorage.accesstoken,
		forceNew: true
	});

	socket.on('connect', function () {
		console.log("got connect");
		console.log('authenticated');

		var payload = jwt_decode(sessionStorage.accesstoken);
		//alert(JSON.stringify(payload));
		$('#firstName').val(payload.first_name);
		$('#lastName').val(payload.last_name);
		$('#callerPhone').val(payload.vrs);
		$('#callerEmail').val(payload.email);
		$('#displayname').val(payload.first_name + ' ' + payload.last_name);


		socket.emit('register-client', {"hello": "hello"});
		//console.log("register-client");
		socket.emit('register-vrs', {"hello": "hello"});
		//onsole.log("register-vrs");



	}).on('ad-ticket-created', function (data) {
		console.log("got ad-ticket-created");
		$('#userformoverlay').removeClass("overlay").hide();
		if (data.zendesk_ticket) {
			console.log(data.extension);
			//alert(JSON.stringify(data));
			$('#firstName').val(data.first_name);
			$('#lastName').val(data.last_name);
			$('#callerPhone').val(data.vrs);
			$('#callerEmail').val(data.email);
			$('#ticketNumber').text(data.zendesk_ticket);
			var extension = data.extension; //returned extension to use for WebRTC
			$('#extension').val(extension);

			$('#authorization_user').val(data.extension);
			$('#login_display_name').val(data.extension);
			$('#display_name').val(data.extension);
			$('#sip_uri').val("sip:" + data.extension + "@" + data.asterisk_public_hostname);

			$('#sip_password').val(data.password);
			$('#ws_servers').val("wss://" + data.asterisk_public_hostname + "/ws");
			$('#peerconnection_config').val('{ "iceServers": [ {"urls": ["stun:' + data.stun_server + '"]} ], "gatheringTimeout": 9000 }');
			$('#dialboxnumber').val(data.queues_complaint_number);

			$('#login-form').submit();

			$('#callbutton').prop("disabled", false);
		} else {
			$("#ZenDeskOutageModal").modal('show');
			$('#userformbtn').prop("disabled", false);
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
		logout("disconnected");
	}).on("unauthorized", function (error) {
		if (error.data.type === "UnauthorizedError" || error.data.code === "invalid_token") {
			logout("Session has expired");
		}
	}).on("chat-leave", function (error) {
		$("#callEndedModal").modal('show');
		setTimeout(function () {
			window.location = "http://www.fcc.gov";
		}, 5000);
	}).on('error', function (reason) {
		if (reason.code === "invalid_token") {
			logout("Session has expired");
		} else {
			logout("An Error Occurred: " + JSON.stringify(reason));
		}
	});



}


$("#callbutton").click(function () {
	$('#callbutton').prop("disabled", true);
	$('#dialboxcallbtn').click();
});

$('#userform').submit(function (evt) {
	evt.preventDefault();
	var subject = $('#subject').val();
	var complaint = $('#complaint').val();
	var vrs = $('#callerPhone').val().replace(/^1|[^\d]/g, '');

	socket.emit('ad-ticket', {"vrs": vrs, "subject": subject, "description": complaint});
	$('#userformoverlay').addClass("overlay").show();
	$('#userformbtn').prop("disabled", true);
});

function logout(msg) {
	//clear the token from session storage
	sessionStorage.clear();
	//disconnect socket.io connection
	if (socket)
		socket.disconnect();
	//display the login screen to the user.                             
}

$("#newchatmessage").on('change keydown paste input', function () {
	var value = $("#newchatmessage").val();
	var displayname = $('#displayname').val();
	if (value.length > 0) {
		socket.emit('chat-typing', {"displayname": displayname, rttmsg: value});
	} else {
		socket.emit('chat-typing-clear', {"displayname": displayname});
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
	socket.emit('chat-message', {"message": msg, "timestamp": timestamp, "displayname": displayname});
});
