PluginHandle.noop = function () {};

PluginHandle.init = function (options) {
    options = options || {};
    if (options.debug === undefined || options.debug == null)
        options.debug = {debug: ["error", "warn", "log"]};
    WebRtcPeer.init(options);
};

/**
 *
 * @param options : for webrtc
 * @param callbacks
 * @returns {null}
 * @constructor
 */
function PluginHandle(callbacks) {

    callbacks = callbacks || {};

    callbacks.success = (typeof callbacks.success == "function") ? callbacks.success : PluginHandle.noop;
    callbacks.error = (typeof callbacks.error == "function") ? callbacks.error : PluginHandle.noop;

    callbacks.mediaState = (typeof callbacks.mediaState == "function") ? callbacks.mediaState : PluginHandle.noop;
    callbacks.webrtcState = (typeof callbacks.webrtcState == "function") ? callbacks.webrtcState : PluginHandle.noop;
    callbacks.slowLink = (typeof callbacks.slowLink == "function") ? callbacks.slowLink : PluginHandle.noop;
    callbacks.onmessage = (typeof callbacks.onmessage == "function") ? callbacks.onmessage : PluginHandle.noop;
    callbacks.ondetached = (typeof callbacks.ondetached == "function") ? callbacks.ondetached : PluginHandle.noop;

    /**
     * 由webrtcpeer调用如果实现的话
     */
    callbacks.consentDialog = (typeof callbacks.consentDialog == "function") ? callbacks.consentDialog : PluginHandle.noop;
    callbacks.iceState = (typeof callbacks.iceState == "function") ? callbacks.iceState : PluginHandle.noop;
    callbacks.onlocalstream = (typeof callbacks.onlocalstream == "function") ? callbacks.onlocalstream : PluginHandle.noop;
    callbacks.onremotestream = (typeof callbacks.onremotestream == "function") ? callbacks.onremotestream : PluginHandle.noop;
    callbacks.ondata = (typeof callbacks.ondata == "function") ? callbacks.ondata : PluginHandle.noop;
    callbacks.ondataopen = (typeof callbacks.ondataopen == "function") ? callbacks.ondataopen : PluginHandle.noop;
    callbacks.oncleanup = (typeof callbacks.oncleanup == "function") ? callbacks.oncleanup : PluginHandle.noop;

    var that = this;

    this.session = callbacks.session;
    this.handleId = callbacks.handleId;
    this.token = callbacks.token;
    this.detached = callbacks.detached;
    this.plugin = callbacks.plugin;
    if (this.session === null || this.session === undefined) {
        callbacks.error("session can not null");
        return null;
    }

    if (this.handleId === null || this.handleId === undefined) {
        callbacks.error("handleId can not null");
        return null;
    } else {
        console.log("handleId:" + this.handleId);
    }

    callbacks.onicecandidate = onIceCandidate;

    /**
     *
     * @type {*|PluginHandle.noop}
     */
    this.webrtcState = callbacks.webrtcState;

    /**
     *
     * @type {*|PluginHandle.noop}
     */
    this.ondetached = callbacks.ondetached;

    /**
     *
     * @type {*|PluginHandle.noop}
     */
    this.mediaState = callbacks.mediaState;

    /**
     *
     * @type {*|PluginHandle.noop}
     */
    this.slowLink = callbacks.slowLink;

    /**
     *
     * @type {*|PluginHandle.noop}
     */
    this.onmessage = callbacks.onmessage;
    /**
     *
     * @type {WebRtcPeer}
     */
    this.webrtcPeer = new WebRtcPeer(callbacks);

    /**
     *
     * @returns {*}
     */
    this.getHandleId = function () {
        return this.handleId;
    };

    /**
     *
     */
    this.getPlugin = function () {
       return this.plugin;
    };
    /**
     *
     * @returns {string}
     */
    this.getIceState = function () {
      return this.webrtcPeer.getIceState();
    };

    /**
     *
     * @returns {number|*}
     */
    this.getVolume = function () {
        return this.webrtcPeer.getVolume(true);
    };

    /**
     *
     * @returns {number|*}
     */
    this.getRemoteVolume = function () {
        return this.webrtcPeer.getVolume(true);
    };

    /**
     *
     * @returns {number|*}
     */
    this.getLocalVolume = function () {
        return this.webrtcPeer.getVolume(false);
    };

    /**
     *
     * @returns {boolean|*}
     */
    this.isAudioMuted = function () {
        return this.webrtcPeer.isMuted(false);
    };

    /**
     *
     * @returns {boolean}
     */
    this.muteAudio = function () {
        return this.webrtcPeer.mute(false, true);
    };

    this.unmuteAudio = function () {
        return this.webrtcPeer.mute(false, false);
    };

    /**
     *
     * @returns {boolean|*}
     */
    this.isVideoMuted = function () {
        return this.webrtcPeer.isMuted(true);
    };

    /**
     *
     * @returns {boolean}
     */
    this.muteVideo = function () {
        return this.webrtcPeer.mute(true, true);
    };

    /**
     *
     * @returns {boolean}
     */
    this.unmuteVideo = function () {
        return this.webrtcPeer.mute(true, false);
    };

    /**
     *
     * @returns {string|config.bitrate.value}
     */
    this.getBitrate = function () {
        return this.webrtcPeer.getBitrate();
    };


    /**
     *
     * @param callbacks
     */
    this.data = function (callbacks) {
        this.webrtcPeer.sendData(callbacks);
    };

    /**
     *
     * @param callbacks
     */
    this.dtmf = function (callbacks) {
        this.webrtcPeer.sendDtmf(callbacks);
    };


    /**
     *
     * @param callbacks
     */
    this.createOffer = function (callbacks) {
        this.webrtcPeer.prepareWebrtc(true, callbacks);
    };

    /**
     *
     * @param callbacks
     */
    this.createAnswer = function (callbacks) {
        this.webrtcPeer.prepareWebrtc(false, callbacks);
    };

    /**
     *
     * @param callbacks
     */
    this.handleRemoteJsep = function (callbacks) {
        this.webrtcPeer.prepareWebrtcPeer(callbacks);
    };

    /**
     *
     * @param sendRequest
     */
    this.hangup = function (sendRequest) {
        //cleanupWebrtc(handleId, sendRequest === true);
        this.webrtcPeer.cleanupWebrtc();
        if (sendRequest)
            this.session.cleanupWebrtc(this.handleId);
    };

    /**
     *
     * @param callbacks
     */
    this.detach = function (callbacks) {
        this.webrtcPeer.cleanupWebrtc();
        delete this.webrtcPeer;
        this.session.destroyHandle(this.handleId,callbacks);
    };

    /**
     *
     * @param callbacks
     */
    this.sendMessage = function (callbacks) {
        this.session.sendMessage(this.handleId, callbacks);
    };

    /**
     *
     * @param candidate
     */
    function onIceCandidate(candidate) {
        that.session.sendTrickleCandidate(that.handleId, candidate);
    }

    this.addRemoteIceCandidate = function (candidate) {
        this.webrtcPeer.addRemoteIceCandidate(candidate);
    };

    this.handleRemoteJsep = function(callbacks) {
        this.webrtcPeer.prepareWebrtcPeer(callbacks);
    };
}
