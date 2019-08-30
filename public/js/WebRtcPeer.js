
var inherits = require('inherits');


function noop(error) {
    if (error) logger.error(error)
}

var logger = window.Logger || console;

// Helper method to check whether WebRTC is supported by this browser
WebRtcPeer.isWebrtcSupported = function () {
    return window.RTCPeerConnection !== undefined && window.RTCPeerConnection !== null;
};

// Helper method to check whether devices can be accessed by this browser 
//(e.g., not possible via plain HTTP)
WebRtcPeer.isGetUserMediaAvailable = function () {
    return navigator.mediaDevices !== undefined
        && navigator.mediaDevices !== null
        && navigator.mediaDevices.getUserMedia !== undefined
        && navigator.mediaDevices.getUserMedia !== null;
};

/**
 *
 * @param callback
 * @param constraints:{ audio: true, video: true },
 * {
        audio: true,
        video: { width: 1280, height: 720 }
    }
 */
WebRtcPeer.listDevices = function (callback, constraints) {
    callback = (typeof callback == "function") ? callback : {};
    if (constraints == null) constraints = {audio: true, video: true};
    if (WebRtcPeer.isGetUserMediaAvailable()) {
        navigator.mediaDevices.getUserMedia(constraints)
            .then(function (stream) {
                navigator.mediaDevices.enumerateDevices().then(function (devices) {
                    logger.debug(devices);
                    callback(devices);
                    // Get rid of the now useless stream
                    try {
                        var tracks = stream.getTracks();
                        for (var i in tracks) {
                            var mst = tracks[i];
                            if (mst !== null && mst !== undefined)
                                mst.stop();
                        }
                    } catch (e) {
                    }
                });
            })
            .catch(function (err) {
                logger.error(err);
                callback([]);
            });
    } else {
        logger.warn("navigator.mediaDevices unavailable");
        callback([]);
    }
};

//
// Specialized child classes
//
/**
 * WebRtcPeer子类,通过它创建的是只能接收的Peer
 * @param options
 * @param callback
 * @returns {WebRtcPeerRecvonly|*}
 * @constructor
 */
function WebRtcPeerRecvonly(options, callback) {
    if (!(this instanceof WebRtcPeerRecvonly)) {
        return new WebRtcPeerRecvonly(options, callback);
    }

    WebRtcPeerRecvonly.super_.call(this, 'recvonly', options, callback);
}

inherits(WebRtcPeerRecvonly, WebRtcPeer);

/**
 *WebRtcPeer子类,通过它创建的是只能发送的Peer
 * @param options
 * @param callback
 * @returns {WebRtcPeerSendonly|*}
 * @constructor
 */
function WebRtcPeerSendonly(options, callback) {
    if (!(this instanceof WebRtcPeerSendonly)) {
        return new WebRtcPeerSendonly(options, callback);
    }

    WebRtcPeerSendonly.super_.call(this, 'sendonly', options, callback);
}

inherits(WebRtcPeerSendonly, WebRtcPeer);

/**
 * WebRtcPeer子类,通过它创建的是能收发的Peer
 * @param options
 * @param callback
 * @returns {WebRtcPeerSendrecv|*}
 * @constructor
 */
function WebRtcPeerSendrecv(options, callback) {
    if (!(this instanceof WebRtcPeerSendrecv)) {
        return new WebRtcPeerSendrecv(options, callback);
    }

    WebRtcPeerSendrecv.super_.call(this, 'sendrecv', options, callback);
}

inherits(WebRtcPeerSendrecv, WebRtcPeer);


/**
 *
 * @param mode :{String} mode Mode in which the PeerConnection will be configured.
 *      Valid values are: 'recv', 'send', and 'sendRecv'
 * @param options
 * @param callback,回调函数
 * @constructor
 */
function WebRtcPeer(mode, options, callback) {
    if (!(this instanceof WebRtcPeer)) {
        return new WebRtcPeer(mode, options, callback);
    }

    WebRtcPeer.super_.call(this);

    if (options instanceof Function) {
        callback = options;
        options = undefined;
    }

    options = options || {};
    callback = (callback || noop).bind(this);

    var self = this;

    var localVideo = options.localVideo;
    var remoteVideo = options.remoteVideo;
    var videoStream = options.videoStream;
    var audioStream = options.audioStream;
    var mediaConstraints = options.mediaConstraints;


}
