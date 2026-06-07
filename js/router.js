/**
 * Hash Router — SPA navigation for ComprovaLattes
 * 
 * Manages hash-based routing with authentication guards.
 * Views are loaded into the #app container without page reload.
 * 
 * Requirements: 11.1, 11.3, 11.4, 11.5, 11.6
 */

/**
 * @typedef {Object} RouteDefinition
 * @property {string} path - Hash path (e.g., 'login', 'dashboard')
 * @property {function(): Promise<string>|string} handler - View render function
 * @property {boolean} requiresAuth - Whether the route requires authentication
 */

/** @type {Map<string, RouteDefinition>} */
const routes = new Map();

/** @type {function(): boolean} */
let isAuthenticated = () => false;

/** @type {string|null} */
let currentRoute = null;

/** @type {function(string, string|null): void|null} */
let onRouteChange = null;

/**
 * Registers a route with the router.
 * @param {string} path - Hash path without '#' (e.g., 'login', 'dashboard')
 * @param {function(): Promise<string>|string} handler - Function that returns HTML content for the view
 * @param {boolean} [requiresAuth=true] - Whether this route requires authentication
 */
export function addRoute(path, handler, requiresAuth = true) {
  routes.set(path, { path, handler, requiresAuth });
}

/**
 * Sets the authentication check function.
 * This allows dependency injection for testability.
 * @param {function(): boolean} authCheckFn - Returns true if user is authenticated
 */
export function setAuthCheck(authCheckFn) {
  isAuthenticated = authCheckFn;
}

/**
 * Sets a callback invoked after every route change.
 * @param {function(string, string|null): void} callback - Receives (newRoute, previousRoute)
 */
export function setOnRouteChange(callback) {
  onRouteChange = callback;
}

/**
 * Returns the current active route path (without '#').
 * @returns {string|null}
 */
export function getCurrentRoute() {
  return currentRoute;
}

/**
 * Returns all registered route paths.
 * @returns {string[]}
 */
export function getRegisteredRoutes() {
  return Array.from(routes.keys());
}

/**
 * Navigates to a given hash route.
 * Updates the URL hash without reloading the page.
 * Applies auth guard and invalid route handling.
 * @param {string} path - Route path without '#' (e.g., 'dashboard')
 */
export function navigateTo(path) {
  const resolvedPath = resolveRoute(path);

  if (resolvedPath !== path) {
    // Update hash to the resolved path (redirect)
    window.location.hash = `#${resolvedPath}`;
    return; // hashchange event will trigger handleRouteChange
  }

  // Update hash if it doesn't match (avoids redundant hashchange)
  const currentHash = window.location.hash.slice(1);
  if (currentHash !== resolvedPath) {
    window.location.hash = `#${resolvedPath}`;
    return; // hashchange event will trigger handleRouteChange
  }

  // Render the route
  renderRoute(resolvedPath);
}

/**
 * Resolves a route path applying auth guards and fallback logic.
 * @param {string} path - The requested route path
 * @returns {string} The resolved route path
 */
function resolveRoute(path) {
  const route = routes.get(path);

  // Invalid/unknown route → redirect to dashboard (Req 11.6)
  if (!route) {
    // If not authenticated, redirect to login instead
    if (!isAuthenticated()) {
      return 'login';
    }
    return 'dashboard';
  }

  // Auth-required route without authentication → redirect to login (Req 11.5)
  if (route.requiresAuth && !isAuthenticated()) {
    return 'login';
  }

  // Authenticated user accessing login → redirect to dashboard
  if (path === 'login' && isAuthenticated()) {
    return 'dashboard';
  }

  return path;
}

/**
 * Renders the view for the given route into the app container.
 * @param {string} path - Resolved route path to render
 */
async function renderRoute(path) {
  const route = routes.get(path);
  if (!route) return;

  const previousRoute = currentRoute;
  currentRoute = path;

  const appContainer = document.getElementById('app');
  if (!appContainer) return;

  try {
    const content = await route.handler();
    if (typeof content === 'string') {
      appContainer.innerHTML = content;
    }
  } catch (error) {
    console.error(`[Router] Error rendering route "${path}":`, error);
    appContainer.innerHTML = '<p>Erro ao carregar a view.</p>';
  }

  if (onRouteChange) {
    onRouteChange(path, previousRoute);
  }
}

/**
 * Handles the hashchange event.
 * Extracts the path from the hash and navigates to it.
 */
function handleHashChange() {
  const hash = window.location.hash.slice(1) || '';
  const path = hash || 'login';
  navigateTo(path);
}

/**
 * Initializes the router.
 * Registers the default routes and starts listening for hash changes.
 * Call this after all routes have been added via addRoute().
 */
export function initRouter() {
  window.addEventListener('hashchange', handleHashChange);
  // Handle initial route on page load
  handleHashChange();
}

/**
 * Stops the router and removes event listeners.
 * Useful for cleanup in tests.
 */
export function destroyRouter() {
  window.removeEventListener('hashchange', handleHashChange);
  routes.clear();
  currentRoute = null;
  isAuthenticated = () => false;
  onRouteChange = null;
}

/**
 * Registers the standard ComprovaLattes routes with placeholder handlers.
 * This is a convenience function for bootstrapping.
 * Views will replace these handlers when they initialize.
 * @param {Object} viewHandlers - Map of route path to handler function
 */
export function registerDefaultRoutes(viewHandlers = {}) {
  const defaultRoutes = [
    { path: 'login', requiresAuth: false },
    { path: 'dashboard', requiresAuth: true },
    { path: 'entradas', requiresAuth: true },
    { path: 'importacao', requiresAuth: true },
    { path: 'revisao', requiresAuth: true },
    { path: 'ocultos', requiresAuth: true },
    { path: 'config', requiresAuth: false },
  ];

  for (const { path, requiresAuth } of defaultRoutes) {
    const handler = viewHandlers[path] || (() => `<div class="view view-${path}"><h1>${path}</h1></div>`);
    addRoute(path, handler, requiresAuth);
  }
}
