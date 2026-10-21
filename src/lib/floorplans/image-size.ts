/**
 * The pixel size of a PNG, JPEG, WebP or GIF file, read from its header: a plan image is
 * checked before it is decoded (a 40,000 px square PNG of a few KB would take 6.4 GB). Pure.
 */

export interface ImageSize {
	readonly width: number;
	readonly height: number;
}

/** The size the file says, or null when it isn't one of these formats or is cut short. */
export function imageSize(bytes: Uint8Array): ImageSize | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const at = (offset: number, text: string) =>
		[...text].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
	try {
		if (at(0, "\x89PNG\r\n\x1a\n") && at(12, "IHDR")) {
			return size(view.getUint32(16), view.getUint32(20));
		}
		if (at(0, "GIF8")) {
			return size(view.getUint16(6, true), view.getUint16(8, true));
		}
		if (at(0, "RIFF") && at(8, "WEBP")) return webpSize(view, at);
		if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(view);
	} catch {
		// Cut short (a DataView read past the end).
	}
	return null;
}

function size(width: number, height: number): ImageSize | null {
	return width > 0 && height > 0 ? { width, height } : null;
}

function webpSize(
	view: DataView,
	at: (offset: number, text: string) => boolean,
): ImageSize | null {
	if (at(12, "VP8 ")) {
		// Lossy: a key frame's start code, then 14-bit sizes.
		return size(
			view.getUint16(26, true) & 0x3fff,
			view.getUint16(28, true) & 0x3fff,
		);
	}
	if (at(12, "VP8L")) {
		const bits = view.getUint32(21, true);
		return size((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
	}
	if (at(12, "VP8X")) {
		const uint24 = (offset: number) =>
			view.getUint8(offset) |
			(view.getUint8(offset + 1) << 8) |
			(view.getUint8(offset + 2) << 16);
		return size(uint24(24) + 1, uint24(27) + 1);
	}
	return null;
}

/** The size in the first start-of-frame segment (SOF0–SOF15 but DHT, JPG and DAC). */
function jpegSize(view: DataView): ImageSize | null {
	let offset = 2;
	while (offset + 4 <= view.byteLength) {
		if (view.getUint8(offset) !== 0xff) return null;
		const marker = view.getUint8(offset + 1);
		// Fill bytes, and markers without a length.
		if (marker === 0xff) {
			offset++;
			continue;
		}
		if (
			marker === 0xd8 ||
			marker === 0x01 ||
			(marker >= 0xd0 && marker <= 0xd7)
		) {
			offset += 2;
			continue;
		}
		const length = view.getUint16(offset + 2);
		if (
			marker >= 0xc0 &&
			marker <= 0xcf &&
			marker !== 0xc4 &&
			marker !== 0xc8 &&
			marker !== 0xcc
		) {
			return size(view.getUint16(offset + 7), view.getUint16(offset + 5));
		}
		if (marker === 0xda || marker === 0xd9) return null;
		offset += 2 + length;
	}
	return null;
}
