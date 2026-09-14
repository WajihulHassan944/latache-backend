const HEADER_IMAGE_URL =
  'https://res.cloudinary.com/daflot6fo/image/upload/v1786533881/latache-email-header_hcqhvb.png';
const FOOTER_IMAGE_URL =
  'https://res.cloudinary.com/daflot6fo/image/upload/v1786533881/latache-email-footer_abofsj.png';
const LOGO_URL = 'https://latache-web.vercel.app/images/logo-full.svg';

export const formatUptime = (totalSeconds: number): string => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
};

export const buildLandingPageHtml = (uptimeLabel: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<title>Latâche API</title>
<meta name="robots" content="noindex" />
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    min-height: 100%;
    background: #f4efe6;
  }
  body {
    font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif;
    color: #54220f;
    padding: clamp(16px, 4vw, 40px) 12px;
    display: flex;
    justify-content: center;
  }
  .frame {
    width: 100%;
    max-width: 720px;
    background: #fffdf8;
    border-radius: 20px;
    overflow: hidden;
    box-shadow: 0 12px 34px rgba(74, 35, 16, 0.16);
  }
  .banner {
    position: relative;
    width: 100%;
    aspect-ratio: 720 / 300;
    background: #6a2a13 url('${HEADER_IMAGE_URL}') center / cover no-repeat;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .banner img {
    width: clamp(120px, 30vw, 210px);
    height: auto;
    display: block;
  }
  .badge {
    margin: -30px auto 0;
    position: relative;
    z-index: 2;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: #fffdf8;
    border: 3px solid #e7c98f;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 8px 18px rgba(74, 35, 16, 0.18);
  }
  .badge span {
    color: #17642a;
    font-size: 26px;
    font-weight: 700;
    line-height: 1;
  }
  .content {
    padding: 18px 40px 8px;
    text-align: center;
  }
  h1 {
    margin: 18px 0 12px;
    font-size: clamp(24px, 5vw, 32px);
    font-weight: 800;
    letter-spacing: -0.01em;
    color: #3f1a0b;
  }
  p.lead {
    margin: 0 auto;
    max-width: 480px;
    color: #8a6a52;
    font-size: 15px;
    line-height: 1.65;
  }
  .stats {
    margin: 26px 0 18px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .stat {
    background: #f9f2e6;
    border: 1px solid #ecdcc0;
    border-radius: 14px;
    padding: 14px 10px;
  }
  .stat-label {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #a4835e;
    margin-bottom: 6px;
  }
  .stat-value {
    font-size: 14.5px;
    font-weight: 700;
    color: #54220f;
  }
  .links {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
    margin-bottom: 22px;
  }
  .link-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 16px 18px;
    border-radius: 14px;
    background: #fffaf1;
    border: 1px solid #ecdcc0;
    text-decoration: none;
    color: #54220f;
    text-align: left;
    transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
  }
  .link-card:hover {
    border-color: #d9a24a;
    background: #fdf3e0;
    transform: translateY(-1px);
  }
  .link-title {
    font-size: 14.5px;
    font-weight: 700;
  }
  .link-desc {
    font-size: 12px;
    color: #a4835e;
    margin-top: 2px;
  }
  .arrow {
    color: #d9a24a;
    font-size: 18px;
    flex-shrink: 0;
  }
  .status-box {
    margin: 0 40px 22px;
    display: flex;
    align-items: center;
    gap: 16px;
    border: 1px solid #b9dcc1;
    border-radius: 20px;
    background: #e8f6eb;
    padding: 16px 20px;
    text-align: left;
  }
  .status-box .check {
    flex-shrink: 0;
    width: 34px;
    color: #17642a;
    font-size: 30px;
    text-align: center;
  }
  .status-box .text {
    color: #145a25;
    font-size: 14.5px;
    line-height: 1.5;
  }
  .status-box .text strong {
    font-size: 15.5px;
    display: block;
  }
  .footer {
    background: #6a2a13 url('${FOOTER_IMAGE_URL}') center bottom / cover no-repeat;
    padding: clamp(60px, 20vw, 150px) 24px 24px;
    text-align: center;
  }
  .socials a {
    display: inline-block;
    width: 32px;
    height: 32px;
    margin: 0 4px;
    border-radius: 50%;
    background: #6a2a13;
    color: #fff;
    font-size: 14px;
    font-weight: bold;
    line-height: 32px;
    text-decoration: none;
  }
  .copyright {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid rgba(106, 42, 19, 0.35);
    color: #6a2a13;
    font-size: 12px;
    line-height: 20px;
    text-shadow: 0 1px 0 rgba(255, 244, 221, 0.45);
  }
  .copyright em { font-style: normal; }
</style>
</head>
<body>
  <div class="frame">
    <div class="banner">
      <img src="${LOGO_URL}" alt="Latâche" />
    </div>
    <div class="badge"><span>&#10003;</span></div>

    <div class="content">
      <h1>You've reached the Latâche API</h1>
      <p class="lead">
        This is the production API powering the Latâche services marketplace &mdash;
        bookings, payments, messaging, and everything else connecting customers with
        trusted local taskers. There's no interface here to browse; head to the
        documentation below to explore the endpoints.
      </p>

      <div class="stats">
        <div class="stat">
          <div class="stat-label">Version</div>
          <div class="stat-value">1.0</div>
        </div>
        <div class="stat">
          <div class="stat-label">Environment</div>
          <div class="stat-value">Production</div>
        </div>
        <div class="stat">
          <div class="stat-label">Uptime</div>
          <div class="stat-value">${uptimeLabel}</div>
        </div>
      </div>

      <div class="links">
        <a class="link-card" href="/api/docs">
          <div>
            <div class="link-title">API Documentation</div>
            <div class="link-desc">Interactive Swagger reference</div>
          </div>
          <span class="arrow">&rarr;</span>
        </a>
        <a class="link-card" href="/api/health">
          <div>
            <div class="link-title">Health Status</div>
            <div class="link-desc">Database, cache &amp; queue checks</div>
          </div>
          <span class="arrow">&rarr;</span>
        </a>
      </div>
    </div>

    <div class="status-box">
      <div class="check">&#10003;</div>
      <div class="text">
        <strong>All systems operational.</strong>
        Every service is healthy and responding normally.
      </div>
    </div>

    <div class="footer">
      <div class="socials">
        <a href="https://www.facebook.com/latache" aria-label="Facebook">f</a>
        <a href="https://x.com/latache" aria-label="X">X</a>
        <a href="https://www.instagram.com/latache" aria-label="Instagram">&#9678;</a>
        <a href="https://www.linkedin.com/company/latache" aria-label="LinkedIn">in</a>
      </div>
      <div class="copyright">
        &copy; ${new Date().getFullYear()} Lat&acirc;che. All rights reserved.<br />
        <em>Connecting you with trusted professionals.</em>
      </div>
    </div>
  </div>
</body>
</html>
`;
