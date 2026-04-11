(() => {
  const DEFAULT_SETTINGS = {
    enabled: true,
    autoFullscreenOnEpisodeChange: true,
    autoSkipIntro: true,
    autoPlayNextEpisode: false,
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

  const PLAYER_CONTAINER_SELECTORS = [
    "#app_body_content",
    "#hudson-wrapper.video_view--theater",
    ".player-container-root",
    ".mini-player-bounds",
    "disney-web-player",
    "video",
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

  const NEXT_EPISODE_SELECTORS = [
    ".controls__footer__interstitial_container play-next",
    ".controls__footer__interstitial_container .play-next",
    'button[aria-label*="next episode" i]',
    '[aria-label*="next episode" i]',
    'button[aria-label*="proximo episodio" i]',
    '[aria-label*="proximo episodio" i]',
    'button[aria-label*="skip credits" i]',
    '[aria-label*="skip credits" i]',
    'button[aria-label*="pular encerramento" i]',
    '[aria-label*="pular encerramento" i]',
    'button[title*="next episode" i]',
    '[title*="next episode" i]',
    'button[title*="proximo episodio" i]',
    '[title*="proximo episodio" i]',
    'button[title*="skip credits" i]',
    '[title*="skip credits" i]',
    'button[title*="pular encerramento" i]',
    '[title*="pular encerramento" i]',
    '[data-tooltip*="NEXT EPISODE" i]',
    '[data-tooltip*="PROXIMO EPISODIO" i]',
    '[data-tooltip*="SKIP CREDITS" i]',
    '[data-tooltip*="PULAR ENCERRAMENTO" i]',
  ];

  const SKIP_INTRO_SELECTORS = [
    "skip-overlay button",
    "skip-overlay [role='button']",
    'button[aria-label*="skip" i]',
    'button[aria-label*="pular" i]',
    'button[title*="skip" i]',
    'button[title*="pular" i]',
    '[data-tooltip*="SKIP" i]',
    '[data-tooltip*="PULAR" i]',
    "skip-overlay",
  ];

  const EPISODE_TRANSITION_SELECTORS = [
    "video",
    "play-next",
    ".play-next",
    "toggle-fullscreen",
    "skip-overlay",
    ".controls__footer",
    "disney-web-player-ui",
    ".player-container-root",
  ];

  const CLICKABLE_CANDIDATE_SELECTORS = [
    "button",
    "[role='button']",
    "[aria-label]",
    "[data-tooltip]",
    "[title]",
    "play-next",
    "skip-overlay",
    "toggle-fullscreen",
  ];

  const SKIP_INTRO_TERMS = [
    "skip intro",
    "skip recap",
    "pular introducao",
    "pular abertura",
    "pular resumo",
    "skip",
    "pular",
  ];

  const NEXT_EPISODE_TERMS = [
    "next episode",
    "play next",
    "proximo episodio",
    "skip credits",
    "pular encerramento",
  ];

  const AUTOMATION_TICK_MS = 800;
  const RETRY_DELAYS_MS = [150, 900, 2200, 4200, 7000, 11000];
  const EPISODE_TRANSITION_WINDOW_MS = 20000;
  const ENDING_SKIP_WINDOW_SEC = 35;
  const ENDING_SKIP_MIN_PROGRESS = 0.94;
  const ACTION_THROTTLE_MS = {
    skipIntro: 1200,
    playNextEpisode: 2000,
    fullscreen: 1200,
  };

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    lastUrl: location.href,
    mutationObserver: null,
    currentVideo: null,
    videoListeners: [],
    pendingAttemptIds: new Set(),
    automationTickerId: null,
    navigationPatched: false,
    episodeTransitionUntil: 0,
    shouldRestoreFullscreen: false,
    sweepInFlight: false,
    playbackKey: "",
    handledActionKeys: new Set(),
    lastActionAt: {
      skipIntro: 0,
      playNextEpisode: 0,
      fullscreen: 0,
    },
  };

  void initialize();

  async function initialize() {
    state.settings = await chrome.storage.local.get(DEFAULT_SETTINGS);

    installStorageWatcher();
    patchNavigationEvents();
    installMutationObserver();
    installFullscreenWatcher();
    installFullscreenIntentTracker();
    startAutomationTicker();
    bindCurrentVideo();
    syncPlaybackKey("startup");
    scheduleAutomationSweep("startup");
    log("Script de conteudo inicializado.", state.settings);
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

      log("Configuracoes atualizadas.", { ...state.settings });
      startAutomationTicker();
      scheduleAutomationSweep("settings-changed");
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
      scheduleAutomationSweep(`navigation:${source}`);
      log("Navegacao detectada.", { source, url: state.lastUrl });
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
      if (!state.settings.enabled) {
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
      scheduleAutomationSweep("dom-mutation");
    });

    state.mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden"],
    });
  }

  function installFullscreenWatcher() {
    document.addEventListener(
      "fullscreenchange",
      () => {
        if (isPlayerFullscreenActive()) {
          state.shouldRestoreFullscreen = true;
          log("Modo de tela cheia detectado.", {
            restore: state.shouldRestoreFullscreen,
          });
          return;
        }

        if (
          !state.settings.enabled ||
          !state.settings.autoFullscreenOnEpisodeChange ||
          !isPlaybackPage()
        ) {
          return;
        }

        if (!isWithinEpisodeTransitionWindow()) {
          state.shouldRestoreFullscreen = false;
          log("Saida de tela cheia ignorada fora da janela de troca.", {
            until: state.episodeTransitionUntil,
          });
          return;
        }

        scheduleAutomationSweep("fullscreenchange:lost");
      },
      true
    );
  }

  function installFullscreenIntentTracker() {
    const handleIntent = (event) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (!matchesSelectorOrClosest(target, FULLSCREEN_BUTTON_SELECTORS)) {
        return;
      }

      window.setTimeout(() => {
        syncFullscreenIntent("fullscreen-control-click");
      }, 250);
    };

    document.addEventListener("click", handleIntent, true);
    document.addEventListener("dblclick", handleIntent, true);
    syncFullscreenIntent("startup");
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
      syncPlaybackKey(`video:${event.type}`);

      if (event.type === "ended" || event.type === "emptied") {
        markEpisodeTransition(`video:${event.type}`);
      }

      scheduleAutomationSweep(`video:${event.type}`);
      log("Evento do video detectado.", { type: event.type });
    };

    for (const eventName of ["loadedmetadata", "play", "playing", "ended", "emptied"]) {
      nextVideo.addEventListener(eventName, onPlaybackSignal);
      state.videoListeners.push([eventName, onPlaybackSignal]);
    }

    if (hadPreviousVideo) {
      markEpisodeTransition("video:rebound");
      scheduleAutomationSweep("video:rebound");
    }

    syncPlaybackKey("bind-current-video");
    log("Video principal vinculado.");
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

  function scheduleAutomationSweep(reason) {
    clearPendingAttempts();

    if (!state.settings.enabled || !hasAnyAutomationEnabled()) {
      return;
    }

    const delays = state.settings.retryFullscreenWhilePlayerLoads
      ? RETRY_DELAYS_MS
      : [RETRY_DELAYS_MS[0]];

    delays.forEach((delay) => {
      const timeoutId = window.setTimeout(() => {
        state.pendingAttemptIds.delete(timeoutId);
        void runAutomationSweep(reason);
      }, delay);

      state.pendingAttemptIds.add(timeoutId);
    });
  }

  async function runAutomationSweep(reason) {
    if (state.sweepInFlight) {
      return;
    }

    if (!state.settings.enabled || !hasAnyAutomationEnabled() || !isPlaybackPage()) {
      return;
    }

    state.sweepInFlight = true;

    try {
      syncPlaybackKey(reason);

      if (isPlayerFullscreenActive()) {
        state.shouldRestoreFullscreen = true;
      }

      if (state.settings.autoSkipIntro) {
        attemptSkipIntro(reason);
      }

      if (state.settings.autoPlayNextEpisode) {
        attemptPlayNextEpisode(reason);
      }

      if (state.settings.autoFullscreenOnEpisodeChange) {
        await attemptFullscreen(reason);
      }
    } finally {
      state.sweepInFlight = false;
    }
  }

  function clearPendingAttempts() {
    for (const timeoutId of state.pendingAttemptIds) {
      window.clearTimeout(timeoutId);
    }

    state.pendingAttemptIds.clear();
  }

  function attemptSkipIntro(reason) {
    if (!state.settings.enabled || !state.settings.autoSkipIntro || !isPlaybackPage()) {
      return false;
    }

    const target = findSkipIntroTarget();

    if (!target || isActionThrottled("skipIntro") || wasActionHandled("skipIntro", target)) {
      return false;
    }

    triggerClick(target);
    noteAction("skipIntro");
    markActionHandled("skipIntro", target);
    log("Clique em pular introducao executado.", {
      reason,
      selector: describeElement(target),
    });
    return true;
  }

  function attemptPlayNextEpisode(reason) {
    if (!state.settings.enabled || !state.settings.autoPlayNextEpisode || !isPlaybackPage()) {
      return false;
    }

    const target = findNextEpisodeTarget();

    if (
      !target ||
      isActionThrottled("playNextEpisode") ||
      wasActionHandled("playNextEpisode", target)
    ) {
      return false;
    }

    triggerClick(target);
    noteAction("playNextEpisode");
    markActionHandled("playNextEpisode", target);
    markEpisodeTransition("play-next-click");
    log("Clique em pular encerramento executado.", {
      reason,
      selector: describeElement(target),
    });

    window.setTimeout(() => {
      scheduleAutomationSweep("play-next-click");
    }, 250);

    return true;
  }

  async function attemptFullscreen(reason) {
    if (
      !state.settings.enabled ||
      !state.settings.autoFullscreenOnEpisodeChange ||
      !isPlaybackPage()
    ) {
      return false;
    }

    if (isPlayerFullscreenActive()) {
      state.shouldRestoreFullscreen = true;
      log("Tela cheia ja esta ativa.", { reason });
      return false;
    }

    if (isActionThrottled("fullscreen")) {
      return false;
    }

    if (!state.shouldRestoreFullscreen && !isWithinEpisodeTransitionWindow()) {
      log("Tela cheia ignorada porque ainda nao houve intencao do usuario.", {
        reason,
        restore: state.shouldRestoreFullscreen,
      });
      return false;
    }

    wakePlayerControls();
    await wait(120);

    const fullscreenButton =
      findPlayerScopedElement(FULLSCREEN_BUTTON_SELECTORS, true) ||
      findPlayerScopedElement(FULLSCREEN_BUTTON_SELECTORS, false);

    if (fullscreenButton) {
      triggerClick(fullscreenButton);
      noteAction("fullscreen");
      await wait(180);

      if (isPlayerFullscreenActive()) {
        state.shouldRestoreFullscreen = true;
        log("Clique no controle real de tela cheia executado.", {
          reason,
          selector: describeElement(fullscreenButton),
        });
        return true;
      }

      log("Clique no controle de tela cheia nao confirmou o modo esperado.", {
        reason,
        selector: describeElement(fullscreenButton),
      });
    }

    for (const playerTarget of getFullscreenRequestTargets()) {
      if (!playerTarget?.requestFullscreen) {
        continue;
      }

      try {
        await playerTarget.requestFullscreen();
        await wait(150);

        if (isPlayerFullscreenActive()) {
          noteAction("fullscreen");
          state.shouldRestoreFullscreen = true;
          log("requestFullscreen executado no alvo do video.", {
            reason,
            selector: describeElement(playerTarget),
          });
          return true;
        }
      } catch (error) {
        log("requestFullscreen falhou.", {
          reason,
          selector: describeElement(playerTarget),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const browserFullscreenActivated = await attemptBrowserWindowFullscreen(reason);

    if (browserFullscreenActivated) {
      return true;
    }

    log("Nenhum controle de tela cheia foi encontrado.", { reason });
    return false;
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

  function findSkipIntroTarget() {
    const target =
      findPlayerScopedElement(SKIP_INTRO_SELECTORS, true) ||
      findMatchingClickableByTerms(SKIP_INTRO_TERMS);

    if (!target || !isVisible(target)) {
      return null;
    }

    return target;
  }

  function findNextEpisodeTarget() {
    const candidates = [];
    const seen = new Set();

    for (const candidate of collectElementsFromRoots(getSearchRoots(), NEXT_EPISODE_SELECTORS, true)) {
      pushUnique(candidate, candidates, seen);
    }

    for (const candidate of findMatchingClickableCandidatesByTerms(NEXT_EPISODE_TERMS)) {
      pushUnique(candidate, candidates, seen);
    }

    for (const candidate of collectElementsFromRoots(getSearchRoots(), ["play-next", ".play-next"], true)) {
      pushUnique(candidate, candidates, seen);
    }

    for (const candidate of candidates) {
      if (isEligibleNextEpisodeTarget(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  function findPlayerScopedElement(selectors, visibleOnly) {
    return findElementInRoots(getPlayerRoots(), selectors, visibleOnly);
  }

  function findMatchingClickableByTerms(terms) {
    return findMatchingClickableCandidatesByTerms(terms)[0] ?? null;
  }

  function findMatchingClickableCandidatesByTerms(terms) {
    return collectElementsFromRoots(getSearchRoots(), CLICKABLE_CANDIDATE_SELECTORS, true).filter(
      (candidate) => matchesTerms(candidate, terms)
    );
  }

  function matchesTerms(element, terms) {
    const haystack = normalizeText(getSemanticText(element));

    if (!haystack) {
      return false;
    }

    return terms.some((term) => haystack.includes(term));
  }

  function getSemanticText(element) {
    if (!(element instanceof Element)) {
      return "";
    }

    return [
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-tooltip"),
    ]
      .filter(Boolean)
      .join(" ");
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

  function getSearchRoots() {
    const roots = [...getPlayerRoots()];

    if (document.documentElement && !roots.includes(document.documentElement)) {
      roots.push(document.documentElement);
    }

    return roots;
  }

  function hasAnyAutomationEnabled() {
    return Boolean(
      state.settings.autoFullscreenOnEpisodeChange ||
        state.settings.autoSkipIntro ||
        state.settings.autoPlayNextEpisode
    );
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

  function findElementInRoots(roots, selectors, visibleOnly) {
    for (const element of collectElementsFromRoots(roots, selectors, visibleOnly)) {
      return element;
    }

    return null;
  }

  function collectElementsFromRoots(roots, selectors, visibleOnly) {
    const results = [];
    const seen = new Set();

    for (const root of roots) {
      collectElementsFromTree(root, selectors, visibleOnly, results, seen);
    }

    return results;
  }

  function collectElementsFromTree(root, selectors, visibleOnly, results, seen) {
    if (!root) {
      return;
    }

    if (root instanceof Element) {
      for (const selector of selectors) {
        if (safeMatch(root, selector) && (!visibleOnly || isVisible(root))) {
          pushUnique(root, results, seen);
        }
      }
    }

    if ("querySelectorAll" in root) {
      for (const selector of selectors) {
        const candidates = root.querySelectorAll(selector);

        for (const candidate of candidates) {
          if (!visibleOnly || isVisible(candidate)) {
            pushUnique(candidate, results, seen);
          }
        }
      }
    }

    const descendants =
      "querySelectorAll" in root ? root.querySelectorAll("*") : [];

    if (root instanceof Element && root.shadowRoot) {
      collectElementsFromTree(root.shadowRoot, selectors, visibleOnly, results, seen);
    }

    for (const descendant of descendants) {
      if (descendant.shadowRoot) {
        collectElementsFromTree(descendant.shadowRoot, selectors, visibleOnly, results, seen);
      }
    }
  }

  function pushUnique(element, results, seen) {
    if (seen.has(element)) {
      return;
    }

    seen.add(element);
    results.push(element);
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

    if (SKIP_INTRO_SELECTORS.some((selector) => safeMatch(node, selector))) {
      return true;
    }

    return Boolean(
      node.querySelector(
        [
          "video",
          "play-next",
          "toggle-fullscreen",
          "skip-overlay",
          ".controls__footer",
          "disney-web-player-ui",
          ".player-container-root",
        ].join(", ")
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

  function isPlayerFullscreenActive() {
    return Boolean(
      document.fullscreenElement || document.querySelector(".mini-player-bounds--fullscreen")
    );
  }

  function markEpisodeTransition(source) {
    state.episodeTransitionUntil = Date.now() + EPISODE_TRANSITION_WINDOW_MS;
    log("Janela de troca de episodio aberta.", {
      source,
      until: state.episodeTransitionUntil,
    });
  }

  function isWithinEpisodeTransitionWindow() {
    return Date.now() <= state.episodeTransitionUntil;
  }

  function isActionThrottled(actionKey) {
    const lastTimestamp = state.lastActionAt[actionKey] ?? 0;
    const throttleWindow = ACTION_THROTTLE_MS[actionKey] ?? 1000;

    return Date.now() - lastTimestamp < throttleWindow;
  }

  function noteAction(actionKey) {
    state.lastActionAt[actionKey] = Date.now();
  }

  function syncPlaybackKey(source) {
    const nextPlaybackKey = buildPlaybackKey();

    if (!nextPlaybackKey || nextPlaybackKey === state.playbackKey) {
      return false;
    }

    state.playbackKey = nextPlaybackKey;
    state.handledActionKeys.clear();
    log("Ciclo de reproducao atualizado.", {
      source,
      playbackKey: nextPlaybackKey,
    });
    return true;
  }

  function buildPlaybackKey() {
    const video = state.currentVideo || findCurrentVideo();
    const source = normalizeText(video?.currentSrc || video?.src || "");
    const duration =
      Number.isFinite(video?.duration) && video.duration > 0
        ? String(Math.round(video.duration))
        : "";
    const path = normalizeText(location.pathname || location.href);
    const title = normalizeText(document.title);

    return [path, title, source, duration].filter(Boolean).join("|");
  }

  function wasActionHandled(actionKey, target) {
    return state.handledActionKeys.has(buildHandledActionKey(actionKey, target));
  }

  function markActionHandled(actionKey, target) {
    state.handledActionKeys.add(buildHandledActionKey(actionKey, target));
  }

  function buildHandledActionKey(actionKey, target) {
    return [
      actionKey,
      state.playbackKey || buildPlaybackKey() || normalizeText(location.href),
      buildActionTargetSignature(target),
    ].join("|");
  }

  function buildActionTargetSignature(element) {
    if (!(element instanceof Element)) {
      return "desconhecido";
    }

    const clickableTarget = resolveClickableTarget(element);
    const target = clickableTarget instanceof Element ? clickableTarget : element;
    const context = [
      describeElement(target),
      getSemanticText(target),
      target.getAttribute("data-testid"),
      target.closest(".controls__footer__interstitial_container") ? "interstitial" : "",
      target.closest(".controls__center") ? "footer-controls-center" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return normalizeText(context);
  }

  function isEligibleNextEpisodeTarget(element) {
    if (!(element instanceof Element) || !isVisible(element)) {
      return false;
    }

    const clickableTarget = resolveClickableTarget(element);
    const target = clickableTarget instanceof Element ? clickableTarget : element;
    const isFooterControl =
      isStandardFooterNextControl(target) || isStandardFooterNextControl(element);

    if (
      target.closest(".controls__footer__interstitial_container") ||
      element.closest(".controls__footer__interstitial_container")
    ) {
      return true;
    }

    if (isFooterControl) {
      return isWithinEndingWindow();
    }

    return matchesTerms(target, NEXT_EPISODE_TERMS) || matchesTerms(element, NEXT_EPISODE_TERMS);
  }

  function isStandardFooterNextControl(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    return Boolean(
      element.closest(".controls__center play-next, .controls__center .play-next")
    );
  }

  function isWithinEndingWindow() {
    const video = state.currentVideo || findCurrentVideo();

    if (!(video instanceof HTMLVideoElement)) {
      return false;
    }

    if (video.ended) {
      return true;
    }

    const duration = Number(video.duration);
    const currentTime = Number(video.currentTime);

    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(currentTime)) {
      return false;
    }

    const remainingSeconds = duration - currentTime;

    return (
      remainingSeconds > 0 &&
      remainingSeconds <= ENDING_SKIP_WINDOW_SEC &&
      currentTime / duration >= ENDING_SKIP_MIN_PROGRESS
    );
  }

  function startAutomationTicker() {
    if (state.automationTickerId !== null) {
      return;
    }

    state.automationTickerId = window.setInterval(() => {
      if (!state.settings.enabled || !hasAnyAutomationEnabled() || !isPlaybackPage()) {
        return;
      }

      void runAutomationSweep("ticker");
    }, AUTOMATION_TICK_MS);
  }

  function syncFullscreenIntent(source) {
    const nextValue = isPlayerFullscreenActive();

    if (nextValue) {
      state.shouldRestoreFullscreen = true;
      log("Intencao de restaurar tela cheia confirmada.", { source });
      return;
    }

    if (!isWithinEpisodeTransitionWindow()) {
      state.shouldRestoreFullscreen = false;
      log("Intencao de restaurar tela cheia limpa.", { source });
    }
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

  function getFullscreenRequestTargets() {
    const targets = [];

    for (const candidate of [
      findPlayerTarget(),
      document.querySelector("#app_body_content"),
      document.querySelector(".player-container-root"),
      document.querySelector(".mini-player-bounds"),
      findCurrentVideo(),
    ]) {
      if (candidate && !targets.includes(candidate)) {
        targets.push(candidate);
      }
    }

    return targets;
  }

  async function attemptBrowserWindowFullscreen(reason) {
    if (!state.shouldRestoreFullscreen && !isWithinEpisodeTransitionWindow()) {
      return false;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "set-window-fullscreen",
      });

      if (response?.ok) {
        noteAction("fullscreen");
        state.shouldRestoreFullscreen = true;
        log("Fallback de tela cheia da janela executado.", { reason });
        return true;
      }

      log("Fallback de tela cheia da janela falhou.", {
        reason,
        error: response?.error ?? "Resposta desconhecida.",
      });
    } catch (error) {
      log("Nao foi possivel pedir tela cheia da janela.", {
        reason,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return false;
  }

  function triggerClick(element) {
    const clickableTarget = resolveClickableTarget(element);
    const rect = clickableTarget.getBoundingClientRect();
    const clientX = rect.left + Math.max(rect.width / 2, 1);
    const clientY = rect.top + Math.max(rect.height / 2, 1);
    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      buttons: 1,
      clientX,
      clientY,
    };

    clickableTarget.focus?.();

    if (typeof PointerEvent === "function") {
      clickableTarget.dispatchEvent(new PointerEvent("pointerdown", eventInit));
      clickableTarget.dispatchEvent(new PointerEvent("pointerup", eventInit));
    }

    clickableTarget.dispatchEvent(new MouseEvent("mousedown", eventInit));
    clickableTarget.dispatchEvent(new MouseEvent("mouseup", eventInit));
    clickableTarget.dispatchEvent(new MouseEvent("click", eventInit));
    clickableTarget.click();
  }

  function resolveClickableTarget(element) {
    if (!(element instanceof Element)) {
      return element;
    }

    const shadowButton =
      element.shadowRoot?.querySelector("button") ||
      element.shadowRoot?.querySelector('[role="button"]');

    return (
      shadowButton ||
      element.querySelector?.("button") ||
      element.querySelector?.('[role="button"]') ||
      element
    );
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

  function normalizeText(value) {
    return (value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function safeMatch(element, selector) {
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  }

  function matchesSelectorOrClosest(element, selectors) {
    return selectors.some((selector) => {
      try {
        return element.matches(selector) || Boolean(element.closest(selector));
      } catch {
        return false;
      }
    });
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

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  window.disneyPlusHelper = {
    attemptFullscreen,
    attemptPlayNextEpisode,
    attemptSkipIntro,
    getSettings: () => ({ ...state.settings }),
    runAutomationSweep,
  };
})();
