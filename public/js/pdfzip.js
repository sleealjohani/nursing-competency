'use strict';

/**
 * Turns rendered form sheets into PDF files and packs them into a ZIP,
 * entirely in the browser.
 *
 * Why in the browser: the pages carry Arabic — nurse names, units, comments —
 * and the browser is the one thing here that shapes and orders Arabic
 * correctly. A PDF drawn on the server would need its own text shaper, and a
 * mangled name on a signed record is not a cosmetic bug.
 *
 * Each sheet is captured at print resolution and reduced to one bit per pixel.
 * The form is black on white, so that costs nothing in legibility, and it
 * compresses about ten times smaller than a JPEG of the same page while
 * staying free of the ringing artefacts JPEG leaves around text.
 *
 * No libraries beyond html2canvas: PDF and ZIP are both written here, and the
 * compression is the browser's own CompressionStream.
 */

/** A4 in PostScript points, the unit PDF measures in. */
const PDF_PAGE = { width: 595.28, height: 841.89 };

/** 3 x CSS pixels ≈ 288 dpi: crisp in print, still a small file. */
const CAPTURE_SCALE = 3;

/** Anything lighter than this becomes paper, anything darker becomes ink. */
const INK_THRESHOLD = 150;

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Captures one sheet as a 1-bit bitmap.
 * @returns {Promise<{width:number,height:number,data:Uint8Array}>} packed rows,
 *   one bit per pixel, 1 = white, which is what PDF's DeviceGray expects.
 */
async function captureSheet(sheet) {
  const canvas = await html2canvas(sheet, {
    scale: CAPTURE_SCALE,
    backgroundColor: '#ffffff',
    logging: false,
    useCORS: true,
  });
  const { width, height } = canvas;
  const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;

  const rowBytes = (width + 7) >> 3;
  const bits = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * rowBytes;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const luminance = pixels[i] * 0.299 + pixels[i + 1] * 0.587
        + pixels[i + 2] * 0.114;
      if (luminance > INK_THRESHOLD) bits[row + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width, height, data: await deflate(bits) };
}

// --- PDF --------------------------------------------------------------------

const encoder = new TextEncoder();

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/**
 * Writes a PDF, one page per captured sheet.
 * @param {Array<{width:number,height:number,data:Uint8Array}>} pages
 */
function buildPdf(pages, title) {
  const objects = [];               // 1-based; index 0 is object 1
  const add = (body) => { objects.push(body); return objects.length; };

  const pagesId = 2;                // reserved below, after the catalog
  add(encoder.encode('<< /Type /Catalog /Pages 2 0 R >>'));
  add(null);                        // placeholder: needs the kids' ids

  const kids = [];
  for (const page of pages) {
    const imageId = add(concat([
      encoder.encode('<< /Type /XObject /Subtype /Image '
        + `/Width ${page.width} /Height ${page.height} `
        + '/ColorSpace /DeviceGray /BitsPerComponent 1 '
        + `/Filter /FlateDecode /Length ${page.data.length} >>\nstream\n`),
      page.data,
      encoder.encode('\nendstream'),
    ]));
    // Draw the image across the whole page: scale, then paint.
    const content = encoder.encode(
      `q ${PDF_PAGE.width} 0 0 ${PDF_PAGE.height} 0 0 cm /Im0 Do Q`);
    const contentId = add(concat([
      encoder.encode(`<< /Length ${content.length} >>\nstream\n`),
      content,
      encoder.encode('\nendstream'),
    ]));
    const pageId = add(encoder.encode(
      `<< /Type /Page /Parent ${pagesId} 0 R `
      + `/MediaBox [0 0 ${PDF_PAGE.width} ${PDF_PAGE.height}] `
      + `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> `
      + `/Contents ${contentId} 0 R >>`));
    kids.push(`${pageId} 0 R`);
  }
  objects[pagesId - 1] = encoder.encode(
    `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`);

  const infoId = add(encoder.encode(
    `<< /Title (${pdfString(title)}) /Producer (Nursing Competency Exam) >>`));

  // Assemble, tracking each object's byte offset for the cross-reference table.
  const parts = [encoder.encode('%PDF-1.4\n')];
  let offset = parts[0].length;
  const offsets = [];
  objects.forEach((body, index) => {
    const head = encoder.encode(`${index + 1} 0 obj\n`);
    const tail = encoder.encode('\nendobj\n');
    offsets.push(offset);
    parts.push(head, body, tail);
    offset += head.length + body.length + tail.length;
  });

  const xrefAt = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) xref += `${String(at).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R `
    + `/Info ${infoId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  parts.push(encoder.encode(xref));

  return concat(parts);
}

/** Escapes a literal PDF string. */
function pdfString(value) {
  return String(value || '').replace(/[\\()]/g, '\\$&')
    // Keep it to ASCII: the title is metadata, not the page content.
    .replace(/[^\x20-\x7e]/g, '');
}

// --- ZIP --------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

/** ZIP stores the timestamp in MS-DOS form: 2-second resolution, epoch 1980. */
function dosStamp(when) {
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5)
      | (when.getSeconds() >> 1),
    date: ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5)
      | when.getDate(),
  };
}

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Packs files into a ZIP. Entries are stored rather than deflated — a PDF full
 * of already-compressed images gains nothing from a second pass.
 *
 * @param {Array<{name:string, data:Uint8Array}>} files
 */
function buildZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const { time: dosTime, date: dosDate } = dosStamp(new Date());

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);          // version needed
    local.setUint16(6, 0x0800, true);      // names are UTF-8
    local.setUint16(8, 0, true);           // stored
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);

    parts.push(new Uint8Array(local.buffer), name, file.data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, dosTime, true);
    dir.setUint16(14, dosDate, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, size, true);
    dir.setUint32(24, size, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);

    offset += 30 + name.length + size;
  }

  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return concat([...parts, ...central, new Uint8Array(end.buffer)]);
}

/** A filename that survives Windows, macOS and Linux. */
function safeFileName(value, fallback) {
  const cleaned = String(value || '').trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .slice(0, 90)
    .trim();
  return cleaned || fallback;
}
