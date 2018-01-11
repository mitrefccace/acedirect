var socket;
var asterisk_sip_uri;
var exten;
var abandoned_caller;
var videomailflag = false;
var switchQueueFlag = false;
var afterHoursFlag = false;
var skinny = false;

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
					// $('#callbutton').prop("disabled", false);
					if (data.zendesk_ticket) {
						$('#firstName').val(data.first_name);
						$('#lastName').val(data.last_name);
						$('#callerPhone').val(data.vrs);
						$('#callerEmail').val(data.email);
						$('#ticketNumber').text(data.zendesk_ticket);
						// $('#callbutton').prop("disabled", false);
					} else {
						$("#ZenDeskOutageModal").modal('show');
						$('#userformbtn').prop("disabled", false);
					}
				}).on('extension-created', function(data){
					console.log("got extension-created");
					var extension = data.extension; //returned extension to use for WebRTC
					exten = data.extension;
					$('#display_name').val(data.extension);
          if (data.ws_port !== "")
            $('#ws_servers').attr("name", "wss://" + data.asterisk_public_hostname + ":" + data.ws_port + "/ws");
          else
            $('#ws_servers').attr("name", "wss://" + data.asterisk_public_hostname + "/ws");

					$('#my_sip_uri').attr("name","sip:"+data.extension+"@"+data.asterisk_public_hostname);

          //is this a videomail call or complaint call?
          if (videomailflag)
            asterisk_sip_uri = "sip:" + data.queues_videomail_number + "@"+data.asterisk_public_hostname;
          else
            asterisk_sip_uri = "sip:" + data.queues_complaint_number + "@"+data.asterisk_public_hostname;

          //get the max videomail recording seconds
          maxRecordingSeconds = data.queues_videomail_maxrecordsecs;

          //get complaint redirect options
          complaintRedirectActive = data.complaint_redirect_active;
          complaintRedirectDesc = data.complaint_redirect_desc;
          complaintRedirectUrl = data.complaint_redirect_url;
          $("#redirecttag").attr("href", complaintRedirectUrl);
          $("#redirectdesc").text("Redirecting to " + complaintRedirectDesc + " ...");

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
				}).on("skinny-config", function(data){
					if(data == "true")
					{
						$("#ticket-section").attr("hidden",true);
						$("#vrs-info-box").attr("hidden",true);
						$("#video-section").removeClass(function (index, className) {
							return (className.match(/\bcol-\S+/g) || []).join(' ');
						});
						$("#video-section").addClass("col-lg-7");
						$("#chat-section").removeClass(function (index, className) {
							return (className.match(/\bcol-\S+/g) || []).join(' ');
						});
						$("#chat-section").addClass("col-lg-5");
						skinny = true;
					}
					else
					{
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
						$("#newchatmessage").attr("disabled","disabled");
						$("#chat-send").attr("disabled","disabled");
						skinny = false;
					}
				}).on('queue-caller-join',function(data){
					if(data.extension == exten) {
						set_queue_text(--data.position); //subtract because asterisk wording is off by one
					}
					console.log("queue caller join");
				}).on('queue-caller-leave',function(data){
					var current_position = $("#pos-in-queue").text();
					if(!abandoned_caller){ //abandoned caller triggers both leave and abandon event. this prevents duplicate removes.
						set_queue_text(--current_position);
					}
					console.log("queue caller leave");
					abandoned_caller = false;
				 }).on('queue-caller-abandon',function(data){
					var current_position = $("#pos-in-queue").text();
					current_position++;
				 	if(current_position > data.position){ //checks if the abandoned caller was ahead of you
				 		var current_position = $("#pos-in-queue").text();
				 		set_queue_text(--current_position);
					 }
					 console.log("queue caller abandon");
					 abandoned_caller = true;
				}).on("agent-name", function(data) {
					if(data.agent_name != null || data.agent_name != "" || data.agent_name != undefined)
					{
						var firstname = data.agent_name.split(" ");
						$("#agent-name").text(firstname[0]);
						$("#agent-name-box").show();
					}
				}).on("chat-leave", function (error) {
          //clear chat
          $('#chatcounter').text('500');
          $('#chat-messages').html('');
          $('#rtt-typing').html('');
          $('#newchatmessage').val('');

          //reset buttons and ticket form
          $('#ticketNumber').text('');
          $('#complaintcounter').text('2,000');
          // $("#callbutton").prop("disabled",true);
          // $('#videomailbutton').prop("disabled", false);
          // $('#userformbtn').prop("disabled", false);
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
  videomailflag = false;
  $('#record-progress-bar').hide();
  $('#vmsent').hide();
	$("#callbutton").prop("disabled",true);
  $('#videomailbutton').prop("disabled", true);
  $("#queueModal").modal({backdrop: "static"});
  $("#queueModal").modal("show");
	$("#dialboxcallbtn").click(); //may or may not be dead code
	var vrs = $('#callerPhone').val().replace(/^1|[^\d]/g, '');
	socket.emit('call-initiated', {"vrs": vrs}); //sends vrs number to adserver
	console.log('call-initiated event for complaint');
	enable_chat_buttons();
});

$("#videomailbutton").click(function(){
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
  	$("#videomailbutton").prop("disabled",true);
  	var vrs = $('#callerPhone').val().replace(/^1|[^\d]/g, '');
    socket.emit('call-initiated', {"vrs": vrs}); //sends vrs number to adserver
  	console.log('call-initiated event for videomail');
  }
  switchQueueFlag = false;
}

$('#userform').submit(function (evt) {
	evt.preventDefault();
	var subject = $('#subject').val();
	var complaint = $('#complaint').val();
	var vrs = $('#callerPhone').val().replace(/^1|[^\d]/g, '');

	socket.emit('ad-ticket', { "vrs": vrs, "subject": subject, "description": complaint });
	$('#userformoverlay').addClass("overlay").show();
	$('#userformbtn').prop("disabled", true);
	$("#callbutton").removeAttr("disabled");

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

//after hours processing; if after hours, then show this modal
if (afterHoursFlag) {
  $("#afterHoursModal").modal({backdrop: "static"});
  $("#afterHoursModal").modal("show");
}

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


function exit_queue()
{
	$('#queueModal').modal('hide');
	terminate_call();
}

function set_queue_text(position)
{
	if(position == 0) $("#queue-msg").text("There are 0 callers ahead of you.");
	else if(position == 1) $("#queue-msg").html('There is <span id="pos-in-queue"> 1 </span> caller ahead of you.');
	else if(position > 1) $("#pos-in-queue").text(position);
	else $("#queue-msg").text("One of our agents will be with you shortly."); //default msg

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

//restores default buttons after a call is completed
function enable_initial_buttons() {
	if(skinny){
		$("#callbutton").removeAttr("disabled");
		$("#videomailbutton").removeAttr("disabled");
	}
	else{
		$("#userformbtn").removeAttr("disabled");
		$("#callbutton").attr("disabled", "disabled");
		$("#videomailbutton").removeAttr("disabled");
	}
	
}
