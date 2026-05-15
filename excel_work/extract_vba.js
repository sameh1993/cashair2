const fs = require("fs");
const path = require("path");
const CFB = require("cfb");

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: node extract_vba.js <vbaProject.bin>");
  process.exit(1);
}

function decompressVba(container) {
  const source = Buffer.isBuffer(container) ? container : Buffer.from(container);
  if (source.length === 0 || source[0] !== 0x01) {
    throw new Error("Unexpected VBA compressed container signature");
  }

  let pos = 1;
  const output = [];

  while (pos < source.length) {
    if (pos + 2 > source.length) break;

    const header = source.readUInt16LE(pos);
    pos += 2;

    const chunkSize = (header & 0x0fff) + 3;
    const chunkFlag = (header & 0x8000) !== 0;
    const chunkEnd = Math.min(source.length, pos + chunkSize - 2);

    if (!chunkFlag) {
      const raw = source.subarray(pos, Math.min(chunkEnd, pos + 4096));
      for (const byte of raw) output.push(byte);
      pos = chunkEnd;
      continue;
    }

    const chunk = [];
    while (pos < chunkEnd && chunk.length < 4096) {
      const flagByte = source[pos++];
      for (let bit = 0; bit < 8 && pos < chunkEnd; bit += 1) {
        if ((flagByte & (1 << bit)) === 0) {
          chunk.push(source[pos++]);
        } else {
          if (pos + 2 > chunkEnd) {
            pos = chunkEnd;
            break;
          }

          const token = source.readUInt16LE(pos);
          pos += 2;

          const offsetBits = Math.max(
            4,
            Math.ceil(Math.log2(Math.max(chunk.length, 1)))
          );
          const lengthBits = 16 - offsetBits;
          const lengthMask = (1 << lengthBits) - 1;
          const length = (token & lengthMask) + 3;
          const offset = (token >> lengthBits) + 1;
          const copyStart = chunk.length - offset;

          for (let i = 0; i < length; i += 1) {
            chunk.push(chunk[copyStart + i]);
          }
        }

        if (chunk.length >= 4096) break;
      }
    }

    output.push(...chunk);
    pos = chunkEnd;
  }

  return Buffer.from(output);
}

function toPrintableText(buffer) {
  return buffer
    .toString("latin1")
    .replace(/\x00/g, "")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "");
}

const cfb = CFB.read(fs.readFileSync(inputPath), { type: "buffer" });

for (const entry of cfb.FileIndex) {
  if (!entry.content || !entry.name || entry.type !== 2) continue;

  let report = "";
  try {
    if (/^dir$/i.test(entry.name)) {
      const out = decompressVba(entry.content);
      report = toPrintableText(out);
    } else if (!/^(__SRP_|_VBA_PROJECT|PROJECTwm|PROJECT|dir)$/i.test(entry.name)) {
      const out = decompressVba(entry.content);
      report = toPrintableText(out);
    } else {
      continue;
    }
  } catch (error) {
    report = `ERROR: ${error.message}`;
  }

  const safeName = entry.name.replace(/[\\/:]/g, "_");
  const outPath = path.join(path.dirname(inputPath), `${safeName}.txt`);
  fs.writeFileSync(outPath, report, "utf8");
  console.log(`${entry.name} -> ${outPath}`);
}
