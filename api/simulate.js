// api/simulate.js
// Paso 1: sube cada foto a Pollinations (POST /upload) para obtener una URL publica.
// Paso 2: llama a GET /image/{prompt} pasando ambas URLs en el parametro "image".
// Esta version expone el detalle exacto de cualquier error para poder diagnosticar.

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
    throw new Error('Formato de imagen invalido.');
  }
  return { mimeType: match[1], data: match[2] };
}

async function uploadImage(apiKey, mimeType, base64Data, filename) {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(base64Data, 'base64')], { type: mimeType }), filename);

  const res = await fetch('https://gen.pollinations.ai/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const rawText = await res.text();
  let data = null;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    // la respuesta no era JSON
  }

  if (!res.ok || !data?.url) {
    throw new Error(
      `Fallo al subir imagen (status ${res.status}): ${data?.error?.message || data?.error || rawText.slice(0, 300)}`
    );
  }
  return data.url;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Metodo no permitido.' });
  }

  const apiKey = process.env.POLLINATIONS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'El servidor no tiene configurada POLLINATIONS_API_KEY. Agrega la variable de entorno en Vercel.',
    });
  }

  try {
    const { vehicleImage, accessoryImage } = req.body || {};
    if (!vehicleImage || !accessoryImage) {
      return res.status(400).json({ error: 'Faltan las dos imagenes (vehiculo y accesorio).' });
    }

    const vehicle = parseDataUrl(vehicleImage);
    const accessory = parseDataUrl(accessoryImage);

    const vehicleUrl = await uploadImage(apiKey, vehicle.mimeType, vehicle.data, 'vehicle.jpg');
    const accessoryUrl = await uploadImage(apiKey, accessory.mimeType, accessory.data, 'accessory.jpg');

    const prompt =
      'Genera una imagen fotorrealista del vehiculo de la primera imagen de referencia con el accesorio ' +
      'exacto de la segunda imagen de referencia instalado en la posicion correcta. Respeta la perspectiva, ' +
      'escala, iluminacion y sombras del vehiculo original. No alteres el resto del vehiculo ni el fondo.';

    const params = new URLSearchParams({
      model: 'klein',
      image: `${vehicleUrl},${accessoryUrl}`,
      width: '1024',
      height: '1024',
      safe: 'privacy,secrets,sexual,violence,shield',
    });

    const imageUrl = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?${params.toString()}`;

    const imageResponse = await fetch(imageUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!imageResponse.ok) {
      const rawText = await imageResponse.text();
      let message = rawText.slice(0, 300);
      try {
        const errJson = JSON.parse(rawText);
        message = errJson?.error?.message || errJson?.error || message;
      } catch (e) {
        // no era JSON, se deja el texto crudo
      }
      return res.status(imageResponse.status).json({
        error: `Fallo al generar (status ${imageResponse.status}): ${message} | URL usada: ${imageUrl} | vehicleUrl: ${vehicleUrl} | accessoryUrl: ${accessoryUrl}`,
      });
    }

    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await imageResponse.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    return res.status(200).json({ image: `data:${contentType};base64,${base64}` });
  } catch (err) {
    console.error('simulate error:', err);
    return res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
}
