/** Spec §4 security headers. */
import { secureHeaders } from 'hono/secure-headers';

/**
 * Spec §4 security headers, on every response including 401/404 and static files. Hono's other
 * defaults (CORP, COOP, HSTS…) stay on; X-Frame-Options is tightened to DENY to agree with frame-ancestors 'none'.
 */
export function securityHeaders() {
  return secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'self'"], frameAncestors: ["'none'"] },
    referrerPolicy: 'no-referrer',
    xContentTypeOptions: 'nosniff',
    xFrameOptions: 'DENY',
  });
}
