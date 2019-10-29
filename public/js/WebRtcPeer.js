
var logger;

WebRtcPeer.noop = function () {};

WebRtcPeer.isExtensionEnabled = function () {
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
        // No need for the extension, getDisplayMedia is supported
        return true;
    }
    if (window.navigator.userAgent.match('Chrome')) {
        var chromever = parseInt(window.navigator.userAgent.match(/Chrome\/(.*) /)[1], 10);
        var maxver = 33;
        if (window.navigator.userAgent.match('Linux'))
            maxver = 35;	// "known" crash in chrome 34 and 35 on linux
        if (chromever >= 26 && chromever <= maxver) {
            // Older versions of Chrome don't support this extension-based approach, so lie
            return true;
        }
        return WebRtcPeer.extension.isInstalled();
    } else {
        // Firefox of others, no need for the extension (but this doesn't mean it will work)
        return true;
    }
};

var defaultExtension = {
    // Screensharing Chrome Extension ID
    extensionId: 'hapfgfdkleiggjjpfpenajgdnfckjpaj',
    isInstalled: function () {
        return document.querySelector('#janus-extension-installed') !== null;
    },
    getScreen: function (callback) {
        var pending = window.setTimeout(function () {
            var error = new Error('NavigatorUserMediaError');
            error.name = 'The required Chrome extension is not installed: click <a href="#">here</a> to install it. (NOTE: this will need you to refresh the page)';
            return callback(error);
        }, 1000);
        this.cache[pending] = callback;
        window.postMessage({type: 'janusGetScreen', id: pending}, '*');
    },
    init: function () {
        var cache = {};
        this.cache = cache;
        // Wait for events from the Chrome Extension
        window.addEventListener('message', function (event) {
            if (event.origin != window.location.origin)
                return;
            if (event.data.type == 'janusGotScreen' && cache[event.data.id]) {
                var callback = cache[event.data.id];
                delete cache[event.data.id];

                if (event.data.sourceId === '') {
                    // user canceled
                    var error = new Error('NavigatorUserMediaError');
                    error.name = 'You cancelled the request for permission, giving up...';
                    callback(error);
                } else {
                    callback(null, event.data.sourceId);
                }
            } else if (event.data.type == 'janusGetScreenPending') {
                console.log('clearing ', event.data.id);
                window.clearTimeout(event.data.id);
            }
        });
    }
};

WebRtcPeer.useDefaultDependencies = function (deps) {
    return {
        extension: (deps && deps.extension) || defaultExtension,
        isArray: function (arr) {
            return Array.isArray(arr);
        },
        webRTCAdapter: (deps && deps.adapter) || adapter,
    }
};

WebRtcPeer.dataChanDefaultLabel = "WebRtcPeerDataChannel";

// Note: in the future we may want to change this, e.g., as was
// attempted in https://github.com/meetecho/janus-gateway/issues/1670
WebRtcPeer.endOfCandidates = null;

// Initialization
WebRtcPeer.init = function (options) {
    options = options || {};
    options.callback = (typeof options.callback == "function") ? options.callback : WebRtcPeer.noop;
    if (WebRtcPeer.initDone === true) {
        // Already initialized
        options.callback();
    } else {
        logger = new Logger(options);
        logger.log("Initializing WeRtcPeer library");
        var usedDependencies = options.dependencies || WebRtcPeer.useDefaultDependencies();
        WebRtcPeer.isArray = usedDependencies.isArray;
        WebRtcPeer.webRTCAdapter = usedDependencies.webRTCAdapter;
        WebRtcPeer.extension = usedDependencies.extension;
        WebRtcPeer.extension.init();

        // Helper method to enumerate devices
        WebRtcPeer.listDevices = function (callback, config) {
            callback = (typeof callback == "function") ? callback : WebRtcPeer.noop;
            if (config == null) config = {audio: true, video: true};
            if (WebRtcPeer.isGetUserMediaAvailable()) {
                navigator.mediaDevices.getUserMedia(config)
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
        // Helper methods to attach/reattach a stream to a video element (previously part of adapter.js)
        WebRtcPeer.attachMediaStream = function (element, stream) {
            if (WebRtcPeer.webRTCAdapter.browserDetails.browser === 'chrome') {
                var chromever = WebRtcPeer.webRTCAdapter.browserDetails.version;
                if (chromever >= 52) {
                    element.srcObject = stream;
                } else if (typeof element.src !== 'undefined') {
                    element.src = URL.createObjectURL(stream);
                } else {
                    logger.error("Error attaching stream to element");
                }
            } else {
                element.srcObject = stream;
            }
        };
        WebRtcPeer.reattachMediaStream = function (to, from) {
            if (WebRtcPeer.webRTCAdapter.browserDetails.browser === 'chrome') {
                var chromever = WebRtcPeer.webRTCAdapter.browserDetails.version;
                if (chromever >= 52) {
                    to.srcObject = from.srcObject;
                } else if (typeof to.src !== 'undefined') {
                    to.src = from.src;
                } else {
                    logger.error("Error reattaching stream to element");
                }
            } else {
                to.srcObject = from.srcObject;
            }
        };
        // Detect tab close: make sure we don't loose existing onbeforeunload handlers
        // (note: for iOS we need to subscribe to a different event, 'pagehide', see
        // https://gist.github.com/thehunmonkgroup/6bee8941a49b86be31a787fe8f4b8cfe)
        var iOS = ['iPad', 'iPhone', 'iPod'].indexOf(navigator.platform) >= 0;
        var eventName = iOS ? 'pagehide' : 'beforeunload';
        var oldOBF = window["on" + eventName];

        // If this is a Safari Technology Preview, check if VP8 is supported
        WebRtcPeer.safariVp8 = false;
        if (WebRtcPeer.webRTCAdapter.browserDetails.browser === 'safari' &&
            WebRtcPeer.webRTCAdapter.browserDetails.version >= 605) {
            // Let's see if RTCRtpSender.getCapabilities() is there
            if (RTCRtpSender && RTCRtpSender.getCapabilities && RTCRtpSender.getCapabilities("video") &&
                RTCRtpSender.getCapabilities("video").codecs && RTCRtpSender.getCapabilities("video").codecs.length) {
                for (var i in RTCRtpSender.getCapabilities("video").codecs) {
                    var codec = RTCRtpSender.getCapabilities("video").codecs[i];
                    if (codec && codec.mimeType && codec.mimeType.toLowerCase() === "video/vp8") {
                        WebRtcPeer.safariVp8 = true;
                        break;
                    }
                }
                if (WebRtcPeer.safariVp8) {
                    logger.log("This version of Safari supports VP8");
                } else {
                    logger.warn("This version of Safari does NOT support VP8: if you're using a Technology Preview, " +
                        "try enabling the 'WebRTC VP8 codec' setting in the 'Experimental Features' Develop menu");
                }
            } else {
                // We do it in a very ugly way, as there's no alternative...
                // We create a PeerConnection to see if VP8 is in an offer
                var testpc = new RTCPeerConnection({}, {});
                testpc.createOffer({offerToReceiveVideo: true}).then(function (offer) {
                    WebRtcPeer.safariVp8 = offer.sdp.indexOf("VP8") !== -1;
                    if (WebRtcPeer.safariVp8) {
                        logger.log("This version of Safari supports VP8");
                    } else {
                        logger.warn("This version of Safari does NOT support VP8: if you're using a Technology Preview, " +
                            "try enabling the 'WebRTC VP8 codec' setting in the 'Experimental Features' Develop menu");
                    }
                    testpc.close();
                    testpc = null;
                });
            }
        }
        // Check if this browser supports Unified Plan and transceivers
        // Based on https://codepen.io/anon/pen/ZqLwWV?editors=0010
        WebRtcPeer.unifiedPlan = false;
        if (WebRtcPeer.webRTCAdapter.browserDetails.browser === 'firefox' &&
            WebRtcPeer.webRTCAdapter.browserDetails.version >= 59) {
            // Firefox definitely does, starting from version 59
            WebRtcPeer.unifiedPlan = true;
        } else if (WebRtcPeer.webRTCAdapter.browserDetails.browser === 'chrome' &&
            WebRtcPeer.webRTCAdapter.browserDetails.version < 72) {
            // Chrome does, but it's only usable from version 72 on
            WebRtcPeer.unifiedPlan = false;
        } else if (!window.RTCRtpTransceiver || !('currentDirection' in RTCRtpTransceiver.prototype)) {
            // Safari supports addTransceiver() but not Unified Plan when
            // currentDirection is not defined (see codepen above).
            WebRtcPeer.unifiedPlan = false;
        } else {
            // Check if addTransceiver() throws an exception
            const tempPc = new RTCPeerConnection();
            try {
                tempPc.addTransceiver('audio');
                WebRtcPeer.unifiedPlan = true;
            } catch (e) {
            }
            tempPc.close();
        }
        WebRtcPeer.initDone = true;
        options.callback();
    }
};

// Helper method to check whether WebRTC is supported by this browser
WebRtcPeer.isWebrtcSupported = function () {
    return window.RTCPeerConnection !== undefined && window.RTCPeerConnection !== null;
};
// Helper method to check whether devices can be accessed by this browser (e.g., not possible via plain HTTP)
WebRtcPeer.isGetUserMediaAvailable = function () {
    return navigator.mediaDevices !== undefined && navigator.mediaDevices !== null &&
        navigator.mediaDevices.getUserMedia !== undefined && navigator.mediaDevices.getUserMedia !== null;
};

function WebRtcPeer(options) {

    options = options || {};

    options.consentDialog = (typeof options.consentDialog == "function") ? options.consentDialog : WebRtcPeer.noop;
    options.onicecandidate = (typeof options.onicecandidate == "function") ? options.onicecandidate : WebRtcPeer.noop;
    options.onlocalstream = (typeof options.onlocalstream == "function") ? options.onlocalstream : WebRtcPeer.noop;
    options.onremotestream = (typeof options.onremotestream == "function") ? options.onremotestream : WebRtcPeer.noop;
    options.ondata = (typeof options.ondata == "function") ? options.ondata : WebRtcPeer.noop;
    options.ondataopen = (typeof options.ondataopen == "function") ? options.ondataopen : WebRtcPeer.noop;
    options.oncleanup = (typeof options.oncleanup == "function") ? options.oncleanup : WebRtcPeer.noop;
    options.iceState = (typeof options.iceState == "function") ? options.iceState : WebRtcPeer.noop;

    var iceServers = options.iceServers;
    if (iceServers === undefined || iceServers === null) {
        //iceServers = [{urls: "stun:stun.l.google.com:19302"}];
        iceServers = [
            /*{
                urls: "turn:ubonass.com:3478",
                username: "ubonass",
                credential: "@@@"
            }, */{
                urls: [
                    "stun:stun.l.google.com:19302",
                    "stun:stun.l.google.com:19302",
                    "stun:stun2.l.google.com:19302",
                    "stun:stun3.l.google.com:19302",
                    "stun:stun4.l.google.com:19302",
                    "stun:stun.ekiga.net",
                    "stun:stun.ideasip.com",
                    "stun:stun.schlund.de",
                    "stun:stun.stunprotocol.org:3478",
                    "stun:stun.voiparound.com",
                    "stun:stun.voipbuster.com",
                    "stun:stun.voipstunt.com",
                    "stun:stun.voxgratia.org",
                    "stun:ubonass.com:3478"
                ]
            }
        ]
    }

    var iceTransportPolicy = options.iceTransportPolicy;
    var bundlePolicy = options.bundlePolicy;
    // Whether IPv6 candidates should be gathered
    var ipv6Support = options.ipv6;
    if (ipv6Support === undefined || ipv6Support === null)
        ipv6Support = false;

    var config = {
        started: false,
        localStream: null,
        streamExternal: false,
        remoteStream: null,
        localSdp: null,
        mediaConstraints: null,
        peerConnection: null,
        dataChannel: {},
        dtmfSender: null,
        trickle: true,
        iceDone: false,
        volume: {
            value: null,
            timer: null
        },
        bitrate: {
            value: null,
            bsnow: null,
            bsbefore: null,
            tsnow: null,
            tsbefore: null,
            timer: null
        }
    };

    // Private method to create a data channel
    function createDataChannel(dclabel, incoming, pendingText) {
        var onDataChannelMessage = function (event) {
            logger.log('Received message on data channel:', event);
            var label = event.target.label;
            options.ondata(event.data, label);
        };
        var onDataChannelStateChange = function (event) {
            logger.log('Received state change on data channel:', event);
            var label = event.target.label;
            var dcState = config.dataChannel[label] ? config.dataChannel[label].readyState : "null";
            logger.log('State change on <' + label + '> data channel: ' + dcState);
            if (dcState === 'open') {
                // Any pending messages to send?
                if (config.dataChannel[label].pending && config.dataChannel[label].pending.length > 0) {
                    logger.log("Sending pending messages on <" + label + ">:", config.dataChannel[label].pending.length);
                    for (var i in config.dataChannel[label].pending) {
                        var text = config.dataChannel[label].pending[i];
                        logger.log("Sending string on data channel <" + label + ">: " + text);
                        config.dataChannel[label].send(text);
                    }
                    config.dataChannel[label].pending = [];
                }
                // Notify the open data channel
                options.ondataopen(label);
            }
        };
        var onDataChannelError = function (error) {
            logger.error('Got error on data channel:', error);
            // TODO
        };
        if (!incoming) {
            // FIXME Add options (ordered, maxRetransmits, etc.)
            config.dataChannel[dclabel] = config.peerConnection.createDataChannel(dclabel, {ordered: false});
        } else {
            // The channel was created by RemoteCloud
            config.dataChannel[dclabel] = incoming;
        }
        config.dataChannel[dclabel].onmessage = onDataChannelMessage;
        config.dataChannel[dclabel].onopen = onDataChannelStateChange;
        config.dataChannel[dclabel].onclose = onDataChannelStateChange;
        config.dataChannel[dclabel].onerror = onDataChannelError;
        config.dataChannel[dclabel].pending = [];
        if (pendingText)
            config.dataChannel[dclabel].pending.push(pendingText);
    }

    function streamsDone(jsep, media, callbacks, stream) {

        logger.debug("streamsDone:", stream);
        if (stream) {
            logger.debug("  -- Audio tracks:", stream.getAudioTracks());
            logger.debug("  -- Video tracks:", stream.getVideoTracks());
        }
        // We're now capturing the new stream: check if we're updating or if it's a new thing
        var addTracks = false;
        if (!config.localStream || !media.update || config.streamExternal) {
            config.localStream = stream;
            addTracks = true;
        } else {
            // We only need to update the existing stream
            if (((!media.update && isAudioSendEnabled(media)) || (media.update && (media.addAudio || media.replaceAudio))) &&
                stream.getAudioTracks() && stream.getAudioTracks().length) {
                config.localStream.addTrack(stream.getAudioTracks()[0]);
                if (WebRtcPeer.unifiedPlan) {
                    // Use Transceivers
                    logger.log((media.replaceAudio ? "Replacing" : "Adding") + " audio track:", stream.getAudioTracks()[0]);
                    var audioTransceiver = null;
                    var transceivers = config.peerConnection.getTransceivers();
                    if (transceivers && transceivers.length > 0) {
                        for (var i in transceivers) {
                            var t = transceivers[i];
                            if ((t.sender && t.sender.track && t.sender.track.kind === "audio") ||
                                (t.receiver && t.receiver.track && t.receiver.track.kind === "audio")) {
                                audioTransceiver = t;
                                break;
                            }
                        }
                    }
                    if (audioTransceiver && audioTransceiver.sender) {
                        audioTransceiver.sender.replaceTrack(stream.getAudioTracks()[0]);
                    } else {
                        config.peerConnection.addTrack(stream.getAudioTracks()[0], stream);
                    }
                } else {
                    logger.log((media.replaceAudio ? "Replacing" : "Adding") + " audio track:", stream.getAudioTracks()[0]);
                    config.peerConnection.addTrack(stream.getAudioTracks()[0], stream);
                }
            }
            if (((!media.update && isVideoSendEnabled(media)) || (media.update && (media.addVideo || media.replaceVideo))) &&
                stream.getVideoTracks() && stream.getVideoTracks().length) {
                config.localStream.addTrack(stream.getVideoTracks()[0]);
                if (WebRtcPeer.unifiedPlan) {
                    // Use Transceivers
                    logger.log((media.replaceVideo ? "Replacing" : "Adding") + " video track:", stream.getVideoTracks()[0]);
                    var videoTransceiver = null;
                    var transceivers = config.peerConnection.getTransceivers();
                    if (transceivers && transceivers.length > 0) {
                        for (var i in transceivers) {
                            var t = transceivers[i];
                            if ((t.sender && t.sender.track && t.sender.track.kind === "video") ||
                                (t.receiver && t.receiver.track && t.receiver.track.kind === "video")) {
                                videoTransceiver = t;
                                break;
                            }
                        }
                    }
                    if (videoTransceiver && videoTransceiver.sender) {
                        videoTransceiver.sender.replaceTrack(stream.getVideoTracks()[0]);
                    } else {
                        config.peerConnection.addTrack(stream.getVideoTracks()[0], stream);
                    }
                } else {
                    logger.log((media.replaceVideo ? "Replacing" : "Adding") + " video track:", stream.getVideoTracks()[0]);
                    config.peerConnection.addTrack(stream.getVideoTracks()[0], stream);
                }
            }
        }
        // If we still need to create a PeerConnection, let's do that
        if (!config.peerConnection) {
            var pc_config = {
                "iceServers": iceServers,
                "iceTransportPolicy": iceTransportPolicy,
                "bundlePolicy": bundlePolicy
            };
            if (WebRtcPeer.webRTCAdapter.browserDetails.browser === "chrome") {
                // For Chrome versions before 72, we force a plan-b semantic, and unified-plan otherwise
                pc_config["sdpSemantics"] = (WebRtcPeer.webRTCAdapter.browserDetails.version < 72) ? "plan-b" : "unified-plan";
            }
            var pc_constraints = {
                "optional": [{"DtlsSrtpKeyAgreement": true}]
            };
            if (ipv6Support === true) {
                pc_constraints.optional.push({"googIPv6": true});
            }
            // Any custom constraint to add?
            if (callbacks.rtcConstraints && typeof callbacks.rtcConstraints === 'object') {
                logger.debug("Adding custom PeerConnection constraints:", callbacks.rtcConstraints);
                for (var i in callbacks.rtcConstraints) {
                    pc_constraints.optional.push(callbacks.rtcConstraints[i]);
                }
            }
            if (WebRtcPeer.webRTCAdapter.browserDetails.browser === "edge") {
                // This is Edge, enable BUNDLE explicitly
                pc_config.bundlePolicy = "max-bundle";
            }
            logger.log("Creating PeerConnection");
            logger.debug(pc_constraints);
            config.peerConnection = new RTCPeerConnection(pc_config, pc_constraints);
            logger.debug(config.peerConnection);
            if (config.peerConnection.getStats) {	// FIXME
                config.volume = {};
                config.bitrate.value = "0 kbits/sec";
            }
            logger.log("Preparing local SDP and gathering candidates (trickle=" + config.trickle + ")");
            config.peerConnection.oniceconnectionstatechange = function (e) {
                if (config.peerConnection)
                    options.iceState(config.peerConnection.iceConnectionState);
            };
            config.peerConnection.onicecandidate = function (event) {
                if (event.candidate == null ||
                    (WebRtcPeer.webRTCAdapter.browserDetails.browser === 'edge' && event.candidate.candidate.indexOf('endOfCandidates') > 0)) {
                    logger.log("End of candidates.");
                    config.iceDone = true;
                    if (config.trickle === true) {
                        // Notify end of candidates
                        options.onicecandidate({"completed": true});
                    } else {
                        // No trickle, time to send the complete SDP (including all candidates)
                        sendSDP(callbacks);
                    }
                } else {
                    // JSON.stringify doesn't work on some WebRTC objects anymore
                    // See https://code.google.com/p/chromium/issues/detail?id=467366
                    var candidate = {
                        "candidate": event.candidate.candidate,
                        "sdpMid": event.candidate.sdpMid,
                        "sdpMLineIndex": event.candidate.sdpMLineIndex
                    };
                    if (config.trickle === true) {
                        // Send candidate
                        options.onicecandidate(candidate);
                    }
                }
            };
            config.peerConnection.ontrack = function (event) {
                logger.log("Handling Remote Track");
                logger.debug(event);
                if (!event.streams)
                    return;
                config.remoteStream = event.streams[0];
                options.onremotestream(config.remoteStream);
                if (event.track.onended)
                    return;
                logger.log("Adding onended callback to track:", event.track);
                event.track.onended = function (ev) {
                    logger.log("Remote track muted/removed:", ev);
                    if (config.remoteStream) {
                        config.remoteStream.removeTrack(ev.target);
                        options.onremotestream(config.remoteStream);
                    }
                };
                event.track.onmute = event.track.onended;
                event.track.onunmute = function (ev) {
                    logger.log("Remote track flowing again:", ev);
                    try {
                        config.remoteStream.addTrack(ev.target);
                        options.onremotestream(config.remoteStream);
                    } catch (e) {
                        logger.error(e);
                    }
                };
            };
        }
        if (addTracks && stream !== null && stream !== undefined) {
            logger.log('Adding local stream');
            var simulcast2 = callbacks.simulcast2 === true ? true : false;
            stream.getTracks().forEach(function (track) {
                logger.log('Adding local track:', track);
                if (!simulcast2) {
                    config.peerConnection.addTrack(track, stream);
                } else {
                    if (track.kind === "audio") {
                        config.peerConnection.addTrack(track, stream);
                    } else {
                        logger.log('Enabling rid-based simulcasting:', track);
                        const maxBitrates = getMaxBitrates(callbacks.simulcastMaxBitrates);
                        config.peerConnection.addTransceiver(track, {
                            direction: "sendrecv",
                            streams: [stream],
                            sendEncodings: [
                                {rid: "h", active: true, maxBitrate: maxBitrates.high},
                                {rid: "m", active: true, maxBitrate: maxBitrates.medium, scaleResolutionDownBy: 2},
                                {rid: "l", active: true, maxBitrate: maxBitrates.low, scaleResolutionDownBy: 4}
                            ]
                        });
                    }
                }
            });
        }
        // Any data channel to create?
        if (isDataEnabled(media) && !config.dataChannel[WebRtcPeer.dataChanDefaultLabel]) {
            logger.log("Creating data channel");
            createDataChannel(WebRtcPeer.dataChanDefaultLabel, false);
            config.peerConnection.ondatachannel = function (event) {
                logger.log("Data channel created by RemoteCloud:", event);
                createDataChannel(event.channel.label, event.channel);
            };
        }
        // If there's a new local stream, let's notify the application
        if (config.localStream)
            options.onlocalstream(config.localStream);
        // Create offer/answer now
        if (jsep === null || jsep === undefined) {
            createOffer(media, callbacks);
        } else {
            config.peerConnection.setRemoteDescription(jsep)
                .then(function () {
                    logger.log("Remote description accepted!");
                    config.remoteSdp = jsep.sdp;
                    // Any trickle candidate we cached?
                    /*if (config.candidates && config.candidates.length > 0) {
                        for (var i = 0; i < config.candidates.length; i++) {
                            var candidate = config.candidates[i];
                            RemoteCloud.debug("Adding remote candidate:", candidate);
                            if (!candidate || candidate.completed === true) {
                                // end-of-candidates
                                config.peerConnection.addIceCandidate(RemoteCloud.endOfCandidates).then(() => {
                                    // Do stuff when the candidate is successfully passed to the ICE agent
                                    RemoteCloud.log("@@Adding remote candidate " + candidate + "success");
                                }).catch(e => {
                                    RemoteCloud.error("@@Error: Failure during addIceCandidate()");
                                });
                            } else {
                                // New candidate
                                config.peerConnection.addIceCandidate(candidate).then(() => {
                                    // Do stuff when the candidate is successfully passed to the ICE agent
                                    RemoteCloud.log("@@Adding remote candidate " + candidate + "success");
                                }).catch(e => {
                                    RemoteCloud.error("@@Error: Failure during addIceCandidate()");
                                });
                            }
                        }
                        config.candidates = [];
                    }*/
                    // Create the answer now
                    createAnswer(media, callbacks);
                }, callbacks.error);
        }
    }

    function createOffer(media, callbacks) {
        callbacks = callbacks || {};
        callbacks.success = (typeof callbacks.success == "function") ? callbacks.success : WebRtcPeer.noop;
        callbacks.error = (typeof callbacks.error == "function") ? callbacks.error : WebRtcPeer.noop;
        callbacks.customizeSdp = (typeof callbacks.customizeSdp == "function") ? callbacks.customizeSdp : WebRtcPeer.noop;
        var simulcast = callbacks.simulcast === true;
        if (!simulcast) {
            logger.log("Creating offer (iceDone=" + config.iceDone + ")");
        } else {
            logger.log("Creating offer (iceDone=" + config.iceDone + ", simulcast=" + simulcast + ")");
        }
        // https://code.google.com/p/webrtc/issues/detail?id=3508
        var mediaConstraints = {};
        if (WebRtcPeer.unifiedPlan) {
            // We can use Transceivers
            var audioTransceiver = null, videoTransceiver = null;
            var transceivers = config.peerConnection.getTransceivers();
            if (transceivers && transceivers.length > 0) {
                for (var i in transceivers) {
                    var t = transceivers[i];
                    if ((t.sender && t.sender.track && t.sender.track.kind === "audio") ||
                        (t.receiver && t.receiver.track && t.receiver.track.kind === "audio")) {
                        if (!audioTransceiver)
                            audioTransceiver = t;
                        continue;
                    }
                    if ((t.sender && t.sender.track && t.sender.track.kind === "video") ||
                        (t.receiver && t.receiver.track && t.receiver.track.kind === "video")) {
                        if (!videoTransceiver)
                            videoTransceiver = t;
                        continue;
                    }
                }
            }
            // Handle audio (and related changes, if any)
            var audioSend = isAudioSendEnabled(media);
            var audioRecv = isAudioRecvEnabled(media);
            if (!audioSend && !audioRecv) {
                // Audio disabled: have we removed it?
                if (media.removeAudio && audioTransceiver) {
                    if (audioTransceiver.setDirection) {
                        audioTransceiver.setDirection("inactive");
                    } else {
                        audioTransceiver.direction = "inactive";
                    }
                    logger.log("Setting audio transceiver to inactive:", audioTransceiver);
                }
            } else {
                // Take care of audio m-line
                if (audioSend && audioRecv) {
                    if (audioTransceiver) {
                        if (audioTransceiver.setDirection) {
                            audioTransceiver.setDirection("sendrecv");
                        } else {
                            audioTransceiver.direction = "sendrecv";
                        }
                        logger.log("Setting audio transceiver to sendrecv:", audioTransceiver);
                    }
                } else if (audioSend && !audioRecv) {
                    if (audioTransceiver) {
                        if (audioTransceiver.setDirection) {
                            audioTransceiver.setDirection("sendonly");
                        } else {
                            audioTransceiver.direction = "sendonly";
                        }
                        logger.log("Setting audio transceiver to sendonly:", audioTransceiver);
                    }
                } else if (!audioSend && audioRecv) {
                    if (audioTransceiver) {
                        if (audioTransceiver.setDirection) {
                            audioTransceiver.setDirection("recvonly");
                        } else {
                            audioTransceiver.direction = "recvonly";
                        }
                        logger.log("Setting audio transceiver to recvonly:", audioTransceiver);
                    } else {
                        // In theory, this is the only case where we might not have a transceiver yet
                        audioTransceiver = config.peerConnection.addTransceiver("audio", {direction: "recvonly"});
                        logger.log("Adding recvonly audio transceiver:", audioTransceiver);
                    }
                }
            }
            // Handle video (and related changes, if any)
            var videoSend = isVideoSendEnabled(media);
            var videoRecv = isVideoRecvEnabled(media);
            if (!videoSend && !videoRecv) {
                // Video disabled: have we removed it?
                if (media.removeVideo && videoTransceiver) {
                    if (videoTransceiver.setDirection) {
                        videoTransceiver.setDirection("inactive");
                    } else {
                        videoTransceiver.direction = "inactive";
                    }
                    logger.log("Setting video transceiver to inactive:", videoTransceiver);
                }
            } else {
                // Take care of video m-line
                if (videoSend && videoRecv) {
                    if (videoTransceiver) {
                        if (videoTransceiver.setDirection) {
                            videoTransceiver.setDirection("sendrecv");
                        } else {
                            videoTransceiver.direction = "sendrecv";
                        }
                        logger.log("Setting video transceiver to sendrecv:", videoTransceiver);
                    }
                } else if (videoSend && !videoRecv) {
                    if (videoTransceiver) {
                        if (videoTransceiver.setDirection) {
                            videoTransceiver.setDirection("sendonly");
                        } else {
                            videoTransceiver.direction = "sendonly";
                        }
                        logger.log("Setting video transceiver to sendonly:", videoTransceiver);
                    }
                } else if (!videoSend && videoRecv) {
                    if (videoTransceiver) {
                        if (videoTransceiver.setDirection) {
                            videoTransceiver.setDirection("recvonly");
                        } else {
                            videoTransceiver.direction = "recvonly";
                        }
                        logger.log("Setting video transceiver to recvonly:", videoTransceiver);
                    } else {
                        // In theory, this is the only case where we might not have a transceiver yet
                        videoTransceiver = config.peerConnection.addTransceiver("video", {direction: "recvonly"});
                        logger.log("Adding recvonly video transceiver:", videoTransceiver);
                    }
                }
            }
        } else {
            mediaConstraints["offerToReceiveAudio"] = isAudioRecvEnabled(media);
            mediaConstraints["offerToReceiveVideo"] = isVideoRecvEnabled(media);
        }
        var iceRestart = callbacks.iceRestart === true ? true : false;
        if (iceRestart) {
            mediaConstraints["iceRestart"] = true;
        }
        logger.debug(mediaConstraints);
        // Check if this is Firefox and we've been asked to do simulcasting
        var sendVideo = isVideoSendEnabled(media);
        if (sendVideo && simulcast && WebRtcPeer.webRTCAdapter.browserDetails.browser === "firefox") {
            // FIXME Based on https://gist.github.com/voluntas/088bc3cc62094730647b
            logger.log("Enabling Simulcasting for Firefox (RID)");
            var sender = config.peerConnection.getSenders().find(function (s) {
                return s.track.kind == "video"
            });
            if (sender) {
                var parameters = sender.getParameters();
                if (!parameters)
                    parameters = {};


                const maxBitrates = getMaxBitrates(callbacks.simulcastMaxBitrates);
                parameters.encodings = [
                    {rid: "h", active: true, maxBitrate: maxBitrates.high},
                    {rid: "m", active: true, maxBitrate: maxBitrates.medium, scaleResolutionDownBy: 2},
                    {rid: "l", active: true, maxBitrate: maxBitrates.low, scaleResolutionDownBy: 4}
                ];
                sender.setParameters(parameters);
            }
        }
        config.peerConnection.createOffer(mediaConstraints)
            .then(function (offer) {
                logger.debug(offer);
                // JSON.stringify doesn't work on some WebRTC objects anymore
                // See https://code.google.com/p/chromium/issues/detail?id=467366
                var jsep = {
                    "type": offer.type,
                    "sdp": offer.sdp
                };
                callbacks.customizeSdp(jsep);
                offer.sdp = jsep.sdp;
                logger.log("Setting local description");
                if (sendVideo && simulcast) {
                    // This SDP munging only works with Chrome (Safari STP may support it too)
                    if (WebRtcPeer.webRTCAdapter.browserDetails.browser === "chrome" ||
                        WebRtcPeer.webRTCAdapter.browserDetails.browser === "safari") {
                        logger.log("Enabling Simulcasting for Chrome (SDP munging)");
                        offer.sdp = mungeSdpForSimulcasting(offer.sdp);
                    } else if (WebRtcPeer.webRTCAdapter.browserDetails.browser !== "firefox") {
                        logger.warn("simulcast=true, but this is not Chrome nor Firefox, ignoring");
                    }
                }
                config.localSdp = offer.sdp;
                config.peerConnection.setLocalDescription(offer)
                    .catch(callbacks.error);
                config.mediaConstraints = mediaConstraints;
                if (!config.iceDone && !config.trickle) {
                    // Don't do anything until we have all candidates
                    logger.log("Waiting for all candidates...");
                    return;
                }
                logger.log("Offer ready");
                logger.debug(callbacks);
                callbacks.success(offer);
            }, callbacks.error);
    }

    function createAnswer(media, callbacks) {
        callbacks = callbacks || {};
        callbacks.success = (typeof callbacks.success == "function") ? callbacks.success : WebRtcPeer.noop;
        callbacks.error = (typeof callbacks.error == "function") ? callbacks.error : WebRtcPeer.noop;
        callbacks.customizeSdp = (typeof callbacks.customizeSdp == "function") ? callbacks.customizeSdp : WebRtcPeer.noop;
        var simulcast = callbacks.simulcast === true ? true : false;
        if (!simulcast) {
            logger.log("Creating answer (iceDone=" + config.iceDone + ")");
        } else {
            logger.log("Creating answer (iceDone=" + config.iceDone + ", simulcast=" + simulcast + ")");
        }
        var mediaConstraints = null;
        if (WebRtcPeer.unifiedPlan) {
            // We can use Transceivers
            mediaConstraints = {};
            var audioTransceiver = null, videoTransceiver = null;
            var transceivers = config.peerConnection.getTransceivers();
            if (transceivers && transceivers.length > 0) {
                for (var i in transceivers) {
                    var t = transceivers[i];
                    if ((t.sender && t.sender.track && t.sender.track.kind === "audio") ||
                        (t.receiver && t.receiver.track && t.receiver.track.kind === "audio")) {
                        if (!audioTransceiver)
                            audioTransceiver = t;
                        continue;
                    }
                    if ((t.sender && t.sender.track && t.sender.track.kind === "video") ||
                        (t.receiver && t.receiver.track && t.receiver.track.kind === "video")) {
                        if (!videoTransceiver)
                            videoTransceiver = t;
                        continue;
                    }
                }
            }
            // Handle audio (and related changes, if any)
            var audioSend = isAudioSendEnabled(media);
            var audioRecv = isAudioRecvEnabled(media);
            if (!audioSend && !audioRecv) {
                // Audio disabled: have we removed it?
                if (media.removeAudio && audioTransceiver) {
                    try {
                        if (audioTransceiver.setDirection) {
                            audioTransceiver.setDirection("inactive");
                        } else {
                            audioTransceiver.direction = "inactive";
                        }
                        logger.log("Setting audio transceiver to inactive:", audioTransceiver);
                    } catch (e) {
                        logger.error(e);
                    }
                }
            } else {
                // Take care of audio m-line
                if (audioSend && audioRecv) {
                    if (audioTransceiver) {
                        try {
                            if (audioTransceiver.setDirection) {
                                audioTransceiver.setDirection("sendrecv");
                            } else {
                                audioTransceiver.direction = "sendrecv";
                            }
                            logger.log("Setting audio transceiver to sendrecv:", audioTransceiver);
                        } catch (e) {
                            logger.error(e);
                        }
                    }
                } else if (audioSend && !audioRecv) {
                    try {
                        if (audioTransceiver) {
                            if (audioTransceiver.setDirection) {
                                audioTransceiver.setDirection("sendonly");
                            } else {
                                audioTransceiver.direction = "sendonly";
                            }
                            logger.log("Setting audio transceiver to sendonly:", audioTransceiver);
                        }
                    } catch (e) {
                        logger.error(e);
                    }
                } else if (!audioSend && audioRecv) {
                    if (audioTransceiver) {
                        try {
                            if (audioTransceiver.setDirection) {
                                audioTransceiver.setDirection("recvonly");
                            } else {
                                audioTransceiver.direction = "recvonly";
                            }
                            logger.log("Setting audio transceiver to recvonly:", audioTransceiver);
                        } catch (e) {
                            logger.error(e);
                        }
                    } else {
                        // In theory, this is the only case where we might not have a transceiver yet
                        audioTransceiver = config.peerConnection.addTransceiver("audio", {direction: "recvonly"});
                        logger.log("Adding recvonly audio transceiver:", audioTransceiver);
                    }
                }
            }
            // Handle video (and related changes, if any)
            var videoSend = isVideoSendEnabled(media);
            var videoRecv = isVideoRecvEnabled(media);
            if (!videoSend && !videoRecv) {
                // Video disabled: have we removed it?
                if (media.removeVideo && videoTransceiver) {
                    try {
                        if (videoTransceiver.setDirection) {
                            videoTransceiver.setDirection("inactive");
                        } else {
                            videoTransceiver.direction = "inactive";
                        }
                        logger.log("Setting video transceiver to inactive:", videoTransceiver);
                    } catch (e) {
                        logger.error(e);
                    }
                }
            } else {
                // Take care of video m-line
                if (videoSend && videoRecv) {
                    if (videoTransceiver) {
                        try {
                            if (videoTransceiver.setDirection) {
                                videoTransceiver.setDirection("sendrecv");
                            } else {
                                videoTransceiver.direction = "sendrecv";
                            }
                            logger.log("Setting video transceiver to sendrecv:", videoTransceiver);
                        } catch (e) {
                            logger.error(e);
                        }
                    }
                } else if (videoSend && !videoRecv) {
                    if (videoTransceiver) {
                        try {
                            if (videoTransceiver.setDirection) {
                                videoTransceiver.setDirection("sendonly");
                            } else {
                                videoTransceiver.direction = "sendonly";
                            }
                            logger.log("Setting video transceiver to sendonly:", videoTransceiver);
                        } catch (e) {
                            logger.error(e);
                        }
                    }
                } else if (!videoSend && videoRecv) {
                    if (videoTransceiver) {
                        try {
                            if (videoTransceiver.setDirection) {
                                videoTransceiver.setDirection("recvonly");
                            } else {
                                videoTransceiver.direction = "recvonly";
                            }
                            logger.log("Setting video transceiver to recvonly:", videoTransceiver);
                        } catch (e) {
                            logger.error(e);
                        }
                    } else {
                        // In theory, this is the only case where we might not have a transceiver yet
                        videoTransceiver = config.peerConnection.addTransceiver("video", {direction: "recvonly"});
                        logger.log("Adding recvonly video transceiver:", videoTransceiver);
                    }
                }
            }
        } else {
            if (WebRtcPeer.webRTCAdapter.browserDetails.browser === "firefox" ||
                WebRtcPeer.webRTCAdapter.browserDetails.browser === "edge") {
                mediaConstraints = {
                    offerToReceiveAudio: isAudioRecvEnabled(media),
                    offerToReceiveVideo: isVideoRecvEnabled(media)
                };
            } else {
                mediaConstraints = {
                    mandatory: {
                        OfferToReceiveAudio: isAudioRecvEnabled(media),
                        OfferToReceiveVideo: isVideoRecvEnabled(media)
                    }
                };
            }
        }
        logger.debug(mediaConstraints);
        // Check if this is Firefox and we've been asked to do simulcasting
        var sendVideo = isVideoSendEnabled(media);
        if (sendVideo && simulcast && WebRtcPeer.webRTCAdapter.browserDetails.browser === "firefox") {
            // FIXME Based on https://gist.github.com/voluntas/088bc3cc62094730647b
            logger.log("Enabling Simulcasting for Firefox (RID)");
            var sender = config.peerConnection.getSenders()[1];
            logger.log(sender);
            var parameters = sender.getParameters();
            logger.log(parameters);

            const maxBitrates = getMaxBitrates(callbacks.simulcastMaxBitrates);
            sender.setParameters({
                encodings: [
                    {rid: "high", active: true, priority: "high", maxBitrate: maxBitrates.high},
                    {rid: "medium", active: true, priority: "medium", maxBitrate: maxBitrates.medium},
                    {rid: "low", active: true, priority: "low", maxBitrate: maxBitrates.low}
                ]
            });
        }
        config.peerConnection.createAnswer(mediaConstraints)
            .then(function (answer) {
                logger.debug(answer);
                // JSON.stringify doesn't work on some WebRTC objects anymore
                // See https://code.google.com/p/chromium/issues/detail?id=467366
                var jsep = {
                    "type": answer.type,
                    "sdp": answer.sdp
                };
                callbacks.customizeSdp(jsep);
                answer.sdp = jsep.sdp;
                logger.log("Setting local description");
                if (sendVideo && simulcast) {
                    // This SDP munging only works with Chrome
                    if (WebRtcPeer.webRTCAdapter.browserDetails.browser === "chrome") {
                        // FIXME Apparently trying to simulcast when answering breaks video in Chrome...
                        //~ RemoteCloud.log("Enabling Simulcasting for Chrome (SDP munging)");
                        //~ answer.sdp = mungeSdpForSimulcasting(answer.sdp);
                        logger.warn("simulcast=true, but this is an answer, and video breaks in Chrome if we enable it");
                    } else if (WebRtcPeer.webRTCAdapter.browserDetails.browser !== "firefox") {
                        logger.warn("simulcast=true, but this is not Chrome nor Firefox, ignoring");
                    }
                }
                config.localSdp = answer.sdp;
                //modify by jeffrey
                config.peerConnection.setLocalDescription(answer).then(() => {
                    if (config.candidates && config.candidates.length > 0) {
                        for (var i = 0; i < config.candidates.length; i++) {
                            var candidate = config.candidates[i];
                            logger.debug("Adding remote candidate:", candidate);
                            if (!candidate || candidate.completed === true) {
                                // end-of-candidates
                                config.peerConnection.addIceCandidate(WebRtcPeer.endOfCandidates).then(() => {
                                    // Do stuff when the candidate is successfully passed to the ICE agent
                                    logger.log("@@Adding remote candidate " + candidate + "success");
                                }).catch(e => {
                                    logger.error("@@Error: Failure during addIceCandidate()");
                                });
                            } else {
                                // New candidate
                                config.peerConnection.addIceCandidate(candidate).then(() => {
                                    // Do stuff when the candidate is successfully passed to the ICE agent
                                    logger.log("@@Adding remote candidate " + candidate + "success");
                                }).catch(e => {
                                    logger.error("@@Error: Failure during addIceCandidate()");
                                });
                            }
                        }
                        config.candidates = [];
                    }
                }).catch(callbacks.error);
                config.mediaConstraints = mediaConstraints;
                if (!config.iceDone && !config.trickle) {
                    // Don't do anything until we have all candidates
                    logger.log("Waiting for all candidates...");
                    return;
                }
                callbacks.success(answer);
            }, callbacks.error);
    }

    function sendSDP(callbacks) {
        callbacks = callbacks || {};
        callbacks.success = (typeof callbacks.success == "function") ? callbacks.success : WebRtcPeer.noop;
        callbacks.error = (typeof callbacks.error == "function") ? callbacks.error : WebRtcPeer.noop;
        logger.log("Sending offer/answer SDP...");
        if (config.localSdp === null || config.localSdp === undefined) {
            logger.warn("Local SDP instance is invalid, not sending anything...");
            return;
        }
        config.localSdp = {
            "type": config.peerConnection.localDescription.type,
            "sdp": config.peerConnection.localDescription.sdp
        };
        if (config.trickle === false)
            config.localSdp["trickle"] = false;
        logger.debug(callbacks);
        config.sdpSent = true;
        callbacks.success(config.localSdp);
    }

    this.prepareWebrtc = function (offer, callbacks) {
        callbacks = callbacks || {};
        callbacks.success = (typeof callbacks.success == "function") ? callbacks.success : WebRtcPeer.noop;
        callbacks.error = (typeof callbacks.error == "function") ? callbacks.error : webrtcError;
        var jsep = callbacks.jsep;
        if (offer && jsep) {
            logger.error("Provided a JSEP to a createOffer");
            callbacks.error("Provided a JSEP to a createOffer");
            return;
        } else if (!offer && (!jsep || !jsep.type || !jsep.sdp)) {
            logger.error("A valid JSEP is required for createAnswer");
            callbacks.error("A valid JSEP is required for createAnswer");
            return;
        }
        callbacks.media = callbacks.media || {audio: true, video: true};
        var media = callbacks.media;

        config.trickle = isTrickleEnabled(callbacks.trickle);
        // Are we updating a session?
        if (config.peerConnection === undefined || config.peerConnection === null) {
            // Nope, new PeerConnection
            media.update = false;
            media.keepAudio = false;
            media.keepVideo = false;
        } else if (config.peerConnection !== undefined && config.peerConnection !== null) {
            logger.log("Updating existing media session");
            media.update = true;
            // Check if there's anything to add/remove/replace, or if we
            // can go directly to preparing the new SDP offer or answer
            if (callbacks.stream !== null && callbacks.stream !== undefined) {
                // External stream: is this the same as the one we were using before?
                if (callbacks.stream !== config.localStream) {
                    logger.log("Renegotiation involves a new external stream");
                }
            } else {
                // Check if there are changes on audio
                if (media.addAudio) {
                    media.keepAudio = false;
                    media.replaceAudio = false;
                    media.removeAudio = false;
                    media.audioSend = true;
                    if (config.localStream && config.localStream.getAudioTracks() && config.localStream.getAudioTracks().length) {
                        logger.error("Can't add audio stream, there already is one");
                        callbacks.error("Can't add audio stream, there already is one");
                        return;
                    }
                } else if (media.removeAudio) {
                    media.keepAudio = false;
                    media.replaceAudio = false;
                    media.addAudio = false;
                    media.audioSend = false;
                } else if (media.replaceAudio) {
                    media.keepAudio = false;
                    media.addAudio = false;
                    media.removeAudio = false;
                    media.audioSend = true;
                }
                if (config.localStream === null || config.localStream === undefined) {
                    // No media stream: if we were asked to replace, it's actually an "add"
                    if (media.replaceAudio) {
                        media.keepAudio = false;
                        media.replaceAudio = false;
                        media.addAudio = true;
                        media.audioSend = true;
                    }
                    if (isAudioSendEnabled(media)) {
                        media.keepAudio = false;
                        media.addAudio = true;
                    }
                } else {
                    if (config.localStream.getAudioTracks() === null
                        || config.localStream.getAudioTracks() === undefined
                        || config.localStream.getAudioTracks().length === 0) {
                        // No audio track: if we were asked to replace, it's actually an "add"
                        if (media.replaceAudio) {
                            media.keepAudio = false;
                            media.replaceAudio = false;
                            media.addAudio = true;
                            media.audioSend = true;
                        }
                        if (isAudioSendEnabled(media)) {
                            media.keepVideo = false;
                            media.addAudio = true;
                        }
                    } else {
                        // We have an audio track: should we keep it as it is?
                        if (isAudioSendEnabled(media) &&
                            !media.removeAudio && !media.replaceAudio) {
                            media.keepAudio = true;
                        }
                    }
                }
                // Check if there are changes on video
                if (media.addVideo) {
                    media.keepVideo = false;
                    media.replaceVideo = false;
                    media.removeVideo = false;
                    media.videoSend = true;
                    if (config.localStream && config.localStream.getVideoTracks() && config.localStream.getVideoTracks().length) {
                        logger.error("Can't add video stream, there already is one");
                        callbacks.error("Can't add video stream, there already is one");
                        return;
                    }
                } else if (media.removeVideo) {
                    media.keepVideo = false;
                    media.replaceVideo = false;
                    media.addVideo = false;
                    media.videoSend = false;
                } else if (media.replaceVideo) {
                    media.keepVideo = false;
                    media.addVideo = false;
                    media.removeVideo = false;
                    media.videoSend = true;
                }
                if (config.localStream === null || config.localStream === undefined) {
                    // No media stream: if we were asked to replace, it's actually an "add"
                    if (media.replaceVideo) {
                        media.keepVideo = false;
                        media.replaceVideo = false;
                        media.addVideo = true;
                        media.videoSend = true;
                    }
                    if (isVideoSendEnabled(media)) {
                        media.keepVideo = false;
                        media.addVideo = true;
                    }
                } else {
                    if (config.localStream.getVideoTracks() === null
                        || config.localStream.getVideoTracks() === undefined
                        || config.localStream.getVideoTracks().length === 0) {
                        // No video track: if we were asked to replace, it's actually an "add"
                        if (media.replaceVideo) {
                            media.keepVideo = false;
                            media.replaceVideo = false;
                            media.addVideo = true;
                            media.videoSend = true;
                        }
                        if (isVideoSendEnabled(media)) {
                            media.keepVideo = false;
                            media.addVideo = true;
                        }
                    } else {
                        // We have a video track: should we keep it as it is?
                        if (isVideoSendEnabled(media) &&
                            !media.removeVideo && !media.replaceVideo) {
                            media.keepVideo = true;
                        }
                    }
                }
                // Data channels can only be added
                if (media.addData)
                    media.data = true;
            }
            // If we're updating and keeping all tracks, let's skip the getUserMedia part
            if ((isAudioSendEnabled(media) && media.keepAudio) &&
                (isVideoSendEnabled(media) && media.keepVideo)) {
                options.consentDialog(false);
                streamsDone(jsep, media, callbacks, config.localStream);
                return;
            }
        }

        // If we're updating, check if we need to remove/replace one of the tracks
        if (media.update && !config.streamExternal) {
            if (media.removeAudio || media.replaceAudio) {
                if (config.localStream && config.localStream.getAudioTracks() && config.localStream.getAudioTracks().length) {
                    var s = config.localStream.getAudioTracks()[0];
                    logger.log("Removing audio track:", s);
                    config.localStream.removeTrack(s);
                    try {
                        s.stop();
                    } catch (e) {
                    }
                }
                if (config.peerConnection.getSenders() && config.peerConnection.getSenders().length) {
                    var ra = true;
                    if (media.replaceAudio && WebRtcPeer.unifiedPlan) {
                        // We can use replaceTrack
                        ra = false;
                    }
                    if (ra) {
                        for (var index in config.peerConnection.getSenders()) {
                            var s = config.peerConnection.getSenders()[index];
                            if (s && s.track && s.track.kind === "audio") {
                                logger.log("Removing audio sender:", s);
                                config.peerConnection.removeTrack(s);
                            }
                        }
                    }
                }
            }
            if (media.removeVideo || media.replaceVideo) {
                if (config.localStream && config.localStream.getVideoTracks() && config.localStream.getVideoTracks().length) {
                    var s = config.localStream.getVideoTracks()[0];
                    logger.log("Removing video track:", s);
                    config.localStream.removeTrack(s);
                    try {
                        s.stop();
                    } catch (e) {
                    }
                }
                if (config.peerConnection.getSenders() && config.peerConnection.getSenders().length) {
                    var rv = true;
                    if (media.replaceVideo && WebRtcPeer.unifiedPlan) {
                        // We can use replaceTrack
                        rv = false;
                    }
                    if (rv) {
                        for (var index in config.peerConnection.getSenders()) {
                            var s = config.peerConnection.getSenders()[index];
                            if (s && s.track && s.track.kind === "video") {
                                logger.log("Removing video sender:", s);
                                config.peerConnection.removeTrack(s);
                            }
                        }
                    }
                }
            }
        }
        // Was a MediaStream object passed, or do we need to take care of that?
        if (callbacks.stream !== null && callbacks.stream !== undefined) {
            var stream = callbacks.stream;
            logger.log("MediaStream provided by the application");
            logger.debug(stream);
            // If this is an update, let's check if we need to release the previous stream
            if (media.update) {
                if (config.localStream && config.localStream !== callbacks.stream && !config.streamExternal) {
                    // We're replacing a stream we captured ourselves with an external one
                    try {
                        // Try a MediaStreamTrack.stop() for each track
                        var tracks = config.localStream.getTracks();
                        for (var i in tracks) {
                            var mst = tracks[i];
                            logger.log(mst);
                            if (mst !== null && mst !== undefined)
                                mst.stop();
                        }
                    } catch (e) {
                        // Do nothing if this fails
                    }
                    config.localStream = null;
                }
            }
            // Skip the getUserMedia part
            config.streamExternal = true;
            options.consentDialog(false);
            streamsDone(jsep, media, callbacks, stream);
            return;
        }
        if (isAudioSendEnabled(media) || isVideoSendEnabled(media)) {
            if (!WebRtcPeer.isGetUserMediaAvailable()) {
                callbacks.error("getUserMedia not available");
                return;
            }
            var constraints = {mandatory: {}, optional: []};
            options.consentDialog(true);
            var audioSupport = isAudioSendEnabled(media);
            if (audioSupport === true && media != undefined && media != null) {
                if (typeof media.audio === 'object') {
                    audioSupport = media.audio;
                }
            }
            var videoSupport = isVideoSendEnabled(media);
            if (videoSupport === true && media != undefined && media != null) {
                var simulcast = callbacks.simulcast === true;
                var simulcast2 = callbacks.simulcast2 === true;
                if ((simulcast || simulcast2) && !jsep && (media.video === undefined || media.video === false))
                    media.video = "hires";
                if (media.video && media.video != 'screen' && media.video != 'window') {
                    if (typeof media.video === 'object') {
                        videoSupport = media.video;
                    } else {
                        var width = 0;
                        var height = 0, maxHeight = 0;
                        if (media.video === 'lowres') {
                            // Small resolution, 4:3
                            height = 240;
                            maxHeight = 240;
                            width = 320;
                        } else if (media.video === 'lowres-16:9') {
                            // Small resolution, 16:9
                            height = 180;
                            maxHeight = 180;
                            width = 320;
                        } else if (media.video === 'hires' || media.video === 'hires-16:9' || media.video === 'hdres') {
                            // High(HD) resolution is only 16:9
                            height = 720;
                            maxHeight = 720;
                            width = 1280;
                        } else if (media.video === 'fhdres') {
                            // Full HD resolution is only 16:9
                            height = 1080;
                            maxHeight = 1080;
                            width = 1920;
                        } else if (media.video === '4kres') {
                            // 4K resolution is only 16:9
                            height = 2160;
                            maxHeight = 2160;
                            width = 3840;
                        } else if (media.video === 'stdres') {
                            // Normal resolution, 4:3
                            height = 480;
                            maxHeight = 480;
                            width = 640;
                        } else if (media.video === 'stdres-16:9') {
                            // Normal resolution, 16:9
                            height = 360;
                            maxHeight = 360;
                            width = 640;
                        } else {
                            logger.log("Default video setting is stdres 4:3");
                            height = 480;
                            maxHeight = 480;
                            width = 640;
                        }
                        logger.log("Adding media constraint:", media.video);
                        videoSupport = {
                            'height': {'ideal': height},
                            'width': {'ideal': width}
                        };
                        logger.log("Adding video constraint:", videoSupport);
                    }
                } else if (media.video === 'screen' || media.video === 'window') {
                    if (!media.screenshareFrameRate) {
                        media.screenshareFrameRate = 3;
                    }
                    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
                        // The new experimental getDisplayMedia API is available, let's use that
                        // https://groups.google.com/forum/#!topic/discuss-webrtc/Uf0SrR4uxzk
                        // https://webrtchacks.com/chrome-screensharing-getdisplaymedia/
                        navigator.mediaDevices.getDisplayMedia({video: true})
                            .then(function (stream) {
                                options.consentDialog(false);
                                if (isAudioSendEnabled(media) && !media.keepAudio) {
                                    navigator.mediaDevices.getUserMedia({audio: true, video: false})
                                        .then(function (audioStream) {
                                            stream.addTrack(audioStream.getAudioTracks()[0]);
                                            streamsDone(jsep, media, callbacks, stream);
                                        })
                                } else {
                                    streamsDone(jsep, media, callbacks, stream);
                                }
                            }, function (error) {
                                options.consentDialog(false);
                                callbacks.error(error);
                            });
                        return;
                    }
                    // We're going to try and use the extension for Chrome 34+, the old approach
                    // for older versions of Chrome, or the experimental support in Firefox 33+
                    function callbackUserMedia(error, stream) {
                        options.consentDialog(false);
                        if (error) {
                            callbacks.error(error);
                        } else {
                            streamsDone(jsep, media, callbacks, stream);
                        }
                    };

                    function getScreenMedia(constraints, gsmCallback, useAudio) {
                        logger.log("Adding media constraint (screen capture)");
                        logger.debug(constraints);
                        navigator.mediaDevices.getUserMedia(constraints)
                            .then(function (stream) {
                                if (useAudio) {
                                    navigator.mediaDevices.getUserMedia({audio: true, video: false})
                                        .then(function (audioStream) {
                                            stream.addTrack(audioStream.getAudioTracks()[0]);
                                            gsmCallback(null, stream);
                                        })
                                } else {
                                    gsmCallback(null, stream);
                                }
                            })
                            .catch(function (error) {
                                options.consentDialog(false);
                                gsmCallback(error);
                            });
                    };
                    if (WebRtcPeer.webRTCAdapter.browserDetails.browser === 'chrome') {
                        var chromever = WebRtcPeer.webRTCAdapter.browserDetails.version;
                        var maxver = 33;
                        if (window.navigator.userAgent.match('Linux'))
                            maxver = 35;	// "known" crash in chrome 34 and 35 on linux
                        if (chromever >= 26 && chromever <= maxver) {
                            // Chrome 26->33 requires some awkward chrome://flags manipulation
                            constraints = {
                                video: {
                                    mandatory: {
                                        googLeakyBucket: true,
                                        maxWidth: window.screen.width,
                                        maxHeight: window.screen.height,
                                        minFrameRate: media.screenshareFrameRate,
                                        maxFrameRate: media.screenshareFrameRate,
                                        chromeMediaSource: 'screen'
                                    }
                                },
                                audio: isAudioSendEnabled(media) && !media.keepAudio
                            };
                            getScreenMedia(constraints, callbackUserMedia);
                        } else {
                            // Chrome 34+ requires an extension
                            WebRtcPeer.extension.getScreen(function (error, sourceId) {
                                if (error) {
                                    options.consentDialog(false);
                                    return callbacks.error(error);
                                }
                                constraints = {
                                    audio: false,
                                    video: {
                                        mandatory: {
                                            chromeMediaSource: 'desktop',
                                            maxWidth: window.screen.width,
                                            maxHeight: window.screen.height,
                                            minFrameRate: media.screenshareFrameRate,
                                            maxFrameRate: media.screenshareFrameRate,
                                        },
                                        optional: [
                                            {googLeakyBucket: true},
                                            {googTemporalLayeredScreencast: true}
                                        ]
                                    }
                                };
                                constraints.video.mandatory.chromeMediaSourceId = sourceId;
                                getScreenMedia(constraints, callbackUserMedia,
                                    isAudioSendEnabled(media) && !media.keepAudio);
                            });
                        }
                    } else if (WebRtcPeer.webRTCAdapter.browserDetails.browser === 'firefox') {
                        if (WebRtcPeer.webRTCAdapter.browserDetails.version >= 33) {
                            // Firefox 33+ has experimental support for screen sharing
                            constraints = {
                                video: {
                                    mozMediaSource: media.video,
                                    mediaSource: media.video
                                },
                                audio: isAudioSendEnabled(media) && !media.keepAudio
                            };
                            getScreenMedia(constraints, function (err, stream) {
                                callbackUserMedia(err, stream);
                                // Workaround for https://bugzilla.mozilla.org/show_bug.cgi?id=1045810
                                if (!err) {
                                    var lastTime = stream.currentTime;
                                    var polly = window.setInterval(function () {
                                        if (!stream)
                                            window.clearInterval(polly);
                                        if (stream.currentTime == lastTime) {
                                            window.clearInterval(polly);
                                            if (stream.onended) {
                                                stream.onended();
                                            }
                                        }
                                        lastTime = stream.currentTime;
                                    }, 500);
                                }
                            });
                        } else {
                            var error = new Error('NavigatorUserMediaError');
                            error.name = 'Your version of Firefox does not support screen sharing, please install Firefox 33 (or more recent versions)';
                            options.consentDialog(false);
                            callbacks.error(error);
                            return;
                        }
                    }
                    return;
                }
            }
            // If we got here, we're not screensharing
            if (media === null || media === undefined || media.video !== 'screen') {
                // Check whether all media sources are actually available or not
                navigator.mediaDevices.enumerateDevices().then(function (devices) {
                    var audioExist = devices.some(function (device) {
                            return device.kind === 'audioinput';
                        }),
                        videoExist = isScreenSendEnabled(media) || devices.some(function (device) {
                            return device.kind === 'videoinput';
                        });

                    // Check whether a missing device is really a problem
                    var audioSend = isAudioSendEnabled(media);
                    var videoSend = isVideoSendEnabled(media);
                    var needAudioDevice = isAudioSendRequired(media);
                    var needVideoDevice = isVideoSendRequired(media);
                    if (audioSend || videoSend || needAudioDevice || needVideoDevice) {
                        // We need to send either audio or video
                        var haveAudioDevice = audioSend ? audioExist : false;
                        var haveVideoDevice = videoSend ? videoExist : false;
                        if (!haveAudioDevice && !haveVideoDevice) {
                            // FIXME Should we really give up, or just assume recvonly for both?
                            options.consentDialog(false);
                            callbacks.error('No capture device found');
                            return false;
                        } else if (!haveAudioDevice && needAudioDevice) {
                            options.consentDialog(false);
                            callbacks.error('Audio capture is required, but no capture device found');
                            return false;
                        } else if (!haveVideoDevice && needVideoDevice) {
                            options.consentDialog(false);
                            callbacks.error('Video capture is required, but no capture device found');
                            return false;
                        }
                    }

                    var gumConstraints = {
                        audio: (audioExist && !media.keepAudio) ? audioSupport : false,
                        video: (videoExist && !media.keepVideo) ? videoSupport : false
                    };
                    logger.debug("getUserMedia constraints", gumConstraints);
                    if (!gumConstraints.audio && !gumConstraints.video) {
                        options.consentDialog(false);
                        streamsDone(jsep, media, callbacks, stream);
                    } else {
                        navigator.mediaDevices.getUserMedia(gumConstraints)
                            .then(function (stream) {
                                options.consentDialog(false);
                                streamsDone(jsep, media, callbacks, stream);
                            }).catch(function (error) {
                            options.consentDialog(false);
                            callbacks.error({code: error.code, name: error.name, message: error.message});
                        });
                    }
                }).catch(function (error) {
                    options.consentDialog(false);
                    callbacks.error('enumerateDevices error', error);
                });
            }
        } else {
            // No need to do a getUserMedia, create offer/answer right away
            streamsDone(jsep, media, callbacks);
        }
    };

    this.prepareWebrtcPeer = function (callbacks) {
        callbacks = callbacks || {};
        callbacks.success = (typeof callbacks.success == "function") ? callbacks.success : WebRtcPeer.noop;
        callbacks.error = (typeof callbacks.error == "function") ? callbacks.error : webrtcError;
        var jsep = callbacks.jsep;
        if (jsep !== undefined && jsep !== null) {
            if (config.peerConnection === null) {
                logger.warn("Wait, no PeerConnection?? if this is an answer, use createAnswer and not handleRemoteJsep");
                callbacks.error("No PeerConnection: if this is an answer, use createAnswer and not handleRemoteJsep");
                return;
            }
            config.peerConnection.setRemoteDescription(jsep)
                .then(function () {
                    logger.log("Remote description accepted!");
                    config.remoteSdp = jsep.sdp;
                    // Any trickle candidate we cached?
                    if (config.candidates && config.candidates.length > 0) {
                        for (var i = 0; i < config.candidates.length; i++) {
                            var candidate = config.candidates[i];
                            logger.debug("Adding remote candidate:", candidate);
                            if (!candidate || candidate.completed === true) {
                                // end-of-candidates
                                config.peerConnection.addIceCandidate(WebRtcPeer.endOfCandidates).then(() => {
                                    // Do stuff when the candidate is successfully passed to the ICE agent
                                    logger.log("@@@Adding remote candidate " + candidate + "success");
                                }).catch(e => {
                                    logger.error("@@@Error: Failure during addIceCandidate()");
                                });
                            } else {
                                // New candidate
                                config.peerConnection.addIceCandidate(candidate).then(() => {
                                    // Do stuff when the candidate is successfully passed to the ICE agent
                                    logger.log("@@@Adding remote candidate " + candidate + "success");
                                }).catch(e => {
                                    logger.error("@@@Error: Failure during addIceCandidate()");
                                });
                            }
                        }
                        config.candidates = [];
                    }
                    // Done
                    callbacks.success();
                }, callbacks.error);
        } else {
            callbacks.error("Invalid JSEP");
        }
    };

    // Private method to send a DTMF tone
    this.sendDtmf = function (callbacks) {
        callbacks = callbacks || {};
        callbacks.success = (typeof callbacks.success == "function") ? callbacks.success : WebRtcPeer.noop;
        callbacks.error = (typeof callbacks.error == "function") ? callbacks.error : WebRtcPeer.noop;
        if (config.dtmfSender === null || config.dtmfSender === undefined) {
            // Create the DTMF sender the proper way, if possible
            if (config.peerConnection !== undefined && config.peerConnection !== null) {
                var senders = config.peerConnection.getSenders();
                var audioSender = senders.find(function (sender) {
                    return sender.track && sender.track.kind === 'audio';
                });
                if (!audioSender) {
                    logger.warn("Invalid DTMF configuration (no audio track)");
                    callbacks.error("Invalid DTMF configuration (no audio track)");
                    return;
                }
                config.dtmfSender = audioSender.dtmf;
                if (config.dtmfSender) {
                    logger.log("Created DTMF Sender");
                    config.dtmfSender.ontonechange = function (tone) {
                        logger.debug("Sent DTMF tone: " + tone.tone);
                    };
                }
            }
            if (config.dtmfSender === null || config.dtmfSender === undefined) {
                logger.warn("Invalid DTMF configuration");
                callbacks.error("Invalid DTMF configuration");
                return;
            }
        }
        var dtmf = callbacks.dtmf;
        if (dtmf === null || dtmf === undefined) {
            logger.warn("Invalid DTMF parameters");
            callbacks.error("Invalid DTMF parameters");
            return;
        }
        var tones = dtmf.tones;
        if (tones === null || tones === undefined) {
            logger.warn("Invalid DTMF string");
            callbacks.error("Invalid DTMF string");
            return;
        }
        var duration = dtmf.duration;
        if (duration === null || duration === undefined)
            duration = 500;	// We choose 500ms as the default duration for a tone
        var gap = dtmf.gap;
        if (gap === null || gap === undefined)
            gap = 50;	// We choose 50ms as the default gap between tones
        logger.debug("Sending DTMF string " + tones + " (duration " + duration + "ms, gap " + gap + "ms)");
        config.dtmfSender.insertDTMF(tones, duration, gap);
        callbacks.success();
    };

    // Private method to send a data channel message
    this.sendData = function (callbacks) {
        callbacks = callbacks || {};
        callbacks.success = (typeof callbacks.success == "function") ? callbacks.success : WebRtcPeer.noop;
        callbacks.error = (typeof callbacks.error == "function") ? callbacks.error : WebRtcPeer.noop;
        var text = callbacks.text;
        if (text === null || text === undefined) {
            logger.warn("Invalid text");
            callbacks.error("Invalid text");
            return;
        }
        var label = callbacks.label ? callbacks.label : WebRtcPeer.dataChanDefaultLabel;
        if (!config.dataChannel[label]) {
            // Create new data channel and wait for it to open
            createDataChannel(label, false, text);
            callbacks.success();
            return;
        }
        if (config.dataChannel[label].readyState !== "open") {
            config.dataChannel[label].pending.push(text);
            callbacks.success();
            return;
        }
        logger.log("Sending string on data channel <" + label + ">: " + text);
        config.dataChannel[label].send(text);
        callbacks.success();
    };

    this.getIceState = function () {

        if (config.peerConnection === undefined
            || config.peerConnection === null) return "unknow";
        return config.peerConnection.iceConnectionState;
    };

    this.getVolume = function (remote) {
        var stream = remote ? "remote" : "local";
        if (!config.volume[stream])
            config.volume[stream] = {value: 0};
        // Start getting the volume, if getStats is supported
        if (config.peerConnection.getStats && WebRtcPeer.webRTCAdapter.browserDetails.browser === "chrome") {
            if (remote && (config.remoteStream === null || config.remoteStream === undefined)) {
                logger.warn("Remote stream unavailable");
                return 0;
            } else if (!remote && (config.localStream === null || config.localStream === undefined)) {
                logger.warn("Local stream unavailable");
                return 0;
            }
            if (config.volume[stream].timer === null || config.volume[stream].timer === undefined) {
                logger.log("Starting " + stream + " volume monitor");
                config.volume[stream].timer = setInterval(function () {
                    config.peerConnection.getStats(function (stats) {
                        var results = stats.result();
                        for (var i = 0; i < results.length; i++) {
                            var res = results[i];
                            if (res.type == 'ssrc') {
                                if (remote && res.stat('audioOutputLevel'))
                                    config.volume[stream].value = parseInt(res.stat('audioOutputLevel'));
                                else if (!remote && res.stat('audioInputLevel'))
                                    config.volume[stream].value = parseInt(res.stat('audioInputLevel'));
                            }
                        }
                    });
                }, 200);
                return 0;	// We don't have a volume to return yet
            }
            return config.volume[stream].value;
        } else {
            // audioInputLevel and audioOutputLevel seem only available in Chrome? audioLevel
            // seems to be available on Chrome and Firefox, but they don't seem to work
            logger.warn("Getting the " + stream + " volume unsupported by browser");
            return 0;
        }
    };

    this.isMuted = function (video) {
        if (config.peerConnection === null || config.peerConnection === undefined) {
            logger.warn("Invalid PeerConnection");
            return true;
        }
        if (config.localStream === undefined || config.localStream === null) {
            logger.warn("Invalid local MediaStream");
            return true;
        }
        if (video) {
            // Check video track
            if (config.localStream.getVideoTracks() === null
                || config.localStream.getVideoTracks() === undefined
                || config.localStream.getVideoTracks().length === 0) {
                logger.warn("No video track");
                return true;
            }
            return !config.localStream.getVideoTracks()[0].enabled;
        } else {
            // Check audio track
            if (config.localStream.getAudioTracks() === null
                || config.localStream.getAudioTracks() === undefined
                || config.localStream.getAudioTracks().length === 0) {
                logger.warn("No audio track");
                return true;
            }
            return !config.localStream.getAudioTracks()[0].enabled;
        }
    };

    this.mute = function (video, mute) {

        if (config.peerConnection === null || config.peerConnection === undefined) {
            logger.warn("Invalid PeerConnection");
            return false;
        }
        if (config.localStream === undefined || config.localStream === null) {
            logger.warn("Invalid local MediaStream");
            return false;
        }
        if (video) {
            // Mute/unmute video track
            if (config.localStream.getVideoTracks() === null
                || config.localStream.getVideoTracks() === undefined
                || config.localStream.getVideoTracks().length === 0) {
                logger.warn("No video track");
                return false;
            }
            config.localStream.getVideoTracks()[0].enabled = mute ? false : true;
            return true;
        } else {
            // Mute/unmute audio track
            if (config.localStream.getAudioTracks() === null
                || config.localStream.getAudioTracks() === undefined
                || config.localStream.getAudioTracks().length === 0) {
                logger.warn("No audio track");
                return false;
            }
            config.localStream.getAudioTracks()[0].enabled = mute ? false : true;
            return true;
        }
    };

    this.getBitrate = function () {
        if (config.peerConnection === null || config.peerConnection === undefined)
            return "Invalid PeerConnection";
        // Start getting the bitrate, if getStats is supported
        if (config.peerConnection.getStats) {
            if (config.bitrate.timer === null || config.bitrate.timer === undefined) {
                logger.log("Starting bitrate timer (via getStats)");
                config.bitrate.timer = setInterval(function () {
                    config.peerConnection.getStats()
                        .then(function (stats) {
                            stats.forEach(function (res) {
                                if (!res)
                                    return;
                                var inStats = false;
                                // Check if these are statistics on incoming media
                                if ((res.mediaType === "video" || res.id.toLowerCase().indexOf("video") > -1) &&
                                    res.type === "inbound-rtp" && res.id.indexOf("rtcp") < 0) {
                                    // New stats
                                    inStats = true;
                                } else if (res.type == 'ssrc' && res.bytesReceived &&
                                    (res.googCodecName === "VP8" || res.googCodecName === "")) {
                                    // Older Chromer versions
                                    inStats = true;
                                }
                                // Parse stats now
                                if (inStats) {
                                    config.bitrate.bsnow = res.bytesReceived;
                                    config.bitrate.tsnow = res.timestamp;
                                    if (config.bitrate.bsbefore === null || config.bitrate.tsbefore === null) {
                                        // Skip this round
                                        config.bitrate.bsbefore = config.bitrate.bsnow;
                                        config.bitrate.tsbefore = config.bitrate.tsnow;
                                    } else {
                                        // Calculate bitrate
                                        var timePassed = config.bitrate.tsnow - config.bitrate.tsbefore;
                                        if (WebRtcPeer.webRTCAdapter.browserDetails.browser === "safari")
                                            timePassed = timePassed / 1000;	// Apparently the timestamp is in microseconds, in Safari
                                        var bitRate = Math.round((config.bitrate.bsnow - config.bitrate.bsbefore) * 8 / timePassed);
                                        if (WebRtcPeer.webRTCAdapter.browserDetails.browser === 'safari')
                                            bitRate = parseInt(bitRate / 1000);
                                        config.bitrate.value = bitRate + ' kbits/sec';
                                        //~ RemoteCloud.log("Estimated bitrate is " + config.bitrate.value);
                                        config.bitrate.bsbefore = config.bitrate.bsnow;
                                        config.bitrate.tsbefore = config.bitrate.tsnow;
                                    }
                                }
                            });
                        });
                }, 1000);
                return "0 kbits/sec";	// We don't have a bitrate value yet
            }
            return config.bitrate.value;
        } else {
            logger.warn("Getting the video bitrate unsupported by browser");
            return "Feature unsupported by browser";
        }
    };

    this.cleanupWebrtc = function () {
        logger.log("Cleaning WebRTC stuff");
        if (config !== null && config !== undefined) {
            // Cleanup stack
            config.remoteStream = null;
            if (config.volume) {
                if (config.volume["local"] && config.volume["local"].timer)
                    clearInterval(config.volume["local"].timer);
                if (config.volume["remote"] && config.volume["remote"].timer)
                    clearInterval(config.volume["remote"].timer);
            }
            config.volume = {};
            if (config.bitrate.timer)
                clearInterval(config.bitrate.timer);
            config.bitrate.timer = null;
            config.bitrate.bsnow = null;
            config.bitrate.bsbefore = null;
            config.bitrate.tsnow = null;
            config.bitrate.tsbefore = null;
            config.bitrate.value = null;
            try {
                // Try a MediaStreamTrack.stop() for each track
                if (!config.streamExternal && config.localStream !== null && config.localStream !== undefined) {
                    logger.log("Stopping local stream tracks");
                    var tracks = config.localStream.getTracks();
                    for (var i in tracks) {
                        var mst = tracks[i];
                        logger.log(mst);
                        if (mst !== null && mst !== undefined)
                            mst.stop();
                    }
                }
            } catch (e) {
                // Do nothing if this fails
            }
            config.streamExternal = false;
            config.localStream = null;
            // Close PeerConnection
            try {
                config.peerConnection.close();
            } catch (e) {
                // Do nothing
            }
            config.peerConnection = null;
            config.candidates = null;
            config.localSdp = null;
            config.remoteSdp = null;
            config.iceDone = false;
            config.dataChannel = {};
            config.dtmfSender = null;
        }
        options.oncleanup();
    };

    this.addRemoteIceCandidate = function (candidate) {
        if (config.peerConnection && config.remoteSdp) {
            // Add candidate right now
            logger.log("@@@Adding remote candidate@@@@:", candidate);
            if (!candidate || candidate.completed === true) {
                // end-of-candidates
                config.peerConnection.addIceCandidate(WebRtcPeer.endOfCandidates).then(() => {
                    // Do stuff when the candidate is successfully passed to the ICE agent
                    logger.log("@Adding remote candidate " + candidate + "success");
                }).catch(e => {
                    logger.error("@Error: Failure during addIceCandidate()");
                });
            } else {
                // New candidate
                config.peerConnection.addIceCandidate(candidate).then(() => {
                    // Do stuff when the candidate is successfully passed to the ICE agent
                    logger.log("@Adding remote candidate " + candidate + "success");
                }).catch(e => {
                    logger.error("@Error: Failure during addIceCandidate()");
                });
            }
        } else {
            // We didn't do setRemoteDescription (trickle got here before the offer?)
            logger.debug("We didn't do setRemoteDescription (trickle got here before the offer?), " +
                "caching candidate");
            if (!config.candidates)
                config.candidates = [];
            config.candidates.push(candidate);
            logger.debug(config.candidates);
        }
    };

    function webrtcError(error) {
        logger.error("WebRTC error:", error);
    }

    // Helper method to munge an SDP to enable simulcasting (Chrome only)
    function mungeSdpForSimulcasting(sdp) {
        // Let's munge the SDP to add the attributes for enabling simulcasting
        // (based on https://gist.github.com/ggarber/a19b4c33510028b9c657)
        var lines = sdp.split("\r\n");
        var video = false;
        var ssrc = [-1], ssrc_fid = [-1];
        var cname = null, msid = null, mslabel = null, label = null;
        var insertAt = -1;
        for (var i = 0; i < lines.length; i++) {
            var mline = lines[i].match(/m=(\w+) */);
            if (mline) {
                var medium = mline[1];
                if (medium === "video") {
                    // New video m-line: make sure it's the first one
                    if (ssrc[0] < 0) {
                        video = true;
                    } else {
                        // We're done, let's add the new attributes here
                        insertAt = i;
                        break;
                    }
                } else {
                    // New non-video m-line: do we have what we were looking for?
                    if (ssrc[0] > -1) {
                        // We're done, let's add the new attributes here
                        insertAt = i;
                        break;
                    }
                }
                continue;
            }
            if (!video)
                continue;
            var fid = lines[i].match(/a=ssrc-group:FID (\d+) (\d+)/);
            if (fid) {
                ssrc[0] = fid[1];
                ssrc_fid[0] = fid[2];
                lines.splice(i, 1);
                i--;
                continue;
            }
            if (ssrc[0]) {
                var match = lines[i].match('a=ssrc:' + ssrc[0] + ' cname:(.+)')
                if (match) {
                    cname = match[1];
                }
                match = lines[i].match('a=ssrc:' + ssrc[0] + ' msid:(.+)')
                if (match) {
                    msid = match[1];
                }
                match = lines[i].match('a=ssrc:' + ssrc[0] + ' mslabel:(.+)')
                if (match) {
                    mslabel = match[1];
                }
                match = lines[i].match('a=ssrc:' + ssrc[0] + ' label:(.+)')
                if (match) {
                    label = match[1];
                }
                if (lines[i].indexOf('a=ssrc:' + ssrc_fid[0]) === 0) {
                    lines.splice(i, 1);
                    i--;
                    continue;
                }
                if (lines[i].indexOf('a=ssrc:' + ssrc[0]) === 0) {
                    lines.splice(i, 1);
                    i--;
                    continue;
                }
            }
            if (lines[i].length == 0) {
                lines.splice(i, 1);
                i--;
                continue;
            }
        }
        if (ssrc[0] < 0) {
            // Couldn't find a FID attribute, let's just take the first video SSRC we find
            insertAt = -1;
            video = false;
            for (var i = 0; i < lines.length; i++) {
                var mline = lines[i].match(/m=(\w+) */);
                if (mline) {
                    var medium = mline[1];
                    if (medium === "video") {
                        // New video m-line: make sure it's the first one
                        if (ssrc[0] < 0) {
                            video = true;
                        } else {
                            // We're done, let's add the new attributes here
                            insertAt = i;
                            break;
                        }
                    } else {
                        // New non-video m-line: do we have what we were looking for?
                        if (ssrc[0] > -1) {
                            // We're done, let's add the new attributes here
                            insertAt = i;
                            break;
                        }
                    }
                    continue;
                }
                if (!video)
                    continue;
                if (ssrc[0] < 0) {
                    var value = lines[i].match(/a=ssrc:(\d+)/);
                    if (value) {
                        ssrc[0] = value[1];
                        lines.splice(i, 1);
                        i--;
                        continue;
                    }
                } else {
                    var match = lines[i].match('a=ssrc:' + ssrc[0] + ' cname:(.+)')
                    if (match) {
                        cname = match[1];
                    }
                    match = lines[i].match('a=ssrc:' + ssrc[0] + ' msid:(.+)')
                    if (match) {
                        msid = match[1];
                    }
                    match = lines[i].match('a=ssrc:' + ssrc[0] + ' mslabel:(.+)')
                    if (match) {
                        mslabel = match[1];
                    }
                    match = lines[i].match('a=ssrc:' + ssrc[0] + ' label:(.+)')
                    if (match) {
                        label = match[1];
                    }
                    if (lines[i].indexOf('a=ssrc:' + ssrc_fid[0]) === 0) {
                        lines.splice(i, 1);
                        i--;
                        continue;
                    }
                    if (lines[i].indexOf('a=ssrc:' + ssrc[0]) === 0) {
                        lines.splice(i, 1);
                        i--;
                        continue;
                    }
                }
                if (lines[i].length == 0) {
                    lines.splice(i, 1);
                    i--;
                    continue;
                }
            }
        }
        if (ssrc[0] < 0) {
            // Still nothing, let's just return the SDP we were asked to munge
            logger.warn("Couldn't find the video SSRC, simulcasting NOT enabled");
            return sdp;
        }
        if (insertAt < 0) {
            // Append at the end
            insertAt = lines.length;
        }
        // Generate a couple of SSRCs (for retransmissions too)
        // Note: should we check if there are conflicts, here?
        ssrc[1] = Math.floor(Math.random() * 0xFFFFFFFF);
        ssrc[2] = Math.floor(Math.random() * 0xFFFFFFFF);
        ssrc_fid[1] = Math.floor(Math.random() * 0xFFFFFFFF);
        ssrc_fid[2] = Math.floor(Math.random() * 0xFFFFFFFF);
        // Add attributes to the SDP
        for (var i = 0; i < ssrc.length; i++) {
            if (cname) {
                lines.splice(insertAt, 0, 'a=ssrc:' + ssrc[i] + ' cname:' + cname);
                insertAt++;
            }
            if (msid) {
                lines.splice(insertAt, 0, 'a=ssrc:' + ssrc[i] + ' msid:' + msid);
                insertAt++;
            }
            if (mslabel) {
                lines.splice(insertAt, 0, 'a=ssrc:' + ssrc[i] + ' mslabel:' + mslabel);
                insertAt++;
            }
            if (label) {
                lines.splice(insertAt, 0, 'a=ssrc:' + ssrc[i] + ' label:' + label);
                insertAt++;
            }
            // Add the same info for the retransmission SSRC
            if (cname) {
                lines.splice(insertAt, 0, 'a=ssrc:' + ssrc_fid[i] + ' cname:' + cname);
                insertAt++;
            }
            if (msid) {
                lines.splice(insertAt, 0, 'a=ssrc:' + ssrc_fid[i] + ' msid:' + msid);
                insertAt++;
            }
            if (mslabel) {
                lines.splice(insertAt, 0, 'a=ssrc:' + ssrc_fid[i] + ' mslabel:' + mslabel);
                insertAt++;
            }
            if (label) {
                lines.splice(insertAt, 0, 'a=ssrc:' + ssrc_fid[i] + ' label:' + label);
                insertAt++;
            }
        }
        lines.splice(insertAt, 0, 'a=ssrc-group:FID ' + ssrc[2] + ' ' + ssrc_fid[2]);
        lines.splice(insertAt, 0, 'a=ssrc-group:FID ' + ssrc[1] + ' ' + ssrc_fid[1]);
        lines.splice(insertAt, 0, 'a=ssrc-group:FID ' + ssrc[0] + ' ' + ssrc_fid[0]);
        lines.splice(insertAt, 0, 'a=ssrc-group:SIM ' + ssrc[0] + ' ' + ssrc[1] + ' ' + ssrc[2]);
        sdp = lines.join("\r\n");
        if (!sdp.endsWith("\r\n"))
            sdp += "\r\n";
        return sdp;
    }

    // Helper methods to parse a media object
    function isAudioSendEnabled(media) {
        logger.debug("isAudioSendEnabled:", media);
        if (media === undefined || media === null)
            return true;	// Default
        if (media.audio === false)
            return false;	// Generic audio has precedence
        if (media.audioSend === undefined || media.audioSend === null)
            return true;	// Default
        return (media.audioSend === true);
    }

    function isAudioSendRequired(media) {
        logger.debug("isAudioSendRequired:", media);
        if (media === undefined || media === null)
            return false;	// Default
        if (media.audio === false || media.audioSend === false)
            return false;	// If we're not asking to capture audio, it's not required
        if (media.failIfNoAudio === undefined || media.failIfNoAudio === null)
            return false;	// Default
        return (media.failIfNoAudio === true);
    }

    function isAudioRecvEnabled(media) {
        logger.debug("isAudioRecvEnabled:", media);
        if (media === undefined || media === null)
            return true;	// Default
        if (media.audio === false)
            return false;	// Generic audio has precedence
        if (media.audioRecv === undefined || media.audioRecv === null)
            return true;	// Default
        return (media.audioRecv === true);
    }

    function isVideoSendEnabled(media) {
        logger.debug("isVideoSendEnabled:", media);
        if (media === undefined || media === null)
            return true;	// Default
        if (media.video === false)
            return false;	// Generic video has precedence
        if (media.videoSend === undefined || media.videoSend === null)
            return true;	// Default
        return (media.videoSend === true);
    }

    function isVideoSendRequired(media) {
        logger.debug("isVideoSendRequired:", media);
        if (media === undefined || media === null)
            return false;	// Default
        if (media.video === false || media.videoSend === false)
            return false;	// If we're not asking to capture video, it's not required
        if (media.failIfNoVideo === undefined || media.failIfNoVideo === null)
            return false;	// Default
        return (media.failIfNoVideo === true);
    }

    function isVideoRecvEnabled(media) {
        logger.debug("isVideoRecvEnabled:", media);
        if (media === undefined || media === null)
            return true;	// Default
        if (media.video === false)
            return false;	// Generic video has precedence
        if (media.videoRecv === undefined || media.videoRecv === null)
            return true;	// Default
        return (media.videoRecv === true);
    }

    function isScreenSendEnabled(media) {
        logger.debug("isScreenSendEnabled:", media);
        if (media === undefined || media === null)
            return false;
        if (typeof media.video !== 'object' || typeof media.video.mandatory !== 'object')
            return false;
        var constraints = media.video.mandatory;
        if (constraints.chromeMediaSource)
            return constraints.chromeMediaSource === 'desktop' || constraints.chromeMediaSource === 'screen';
        else if (constraints.mozMediaSource)
            return constraints.mozMediaSource === 'window' || constraints.mozMediaSource === 'screen';
        else if (constraints.mediaSource)
            return constraints.mediaSource === 'window' || constraints.mediaSource === 'screen';
        return false;
    }

    function isDataEnabled(media) {
        logger.debug("isDataEnabled:", media);
        if (WebRtcPeer.webRTCAdapter.browserDetails.browser === "edge") {
            logger.warn("Edge doesn't support data channels yet");
            return false;
        }
        if (media === undefined || media === null)
            return false;	// Default
        return (media.data === true);
    }

    function isTrickleEnabled(trickle) {
        logger.debug("isTrickleEnabled:", trickle);
        if (trickle === undefined || trickle === null)
            return true;	// Default is true
        return (trickle === true);
    }

}
