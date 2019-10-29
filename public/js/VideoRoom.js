function noop(options) {
}

var logger;// = new Logger({debug: ["error", "warn", "log", "debug"]});
VideoRoom.init = function (callbacks) {
    callbacks = callbacks || {};
    callbacks.callback =
        (typeof callbacks.callback == "function") ? callbacks.callback : noop;
    if (callbacks.debug === undefined || callbacks.debug == null)
        callbacks.debug = {debug: ["error", "warn", "log", "debug"]};

    RemoteCloud.init(callbacks);

    PluginHandle.init(callbacks);

    logger = new Logger(callbacks);
};

var opaqueId = "videoroom-" + RemoteCloud.randomString(12);

/**
 *
 * @param callbacks
 * @constructor
 */
function VideoRoom(callbacks) {

    callbacks = callbacks || {};
    /**
     *
     */
    callbacks.success = (typeof callbacks.success == "function") ? callbacks.success : noop;
    /**
     *
     */
    callbacks.error = (typeof callbacks.error == "function") ? callbacks.error : noop;
    /**
     *当本地流采集成功后回调
     */
    callbacks.onLocalStream =
        (typeof callbacks.onLocalStream == "function") ? callbacks.onLocalStream : noop;
    /**
     *
     */
    callbacks.onRemoteStream =
        (typeof callbacks.onRemoteStream == "function") ? callbacks.onRemoteStream : noop;

    callbacks.onJoinedRoom =
        (typeof callbacks.onParticipantPublished == "function") ? callbacks.onParticipantPublished : noop;
    /**
     *
     */
    callbacks.onParticipantAttend =
        (typeof callbacks.onParticipantAttend == "function") ? callbacks.onParticipantAttend : noop;
    /**
     *
     */
    callbacks.onParticipantJoined =
        (typeof callbacks.onParticipantJoined == "function") ? callbacks.onParticipantJoined : noop;

    /**
     *
     */
    callbacks.onParticipantPublished =
        (typeof callbacks.onParticipantPublished == "function") ? callbacks.onParticipantPublished : noop;
    /**
     *
     */
    callbacks.onParticipantUnPublished =
        (typeof callbacks.onParticipantUnPublished == "function") ? callbacks.onParticipantUnPublished : noop;
    /**
     *
     */
    callbacks.onParticipantLeft =
        (typeof callbacks.onParticipantLeft == "function") ? callbacks.onParticipantLeft : noop;

    /**
     *
     */
    callbacks.onWebRtcState =
        (typeof callbacks.onWebRtcState == "function") ? callbacks.onWebRtcState : noop;

    /**
     *
     */
    callbacks.onCleanup =
        (typeof callbacks.onCleanup == "function") ? callbacks.onCleanup : noop;

    /**
     *
     */
    callbacks.onDestroyed =
        (typeof callbacks.onDestroyed == "function") ? callbacks.onDestroyed : noop;

    var cloudOptions = {
        server: callbacks.server,
        success: function () {
            callbacks.success();
        },
        error: function (errror) {
            callbacks.error(errror);
        },
        destroyed: function () {
            //window.location.reload();
            callbacks.onDestroyed();
        }
    };

    remoteCloud = new RemoteCloud(cloudOptions);

    /**
     * 销毁当前session
     */
    this.destroy = function () {
        remoteCloud.destroy();
    };

    var that = this;
    var publisher;//may be publisher or subscriber
    var publisherName;
    var subscribers = {};

    function attachPublisherHandle(callback) {
        callback =
            (typeof callback == "function") ? callback : noop;
        remoteCloud.attach({
            plugin: "janus.plugin.videoroom",
            opaqueId: opaqueId,
            success: function (pluginHandle) {
                publisher = pluginHandle;
                callback(null);
            },

            error: function (error) {
                logger.error("  -- Error attaching plugin...", error);
                callback("Error attaching plugin... " + error);
            },

            consentDialog: function (on) {

            },

            mediaState: function (medium, on) {
                logger.log("RemoteCloud " + (on ? "started" : "stopped") + " receiving our " + medium);
            },

            webrtcState: function (on) {
                logger.log("RemoteCloud says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
                callbacks.onWebRtcState({id: publisher.id, display: publisherName}, on);
            },

            onmessage: function (msg, jsep) {
                logger.log("msg:" + JSON.stringify(msg));
                var event = msg["videoroom"];
                if (event !== undefined && event !== null) {
                    /**
                     * 房间创建成功
                     */
                    if (event === "created") {
                        logger.log("room " + msg["room"] + " create success");
                    } else if (event === "destroyed") {
                        logger.log("room " + msg["room"] + " create destroyed");
                        publisher.detach();
                    } else if (event === "joined") {
                        // Publisher/manager created, negotiate WebRTC and attach to existing feeds, if any
                        publisher.id = msg["id"];//participant
                        publisher.private_id = msg["private_id"];//participant private id
                        //callbacks.onParticipantJoined({id: publisher.id, display: publisherName});
                        /**
                         * 如果房间里面有人在发布视频会有该事件
                         */
                        if (msg["publishers"] !== undefined && msg["publishers"] !== null) {
                            var publishers = msg["publishers"];
                            for (var index in publishers) {
                                var id = publishers[index]["id"];
                                var display = publishers[index]["display"];
                                var audio_codec = publishers[index]["audio_codec"];
                                var video_codec = publishers[index]["video_codec"];
                                var simulcast = publishers[index]["simulcast"];

                                var options = {id: id, display: display};
                                if (audio_codec !== undefined || audio_codec !== null)
                                    options.audio_codec = audio_codec;
                                if (video_codec !== undefined || video_codec !== null)
                                    options.video_codec = video_codec;
                                if (simulcast !== undefined || simulcast !== null)
                                    options.simulcast = simulcast;
                                callbacks.onParticipantPublished(options);
                            }
                        }
                        /**
                         * 房间有参与者存在
                         */
                        if (msg["attendees"] !== undefined && msg["attendees"] !== null) {
                            var attendees = msg["attendees"];
                            for (var index in attendees) {
                                var id = attendees[index]["id"];
                                var display = attendees[index]["display"];
                                //准备接收视频
                                callbacks.onParticipantAttend({id: id, display: display});
                            }
                        }
                    } else if (event === "event") {
                        /**
                         * 如果有人加入到该房间
                         */
                        if (msg["joining"] !== undefined && msg["joining"] !== null) {
                            var joining = msg["joining"];
                            var id = joining["id"];
                            var display = joining["display"];
                            callbacks.onParticipantJoined({id: id, display: display});
                        } else if (msg["publishers"] !== undefined && msg["publishers"] !== null) {
                            /*如果房间里面有人发布了视频则会有该事件*/
                            var publishers = msg["publishers"];
                            for (var index in publishers) {
                                var id = publishers[index]["id"];
                                var display = publishers[index]["display"];
                                var audio_codec = publishers[index]["audio_codec"];
                                var video_codec = publishers[index]["video_codec"];
                                var simulcast = publishers[index]["simulcast"];

                                var options = {id: id, display: display};

                                if (audio_codec !== undefined || audio_codec !== null)
                                    options.audio_codec = audio_codec;
                                if (video_codec !== undefined || video_codec !== null)
                                    options.video_codec = video_codec;
                                if (simulcast !== undefined || simulcast !== null)
                                    options.simulcast = simulcast;

                                options.private_id = publisher.private_id;

                                callbacks.onParticipantPublished(options);
                            }
                            /*房间里有其他参与者离开房间*/
                        } else if (msg["leaving"] !== undefined && msg["leaving"] !== null) {
                            // One of the publishers has gone away?
                            var leaving = msg["leaving"];
                            logger.log("Publisher leaving: " + leaving);
                            if (leaving === "ok") {
                                detachPublisherHandle();
                            } else {
                                callbacks.onParticipantLeft({id: leaving});
                            }
                            /*var subscriber = null;
                           for (var i = 1; i < 6; i++) {
                               if (subscribers[i] !== null && subscribers[i] !== undefined
                                   && subscribers[i].rfid === leaving) {
                                   subscriber = subscribers[i];
                                   break;
                               }
                           }
                           if (subscriber != null) {
                               logger.log("Feed " + subscriber.rfid +
                                   " (" + subscriber.rfdisplay + ") has left the room, detaching");
                               /!*$('#remote' + remoteFeed.rfindex).empty().hide();
                               $('#videoremote' + remoteFeed.rfindex).empty();*!/

                               subscribers[subscriber.rfindex] = null;
                               subscriber.detach();
                           }*/
                        } else if (msg["unpublished"] !== undefined && msg["unpublished"] !== null) {
                            // One of the publishers has unpublished?
                            var unpublished = msg["unpublished"];
                            logger.log("Publisher unpublished: " + unpublished);
                            if (unpublished === 'ok') {
                                // That's us
                                publisher.hangup();
                            } else {
                                callbacks.onParticipantLeft({id: unpublished});
                            }
                            /*
                            var subscriber = null;
                            for (var i = 1; i < 6; i++) {
                                if (subscribers[i] !== null && subscribers[i] !== undefined
                                    && subscribers[i].rfid === unpublished) {
                                    subscriber = subscribers[i];
                                    break;
                                }
                            }

                            if (subscriber != null) {
                                options.onParticipantUnPublished({
                                    id: subscriber.rfid,
                                    index: subscriber.rfindex,
                                    display: subscriber.rfdisplay
                                });
                                subscribers[subscriber.rfindex] = null;
                                subscriber.detach();
                            }*/
                        } else if (msg["error"] !== undefined && msg["error"] !== null) {
                            /*if (msg["error_code"] === 426) {
                                // This is a "no such room" error: give a more meaningful description
                                bootbox.alert(
                                    "<p>Apparently room <code>" + myroom + "</code> (the one this demo uses as a test room) " +
                                    "does not exist...</p><p>Do you have an updated <code>janus.plugin.videoroom.cfg</code> " +
                                    "configuration file? If not, make sure you copy the details of room <code>" + myroom + "</code> " +
                                    "from that sample in your current configuration file, then restart Janus and try again."
                                );
                            } else {
                                bootbox.alert(msg["error"]);
                            }*/
                            callbacks.error(JSON.stringify(msg["error"]));
                        }
                    }
                }

                if (jsep !== undefined && jsep !== null) {
                    logger.debug(JSON.stringify(jsep));
                    publisher.handleRemoteJsep({jsep: jsep});
                }
            },

            onlocalstream: function (stream) {
                callbacks.onLocalStream(stream);
            },

            onremotestream: function (stream) {
                // The publisher stream is sendonly, we don't expect anything here
            },
            /**
             * 当对应的webrtcPeer被销毁时回调
             */
            oncleanup: function () {
                logger.log("oncleanup...");
                callbacks.onCleanup();
            }
        });
    }

    /***
     * detach publisher,当离开房间的时候回调
     */
    function detachPublisherHandle() {
        var options = {
            success: function () {
                publisher = null;
            },
            error: function (error) {
            },
            noRequest: false
        };
        publisher.detach(options);
    }

    /**
     *
     * @param handler
     * @param roomname
     * @param callback
     */
    function roomExists(handler, roomname, callback) {

        callback =
            (typeof callback == "function") ? callback : noop;

        if (handler === undefined || handler === null) {
            callback("handler is null");
            return;
        }

        if (roomname === undefined || roomname === null) {
            callback("roomname is null");
            return;
        }

        var callbacks = {
            success: function (data) {
                //logger.log("data" + JSON.stringify(data));
                if (data.exists === true)
                    callback(null);
                else
                    callback("room mot exist");
            },
            error: function (error) {
                callback(error);
            },
            message: {
                "request": "exists",
                "room": roomname,
            }
        };
        handler.sendMessage(callbacks);
        //return exists;
    }

    /**
     * 当销毁房间的时候需要销毁publisher
     * for publisher
     * @param options
     * @param callback
     */
    this.createSession = function (options, callback) {

        callback =
            (typeof callback == "function") ? callback : noop;

        if (options === undefined || options === null) {
            callback("callbacks can not null");
            return;
        }

        if (remoteCloud === undefined || remoteCloud === null) {
            callback("remoteCloud null please init first");
            return;
        }

        if (!remoteCloud.isConnected()) {
            callback("wait RemoteCloud create success");
            return;
        }

        var roomname = options.roomname;
        if (roomname === undefined || roomname === null) {
            callback("roomname can not null");
            return;
        }

        /**
         * 如果publisher为Null Attach it,当房间销毁或者离开房间的时候dettach it
         */
        if (publisher === undefined || publisher === null) {
            attachPublisherHandle(function (error) {
                if (error === null || error === undefined)
                    createRoom(callback);
            });
        } else {
            createRoom(callback);
        }

        function createRoom(callback) {
            roomExists(publisher, roomname, function (error) {
                if (error === null || error === undefined) {
                    callback("room " + roomname + "is Exists");
                } else {
                    var message = {"request": "create", "room": roomname};
                    /**
                     * 该房间创建成功后是否加到config文件当中去
                     */
                    if (options.permanent !== undefined && options.permanent !== null)
                        message.permanent = options.permanent;

                    /**
                     * 房间描述
                     */
                    if (options.description !== undefined && options.description !== null)
                        message.description = options.description;
                    /**
                     * 如果需要修改房间的话edit或者destory的时候需要
                     */
                    if (options.secret !== undefined && options.secret !== null)
                        message.secret = options.secret;

                    /**
                     * 加入房间的时候需要
                     */
                    if (options.pin !== undefined && options.pin !== null)
                        message.pin = options.pin;

                    /**
                     * 是否是私有房间,如果是私有房间的话通过list是需要不到的
                     */
                    if (options.is_private !== undefined && options.is_private !== null)
                        message.is_private = options.is_private;
                    /**
                     * array of string tokens users can use to join this room, optional
                     */
                    if (options.allowed !== undefined && options.allowed !== null)
                        message.allowed = options.allowed;

                    /**
                     * 当用户加入房间的时候通知
                     * @type {boolean}
                     */
                    message.notify_joining = true;

                    //callbacks.message = message;

                    var callbacks = {
                        success: function () {
                            callback(null);
                        },
                        error: function (error) {
                            callback(error);
                        },
                        message: message
                    };
                    publisher.sendMessage(callbacks);
                }
            });
        }

    };

    /**
     * 当销毁成功后dattach插件
     * for publisher
     * @param options
     * @param callback
     */
    this.destroySession = function (options, callback) {

        callback =
            (typeof callback == "function") ? callback : noop;

        if (remoteCloud === undefined || remoteCloud === null) {
            callback("remoteCloud null please init first");
            return;
        }

        if (!remoteCloud.isConnected()) {
            callback("wait RemoteCloud create success");
            return;
        }

        var roomname = options.roomname;
        if (roomname === undefined || roomname === null) {
            callback("roomname can not null");
            return;
        }

        if (publisher === undefined || publisher === null) {
            callback("pluginHandle can not null");
            return;
        }

        var message = {"request": "destroy", "room": roomname};

        /**
         * 如果需要修改房间的话edit或者destory的时候需要
         */
        if (options.secret !== undefined && options.secret !== null)
            message.secret = options.secret;

        /**
         * 该房间创建成功后是否加到config文件当中去
         */
        if (options.permanent !== undefined && options.permanent !== null)
            message.permanent = options.permanent;

        publisher.sendMessage({message: message});

        callback(null);
    };

    /**
     * 如果publisher不存在,则会创建attach publisher
     * for publisher
     * @param options
     * @param callback
     */
    this.joinSession = function (options, callback) {

        callback =
            (typeof callback == "function") ? callback : noop;

        if (options === undefined || options === null) {
            callback("options can not null");
            return;
        }

        if (remoteCloud === undefined || remoteCloud === null) {
            callback("remoteCloud null please init first");
            return;
        }

        if (!remoteCloud.isConnected()) {
            callback("wait RemoteCloud create success");
            return;
        }

        var username = options.username;
        if (username === undefined || username === null) {
            callback("username is null");
            return;
        }

        publisherName = username;


        if (publisher === undefined || publisher === null) {
            //callback("wait publisher create success");
            // return;
            attachPublisherHandle(function (error) {
                if (error === null || error === undefined)
                    joinRoom(callback);
            });
        } else {
            joinRoom(callback);
        }

        function joinRoom(callback) {
            var roomname = options.roomname;
            if (roomname === undefined || roomname === null) {
                callback("username is null");
                return;
            }
            /*var ptype = callbacks.ptype;//publisher or subscriber
            if (ptype === undefined || ptype === null) {
                callbacks.error("ptype is null");
                return;
            }*/
            var join = {"request": "join", "room": roomname, "ptype": "publisher", "display": username};

            var token = options.token;
            if (token !== undefined && token !== null)
                join.token = token;

            roomExists(publisher, roomname, function (error) {
                if (error !== undefined && error !== null) {
                    that.createSession(options, function (e) {
                        if (e === null || e === undefined)
                            publisher.sendMessage({"message": join});
                    });
                } else {
                    publisher.sendMessage({"message": join});
                    callback(null);
                }
            });
        }
    };

    /**
     * 离开房间,离开成功后需要detach publisher
     */
    this.leaveSession = function () {
        if (publisher === undefined || publisher === null) {
            callbacks.error("wait pluginHandle create success");
            return;
        }
        publisher.hangup();
        var leave = {"request": "leave"};
        publisher.sendMessage({"message": leave});
    };

    /**
     * 如果用户先使用JoinSession，后发布视频则调用该方法
     * @param options
     * @param callback
     */
    this.publishVideo = function (options, callback) {

        callback =
            (typeof callback == "function") ? callback : noop;

        if (options === undefined || options === null) {
            callback("callbacks can not null");
            return;
        }

        if (remoteCloud === undefined || remoteCloud === null) {
            callback("remoteCloud null please init first");
            return;
        }

        if (!remoteCloud.isConnected()) {
            callback("wait RemoteCloud create success");
            return;
        }

        if (publisher === undefined || publisher === null) {
            callback("wait pluginHandle create success");
            return;
        }

        var roomname = options.roomname;
        if (roomname === undefined || roomname === null) {
            callback("username is null");
            return;
        }

        roomExists(publisher, roomname, function (error) {
            if (error === null || error === undefined) {
                var audio = options.audio;
                if (audio === undefined || audio === null)
                    audio = true;

                var video = options.video;
                if (video === undefined || video === null)
                    video = true;

                var data = options.data;
                if (data === undefined || data === null)
                    data = false;

                var message = {request: "configure", audio: audio, video: video, data: data};

                if (options.audiocodec !== undefined && options.audiocodec !== null)
                    message.audiocodec = options.audiocodec;

                if (options.videocodec !== undefined && options.videocodec !== null)
                    message.videocodec = options.videocodec;

                if (options.bitrate !== undefined && options.bitrate !== null)
                    message.bitrate = options.bitrate;

                if (options.record !== undefined && options.record !== null)
                    message.record = options.record;

                if (options.filename !== undefined && options.filename !== null)
                    message.filename = options.filename;

                if (options.username !== undefined && options.username !== null)
                    message.display = options.username;

                var doSimulcast = options.doSimulcast || false;
                var doSimulcast2 = options.doSimulcast2 || false;

                // Publish our stream
                // Publishers are sendonly
                publisher.createOffer({
                    // Add data:true here if you want to publish datachannels as well
                    media: {audioRecv: false, videoRecv: false, audioSend: audio, videoSend: video, data: data},
                    // If you want to test simulcasting (Chrome and Firefox only), then
                    // pass a ?simulcast=true when opening this demo page: it will turn
                    // the following 'simulcast' property to pass to janus.js to true
                    simulcast: doSimulcast,
                    simulcast2: doSimulcast2,
                    success: function (jsep) {
                        // You can force a specific codec to use when publishing by using the
                        // audiocodec and videocodec properties, for instance:
                        // 		publish["audiocodec"] = "opus"
                        // to force Opus as the audio codec to use, or:
                        // 		publish["videocodec"] = "vp9"
                        // to force VP9 as the videocodec to use. In both case, though, forcing
                        // a codec will only work if: (1) the codec is actually in the SDP (and
                        // so the browser supports it), and (2) the codec is in the list of
                        // allowed codecs in a room. With respect to the point (2) above,
                        // refer to the text in janus.plugin.videoroom.cfg for more details
                        publisher.sendMessage({"message": message, "jsep": jsep});
                    },
                    error: function (error) {
                        logger.error("WebRTC error:", JSON.stringify(error));
                        callback(JSON.stringify(error));
                    }
                });
            } else {
                callback("room not exist");
            }
        });
    };

    /**
     * 直接加入房间并且发布视频,该步骤会创建publisher
     * @param options
     * @param callback
     */
    this.publishVideoToSession = function (options, callback) {

        callback =
            (typeof callback == "function") ? callback : noop;

        if (options === undefined || options === null) {
            callback("callbacks can not null");
            return;
        }

        if (remoteCloud === undefined || remoteCloud === null) {
            callback("remoteCloud null please init first");
            return;
        }

        if (!remoteCloud.isConnected()) {
            callback("wait RemoteCloud create success");
            return;
        }

        var roomname = options.roomname;
        if (roomname === undefined || roomname === null) {
            callback("username is null");
            return;
        }

        var username = options.username;
        if (username === undefined || username === null) {
            callback("username is null");
            return;
        }

        publisherName = username;

        if (publisher === undefined || publisher === null) {
            /*callback("wait pluginHandle create success");
            return;*/
            attachPublisherHandle(function (error) {
                if (error === null || error === undefined) {
                    roomExists(publisher, roomname, function (e) {
                        if (e === null || e === undefined) {
                            joinAndPublishVideo(callback);
                        } else {
                            that.createSession(options, function (er) {
                                if (er === undefined || er === null)
                                    joinAndPublishVideo(callback);

                            });
                        }
                    });
                }
            });
        } else {
            roomExists(publisher, roomname, function (e) {
                if (e === null || e === undefined) {
                    joinAndPublishVideo(callback);
                } else {
                    that.createSession(options, function (er) {
                        if (er === undefined || er === null)
                            joinAndPublishVideo(callback);

                    });
                }
            });
        }

        function joinAndPublishVideo(callback) {
            var audio = options.audio;
            if (audio === undefined || audio === null)
                audio = true;

            var video = options.video;
            if (video === undefined || video === null)
                video = true;

            var data = options.data;
            if (data === undefined || data === null)
                data = false;

            var message = {
                request: "joinandconfigure",
                "room": roomname,
                "ptype": "publisher",
                "display": username,
                audio: audio,
                video: video,
                data: data
            };

            if (options.audiocodec !== undefined && options.audiocodec !== null)
                message.audiocodec = options.audiocodec;

            if (options.videocodec !== undefined && options.videocodec !== null)
                message.videocodec = options.videocodec;

            if (options.bitrate !== undefined && options.bitrate !== null)
                message.bitrate = options.bitrate;

            if (options.record !== undefined && options.record !== null)
                message.record = options.record;

            if (options.filename !== undefined && options.filename !== null)
                message.filename = options.filename;

            if (options.username !== undefined && options.username !== null)
                message.display = options.username;

            var doSimulcast = options.doSimulcast || false;
            var doSimulcast2 = options.doSimulcast2 || false;

            // Publish our stream
            // Publishers are sendonly
            publisher.createOffer({
                // Add data:true here if you want to publish datachannels as well
                media: {audioRecv: false, videoRecv: false, audioSend: audio, videoSend: video, data: data},
                // If you want to test simulcasting (Chrome and Firefox only), then
                // pass a ?simulcast=true when opening this demo page: it will turn
                // the following 'simulcast' property to pass to janus.js to true
                simulcast: doSimulcast,
                simulcast2: doSimulcast2,
                success: function (jsep) {
                    // You can force a specific codec to use when publishing by using the
                    // audiocodec and videocodec properties, for instance:
                    // 		publish["audiocodec"] = "opus"
                    // to force Opus as the audio codec to use, or:
                    // 		publish["videocodec"] = "vp9"
                    // to force VP9 as the videocodec to use. In both case, though, forcing
                    // a codec will only work if: (1) the codec is actually in the SDP (and
                    // so the browser supports it), and (2) the codec is in the list of
                    // allowed codecs in a room. With respect to the point (2) above,
                    // refer to the text in janus.plugin.videoroom.cfg for more details
                    publisher.sendMessage({"message": message, "jsep": jsep});
                },
                error: function (error) {
                    logger.error("WebRTC error:", JSON.stringify(error));
                    callback(JSON.stringify(error));
                }
            });
        }
    };
    /**
     * 暂停发布视频
     * unpublish
     */
    this.unpublish = function () {
        if (publisher === undefined || publisher === null) {
            callbacks.error("wait pluginHandle create success");
            return;
        }
        var unpublish = {"request": "unpublish"};
        publisher.sendMessage({"message": unpublish});
    };

    /**
     * 开始从房间订阅视频
     * @param options
     * @param callback
     */
    this.subscribeVideoFromSession = function (options, callback) {
        var subscriber;
        callback =
            (typeof callback == "function") ? callback : noop;

        if (options === undefined || options === null) {
            callback("callbacks can not null");
            return;
        }

        if (remoteCloud === undefined || remoteCloud === null) {
            callback("remoteCloud null please init first");
            return;
        }

        if (!remoteCloud.isConnected()) {
            callback("wait RemoteCloud create success");
            return;
        }

        var roomName = options.roomname;
        if (roomName === undefined || roomName === null) {
            callback("roomName can not null");
            return;
        }

        /**
         * 你要从远程的那个publisher订阅视频？必须指定
         */
        var feedId = options.id;//远程用户ID
        if (feedId === undefined || feedId === null) {
            callback("roomName can not null");
            return;
        }

        var display = options.display;//远程用户的名称
        var audio_codec = options.audio_codec;//
        var video_codec = options.video_codec;//

        var message = {"request": "join", "room": roomName, "ptype": "subscriber", "feed": feedId};
        /*<unique ID of the publisher that originated this request; optional,
            unless mandated by the room configuration>,*/
        if (options.private_id !== undefined && options.private_id !== null)
            message.private_id = options.private_id;
        /*<true|false, depending on whether or not audio should be relayed; true by default>,*/
        if (options.audio !== undefined && options.audio !== null)
            message.audio = options.audio;
        /*<true|false, depending on whether or not video should be relayed; true by default>,*/
        if (options.video !== undefined && options.video !== null)
            message.video = options.video;
        /*<true|false, depending on whether or not data should be relayed; true by default>,*/
        if (options.data !== undefined && options.data !== null)
            message.data = options.data;
        /*<true|false; whether or not audio should be negotiated; true by default if the publisher has audio>*/
        if (options.offer_audio !== undefined && options.offer_audio !== null)
            message.offer_audio = options.offer_audio;
        /*<true|false; whether or not video should be negotiated; true by default if the publisher has video>*/
        if (options.offer_video !== undefined && options.offer_video !== null)
            message.offer_video = options.offer_video;
        /*<true|false; whether or not datachannels should be negotiated; true by default if the publisher has datachannels>*/
        if (options.offer_data !== undefined && options.offer_data !== null)
            message.offer_data = options.offer_data;
        /*<substream to receive (0-2), in case simulcasting is enabled; optional>*/
        if (options.substream !== undefined && options.substream !== null)
            message.substream = options.substream;
        /*<temporal layers to receive (0-2), in case simulcasting is enabled; optional>*/
        if (options.temporal !== undefined && options.temporal !== null)
            message.temporal = options.temporal;
        /*<spatial layer to receive (0-2), in case VP9-SVC is enabled; optional>,*/
        if (options.spatial_layer !== undefined && options.spatial_layer !== null)
            message.spatial_layer = options.spatial_layer;
        /*<temporal layers to receive (0-2), in case VP9-SVC is enabled; optional>*/
        if (options.temporal_layer !== undefined && options.temporal_layer !== null)
            message.temporal_layer = options.temporal_layer;

        var audioRecv = true;
        if (options.audioRecv !== undefined && options.audioRecv !== null)
            audioRecv = options.audioRecv;
        var videoRecv = true;
        if (options.videoRecv !== undefined && options.videoRecv !== null)
            videoRecv = options.videoRecv;

        var data = false;
        if (options.data !== undefined && options.data !== null)
            data = options.data;

        remoteCloud.attach({
            plugin: "janus.plugin.videoroom",
            opaqueId: opaqueId,
            success: function (pluginHandle) {
                //subscriber = new Subscriber(pluginHandle);
                roomExists(pluginHandle, roomName, function (error) {
                    if (error) {
                        callback(error);
                        pluginHandle.detach({noRequest: false});
                    } else {
                        subscriber = pluginHandle;
                        subscriber.simulcastStarted = false;
                        // In case you don't want to receive audio, video or data, even if the
                        // publisher is sending them, set the 'offer_audio', 'offer_video' or
                        // 'offer_data' properties to false (they're true by default), e.g.:
                        // 		subscribe["offer_video"] = false;
                        // For example, if the publisher is VP8 and this is Safari, let's avoid video
                        if (WebRtcPeer.webRTCAdapter.browserDetails.browser === "safari" &&
                            (video_codec === "vp9" || (video_codec === "vp8" && !WebRtcPeer.safariVp8))) {
                            if (video_codec)
                                video_codec = video_codec.toUpperCase();
                            /*toastr.warning("Publisher is using " + video + ", " +
                                "but Safari doesn't support it: disabling video");*/
                            message["offer_video"] = false;
                        }
                        subscriber.videoCodec = video_codec;
                        subscriber.sendMessage({"message": message});
                    }
                });
            },

            error: function (error) {
                logger.error("  -- Error attaching plugin...", error);
                callback(JSON.stringify(error));
            },

            onmessage: function (msg, jsep) {
                logger.log("subscriber:" + JSON.stringify(msg));
                var event = msg["videoroom"];
                if (msg["error"] !== undefined && msg["error"] !== null) {
                    callback(msg["error"]);
                } else if (event !== undefined && event !== null) {
                    if (event === "attached") {
                        subscriber.id = msg["id"];//对应要接收哪个远程publisher的流
                        subscriber.display = msg["display"];//对应要接收哪个远程publisher的名称
                        subscribers[subscriber.id] = subscriber;//以ID为索引将其存入到subscribers中
                        logger.log("Successfully attached to feed " + subscriber.id +
                            " (" + subscriber.display + ") in room " + msg["room"]);
                    } else if (event === "event") {
                        if (msg["left"] !== undefined && msg["left"] !== null) {
                            // One of the publishers has gone away?
                            var left = msg["left"];
                            logger.log("subscriber left: " + left);
                            if (left === "ok")
                                detachSubscriberHandle(subscriber.id);
                        }
                    }
                }

                if (jsep !== undefined && jsep !== null) {
                    var media = {
                        audioSend: false,
                        videoSend: false,
                        audioRecv: audioRecv,
                        videoRecv: videoRecv,
                        data: data
                    };
                    subscriber.createAnswer({
                        jsep: jsep,
                        // Add data:true here if you want to subscribe to datachannels as well
                        // (obviously only works if the publisher offered them in the first place)
                        media: media,// We want recvonly audio/video
                        success: function (jsep) {
                            var body = {"request": "start", "room": roomName};
                            subscriber.sendMessage({"message": body, "jsep": jsep});
                            //callbacks.success();
                            //callbacks.success(subscriber);
                            callback(null);//
                        },
                        error: function (error) {
                            callback(JSON.stringify(error));
                        }
                    });
                }
            },

            webrtcState: function (on) {
                logger.log("RemoteCloud says this WebRTC PeerConnection" +
                    " (feed #" + subscriber.rfid + ") is " + (on ? "up" : "down") + " now");
                callbacks.onWebRtcState({id: subscriber.id, display: subscriber.display}, on);
            },

            onlocalstream: function (stream) {
                // The subscriber stream is recvonly, we don't expect anything here
            },

            onremotestream: function (stream) {
                logger.log("Remote feed #" + subscriber.id);
                callbacks.onRemoteStream({id: subscriber.id, display: subscriber.display}, stream);
            },

            oncleanup: function () {
                //callbacks.onCleanup({id: subscriber.id, display: subscriber.display});
            }
        });
    };

    /**
     * 开始订阅
     * @param id
     * @param callback
     */
    this.startSubscription = function (id, /*roomname,*/ callback) {
        callback =
            (typeof callback == "function") ? callback : noop;
        if (id === undefined || id === null) {
            callback("subscriber id can not null");
            return;
        }

        var subscriber = subscribers[id];
        if (subscriber === null || subscriber === undefined || subscriber.detached) {
            delete subscribers[id];
            callback("subscriber not Aviable");
            return;
        }
        var body = {"request": "start"/*, "room": roomname*/};
        subscriber.sendMessage({"message": body});
    };

    /**
     * 停止订阅
     * @param id
     * @param callback
     */
    this.pauseSubscription = function (id, callback) {
        callback =
            (typeof callback == "function") ? callback : noop;
        if (id === undefined || id === null) {
            callback("subscriber id can not null");
            return;
        }
        var subscriber = subscribers[id];
        if (subscriber === null || subscriber === undefined || subscriber.detached) {
            delete subscribers[id];
            callback("subscriber not Aviable");
            return;
        }
        var body = {"request": "pause"/*, "room": roomname*/};
        subscriber.sendMessage({"message": body});
    };

    /**
     * 停止订阅,收到停止订阅的回复时需要dattach
     * @param id
     * @param callback
     */
    this.stopSubscription = function (id, callback) {
        callback =
            (typeof callback == "function") ? callback : noop;
        if (id === undefined || id === null) {
            callback("subscriber id can not null");
            return;
        }
        var subscriber = subscribers[id];
        if (subscriber === null || subscriber === undefined || subscriber.detached) {
            delete subscribers[id];
            callback("subscriber not Aviable");
            return;
        }
        var body = {"request": "leave"/*, "room": roomname*/};
        subscriber.sendMessage({"message": body});
    };

    /***
     * detach publisher,当离开房间的时候回调
     */
    function detachSubscriberHandle(id, callback) {
        callback =
            (typeof callback == "function") ? callback : noop;
        var subscriber = subscribers[id];
        if (subscriber === null || subscriber === undefined || subscriber.detached) {
            delete subscribers[id];
            callback("subscriber not Aviable");
            return;
        }
        var options = {
            success: function () {
                delete subscribers[id];
                subscriber = null;
                callback(null);
            },
            error: function (error) {
                callback(error);
            },
            noRequest: false
        };
        subscriber.detach(options);
    }

    this.getSubscriber =function (id) {
        var subscriber = subscribers[id];
        if (subscriber === null || subscriber === undefined || subscriber.detached) {
            delete subscribers[id];
            return;
        }
        return subscriber;
    };
}



