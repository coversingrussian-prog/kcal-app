// Поиск и сохранение продуктов по штрих-коду.
// Порядок при поиске (на клиенте): сначала Open Food Facts, потом эта база.
// Здесь: GET-подобный поиск по коду и POST-сохранение нового продукта.

exports.handler = async (event) => {
  const BUCKET = process.env.KVDB_BUCKET;
  if (!BUCKET) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Bucket not set' }) };
  }

  const base = 'https://kvdb.io/' + BUCKET + '/';

  try {
    const body = JSON.parse(event.body || '{}');
    const action = body.action;           // 'get' | 'save'
    const code = (body.code || '').toString().trim();

    if (!code || code.length < 6) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Bad barcode' }) };
    }

    // Ключ в базе: prod_<barcode>
    const key = 'prod_' + code;

    if (action === 'get') {
      const res = await fetch(base + key);
      if (res.status === 404) {
        return { statusCode: 200, body: JSON.stringify({ found: false }) };
      }
      if (!res.ok) {
        return { statusCode: 502, body: JSON.stringify({ error: 'DB read error' }) };
      }
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch (e) {
        return { statusCode: 200, body: JSON.stringify({ found: false }) };
      }
      return { statusCode: 200, body: JSON.stringify({ found: true, product: data }) };
    }

    if (action === 'save') {
      const p = body.product || {};
      // Валидация: название + числовые КБЖУ на 100 г
      const clean = {
        dish: String(p.dish || '').slice(0, 80),
        calories: Math.max(0, Math.round(Number(p.calories) || 0)),
        protein: Math.max(0, Math.round(Number(p.protein) || 0)),
        fat: Math.max(0, Math.round(Number(p.fat) || 0)),
        carbs: Math.max(0, Math.round(Number(p.carbs) || 0)),
        ts: Date.now()
      };
      if (!clean.dish || clean.calories <= 0) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid product' }) };
      }

      const res = await fetch(base + key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clean)
      });
      if (!res.ok) {
        return { statusCode: 502, body: JSON.stringify({ error: 'DB write error' }) };
      }
      return { statusCode: 200, body: JSON.stringify({ saved: true, product: clean }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
