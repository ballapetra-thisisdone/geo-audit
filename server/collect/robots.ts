// robots.txt értelmező (RFC 9309): csoportválasztás UA-token alapján, leghosszabb egyezés nyer, döntetlennél Allow.

export interface RobotsGroup {
  agents: string[];
  rules: { allow: boolean; path: string }[];
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
  errors: string[];
}

export function parseRobots(text: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  const errors: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) return;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      errors.push(`${i + 1}. sor nem értelmezhető: ${rawLine.trim()}`);
      return;
    }
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      return;
    }
    lastWasAgent = false;
    if (key === 'sitemap') {
      sitemaps.push(value);
      return;
    }
    if (key === 'allow' || key === 'disallow') {
      if (!current) {
        errors.push(`${i + 1}. sor: szabály User-agent előtt`);
        return;
      }
      if (key === 'disallow' && value === '') return; // üres Disallow = minden engedélyezett
      current.rules.push({ allow: key === 'allow', path: value });
    }
  });
  return { groups, sitemaps, errors };
}

/** A tokenre vonatkozó csoport(ok). Ha nincs saját, a '*' csoport. */
export function groupsFor(parsed: ParsedRobots, token: string): { groups: RobotsGroup[]; specific: boolean } {
  const t = token.toLowerCase();
  const specific = parsed.groups.filter((g) => g.agents.some((a) => a !== '*' && t.startsWith(a)));
  if (specific.length) return { groups: specific, specific: true };
  return { groups: parsed.groups.filter((g) => g.agents.includes('*')), specific: false };
}

function patternToRegex(p: string): RegExp {
  const anchored = p.endsWith('$');
  const body = (anchored ? p.slice(0, -1) : p)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

export interface RobotsDecision {
  allowed: boolean;
  rule?: string;
  specific: boolean;
  group?: string;
}

export function isAllowed(parsed: ParsedRobots, token: string, urlPath: string): RobotsDecision {
  const { groups, specific } = groupsFor(parsed, token);
  if (!groups.length) return { allowed: true, specific: false };
  let best: { allow: boolean; path: string } | undefined;
  for (const g of groups) {
    for (const r of g.rules) {
      if (!patternToRegex(r.path).test(urlPath)) continue;
      if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow && !best.allow)) {
        best = r;
      }
    }
  }
  return {
    allowed: best ? best.allow : true,
    rule: best ? `${best.allow ? 'Allow' : 'Disallow'}: ${best.path}` : undefined,
    specific,
    group: groups.map((g) => g.agents.join(', ')).join(' | '),
  };
}
