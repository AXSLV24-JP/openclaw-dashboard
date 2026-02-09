const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Import helpers from server (the module starts the HTTP server as a side
// effect, so we suppress the listen by setting PORT to 0 before requiring).
process.env.PORT = '0';
const {
  isValidUrl,
  isValidHostname,
  getCached,
  setCache,
  checkAuth,
  isRateLimited,
  config,
} = require('../server');

// ---------------------------------------------------------------------------
// isValidUrl
// ---------------------------------------------------------------------------

describe('isValidUrl', () => {
  it('accepts http URLs', () => {
    assert.equal(isValidUrl('http://localhost:3000'), true);
  });

  it('accepts https URLs', () => {
    assert.equal(isValidUrl('https://example.com/path'), true);
  });

  it('rejects ftp URLs', () => {
    assert.equal(isValidUrl('ftp://example.com'), false);
  });

  it('rejects garbage strings', () => {
    assert.equal(isValidUrl('not-a-url'), false);
  });

  it('rejects empty string', () => {
    assert.equal(isValidUrl(''), false);
  });

  it('rejects javascript: protocol', () => {
    assert.equal(isValidUrl('javascript:alert(1)'), false);
  });
});

// ---------------------------------------------------------------------------
// isValidHostname
// ---------------------------------------------------------------------------

describe('isValidHostname', () => {
  it('accepts simple hostnames', () => {
    assert.equal(isValidHostname('server1'), true);
  });

  it('accepts IP addresses', () => {
    assert.equal(isValidHostname('192.168.1.1'), true);
  });

  it('accepts FQDN', () => {
    assert.equal(isValidHostname('host.example.com'), true);
  });

  it('rejects shell metacharacters', () => {
    assert.equal(isValidHostname('; rm -rf /'), false);
  });

  it('rejects empty string', () => {
    assert.equal(isValidHostname(''), false);
  });

  it('rejects strings starting with dot', () => {
    assert.equal(isValidHostname('.hidden'), false);
  });

  it('rejects strings starting with dash', () => {
    assert.equal(isValidHostname('-flag'), false);
  });
});

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

describe('cache', () => {
  beforeEach(() => {
    // Reset cache state between tests
    setCache('__test__', null);
  });

  it('returns null for uncached keys', () => {
    assert.equal(getCached('nonexistent-key'), null);
  });

  it('stores and retrieves values', () => {
    setCache('mykey', { foo: 'bar' });
    const result = getCached('mykey');
    assert.deepEqual(result, { foo: 'bar' });
  });
});

// ---------------------------------------------------------------------------
// checkAuth
// ---------------------------------------------------------------------------

describe('checkAuth', () => {
  const originalToken = config.auth?.token;

  it('allows requests when no token configured', () => {
    config.auth.token = null;
    const req = { headers: {} };
    assert.equal(checkAuth(req), true);
  });

  it('rejects requests without Authorization header when token set', () => {
    config.auth.token = 'secret123';
    const req = { headers: {} };
    assert.equal(checkAuth(req), false);
  });

  it('rejects requests with wrong token', () => {
    config.auth.token = 'secret123';
    const req = { headers: { authorization: 'Bearer wrong' } };
    assert.equal(checkAuth(req), false);
  });

  it('accepts requests with correct token', () => {
    config.auth.token = 'secret123';
    const req = { headers: { authorization: 'Bearer secret123' } };
    assert.equal(checkAuth(req), true);
  });

  it('rejects non-Bearer schemes', () => {
    config.auth.token = 'secret123';
    const req = { headers: { authorization: 'Basic secret123' } };
    assert.equal(checkAuth(req), false);
  });

  // Restore original
  it('cleanup', () => {
    config.auth.token = originalToken;
    assert.ok(true);
  });
});

// ---------------------------------------------------------------------------
// isRateLimited
// ---------------------------------------------------------------------------

describe('isRateLimited', () => {
  it('allows first request', () => {
    assert.equal(isRateLimited('10.0.0.99'), false);
  });

  it('allows requests under the limit', () => {
    const ip = '10.0.0.100';
    for (let i = 0; i < 59; i++) {
      isRateLimited(ip);
    }
    assert.equal(isRateLimited(ip), false);
  });
});
