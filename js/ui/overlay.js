/**
 * Overlay Module
 * 
 * Overlay bloqueante com spinner animado, timer de tempo decorrido
 * e contador de progresso. Usado para operações longas como
 * import, export e upload batch.
 * 
 * @module ui/overlay
 */

/** @type {HTMLElement|null} */
let overlayEl = null;

/** @type {number|null} Timer interval ID */
let timerInterval = null;

/** @type {number} Segundos decorridos desde a abertura do overlay */
let elapsedSeconds = 0;

/**
 * Formata segundos em string mm:ss.
 * @param {number} seconds
 * @returns {string}
 */
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Cria o elemento overlay no DOM (se não existir).
 * @returns {HTMLElement}
 */
function ensureOverlay() {
  if (overlayEl && document.body.contains(overlayEl)) {
    return overlayEl;
  }

  overlayEl = document.createElement('div');
  overlayEl.className = 'overlay';
  overlayEl.setAttribute('role', 'dialog');
  overlayEl.setAttribute('aria-modal', 'true');
  overlayEl.setAttribute('aria-label', 'Operação em andamento');

  overlayEl.innerHTML = `
    <div class="overlay__content">
      <div class="spinner" aria-hidden="true"></div>
      <p class="overlay__message">Processando...</p>
      <p class="overlay__timer" aria-live="polite" aria-atomic="true">00:00</p>
      <p class="overlay__detail"></p>
    </div>
  `;

  document.body.appendChild(overlayEl);
  return overlayEl;
}

/**
 * Inicia o timer de tempo decorrido.
 */
function startTimer() {
  stopTimer();
  elapsedSeconds = 0;
  updateTimerDisplay();

  timerInterval = setInterval(() => {
    elapsedSeconds++;
    updateTimerDisplay();
  }, 1000);
}

/**
 * Para o timer de tempo decorrido.
 */
function stopTimer() {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

/**
 * Atualiza o display do timer no DOM.
 */
function updateTimerDisplay() {
  if (!overlayEl) return;
  const timerEl = overlayEl.querySelector('.overlay__timer');
  if (timerEl) {
    timerEl.textContent = formatTime(elapsedSeconds);
  }
}

/**
 * Exibe o overlay bloqueante com spinner e timer.
 * 
 * @param {string} [message='Processando...'] — Mensagem principal
 * @returns {void}
 */
export function showOverlay(message = 'Processando...') {
  const overlay = ensureOverlay();

  // Atualiza a mensagem
  const messageEl = overlay.querySelector('.overlay__message');
  if (messageEl) {
    messageEl.textContent = message;
  }

  // Limpa o detalhe
  const detailEl = overlay.querySelector('.overlay__detail');
  if (detailEl) {
    detailEl.textContent = '';
  }

  // Ativa o overlay
  overlay.classList.add('overlay--active');

  // Inicia o timer
  startTimer();
}

/**
 * Atualiza o conteúdo do overlay sem fechar/reabrir.
 * 
 * @param {Object} options
 * @param {string} [options.message] — Nova mensagem principal
 * @param {string} [options.detail] — Texto de detalhe (ex: "3 de 10 arquivos")
 * @param {number} [options.progress] — Progresso 0–100 (exibido no detalhe se fornecido)
 * @returns {void}
 */
export function updateOverlay({ message, detail, progress } = {}) {
  if (!overlayEl) return;

  if (message !== undefined) {
    const messageEl = overlayEl.querySelector('.overlay__message');
    if (messageEl) {
      messageEl.textContent = message;
    }
  }

  if (detail !== undefined) {
    const detailEl = overlayEl.querySelector('.overlay__detail');
    if (detailEl) {
      detailEl.textContent = detail;
    }
  } else if (progress !== undefined) {
    const detailEl = overlayEl.querySelector('.overlay__detail');
    if (detailEl) {
      detailEl.textContent = `${Math.round(progress)}%`;
    }
  }
}

/**
 * Oculta o overlay e para o timer.
 * 
 * @returns {void}
 */
export function hideOverlay() {
  stopTimer();

  if (overlayEl) {
    overlayEl.classList.remove('overlay--active');
  }
}
