import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { NodeIO, VertexLayout } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

// Đọc model gốc ở ngoài thư mục đóng gói web và APK.
const source = new URL('../assets/models/', import.meta.url);
const output = new URL('../assets/models-optimized/', import.meta.url);
const bundled = new URL('../dist/assets/models-optimized/', import.meta.url);
const worldSource = await readFile(new URL('../dist/world3d.js', import.meta.url), 'utf8');
const usedModels = new Set();
for (const [, name] of worldSource.matchAll(/create(?:Glb|Npc)Pool\('([^']+\.glb)'/g)) usedModels.add(name);
const filenames = (await readdir(source)).filter(isGlb).sort();
for (const name of usedModels) {
  if (!filenames.includes(name)) throw new Error(`Thiếu model nguồn: ${name}`);
}

const scenery = /^meshy-(roadside-tree|coastal-palm|grass-clump|cumulus|cloud|highway-overpass)\.glb$/;
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  })
  .setVertexLayout(VertexLayout.SEPARATE);
await Promise.all([mkdir(output, { recursive: true }), mkdir(bundled, { recursive: true })]);
for (const name of filenames) await optimizeModel(name);

// Lọc tệp GLB trong kho model gốc.
function isGlb(name) {
  return name.endsWith('.glb');
}

// Nén texture và dữ liệu hình học, đồng thời giữ cấu trúc của xe và rig.
async function optimizeModel(name) {
  const input = new URL(name, source);
  const destination = new URL(name, output);
  const doc = await io.readBinary(await readFile(input));
  const resolution = scenery.test(name) ? 512 : 1024;
  await doc.transform(textureCompress({
    encoder: sharp,
    targetFormat: 'webp',
    resize: [resolution, resolution],
    quality: 88,
  }));
  // Chỉ giảm đa giác ở cảnh tĩnh không dùng lưới để tách bánh, đèn hoặc rotor.
  if (scenery.test(name)) {
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.55, error: 0.003 }));
  }
  doc.createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

  const compressed = await io.writeBinary(doc);
  await writeFile(destination, compressed);
  if (usedModels.has(name)) await copyFile(destination, new URL(name, bundled));
  console.log(`${name} ${(await stat(input)).size} → ${compressed.byteLength} bytes`);
}
