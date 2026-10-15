// D. pont: kódminták a kör adataiból. Mind szemléltető jellegű, a helyőrzők <<…>> jelöléssel.
import type { Round, Snippet } from '../shared/types.ts';
import { candidateTypes, flattenNodes, ORG_TYPES, typesOf } from './analyze/jsonld.ts';

export interface SampleGroup {
  id: string;
  title: string;
  note: string;
  snippets: Snippet[];
}

export function buildSamples(round: Round): SampleGroup[] {
  const url = new URL(round.input.url);
  const origin = url.origin;
  const facts = round.artifacts?.facts.rendered ?? round.artifacts?.facts.raw;
  const org = round.input.org || '<<SZERVEZET NEVE>>';
  const robotsText = round.artifacts?.robots?.text ?? '';
  const existingSitemaps = (robotsText.match(/^sitemap:.*$/gim) ?? []).join('\n') || `Sitemap: ${origin}/sitemap.xml`;
  const entityTypes = candidateTypes(round.input.entityType);
  const mainType = entityTypes?.[0] ?? '<<SCHEMA.ORG TÍPUS>>';
  const hasOrg = flattenNodes(facts).some((n) => typesOf(n).some((t) => ORG_TYPES.has(t)));
  const lang = facts?.lang ?? round.input.languages[0] ?? 'hu';

  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${origin}/#organization`,
        name: org,
        url: `${origin}/`,
        logo: { '@type': 'ImageObject', url: '<<LOGÓ ABSZOLÚT URL>>' },
        sameAs: ['<<HIVATALOS PROFIL URL 1>>', '<<HIVATALOS PROFIL URL 2>>'],
        contactPoint: { '@type': 'ContactPoint', telephone: '<<TELEFON>>', email: '<<E-MAIL>>', contactType: 'customer service' },
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}/#website`,
        url: `${origin}/`,
        name: org,
        publisher: { '@id': `${origin}/#organization` },
        inLanguage: lang,
      },
      {
        '@type': 'WebPage',
        '@id': `${round.input.url}#webpage`,
        url: round.input.url,
        name: facts?.title ?? '<<OLDAL CÍME>>',
        isPartOf: { '@id': `${origin}/#website` },
        mainEntity: { '@id': `${round.input.url}#main` },
        dateModified: '<<ÉÉÉÉ-HH-NN – valós módosítási dátum>>',
        inLanguage: lang,
      },
      {
        '@type': mainType,
        '@id': `${round.input.url}#main`,
        name: round.input.name || '<<FŐ ENTITÁS NEVE>>',
        description: '<<1–2 MONDATOS TÉNYSZERŰ LEÍRÁS, AMI AZ OLDALON IS LÁTHATÓ>>',
        url: round.input.url,
        ...(round.input.keyData.some((k) => /cím|helyszín|hol/i.test(k.label))
          ? {
              address: {
                '@type': 'PostalAddress',
                streetAddress: '<<UTCA, HÁZSZÁM>>',
                addressLocality: '<<VÁROS>>',
                postalCode: '<<IRSZ>>',
                addressCountry: 'HU',
              },
              geo: { '@type': 'GeoCoordinates', latitude: '<<LAT>>', longitude: '<<LNG>>' },
            }
          : {}),
        ...(round.input.keyData.some((k) => /ár|díj|price|költség/i.test(k.label))
          ? {
              offers: {
                '@type': 'Offer',
                price: '<<ÁR SZÁMKÉNT, pl. 89900>>',
                priceCurrency: 'HUF',
                availability: 'https://schema.org/InStock',
                validFrom: '<<ÉÉÉÉ-HH-NN>>',
                seller: { '@id': `${origin}/#organization` },
              },
            }
          : {}),
        provider: { '@id': `${origin}/#organization` },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Főoldal', item: `${origin}/` },
          { '@type': 'ListItem', position: 2, name: round.input.name || '<<OLDAL>>', item: round.input.url },
        ],
      },
    ],
  };

  return [
    {
      id: 'jsonld',
      title: 'JSON-LD entitásmodell',
      note: `Szemléltető. Organization és a fő entitás (${mainType}) külön node, @id-vel összekötve. Csak az oldalon látható, igazolható adat kerülhet bele; a provider/seller kulcsot a típushoz kell igazítani (Event → organizer, Product → brand/manufacturer). ${hasOrg ? 'Már van Organization az oldalon – a meglévő @id-t használd.' : ''}`,
      snippets: [{ label: 'JSON-LD (<script type="application/ld+json">)', code: JSON.stringify(jsonld, null, 2), lang: 'json' }],
    },
    {
      id: 'robots',
      title: 'robots.txt változatok az OpenAI-robotokra',
      note: 'Üzleti döntés. A GPTBot (tanítás) és az OAI-SearchBot (keresés) független. A ChatGPT-User felhasználói kérésre jön, a robots.txt rá nem feltétlenül vonatkozik. A módosítás kb. 24 óra alatt hat a ChatGPT searchre.',
      snippets: [
        {
          label: 'A) Keresés és tanítás is engedélyezett',
          lang: 'text',
          code: `User-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: GPTBot\nAllow: /\n\nUser-agent: bingbot\nAllow: /\n\nUser-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n\n${existingSitemaps}`,
        },
        {
          label: 'B) Keresés engedélyezett, modelltanítás tiltva (gyakori kompromisszum)',
          lang: 'text',
          code: `User-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: bingbot\nAllow: /\n\nUser-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n\n${existingSitemaps}`,
        },
        {
          label: 'C) Egy aloldal kizárása a ChatGPT searchből – NE robots.txt-vel, hanem noindex-szel',
          lang: 'html',
          code: `<!-- Az oldal maradjon lekérhető a robots.txt-ben, különben a noindexet nem látja a robot,\n     és az oldal címmel/linkkel még megjelenhet. -->\n<meta name="robots" content="noindex">`,
        },
      ],
    },
    {
      id: 'indexnow',
      title: 'IndexNow-hívás',
      note: 'Szemléltető. A kulcsfájlt a webhely gyökerébe kell tenni ({kulcs}.txt, tartalma a kulcs). Tartalomváltozáskor (ár, elérhetőség, dátum) hívandó.',
      snippets: [
        {
          label: 'curl',
          lang: 'bash',
          code: `curl -X POST "https://api.indexnow.org/indexnow" \\\n  -H "Content-Type: application/json; charset=utf-8" \\\n  -d '{\n    "host": "${url.host}",\n    "key": "<<INDEXNOW_KULCS>>",\n    "keyLocation": "${origin}/<<INDEXNOW_KULCS>>.txt",\n    "urlList": ["${round.input.url}"]\n  }'`,
        },
        {
          label: 'PHP (WordPress, mentéskor)',
          lang: 'php',
          code: `add_action('save_post', function ($post_id) {\n    if (wp_is_post_revision($post_id) || get_post_status($post_id) !== 'publish') return;\n    wp_remote_post('https://api.indexnow.org/indexnow', [\n        'headers' => ['Content-Type' => 'application/json; charset=utf-8'],\n        'body'    => wp_json_encode([\n            'host'        => '${url.host}',\n            'key'         => INDEXNOW_KEY,\n            'keyLocation' => home_url('/' . INDEXNOW_KEY . '.txt'),\n            'urlList'     => [get_permalink($post_id)],\n        ]),\n        'timeout'  => 5,\n        'blocking' => false,\n    ]);\n});`,
        },
      ],
    },
    {
      id: 'headers',
      title: 'HTTP fejlécek',
      note: 'Szemléltető. Nem HTML-fájloknál (PDF) csak fejléccel lehet indexelést szabályozni.',
      snippets: [
        { label: 'Elavult PDF-ek kizárása (Apache .htaccess)', lang: 'apache', code: `<FilesMatch "<<régi-fájl-minta>>\\.pdf$">\n  Header set X-Robots-Tag "noindex"\n</FilesMatch>` },
        { label: 'Nginx megfelelő', lang: 'nginx', code: `location ~* <<régi-fájl-minta>>\\.pdf$ {\n  add_header X-Robots-Tag "noindex";\n}` },
      ],
    },
    {
      id: 'waf',
      title: 'WAF-engedélyezőlista az OpenAI IP-JSON-ok alapján',
      note: 'Szemléltető. Az IP-listák változnak – időzített frissítés kell. A JSON-ok szerkezetét a letöltéskor ellenőrizd. A bingbotot fordított DNS-sel (*.search.msn.com) érdemes ellenőrizni.',
      snippets: [
        {
          label: 'IP-tartományok letöltése (Node.js)',
          lang: 'js',
          code: `// node fetch-openai-ips.mjs > openai-ips.txt\nconst lists = [\n  'https://openai.com/searchbot.json',\n  'https://openai.com/chatgpt-user.json',\n  // 'https://openai.com/gptbot.json', // csak ha a tanítást is engeditek\n];\nfor (const url of lists) {\n  const data = await (await fetch(url)).json();\n  for (const p of data.prefixes ?? []) console.log(p.ipv4Prefix ?? p.ipv6Prefix);\n}`,
        },
        {
          label: 'Cloudflare egyéni szabály (Skip / Allow) – kifejezés',
          lang: 'text',
          code: `(http.user_agent contains "OAI-SearchBot" or http.user_agent contains "ChatGPT-User")\nand ip.src in $openai_bots\n# $openai_bots: IP-lista a fenti script kimenetéből (Manage Account → Configurations → Lists)`,
        },
        {
          label: 'Nginx – az OpenAI IP-k kivétele a rate limit alól',
          lang: 'nginx',
          code: `geo $is_openai_bot {\n  default 0;\n  include /etc/nginx/openai-ips.conf;  # soronként: "<<CIDR>> 1;"\n}\nmap $is_openai_bot $limit_key {\n  1 "";\n  0 $binary_remote_addr;\n}\nlimit_req_zone $limit_key zone=perip:10m rate=10r/s;`,
        },
      ],
    },
    {
      id: 'factblock',
      title: 'Idézhető kulcsadat-blokk (HTML)',
      note: 'Szemléltető. Szerveroldalon renderelve, az oldal elején. Csak valós, az ügyféltől származó adattal.',
      snippets: [
        {
          label: 'HTML',
          lang: 'html',
          code: `<section aria-labelledby="kulcsadatok">\n  <h2 id="kulcsadatok">${round.input.name || '<<ENTITÁS>>'} – kulcsadatok</h2>\n  <dl>\n${(round.input.keyData.length ? round.input.keyData : [{ label: '<<CÍMKE>>', value: '' }])
            .map((k) => `    <dt>${k.label}</dt><dd>${k.value || '<<ÉRTÉK>>'}</dd>`)
            .join('\n')}\n  </dl>\n  <p><small>Frissítve: <time datetime="<<ÉÉÉÉ-HH-NN>>"><<ÉÉÉÉ. HH. NN.>></time></small></p>\n</section>`,
        },
      ],
    },
  ];
}
