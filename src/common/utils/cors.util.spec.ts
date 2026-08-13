import { buildAllowedOrigins, normalizeHttpOrigin } from './cors.util';

describe('CORS origin utilities', () => {
  it('normalizes valid HTTP origins and rejects non-HTTP values', () => {
    expect(normalizeHttpOrigin('https://api.latache.com/path/')).toBe('https://api.latache.com');
    expect(normalizeHttpOrigin('http://localhost:8080/')).toBe('http://localhost:8080');
    expect(normalizeHttpOrigin('mailto:admin@latache.com')).toBeUndefined();
    expect(normalizeHttpOrigin('not a URL')).toBeUndefined();
  });

  it('includes the API origin used by same-origin Swagger requests', () => {
    const origins = buildAllowedOrigins(
      ['https://latache-web.vercel.app/', 'http://localhost:3000'],
      'http://localhost:8080/api',
    );

    expect([...origins]).toEqual([
      'https://latache-web.vercel.app',
      'http://localhost:3000',
      'http://localhost:8080',
    ]);
  });
});
