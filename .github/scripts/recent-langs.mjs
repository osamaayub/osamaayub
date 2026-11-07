// Builds profile/recent-langs.svg: the languages in repos you pushed to in the last 12 months.
// The all-time card counts every repo ever made; this one shows what you write now.
// Runs in GitHub Actions with GITHUB_TOKEN. Test locally: node recent-langs.mjs --sample sample.json
import { readFileSync, writeFileSync } from "node:fs";

const USER = process.env.PROFILE_USER || "osamaayub";
const MONTHS = 12;
const TOP = 6;
const OUT = "profile/recent-langs.svg";
const since = new Date(Date.now() - MONTHS * 30.44 * 86_400_000);

const QUERY = `query($login: String!, $cursor: String) {
  user(login: $login) {
    repositories(first: 100, after: $cursor, ownerAffiliations: OWNER, isFork: false, orderBy: { field: PUSHED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { name pushedAt languages(first: 20, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } } }
    }
  }
}`;

async function fetchRepos() {
  const sampleIdx = process.argv.indexOf("--sample");
  if (sampleIdx > 0) return JSON.parse(readFileSync(process.argv[sampleIdx + 1], "utf8"));
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  const repos = [];
  let cursor = null;
  for (;;) {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { login: USER, cursor } }),
    });
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    const page = json.data.user.repositories;
    repos.push(...page.nodes);
    // Sorted by last push: stop once we are past the window.
    if (!page.pageInfo.hasNextPage || new Date(page.nodes.at(-1).pushedAt) < since) break;
    cursor = page.pageInfo.endCursor;
  }
  return repos;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function render(langs, repoCount) {
  const total = langs.reduce((a, l) => a + l.size, 0) || 1;
  const top = langs.slice(0, TOP);
  const rest = langs.slice(TOP).reduce((a, l) => a + l.size, 0);
  if (rest > 0) top.push({ name: "Other", color: "#6b7280", size: rest });
  const W = 350, barX = 25, barW = 300;
  let x = barX;
  const bar = top.map((l) => {
    const w = (l.size / total) * barW;
    const r = `<rect x="${x.toFixed(2)}" y="58" width="${Math.max(w, 0).toFixed(2)}" height="8" fill="${l.color || "#9ca3af"}"/>`;
    x += w;
    return r;
  }).join("");
  const items = top.map((l, i) => {
    const cx = i % 2 === 0 ? 25 : 185, cy = 92 + Math.floor(i / 2) * 25;
    return `<circle cx="${cx + 5}" cy="${cy - 4}" r="5" fill="${l.color || "#9ca3af"}"/><text x="${cx + 16}" y="${cy}" class="lang">${esc(l.name)} ${((l.size / total) * 100).toFixed(1)}%</text>`;
  }).join("");
  const H = 92 + Math.ceil(top.length / 2) * 25 + 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t">
<title id="t">Languages in repos updated in the last ${MONTHS} months</title>
<style>.title{font:600 18px 'Segoe UI',Ubuntu,Sans-Serif;fill:#70a5fd}.lang{font:400 12px 'Segoe UI',Ubuntu,Sans-Serif;fill:#38bdae}.note{font:400 11px 'Segoe UI',Ubuntu,Sans-Serif;fill:#9aa5ce}</style>
<rect x="0.5" y="0.5" rx="4.5" width="${W - 1}" height="${H - 1}" fill="#1a1b27"/>
<text x="25" y="35" class="title">Languages, last ${MONTHS} months</text>
<clipPath id="c"><rect x="${barX}" y="58" width="${barW}" height="8" rx="4"/></clipPath><g clip-path="url(#c)">${bar}</g>
${items}
<text x="25" y="${H - 8}" class="note">${repoCount} repos with pushes since ${since.toISOString().slice(0, 10)}</text>
</svg>`;
}

const repos = (await fetchRepos()).filter((r) => new Date(r.pushedAt) >= since && !/^osamaayub$/i.test(r.name));
const byLang = new Map();
for (const r of repos) for (const e of r.languages.edges) {
  const cur = byLang.get(e.node.name) || { name: e.node.name, color: e.node.color, size: 0 };
  cur.size += e.size;
  byLang.set(e.node.name, cur);
}
const langs = [...byLang.values()].sort((a, b) => b.size - a.size);
writeFileSync(OUT, render(langs, repos.length));
process.stdout.write(`Wrote ${OUT}: ${repos.length} repos, ${langs.map((l) => l.name).slice(0, TOP).join(", ")}\n`);
