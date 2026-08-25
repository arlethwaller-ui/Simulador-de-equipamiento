// api/simulate.js
// Recibe dos imágenes (vehículo + accesorio) en base64 y pide a Gemini 2.5 Flash Image
// que genere una foto realista del accesorio instalado en el vehículo.

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb',
    },
  },
};

function parseDataUrl(dataUrl) {
  const match = /^data:(.+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) {
    throw new Error('Formato de imagen inválido.');
  }
  return { mimeType: match[1], data: match[2] };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'El servidor no tiene configurada GEMINI_API_KEY. Agrega la variable de entorno en Vercel.',
    });
  }

  try {
    const { vehicleImage, accessoryImage } = req.body || {};
    if (!vehicleImage || !accessoryImage) {
      return res.status(400).json({ error: 'Faltan las dos imágenes (vehículo y accesorio).' });
    }

    const vehicle = parseDataUrl(vehicleImage);
    const accessory = parseDataUrl(accessoryImage);

    const prompt =
      'Eres un editor fotográfico automotriz experto. Te doy dos imágenes: la PRIMERA es un vehículo, ' +
      'la SEGUNDA es un accesorio (por ejemplo: roll bar, parrilla, estribos, portaequipaje, defensa, etc.). ' +
      'Genera una única imagen fotorrealista del vehículo de la primera foto con el accesorio de la segunda foto ' +
      'instalado en la posición correcta y anatómicamente correcta para ese tipo de accesorio. Respeta la perspectiva, ' +
      'el ángulo de cámara, la escala, la iluminación, las sombras proyectadas y los reflejos del vehículo original. ' +
      'No alteres el resto del vehículo, el fondo, ni el color de la carrocería. El resultado debe parecer una fotografía ' +
      'real tomada en el mismo lugar y con la misma luz que la foto original del vehículo, no un dibujo, colage ni render genérico.';

    const geminiResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                { inline_data: { mime_type: vehicle.mimeType, data: vehicle.data } },
                { inline_data: { mime_type: accessory.mimeType, data: accessory.data } },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['IMAGE'],
          },
        }),
      }
    );

    const result = await geminiResponse.json();

    if (!geminiResponse.ok) {
      const message = result?.error?.message || 'Error al comunicarse con el servicio de IA.';
      return res.status(geminiResponse.status).json({ error: message });
    }

    const parts = result?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData || p.inline_data);
    const imageData = imagePart?.inlineData?.data || imagePart?.inline_data?.data;
    const mimeType =
      imagePart?.inlineData?.mimeType || imagePart?.inline_data?.mime_type || 'image/png';

    if (!imageData) {
      const textPart = parts.find((p) => p.text)?.text;
      return res.status(502).json({
        error:
          textPart ||
          'El modelo no devolvió una imagen. Intenta con fotos más claras o de otro ángulo.',
      });
    }

    return res.status(200).json({ image: `data:${mimeType};base64,${imageData}` });
  } catch (err) {
    console.error('simulate error:', err);
    return res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
}
