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
<title>Latâche API</title>
<meta name="robots" content="noindex" />
<style>
  :root {
    color-scheme: dark;
    --bg-0: #05060a;
    --bg-1: #0b0e17;
    --card: rgba(255, 255, 255, 0.04);
    --card-border: rgba(255, 255, 255, 0.09);
    --text-0: #f5f6fa;
    --text-1: #a6adc2;
    --text-2: #6b7285;
    --accent: #7c5cff;
    --accent-2: #35d1a8;
    --ok: #35d1a8;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    min-height: 100%;
    background: var(--bg-0);
  }
  body {
    font-family: 'Inter', 'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    color: var(--text-0);
    padding: clamp(24px, 6vw, 64px) 16px;
    display: flex;
    justify-content: center;
    position: relative;
    overflow-x: hidden;
    background:
      radial-gradient(1100px 620px at 12% -10%, rgba(124, 92, 255, 0.24), transparent 60%),
      radial-gradient(900px 560px at 110% 10%, rgba(53, 209, 168, 0.14), transparent 55%),
      var(--bg-0);
  }
  .glow {
    position: fixed;
    inset: 0;
    background-image:
      linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px);
    background-size: 42px 42px;
    mask-image: radial-gradient(700px 500px at 50% 0%, black, transparent 75%);
    pointer-events: none;
    z-index: 0;
  }
  .wrap {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 760px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 28px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .mark {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 19px;
    color: #0a0b10;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    box-shadow: 0 8px 24px rgba(124, 92, 255, 0.35);
    flex-shrink: 0;
  }
  .brand-name {
    font-size: 22px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px 6px 10px;
    border-radius: 999px;
    background: rgba(53, 209, 168, 0.1);
    border: 1px solid rgba(53, 209, 168, 0.28);
    color: var(--ok);
    font-size: 13px;
    font-weight: 550;
  }
  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
    box-shadow: 0 0 0 3px rgba(53, 209, 168, 0.18);
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }
  h1 {
    margin: 0;
    font-size: clamp(30px, 5vw, 44px);
    font-weight: 650;
    letter-spacing: -0.03em;
    line-height: 1.15;
    background: linear-gradient(180deg, #ffffff, #c7cbe0);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  p.lead {
    margin: 0;
    max-width: 520px;
    color: var(--text-1);
    font-size: 16px;
    line-height: 1.6;
  }
  .card {
    width: 100%;
    text-align: left;
    background: var(--card);
    border: 1px solid var(--card-border);
    border-radius: 18px;
    padding: 22px;
    backdrop-filter: blur(10px);
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 18px;
  }
  .stat-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-2);
    margin-bottom: 6px;
  }
  .stat-value {
    font-size: 15px;
    font-weight: 550;
    color: var(--text-0);
    font-variant-numeric: tabular-nums;
  }
  .stat-value code {
    font-family: 'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace;
    background: rgba(255, 255, 255, 0.06);
    padding: 2px 6px;
    border-radius: 6px;
    font-size: 13px;
  }
  .links {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px;
  }
  .link-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 22px;
    border-radius: 14px;
    background: var(--card);
    border: 1px solid var(--card-border);
    text-decoration: none;
    color: var(--text-0);
    transition: border-color 0.15s ease, transform 0.15s ease, background 0.15s ease;
  }
  .link-card:hover {
    border-color: rgba(124, 92, 255, 0.5);
    background: rgba(124, 92, 255, 0.08);
    transform: translateY(-1px);
  }
  .link-title {
    font-size: 14.5px;
    font-weight: 600;
  }
  .link-desc {
    font-size: 12.5px;
    color: var(--text-2);
    margin-top: 2px;
  }
  .arrow {
    color: var(--text-2);
    font-size: 18px;
    flex-shrink: 0;
    transition: transform 0.15s ease, color 0.15s ease;
  }
  .link-card:hover .arrow {
    transform: translateX(3px);
    color: var(--accent-2);
  }
  footer {
    color: var(--text-2);
    font-size: 12.5px;
    padding-top: 8px;
  }
</style>
</head>
<body>
  <div class="glow"></div>
  <main class="wrap">
    <div class="brand">
      <div class="mark">L</div>
      <span class="brand-name">Latâche</span>
    </div>

    <div class="status-pill"><span class="status-dot"></span>All systems operational</div>

    <h1>You've reached the Latâche API</h1>
    <p class="lead">
      This is the production API powering the Latâche services marketplace &mdash;
      bookings, payments, messaging, and everything else connecting customers with
      trusted local taskers. There's no interface here to browse; head to the
      documentation below to explore the endpoints.
    </p>

    <div class="card">
      <div>
        <div class="stat-label">Version</div>
        <div class="stat-value"><code>v1.0</code></div>
      </div>
      <div>
        <div class="stat-label">Environment</div>
        <div class="stat-value">Production</div>
      </div>
      <div>
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
          <div class="link-desc">Database, cache & queue checks</div>
        </div>
        <span class="arrow">&rarr;</span>
      </a>
    </div>

    <footer>&copy; ${new Date().getFullYear()} Latâche. All rights reserved.</footer>
  </main>
</body>
</html>
`;
