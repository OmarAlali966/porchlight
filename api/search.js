// This file is a serverless function (Vercel runs anything inside /api automatically).
// It is the ONLY place the secret API key lives — it never reaches the browser.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { zip, tier } = req.body || {};

  if (!zip || !/^\d{5}$/.test(zip)) {
    res.status(400).json({ error: 'Invalid ZIP code' });
    return;
  }

  const priceLevelMap = {
    '1': ['PRICE_LEVEL_INEXPENSIVE'],
    '2': ['PRICE_LEVEL_MODERATE'],
    '3': ['PRICE_LEVEL_EXPENSIVE'],
    '4': ['PRICE_LEVEL_VERY_EXPENSIVE']
  };
  const priceSignMap = {
    PRICE_LEVEL_FREE: '',
    PRICE_LEVEL_INEXPENSIVE: '$',
    PRICE_LEVEL_MODERATE: '$$',
    PRICE_LEVEL_EXPENSIVE: '$$$',
    PRICE_LEVEL_VERY_EXPENSIVE: '$$$$'
  };

  const priceLevels = priceLevelMap[String(tier)] || priceLevelMap['2'];

  try {
    const apiRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.priceLevel,places.rating,places.userRatingCount,places.types'
      },
      body: JSON.stringify({
        textQuery: 'restaurants near ' + zip,
        priceLevels: priceLevels,
        pageSize: 8
      })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('Places API error:', apiRes.status, errText);
      res.status(502).json({ error: 'Search service unavailable right now' });
      return;
    }

    const data = await apiRes.json();
    const places = data.places || [];

    const skipTypes = ['restaurant', 'food', 'point_of_interest', 'establishment'];

    const restaurants = places.slice(0, 6).map(function (p) {
      const types = (p.types || []).filter(function (t) {
        return skipTypes.indexOf(t) === -1;
      });
      const cuisine = types.length
        ? types[0].replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); })
        : 'Restaurant';

      return {
        name: (p.displayName && p.displayName.text) || 'Unnamed spot',
        cuisine: cuisine,
        price_tier: priceSignMap[p.priceLevel] || '',
        area: p.formattedAddress || zip,
        rating: typeof p.rating === 'number' ? p.rating : null,
        reviews: typeof p.userRatingCount === 'number' ? p.userRatingCount : null
      };
    });

    res.status(200).json({ restaurants: restaurants });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
};
