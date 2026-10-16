import "server-only";

/**
 * Perseu remains available in the codebase, but its experimental operational
 * surface must be explicitly enabled by the server.  Keeping this server-only
 * avoids treating a client-side hidden navigation item as an access control.
 */
export function isPerseusOperationalEnabled() {
  return process.env.RN_PERSEUS_ENABLED === "true";
}

export const perseusUnavailableMessage =
  "O Perseu está temporariamente indisponível durante a preparação do RN Integra.";
