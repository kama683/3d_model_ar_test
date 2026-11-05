// Оптимизация GLB: дедупликация, уменьшение текстур до 2048 и перевод их в WebP.
// Использование: node scripts/optimize-model.mjs <input.glb> <output.glb> [maxSize]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

const [input, output, sizeArg] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node scripts/optimize-model.mjs <input.glb> <output.glb> [maxSize]');
  process.exit(1);
}
const size = Number(sizeArg ?? 2048);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);

await doc.transform(
  dedup(),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 85 }),
);

await io.write(output, doc);
for (const t of doc.getRoot().listTextures()) {
  console.log(t.getName(), t.getMimeType(), t.getSize()?.join('x'), t.getImage()?.byteLength);
}
