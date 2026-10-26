// Generates assets/contributions.svg and assets/stats.svg from real, public GitHub data.
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
  bg0: "#030A1C",
  bg1: "#071634",
  navy: "#0B2A66",
  royal: "#1448C8",
  electric: "#1E6BFF",
  bright: "#3D9BFF",
  cyan: "#5CD6FF",
  ice: "#BFE0FF",
  white: "#EEF6FF",
};
const LEVELS = ["#0E1D3D", C.navy, C.royal, C.bright, C.cyan];
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

function heatmapSvg({ days, total }, updated) {
  const cell = 12, gap = 3, pitch = cell + gap;
  const padL = 46, padT = 74;
  const first = new Date(days[0].date + "T00:00:00Z");
  const startSunday = new Date(first);
  startSunday.setUTCDate(first.getUTCDate() - first.getUTCDay());
  const weeks = Math.floor((new Date(days.at(-1).date + "T00:00:00Z") - startSunday) / 864e5 / 7) + 1;
  const W = padL + weeks * pitch + 22;
  const H = padT + 7 * pitch + 58;

  let cells = "";
  let glowCells = "";
  let lastMonth = -1;
  const monthLabels = [];
  for (const d of days) {
    const dt = new Date(d.date + "T00:00:00Z");
    const col = Math.floor((dt - startSunday) / 864e5 / 7);
    const row = dt.getUTCDay();
    const x = padL + col * pitch, y = padT + row * pitch;
    const label = `${d.count} contribution${d.count === 1 ? "" : "s"} on ${d.date}`;
    cells += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${LEVELS[d.level]}"><title>${esc(label)}</title></rect>`;
    if (d.level >= 3) glowCells += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${LEVELS[d.level]}"/>`;
    if (row === 0 && dt.getUTCMonth() !== lastMonth) {
      lastMonth = dt.getUTCMonth();
      const name = dt.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
      monthLabels.push({ x, col, name });
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

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="avc-t avc-d">
  <title id="avc-t">GitHub contribution heatmap for ${USER}</title>
  <desc id="avc-d">${total} contributions in the last year, generated from public GitHub data on ${updated}.</desc>
  <defs>
    <linearGradient id="avc-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.bg1}"/><stop offset="1" stop-color="${C.bg0}"/>
    </linearGradient>
    <linearGradient id="avc-line" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.royal}" stop-opacity="0"/><stop offset=".5" stop-color="${C.bright}"/><stop offset="1" stop-color="${C.royal}" stop-opacity="0"/>
    </linearGradient>
    <filter id="avc-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3.5"/></filter>
  </defs>
  <rect width="${W}" height="${H}" rx="14" fill="url(#avc-bg)" stroke="${C.electric}" stroke-opacity=".6"/>
  <text x="${padL}" y="36" font-family="${SANS}" font-size="15" font-weight="600" fill="${C.white}">${total} contributions in the last year</text>
  <text x="${W - 22}" y="36" text-anchor="end" font-family="${MONO}" font-size="11" fill="${C.bright}">live data · github.com/${USER}</text>
  <rect x="${padL}" y="46" width="${W - padL - 22}" height="1.5" fill="url(#avc-line)"/>
  <g font-family="${SANS}" font-size="10" fill="${C.bright}">${months}${dayLabels}</g>
  <g filter="url(#avc-glow)" opacity=".85">${glowCells}</g>
  ${cells}
  <g font-family="${SANS}" font-size="10" fill="${C.bright}">
    <text x="${padL}" y="${H - 24}">Updated ${updated} (UTC)</text>
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
    <rect x="${barX}" y="${y}" width="${barW}" height="12" rx="6" fill="${C.navy}" fill-opacity=".55"/>
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
await writeFile(resolve(OUT, "stats.svg"), statsSvg({ profile, repos, total: calendar.total }, updated));
console.log(`contributions.svg + stats.svg written (${calendar.days.length} days, ${calendar.total} contributions)`);
