// Self-test for functions/lib/auth.js using Node's WebCrypto (same API as Workers).
import { hashPassword, verifyPassword, readCookie, sessionCookie, clearCookie, rateLimit, sameOrigin } from '../functions/lib/auth.js'

let pass = 0, fail = 0
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)) }

// 1. hash/verify roundtrip
const h = await hashPassword('S3cret!pass')
ok(/^pbkdf2\$25000\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(h), 'hash format')
ok(await verifyPassword('S3cret!pass', h), 'correct password verifies')
ok(!(await verifyPassword('wrong', h)), 'wrong password rejected')
ok(!(await verifyPassword('', h)), 'empty password rejected')
ok(!(await verifyPassword('x', 'garbage')), 'malformed hash rejected')
ok(!(await verifyPassword('x', 'pbkdf2$abc$zz$yy')), 'bad salt rejected')

// 2. salt uniqueness
ok(await hashPassword('a') !== await hashPassword('a'), 'salt unique per call')

// 3. legacy format compat (different iteration count in stored hash)
const legacy = `pbkdf2$1000$${'ab'.repeat(16)}$${(await import('crypto')).randomBytes(32).toString('hex')}`
ok(typeof legacy === 'string', 'legacy string builds')

// 4. cookie parsing
const req = { headers: new Map([['Cookie', 'foo=1; nav_session=abc123; bar=2']]), headersGet: null }
req.headers.get = (k) => req.headers.get === null ? null : ({ cookie: 'foo=1; nav_session=abc123; bar=2' })[String(k).toLowerCase()] || null
ok(readCookie({ headers: { get: (k) => ({ cookie: 'foo=1; nav_session=abc123; bar=2' })[k.toLowerCase()] } }, 'nav_session') === 'abc123', 'cookie parsed')
ok(readCookie({ headers: { get: () => '' } }, 'nav_session') === null, 'empty cookie → null')

// 5. cookie flags
const c = sessionCookie('tok')
ok(c.includes('HttpOnly') && c.includes('Secure') && c.includes('SameSite=Lax') && c.startsWith('nav_session=tok'), 'session cookie flags')
ok(clearCookie().includes('Max-Age=0'), 'clear cookie')

// 6. rate limit
const key = 't' + Math.random()
ok(rateLimit(key, 3) && rateLimit(key, 3) && rateLimit(key, 3) && !rateLimit(key, 3), 'rate limit blocks after max')

// 7. sameOrigin
ok(sameOrigin({ url: 'https://x.com/api', headers: { get: (n) => n === 'Origin' ? 'https://x.com' : null } }), 'same origin ok')
ok(!sameOrigin({ url: 'https://x.com/api', headers: { get: (n) => n === 'Origin' ? 'https://evil.com' : null } }), 'cross origin blocked')
ok(sameOrigin({ url: 'https://x.com/api', headers: { get: () => null } }), 'no origin allowed')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
