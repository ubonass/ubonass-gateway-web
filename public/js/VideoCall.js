var remoteCloud = null;
var opaqueId = "videocall-" + RemoteCloud.randomString(12);
var pluginHandle;
var peerSdpOffer;

function noop() {}

VideoCall.init = function (options) {

    options = options || {};

    options.callback =
        (typeof options.callback == "function") ? options.callback : noop;

    if (options.debug === undefined || options.debug == null)
        options.debug = {debug: ["error", "warn", "log", "debug"]};

    //console.log("options.debug:" + options.debug);

    RemoteCloud.init(options);

    PluginHandle.init(options);

    //options.callback();
};


/**
 *
 * @param remote
 * @param callbacks:用户回调函数
 * @constructor
 */
function VideoCall(remote, callbacks) {

    callbacks = callbacks || {};

    /**
     * 插件attach成功后回调
     */
    callbacks.onAttachSuccess =
        (typeof callbacks.onAttachSuccess == "function") ? callbacks.onAttachSuccess : noop;
    /**
     * 插件attach失败后回调
     */
    callbacks.onAttachError =
        (typeof callbacks.onAttachError == "function") ? callbacks.onAttachError : noop;
    /**
     * 注册成功后回调
     */
    callbacks.onRegistered =
        (typeof callbacks.onRegistered == "function") ? callbacks.onRegistered : noop;
    /**
     *正处于呼叫中回调
     */
    callbacks.onCalling =
        (typeof callbacks.onCalling == "function") ? callbacks.onCalling : noop;
    /**
     * 来电时回调
     * @type {noop}
     */
    callbacks.onIncomingCall =
        (typeof callbacks.onIncomingCall == "function") ? callbacks.onIncomingCall : noop;
    /**
     * 对方已接听时回调
     */
    callbacks.onCallAccepted =
        (typeof callbacks.onCallAccepted == "function") ? callbacks.onCallAccepted : noop;

    /**
     * 对方挂断时候回调
     */
    callbacks.onCallHangup =
        (typeof callbacks.onCallHangup == "function") ? callbacks.onCallHangup : noop;

    /**
     * 成功建立通话时回调
     */
    callbacks.onCallConnected =
        (typeof callbacks.onCallConnected == "function") ? callbacks.onCallConnected : noop;

    /**
     *
     */
    callbacks.onCallSimulcast =
        (typeof callbacks.onCallSimulcast == "function") ? callbacks.onCallSimulcast : noop;
    //videocall.onCallSimulcast(result["videocodec"], substream, temporal);

    /**
     *当本地流采集成功后回调
     */
    callbacks.onLocalStream =
        (typeof callbacks.onLocalStream == "function") ? callbacks.onLocalStream : noop;

    /**
     *当远程流接收成功后回调
     */
    callbacks.onRemoteStream =
        (typeof callbacks.onRemoteStream == "function") ? callbacks.onRemoteStream : noop;

    /**
     *当webrtc datachannel open 的时候回调
     */
    callbacks.onDataOpen =
        (typeof callbacks.onDataOpen == "function") ? callbacks.onDataOpen : noop;

    /**
     *当接收到webrtc的data时回调
     */
    callbacks.onData =
        (typeof callbacks.onData == "function") ? callbacks.onData : noop;

    /**
     * 当底层资源释放后回调
     */
    callbacks.onCleanup =
        (typeof callbacks.onCleanup == "function") ? callbacks.onCleanup : noop;

    /**
     *当当前的session销毁后回调
     */
    //callbacks.onDestroyed =
    //    (typeof callbacks.onDestroyed == "function") ? callbacks.onDestroyed : noop;

    /**
     *
     * @param callbacks
     * @constructor
     */
    var attachCallbacks = {
        plugin: "janus.plugin.videocall",
        opaqueId: opaqueId,
        mediaState: (type, receiving) => mediaState(type, receiving),
        webrtcState: (up, reason) => webrtcState(up, reason),
        slowLink: (uplink, lost) => slowLink(uplink, lost),
        onmessage: (message, jsep) => onmessage(message, jsep),
        ondetached: () => ondetached(),
        consentDialog: (on) => consentDialog(on),
        iceState: (state) => iceState(state),
        onlocalstream: (stream) => onlocalstream(stream),
        onremotestream: (stream) => onremotestream(stream),
        ondata: (data, label) => ondata(data, label),
        ondataopen: (label) => ondataopen(label),
        oncleanup: () => oncleanup(),
        success: (handle) => attachSuccess(handle),
        error: (error) => attachError(error)
    };

    var that = this;

    var remoteCloud = remote;

    if (remoteCloud === undefined ||
        remoteCloud === null) return;

    if (callbacks.transmit === "p2p") {
        attachCallbacks.plugin = "janus.plugin.p2p.videocall";
        attachCallbacks.transmit = "p2p";
    }

    remoteCloud.attach(attachCallbacks);
    /**
     * 注册用户
     * @param userName
     * @param callback
     */
    this.register = function (userName, callback) {
        callback =
            (typeof callback == "function") ? callback : noop;

        if (pluginHandle === undefined || pluginHandle === null) {
            callback("pluginHandle in null");
            return;
        }

        if (userName === undefined || userName === null) {
            callback("userName in Empty");
            return;
        }

        var register = {"request": "register", "username": userName};
        pluginHandle.sendMessage({"message": register});
        callback();
    };

    /**
     * 查找用户列表
     * @param callback
     */
    this.listUser = function (callback) {
        callback =
            (typeof callback == "function") ? callback : noop;

        if (pluginHandle === undefined || pluginHandle === null) {
            callback("pluginHandle in null");
            return;
        }
        pluginHandle.sendMessage({"message": {"request": "list"}});
        callback();
    };

    /**
     * 开始呼叫
     * @param media
     * @param simulcast
     * @param peerName
     * @param callback
     */
    this.startCall = function (media, simulcast, peerName, callback) {

        callback =
            (typeof callback == "function") ? callback : noop;

        if (pluginHandle === undefined || pluginHandle === null) {
            callback("pluginHandle in null");
            return;
        }

        if (peerName === undefined || peerName === null) {
            callback("peerName in Empty");
            return;
        }

        pluginHandle.createOffer({
            // By default, it's sendrecv for audio and video...
            media,	// ... let's negotiate data channels as well
            // If you want to test simulcasting (Chrome and Firefox only), then
            // pass a ?simulcast=true when opening this demo page: it will turn
            // the following 'simulcast' property to pass to RemoteCloud.js to true
            simulcast: simulcast,
            success: function (localOffer) {
                console.log("sdpOffer:" + JSON.stringify(localOffer));
                var body = {"request": "call", "username": peerName};
                pluginHandle.sendMessage({"message": body, "jsep": localOffer});
                callback();
            },
            error: function (error) {
                console.error("WebRTC error...", error);
                callback(error);
                bootbox.alert("WebRTC error... " + error);
            }
        });
    };

    this.answerCall = function (media, simulcast, peerName, callback) {
        callback =
            (typeof callback == "function") ? callback : noop;

        if (pluginHandle === undefined || pluginHandle === null) {
            callback("pluginHandle in null");
            return;
        }

        if (peerName === undefined || peerName === null) {
            callback("peerName can not null here....");
            return;
        }

        if (peerSdpOffer === undefined || peerSdpOffer === null) {
            callback("peerSdpOffer can not null here....");
            return;
        }

        pluginHandle.createAnswer({
            jsep: peerSdpOffer,
            // No media provided: by default, it's sendrecv for audio and video
            media: media,	// Let's negotiate data channels as well
            // If you want to test simulcasting (Chrome and Firefox only), then
            // pass a ?simulcast=true when opening this demo page: it will turn
            // the following 'simulcast' property to pass to RemoteCloud.js to true
            simulcast: simulcast,

            success: function (localAnswer) {
                console.log("localAnswer:" + JSON.stringify(localAnswer));
                var body = {"request": "accept"};
                pluginHandle.sendMessage({"message": body, "jsep": localAnswer});
                callback();
            },
            error: function (error) {
                console.error("WebRTC error:", error);
                callback(error);
                //result = false;
                //bootbox.alert("WebRTC error... " + JSON.stringify(error));
            }
        });
    };

    this.addRemoteDescription = function (jsep, callback) {
        callback =
            (typeof callback == "function") ? callback : noop;

        if (pluginHandle === undefined || pluginHandle === null) {
            callback("pluginHandle in null");
            return;
        }

        if (jsep === undefined || jsep === null) {
            callback("jsep in null");
            return;
        }

        var callbacks = {
            jsep: jsep,
            success: function () {
                callback();
            },
            error: function () {
                callback("handleRemoteJsep Error");
            }
        };
        pluginHandle.handleRemoteJsep(callbacks);
    };

    this.update = function (jsep, callback) {
        callback =
            (typeof callback == "function") ? callback : noop;

        if (pluginHandle === undefined || pluginHandle === null) {
            callback("pluginHandle in null");
            return;
        }

        if (jsep === undefined || jsep === null) {
            callback("jsep in null");
            return;
        }

        if (jsep.type === "answer") {
            pluginHandle.handleRemoteJsep(jsep);
        } else {
            pluginHandle.createAnswer({
                jsep: jsep,
                media: {data: true},	// Let's negotiate data channels as well
                success: function (jsep) {
                    console.debug("Got SDP!");
                    console.debug(jsep);
                    var body = {"request": "set"};
                    pluginHandle.sendMessage({"message": body, "jsep": jsep});
                },
                error: function (error) {
                    console.error("WebRTC error:", error);
                    //bootbox.alert("WebRTC error... " + JSON.stringify(error));
                }
            });
        }
    };

    this.hangup = function (request, callback) {
        callback =
            (typeof callback == "function") ? callback : noop;

        if (pluginHandle === undefined || pluginHandle === null) {
            callback("pluginHandle in null");
            return;
        }

        if (request)
            pluginHandle.sendMessage({"message": {"request": "hangup"}});

        pluginHandle.hangup();
        callback();
    };

    this.setBitrate = function (bitrate, callback) {
        callback =
            (typeof callback == "function") ? callback : noop;
        if (pluginHandle === undefined || pluginHandle === null) {
            callback("pluginHandle in null");
            return;
        }
        pluginHandle.sendMessage({"message": {"request": "set", "bitrate": bitrate}});
    };

    this.getBitrate = function (callback) {
        callback =
            (typeof callback == "function") ? callback : noop;
        if (pluginHandle === undefined || pluginHandle === null) {
            callback("pluginHandle in null");
            return;
        }
        pluginHandle.getBitrate();
    };

    this.setAudioEnable = function (enable, callback) {
        callback =
            (typeof callback == "function") ? callback : noop;
        if (pluginHandle === undefined || pluginHandle === null) {
            callback("pluginHandle in null");
            return;
        }
        pluginHandle.sendMessage({"message": {"request": "set", "audio": enable}});
    };

    this.setVideoEnable = function (enable, callback) {
        callback =
            (typeof callback == "function") ? callback : noop;
        if (pluginHandle === undefined || pluginHandle === null) {
            callback("pluginHandle in null");
            return;
        }
        pluginHandle.sendMessage({"message": {"request": "set", "video": enable}});
    };

    this.getIceState = function (callback) {
        callback =
            (typeof callback == "function") ? callback : noop;
        if (pluginHandle === undefined || pluginHandle === null) {
            callback("pluginHandle in null");
            return;
        }
        return pluginHandle.getIceState();
    };

    function attachSuccess(handle) {
        console.log("create Video Call PluginHandle Success");
        pluginHandle = handle;
        callbacks.onAttachSuccess();
    }

    function attachError(error) {
        console.error("  -- Error attaching plugin...", error);
        //bootbox.alert("  -- Error attaching plugin... " + error);
        callbacks.onAttachError(error);
    }

    /**
     *
     * @param type
     * @param receiving
     */
    function mediaState(type, receiving) {

    }

    /**
     *
     * @param up
     * @param reason
     */
    function webrtcState(up, reason) {
        if (up)
            callbacks.onCallConnected();
    }

    /**
     *
     * @param uplink
     * @param lost
     */
    function slowLink(uplink, lost) {

    }

    /**
     *
     * @param message
     * @param jsep
     */
    function onmessage(message, jsep) {
        console.info(" ::: Got a message :::" + JSON.stringify(message));
        var result = message["result"];
        if (result !== null && result !== undefined) {
            if (result["list"] !== undefined && result["list"] !== null)
                handleUserList(result);
            else if (result["event"] !== undefined && result["event"] !== null)
                handleCallEvent(result, jsep);
        } else {
            //TODO
        }
    }

    /**
     *
     */
    function ondetached() {
        console.log("@@ondetached@@");
    }

    /**
     *
     * @param on
     */
    function consentDialog(on) {

    }

    /**
     *
     * @param state
     */
    function iceState(state) {
        console.log("ice state:" + state);
    }

    /**
     * local stream enable,用户可以进行显示
     * @param stream
     */
    function onlocalstream(stream) {
        callbacks.onLocalStream(stream);
    }

    /**
     *
     * @param stream
     */
    function onremotestream(stream) {
        callbacks.onRemoteStream(stream);
    }

    /**
     *
     * @param data
     * @param label
     */
    function ondata(data, label) {
        callbacks.onData(data, label);
    }

    /**
     *
     * @param label
     */
    function ondataopen(label) {
        callbacks.onDataOpen(label);
    }

    /**
     *
     */
    function oncleanup() {
        console.log("@@oncleanup@@");
        callbacks.onCleanup();
    }


    function handleUserList(result) {
        var list = result["list"];
        console.info("Got a list of registered peers:" + JSON.stringify(list));
        for (var mp in list) {
            console.info("  >> [" + list[mp] + "]");
        }
    }

    function handleCallEvent(result, jsep) {
        var event = result["event"];
        switch (event) {
            case 'registered':
                handleRegistered(result);
                break;
            case 'calling':
                handleCalling(result);
                break;
            case 'incomingcall':
                handleIncomingcall(result, jsep);
                break;
            case 'accepted':
                handleAccepted(result, jsep);
                break;
            case 'update':
                handleUpdate(result, jsep);
                break;
            case 'hangup':
                handleHangup(result);
                break;
            case 'simulcast':
                handleSimulcast(result);
                break;
            default:
                // Ignore the message
                break;
        }
    }

    /**
     *
     * @param result
     */
    function handleRegistered(result) {
        that.listUser();
        callbacks.onRegistered(result["username"]);
    }

    function handleCalling(result) {
        console.log("Waiting for the peer to answer...");
        // TODO Any ringtone?
        //bootbox.alert("Waiting for the peer to answer...");
        //send local candidate to remote
        callbacks.onCalling();
    }

    /**
     * 收到来电请求
     * @param result
     * @param jsep
     */
    function handleIncomingcall(result, jsep) {
        console.log("Incoming call from " + result["username"] + ",jsep:"
            + JSON.stringify(jsep));
        var peerName = result["username"];
        if (peerName === undefined || peerName == null) return;
        peerSdpOffer = jsep;
        if (peerSdpOffer === undefined || peerSdpOffer === null) {
            console.error("Incoming call from ：" + peerName + " but jsep is null");
            return;
        }
        callbacks.onIncomingCall(peerName);
    }

    /**
     * 对方已经接听
     * @param result
     * @param jsep
     */
    function handleAccepted(result, jsep) {
        console.info(JSON.stringify(jsep));
        var peerName = result["username"];
        if (peerName === null || peerName === undefined) {
            console.log("Call started!");
            return;
        }

        that.addRemoteDescription(jsep, function (error) {
            if (error === null || error === undefined)
                callbacks.onCallAccepted(peerName);
        });
    }

    /**
     *
     * @param result
     */
    function handleUpdate(result, jsep) {
        if (jsep === undefined || jsep === null) {
            return;
        }
        that.update(jsep);
    }

    /**
     *
     * @param result
     */
    function handleHangup(result) {
        that.hangup();
        callbacks.onCallHangup();
    }

    /**
     *
     * @param result
     */
    function handleSimulcast(result) {
        // Is simulcast in place?
        var substream = result["substream"];
        var temporal = result["temporal"];

        if ((substream !== null && substream !== undefined) ||
            (temporal !== null && temporal !== undefined)) {
            callbacks.onCallSimulcast(result["videocodec"], substream, temporal);
        }
    }

}


