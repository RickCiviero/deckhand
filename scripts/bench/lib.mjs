// Shared bits for the benchmark decks. Decks are original works that use the structures popular HTML-presentation tools produce.
export const doc = ({ title, lang = 'en', head = '', css = '', body = '', js = '', bodyAttrs = '' }) => `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${head}<style>
${css}
</style>
</head>
<body${bodyAttrs}>
${body}${js ? `<script>\n${js}\n</script>\n` : ''}</body>
</html>
`;

export const lorem = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse.',
  'Excepteur sint occaecat cupidatat non proident, sunt in culpa.',
  'Curabitur pretium tincidunt lacus, nulla gravida orci a odio.',
];

const svgData = (svg) => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
export const art = (w, h, a, b, label = '') => svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.7}" cy="${h * 0.35}" r="${h * 0.22}" fill="rgba(255,255,255,.25)"/><text x="${w * 0.08}" y="${h * 0.9}" font-family="Arial" font-size="${h * 0.12}" fill="#fff">${label}</text></svg>`);
