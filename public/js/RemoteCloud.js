var logger;

// List of sessions
RemoteCloud.sessions = {};

RemoteCloud.useDefaultDependencies = function (deps) {
    var f = (deps && deps.fetch) || fetch;
    var p = (deps && deps.Promise) || Promise;
    var socketCls = (deps && deps.WebSocket) || WebSocket;

    return {
        newWebSocket: function (server, proto) {
            return new socketCls(server, proto);
        },
        isArray: function (arr) {
            return Array.isArray(arr);
        },
        httpAPICall: function (url, options) {
            var fetchOptions = {
                method: options.verb,
                headers: {
                    'Accept': 'application/json, text/plain, */*'
                },
                cache: 'no-cache'
            };
            if (options.verb === "POST") {
                fetchOptions.headers['Content-Type'] = 'application/json';
            }
            if (options.withCredentials !== undefined) {
                fetchOptions.credentials = options.withCredentials === true ? 'include' : (options.withCredentials ? options.withCredentials : 'omit');
            }
            if (options.body !== undefined) {
                fetchOptions.body = JSON.stringify(options.body);
            }

            var fetching = f(url, fetchOptions).catch(function (error) {
                return p.reject({message: 'Probably a network error, is the server down?', error: error});
            });

            /*
			 * fetch() does not natively support timeouts.
			 * Work around this by starting a timeout manually, and racing it agains the fetch() to see which thing resolves first.
			 */

            if (options.timeout !== undefined) {
                var timeout = new p(function (resolve, reject) {
                    var timerId = setTimeout(function () {
                        clearTimeout(timerId);
                        return reject({message: 'Request timed out', timeout: options.timeout});
                    }, options.timeout);
                });
                fetching = p.race([fetching, timeout]);
            }

            fetching.then(function (response) {
                if (response.ok) {
                    if (typeof (options.success) === typeof (RemoteCloud.noop)) {
                        return response.json().then(function (parsed) {
                            options.success(parsed);
                        }).catch(function (error) {
                            return p.reject({
                                message: 'Failed to parse response body',
                                error: error,
                                response: response
                            });
                        });
                    }
                } else {
                    return p.reject({message: 'API call failed', response: response});
                }
            }).catch(function (error) {
                if (typeof (options.error) === typeof (RemoteCloud.noop)) {
                    options.error(error.message || '<< internal error >>', error);
                }
            });

            return fetching;
        }
    }
};

RemoteCloud.useOldDependencies = function (deps) {
    var jq = (deps && deps.jQuery) || jQuery;
    var socketCls = (deps && deps.WebSocket) || WebSocket;
    return {
        newWebSocket: function (server, proto) {
            return new socketCls(server, proto);
        },

        isArray: function (arr) {
            return jq.isArray(arr);
        },

        httpAPICall: function (url, options) {
            var payload = options.body !== undefined ? {
                contentType: 'application/json',
                data: JSON.stringify(options.body)
            } : {};
            var credentials = options.withCredentials !== undefined ? {xhrFields: {withCredentials: options.withCredentials}} : {};

            return jq.ajax(jq.extend(payload, credentials, {
                url: url,
                type: options.verb,
                cache: false,
                dataType: 'json',
                async: options.async,
                timeout: options.timeout,
                success: function (result) {
                    if (typeof (options.success) === typeof (RemoteCloud.noop)) {
                        options.success(result);
                    }
                },
                error: function (xhr, status, err) {
                    if (typeof (options.error) === typeof (RemoteCloud.noop)) {
                        options.error(status, err);
                    }
                }
            }));
        },
    };
};

RemoteCloud.noop = function () {
};

// Initialization
RemoteCloud.init = function (options) {
    options = options || {};
    options.callback = (typeof options.callback == "function") ? options.callback : RemoteCloud.noop;
    if (RemoteCloud.initDone === true) {
        // Already initialized
        options.callback();
    } else {
        logger = new Logger(options);
        logger.log("Initializing RemoteCloud library");
        var usedDependencies = options.dependencies || RemoteCloud.useDefaultDependencies();
        RemoteCloud.isArray = usedDependencies.isArray;
        RemoteCloud.httpAPICall = usedDependencies.httpAPICall;
        RemoteCloud.newWebSocket = usedDependencies.newWebSocket;

        // Detect tab close: make sure we don't loose existing onbeforeunload handlers
        // (note: for iOS we need to subscribe to a different event, 'pagehide', see
        // https://gist.github.com/thehunmonkgroup/6bee8941a49b86be31a787fe8f4b8cfe)
        var iOS = ['iPad', 'iPhone', 'iPod'].indexOf(navigator.platform) >= 0;
        var eventName = iOS ? 'pagehide' : 'beforeunload';
        var oldOBF = window["on" + eventName];
        window.addEventListener(eventName, function (event) {
            logger.log("Closing window");
            for (var s in RemoteCloud.sessions) {
                if (RemoteCloud.sessions[s] !== null && RemoteCloud.sessions[s] !== undefined &&
                    RemoteCloud.sessions[s].destroyOnUnload) {
                    logger.log("Destroying session " + s);
                    RemoteCloud.sessions[s].destroy({asyncRequest: false, notifyDestroyed: false});
                }
            }
            if (oldOBF && typeof oldOBF == "function")
                oldOBF();
        });

        RemoteCloud.initDone = true;
        options.callback();
    }
};

// Helper method to create random identifiers (e.g., transaction)
RemoteCloud.randomString = function (len) {
    var charSet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var randomString = '';
    for (var i = 0; i < len; i++) {
        var randomPoz = Math.floor(Math.random() * charSet.length);
        randomString += charSet.substring(randomPoz, randomPoz + 1);
    }
    return randomString;
};

function RemoteCloud(gatewayCallbacks) {
    var websockets = false;
    var ws = null;
    var wsHandlers = {};
    var wsKeepaliveTimeoutId = null;
    logger.log("RemoteCloud initialized: ");
    gatewayCallbacks = gatewayCallbacks || {};
    gatewayCallbacks.success = (typeof gatewayCallbacks.success == "function") ? gatewayCallbacks.success : RemoteCloud.noop;
    gatewayCallbacks.error = (typeof gatewayCallbacks.error == "function") ? gatewayCallbacks.error : RemoteCloud.noop;
    gatewayCallbacks.destroyed = (typeof gatewayCallbacks.destroyed == "function") ? gatewayCallbacks.destroyed : RemoteCloud.noop;

    if (gatewayCallbacks.server === null || gatewayCallbacks.server === undefined) {
        gatewayCallbacks.error("Invalid server url");
        return {};
    }

    var servers = null, serversIndex = 0;
    var server = gatewayCallbacks.server;

    if (RemoteCloud.isArray(server)) {
        logger.log("Multiple servers provided (" + server.length + "), will use the first that works");
        server = null;
        servers = gatewayCallbacks.server;
        logger.debug(servers);
    } else {
        if (server.indexOf("ws") === 0) {
            websockets = true;
            logger.log("Using WebSockets to contact RemoteCloud: " + server);
        } else {
            websockets = false;
            logger.log("Using REST API to contact RemoteCloud: " + server);
        }
    }
    // Whether we should enable the withCredentials flag for XHR requests
    var withCredentials = false;
    if (gatewayCallbacks.withCredentials !== undefined && gatewayCallbacks.withCredentials !== null)
        withCredentials = gatewayCallbacks.withCredentials === true;
    // Optional max events
    var maxev = 10;
    if (gatewayCallbacks.max_poll_events !== undefined && gatewayCallbacks.max_poll_events !== null)
        maxev = gatewayCallbacks.max_poll_events;
    if (maxev < 1)
        maxev = 1;
    // Token to use (only if the token based authentication mechanism is enabled)
    var token = null;
    if (gatewayCallbacks.token !== undefined && gatewayCallbacks.token !== null)
        token = gatewayCallbacks.token;
    // API secret to use (only if the shared API secret is enabled)
    var apisecret = null;
    if (gatewayCallbacks.apisecret !== undefined && gatewayCallbacks.apisecret !== null)
        apisecret = gatewayCallbacks.apisecret;
    // Whether we should destroy this session when onbeforeunload is called
    this.destroyOnUnload = true;
    if (gatewayCallbacks.destroyOnUnload !== undefined && gatewayCallbacks.destroyOnUnload !== null)
        this.destroyOnUnload = (gatewayCallbacks.destroyOnUnload === true);
    // Some timeout-related values
    var keepAlivePeriod = 25000;
    if (gatewayCallbacks.keepAlivePeriod !== undefined && gatewayCallbacks.keepAlivePeriod !== null)
        keepAlivePeriod = gatewayCallbacks.keepAlivePeriod;
    if (isNaN(keepAlivePeriod))
        keepAlivePeriod = 25000;
    var longPollTimeout = 60000;
    if (gatewayCallbacks.longPollTimeout !== undefined && gatewayCallbacks.longPollTimeout !== null)
        longPollTimeout = gatewayCallbacks.longPollTimeout;
    if (isNaN(longPollTimeout))
        longPollTimeout = 60000;

    var connected = false;
    var sessionId = null;
    var pluginHandles = {};
    var that = this;
    var retries = 0;
    var transactions = {};

    createSession(gatewayCallbacks);

    // Public methods
    this.getServer = function () {
        return server;
    };

    this.isConnected = function () {
        return connected;
    };

    this.reconnect = function (callbacks) {
        callbacks = callbacks || {};
        callbacks.success = (typeof callbacks.success == "function") ? callbacks.success : RemoteCloud.noop;
        callbacks.error = (typeof callbacks.error == "function") ? callbacks.error : RemoteCloud.noop;
        callbacks["reconnect"] = true;
        createSession(callbacks);
    };

    this.getSessionId = function () {
        return sessionId;
    };

    this.destroy = function (callbacks) {
        destroySession(callbacks);
    };

    this.attach = function (callbacks) {
        createHandle(callbacks);
    };

    function eventHandler() {
        if (sessionId == null)
            return;
        logger.debug('Long poll...');
        if (!connected) {
            logger.warn("Is the server down? (connected=false)");
            return;
        }
        var longpoll = server + "/" + sessionId + "?rid=" + new Date().getTime();
        if (maxev !== undefined && maxev !== null)
            longpoll = longpoll + "&maxev=" + maxev;
        if (token !== null && token !== undefined)
            longpoll = longpoll + "&token=" + encodeURIComponent(token);
        if (apisecret !== null && apisecret !== undefined)
            longpoll = longpoll + "&apisecret=" + encodeURIComponent(apisecret);
        RemoteCloud.httpAPICall(longpoll, {
            verb: 'GET',
            withCredentials: withCredentials,
            success: handleMessage,
            timeout: longPollTimeout,
            error: function (textStatus, errorThrown) {
                logger.error(textStatus + ":", errorThrown);
                retries++;
                if (retries > 3) {
                    // Did we just lose the server? :-(
                    connected = false;
                    gatewayCallbacks.error("Lost connection to the server (is it down?)");
                    return;
                }
                eventHandler();
            }
        });
    }

    // Private event handler: this will trigger plugin callbacks, if set
    function handleMessage(json, skipTimeout) {
        retries = 0;
        if (!websockets && sessionId !== undefined && sessionId !== null && skipTimeout !== true)
            eventHandler();
        if (!websockets && RemoteCloud.isArray(json)) {
            // We got an array: it means we passed a maxev > 1, iterate on all objects
            for (var i = 0; i < json.length; i++) {
                handleMessage(json[i], true);
            }
            return;
        }

        logger.log("recv:" + JSON.stringify(json));

        switch (json["janus"]) {
            case 'keepalive':
                handleKeepalive(json);
                break;
            case 'ack':
                handleAck(json);
                break;
            case 'success':
                handleSuccess(json);
                break;
            case 'trickle':
                handleTrickle(json);
                break;
            case 'webrtcup':
                handleWebRtcup(json);
                break;
            case 'hangup':
                handleHangup(json);
                break;
            case 'detached':
                handleDetached(json);
                break;
            case 'media':
                handleMedia(json);
                break;
            case 'slowlink':
                handleSlowlink(json);
                break;
            case 'error':
                handleError(json);
                break;
            case 'event':
                handleEvent(json);
                break;
            case 'timeout':
                handleTimeout(json);
                break;
            default:
                // Ignore the message
                logger.warn("Unknown message/event  '" + json["janus"] + "' on session " + sessionId);
                logger.debug(json);
                break;
        }
    }

    // Private helper to send keep-alive messages on WebSockets
    function keepAlive() {
        if (server === null || !websockets || !connected)
            return;
        wsKeepaliveTimeoutId = setTimeout(keepAlive, keepAlivePeriod);
        var request = {"janus": "keepalive", "session_id": sessionId, "transaction": RemoteCloud.randomString(12)};
        if (token !== null && token !== undefined)
            request["token"] = token;
        if (apisecret !== null && apisecret !== undefined)
            request["apisecret"] = apisecret;
        ws.send(JSON.stringify(request));
    }

    // Private method to create a session
    function createSession(callbacks) {
        var transaction = RemoteCloud.randomString(12);
        var request = {"janus": "create", "transaction": transaction};
        if (callbacks["reconnect"]) {
            // We're reconnecting, claim the session
            connected = false;
            request["janus"] = "claim";
            request["session_id"] = sessionId;
            // If we were using websockets, ignore the old connection
            if (ws) {
                ws.onopen = null;
                ws.onerror = null;
                ws.onclose = null;
                if (wsKeepaliveTimeoutId) {
                    clearTimeout(wsKeepaliveTimeoutId);
                    wsKeepaliveTimeoutId = null;
                }
            }
        }
        if (token !== null && token !== undefined)
            request["token"] = token;
        if (apisecret !== null && apisecret !== undefined)
            request["apisecret"] = apisecret;
        if (server === null && RemoteCloud.isArray(servers)) {
            // We still need to find a working server from the list we were given
            server = servers[serversIndex];
            if (server.indexOf("ws") === 0) {
                websockets = true;
                logger.log("Server #" + (serversIndex + 1) + ": trying WebSockets to contact RemoteCloud (" + server + ")");
            } else {
                websockets = false;
                logger.log("Server #" + (serversIndex + 1) + ": trying REST API to contact RemoteCloud (" + server + ")");
            }
        }
        if (websockets) {
            ws = RemoteCloud.newWebSocket(server, 'janus-protocol');
            wsHandlers = {
                'error': function () {
                    logger.error("Error connecting to the RemoteCloud WebSockets server... " + server);
                    if (RemoteCloud.isArray(servers) && !callbacks["reconnect"]) {
                        serversIndex++;
                        if (serversIndex == servers.length) {
                            // We tried all the servers the user gave us and they all failed
                            callbacks.error("Error connecting to any of the provided RemoteCloud servers: Is the server down?");
                            return;
                        }
                        // Let's try the next server
                        server = null;
                        setTimeout(function () {
                            createSession(callbacks);
                        }, 200);
                        return;
                    }
                    callbacks.error("Error connecting to the RemoteCloud WebSockets server: Is the server down?");
                },

                'open': function () {
                    // We need to be notified about the success
                    transactions[transaction] = function (json) {
                        logger.debug(json);
                        if (json["janus"] !== "success") {
                            logger.error("Ooops: " + json["error"].code + " " + json["error"].reason);	// FIXME
                            callbacks.error(json["error"].reason);
                            return;
                        }
                        wsKeepaliveTimeoutId = setTimeout(keepAlive, keepAlivePeriod);
                        connected = true;
                        sessionId = json["session_id"] ? json["session_id"] : json.data["id"];
                        if (callbacks["reconnect"]) {
                            logger.log("Claimed session: " + sessionId);
                        } else {
                            logger.log("Created session: " + sessionId);
                        }
                        RemoteCloud.sessions[sessionId] = that;
                        callbacks.success();
                    };
                    ws.send(JSON.stringify(request));
                },

                'message': function (event) {
                    handleMessage(JSON.parse(event.data));
                },

                'close': function () {
                    if (server === null || !connected) {
                        return;
                    }
                    connected = false;
                    // FIXME What if this is called when the page is closed?
                    gatewayCallbacks.error("Lost connection to the server (is it down?)");
                }
            };

            for (var eventName in wsHandlers) {
                ws.addEventListener(eventName, wsHandlers[eventName]);
            }

            return;
        }
        RemoteCloud.httpAPICall(server, {
            verb: 'POST',
            withCredentials: withCredentials,
            body: request,
            success: function (json) {
                logger.debug(json);
                if (json["janus"] !== "success") {
                    logger.error("Ooops: " + json["error"].code + " " + json["error"].reason);	// FIXME
                    callbacks.error(json["error"].reason);
                    return;
                }
                connected = true;
                sessionId = json["session_id"] ? json["session_id"] : json.data["id"];
                if (callbacks["reconnect"]) {
                    logger.log("Claimed session: " + sessionId);
                } else {
                    logger.log("Created session: " + sessionId);
                }
                RemoteCloud.sessions[sessionId] = that;
                eventHandler();
                callbacks.success();
            },
            error: function (textStatus, errorThrown) {
                logger.error(textStatus + ":", errorThrown);	// FIXME
                if (RemoteCloud.isArray(servers) && !callbacks["reconnect"]) {
                    serversIndex++;
                    if (serversIndex == servers.length) {
                        // We tried all the servers the user gave us and they all failed
                        callbacks.error("Error connecting to any of the provided RemoteCloud servers: Is the server down?");
                        return;
                    }
                    // Let's try the next server
                    server = null;
                    setTimeout(function () {
                        createSession(callbacks);
                    }, 200);
                    return;
                }
                if (errorThrown === "")
                    callbacks.error(textStatus + ": Is the server down?");
                else
                    callbacks.error(textStatus + ": " + errorThrown);
            }
        });
    }

    // Private method to destroy a session
    function destroySession(callbacks) {
        callbacks = callbacks || {};
        // FIXME This method triggers a success even when we fail
        callbacks.success = (typeof callbacks.success == "function") ? callbacks.success : RemoteCloud.noop;
        var asyncRequest = true;
        if (callbacks.asyncRequest !== undefined && callbacks.asyncRequest !== null)
            asyncRequest = (callbacks.asyncRequest === true);
        var notifyDestroyed = true;
        if (callbacks.notifyDestroyed !== undefined && callbacks.notifyDestroyed !== null)
            notifyDestroyed = (callbacks.notifyDestroyed === true);
        var cleanupHandles = false;
        if (callbacks.cleanupHandles !== undefined && callbacks.cleanupHandles !== null)
            cleanupHandles = (callbacks.cleanupHandles === true);
        logger.log("Destroying session " + sessionId + " (async=" + asyncRequest + ")");
        if (!connected) {
            logger.warn("Is the server down? (connected=false)");
            callbacks.success();
            return;
        }
        if (sessionId === undefined || sessionId === null) {
            logger.warn("No session to destroy");
            callbacks.success();
            if (notifyDestroyed)
                gatewayCallbacks.destroyed();
            return;
        }
        if (cleanupHandles) {
            for (var handleId in pluginHandles)
                that.destroyHandle(handleId, {noRequest: true});
        }
        // No need to destroy all handles first, RemoteCloud will do that itself
        var request = {"janus": "destroy", "transaction": RemoteCloud.randomString(12)};
        if (token !== null && token !== undefined)
            request["token"] = token;
        if (apisecret !== null && apisecret !== undefined)
            request["apisecret"] = apisecret;
        if (websockets) {
            request["session_id"] = sessionId;

            var unbindWebSocket = function () {
                for (var eventName in wsHandlers) {
                    ws.removeEventListener(eventName, wsHandlers[eventName]);
                }
                ws.removeEventListener('message', onUnbindMessage);
                ws.removeEventListener('error', onUnbindError);
                if (wsKeepaliveTimeoutId) {
                    clearTimeout(wsKeepaliveTimeoutId);
                }
                ws.close();
            };

            var onUnbindMessage = function (event) {
                var data = JSON.parse(event.data);
                if (data.session_id === request.session_id
                    && data.transaction === request.transaction) {
                    unbindWebSocket();
                    callbacks.success();
                    if (notifyDestroyed)
                        gatewayCallbacks.destroyed();
                }
            };
            var onUnbindError = function (event) {
                unbindWebSocket();
                callbacks.error("Failed to destroy the server: Is the server down?");
                if (notifyDestroyed)
                    gatewayCallbacks.destroyed();
            };

            ws.addEventListener('message', onUnbindMessage);
            ws.addEventListener('error', onUnbindError);

            ws.send(JSON.stringify(request));
            return;
        }
        RemoteCloud.httpAPICall(server + "/" + sessionId, {
            verb: 'POST',
            async: asyncRequest,	// Sometimes we need false here, or destroying in onbeforeunload won't work
            withCredentials: withCredentials,
            body: request,
            success: function (json) {
                logger.log("Destroyed session:");
                logger.debug(json);
                sessionId = null;
                connected = false;
                if (json["janus"] !== "success") {
                    logger.error("Ooops: " + json["error"].code + " " + json["error"].reason);	// FIXME
                }
                callbacks.success();
                if (notifyDestroyed)
                    gatewayCallbacks.destroyed();
            },
            error: function (textStatus, errorThrown) {
                logger.error(textStatus + ":", errorThrown);	// FIXME
                // Reset everything anyway
                sessionId = null;
                connected = false;
                callbacks.success();
                if (notifyDestroyed)
                    gatewayCallbacks.destroyed();
            }
        });
    }

    // Private method to create a plugin handle
    function createHandle(callbacks) {
        callbacks = callbacks || {};
        logger.log("start createHandle!!!");
        if (!connected) {
            logger.warn("Is the server down? (connected=false)");
            callbacks.error("Is the server down? (connected=false)");
            return;
        }
        var plugin = callbacks.plugin;
        if (plugin === undefined || plugin === null) {
            logger.error("Invalid plugin");
            callbacks.error("Invalid plugin");
            return;
        }
        var opaqueId = callbacks.opaqueId;
        var handleToken = callbacks.token ? callbacks.token : token;
        var transaction = RemoteCloud.randomString(12);
        var request = {"janus": "attach", "plugin": plugin, "opaque_id": opaqueId, "transaction": transaction};
        if (handleToken !== null && handleToken !== undefined)
            request["token"] = handleToken;
        if (apisecret !== null && apisecret !== undefined)
            request["apisecret"] = apisecret;
        var transmit = callbacks.transmit ? callbacks.transmit : null;
        if (transmit !== null && transmit !== undefined)
            request["transmit"] = transmit;

        if (websockets) {
            transactions[transaction] = function (json) {
                logger.debug(json);
                if (json["janus"] !== "success") {
                    logger.error("Ooops: " + json["error"].code + " " + json["error"].reason);	// FIXME
                    callbacks.error("Ooops: " + json["error"].code + " " + json["error"].reason);
                    return;
                }
                var handleId = json.data["id"];
                callbacks.session = that;
                callbacks.handleId = handleId;
                callbacks.token = handleToken;
                callbacks.detached = false;
                logger.log("Created handle: " + handleId);
                var pluginHandle = new PluginHandle(callbacks);
                pluginHandles[handleId] = pluginHandle;
                callbacks.success(pluginHandle);
            };
            request["session_id"] = sessionId;
            ws.send(JSON.stringify(request));
            return;
        }
        RemoteCloud.httpAPICall(server + "/" + sessionId, {
            verb: 'POST',
            withCredentials: withCredentials,
            body: request,
            success: function (json) {
                logger.debug(json);
                if (json["janus"] !== "success") {
                    logger.error("Ooops: " + json["error"].code + " " + json["error"].reason);	// FIXME
                    callbacks.error("Ooops: " + json["error"].code + " " + json["error"].reason);
                    return;
                }
                var handleId = json.data["id"];
                logger.log("Created handle: " + handleId);
                callbacks.session = that;
                callbacks.handleId = handleId;
                callbacks.token = handleToken;
                callbacks.detached = false;
                logger.log("Created handle: " + handleId);
                var pluginHandle = new PluginHandle(callbacks);
                pluginHandles[handleId] = pluginHandle;
                callbacks.success(pluginHandle);
            },
            error: function (textStatus, errorThrown) {
                logger.error(textStatus + ":", errorThrown);	// FIXME
            }
        });
    }

    // Private method to destroy a plugin handle
    this.destroyHandle = function (handleId, callbacks) {
        callbacks = callbacks || {};
        callbacks.success = (typeof callbacks.success == "function") ? callbacks.success : RemoteCloud.noop;
        callbacks.error = (typeof callbacks.error == "function") ? callbacks.error : RemoteCloud.noop;
        var asyncRequest = true;
        if (callbacks.asyncRequest !== undefined && callbacks.asyncRequest !== null)
            asyncRequest = (callbacks.asyncRequest === true);
        var noRequest = true;
        if (callbacks.noRequest !== undefined && callbacks.noRequest !== null)
            noRequest = (callbacks.noRequest === true);
        logger.log("Destroying handle " + handleId + " (async=" + asyncRequest + ")");

        this.cleanupWebrtc(handleId);

        var pluginHandle = pluginHandles[handleId];
        if (pluginHandle === null || pluginHandle === undefined
            || pluginHandle.detached) {
            // Plugin was already detached by RemoteCloud, calling detach again will return a handle not found error, so just exit here
            delete pluginHandles[handleId];
            callbacks.success();
            return;
        }

        if (noRequest) {
            // We're only removing the handle locally
            delete pluginHandles[handleId];
            callbacks.success();
            return;
        }

        if (!connected) {
            logger.warn("Is the server down? (connected=false)");
            callbacks.error("Is the server down? (connected=false)");
            return;
        }

        var request = {"janus": "detach", "transaction": RemoteCloud.randomString(12)};
        if (pluginHandle.token !== null && pluginHandle.token !== undefined)
            request["token"] = pluginHandle.token;

        if (apisecret !== null && apisecret !== undefined)
            request["apisecret"] = apisecret;
        if (websockets) {
            request["session_id"] = sessionId;
            request["handle_id"] = handleId;
            ws.send(JSON.stringify(request));
            delete pluginHandles[handleId];
            callbacks.success();
            return;
        }

        RemoteCloud.httpAPICall(server + "/" + sessionId + "/" + handleId, {
            verb: 'POST',
            async: asyncRequest,	// Sometimes we need false here, or destroying in onbeforeunload won't work
            withCredentials: withCredentials,
            body: request,
            success: function (json) {
                logger.log("Destroyed handle:");
                logger.debug(json);
                if (json["janus"] !== "success") {
                    logger.error("Ooops: " + json["error"].code + " " + json["error"].reason);	// FIXME
                }
                delete pluginHandles[handleId];
                callbacks.success();
            },
            error: function (textStatus, errorThrown) {
                logger.error(textStatus + ":", errorThrown);	// FIXME
                // We cleanup anyway
                delete pluginHandles[handleId];
                callbacks.success();
            }
        });
    };

    this.sendMessage = function (handleId, callbacks) {
        callbacks = callbacks || {};
        callbacks.success = (typeof callbacks.success == "function") ? callbacks.success : RemoteCloud.noop;
        callbacks.error = (typeof callbacks.error == "function") ? callbacks.error : RemoteCloud.noop;
        if (!connected) {
            logger.warn("Is the server down? (connected=false)");
            callbacks.error("Is the server down? (connected=false)");
            return;
        }
        var pluginHandle = pluginHandles[handleId];
        if (pluginHandle === null || pluginHandle === undefined) {
            logger.warn("Invalid handle");
            callbacks.error("Invalid handle");
            return;
        }

        var message = callbacks.message;
        var jsep = callbacks.jsep;
        var transaction = RemoteCloud.randomString(12);
        var request = {"janus": "message", "body": message, "transaction": transaction};

        if (pluginHandle.token !== null
            && pluginHandle.token !== undefined)
            request["token"] = pluginHandle.token;
        if (apisecret !== null && apisecret !== undefined)
            request["apisecret"] = apisecret;
        if (jsep !== null && jsep !== undefined)
            request.jsep = jsep;

        logger.debug("Sending message to plugin (handle=" + handleId + "):");
        logger.debug(request);
        if (websockets) {
            request["session_id"] = sessionId;
            request["handle_id"] = handleId;
            transactions[transaction] = function (json) {
                logger.debug("Message sent!");
                logger.debug(json);
                if (json["janus"] === "success") {
                    // We got a success, must have been a synchronous transaction
                    var plugindata = json["plugindata"];
                    if (plugindata === undefined || plugindata === null) {
                        logger.warn("Request succeeded, but missing plugindata...");
                        callbacks.success();
                        return;
                    }
                    logger.log("Synchronous transaction successful (" + plugindata["plugin"] + ")");
                    var data = plugindata["data"];
                    logger.debug(data);
                    callbacks.success(data);
                    return;
                } else if (json["janus"] !== "ack") {
                    // Not a success and not an ack, must be an error
                    if (json["error"] !== undefined && json["error"] !== null) {
                        logger.error("Ooops: " + json["error"].code + " " + json["error"].reason);	// FIXME
                        callbacks.error(json["error"].code + " " + json["error"].reason);
                    } else {
                        logger.error("Unknown error");	// FIXME
                        callbacks.error("Unknown error");
                    }
                    return;
                }
                // If we got here, the plugin decided to handle the request asynchronously
                callbacks.success();
            };
            ws.send(JSON.stringify(request));
            return;
        }
        RemoteCloud.httpAPICall(server + "/" + sessionId + "/" + handleId, {
            verb: 'POST',
            withCredentials: withCredentials,
            body: request,
            success: function (json) {
                logger.debug("Message sent!");
                logger.debug(json);
                if (json["janus"] === "success") {
                    // We got a success, must have been a synchronous transaction
                    var plugindata = json["plugindata"];
                    if (plugindata === undefined || plugindata === null) {
                        logger.warn("Request succeeded, but missing plugindata...");
                        callbacks.success();
                        return;
                    }
                    logger.log("Synchronous transaction successful (" + plugindata["plugin"] + ")");
                    var data = plugindata["data"];
                    logger.debug(data);
                    callbacks.success(data);
                    return;
                } else if (json["janus"] !== "ack") {
                    // Not a success and not an ack, must be an error
                    if (json["error"] !== undefined && json["error"] !== null) {
                        logger.error("Ooops: " + json["error"].code + " " + json["error"].reason);	// FIXME
                        callbacks.error(json["error"].code + " " + json["error"].reason);
                    } else {
                        logger.error("Unknown error");	// FIXME
                        callbacks.error("Unknown error");
                    }
                    return;
                }
                // If we got here, the plugin decided to handle the request asynchronously
                callbacks.success();
            },
            error: function (textStatus, errorThrown) {
                logger.error(textStatus + ":", errorThrown);	// FIXME
                callbacks.error(textStatus + ": " + errorThrown);
            }
        });
    };

    this.sendTrickleCandidate = function (handleId, candidate) {

        if (!connected) {
            logger.warn("Is the server down? (connected=false)");
            return;
        }
        var pluginHandle = pluginHandles[handleId];
        if (pluginHandle === null || pluginHandle === undefined) {
            logger.warn("Invalid handle");
            return;
        }

        var request = {"janus": "trickle", "candidate": candidate, "transaction": RemoteCloud.randomString(12)};
        if (pluginHandle.token !== null && pluginHandle.token !== undefined)
            request["token"] = pluginHandle.token;
        if (apisecret !== null && apisecret !== undefined)
            request["apisecret"] = apisecret;

        logger.vdebug("Sending trickle candidate (handle=" + handleId + "):");
        logger.vdebug(request);
        if (websockets) {
            request["session_id"] = sessionId;
            request["handle_id"] = handleId;
            ws.send(JSON.stringify(request));
            return;
        }
        RemoteCloud.httpAPICall(server + "/" + sessionId + "/" + handleId, {
            verb: 'POST',
            withCredentials: withCredentials,
            body: request,
            success: function (json) {
                logger.vdebug("Candidate sent!");
                logger.vdebug(json);
                if (json["janus"] !== "ack") {
                    logger.error("Ooops: " + json["error"].code + " " + json["error"].reason);	// FIXME
                    return;
                }
            },
            error: function (textStatus, errorThrown) {
                logger.error(textStatus + ":", errorThrown);	// FIXME
            }
        });
    };

    this.cleanupWebrtc = function (handleId) {
        var pluginHandle = pluginHandles[handleId];
        if (pluginHandle === null || pluginHandle === undefined) {
            // Nothing to clean
            return;
        }
        // Send a hangup request (we don't really care about the response)
        var request = {"janus": "hangup", "transaction": RemoteCloud.randomString(12)};
        if (pluginHandle.token !== null && pluginHandle.token !== undefined)
            request["token"] = pluginHandle.token;
        if (apisecret !== null && apisecret !== undefined)
            request["apisecret"] = apisecret;

        logger.debug("Sending hangup request (handle=" + handleId + "):");
        logger.debug(request);
        if (websockets) {
            request["session_id"] = sessionId;
            request["handle_id"] = handleId;
            ws.send(JSON.stringify(request));
        } else {
            RemoteCloud.httpAPICall(server + "/" + sessionId + "/" + handleId, {
                verb: 'POST',
                withCredentials: withCredentials,
                body: request
            });
        }
    };

    /*
        **RemoteCloud函数发过来的响应
    * ************************/
    function handleKeepalive(json) {
        // Nothing happened
        logger.vdebug("Got a keepalive on session " + sessionId);
    }

    /**
     * 获取transaction
     * @param json
     */
    function handleAck(json) {
        // Just an ack, we can probably ignore
        logger.debug("Got an ack on session " + sessionId);
        logger.debug(json);
        var transaction = json["transaction"];
        if (transaction !== null && transaction !== undefined) {
            var reportSuccess = transactions[transaction];
            if (reportSuccess !== null && reportSuccess !== undefined) {
                reportSuccess(json);
            }
            delete transactions[transaction];
        }
    }

    /**
     *
     * @param json
     */
    function handleSuccess(json) {
        // Success!
        logger.debug("Got a success on session " + sessionId);
        logger.debug(json);
        var transaction = json["transaction"];
        if (transaction !== null && transaction !== undefined) {
            var reportSuccess = transactions[transaction];
            if (reportSuccess !== null && reportSuccess !== undefined) {
                reportSuccess(json);
            }
            delete transactions[transaction];
        }
    }

    /**
     *
     * @param json
     */
    function handleTrickle(json) {
        // We got a trickle candidate from RemoteCloud
        var sender = json["sender"];
        if (sender === undefined || sender === null) {
            logger.warn("Missing sender...");
            return;
        }
        var pluginHandle = pluginHandles[sender];
        if (pluginHandle === undefined || pluginHandle === null) {
            logger.debug("This handle is not attached to this session");
            return;
        }
        var candidate = json["candidate"];//add it to plugin
        pluginHandle.addRemoteIceCandidate(candidate);
    }

    /**
     *
     * @param json
     */
    function handleWebRtcup(json) {
        // The PeerConnection with the server is up! Notify this
        logger.debug("Got a webrtcup event on session " + sessionId);
        logger.debug(json);
        var sender = json["sender"];
        if (sender === undefined || sender === null) {
            logger.warn("Missing sender...");
            return;
        }
        var pluginHandle = pluginHandles[sender];
        if (pluginHandle === undefined || pluginHandle === null) {
            logger.debug("This handle is not attached to this session");
            return;
        }
        pluginHandle.webrtcState(true);
    }

    /**
     *
     * @param json
     */
    function handleHangup(json) {
        // A plugin asked the core to hangup a PeerConnection on one of our handles
        logger.debug("Got a hangup event on session " + sessionId);
        logger.debug(json);
        var sender = json["sender"];
        if (sender === undefined || sender === null) {
            logger.warn("Missing sender...");
            return;
        }
        var pluginHandle = pluginHandles[sender];
        if (pluginHandle === undefined || pluginHandle === null) {
            logger.debug("This handle is not attached to this session");
            return;
        }
        pluginHandle.webrtcState(false, json["reason"]);
        pluginHandle.hangup();
    }

    /**
     *
     * @param json
     */
    function handleDetached(json) {
        // A plugin asked the core to detach one of our handles
        logger.debug("Got a detached event on session " + sessionId);
        logger.debug(json);
        var sender = json["sender"];
        if (sender === undefined || sender === null) {
            logger.warn("Missing sender...");
            return;
        }
        var pluginHandle = pluginHandles[sender];
        if (pluginHandle === undefined || pluginHandle === null) {
            // Don't warn here because destroyHandle causes this situation.
            return;
        }
        pluginHandle.detached = true;
        pluginHandle.ondetached();
        pluginHandle.detach();
    }

    /**
     *
     * @param json
     */
    function handleMedia(json) {
        // Media started/stopped flowing
        logger.debug("Got a media event on session " + sessionId);
        logger.debug(json);
        var sender = json["sender"];
        if (sender === undefined || sender === null) {
            logger.warn("Missing sender...");
            return;
        }
        var pluginHandle = pluginHandles[sender];
        if (pluginHandle === undefined || pluginHandle === null) {
            logger.debug("This handle is not attached to this session");
            return;
        }
        pluginHandle.mediaState(json["type"], json["receiving"]);
    }

    /**
     *
     * @param json
     */
    function handleSlowlink(json) {
        logger.debug("Got a slowlink event on session " + sessionId);
        logger.debug(json);
        // Trouble uplink or downlink
        var sender = json["sender"];
        if (sender === undefined || sender === null) {
            logger.warn("Missing sender...");
            return;
        }
        var pluginHandle = pluginHandles[sender];
        if (pluginHandle === undefined || pluginHandle === null) {
            logger.debug("This handle is not attached to this session");
            return;
        }
        pluginHandle.slowLink(json["uplink"], json["lost"]);
    }

    /**
     *
     * @param json
     */
    function handleError(json) {
        // Oops, something wrong happened
        logger.error("Ooops: " + json["error"].code + " " + json["error"].reason);	// FIXME
        logger.debug(json);
        var transaction = json["transaction"];
        if (transaction !== null && transaction !== undefined) {
            var reportSuccess = transactions[transaction];
            if (reportSuccess !== null && reportSuccess !== undefined) {
                reportSuccess(json);
            }
            delete transactions[transaction];
        }
    }

    /**
     *
     * @param json
     */
    function handleEvent(json) {
        logger.debug("Got a plugin event on session " + sessionId);
        logger.debug(json);
        var sender = json["sender"];
        if (sender === undefined || sender === null) {
            logger.warn("Missing sender...");
            return;
        }
        var plugindata = json["plugindata"];
        if (plugindata === undefined || plugindata === null) {
            logger.warn("Missing plugindata...");
            return;
        }
        logger.debug("  -- Event is coming from " + sender + " (" + plugindata["plugin"] + ")");
        var data = plugindata["data"];
        logger.debug(data);
        var pluginHandle = pluginHandles[sender];
        if (pluginHandle === undefined || pluginHandle === null) {
            logger.warn("This handle is not attached to this session");
            return;
        }

        var jsep = json["jsep"];
        if (jsep !== undefined && jsep !== null) {
            logger.debug("Handling SDP as well...");
            logger.debug(jsep);
        }

        var callback = pluginHandle.onmessage;
        if (callback !== null && callback !== undefined) {
            logger.debug("Notifying application...");
            // Send to callback specified when attaching plugin handle
            callback(data, jsep);
        } else {
            // Send to generic callback (?)
            logger.debug("No provided notification callback");
        }
    }

    /**
     *
     * @param json
     */
    function handleTimeout(json) {
        logger.error("Timeout on session " + sessionId);
        logger.debug(json);
        if (websockets) {
            ws.close(3504, "Gateway timeout");
        }
    }
}
