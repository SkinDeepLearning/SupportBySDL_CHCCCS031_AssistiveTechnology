(function () {
  function getParams(url) {
    const querystring = url.split('?')[1]
    if (!querystring) {
      return {}
    }

    return querystring.split('&').reduce(function (memo, param) {
      const tuple = param.split('=', 2)
      memo[tuple[0]] = decodeURIComponent(tuple[1].replace(/\+/g, ' '))

      return memo
    }, {})
  }

  function buildFlashVars(params) {
    const flashParams = {
      vEnableOne: 'true',
      vInterfaceObject: 'vInterfaceObject',
      vRestoreStateData: params.state
    }

    return Object.keys(flashParams).reduce(function (memo, key) {
      if (flashParams[key]) {
        memo.push(key.concat('=', flashParams[key]))
      }

      return memo
    }, []).join('&')
  }

  const params = getParams(window.location.href)
  const debug = !!params.debug

  const handlers = {
    'frame:loaded': frameLoaded,
    'slide:capture': captureSlide,
    'player:pause': triggerPause,
    'player:play': triggerPlay,
    'player:focus': focusPlayer,
    'preview:navigate': jumpToContext,
    'preview:changeset': livePreview
  }

  if (Object.prototype.hasOwnProperty.call(params, 'wmode')) {
    window.g_strWMode = params['wmode']
  }

  window.autoSpider = true
  window.g_strFlashVars = buildFlashVars(params)
  window.vEnableOne = true
  window.addEventListener('message', handleMessage)

  window.vRestoreStateData = params.state

  window.vInterfaceObject = {
    isRise: !!params.rise,
    OnSlideStarted: function (id) {
      sendParentMessage({
        type: 'slide:change',
        data: id
      })
    },
    OnSlideTransition: function (id, duration) {
      sendParentMessage({
        type: 'slide:transition',
        data: {
          id: id,
          duration: duration
        }
      })
    },
    OnPlayButtonShown: function () {
      sendParentMessage({
        type: 'playButton:shown'
      })
    },
    OnEnterFullscreen: function () {
      sendParentMessage({
        type: 'fullscreen:enter',
        windowName: window.name
      })
    },
    OnExitFullscreen: function () {
      sendParentMessage({
        type: 'fullscreen:exit',
        windowName: window.name
      })
    },
    OnPlayerClicked: function () {
      sendParentMessage({
        type: 'player:click'
      })
    },
    LmsUpdate: function (data) {
      sendParentMessage({
        type: 'course:update',
        payload: data,
        windowName: window.name
      })
    }
  }

  let playerTimeupdateWaiting = false

  function throttledPlayerTimeupdate() {
    if (!playerTimeupdateWaiting) {
      playerTimeupdateWaiting = true

      sendParentMessage({
        type: 'player:timeupdate'
      })

      setTimeout(() => {
        playerTimeupdateWaiting = false
      }, 2000)
    }
  }

  function frameLoaded() {
    const videoNodes = document.querySelectorAll('video')

    videoNodes.forEach(video =>
      video.addEventListener('timeupdate', throttledPlayerTimeupdate)
    )
  }

  function captureSlide(data) {
    const player = window.GetPlayer()
    if (typeof player.CaptureSlideImage !== 'function') {
      log('player-interface.js: player.CaptureSlideImage is not a function! returning early')

      return
    }
    sendParentMessage({
      type: 'slide:capture',
      data: {
        commentId: data.commentId,
        snapshot: player.CaptureSlideImage()
      }
    })
  }

  function triggerPause() {
    const player = window.GetPlayer()
    if (typeof player.TriggerPause !== 'function') {
      log('player-interface.js: player.TriggerPause is not a function! returning early')

      return
    }
    player.TriggerPause()
  }

  function jumpToContext(data) {
    const player = window.GetPlayer()
    if (typeof player.JumpToLocation !== 'function') {
      log('player-interface.js: player.JumpToLocation is not a function! returning early')

      return
    }
    player.JumpToLocation(data.path)
  }

  function triggerPlay() {
    const player = window.GetPlayer()
    if (typeof player.TriggerPlay !== 'function') {
      log('player-interface.js: player.TriggerPlay is not a function! returning early')

      return
    }
    player.TriggerPlay()
  }

  function focusPlayer() {
    window.focus()
  }

  function livePreview(data) {
    const player = window.GetPlayer()
    if (typeof player.UpdateSegmentPartText !== 'function') {
      log('player-interface.js: player.UpdateSegmentPartText is not a function! returning early')

      return
    }
    data.forEach(change => {
      if (change?.updatedXlifTarget) {
        return player.UpdateSegmentPartText(change?.path[1], change?.updatedXlifTarget)
      }

      player.UpdateTextLibItem(change?.path, change?.updatedTarget)
    })
  }

  function handleMessage(e) {
    const event = e.data
    log('player-interface.js: received post message from parent window', event)
    if (typeof event !== 'object') {
      return
    }
    const handler = handlers[event.type]
    if (!handler) {
      return
    }
    try {
      handler(event.data)
    } catch (err) {
      log('player-interface.js: error executing ' + event.type + ' message handler', err)
      window.playerInterfaceError = err
      sendParentMessage({
        type: 'error',
        data: {
          eventType: event.type,
          eventData: event.data,
          errorJson: stringifyError(err),
          playerVersion: (window.globals && window.globals.playerVersion) || 'unknown'
        }
      })
    }
  }

  function sendParentMessage(message) {
    log('player-interface.js: sending post message to parent window', message)
    window.parent.postMessage(message, '*')
  }

  function log(...args) {
    if (!debug) {
      return
    }
    console.log(args)
  }

  function stringifyError(err) {
    const jsonify = function (obj) {
      return JSON.stringify(obj, Object.getOwnPropertyNames(obj))
    }

    const safeToString = function (obj, fallback) {
      return typeof obj.toString === 'function' ? obj.toString() || fallback : fallback
    }

    let json = jsonify(err)

    if (json !== '{}') {
      const rehydrated = JSON.parse(json)

      if (!rehydrated.message) {
        rehydrated.message = err.message || safeToString(err, '[failed to obtain error message]')
        json = jsonify(rehydrated)
      }

      return json
    }

    const pseudoError = {
      message: safeToString(err, '[unable to convert error to json/string]')
    }

    return jsonify(pseudoError)
  }
})()
