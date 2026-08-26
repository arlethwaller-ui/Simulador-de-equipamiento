// api/simulate.js
// Enfoque de 2 consultas independientes:
// 1) Vision+texto: describe el accesorio en detalle a partir de su foto.
// 2) Edicion de imagen (una sola imagen): agrega el accesorio descrito sobre la foto del vehiculo.

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

async function describeAccessory(apiKey, accessoryDataUrl) {
  const res = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'openai',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'Describe este accesorio automotriz con el maximo detalle visual posible, en un solo ' +
                'parrafo, en español: forma exacta, colores, materiales, textura, puntos de montaje, ' +
                'tamaño aproximado, y cualquier detalle distintivo (logos, luces, texturas). Este texto ' +
                'se usara para que otra IA lo dibuje sobre la foto de un vehiculo, asi que se lo mas ' +
                'preciso y descriptivo posible. No des opiniones, solo describe.',
            },
            { type: 'image_url', image_url: { url: accessoryDataUrl } },
          ],
        },
      ],
    }),
  });

  const rawText = await res.text();
  let data = null;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    // no era JSON
  }

  if (!res.ok) {
    throw new Error(
      `Fallo al describir el accesorio (status ${res.status}): ${data?.error?.message || data?.error || rawText.slice(0, 300)}`
    );
  }

  const description = data?.choices?.[0]?.message?.content;
  if (!description) {
    throw new Error('No se pudo obtener una descripcion del accesorio.');
  }
  return description;
}

async function editVehicleImage(apiKey, vehicle, accessoryDescription) {
  const prompt =
    'Eres un editor fotografico automotriz experto. Agrega el siguiente accesorio a este vehiculo, ' +
    'instalandolo en la posicion correcta y realista para ese tipo de pieza. Respeta la perspectiva, ' +
    'iluminacion, sombras y reflejos de la foto original. No cambies el resto del vehiculo ni el fondo. ' +
    'El accesorio a instalar es: ' +
    accessoryDescription;

  const form = new FormData();
  form.append('prompt', prompt);
  form.append('model', 'kontext');
  form.append('image', new Blob([Buffer.from(vehicle.data, 'base64')], { type: vehicle.mimeType }), 'vehicle.jpg');
  form.append('safe', 'privacy,secrets,sexual,violence,shield');

  const res = await fetch('https://gen.pollinations.ai/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const rawText = await res.text();
  let data = null;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    // no era JSON
  }

  if (!res.ok) {
    throw new Error(
      `Fallo al generar la imagen (status ${res.status}): ${data?.error?.message || data?.error || rawText.slice(0, 300)}`
    );
  }

  const item = data?.data?.[0];
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item?.url) return item.url;
  throw new Error('El modelo no devolvio una imagen.');
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

    const accessoryDescription = await describeAccessory(apiKey, accessoryImage);
    const finalImage = await editVehicleImage(apiKey, vehicle, accessoryDescription);

    return res.status(200).json({ image: finalImage, descripcionUsada: accessoryDescription });
  } catch (err) {
    console.error('simulate error:', err);
    return res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
}
