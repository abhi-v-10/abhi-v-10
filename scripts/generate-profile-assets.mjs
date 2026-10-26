// Generates assets/contributions.svg, assets/contributions-snake.svg and assets/stats.svg from real, public GitHub data.
//
//   node scripts/generate-profile-assets.mjs
//
// Data sources (no secrets are written to any output file):
//   - https://github.com/users/<user>/contributions   public contribution calendar (same data as the profile page)
//   - https://api.github.com/users/<user> and /repos   public profile + repository metadata
// GITHUB_TOKEN is optional. In GitHub Actions it only raises the REST API rate limit.
//
// If a source cannot be reached, the script exits with an error and leaves the existing SVG untouched,
// so a flaky run never replaces good data with a broken or invented image.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USER = "abhi-v-10";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets");

const C = {
  bg0: "#090A1C",
  bg1: "#11132B",
  deep: "#272A6B",
  royal: "#4B45C6",
  electric: "#7C6CF0",
  bright: "#A99BFF",
  glow: "#C4B8FF",
  ice: "#E4E2FF",
  white: "#F3F2FB",
  muted: "#9AA0C8",
};
const LEVELS = ["#1A1D3F", "#2B2F78", C.royal, C.electric, "#B8ADFF"];
const SANS = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', monospace";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function get(url, json = false) {
  const headers = { "User-Agent": "profile-readme-assets", Accept: json ? "application/vnd.github+json" : "text/html" };
  if (json && process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return json ? res.json() : res.text();
}

// ---------- contribution calendar ----------
function parseCalendar(html) {
  const tooltips = new Map();
  for (const m of html.matchAll(/<tool-tip[^>]*\sfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    const t = m[2].trim();
    const n = /^(\d[\d,]*) contribution/.exec(t);
    tooltips.set(m[1], n ? Number(n[1].replace(/,/g, "")) : 0);
  }
  const days = [];
  for (const m of html.matchAll(/<td\b[^>]*ContributionCalendar-day[^>]*>/g)) {
    const tag = m[0];
    const date = /data-date="([^"]+)"/.exec(tag)?.[1];
    const level = /data-level="(\d)"/.exec(tag)?.[1];
    const id = /\sid="([^"]+)"/.exec(tag)?.[1];
    if (!date || level === undefined) continue;
    days.push({ date, level: Number(level), count: tooltips.get(id) ?? 0 });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  const total = /(\d[\d,]*)\s+contributions\s+in the last year/.exec(html.replace(/\s+/g, " "));
  if (days.length < 300 || !total) throw new Error("contribution calendar could not be parsed");
  return { days, total: Number(total[1].replace(/,/g, "")) };
}

function heatmapSvg({ days, total }, updated, snake = false) {
  const cell = 12, gap = 3, pitch = cell + gap;
  const padL = 46, padT = 74;
  const first = new Date(days[0].date + "T00:00:00Z");
  const startSunday = new Date(first);
  startSunday.setUTCDate(first.getUTCDate() - first.getUTCDay());
  const weeks = Math.floor((new Date(days.at(-1).date + "T00:00:00Z") - startSunday) / 864e5 / 7) + 1;
  const W = padL + weeks * pitch + 22;
  const H = padT + 7 * pitch + 58;

  // Place every day on the grid.
  const grid = days.map((d) => {
    const dt = new Date(d.date + "T00:00:00Z");
    const col = Math.floor((dt - startSunday) / 864e5 / 7);
    const row = dt.getUTCDay();
    return { ...d, dt, col, row, x: padL + col * pitch, y: padT + row * pitch };
  });

  // Snake route: column by column, down then up, through every existing cell.
  const route = [];
  for (let c = 0; c < weeks; c++) {
    const col = grid.filter((g) => g.col === c).sort((a, b) => a.row - b.row);
    if (c % 2) col.reverse();
    route.push(...col);
  }
  const centre = (g) => [g.x + cell / 2, g.y + cell / 2];
  const dist = new Map();
  let len = 0;
  route.forEach((g, i) => {
    if (i) {
      const [x1, y1] = centre(route[i - 1]), [x2, y2] = centre(g);
      len += Math.hypot(x2 - x1, y2 - y1);
    }
    dist.set(g.date, len);
  });
  const SPEED = 230;                      // px per second
  const BODY = 9;                         // snake segments
  const lag = (pitch * 0.9) / SPEED;      // seconds between segments
  const travel = len / SPEED;
  const CYCLE = travel + BODY * lag + 3;  // 3s pause before it loops
  const f = (s) => +(s / CYCLE).toFixed(5);

  const active = days.filter((d) => d.count > 0).length;
  let streak = 0, run = 0;
  for (const d of days) { run = d.count > 0 ? run + 1 : 0; streak = Math.max(streak, run); }
  const busiest = days.reduce((m, d) => (d.count > m.count ? d : m), days[0]);
  const busyLabel = new Date(busiest.date + "T00:00:00Z").toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  let cells = "";
  let glowCells = "";
  let lastMonth = -1;
  const monthLabels = [];
  for (const g of grid) {
    const label = `${g.count} contribution${g.count === 1 ? "" : "s"} on ${g.date}`;
    const eat = snake && g.level > 0 ? `<animate attributeName="fill" calcMode="discrete" values="${LEVELS[g.level]};${LEVELS[0]}" keyTimes="0;${f(dist.get(g.date) / SPEED)}" dur="${CYCLE.toFixed(2)}s" repeatCount="indefinite"/>` : "";
    cells += `<rect class="avc-c" style="animation-delay:${(g.col * 0.02).toFixed(2)}s" x="${g.x}" y="${g.y}" width="${cell}" height="${cell}" rx="3" fill="${LEVELS[g.level]}"><title>${esc(label)}</title>${eat}</rect>`;
    if (g.level >= 3) {
      const fade = snake ? `<animate attributeName="opacity" calcMode="discrete" values="1;0" keyTimes="0;${f(dist.get(g.date) / SPEED)}" dur="${CYCLE.toFixed(2)}s" repeatCount="indefinite"/>` : "";
      glowCells += `<rect x="${g.x}" y="${g.y}" width="${cell}" height="${cell}" rx="3" fill="${LEVELS[g.level]}">${fade}</rect>`;
    }
    if (g.row === 0 && g.dt.getUTCMonth() !== lastMonth) {
      lastMonth = g.dt.getUTCMonth();
      monthLabels.push({ x: g.x, col: g.col, name: g.dt.toLocaleString("en-US", { month: "short", timeZone: "UTC" }) });
    }
  }
  // Drop a label that would collide with the next one (a partial first month).
  const months = monthLabels
    .filter((m, i) => i === monthLabels.length - 1 || monthLabels[i + 1].col - m.col >= 3)
    .map((m) => `<text x="${m.x}" y="${padT - 10}">${m.name}</text>`)
    .join("");
  const dayLabels = [1, 3, 5].map((r, i) => `<text x="${padL - 10}" y="${padT + r * pitch + 10}" text-anchor="end">${["Mon", "Wed", "Fri"][i]}</text>`).join("");
  const legendX = W - 22 - 5 * pitch - 70;
  const legend = LEVELS.map((c, i) => `<rect x="${legendX + 34 + i * pitch}" y="${H - 34}" width="${cell}" height="${cell}" rx="3" fill="${c}"/>`).join("");

  let snakeSvg = "";
  if (snake) {
    const d = route.map((g, i) => `${i ? "L" : "M"}${centre(g).map((n) => n.toFixed(1)).join(" ")}`).join(" ");
    const segs = [];
    for (let i = BODY - 1; i >= 0; i--) {
      const t0 = i * lag, t1 = t0 + travel;
      const head = i === 0;
      const size = head ? cell + 2 : cell - Math.min(i, 4) * 0.6;
      const op = head ? 1 : Math.max(0.3, 0.95 - i * 0.08);
      segs.push(`<g opacity="${op}">
      ${head ? `<rect x="${-size / 2 - 3}" y="${-size / 2 - 3}" width="${size + 6}" height="${size + 6}" rx="7" fill="${C.glow}" filter="url(#avc-glow)" opacity=".9"/>` : ""}
      <rect x="${-size / 2}" y="${-size / 2}" width="${size}" height="${size}" rx="${head ? 4.5 : 3.5}" fill="${head ? "url(#avc-head)" : "url(#avc-body)"}"${head ? ` stroke="${C.white}" stroke-width="1"` : ""}/>
      ${head ? `<circle cx="2.5" cy="-2" r="1.2" fill="${C.bg0}"/><circle cx="2.5" cy="2.4" r="1.2" fill="${C.bg0}"/>` : ""}
      <animateMotion dur="${CYCLE.toFixed(2)}s" repeatCount="indefinite" calcMode="linear" keyPoints="0;0;1;1" keyTimes="0;${f(t0)};${f(t1)};1"><mpath href="#avc-route" xlink:href="#avc-route"/></animateMotion>
      <animate attributeName="opacity" values="1;1;0" keyTimes="0;${f(travel + BODY * lag + 1)};${f(travel + BODY * lag + 1.8)}" dur="${CYCLE.toFixed(2)}s" repeatCount="indefinite"/>
    </g>`);
    }
    snakeSvg = `<path id="avc-route" d="${d}" fill="none" stroke="none"/>\n  ${segs.join("\n  ")}`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="avc-t avc-d">
  <title id="avc-t">GitHub contribution heatmap for ${USER}${snake ? ", with an animated snake" : ""}</title>
  <desc id="avc-d">${total} contributions in the last year, generated from public GitHub data on ${updated}.</desc>
  <defs>
    <linearGradient id="avc-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.bg1}"/><stop offset="1" stop-color="${C.bg0}"/>
    </linearGradient>
    <linearGradient id="avc-line" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.royal}" stop-opacity="0"/><stop offset=".5" stop-color="${C.bright}"/><stop offset="1" stop-color="${C.glow}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="avc-head" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.white}"/><stop offset="1" stop-color="${C.glow}"/>
    </linearGradient>
    <linearGradient id="avc-body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.bright}"/><stop offset="1" stop-color="${C.electric}"/>
    </linearGradient>
    <style>
      .avc-c { transform-box: fill-box; transform-origin: center; animation: avc-in .7s cubic-bezier(.34,1.56,.64,1) both; }
      @keyframes avc-in { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: none; } }
      @media (prefers-reduced-motion: reduce) { .avc-c { animation: none; } }
    </style>
    <filter id="avc-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3.5"/></filter>
  </defs>
  <rect width="${W}" height="${H}" rx="14" fill="url(#avc-bg)" stroke="${C.electric}" stroke-opacity=".6"/>
  <text x="${padL}" y="36" font-family="${SANS}" font-size="15" font-weight="600" fill="${C.white}">${total} contributions in the last year</text>
  <text x="${W - 22}" y="36" text-anchor="end" font-family="${MONO}" font-size="11" fill="${C.bright}">live data · updated ${updated}</text>
  <rect x="${padL}" y="46" width="${W - padL - 22}" height="1.5" fill="url(#avc-line)"/>
  <g font-family="${SANS}" font-size="10" fill="${C.bright}">${months}${dayLabels}</g>
  <g filter="url(#avc-glow)" opacity=".85">${glowCells}</g>
  ${cells}
  ${snakeSvg}
  <g font-family="${SANS}" font-size="10" fill="${C.bright}">
    <text x="${padL}" y="${H - 24}" font-family="${MONO}">${active} active days · longest streak ${streak} day${streak === 1 ? "" : "s"} · busiest day ${busiest.count} on ${busyLabel}</text>
    <text x="${legendX + 28}" y="${H - 24}" text-anchor="end">Less</text>
    <text x="${legendX + 34 + 5 * pitch + 3}" y="${H - 24}">More</text>
  </g>
  ${legend}
</svg>
`;
}

// ---------- stats card ----------
function statsSvg({ profile, repos, total }, updated) {
  const own = repos.filter((r) => !r.fork);
  const stars = own.reduce((n, r) => n + r.stargazers_count, 0);
  const byLang = new Map();
  for (const r of own) if (r.language) byLang.set(r.language, (byLang.get(r.language) ?? 0) + 1);
  const langs = [...byLang].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
  const max = Math.max(1, ...langs.map((l) => l[1]));

  const W = 860, rowH = 26, H = 168 + langs.length * rowH + 56;
  const kpis = [
    [own.length, "Original repositories"],
    [stars, "Stars received"],
    [profile.followers, "Followers"],
    [total, "Contributions, last year"],
  ];
  const colW = (W - 80) / 4;
  const kpiSvg = kpis
    .map(([v, l], i) => `<g transform="translate(${40 + i * colW} 92)"><text font-family="Georgia, 'Times New Roman', serif" font-size="38" fill="${C.white}">${v}</text><text y="24" font-family="${SANS}" font-size="12" fill="${C.bright}">${esc(l)}</text></g>`)
    .join("");
  const barX = 190, barW = W - barX - 90;
  const bars = langs
    .map(([name, n], i) => {
      const y = 190 + i * rowH;
      const w = Math.max(6, Math.round((n / max) * barW));
      return `<text x="40" y="${y + 11}" font-family="${SANS}" font-size="12" fill="${C.ice}">${esc(name)}</text>
    <rect x="${barX}" y="${y}" width="${barW}" height="12" rx="6" fill="${C.deep}" fill-opacity=".55"/>
    <rect x="${barX}" y="${y}" width="${w}" height="12" rx="6" fill="url(#avs-bar)"/>
    <text x="${barX + barW + 14}" y="${y + 11}" font-family="${MONO}" font-size="11" fill="${C.bright}">${n} repo${n === 1 ? "" : "s"}</text>`;
    })
    .join("\n    ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="avs-t avs-d">
  <title id="avs-t">GitHub statistics for ${USER}</title>
  <desc id="avs-d">${own.length} public repositories, ${stars} stars, ${profile.followers} followers and ${total} contributions in the last year, from public GitHub data on ${updated}.</desc>
  <defs>
    <linearGradient id="avs-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.bg1}"/><stop offset="1" stop-color="${C.bg0}"/>
    </linearGradient>
    <linearGradient id="avs-bar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.royal}"/><stop offset="1" stop-color="${C.bright}"/>
    </linearGradient>
    <linearGradient id="avs-line" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.royal}" stop-opacity="0"/><stop offset=".5" stop-color="${C.bright}"/><stop offset="1" stop-color="${C.royal}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="14" fill="url(#avs-bg)" stroke="${C.electric}" stroke-opacity=".6"/>
  <text x="40" y="38" font-family="${SANS}" font-size="15" font-weight="600" fill="${C.white}">GitHub at a glance</text>
  <text x="${W - 40}" y="38" text-anchor="end" font-family="${MONO}" font-size="11" fill="${C.bright}">public API · @${USER}</text>
  <rect x="40" y="52" width="${W - 80}" height="1.5" fill="url(#avs-line)"/>
  ${kpiSvg}
  <text x="40" y="164" font-family="${MONO}" font-size="11" letter-spacing="1.5" fill="${C.bright}">REPOSITORIES BY PRIMARY LANGUAGE</text>
  ${bars}
  <text x="40" y="${H - 18}" font-family="${SANS}" font-size="10" fill="${C.bright}" fill-opacity=".8">Counts of non-fork public repositories, not lines of code. Updated ${updated} (UTC).</text>
</svg>
`;
}

// ---------- main ----------
const [calendarHtml, profile, repos] = await Promise.all([
  get(`https://github.com/users/${USER}/contributions`),
  get(`https://api.github.com/users/${USER}`, true),
  get(`https://api.github.com/users/${USER}/repos?per_page=100&type=owner`, true),
]);
const calendar = parseCalendar(calendarHtml);
const updated = new Date().toISOString().slice(0, 10);

await mkdir(OUT, { recursive: true });
await writeFile(resolve(OUT, "contributions.svg"), heatmapSvg(calendar, updated));
await writeFile(resolve(OUT, "contributions-snake.svg"), heatmapSvg(calendar, updated, true));
await writeFile(resolve(OUT, "stats.svg"), statsSvg({ profile, repos, total: calendar.total }, updated));
console.log(`contributions.svg, contributions-snake.svg and stats.svg written (${calendar.days.length} days, ${calendar.total} contributions)`);
