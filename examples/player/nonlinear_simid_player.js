const NO_REQUESTED_DURATION = 0;
const UNLIMITED_DURATION = -2;
/** 
 * All the logic for a simple SIMID player
 */
class SimidPlayer {

  /**
   * Sets up the creative iframe and starts listening for messages
   * from the creative.
   * @param {!Function} This function gets called when the ad stops.
   */
  constructor(adComplete, isNonLinear) {
    /**
     * The protocol for sending and receiving messages.
     * @protected {!SimidProtocol}
     */
    this.simidProtocol = new SimidProtocol();

    this.addListeners_();

    /**
     * A reference to the video player on the players main page
     * @private {!Element}
     */
    this.contentVideoElement_ = document.getElementById('video_player');

    /**
     * A reference to a video player for playing ads.
     * @private {!Element}
     */
    this.adVideoElement_ = document.getElementById('ad_video_player');

    /**
     * A reference to the iframe holding the SIMID creative.
     * @private {?Element}
     */
    this.simidIframe_ = null;

    /**
     * A reference to the promise returned when initialization was called.
     * @private {?Promise}
     */
    this.initializationPromise_ = null;

    /**
     * A map of events tracked on the video element.
     * @private {!Map}
     */
    this.videoTrackingEvents_ = new Map();

    /**
     * A function to execute on ad completion
     * @private {!Function}
     */
    this.adComplete_ = adComplete;

    /**
     * The duration requested by the ad.
     * @private {number}
     */
    this.requestedDuration_ = NO_REQUESTED_DURATION;

    this.isNonLinear_ = isNonLinear;

    /**
     * Resolution function for the session created message
     * @private {?Function}
     */
    this.resolveSessionCreatedPromise_ = null;

    /**
     * A promise that resolves once the creative creates a session.
     * @private {!Promise}
     */
    this.sessionCreatedPromise_ = new Promise((resolve, reject) => {
      this.resolveSessionCreatedPromise_ = resolve;
    });

    /**
     * Resolution function for the ad being initialized.
     * @private {?Function}
     */
    this.resolveInitializationPromise_ = null;

    /**
     * Reject function for the ad being initialized.
     * @private {?Function}
     */
    this.rejectInitializationPromise_ = null;

    /**
     * A boolean value that tracks whether or not the creative has been resized.
     * @private {boolean}
     */
    this.isResized_ = false;

    /**
     * An array of the resized nonlinear creative's dimensions.
     * @private {?Array<!Integer>}
     */
    this.resizeDimensions_ = null;

    /**
     * A promise that resolves once the creative responds to initialization with resolve.
     * @private {!Promise}
     */
    this.initializationPromise_ = new Promise((resolve, reject) => {
      this.resolveInitializationPromise_ = resolve;
      this.rejectInitializationPromise_ = reject;
    });


    this.trackEventsOnVideoElement_();
    this.hideAdPlayer_();
  }

  /**
   * Initializes an ad. This should be called before an ad plays.
   * Creates an iframe with the creative in it, then uses a promise
   * to call init on the creative as soon as the creative initializes
   * a session.
   */
  initializeAd() {
    //validate -> if not don't even create iframe
    if (this.isNonLinear_ && !this.isValidDimensions(this.getNonLinearDimensions())) {
      console.log('Dimensions bigger than player');
      return;
    }

    this.simidIframe_ = this.createSimidIframe_();
    
    if (this.isNonLinear_) {
      this.loadNonLinearDimensions_();
    }

    this.requestDuration_ = NO_REQUESTED_DURATION;

    // Prepare for the case that init fails before sending
    // the init message. Initialization failing means abandoning
    // the ad.
    this.initializationPromise_.catch((e) => {
      this.onAdInitializedFailed_(e);
    });

    // Using a promise means that the init message will
    // send as soon as the session is created. If the session
    // is already created this will send the init message immediately.
    this.sessionCreatedPromise_.then(() => {
      this.sendInitMessage_();
    });

  }

  /**
   * Plays a SIMID  creative once it has responded to the initialize ad message.
   */
  playAd() {
    if (this.isNonLinear_) {
      this.contentVideoElement_.play();
    } else {
      this.contentVideoElement_.pause();
    }
    // This example waits for the ad to be initialized, before playing video.
    // NOTE: Not all players will wait for session creation and initialization
    // before they start playback.
    this.initializationPromise_.then(() =>  {
      this.startCreativePlayback_()
    });
  }

  closeAd() {
    this.onRequestStop(CreativeMessage.REQUEST_STOP);
    this.sendLog("Ad closed by player");
  }

  // stopAd() {
  //   this.onRequestStop(CreativeMessage.REQUEST_STOP);
  //   this.sendLog("Ad stopped by player");
  // }

  skipAd() {
    this.onRequestSkip(CreativeMessage.REQUEST_SKIP);
    this.sendLog("Ad skipped by player");
  }

  fatalError() {
    this.onCreativeFatalError(CreativeMessage.FATAL_ERROR);
    this.sendLog("Fatal error detected by player");
  }

  /**
   * Sets up an iframe for holding the simid element.
   *
   * @return {!Element} The iframe where the simid element lives.
   * @private
   */
  createSimidIframe_() {
    const playerDiv = document.getElementById('player_div');
    const simidIframe = document.createElement('iframe');
    simidIframe.style.display = 'none';
    // The target of the player to send messages to is the newly
    // created iframe.
    playerDiv.appendChild(simidIframe);
    // Set up css to overlay the SIMID iframe over the video creative.
    if (!this.isNonLinear_) {
      simidIframe.classList.add('simid_creative');
    }
    // Set the iframe creative, this should be an html creative.
    // TODO: This sample does not show what to do when loading fails.
    simidIframe.src = document.getElementById('creative_url').value;

    this.simidProtocol.setMessageTarget(simidIframe.contentWindow);
    simidIframe.setAttribute('allowFullScreen', '');
    simidIframe.setAttribute('allow', 'geolocation');
    return simidIframe;
  }

  /**
   * Listens to all relevant messages from the SIMID add.
   * @private
   */
  addListeners_() {
    this.simidProtocol.addListener(ProtocolMessage.CREATE_SESSION, this.onSessionCreated_.bind(this));
    this.simidProtocol.addListener(CreativeMessage.REQUEST_FULL_SCREEN, this.onRequestFullScreen.bind(this));
    this.simidProtocol.addListener(CreativeMessage.REQUEST_PLAY, this.onRequestPlay.bind(this));
    this.simidProtocol.addListener(CreativeMessage.REQUEST_PAUSE, this.onRequestPause.bind(this));
    this.simidProtocol.addListener(CreativeMessage.FATAL_ERROR, this.onCreativeFatalError.bind(this));
    this.simidProtocol.addListener(CreativeMessage.REQUEST_SKIP, this.onRequestSkip.bind(this));
    this.simidProtocol.addListener(CreativeMessage.REQUEST_STOP, this.onRequestStop.bind(this));
    this.simidProtocol.addListener(CreativeMessage.REQUEST_CHANGE_AD_DURATION,
        this.onRequestChangeAdDuration.bind(this));
    this.simidProtocol.addListener(CreativeMessage.GET_MEDIA_STATE, this.onGetMediaState.bind(this));
    this.simidProtocol.addListener(CreativeMessage.LOG, this.onReceiveCreativeLog.bind(this));
    this.simidProtocol.addListener(CreativeMessage.REQUEST_VIDEO_PAUSE, this.onRequestVideoPause.bind(this));
    this.simidProtocol.addListener(CreativeMessage.REQUEST_EXPAND, this.onExpandResize.bind(this));
    this.simidProtocol.addListener(CreativeMessage.REQUEST_COLLAPSE, this.loadNonLinearDimensions_.bind(this));
    this.simidProtocol.addListener(CreativeMessage.REQUEST_RESIZE, this.onRequestResize.bind(this));
  }

  /**
   * Resolves the session created promise.
   * @private
   */
  onSessionCreated_() {
    // Anything that must happen after the session is created can now happen
    // since this promise is resolved.
    this.resolveSessionCreatedPromise_();
  }

  destroySimidIframe() {
    if (this.simidIframe_) {
      this.simidIframe_.remove();
      this.simidIframe_ = null;
      this.simidProtocol.reset();
    }
    for(let [key, func] of this.videoTrackingEvents_) {
      this.adVideoElement_.removeEventListener(key, func, true);
    }
    this.videoTrackingEvents_.clear();
    this.adComplete_();
  }

  /**
   * Returns the dimensions of an element within the player div.
   * @return {!Object}
   */
  getFullPlayerDimensions(elem) {
    // The player div wraps all elements and is used as the offset.
    const playerDiv = document.getElementById('player_div');
    const playerRect = playerDiv.getBoundingClientRect();
    const videoRect = elem.getBoundingClientRect();
    return {
      'x' : videoRect.x - playerRect.x,
      'y' : videoRect.y - playerRect.y,
      'width' : videoRect.width,
      'height' : videoRect.height,
      // TODO: This example does not currently support transition duration.
      'transitionDuration': 0
    };
  }

  isValidDimensions(dimensions) {
    const playerDiv = document.getElementById('player_div');
    const playerRect = playerDiv.getBoundingClientRect();

    const heightFits = parseInt(dimensions.y) + parseInt(dimensions.height) <= parseInt(playerRect.height);
    const widthFits = parseInt(dimensions.x) + parseInt(dimensions.width) <= parseInt(playerRect.width);
    
    return heightFits && widthFits;
  }

  getNonLinearDimensions() {
    // The player div wraps all elements and is used as the offset.
    const x_val = document.getElementById('x_val').value;;
    const y_val = document.getElementById('y_val').value;;
    const width = document.getElementById('width').value;;
    const height = document.getElementById('height').value;;
    if(this.isResized_){
      return this.resizeDimensions_
    } else {
      return {
        'x' : x_val,
        'y' : y_val,
        'width' : width,
        'height' : height,
        // TODO: This example does not currently support transition duration.
        'transitionDuration': 0
      };
    }
  }

  loadNonLinearDimensions_() {
    const dimensions = this.getNonLinearDimensions();
    
    this.simidIframe_.style.height = dimensions.height;
    this.simidIframe_.style.width = dimensions.width;
    
    this.simidIframe_.style.left = `${dimensions.x}px`;
    this.simidIframe_.style.top = `${dimensions.y}px`;

    this.simidIframe_.style.position = "absolute";

    this.contentVideoElement_.play();
  }

  onExpandResize(incomingMessage) {
    if (!this.isNonLinear_){
      this.sendLog("Cannot resize linear ads");
      return;
    } 

    const fullDimensions = this.getFullPlayerDimensions(this.contentVideoElement_);

    this.simidIframe_.style.height = fullDimensions.height;
    this.simidIframe_.style.width = fullDimensions.width;
    
    this.simidIframe_.style.left = `${fullDimensions.x}px`;
    this.simidIframe_.style.top = `${fullDimensions.y}px`;

    this.onRequestVideoPause(CreativeMessage.REQUEST_VIDEO_PAUSE);
    this.simidProtocol.resolve(incomingMessage);
  }

  onRequestResize(incomingMessage) {
    this.isResized_ = true;
    const x_val  = incomingMessage.args['x_val'];
    const y_val  = incomingMessage.args['y_val'];
    const width  = incomingMessage.args['width'];
    const height  = incomingMessage.args['height'];

    const resizeDimensions = {
      'x' : x_val,
      'y' : y_val,
      'width' : width,
      'height' : height,
    }

    this.resizeDimensions_ = resizeDimensions;
    if (!this.isValidDimensions(resizeDimensions)){
      console.log("Not valid dimensions");
      return;
    }
    this.simidIframe_.style.height = resizeDimensions.height;
    this.simidIframe_.style.width = resizeDimensions.width;
    
    this.simidIframe_.style.left = `${resizeDimensions.x}px`;
    this.simidIframe_.style.top = `${resizeDimensions.y}px`;

    this.simidProtocol.resolve(incomingMessage);
  }

  /**
   * Initializes the SIMID creative with all data it needs.
   * @private
   */
  sendInitMessage_() {
    const videoDimensions = this.getFullPlayerDimensions(this.contentVideoElement_);
    // const creativeDimensions = this.getNonLinearDimensions();
    // Since the creative starts as hidden it will take on the
    // video element dimensions, so tell the ad about those dimensions.
    const creativeDimensions = this.getFullPlayerDimensions(this.contentVideoElement_);

    const environmentData = {
      'videoDimensions': videoDimensions,
      'creativeDimensions': creativeDimensions,
      'fullscreen': false,
      'fullscreenAllowed': true,
      'variableDurationAllowed': true,
      'skippableState': 'adHandles', // This player does not render a skip button.
      'siteUrl': document.location.host,
      'appId': '', // This is not relevant on desktop
      'useragent': '', // This should be filled in for sdks and players
      'deviceId': '', // This should be filled in on mobile
      'muted': this.adVideoElement_.muted,
      'volume': this.adVideoElement_.volume
    }

    const creativeData = {
      'adParameters' : document.getElementById('ad_params').value,
      // These values should be populated from the VAST response.
      'adId' : '',
      'creativeId' : '',
      'adServingId': '',
      'clickThroughUrl': 'http://example.com'
    }

    const initMessage = {
      'environmentData' : environmentData,
      'creativeData': creativeData
    }
    const initPromise = this.simidProtocol.sendMessage(
        PlayerMessage.INIT, initMessage);
    initPromise.then((args)=> {
      this.resolveInitializationPromise_(args);
    }).catch((args) => {
      this.rejectInitializationPromise_(args);
    })
  }

  /**
   * Called once the creative responds positively to being initialized.
   * @param {!Object} data
   * @private
   */
  startCreativePlayback_(data) {
    // Once the ad is successfully initialized it can start.
    // If the ad is not visible it must be made visible here.
    this.showSimidIFrame_();
    if (!this.isNonLinear_) {
      this.showAdPlayer_();
      this.adVideoElement_.src = document.getElementById('video_url').value;
      this.adVideoElement_.play();
    }
    this.simidProtocol.sendMessage(PlayerMessage.START_CREATIVE);
  }

  /**
   * Called if the creative responds with reject after the player
   * initializes the ad.
   * @param {!Object} data
   * @private
   */
  onAdInitializedFailed_(data) {
    console.log('Ad init failed. ' + JSON.stringify(data));
    this.destroyIframeAndResumeContent_();
  }

  /** @private */
  hideSimidIFrame_() {
    this.simidIframe_.style.display = 'none';
  }

  /** @private */
  showSimidIFrame_() {
    this.simidIframe_.style.display = 'block';
  }

  /** @private */
  showAdPlayer_() {
      // show the ad video element
    this.adVideoElement_.style.display = 'block';
    document.getElementById('ad_video_div').style.display = 'block';
  }

  /** @private */
  hideAdPlayer_() {
    // Unload the video
    this.adVideoElement_.style.display = 'none';
    document.getElementById('ad_video_div').style.display = 'none';
  }

  /**
   * Tracks the events on the video element specified by the simid spec
   * @private
   */
  trackEventsOnVideoElement_() {
    this.videoTrackingEvents_.set("durationchange", () => {
      this.simidProtocol.sendMessage(MediaMessage.DURATION_CHANGED);
    });
    this.videoTrackingEvents_.set("ended", this.videoComplete.bind(this));
    this.videoTrackingEvents_.set("error", () => {
      this.simidProtocol.sendMessage(MediaMessage.ERROR,
        {
          'error': '',  // TODO fill in these values correctly
          'message': ''
        });
    });
    this.videoTrackingEvents_.set("pause", () => {
      this.simidProtocol.sendMessage(MediaMessage.PAUSE);
    });
    this.videoTrackingEvents_.set("play", () => {
      this.simidProtocol.sendMessage(MediaMessage.PLAY);
    });
    this.videoTrackingEvents_.set("playing", () => {
      this.simidProtocol.sendMessage(MediaMessage.PLAYING);
    });
    this.videoTrackingEvents_.set("seeked", () => {
      this.simidProtocol.sendMessage(MediaMessage.SEEKED);
    });
    this.videoTrackingEvents_.set("seeking", () => {
      this.simidProtocol.sendMessage(MediaMessage.SEEKING);
    });
    this.videoTrackingEvents_.set("timeupdate", () => {
      this.simidProtocol.sendMessage(MediaMessage.TIME_UPDATE,
        {'currentTime': this.adVideoElement_.currentTime});
    });
    this.videoTrackingEvents_.set("volumechange", () => {
      this.simidProtocol.sendMessage(MediaMessage.VOLUME_CHANGE,
        {'volume': this.adVideoElement_.volume});
    });

    for(let [key, func] of this.videoTrackingEvents_) {
      this.adVideoElement_.addEventListener(key, func, true);
    }
  }

  /**
   * Called when video playback is complete.
   * @private
   */
  videoComplete() {
      this.simidProtocol.sendMessage(MediaMessage.ENDED);

      if (this.requestedDuration_ == NO_REQUESTED_DURATION) {
        this.stopAd(StopCode.MEDIA_PLAYBACK_COMPLETE);
      } else if (this.requestedDuration_ != UNLIMITED_DURATION) {
        // The creative has requested a different completion duration, so use that duration.
        const durationExtensionMs = (this.requestedDuration_ - this.adVideoElement_.duration) * 1000;
        setTimeout(() => {
          // The creative has suggested a different close time, so label this creative_initiated.
          this.stopAd(StopCode.CREATIVE_INITATED);
        }, durationExtensionMs);
      }
  }

  /**
   * Stops the ad and destroys the ad iframe.
   * @param {StopCode} reason The reason the ad will stop.
   */
  stopAd(reason = StopCode.PLAYER_INITATED) {
    // The iframe is only hidden on ad stoppage. The ad might still request
    // tracking pixels before it is cleaned up.
    this.hideSimidIFrame_();
    const closeMessage = {
      'code': reason,
    }
    // Wait for the SIMID creative to acknowledge stop and then clean
    // up the iframe.
    this.simidProtocol.sendMessage(PlayerMessage.AD_STOPPED)
      .then(() => this.destroyIframeAndResumeContent_());
  }

  /**
   * Removes the simid ad entirely and resumes video playback.
   * @private
   */
  destroyIframeAndResumeContent_() {
    this.hideAdPlayer_();
    this.adVideoElement_.src = '';
    this.destroySimidIframe();
    this.contentVideoElement_.play();
  }

  /** The creative wants to go full screen. */
  onRequestFullScreen(incomingMessage) {
    // The spec currently says to only request fullscreen for the iframe.
    let promise = null;
    if (this.simidIframe_.requestFullscreen) {
      promise = this.simidIframe_.requestFullscreen();
    } else if (this.simidIframe_.mozRequestFullScreen) {
      // Our tests indicate firefox will probably not respect the request.
      promise = this.simidIframe_.mozRequestFullScreen();
    } else if (this.simidIframe_.webkitRequestFullscreen) {
      promise = this.simidIframe_.webkitRequestFullscreen();
    } else if (this.simidIframe_.msRequestFullscreen) {
      // Our tests indicate IE will probably not respect the request.
      promise = this.simidIframe_.msRequestFullscreen();
    }
    if (promise) {
      promise.then(() => this.simidProtocol.resolve(incomingMessage));
    } else {
      // TODO: Many browsers are not returning promises but are still
      // going full screen. Assuming resolve (bad).
      this.simidProtocol.resolve(incomingMessage)
    }
  }
  
  /** The creative wants to play video. */
  onRequestPlay(incomingMessage) {
    if (!this.isNonLinear_) {
      this.adVideoElement_.play().then(
        // The play function returns a promise.
        this.simidProtocol.resolve(incomingMessage),
        this.simidProtocol.reject(incomingMessage)
      );
    }
  }
  
  /** The creative wants to pause ad video. */
  onRequestPause(incomingMessage) {
    this.adVideoElement_.pause();
    this.simidProtocol.resolve(incomingMessage);
  }

  /** The creative wants to pause content video. */
  onRequestVideoPause(incomingMessage) {
    this.contentVideoElement_.pause();
    this.simidProtocol.resolve(incomingMessage);
  }
  
  /** The creative wants to stop with a fatal error. */
  onCreativeFatalError(incomingMessage) {
    this.simidProtocol.resolve(incomingMessage);
    this.stopAd(StopCode.CREATIVE_INITIATED);
  }

  /** The creative wants to skip this ad. */
  onRequestSkip(incomingMessage) {
    this.simidProtocol.resolve(incomingMessage);
    this.simidProtocol.sendMessage(PlayerMessage.AD_SKIPPED, {})
        .then(() => this.destroyIframeAndResumeContent_());
  }
  
  /** The creative wants to stop the ad early. */
  onRequestStop(incomingMessage) {
    this.simidProtocol.resolve(incomingMessage);
    this.stopAd(StopCode.CREATIVE_INITIATED);
}

  /**
   * The player must implement sending tracking pixels from the creative.
   * This sample implementation does not show how to send tracking pixels or
   * replace macros. That should be done using the players standard workflow.
   */
  onReportTracking(incomingMessage) {
    const requestedUrlArray = incomingMessage.args['trackingUrls']
    console.log('The creative has asked for the player to ping ' + requestedUrlArray);
  }

  onRequestChangeAdDuration(incomingMessage) {
    if (this.requestedDuration_ != NO_REQUESTED_DURATION) {
      // TODO: Support multiple change duration requests.
      this.simidProtocol.reject(incomingMessage);
    }
    const requestedDuration  = incomingMessage.args['duration'];
    this.requestedDuration_ = requestedDuration;
    this.simidProtocol.resolve(incomingMessage);
  }

  onGetMediaState(incomingMessage) {
    const mediaState = {
      'currentSrc': this.adVideoElement_.currentSrc,
      'currentTime': this.adVideoElement_.currentTime,
      'duration': this.adVideoElement_.duration,
      'ended': this.adVideoElement_.ended,
      'muted': this.adVideoElement_.muted,
      'paused': this.adVideoElement_.paused,
      'volume': this.adVideoElement_.volume,
      'fullscreen': this.adVideoElement_.fullscreen,
    }
    this.simidProtocol.resolve(incomingMessage, mediaState);
  }

  onReceiveCreativeLog(incomingMessage) {
    const logMessage = incomingMessage.args['message']
    console.log("Received message from creative: " + logMessage);
  }

  sendLog(outgoingMessage) {
    const logMessage = {
      'message': outgoingMessage,
    }
    this.simidProtocol.sendMessage(PlayerMessage.LOG, logMessage);
  }
}