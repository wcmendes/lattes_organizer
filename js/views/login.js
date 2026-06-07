/**
 * Login View — ComprovaLattes
 *
 * Displays the "Entrar com Google" button as the sole access point.
 * Shows error message if authentication fails or permissions are denied.
 *
 * Requirements: 1.1, 1.8
 * @module views/login
 */

import { signIn } from '../auth.js';

/**
 * Renders the login view HTML.
 * Centered card with app name, description, and login button.
 * @returns {string} HTML string for the login view
 */
export function render() {
  return `
    <div class="login-view">
      <div class="card login-card text-center">
        <h1 class="login-card__title">ComprovaLattes</h1>
        <p class="login-card__description">
          Gerencie e associe comprovantes acadêmicos às entradas do seu Currículo Lattes.
        </p>
        <button id="btn-google-login" class="btn btn--primary btn--lg" type="button">
          Entrar com Google
        </button>
        <div id="login-error" class="login-card__error hidden" role="alert" aria-live="polite"></div>
      </div>
    </div>
  `;
}

/**
 * Attaches event listeners after the login view is rendered into the DOM.
 * Should be called after render() output is injected into #app.
 */
export function mount() {
  const loginBtn = document.getElementById('btn-google-login');
  const errorContainer = document.getElementById('login-error');

  if (!loginBtn || !errorContainer) {
    return;
  }

  loginBtn.addEventListener('click', async () => {
    // Clear any previous error
    hideError(errorContainer);
    loginBtn.disabled = true;

    try {
      await signIn();
      // On success, auth.js handles redirect to #dashboard
    } catch (error) {
      showError(
        errorContainer,
        'É necessário autorizar o acesso à sua conta Google para utilizar o ComprovaLattes.'
      );
    } finally {
      loginBtn.disabled = false;
    }
  });
}

/**
 * Shows error message in the error container.
 * @param {HTMLElement} container
 * @param {string} message
 */
function showError(container, message) {
  container.textContent = message;
  container.classList.remove('hidden');
}

/**
 * Hides the error container.
 * @param {HTMLElement} container
 */
function hideError(container) {
  container.textContent = '';
  container.classList.add('hidden');
}
