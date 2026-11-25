import { scoreSeoPage } from './seo-extras.service';

describe('scoreSeoPage', () => {
  it('scores an empty page low but still indexable', () => {
    const { score, checks } = scoreSeoPage({});
    expect(checks.find((c) => c.label === 'Indexable')?.pass).toBe(true);
    expect(score).toBeLessThan(20);
  });

  it('scores a fully configured page 100', () => {
    const { score } = scoreSeoPage({
      title: 'Book trusted home services in Casablanca',
      description: 'Latache connects you with vetted local Taskers for cleaning, repairs and moving. Compare prices, read reviews and book in minutes with secure payment.',
      canonicalUrl: 'https://example.com/en',
      ogImageUrl: 'https://example.com/og.png',
      structuredData: { '@type': 'Organization' },
      keywords: ['home services'],
      robotsIndex: true,
    });
    expect(score).toBe(100);
  });

  it('fails the indexable check for noindex pages', () => {
    const { checks } = scoreSeoPage({ robotsIndex: false });
    expect(checks.find((c) => c.label === 'Indexable')?.pass).toBe(false);
  });
});
