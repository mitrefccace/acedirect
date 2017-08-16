var socket;
var asterisk_sip_uri;

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
					console.log("got connect");
					console.log('authenticated');

					var payload = jwt_decode(data.token);
					//alert(JSON.stringify(payload));
					$('#firstName').val(payload.first_name);
					$('#lastName').val(payload.last_name);
					$('#callerPhone').val(payload.vrs);
					$('#callerEmail').val(payload.email);
					$('#displayname').val(payload.first_name + ' ' + payload.last_name);


					socket.emit('register-client', { "hello": "hello" });
					//console.log("register-client");
					socket.emit('register-vrs', { "hello": "hello" });
					//onsole.log("register-vrs");
				}).on('ad-ticket-created', function (data) {
					console.log("got ad-ticket-created");
					$('#userformoverlay').removeClass("overlay").hide();
					$('#callbutton').prop("disabled", false);								   
					if (data.zendesk_ticket) {
						$('#firstName').val(data.first_name);
						$('#lastName').val(data.last_name);
						$('#callerPhone').val(data.vrs);
						$('#callerEmail').val(data.email);
						$('#ticketNumber').text(data.zendesk_ticket);
						$('#callbutton').prop("disabled", false);
					} else {
						$("#ZenDeskOutageModal").modal('show');
						$('#userformbtn').prop("disabled", false);
					}
				}).on('extension-created', function(data){
					console.log("got extension-created");
					var extension = data.extension; //returned extension to use for WebRTC
					$('#display_name').val(data.extension);
					$('#ws_servers').attr("name", "wss://" + data.asterisk_public_hostname + "/ws");									 
					$('#my_sip_uri').attr("name","sip:"+data.extension+"@"+data.asterisk_public_hostname);
					asterisk_sip_uri = "sip:575791@"+data.asterisk_public_hostname;
					$('#sip_password').attr("name",data.password);
 					$("#pc_config").attr("name","stun:" + data.stun_server );
					register_jssip(); //register with the given extension
					start_call(asterisk_sip_uri); //calling asterisk to get into the queue
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
			else {
				//TODO: handle bad connections
			}
		},
		error: function (xhr, status, error) {
			console.log('Error');
			$('#message').text('An Error Occured.');
		}
	});
	
}

$("#callbutton").click(function(){
	$("#callbutton").prop("disabled",true);
	$("#dialboxcallbtn").click(); //may or may not be dead code
	var vrs = $('#callerPhone').val().replace(/^1|[^\d]/g, '');
	socket.emit('call-initiated', {"vrs": vrs}); //sends vrs number to adserver
	console.log('call-initiated event');
});
																				  

$('#userform').submit(function (evt) {
	evt.preventDefault();
	var subject = $('#subject').val();
	var complaint = $('#complaint').val();
	var vrs = $('#callerPhone').val().replace(/^1|[^\d]/g, '');

	socket.emit('ad-ticket', { "vrs": vrs, "subject": subject, "description": complaint });
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
	window.location.href='./logout'                            
}

$("#newchatmessage").on('change keydown paste input', function () {
	var value = $("#newchatmessage").val();
	var displayname = $('#displayname').val();
	if (value.length > 0) {
		socket.emit('chat-typing', { "displayname": displayname, rttmsg: value });
	} else {
		socket.emit('chat-typing-clear', { "displayname": displayname });
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
	socket.emit('chat-message', { "message": msg, "timestamp": timestamp, "displayname": displayname });
});
