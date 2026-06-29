// This file is a serverless function (Vercel runs anything inside /api automatically).
// It is the ONLY place the secret API key lives — it never reaches the browser.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { zip, tier, lang, openOnly } = req.body || {};

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

  const allowedLangs = ['en', 'es', 'ar'];
  const languageCode = allowedLangs.indexOf(lang) !== -1 ? lang : 'en';
  const priceLevels = priceLevelMap[String(tier)] || priceLevelMap['2'];
  const FIVE_MILES_METERS = 8046.72;

  try {
    // Step 1: turn the ZIP into exact coordinates, so we can search a real
    // 5-mile radius around it instead of just guessing from the ZIP text.
    const geoRes = await fetch(
      'https://maps.googleapis.com/maps/api/geocode/json?address=' +
      encodeURIComponent(zip) + '&key=' + process.env.GOOGLE_PLACES_API_KEY
    );
    const geoData = await geoRes.json();

    if (geoData.status !== 'OK' || !geoData.results || !geoData.results.length) {
      res.status(404).json({ error: 'Could not locate that ZIP code' });
      return;
    }

    const center = geoData.results[0].geometry.location; // { lat, lng }

    // Step 2: search restaurants biased to a circle around that exact point.
    const requestBody = {
      textQuery: 'restaurants',
      priceLevels: priceLevels,
      languageCode: languageCode,
      pageSize: 20,
      locationBias: {
        circle: {
          center: { latitude: center.lat, longitude: center.lng },
          radius: FIVE_MILES_METERS
        }
      }
    };

    if (openOnly === true) {
      requestBody.openNow = true;
    }

    const apiRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': [
          'places.displayName',
          'places.formattedAddress',
          'places.priceLevel',
          'places.rating',
          'places.userRatingCount',
          'places.types',
          'places.currentOpeningHours',
          'places.googleMapsUri',
          'places.photos'
        ].join(',')
      },
      body: JSON.stringify(requestBody)
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

    const restaurants = places.slice(0, 18).map(function (p) {
      const types = (p.types || []).filter(function (t) {
        return skipTypes.indexOf(t) === -1;
      });
      const cuisine = types.length
        ? types[0].replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); })
        : 'Restaurant';

      let openNow = null;
      let nextChangeTime = null;
      if (p.currentOpeningHours) {
        if (typeof p.currentOpeningHours.openNow === 'boolean') {
          openNow = p.currentOpeningHours.openNow;
        }
        if (openNow === true && p.currentOpeningHours.nextCloseTime) {
          nextChangeTime = p.currentOpeningHours.nextCloseTime;
        } else if (openNow === false && p.currentOpeningHours.nextOpenTime) {
          nextChangeTime = p.currentOpeningHours.nextOpenTime;
        }
      }

      let photoName = null;
      if (Array.isArray(p.photos) && p.photos.length > 0 && p.photos[0].name) {
        photoName = p.photos[0].name;
      }

      return {
        name: (p.displayName && p.displayName.text) || 'Unnamed spot',
        cuisine: cuisine,
        price_tier: priceSignMap[p.priceLevel] || '',
        area: p.formattedAddress || zip,
        rating: typeof p.rating === 'number' ? p.rating : null,
        reviews: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
        open: openNow,
        nextChangeTime: nextChangeTime,
        mapsUri: p.googleMapsUri || null,
        photoName: photoName
      };
    });

    res.status(200).json({ restaurants: restaurants });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
};
