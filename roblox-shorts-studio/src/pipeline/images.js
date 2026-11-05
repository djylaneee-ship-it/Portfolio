// Étape 3 : une illustration par scène. Groq et ElevenLabs ne font pas
// d'images : on utilise Pollinations (gratuit, sans clé), comme le Studio IA
// de Rovex Hub. Remplaçable plus tard par un autre fournisseur.
const fs = require('fs');

async function generate(prompt, style, outFile, seed) {
  const full = `${prompt}, ${style}, vertical 9:16, no text`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(full)}?width=1080&height=1920&nologo=true&seed=${seed}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      fs.writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
      return outFile;
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  throw new Error(`Image impossible à générer : ${prompt.slice(0, 60)}`);
}

module.exports = { generate };
