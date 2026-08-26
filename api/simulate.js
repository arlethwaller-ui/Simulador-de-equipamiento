// api/simulate.js
// Enfoque hibrido:
// 1) Descripcion del accesorio: Gemini 2.5 Flash (texto+vision), 100% gratis.
// 2) Generacion de la imagen final: Pollinations "kontext" (gratis con Pollen).

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

async function describeAccessoryWithGemini(geminiKey, accessory) {
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  'Describe este accesorio automotriz con el MAXIMO detalle visual posible, en español, ' +
                  'en un solo parrafo denso: forma exacta, dimensiones relativas, color exacto (tonos, brillos), ' +
                  'material y textura (mate, brillante, metalico, plastico texturizado), acabado, puntos de montaje ' +
                  'visibles, logos o marcas visibles, tornilleria visible, y cualquier detalle distintivo. Este texto ' +
                  'se usara para que otra IA lo reproduzca con fidelidad exacta sobre la foto de un vehiculo, asi que ' +
                  'no omitas ningun detalle visual observable. No des opiniones ni uses adjetivos vagos, solo hechos ' +
                  'visuales concretos.',
              },
              { inline_data: { mime_type: accessory.mimeType, data: accessory.data } },
            ],
          },
        ],
      }),
    }
  );

  const rawText = await res.text();
  let data = null;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    // no era JSON
  }

  if (!res.ok) {
    throw new Error(
      `Fallo al describir el accesorio con Gemini (status ${res.status}): ${data?.error?.message || rawText.slice(0, 300)}`
    );
  }

  const description = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!description) {
    throw new Error('Gemini no devolvio una descripcion del accesorio.');
  }
  return description;
}

async function editVehicleImageWithPollinations(pollinationsKey, vehicle, accessoryDescription) {
  const prompt = `Utiliza esta imagen de vehiculo como base. Instala visualmente sobre ella el siguiente accesorio,
descrito con precision a partir de su foto original:

"""${accessoryDescription}"""

REGLAS OBLIGATORIAS:
1. Mantener exactamente el vehiculo original: no modificar modelo, carroceria, parachoques, parrilla,
faros, capot, puertas, espejos, ventanas, molduras, aros, neumaticos, altura, suspension, color ni pintura.
No agregar elementos que no existan en la foto original del vehiculo.
2. Reproducir el accesorio descrito con la mayor fidelidad posible: misma forma, color, material y
proporciones relativas descritas. No rediseñarlo ni sustituirlo por uno generico.
3. La unica modificacion permitida es instalar ese accesorio en su posicion natural y realista sobre el vehiculo.
4. Respeta escala, perspectiva, angulo del vehiculo, iluminacion, sombras y reflejos de la foto original.
5. El resultado debe parecer una fotografia real del mismo vehiculo tras instalar el accesorio, no un render generico.
La fidelidad es mas importante que la estetica. No inventes detalles del accesorio que no se hayan descrito.`;

  const form = new FormData();
  form.append('prompt', prompt);
  form.append('model', 'kontext');
  form.append('image', new Blob([Buffer.from(vehicle.data, 'base64')], { type: vehicle.mimeType }), 'vehicle.jpg');
  form.append('safe', 'privacy,secrets,sexual,violence,shield');

  const res = await fetch('https://gen.pollinations.ai/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${pollinationsKey}` },
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
      `Fallo al generar la imagen con Pollinations (status ${res.status}): ${data?.error?.message || data?.error || rawText.slice(0, 300)}`
    );
  }

  const item = data?.data?.[0];
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item?.url) return item.url;
  throw new Error('Pollinations no devolvio una imagen.');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Metodo no permitido.' });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  const pollinationsKey = process.env.POLLINATIONS_API_KEY;

  if (!geminiKey) {
    return res.status(500).json({ error: 'Falta configurar GEMINI_API_KEY en Vercel.' });
  }
  if (!pollinationsKey) {
    return res.status(500).json({ error: 'Falta configurar POLLINATIONS_API_KEY en Vercel.' });
  }

  try {
    const { vehicleImage, accessoryImage } = req.body || {};
    if (!vehicleImage || !accessoryImage) {
      return res.status(400).json({ error: 'Faltan las dos imagenes (vehiculo y accesorio).' });
    }

    const vehicle = parseDataUrl(vehicleImage);
    const accessory = parseDataUrl(accessoryImage);

    const accessoryDescription = await describeAccessoryWithGemini(geminiKey, accessory);
    const finalImage = await editVehicleImageWithPollinations(pollinationsKey, vehicle, accessoryDescription);

    return res.status(200).json({ image: finalImage });
  } catch (err) {
    console.error('simulate error:', err);
    return res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
}
