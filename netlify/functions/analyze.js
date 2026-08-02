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
    const langName = body.lang || 'Russian';

    if (!image && !foodText) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No input' }) };
    }

    // Instruction: force strict JSON only, no markdown, no extra text.
    const instruction =
      'You are a nutrition estimator. Reply with ONLY a raw JSON object, ' +
      'no markdown, no code fences, no extra words. ' +
      'Format: {"dish": string, "calories": number, "protein": number, "fat": number, "carbs": number}. ' +
      'All macro values in grams, calories in kcal. Dish name in ' + langName + '.';

    const parts = [];
    if (image) {
      parts.push({ text: instruction + ' Estimate for the dish visible on the photo (visible portion).' });
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: image } });
    } else {
      parts.push({ text: instruction + ' Estimate for: ' + foodText + '. Use given grams or one typical serving.' });
    }

    const MODEL = 'gemini-3.6-flash';
    const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent';

    const reqBody = JSON.stringify({
      contents: [{ parts: parts }],
      generationConfig: {
        maxOutputTokens: 600,
        responseMimeType: 'application/json'
      }
    });

    // Try up to 3 times: Gemini sometimes returns transient 500/503
    let geminiRes, rawResponse;
    for (let attempt = 0; attempt < 3; attempt++) {
      geminiRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': API_KEY
        },
        body: reqBody
      });
      rawResponse = await geminiRes.text();
      if (geminiRes.ok) break;
      if (geminiRes.status === 500 || geminiRes.status === 503) {
        await new Promise(function(r) { setTimeout(r, 800); });
        continue;
      }
      break;
    }

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
        geminiData.candidates[0].content && geminiData.candidates[0].content.parts) {
      // Concatenate all text parts (3.x may split output)
      geminiData.candidates[0].content.parts.forEach(function(p) {
        if (p && p.text) text += p.text;
      });
    }

    if (!text) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Empty reply', detail: JSON.stringify(geminiData).slice(0, 300) }) };
    }

    // Strip markdown fences if present, then parse
    text = text.replace(/```json/gi, '').replace(/```/g, '').trim();

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
