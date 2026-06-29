// This proxies Google Place Photos through our own server.
// Why: the Google Photo endpoint needs our API key in its URL — if the
// browser called Google directly, the key would be visible in the page's
// network traffic. Instead, the browser calls THIS endpoint (no key needed),
// and this function fetches the real image from Google using the hidden key,
// then forwards the image bytes back. The key never reaches the browser.

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).end();
    return;
  }

  const { name, w } = req.query || {};

  if (!name || typeof name !== 'string' || name.indexOf('places/') !== 0) {
    res.status(400).end();
    return;
  }

  const maxWidth = Math.min(parseInt(w, 10) || 400, 800);

  try {
    const googleUrl =
      'https://places.googleapis.com/v1/' + name + '/media' +
      '?maxWidthPx=' + maxWidth +
      '&key=' + process.env.GOOGLE_PLACES_API_KEY;

    const imgRes = await fetch(googleUrl);

    if (!imgRes.ok) {
      res.status(502).end();
      return;
    }

    const arrayBuffer = await imgRes.arrayBuffer();
    res.setHeader('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('Photo proxy error:', err);
    res.status(500).end();
  }
};
