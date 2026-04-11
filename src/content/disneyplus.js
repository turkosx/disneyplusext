(() => {
  const DEFAULT_SETTINGS = {
    enabled: true,
    autoFullscreenOnEpisodeChange: true,
    retryFullscreenWhilePlayerLoads: true,
    debugLogs: false,
  };

  const PLAYER_ROOT_SELECTORS = [
    ".player-container-root",
    "disney-web-player-ui",
    "disney-web-player",
    "#hudson-wrapper.video_view--theater",
    "#app_body_content",
  ];

  const FULLSCREEN_BUTTON_SELECTORS = [
    "toggle-fullscreen",
    ".toggle-fullscreen-button",
    '[aria-label*="fullscreen" i]',
    '[aria-label*="full screen" i]',
    '[aria-label*="tela cheia" i]',
    '[data-testid*="fullscreen" i]',
    'button[title*="fullscreen" i]',
    'button[title*="tela cheia" i]',
  ];

  const PLAYER_CONTAINER_SELECTORS = [
    "#app_body_content",
    "#hudson-wrapper.video_view--theater",
    ".player-container-root",
    ".mini-player-bounds",
    "disney-web-player",
    "video",
  ];

  const EPISODE_TRANSITION_SELECTORS = [
    "video",
    "play-next",
    ".play-next",
    "toggle-fullscreen",
    ".controls__footer",
    "disney-web-player-ui",
    ".player-container-root",
  ];

  const RETRY_DELAYS_MS = [150, 900, 2200, 4200, 7000, 11000];
  const EPISODE_TRANSITION_WINDOW_MS = 20000;

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    lastUrl: location.href,
    mutationObserver: null,
    currentVideo: null,
    videoListeners: [],
    pendingAttemptIds: new Set(),
    navigationPatched: false,
    episodeTransitionUntil: 0,
  };

  void initialize();

  async function initialize() {
    state.settings = await chrome.storage.local.get(DEFAULT_SETTINGS);

    installStorageWatcher();
    patchNavigationEvents();
    installMutationObserver();
    installFullscreenWatcher();
    bindCurrentVideo();
    scheduleFullscreenSweep("startup");
    log("Script de conteúdo inicializado.", state.settings);
  }

  function installStorageWatcher() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") {
        return;
      }

      let hasRelevantChange = false;

      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!changes[key]) {
          continue;
        }

        state.settings[key] = changes[key].newValue;
        hasRelevantChange = true;
      }

      if (!hasRelevantChange) {
        return;
      }

      log("Configurações atualizadas.", { ...state.settings });
      scheduleFullscreenSweep("settings-changed");
    });
  }

  function patchNavigationEvents() {
    if (state.navigationPatched) {
      return;
    }

    state.navigationPatched = true;

    const handleNavigation = (source) => {
      if (location.href === state.lastUrl && source !== "visibilitychange") {
        return;
      }

      state.lastUrl = location.href;
      bindCurrentVideo();
      markEpisodeTransition(`navigation:${source}`);
      scheduleFullscreenSweep(`navigation:${source}`);
      log("Navegação detectada.", { source, url: state.lastUrl });
    };

    for (const methodName of ["pushState", "replaceState"]) {
      const originalMethod = history[methodName];

      history[methodName] = function patchedHistoryMethod(...args) {
        const result = originalMethod.apply(this, args);
        handleNavigation(methodName);
        return result;
      };
    }

    window.addEventListener("popstate", () => handleNavigation("popstate"));
    window.addEventListener("hashchange", () => handleNavigation("hashchange"));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        handleNavigation("visibilitychange");
      }
    });
  }

  function installMutationObserver() {
    if (state.mutationObserver) {
      return;
    }

    state.mutationObserver = new MutationObserver((mutations) => {
      if (
        !state.settings.enabled ||
        !state.settings.autoFullscreenOnEpisodeChange ||
        !isPlaybackPage()
      ) {
        return;
      }

      let hasRelevantMutation = false;
      let hasTransitionSignal = false;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!isRelevantNode(node)) {
            continue;
          }

          hasRelevantMutation = true;

          if (isEpisodeTransitionNode(node)) {
            hasTransitionSignal = true;
          }
        }
      }

      if (!hasRelevantMutation) {
        return;
      }

      if (hasTransitionSignal) {
        markEpisodeTransition("dom-mutation");
      }

      bindCurrentVideo();
      scheduleFullscreenSweep("dom-mutation");
    });

    state.mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function installFullscreenWatcher() {
    document.addEventListener(
      "fullscreenchange",
      () => {
        if (document.fullscreenElement || !isPlaybackPage()) {
          return;
        }

        if (!isWithinEpisodeTransitionWindow()) {
          log("Saída de tela cheia ignorada fora da janela de troca.", {
            until: state.episodeTransitionUntil,
          });
          return;
        }

        scheduleFullscreenSweep("fullscreenchange:lost");
      },
      true
    );
  }

  function bindCurrentVideo() {
    const nextVideo = findCurrentVideo();

    if (!nextVideo || nextVideo === state.currentVideo) {
      return;
    }

    const hadPreviousVideo = Boolean(state.currentVideo);

    unbindCurrentVideo();
    state.currentVideo = nextVideo;

    const onPlaybackSignal = (event) => {
      if (event.type === "ended" || event.type === "emptied") {
        markEpisodeTransition(`video:${event.type}`);
      }

      scheduleFullscreenSweep(`video:${event.type}`);
      log("Evento do vídeo detectado.", { type: event.type });
    };

    for (const eventName of ["loadedmetadata", "play", "playing", "ended", "emptied"]) {
      nextVideo.addEventListener(eventName, onPlaybackSignal);
      state.videoListeners.push([eventName, onPlaybackSignal]);
    }

    if (hadPreviousVideo) {
      markEpisodeTransition("video:rebound");
      scheduleFullscreenSweep("video:rebound");
    }

    log("Vídeo principal vinculado.");
  }

  function unbindCurrentVideo() {
    if (!state.currentVideo || state.videoListeners.length === 0) {
      state.currentVideo = null;
      state.videoListeners = [];
      return;
    }

    for (const [eventName, listener] of state.videoListeners) {
      state.currentVideo.removeEventListener(eventName, listener);
    }

    state.currentVideo = null;
    state.videoListeners = [];
  }

  function scheduleFullscreenSweep(reason) {
    clearPendingAttempts();

    if (
      !state.settings.enabled ||
      !state.settings.autoFullscreenOnEpisodeChange ||
      !isPlaybackPage()
    ) {
      return;
    }

    const delays = state.settings.retryFullscreenWhilePlayerLoads
      ? RETRY_DELAYS_MS
      : [RETRY_DELAYS_MS[0]];

    delays.forEach((delay) => {
      const timeoutId = window.setTimeout(() => {
        state.pendingAttemptIds.delete(timeoutId);
        void attemptFullscreen(reason);
      }, delay);

      state.pendingAttemptIds.add(timeoutId);
    });
  }

  function clearPendingAttempts() {
    for (const timeoutId of state.pendingAttemptIds) {
      window.clearTimeout(timeoutId);
    }

    state.pendingAttemptIds.clear();
  }

  async function attemptFullscreen(reason) {
    if (
      !state.settings.enabled ||
      !state.settings.autoFullscreenOnEpisodeChange ||
      !isPlaybackPage()
    ) {
      return;
    }

    if (document.fullscreenElement) {
      log("Tela cheia já está ativa.", { reason });
      return;
    }

    wakePlayerControls();

    const fullscreenButton =
      findPlayerScopedElement(FULLSCREEN_BUTTON_SELECTORS, true) ||
      findPlayerScopedElement(FULLSCREEN_BUTTON_SELECTORS, false);

    if (fullscreenButton) {
      triggerClick(fullscreenButton);
      log("Clique no controle real de tela cheia executado.", {
        reason,
        selector: describeElement(fullscreenButton),
      });
      return;
    }

    const playerTarget = findPlayerTarget();

    if (playerTarget?.requestFullscreen) {
      try {
        await playerTarget.requestFullscreen();
        log("requestFullscreen executado no alvo do player.", {
          reason,
          selector: describeElement(playerTarget),
        });
        return;
      } catch (error) {
        log("requestFullscreen falhou.", {
          reason,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    log("Nenhum controle de tela cheia foi encontrado.", { reason });
  }

  function findPlayerTarget() {
    const directTarget = findPlayerScopedElement(PLAYER_CONTAINER_SELECTORS, true);

    if (directTarget?.requestFullscreen) {
      return directTarget;
    }

    const videoElement = findCurrentVideo();

    if (isVisible(videoElement)) {
      return (
        videoElement.closest(
          "#app_body_content, #hudson-wrapper, .player-container-root, .mini-player-bounds"
        ) ||
        videoElement
      );
    }

    return findVisibleElement(PLAYER_CONTAINER_SELECTORS);
  }

  function findCurrentVideo() {
    return findPlayerScopedElement(["video"], true) || document.querySelector("video");
  }

  function findPlayerScopedElement(selectors, visibleOnly) {
    for (const root of getPlayerRoots()) {
      for (const selector of selectors) {
        if (safeMatch(root, selector) && (!visibleOnly || isVisible(root))) {
          return root;
        }

        const candidates = root.querySelectorAll(selector);

        for (const candidate of candidates) {
          if (!visibleOnly || isVisible(candidate)) {
            return candidate;
          }
        }
      }
    }

    return null;
  }

  function getPlayerRoots() {
    const roots = [];

    for (const selector of PLAYER_ROOT_SELECTORS) {
      const candidate = document.querySelector(selector);

      if (candidate && !roots.includes(candidate)) {
        roots.push(candidate);
      }
    }

    return roots;
  }

  function findVisibleElement(selectors) {
    for (const selector of selectors) {
      const candidates = document.querySelectorAll(selector);

      for (const candidate of candidates) {
        if (isVisible(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }

  function isRelevantNode(node) {
    if (!(node instanceof Element)) {
      return false;
    }

    if (EPISODE_TRANSITION_SELECTORS.some((selector) => safeMatch(node, selector))) {
      return true;
    }

    if (FULLSCREEN_BUTTON_SELECTORS.some((selector) => safeMatch(node, selector))) {
      return true;
    }

    return Boolean(
      node.querySelector(
        "video, play-next, toggle-fullscreen, .controls__footer, disney-web-player-ui, .player-container-root"
      )
    );
  }

  function isEpisodeTransitionNode(node) {
    if (!(node instanceof Element)) {
      return false;
    }

    if (
      safeMatch(node, "video") ||
      safeMatch(node, "play-next") ||
      safeMatch(node, ".play-next") ||
      safeMatch(node, "disney-web-player-ui") ||
      safeMatch(node, ".player-container-root")
    ) {
      return true;
    }

    return Boolean(node.querySelector("video, play-next, .play-next"));
  }

  function isPlaybackPage() {
    return Boolean(
      document.querySelector(
        ".player-container-root disney-web-player, .player-container-root disney-web-player-ui, .player-container-root video"
      )
    );
  }

  function markEpisodeTransition(source) {
    state.episodeTransitionUntil = Date.now() + EPISODE_TRANSITION_WINDOW_MS;
    log("Janela de troca de episódio aberta.", {
      source,
      until: state.episodeTransitionUntil,
    });
  }

  function isWithinEpisodeTransitionWindow() {
    return Date.now() <= state.episodeTransitionUntil;
  }

  function wakePlayerControls() {
    const playerSurface = findPlayerTarget();

    if (!playerSurface) {
      return;
    }

    const rect = playerSurface.getBoundingClientRect();
    const clientX = rect.left + Math.max(rect.width / 2, 1);
    const clientY = rect.top + Math.max(rect.height / 2, 1);
    const mouseEventInit = {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
    };

    playerSurface.dispatchEvent(new MouseEvent("mousemove", mouseEventInit));
    playerSurface.dispatchEvent(new MouseEvent("mouseenter", mouseEventInit));

    if (typeof PointerEvent === "function") {
      playerSurface.dispatchEvent(
        new PointerEvent("pointermove", {
          ...mouseEventInit,
          isPrimary: true,
          pointerType: "mouse",
        })
      );
    }
  }

  function triggerClick(element) {
    const clickableTarget =
      element.querySelector?.("button") ||
      element.querySelector?.('[role="button"]') ||
      element;

    clickableTarget.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    );
    clickableTarget.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true })
    );
    clickableTarget.click();
  }

  function describeElement(element) {
    if (!(element instanceof Element)) {
      return "desconhecido";
    }

    const idPart = element.id ? `#${element.id}` : "";
    const classPart =
      typeof element.className === "string" && element.className.trim()
        ? `.${element.className.trim().replace(/\s+/g, ".")}`
        : "";

    return `${element.tagName.toLowerCase()}${idPart}${classPart}`;
  }

  function safeMatch(element, selector) {
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  }

  function isVisible(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    const computedStyle = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return (
      computedStyle.display !== "none" &&
      computedStyle.visibility !== "hidden" &&
      computedStyle.opacity !== "0" &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function log(message, payload) {
    if (!state.settings.debugLogs) {
      return;
    }

    console.info("[Disney+ Tela Cheia]", message, payload ?? "");
  }

  window.disneyPlusHelper = {
    attemptFullscreen,
    getSettings: () => ({ ...state.settings }),
  };
})();
