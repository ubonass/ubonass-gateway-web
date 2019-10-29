var initOptions = {debug: ["error", "warn", "log", "debug"]};

VideoRoom.init(initOptions);

var logger = new Logger(initOptions);


var server = "wss://ubonass.com:8989";

var videoroom;
var userName;
var roomName;
var remotefeeds = [];
var max_remotefeeds = 7;
var bitrateTimer = [];

/**
 * 房间有人发布了视频
 * @param options
 */
function onParticipantPublished(options) {
    /**
     * 开始订阅远程视频
     */
    logger.log(JSON.stringify(options));
    if (options === undefined || options === null)
        return;
    if (options.id === undefined || options.id === null)
        return;

    options.roomname = roomName;
    options.audio = true;
    options.video = true;
    options.data = false;
    /**
     * 记录要显示的UI索引
     */
    for (var i = 1; i < max_remotefeeds; i++) {
        if (remotefeeds[i] === undefined || remotefeeds[i] === null) {
            var remotefeed = {
                id: options.id,
                index: i
            };
            remotefeeds[i] = remotefeed;
            break;
        }
    }

    videoroom.subscribeVideoFromSession(options,
        function (error) {
            if (error) {
                logger.log(JSON.stringify(error));
                bootbox.alert(JSON.stringify(error));
            }
        });
}

/**
 * 房间有人取消了视频发布
 * @param options
 */
function onParticipantUnPublished(options) {


}

function onParticipantLeft(options) {

}

/**
 * local stream 有效
 * @param stream
 */
function onLocalStream(stream) {
    $("#join").css("display", "none");
    $("#session").css("display", "block");
    $("#session-title").text("session:" + roomName);
    $('#main-video-username').html(userName);
    /*$('#mute').click(toggleMute);*/

    //$('#unpublish').click(unpublishOwnFeed);
    WebRtcPeer.attachMediaStream($('#main-video').get(0), stream);
    $("#main-video").get(0).muted = "muted";
}

function onRemoteStream(options, stream) {

    logger.log("recv remote stream" + JSON.stringify(options));
    /*
    * 根据options.id找到UI索引
    * */
    var remoteFeed = null;
    for (var i = 1; i < max_remotefeeds; i++) {
        if (remotefeeds[i] !== null && remotefeeds[i] !== undefined
            && remotefeeds[i].id === options.id) {
            remoteFeed = remotefeeds[i];
            break;
        }
    }

    if (remoteFeed !== undefined && remoteFeed !== null) {
        $('#remote-div-' + remoteFeed.index).removeClass('hide').show();
        $("#remote-video-" + remoteFeed.index).bind("playing", function () {
            var width = this.videoWidth;
            var height = this.videoHeight;
            $('#remote-curres-' + remoteFeed.index).text(width + 'x' + height);
            if (WebRtcPeer.webRTCAdapter.browserDetails.browser === "firefox") {
                // Firefox Stable has a bug: width and height are not immediately available after a playing
                setTimeout(function () {
                    var width = $("#remote-video-" + remoteFeed.index).get(0).videoWidth;
                    var height = $("#remote-video-" + remoteFeed.index).get(0).videoHeight;
                    $('#remote-curres-' + remoteFeed.index).text(width + 'x' + height);
                }, 2000);
            }
        });

        WebRtcPeer.attachMediaStream($('#remote-video-' + remoteFeed.index).get(0), stream);

        if (WebRtcPeer.webRTCAdapter.browserDetails.browser === "chrome" ||
            WebRtcPeer.webRTCAdapter.browserDetails.browser === "firefox" ||
            WebRtcPeer.webRTCAdapter.browserDetails.browser === "safari") {
            //$('#remote-curbitrate-' + remoteFeed.rfindex).removeClass('hide').show();
            bitrateTimer[remoteFeed.index] = setInterval(function () {
                // Display updated bitrate, if supported
                var bitrate = videoroom.getSubscriber(remoteFeed.id).getBitrate();
                $('#remote-curbitrate-' + remoteFeed.index).text(bitrate);
                // Check if the resolution changed too
                var width = $("#remote-video-" + remoteFeed.index).get(0).videoWidth;
                var height = $("#remote-video-" + remoteFeed.index).get(0).videoHeight;
                if (width > 0 && height > 0)
                    $('#remote-curres-' + remoteFeed.index).text(width + 'x' + height).show();
            }, 1000);
        }
    }
}

/**
 * 函数入口
 */
$(document).ready(function () {
    if (!WebRtcPeer.isWebrtcSupported()) {
        bootbox.alert("No WebRTC support... ");
        return;
    }

    var options = {
        server: server,
        onParticipantPublished: (options) => onParticipantPublished(options),
        onParticipantUnPublished: (options) => onParticipantUnPublished(options),
        onParticipantLeft: (options) => onParticipantLeft(options),
        onLocalStream: (stream) => onLocalStream(stream),
        onRemoteStream: (options, stream) => onRemoteStream(options, stream),
        success: function () {

        },
        error: function (error) {
            bootbox.alert(JSON.stringify(error));
        },
        onDestroyed: function () {
            window.location.reload();
        }
    };

    videoroom = new VideoRoom(options);

});

function joinSession() {

    userName = $("#userName").val();
    var roomNumber = $("#sessionId").val();

    var reg = /^[1-9]\d*$|^0$/;

    if (reg.test(roomNumber) !== true) {
        bootbox.alert("roomName must number");
        return;
    }

    if (roomNumber.length < 4 || roomNumber.length > 6) {
        bootbox.alert("roomName must 6 bit");
        return;
    }
    roomName = Number(roomNumber);
    logger.log("start publisher Video to Room" + " userName:" + userName + " roomName:" + roomName);

    var mediaOptions = {
        roomname: roomName,
        username: userName,
        audio: true,
        video: true,
        data: false,
        doSimulcast: false,
        doSimulcast2: false
    };
    videoroom.publishVideoToSession(mediaOptions, function (error) {
        logger.error(JSON.stringify(error));
    });
}

function leaveSession() {
    videoroom.leaveSession();
    $("#join").css("display", "block");
    $("#session").css("display", "none");
}


function appendUserData(videoElement, connection) {
    var userData;
    var nodeId;
    if (typeof connection === "string") {
        userData = connection;
        nodeId = connection;
    } else {
        userData = JSON.parse(connection.data).clientData;
        nodeId = connection.connectionId;
    }
    var dataNode = document.createElement('div');
    dataNode.className = "data-node";
    dataNode.id = "data-" + nodeId;
    dataNode.innerHTML = "<p>" + userData + "</p>";
    videoElement.parentNode.insertBefore(dataNode, videoElement.nextSibling);
    //addClickListener(videoElement, userData);
}

function removeUserData(connection) {
    var dataNode = document.getElementById("data-" + connection.connectionId);
    dataNode.parentNode.removeChild(dataNode);
}

function removeAllUserData() {
    var nicknameElements = document.getElementsByClassName('data-node');
    while (nicknameElements[0]) {
        nicknameElements[0].parentNode.removeChild(nicknameElements[0]);
    }
}
