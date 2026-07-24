exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not set' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const image = body.image;
    const foodText = body.text;

    if (!image && !foodText) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No input' }) };
    }

    // Short prompt = faster response
    const parts = [];
    if (image) {
      parts.push({ text: 'Dish on photo. Estimate for visible portion. Russian dish name.' });
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: image } });
    } else {
      parts.push({ text: 'Estimate for: ' + foodText + '. Use given grams or one typical serving. Russian dish name.' });
    }

    const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + API_KEY;

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: parts }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 200,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              dish: { type: 'STRING' },
              calories: { type: 'NUMBER' },
              protein: { type: 'NUMBER' },
              fat: { type: 'NUMBER' },
              carbs: { type: 'NUMBER' }
            },
            required: ['dish', 'calories', 'protein', 'fat', 'carbs']
          }
        }
      })
    });

    const rawResponse = await geminiRes.text();

    if (!geminiRes.ok) {
      console.log('GEMINI HTTP ERROR:', geminiRes.status, rawResponse);
      return { statusCode: 502, body: JSON.stringify({ error: 'Gemini error', status: geminiRes.status, detail: rawResponse.slice(0, 400) }) };
    }

    let geminiData;
    try {
      geminiData = JSON.parse(rawResponse);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Bad response' }) };
    }

    let text = '';
    if (geminiData && geminiData.candidates && geminiData.candidates[0] &&
        geminiData.candidates[0].content && geminiData.candidates[0].content.parts &&
        geminiData.candidates[0].content.parts[0]) {
      text = geminiData.candidates[0].content.parts[0].text || '';
    }

    if (!text) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Empty reply', detail: JSON.stringify(geminiData).slice(0, 300) }) };
    }

    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        try { parsed = JSON.parse(text.slice(start, end + 1)); } catch (e2) { parsed = null; }
      }
    }

    if (!parsed) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Parse failed', detail: text.slice(0, 200) }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };

  } catch (err) {
    console.log('FUNCTION CRASH:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
