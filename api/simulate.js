// api/simulate.js
// Recibe dos imagenes (vehiculo + accesorio) en base64 y pide a Pollinations.ai
// (modelo "klein", que acepta Pollen gratis de misiones Y admite dos imagenes
// de referencia) que genere una foto realista del accesorio instalado en el vehiculo.

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

    const prompt =
      'Eres un editor fotografico automotriz experto. La PRIMERA imagen es un vehiculo, la SEGUNDA ' +
      'es un accesorio (roll bar, parrilla, estribos, portaequipaje, defensa, etc.). Genera una unica imagen ' +
      'fotorrealista del vehiculo de la primera foto con el accesorio EXACTO de la segunda foto instalado en ' +
      'la posicion correcta para ese tipo de accesorio. Respeta la perspectiva, el angulo de camara, la escala, ' +
      'la iluminacion, las sombras proyectadas y los reflejos del vehiculo original. No alteres el resto del ' +
      'vehiculo, el fondo, ni el color de la carroceria. El resultado debe parecer una fotografia real tomada ' +
      'en el mismo lugar y con la misma luz que la foto original del vehiculo.';

    const form = new FormData();
    form.append('prompt', prompt);
    form.append('model', 'klein');
    form.append('image', new Blob([Buffer.from(vehicle.data, 'base64')], { type: vehicle.mimeType }), 'vehicle.jpg');
    form.append('image', new Blob([Buffer.from(accessory.data, 'base64')], { type: accessory.mimeType }), 'accessory.jpg');
    // Filtros de seguridad: bloquea contenido sexual, violento y otras categorias
    // problematicas. Importante porque esta app es publica y recibe fotos de terceros.
    form.append('safe', 'privacy,secrets,sexual,violence,shield');

    const response = await fetch('https://gen.pollinations.ai/v1/images/edits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });

    const result = await response.json();

    if (!response.ok) {
      const message = result?.error?.message || result?.error || 'Error al comunicarse con el servicio de IA.';
      return res.status(response.status).json({ error: message });
    }

    const item = result?.data?.[0];
    let imageDataUrl = null;
    if (item?.b64_json) {
      imageDataUrl = `data:image/png;base64,${item.b64_json}`;
    } else if (item?.url) {
      imageDataUrl = item.url;
    }

    if (!imageDataUrl) {
      return res.status(502).json({
        error: 'El modelo no devolvio una imagen. Intenta con fotos mas claras o de otro angulo.',
      });
    }

    return res.status(200).json({ image: imageDataUrl });
  } catch (err) {
    console.error('simulate error:', err);
    return res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
}
