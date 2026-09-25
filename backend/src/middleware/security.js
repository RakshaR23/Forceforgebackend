// Extra security headers on top of helmet().
// helmet() is applied in server.js; this middleware adds
// explicit hardening headers in one place.

function securityMiddleware(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // Modern browsers ignore X-XSS-Protection, but setting it to 0
  // prevents legacy XSS auditors from introducing vulnerabilities.
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}

module.exports = securityMiddleware;
