export function sameUrl(a: string, b: string) {
  const n = (u: string) => {
    try {
      const x = new URL(u);
      return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/$/, '') + x.search).toLowerCase();
    } catch {
      return u.toLowerCase();
    }
  };
  return n(a) === n(b);
}
