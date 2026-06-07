/**
 * Toast Notification Module
 * 
 * Sistema de notificações toast com suporte a múltiplos tipos:
 * - Sucesso (verde): 4s auto-dismiss
 * - Erro (vermelho): 5s, dismiss manual disponível
 * - Info (azul): 4s auto-dismiss
 * 
 * Múltiplos toasts empilham verticalmente no container fixo (top-right).
 * 
 * @module ui/toast
 */

/** Configuração de duração por tipo (ms) */
const DURATIONS = {
  success: 4000,
  error: 5000,
  info: 4000
};

/** Ícones SVG por tipo */
const ICONS = {
  success: `<svg class="toast__icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
  </svg>`,
  error: `<svg class="toast__icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
  </svg>`,
  info: `<svg class="toast__icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
  </svg>`
};

/** @type {HTMLElement|null} */
let container = null;

/**
 * Garante que o container de toasts existe no DOM.
 * @returns {HTMLElement}
 */
function ensureContainer() {
  if (container && document.body.contains(container)) {
    return container;
  }
  container = document.createElement('div');
  container.className = 'toast-container';
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('aria-atomic', 'false');
  document.body.appendChild(container);
  return container;
}

/**
 * Remove um toast do DOM com animação de saída.
 * @param {HTMLElement} toastEl
 */
function dismissToast(toastEl) {
  if (toastEl.dataset.dismissed === 'true') return;
  toastEl.dataset.dismissed = 'true';

  // Limpa o timer de auto-dismiss se existir
  const timerId = toastEl.dataset.timerId;
  if (timerId) {
    clearTimeout(Number(timerId));
  }

  toastEl.classList.add('toast--exiting');
  toastEl.addEventListener('animationend', () => {
    toastEl.remove();
  }, { once: true });
}

/**
 * Exibe uma notificação toast.
 * 
 * @param {string} message — Mensagem a exibir
 * @param {'success'|'error'|'info'} type — Tipo do toast
 * @returns {HTMLElement} O elemento toast criado
 */
export function showToast(message, type = 'info') {
  const validTypes = ['success', 'error', 'info'];
  if (!validTypes.includes(type)) {
    type = 'info';
  }

  const toastContainer = ensureContainer();
  const duration = DURATIONS[type];

  // Cria o elemento toast
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'alert');

  // Ícone
  const iconHtml = ICONS[type];

  // Conteúdo
  const contentHtml = `<span class="toast__content">${escapeHtml(message)}</span>`;

  // Botão de dismiss (sempre presente, mas mais relevante para erros)
  const dismissHtml = `<button class="toast__dismiss" aria-label="Fechar notificação" title="Fechar">&times;</button>`;

  // Barra de progresso
  const progressHtml = `<span class="toast__progress"></span>`;

  toast.innerHTML = iconHtml + contentHtml + dismissHtml + progressHtml;

  // Event listener para dismiss manual
  const dismissBtn = toast.querySelector('.toast__dismiss');
  dismissBtn.addEventListener('click', () => dismissToast(toast));

  // Adiciona ao container
  toastContainer.appendChild(toast);

  // Auto-dismiss após a duração configurada
  const timerId = setTimeout(() => dismissToast(toast), duration);
  toast.dataset.timerId = String(timerId);

  return toast;
}

/**
 * Exibe um toast de sucesso (verde, 4s).
 * @param {string} message
 * @returns {HTMLElement}
 */
export function showSuccess(message) {
  return showToast(message, 'success');
}

/**
 * Exibe um toast de erro (vermelho, 5s).
 * @param {string} message
 * @returns {HTMLElement}
 */
export function showError(message) {
  return showToast(message, 'error');
}

/**
 * Exibe um toast informativo (azul, 4s).
 * @param {string} message
 * @returns {HTMLElement}
 */
export function showInfo(message) {
  return showToast(message, 'info');
}

/**
 * Escapa HTML para prevenir XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
