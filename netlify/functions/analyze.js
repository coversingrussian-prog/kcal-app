// Netlify Function: анализ фото еды через Google Gemini (бесплатный tier)
// Ключ хранится в переменной окружения GEMINI_API_KEY — НЕ в коде фронтенда.

exports.handler = async (event) => {
  // Разрешаем только POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API-ключ не настроен на сервере' }) };
  }

  try {
    const { image } = JSON.parse(event.body);
    if (!image) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Нет изображения' }) };
    }

    // Промпт: просим Gemini вернуть строго JSON
    const prompt = `Ты — эксперт по питанию. Определи блюдо на фото и оцени его калорийность и БЖУ на порцию, которую видно.
Ответь СТРОГО одним JSON-объектом без markdown и пояснений, в формате:
{"dish":"название блюда на русском","calories":число_ккал,"protein":число_грамм,"fat":число_грамм,"carbs":число_грамм}
Если на фото нет еды — верни {"dish":"Еда не распознана","calories":0,"protein":0,"fat":0,"carbs":0}`;

    // Вызов Gemini API (модель gemini-2.0-flash — быстрая и бесплатная в free tier)
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/jpeg', data: image } }
          ]
        }],
        generationConfig: { temperature: 0.2 }
      })
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Gemini error', detail: errText }) };
    }

    const geminiData = await geminiRes.json();
    let text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Убираем markdown-обёртку, если модель её добавила
    text = text.replace(/```json/gi, '').replace(/```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Если модель вернула что-то не то — вытащим первый JSON-объект
      const match = text.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : null;
    }

    if (!parsed) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Не удалось разобрать ответ' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
