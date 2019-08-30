var logger = window.Logger || console;

// Helper method to prepare a UI selection of the available devices
function initDevices(devices) {
	$('#devices').removeClass('hide');
	$('#devices').parent().removeClass('hide');
	$('#choose-device').click(restartCapture);
	var audio = $('#audio-device').val();
	var video = $('#video-device').val();
	$('#audio-device, #video-device').find('option').remove();

	devices.forEach(function(device) {
		var label = device.label;
		if(label === null || label === undefined || label === "")
			label = device.deviceId;
		var option = $('<option value="' + device.deviceId + '">' + label + '</option>');
		if(device.kind === 'audioinput') {
			$('#audio-device').append(option);
		} else if(device.kind === 'videoinput') {
			$('#video-device').append(option);
		} else if(device.kind === 'audiooutput') {
			// Apparently only available from Chrome 49 on?
			// https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/setSinkId
			// Definitely missing in Safari at the moment: https://bugs.webkit.org/show_bug.cgi?id=179415
			$('#output-devices').removeClass('hide');
			$('#audiooutput').append('<li><a href="#" id="' + device.deviceId + '">' + label + '</a></li>');
			$('#audiooutput a').unbind('click')
				.click(function() {
					var deviceId = $(this).attr("id");
					var label = $(this).text();
                    logger.log("Trying to set device " + deviceId + " (" + label + ") as sink for the output");
					if($('#peervideo').length === 0) {
                        logger.error("No remote video element available");
						bootbox.alert("No remote video element available");
						return false;
					}
					if(!$('#peervideo').get(0).setSinkId) {
                        logger.error("SetSinkId not supported");
						bootbox.warn("SetSinkId not supported");
						return false;
					}
					$('#peervideo').get(0).setSinkId(deviceId)
						.then(function() {
                            logger.log('Audio output device attached:', deviceId);
							$('#outputdeviceset').html(label + '<span class="caret"></span>').parent().removeClass('open');
						}).catch(function(error) {
                        logger.error(error);
							bootbox.alert(error);
						});
					return false;
				});
		}
	});

	$('#audio-device').val(audio);
	$('#video-device').val(video);

	$('#change-devices').click(function() {
		// A different device has been selected: hangup the session, and set it up again
		$('#audio-device, #video-device').attr('disabled', true);
		$('#change-devices').attr('disabled', true);
		if(firstTime) {
			firstTime = false;
			restartCapture();
			return;
		}
		restartCapture();
	});
}

/**
 * 开启视频
 */
function restartCapture() {

}

$(document).ready(function() {
    // Initialize the library (all console debuggers enabled)
    $('#start').one('click', function() {
        $(this).attr('disabled', true).unbind('click');
        // Make sure the browser supports WebRTC
		if (!WebRtcPeer.isWebrtcSupported()) {
            bootbox.alert("No WebRTC support... ");
            return;
		}
        WebRtcPeer.listDevices(initDevices);
    });
});


