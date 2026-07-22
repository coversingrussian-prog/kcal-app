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
    if (!image) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No image' }) };
    }

    const prompt = [
      'You are a nutrition expert. Identify the dish in the photo and estimate calories and macros for the visible portion.',
      'Reply with ONE JSON object only, no markdown, no explanations, in this exact format:',
      '{"dish":"name in Russian","calories":number,"protein":number,"fat":number,"carbs":number}',
      'If there is no food, reply {"dish":"Eda ne raspoznana","calories":0,"protein":0,"fat":0,"carbs":0}'
    ].join(' ');

    const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + API_KEY;

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
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048
        }
      })
    });

    const rawResponse = await geminiRes.text();

    if (!geminiRes.ok) {
      console.log('GEMINI HTTP ERROR:', geminiRes.status, rawResponse);
      return { statusCode: 502, body: JSON.stringify({ error: 'Gemini error', status: geminiRes.status, detail: rawResponse.slice(0, 500) }) };
    }

    let geminiData;
    try {
      geminiData = JSON.parse(rawResponse);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Gemini returned non-JSON', detail: rawResponse.slice(0, 300) }) };
    }

    let text = '';
    if (geminiData && geminiData.candidates && geminiData.candidates[0] &&
        geminiData.candidates[0].content && geminiData.candidates[0].content.parts &&
        geminiData.candidates[0].content.parts[0]) {
      text = geminiData.candidates[0].content.parts[0].text || '';
    }

    if (!text) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Empty model reply', detail: JSON.stringify(geminiData).slice(0, 300) }) };
    }

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
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not parse reply', detail: text.slice(0, 200) }) };
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
