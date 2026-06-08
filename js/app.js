/**
 * App Bootstrap — ComprovaLattes Entry Point
 * 
 * ES module entry point loaded by index.html.
 * Responsibilities:
 * - Verify CDN library availability (warn if missing)
 * - Load application configuration
 * - Initialize router with auth guard
 * - Render persistent navigation bar on authenticated views
 * - Handle initial route based on authentication state
 * 
 * Requirements: 11.2, 11.7, 11.8, 12.7
 * @module app
 */

import { isAuthenticated, signOut, getUserName, getUserPhoto, onUserInfoReady, initAuth } from './auth.js';
import { loadConfig } from './config.js';
import { initDriveFolders } from './core/drive-init.js';
import {
  initRouter,
  setAuthCheck,
  registerDefaultRoutes,
  setOnRouteChange
} from './router.js';
import { render as renderLogin, mount as mountLogin } from './views/login.js';
import { render as renderDashboard, mount as mountDashboard } from './views/dashboard.js';
import { render as renderEntries, mount as mountEntries } from './views/entries.js';
import { render as renderImport, mount as mountImport } from './views/import.js';
import { render as renderReview, mount as mountReview, show as showReview } from './views/review.js';
import { render as renderHidden, mount as mountHidden } from './views/hidden.js';
import { render as renderSettings, mount as mountSettings } from './views/settings.js';

/**
 * CDN libraries expected to be available on `window`.
 * Each entry maps a global name to a human-readable label.
 * @type {Array<{global: string, label: string}>}
 */
const CDN_LIBRARIES = [
  { global: 'pdfjsLib', label: 'PDF.js' },
  { global: 'Tesseract', label: 'Tesseract.js' },
  { global: 'fuzzball', label: 'fuzzball.js' },
  { global: 'JSZip', label: 'JSZip' }
];

/**
 * Navigation links configuration.
 * @type {Array<{path: string, label: string}>}
 */
const NAV_LINKS = [
  { path: 'dashboard', label: 'Dashboard' },
  { path: 'entradas', label: 'Entradas' },
  { path: 'importacao', label: 'Importação' },
  { path: 'revisao', label: 'Revisão' },
  { path: 'ocultos', label: 'Ocultos' },
  { path: 'config', label: 'Configurações' }
];

/**
 * Verifies that CDN libraries are loaded on window.
 * Logs warnings for any missing libraries but does not block app startup.
 * @returns {{available: string[], missing: string[]}}
 */
function verifyCDNLibraries() {
  const available = [];
  const missing = [];

  for (const { global, label } of CDN_LIBRARIES) {
    if (typeof window[global] !== 'undefined') {
      available.push(label);
    } else {
      missing.push(label);
      console.warn(`[App] Biblioteca CDN não encontrada: ${label} (window.${global})`);
    }
  }

  if (missing.length === 0) {
    console.log('[App] Todas as bibliotecas CDN carregadas com sucesso');
  } else {
    console.warn(`[App] ${missing.length} biblioteca(s) CDN ausente(s): ${missing.join(', ')}`);
    console.warn('[App] Funcionalidades dependentes podem não estar disponíveis');
  }

  return { available, missing };
}

/**
 * Renders the persistent navigation bar HTML.
 * @param {string} activeRoute - Currently active route path
 * @returns {string} HTML string for the nav bar
 */
function renderNavBar(activeRoute) {
  const userName = getUserName();
  const userPhoto = getUserPhoto();

  const linksHtml = NAV_LINKS.map(({ path, label }) => {
    const activeClass = path === activeRoute ? ' nav__link--active' : '';
    return `<li><a href="#${path}" class="nav__link${activeClass}">${label}</a></li>`;
  }).join('\n        ');

  const photoHtml = userPhoto
    ? `<img src="${userPhoto}" alt="" class="nav__avatar" referrerpolicy="no-referrer" />`
    : '';
  const nameHtml = userName ? escapeHtml(userName) : '';

  return `
    <nav class="nav" aria-label="Navegação principal">
      <span class="nav__brand">ComprovaLattes</span>
      <ul class="nav__links">
        ${linksHtml}
      </ul>
      <div class="nav__user">
        ${photoHtml}
        ${nameHtml ? `<span class="nav__username">${nameHtml}</span>` : ''}
        <button class="btn btn--outline btn--sm" id="btn-signout" type="button">Sair</button>
      </div>
    </nav>
  `;
}

/**
 * Shows/hides the navigation bar based on the current route.
 * Nav bar is hidden on the login view and shown on all authenticated views.
 * @param {string} route - Current route path
 */
function updateNavBar(route) {
  const navContainer = document.getElementById('nav-container');
  if (!navContainer) return;

  if (route === 'login' || !isAuthenticated()) {
    navContainer.innerHTML = '';
    return;
  }

  navContainer.innerHTML = renderNavBar(route);

  // Attach sign-out handler
  const btnSignout = document.getElementById('btn-signout');
  if (btnSignout) {
    btnSignout.addEventListener('click', () => {
      signOut();
    });
  }
}

/**
 * Updates the active link highlighting in the navigation bar.
 * @param {string} route - The new active route
 */
function updateActiveLink(route) {
  const navContainer = document.getElementById('nav-container');
  if (!navContainer) return;

  const links = navContainer.querySelectorAll('.nav__link');
  links.forEach(link => {
    const href = link.getAttribute('href');
    const linkRoute = href ? href.replace('#', '') : '';
    if (linkRoute === route) {
      link.classList.add('nav__link--active');
    } else {
      link.classList.remove('nav__link--active');
    }
  });
}

/**
 * Handles route change events for lifecycle management.
 * Updates nav bar visibility/active state and calls mount() on views.
 * @param {string} newRoute - The new active route
 * @param {string|null} previousRoute - The previous route (null on first load)
 */
function handleRouteChange(newRoute, previousRoute) {
  console.log(`[App] Navegação: ${previousRoute || '(início)'} → ${newRoute}`);

  // Update navigation bar
  if (newRoute === 'login' || previousRoute === 'login' || !previousRoute) {
    // Full re-render of nav (show/hide transition or first load)
    updateNavBar(newRoute);
  } else {
    // Just update the active link
    updateActiveLink(newRoute);
  }

  // Call mount() for views that need post-render event binding
  switch (newRoute) {
    case 'login':
      mountLogin();
      break;
    case 'dashboard':
      mountDashboard();
      break;
    case 'entradas':
      mountEntries();
      break;
    case 'importacao':
      mountImport();
      break;
    case 'revisao':
      mountReview();
      break;
    case 'ocultos':
      mountHidden();
      break;
    case 'config':
      mountSettings();
      break;
  }
}

/**
 * Escapes HTML special characters to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Initializes the application.
 * Called on DOMContentLoaded or immediately if DOM is already ready.
 */
function initApp() {
  console.log('[App] Inicializando ComprovaLattes...');

  // 1. Verify CDN libraries availability (Req 12.7)
  verifyCDNLibraries();

  // 2. Load application configuration
  const config = loadConfig();
  console.log('[App] Configuração carregada:', {
    threshold: config.threshold,
    hasSpreadsheet: !!config.spreadsheet_id,
    hasRootFolder: !!config.root_folder_id
  });

  // 3. Configure router auth guard
  setAuthCheck(isAuthenticated);

  // 3b. Initialize Google Auth if client_id is configured
  if (config.client_id) {
    initAuth({ clientId: config.client_id });
  } else {
    console.warn('[App] Client ID não configurado. Acesse #config para configurar.');
  }

  // 4. Register lifecycle callback
  setOnRouteChange(handleRouteChange);

  // 5. Register all routes with view handlers
  registerDefaultRoutes({
    login: renderLogin,
    dashboard: renderDashboard,
    entradas: renderEntries,
    importacao: renderImport,
    revisao: renderReview,
    ocultos: renderHidden,
    config: renderSettings
  });

  // 6. Initialize router — handles initial navigation (Req 11.7)
  // If authenticated → defaults to #dashboard
  // If not authenticated → redirects to #login
  initRouter();

  // 6b. If no client_id configured, force redirect to #config for setup
  if (!config.client_id) {
    window.location.hash = '#config';
  }

  // 6c. Re-render nav when user info arrives (name + photo from Google)
  onUserInfoReady(() => {
    const currentHash = window.location.hash.slice(1) || 'dashboard';
    if (currentHash !== 'login') {
      updateNavBar(currentHash);
    }
  });

  // 7. Initialize Drive folder structure if authenticated (Req 14.1)
  // Non-blocking: failures are logged but don't break the app
  if (isAuthenticated()) {
    initDriveFolders().catch(err => {
      console.warn('[App] Inicialização de pastas do Drive falhou:', err.message);
    });
  }

  console.log('[App] ComprovaLattes inicializado com sucesso');
}

// Start app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Export for testing
export { verifyCDNLibraries, initApp, renderNavBar, updateNavBar };
