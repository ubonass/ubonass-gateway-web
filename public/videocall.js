var server = "wss://" + window.location.hostname + ":8989";

VideoCall.init({debug: ["error", "warn", "log"]});

var logger = new Logger({debug: ["error", "warn", "log"]});

var userName;
var videocall;

var doSimulcast = (getQueryStringValue("simulcast") === "yes" || getQueryStringValue("simulcast") === "true");
var doSimulcast2 = (getQueryStringValue("simulcast2") === "yes" || getQueryStringValue("simulcast2") === "true");
var simulcastStarted = false;

function randomString(len) {
    var charSet = '123456789';
    var randomString = '';
    for (var i = 0; i < len; i++) {
        var randomPoz = Math.floor(Math.random() * charSet.length);
        randomString += charSet.substring(randomPoz, randomPoz + 1);
    }
    return randomString;
}

// Helper method to prepare a UI selection of the available devices
function initDevices(devices) {
    devices.forEach(function (device) {
        var label = device.label;
        if (label === null || label === undefined || label === "")
            label = device.deviceId;
        var option = $('<option value="' + device.deviceId + '">' + label + '</option>');
        if (device.kind === 'audioinput') {
            $('#audio-device').append(option);
        } else if (device.kind === 'videoinput') {
            $('#video-device').append(option);
        }
    });

    //var audio = $('#audio-device').val();
    //var video = $('#video-device').val();

    //$('#audio-device').val(audio);
    //$('#video-device').val(video);
}


/**
 * VideoCall插件回调
 * @param username
 * 注册成功,返回注册的名字
 */
function onRegistered(username) {
    videocall.listUser();
    $('#call').removeAttr('disabled').html('Call')
        .removeClass("btn-danger").addClass("btn-success")
        .unbind('click').click(doCall);
}

/**
 * 正在呼叫中
 */
function onCalling() {
    logger.log("Waiting for the peer to answer...");
    // TODO Any ringtone?
    bootbox.alert("Waiting for the peer to answer...");
}

/**
 * 收到来电通知
 * @param peerName:对方名称
 */
function onIncomingCall(peerName) {

}

/**
 * 对方已接收
 */
function onCallAccepted(peerName) {

}

/**
 * 收到挂断电话
 */
function onCallHangup() {

}

/**
 * 建立通话成功
 */
function onCallConnected() {

}

/**
 *
 * @param videocodec
 * @param substream
 * @param temporal
 */
function onCallSimulcast(videocodec, substream, temporal) {

}

/**
 *
 * @param stream
 */
function onLocalStream(stream) {

    $('#video-calling').removeClass('show').hide();
    $('#video-talking').removeClass('hide').show();
    WebRtcPeer.attachMediaStream($('#local-video').get(0), stream);
}

/**
 *
 * @param stream
 */
function onRemoteStream(stream) {
    WebRtcPeer.attachMediaStream($('#peer-video').get(0), stream);
}

/**
 *
 * @param label
 */
function onDataOpen(label) {

}

/**
 *
 * @param data
 * @param label
 */
function onData(data, label) {

}

/**
 *
 */
function onCleanup() {

}

/**
 * 当session销毁的时候回调
 */
function onDestroyed() {
    window.location.reload();
}

function onAttachSuccess() {
    videocall.register(userName);
}

function onAttachError(error) {

}


$(document).ready(function () {

    // Make sure the browser supports WebRTC
    if (!WebRtcPeer.isWebrtcSupported()) {
        //bootbox.alert("No WebRTC support... ");
        return;
    }
    $('#call').attr('disabled', true).unbind('click');
    $("#userName").text("userName: " + randomString(8));

    userName = randomString(8);

    WebRtcPeer.listDevices(initDevices);

    var options = {
        //transmit: "p2p",
        server: server,
        onAttachSuccess: () => onAttachSuccess(),
        onAttachError: (error) => onAttachError(error),
        onRegistered: (userName) => onRegistered(userName),
        onCalling: () => onCalling(),
        onIncomingCall: (peerName) => onIncomingCall(peerName),
        onCallAccepted: (peerName) => onCallAccepted(peerName),
        onCallHangup: () => onCallHangup(),
        onCallConnected: () => onCallConnected(),
        onCallSimulcast: (videocodec, substream, temporal) =>
            onCallSimulcast(videocodec, substream, temporal),
        onLocalStream: (stream) => onLocalStream(stream),
        onRemoteStream: (stream) => onRemoteStream(stream),
        onDataOpen: (label) => onDataOpen(label),
        onData: (data, label) => onData(data),
        onCleanup: () => onCleanup(),
        onDestroyed: () => onDestroyed()
    };

    var cloudOptions = {
        server: server,
        success: function () {
            videocall = new VideoCall(remoteCloud,options);
        },
        error: function (errror) {
            //callbacks.error(errror);
        },
        destroyed: function () {
            //window.location.reload();
            onDestroyed();
        }
    };

    remoteCloud = new RemoteCloud(cloudOptions);

});

function doCall() {
    // Call someone
    $('#peerName').attr('disabled', true);
    $('#call').attr('disabled', true).unbind('click');
    var peerName = $('#peerName').val();
    if (peerName === "") {
        bootbox.alert("Insert a username to call (e.g., pluto)");
        $('#peerName').removeAttr('disabled');
        $('#call').removeAttr('disabled').click(doCall);
        return;
    }

    if (/[^a-zA-Z0-9]/.test(peerName)) {
        bootbox.alert('Input is not alphanumeric');
        $('#peerName').removeAttr('disabled').val("");
        $('#call').removeAttr('disabled').click(doCall);
        return;
    }

    videocall.startCall({data: true}, doSimulcast,
        peerName, function (error) {
            if (error) {
                bootbox.alert("WebRTC error... " + error);
            }
        });
}

function checkEnter(field, event) {
    /*var theCode = event.keyCode ? event.keyCode : event.which ? event.which : event.charCode;
    if(theCode == 13) {
        if(field.id == 'username')
            registerUsername();
        else if(field.id == 'peer')
            doCall();
        else if(field.id == 'datasend')
            sendData();
        return false;
    } else {
        return true;
    }*/
}

// Helper to parse query string
function getQueryStringValue(name) {
    name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
    var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
        results = regex.exec(location.search);
    return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
}
