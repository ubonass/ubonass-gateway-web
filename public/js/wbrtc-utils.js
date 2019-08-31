(function webpackUniversalModuleDefinition(root, factory) {
	if(typeof exports === 'object' && typeof module === 'object')
		module.exports = factory();
	else if(typeof define === 'function' && define.amd)
		define([], factory);
	else if(typeof exports === 'object')
		exports["wbrtc-utils"] = factory();
	else
		root["wbrtc-utils"] = factory();
})(window, function() {
return /******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};
/******/
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/
/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId]) {
/******/ 			return installedModules[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			i: moduleId,
/******/ 			l: false,
/******/ 			exports: {}
/******/ 		};
/******/
/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/
/******/ 		// Flag the module as loaded
/******/ 		module.l = true;
/******/
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/
/******/
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;
/******/
/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;
/******/
/******/ 	// define getter function for harmony exports
/******/ 	__webpack_require__.d = function(exports, name, getter) {
/******/ 		if(!__webpack_require__.o(exports, name)) {
/******/ 			Object.defineProperty(exports, name, { enumerable: true, get: getter });
/******/ 		}
/******/ 	};
/******/
/******/ 	// define __esModule on exports
/******/ 	__webpack_require__.r = function(exports) {
/******/ 		if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 			Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 		}
/******/ 		Object.defineProperty(exports, '__esModule', { value: true });
/******/ 	};
/******/
/******/ 	// create a fake namespace object
/******/ 	// mode & 1: value is a module id, require it
/******/ 	// mode & 2: merge all properties of value into the ns
/******/ 	// mode & 4: return value when already ns object
/******/ 	// mode & 8|1: behave like require
/******/ 	__webpack_require__.t = function(value, mode) {
/******/ 		if(mode & 1) value = __webpack_require__(value);
/******/ 		if(mode & 8) return value;
/******/ 		if((mode & 4) && typeof value === 'object' && value && value.__esModule) return value;
/******/ 		var ns = Object.create(null);
/******/ 		__webpack_require__.r(ns);
/******/ 		Object.defineProperty(ns, 'default', { enumerable: true, value: value });
/******/ 		if(mode & 2 && typeof value != 'string') for(var key in value) __webpack_require__.d(ns, key, function(key) { return value[key]; }.bind(null, key));
/******/ 		return ns;
/******/ 	};
/******/
/******/ 	// getDefaultExport function for compatibility with non-harmony modules
/******/ 	__webpack_require__.n = function(module) {
/******/ 		var getter = module && module.__esModule ?
/******/ 			function getDefault() { return module['default']; } :
/******/ 			function getModuleExports() { return module; };
/******/ 		__webpack_require__.d(getter, 'a', getter);
/******/ 		return getter;
/******/ 	};
/******/
/******/ 	// Object.prototype.hasOwnProperty.call
/******/ 	__webpack_require__.o = function(object, property) { return Object.prototype.hasOwnProperty.call(object, property); };
/******/
/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";
/******/
/******/
/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(__webpack_require__.s = "./lib/index.js");
/******/ })
/************************************************************************/
/******/ ({

/***/ "./lib/WebRtcPeer.js":
/*!***************************!*\
  !*** ./lib/WebRtcPeer.js ***!
  \***************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {


var inherits = __webpack_require__(/*! inherits */ "./node_modules/inherits/inherits_browser.js");


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


exports.WebRtcPeerRecvonly = WebRtcPeerRecvonly;
exports.WebRtcPeerSendonly = WebRtcPeerSendonly;
exports.WebRtcPeerSendrecv = WebRtcPeerSendrecv;


/***/ }),

/***/ "./lib/index.js":
/*!**********************!*\
  !*** ./lib/index.js ***!
  \**********************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {


var WebRtcPeer = __webpack_require__(/*! ./WebRtcPeer */ "./lib/WebRtcPeer.js");

exports.WebRtcPeer = WebRtcPeer;


/***/ }),

/***/ "./node_modules/inherits/inherits_browser.js":
/*!***************************************************!*\
  !*** ./node_modules/inherits/inherits_browser.js ***!
  \***************************************************/
/*! no static exports found */
/***/ (function(module, exports) {

if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    if (superCtor) {
      ctor.super_ = superCtor
      ctor.prototype = Object.create(superCtor.prototype, {
        constructor: {
          value: ctor,
          enumerable: false,
          writable: true,
          configurable: true
        }
      })
    }
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    if (superCtor) {
      ctor.super_ = superCtor
      var TempCtor = function () {}
      TempCtor.prototype = superCtor.prototype
      ctor.prototype = new TempCtor()
      ctor.prototype.constructor = ctor
    }
  }
}


/***/ })

/******/ });
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly93YnJ0Yy11dGlscy93ZWJwYWNrL3VuaXZlcnNhbE1vZHVsZURlZmluaXRpb24iLCJ3ZWJwYWNrOi8vd2JydGMtdXRpbHMvd2VicGFjay9ib290c3RyYXAiLCJ3ZWJwYWNrOi8vd2JydGMtdXRpbHMvLi9saWIvV2ViUnRjUGVlci5qcyIsIndlYnBhY2s6Ly93YnJ0Yy11dGlscy8uL2xpYi9pbmRleC5qcyIsIndlYnBhY2s6Ly93YnJ0Yy11dGlscy8uL25vZGVfbW9kdWxlcy9pbmhlcml0cy9pbmhlcml0c19icm93c2VyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLENBQUM7QUFDRCxPO1FDVkE7UUFDQTs7UUFFQTtRQUNBOztRQUVBO1FBQ0E7UUFDQTtRQUNBO1FBQ0E7UUFDQTtRQUNBO1FBQ0E7UUFDQTtRQUNBOztRQUVBO1FBQ0E7O1FBRUE7UUFDQTs7UUFFQTtRQUNBO1FBQ0E7OztRQUdBO1FBQ0E7O1FBRUE7UUFDQTs7UUFFQTtRQUNBO1FBQ0E7UUFDQSwwQ0FBMEMsZ0NBQWdDO1FBQzFFO1FBQ0E7O1FBRUE7UUFDQTtRQUNBO1FBQ0Esd0RBQXdELGtCQUFrQjtRQUMxRTtRQUNBLGlEQUFpRCxjQUFjO1FBQy9EOztRQUVBO1FBQ0E7UUFDQTtRQUNBO1FBQ0E7UUFDQTtRQUNBO1FBQ0E7UUFDQTtRQUNBO1FBQ0E7UUFDQSx5Q0FBeUMsaUNBQWlDO1FBQzFFLGdIQUFnSCxtQkFBbUIsRUFBRTtRQUNySTtRQUNBOztRQUVBO1FBQ0E7UUFDQTtRQUNBLDJCQUEyQiwwQkFBMEIsRUFBRTtRQUN2RCxpQ0FBaUMsZUFBZTtRQUNoRDtRQUNBO1FBQ0E7O1FBRUE7UUFDQSxzREFBc0QsK0RBQStEOztRQUVySDtRQUNBOzs7UUFHQTtRQUNBOzs7Ozs7Ozs7Ozs7O0FDakZBLGVBQWUsbUJBQU8sQ0FBQyw2REFBVTs7O0FBR2pDO0FBQ0E7QUFDQTs7QUFFQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBLHVCQUF1QiwyQkFBMkI7QUFDbEQ7QUFDQTtBQUNBLGdCQUFnQjtBQUNoQjtBQUNBO0FBQ0E7QUFDQTtBQUNBLDRDQUE0QztBQUM1QztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EscUJBQXFCO0FBQ3JCO0FBQ0EsaUJBQWlCO0FBQ2pCLGFBQWE7QUFDYjtBQUNBO0FBQ0E7QUFDQSxhQUFhO0FBQ2IsS0FBSztBQUNMO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsYUFBYTtBQUNiO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBOztBQUVBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsYUFBYTtBQUNiO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBOztBQUVBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsYUFBYTtBQUNiO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBOztBQUVBOzs7QUFHQTtBQUNBO0FBQ0EsaUJBQWlCLE9BQU87QUFDeEI7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBOztBQUVBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7O0FBRUE7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FBR0E7OztBQUdBO0FBQ0E7QUFDQTs7Ozs7Ozs7Ozs7OztBQzNKQSxpQkFBaUIsbUJBQU8sQ0FBQyx5Q0FBYzs7QUFFdkM7Ozs7Ozs7Ozs7OztBQ0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLE9BQU87QUFDUDtBQUNBO0FBQ0EsQ0FBQztBQUNEO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoid2JydGMtdXRpbHMuanMiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gd2VicGFja1VuaXZlcnNhbE1vZHVsZURlZmluaXRpb24ocm9vdCwgZmFjdG9yeSkge1xuXHRpZih0eXBlb2YgZXhwb3J0cyA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcpXG5cdFx0bW9kdWxlLmV4cG9ydHMgPSBmYWN0b3J5KCk7XG5cdGVsc2UgaWYodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kKVxuXHRcdGRlZmluZShbXSwgZmFjdG9yeSk7XG5cdGVsc2UgaWYodHlwZW9mIGV4cG9ydHMgPT09ICdvYmplY3QnKVxuXHRcdGV4cG9ydHNbXCJ3YnJ0Yy11dGlsc1wiXSA9IGZhY3RvcnkoKTtcblx0ZWxzZVxuXHRcdHJvb3RbXCJ3YnJ0Yy11dGlsc1wiXSA9IGZhY3RvcnkoKTtcbn0pKHdpbmRvdywgZnVuY3Rpb24oKSB7XG5yZXR1cm4gIiwiIFx0Ly8gVGhlIG1vZHVsZSBjYWNoZVxuIFx0dmFyIGluc3RhbGxlZE1vZHVsZXMgPSB7fTtcblxuIFx0Ly8gVGhlIHJlcXVpcmUgZnVuY3Rpb25cbiBcdGZ1bmN0aW9uIF9fd2VicGFja19yZXF1aXJlX18obW9kdWxlSWQpIHtcblxuIFx0XHQvLyBDaGVjayBpZiBtb2R1bGUgaXMgaW4gY2FjaGVcbiBcdFx0aWYoaW5zdGFsbGVkTW9kdWxlc1ttb2R1bGVJZF0pIHtcbiBcdFx0XHRyZXR1cm4gaW5zdGFsbGVkTW9kdWxlc1ttb2R1bGVJZF0uZXhwb3J0cztcbiBcdFx0fVxuIFx0XHQvLyBDcmVhdGUgYSBuZXcgbW9kdWxlIChhbmQgcHV0IGl0IGludG8gdGhlIGNhY2hlKVxuIFx0XHR2YXIgbW9kdWxlID0gaW5zdGFsbGVkTW9kdWxlc1ttb2R1bGVJZF0gPSB7XG4gXHRcdFx0aTogbW9kdWxlSWQsXG4gXHRcdFx0bDogZmFsc2UsXG4gXHRcdFx0ZXhwb3J0czoge31cbiBcdFx0fTtcblxuIFx0XHQvLyBFeGVjdXRlIHRoZSBtb2R1bGUgZnVuY3Rpb25cbiBcdFx0bW9kdWxlc1ttb2R1bGVJZF0uY2FsbChtb2R1bGUuZXhwb3J0cywgbW9kdWxlLCBtb2R1bGUuZXhwb3J0cywgX193ZWJwYWNrX3JlcXVpcmVfXyk7XG5cbiBcdFx0Ly8gRmxhZyB0aGUgbW9kdWxlIGFzIGxvYWRlZFxuIFx0XHRtb2R1bGUubCA9IHRydWU7XG5cbiBcdFx0Ly8gUmV0dXJuIHRoZSBleHBvcnRzIG9mIHRoZSBtb2R1bGVcbiBcdFx0cmV0dXJuIG1vZHVsZS5leHBvcnRzO1xuIFx0fVxuXG5cbiBcdC8vIGV4cG9zZSB0aGUgbW9kdWxlcyBvYmplY3QgKF9fd2VicGFja19tb2R1bGVzX18pXG4gXHRfX3dlYnBhY2tfcmVxdWlyZV9fLm0gPSBtb2R1bGVzO1xuXG4gXHQvLyBleHBvc2UgdGhlIG1vZHVsZSBjYWNoZVxuIFx0X193ZWJwYWNrX3JlcXVpcmVfXy5jID0gaW5zdGFsbGVkTW9kdWxlcztcblxuIFx0Ly8gZGVmaW5lIGdldHRlciBmdW5jdGlvbiBmb3IgaGFybW9ueSBleHBvcnRzXG4gXHRfX3dlYnBhY2tfcmVxdWlyZV9fLmQgPSBmdW5jdGlvbihleHBvcnRzLCBuYW1lLCBnZXR0ZXIpIHtcbiBcdFx0aWYoIV9fd2VicGFja19yZXF1aXJlX18ubyhleHBvcnRzLCBuYW1lKSkge1xuIFx0XHRcdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShleHBvcnRzLCBuYW1lLCB7IGVudW1lcmFibGU6IHRydWUsIGdldDogZ2V0dGVyIH0pO1xuIFx0XHR9XG4gXHR9O1xuXG4gXHQvLyBkZWZpbmUgX19lc01vZHVsZSBvbiBleHBvcnRzXG4gXHRfX3dlYnBhY2tfcmVxdWlyZV9fLnIgPSBmdW5jdGlvbihleHBvcnRzKSB7XG4gXHRcdGlmKHR5cGVvZiBTeW1ib2wgIT09ICd1bmRlZmluZWQnICYmIFN5bWJvbC50b1N0cmluZ1RhZykge1xuIFx0XHRcdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShleHBvcnRzLCBTeW1ib2wudG9TdHJpbmdUYWcsIHsgdmFsdWU6ICdNb2R1bGUnIH0pO1xuIFx0XHR9XG4gXHRcdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShleHBvcnRzLCAnX19lc01vZHVsZScsIHsgdmFsdWU6IHRydWUgfSk7XG4gXHR9O1xuXG4gXHQvLyBjcmVhdGUgYSBmYWtlIG5hbWVzcGFjZSBvYmplY3RcbiBcdC8vIG1vZGUgJiAxOiB2YWx1ZSBpcyBhIG1vZHVsZSBpZCwgcmVxdWlyZSBpdFxuIFx0Ly8gbW9kZSAmIDI6IG1lcmdlIGFsbCBwcm9wZXJ0aWVzIG9mIHZhbHVlIGludG8gdGhlIG5zXG4gXHQvLyBtb2RlICYgNDogcmV0dXJuIHZhbHVlIHdoZW4gYWxyZWFkeSBucyBvYmplY3RcbiBcdC8vIG1vZGUgJiA4fDE6IGJlaGF2ZSBsaWtlIHJlcXVpcmVcbiBcdF9fd2VicGFja19yZXF1aXJlX18udCA9IGZ1bmN0aW9uKHZhbHVlLCBtb2RlKSB7XG4gXHRcdGlmKG1vZGUgJiAxKSB2YWx1ZSA9IF9fd2VicGFja19yZXF1aXJlX18odmFsdWUpO1xuIFx0XHRpZihtb2RlICYgOCkgcmV0dXJuIHZhbHVlO1xuIFx0XHRpZigobW9kZSAmIDQpICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgdmFsdWUgJiYgdmFsdWUuX19lc01vZHVsZSkgcmV0dXJuIHZhbHVlO1xuIFx0XHR2YXIgbnMgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuIFx0XHRfX3dlYnBhY2tfcmVxdWlyZV9fLnIobnMpO1xuIFx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkobnMsICdkZWZhdWx0JywgeyBlbnVtZXJhYmxlOiB0cnVlLCB2YWx1ZTogdmFsdWUgfSk7XG4gXHRcdGlmKG1vZGUgJiAyICYmIHR5cGVvZiB2YWx1ZSAhPSAnc3RyaW5nJykgZm9yKHZhciBrZXkgaW4gdmFsdWUpIF9fd2VicGFja19yZXF1aXJlX18uZChucywga2V5LCBmdW5jdGlvbihrZXkpIHsgcmV0dXJuIHZhbHVlW2tleV07IH0uYmluZChudWxsLCBrZXkpKTtcbiBcdFx0cmV0dXJuIG5zO1xuIFx0fTtcblxuIFx0Ly8gZ2V0RGVmYXVsdEV4cG9ydCBmdW5jdGlvbiBmb3IgY29tcGF0aWJpbGl0eSB3aXRoIG5vbi1oYXJtb255IG1vZHVsZXNcbiBcdF9fd2VicGFja19yZXF1aXJlX18ubiA9IGZ1bmN0aW9uKG1vZHVsZSkge1xuIFx0XHR2YXIgZ2V0dGVyID0gbW9kdWxlICYmIG1vZHVsZS5fX2VzTW9kdWxlID9cbiBcdFx0XHRmdW5jdGlvbiBnZXREZWZhdWx0KCkgeyByZXR1cm4gbW9kdWxlWydkZWZhdWx0J107IH0gOlxuIFx0XHRcdGZ1bmN0aW9uIGdldE1vZHVsZUV4cG9ydHMoKSB7IHJldHVybiBtb2R1bGU7IH07XG4gXHRcdF9fd2VicGFja19yZXF1aXJlX18uZChnZXR0ZXIsICdhJywgZ2V0dGVyKTtcbiBcdFx0cmV0dXJuIGdldHRlcjtcbiBcdH07XG5cbiBcdC8vIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbFxuIFx0X193ZWJwYWNrX3JlcXVpcmVfXy5vID0gZnVuY3Rpb24ob2JqZWN0LCBwcm9wZXJ0eSkgeyByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG9iamVjdCwgcHJvcGVydHkpOyB9O1xuXG4gXHQvLyBfX3dlYnBhY2tfcHVibGljX3BhdGhfX1xuIFx0X193ZWJwYWNrX3JlcXVpcmVfXy5wID0gXCJcIjtcblxuXG4gXHQvLyBMb2FkIGVudHJ5IG1vZHVsZSBhbmQgcmV0dXJuIGV4cG9ydHNcbiBcdHJldHVybiBfX3dlYnBhY2tfcmVxdWlyZV9fKF9fd2VicGFja19yZXF1aXJlX18ucyA9IFwiLi9saWIvaW5kZXguanNcIik7XG4iLCJcclxudmFyIGluaGVyaXRzID0gcmVxdWlyZSgnaW5oZXJpdHMnKTtcclxuXHJcblxyXG5mdW5jdGlvbiBub29wKGVycm9yKSB7XHJcbiAgICBpZiAoZXJyb3IpIGxvZ2dlci5lcnJvcihlcnJvcilcclxufVxyXG5cclxudmFyIGxvZ2dlciA9IHdpbmRvdy5Mb2dnZXIgfHwgY29uc29sZTtcclxuXHJcbi8vIEhlbHBlciBtZXRob2QgdG8gY2hlY2sgd2hldGhlciBXZWJSVEMgaXMgc3VwcG9ydGVkIGJ5IHRoaXMgYnJvd3NlclxyXG5XZWJSdGNQZWVyLmlzV2VicnRjU3VwcG9ydGVkID0gZnVuY3Rpb24gKCkge1xyXG4gICAgcmV0dXJuIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiAhPT0gdW5kZWZpbmVkICYmIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiAhPT0gbnVsbDtcclxufTtcclxuXHJcbi8vIEhlbHBlciBtZXRob2QgdG8gY2hlY2sgd2hldGhlciBkZXZpY2VzIGNhbiBiZSBhY2Nlc3NlZCBieSB0aGlzIGJyb3dzZXIgXHJcbi8vKGUuZy4sIG5vdCBwb3NzaWJsZSB2aWEgcGxhaW4gSFRUUClcclxuV2ViUnRjUGVlci5pc0dldFVzZXJNZWRpYUF2YWlsYWJsZSA9IGZ1bmN0aW9uICgpIHtcclxuICAgIHJldHVybiBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzICE9PSB1bmRlZmluZWRcclxuICAgICAgICAmJiBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzICE9PSBudWxsXHJcbiAgICAgICAgJiYgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEgIT09IHVuZGVmaW5lZFxyXG4gICAgICAgICYmIG5hdmlnYXRvci5tZWRpYURldmljZXMuZ2V0VXNlck1lZGlhICE9PSBudWxsO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqXHJcbiAqIEBwYXJhbSBjYWxsYmFja1xyXG4gKiBAcGFyYW0gY29uc3RyYWludHM6eyBhdWRpbzogdHJ1ZSwgdmlkZW86IHRydWUgfSxcclxuICoge1xyXG4gICAgICAgIGF1ZGlvOiB0cnVlLFxyXG4gICAgICAgIHZpZGVvOiB7IHdpZHRoOiAxMjgwLCBoZWlnaHQ6IDcyMCB9XHJcbiAgICB9XHJcbiAqL1xyXG5XZWJSdGNQZWVyLmxpc3REZXZpY2VzID0gZnVuY3Rpb24gKGNhbGxiYWNrLCBjb25zdHJhaW50cykge1xyXG4gICAgY2FsbGJhY2sgPSAodHlwZW9mIGNhbGxiYWNrID09IFwiZnVuY3Rpb25cIikgPyBjYWxsYmFjayA6IHt9O1xyXG4gICAgaWYgKGNvbnN0cmFpbnRzID09IG51bGwpIGNvbnN0cmFpbnRzID0ge2F1ZGlvOiB0cnVlLCB2aWRlbzogdHJ1ZX07XHJcbiAgICBpZiAoV2ViUnRjUGVlci5pc0dldFVzZXJNZWRpYUF2YWlsYWJsZSgpKSB7XHJcbiAgICAgICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEoY29uc3RyYWludHMpXHJcbiAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uIChzdHJlYW0pIHtcclxuICAgICAgICAgICAgICAgIG5hdmlnYXRvci5tZWRpYURldmljZXMuZW51bWVyYXRlRGV2aWNlcygpLnRoZW4oZnVuY3Rpb24gKGRldmljZXMpIHtcclxuICAgICAgICAgICAgICAgICAgICBsb2dnZXIuZGVidWcoZGV2aWNlcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2soZGV2aWNlcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gR2V0IHJpZCBvZiB0aGUgbm93IHVzZWxlc3Mgc3RyZWFtXHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHRyYWNrcyA9IHN0cmVhbS5nZXRUcmFja3MoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm9yICh2YXIgaSBpbiB0cmFja3MpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhciBtc3QgPSB0cmFja3NbaV07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAobXN0ICE9PSBudWxsICYmIG1zdCAhPT0gdW5kZWZpbmVkKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1zdC5zdG9wKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIC5jYXRjaChmdW5jdGlvbiAoZXJyKSB7XHJcbiAgICAgICAgICAgICAgICBsb2dnZXIuZXJyb3IoZXJyKTtcclxuICAgICAgICAgICAgICAgIGNhbGxiYWNrKFtdKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIGxvZ2dlci53YXJuKFwibmF2aWdhdG9yLm1lZGlhRGV2aWNlcyB1bmF2YWlsYWJsZVwiKTtcclxuICAgICAgICBjYWxsYmFjayhbXSk7XHJcbiAgICB9XHJcbn07XHJcblxyXG4vL1xyXG4vLyBTcGVjaWFsaXplZCBjaGlsZCBjbGFzc2VzXHJcbi8vXHJcbi8qKlxyXG4gKiBXZWJSdGNQZWVy5a2Q57G7LOmAmui/h+Wug+WIm+W7uueahOaYr+WPquiDveaOpeaUtueahFBlZXJcclxuICogQHBhcmFtIG9wdGlvbnNcclxuICogQHBhcmFtIGNhbGxiYWNrXHJcbiAqIEByZXR1cm5zIHtXZWJSdGNQZWVyUmVjdm9ubHl8Kn1cclxuICogQGNvbnN0cnVjdG9yXHJcbiAqL1xyXG5mdW5jdGlvbiBXZWJSdGNQZWVyUmVjdm9ubHkob3B0aW9ucywgY2FsbGJhY2spIHtcclxuICAgIGlmICghKHRoaXMgaW5zdGFuY2VvZiBXZWJSdGNQZWVyUmVjdm9ubHkpKSB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBXZWJSdGNQZWVyUmVjdm9ubHkob3B0aW9ucywgY2FsbGJhY2spO1xyXG4gICAgfVxyXG5cclxuICAgIFdlYlJ0Y1BlZXJSZWN2b25seS5zdXBlcl8uY2FsbCh0aGlzLCAncmVjdm9ubHknLCBvcHRpb25zLCBjYWxsYmFjayk7XHJcbn1cclxuXHJcbmluaGVyaXRzKFdlYlJ0Y1BlZXJSZWN2b25seSwgV2ViUnRjUGVlcik7XHJcblxyXG4vKipcclxuICpXZWJSdGNQZWVy5a2Q57G7LOmAmui/h+Wug+WIm+W7uueahOaYr+WPquiDveWPkemAgeeahFBlZXJcclxuICogQHBhcmFtIG9wdGlvbnNcclxuICogQHBhcmFtIGNhbGxiYWNrXHJcbiAqIEByZXR1cm5zIHtXZWJSdGNQZWVyU2VuZG9ubHl8Kn1cclxuICogQGNvbnN0cnVjdG9yXHJcbiAqL1xyXG5mdW5jdGlvbiBXZWJSdGNQZWVyU2VuZG9ubHkob3B0aW9ucywgY2FsbGJhY2spIHtcclxuICAgIGlmICghKHRoaXMgaW5zdGFuY2VvZiBXZWJSdGNQZWVyU2VuZG9ubHkpKSB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBXZWJSdGNQZWVyU2VuZG9ubHkob3B0aW9ucywgY2FsbGJhY2spO1xyXG4gICAgfVxyXG5cclxuICAgIFdlYlJ0Y1BlZXJTZW5kb25seS5zdXBlcl8uY2FsbCh0aGlzLCAnc2VuZG9ubHknLCBvcHRpb25zLCBjYWxsYmFjayk7XHJcbn1cclxuXHJcbmluaGVyaXRzKFdlYlJ0Y1BlZXJTZW5kb25seSwgV2ViUnRjUGVlcik7XHJcblxyXG4vKipcclxuICogV2ViUnRjUGVlcuWtkOexuyzpgJrov4flroPliJvlu7rnmoTmmK/og73mlLblj5HnmoRQZWVyXHJcbiAqIEBwYXJhbSBvcHRpb25zXHJcbiAqIEBwYXJhbSBjYWxsYmFja1xyXG4gKiBAcmV0dXJucyB7V2ViUnRjUGVlclNlbmRyZWN2fCp9XHJcbiAqIEBjb25zdHJ1Y3RvclxyXG4gKi9cclxuZnVuY3Rpb24gV2ViUnRjUGVlclNlbmRyZWN2KG9wdGlvbnMsIGNhbGxiYWNrKSB7XHJcbiAgICBpZiAoISh0aGlzIGluc3RhbmNlb2YgV2ViUnRjUGVlclNlbmRyZWN2KSkge1xyXG4gICAgICAgIHJldHVybiBuZXcgV2ViUnRjUGVlclNlbmRyZWN2KG9wdGlvbnMsIGNhbGxiYWNrKTtcclxuICAgIH1cclxuXHJcbiAgICBXZWJSdGNQZWVyU2VuZHJlY3Yuc3VwZXJfLmNhbGwodGhpcywgJ3NlbmRyZWN2Jywgb3B0aW9ucywgY2FsbGJhY2spO1xyXG59XHJcblxyXG5pbmhlcml0cyhXZWJSdGNQZWVyU2VuZHJlY3YsIFdlYlJ0Y1BlZXIpO1xyXG5cclxuXHJcbi8qKlxyXG4gKlxyXG4gKiBAcGFyYW0gbW9kZSA6e1N0cmluZ30gbW9kZSBNb2RlIGluIHdoaWNoIHRoZSBQZWVyQ29ubmVjdGlvbiB3aWxsIGJlIGNvbmZpZ3VyZWQuXHJcbiAqICAgICAgVmFsaWQgdmFsdWVzIGFyZTogJ3JlY3YnLCAnc2VuZCcsIGFuZCAnc2VuZFJlY3YnXHJcbiAqIEBwYXJhbSBvcHRpb25zXHJcbiAqIEBwYXJhbSBjYWxsYmFjayzlm57osIPlh73mlbBcclxuICogQGNvbnN0cnVjdG9yXHJcbiAqL1xyXG5mdW5jdGlvbiBXZWJSdGNQZWVyKG1vZGUsIG9wdGlvbnMsIGNhbGxiYWNrKSB7XHJcbiAgICBpZiAoISh0aGlzIGluc3RhbmNlb2YgV2ViUnRjUGVlcikpIHtcclxuICAgICAgICByZXR1cm4gbmV3IFdlYlJ0Y1BlZXIobW9kZSwgb3B0aW9ucywgY2FsbGJhY2spO1xyXG4gICAgfVxyXG5cclxuICAgIFdlYlJ0Y1BlZXIuc3VwZXJfLmNhbGwodGhpcyk7XHJcblxyXG4gICAgaWYgKG9wdGlvbnMgaW5zdGFuY2VvZiBGdW5jdGlvbikge1xyXG4gICAgICAgIGNhbGxiYWNrID0gb3B0aW9ucztcclxuICAgICAgICBvcHRpb25zID0gdW5kZWZpbmVkO1xyXG4gICAgfVxyXG5cclxuICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgY2FsbGJhY2sgPSAoY2FsbGJhY2sgfHwgbm9vcCkuYmluZCh0aGlzKTtcclxuXHJcbiAgICB2YXIgc2VsZiA9IHRoaXM7XHJcblxyXG4gICAgdmFyIGxvY2FsVmlkZW8gPSBvcHRpb25zLmxvY2FsVmlkZW87XHJcbiAgICB2YXIgcmVtb3RlVmlkZW8gPSBvcHRpb25zLnJlbW90ZVZpZGVvO1xyXG4gICAgdmFyIHZpZGVvU3RyZWFtID0gb3B0aW9ucy52aWRlb1N0cmVhbTtcclxuICAgIHZhciBhdWRpb1N0cmVhbSA9IG9wdGlvbnMuYXVkaW9TdHJlYW07XHJcbiAgICB2YXIgbWVkaWFDb25zdHJhaW50cyA9IG9wdGlvbnMubWVkaWFDb25zdHJhaW50cztcclxuXHJcblxyXG59XHJcblxyXG5cclxuZXhwb3J0cy5XZWJSdGNQZWVyUmVjdm9ubHkgPSBXZWJSdGNQZWVyUmVjdm9ubHk7XHJcbmV4cG9ydHMuV2ViUnRjUGVlclNlbmRvbmx5ID0gV2ViUnRjUGVlclNlbmRvbmx5O1xyXG5leHBvcnRzLldlYlJ0Y1BlZXJTZW5kcmVjdiA9IFdlYlJ0Y1BlZXJTZW5kcmVjdjtcclxuIiwiXHJcbnZhciBXZWJSdGNQZWVyID0gcmVxdWlyZSgnLi9XZWJSdGNQZWVyJyk7XHJcblxyXG5leHBvcnRzLldlYlJ0Y1BlZXIgPSBXZWJSdGNQZWVyO1xyXG4iLCJpZiAodHlwZW9mIE9iamVjdC5jcmVhdGUgPT09ICdmdW5jdGlvbicpIHtcbiAgLy8gaW1wbGVtZW50YXRpb24gZnJvbSBzdGFuZGFyZCBub2RlLmpzICd1dGlsJyBtb2R1bGVcbiAgbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBpbmhlcml0cyhjdG9yLCBzdXBlckN0b3IpIHtcbiAgICBpZiAoc3VwZXJDdG9yKSB7XG4gICAgICBjdG9yLnN1cGVyXyA9IHN1cGVyQ3RvclxuICAgICAgY3Rvci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKHN1cGVyQ3Rvci5wcm90b3R5cGUsIHtcbiAgICAgICAgY29uc3RydWN0b3I6IHtcbiAgICAgICAgICB2YWx1ZTogY3RvcixcbiAgICAgICAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICAgICAgICB3cml0YWJsZTogdHJ1ZSxcbiAgICAgICAgICBjb25maWd1cmFibGU6IHRydWVcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9XG4gIH07XG59IGVsc2Uge1xuICAvLyBvbGQgc2Nob29sIHNoaW0gZm9yIG9sZCBicm93c2Vyc1xuICBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGluaGVyaXRzKGN0b3IsIHN1cGVyQ3Rvcikge1xuICAgIGlmIChzdXBlckN0b3IpIHtcbiAgICAgIGN0b3Iuc3VwZXJfID0gc3VwZXJDdG9yXG4gICAgICB2YXIgVGVtcEN0b3IgPSBmdW5jdGlvbiAoKSB7fVxuICAgICAgVGVtcEN0b3IucHJvdG90eXBlID0gc3VwZXJDdG9yLnByb3RvdHlwZVxuICAgICAgY3Rvci5wcm90b3R5cGUgPSBuZXcgVGVtcEN0b3IoKVxuICAgICAgY3Rvci5wcm90b3R5cGUuY29uc3RydWN0b3IgPSBjdG9yXG4gICAgfVxuICB9XG59XG4iXSwic291cmNlUm9vdCI6IiJ9