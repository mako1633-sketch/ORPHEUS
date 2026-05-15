import { fileURLToPath } from "node:url";
import { GifFrame, GifUtil } from "gifwrap";

const width = 960;
const height = 551;
const frameCount = 96;
const outPath = fileURLToPath(new URL("../img/daemon.gif", import.meta.url));

const colors = {
	bg0: [1, 0, 6],
	bg1: [12, 0, 18],
	grid: [42, 9, 38],
	cyan: [0, 245, 255],
	cyanDim: [0, 120, 160],
	magenta: [255, 32, 198],
	pink: [255, 72, 205],
	violet: [88, 62, 178],
	red: [255, 32, 64],
	deepRed: [122, 4, 24],
	amber: [255, 184, 72],
	white: [232, 238, 255],
	dim: [97, 68, 108],
};

function rgba(frame, x, y, [r, g, b], a = 255) {
	if (x < 0 || y < 0 || x >= width || y >= height) return;
	const i = (Math.floor(y) * width + Math.floor(x)) * 4;
	frame.bitmap.data[i] = Math.round(r / 51) * 51;
	frame.bitmap.data[i + 1] = Math.round(g / 51) * 51;
	frame.bitmap.data[i + 2] = Math.round(b / 51) * 51;
	frame.bitmap.data[i + 3] = a;
}

function mix(a, b, t) {
	return [
		Math.round(a[0] + (b[0] - a[0]) * t),
		Math.round(a[1] + (b[1] - a[1]) * t),
		Math.round(a[2] + (b[2] - a[2]) * t),
	];
}

function fillRect(frame, x, y, w, h, color, alpha = 255) {
	for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy++) {
		for (let xx = Math.max(0, x); xx < Math.min(width, x + w); xx++) {
			rgba(frame, xx, yy, color, alpha);
		}
	}
}

function rect(frame, x, y, w, h, color, thickness = 1) {
	fillRect(frame, x, y, w, thickness, color);
	fillRect(frame, x, y + h - thickness, w, thickness, color);
	fillRect(frame, x, y, thickness, h, color);
	fillRect(frame, x + w - thickness, y, thickness, h, color);
}

function line(frame, x0, y0, x1, y1, color, thickness = 1) {
	const dx = x1 - x0;
	const dy = y1 - y0;
	const steps = Math.max(Math.abs(dx), Math.abs(dy));
	for (let s = 0; s <= steps; s++) {
		const x = x0 + (dx * s) / steps;
		const y = y0 + (dy * s) / steps;
		fillRect(
			frame,
			Math.round(x - thickness / 2),
			Math.round(y - thickness / 2),
			thickness,
			thickness,
			color
		);
	}
}

function noise(x, y, seed) {
	const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
	return n - Math.floor(n);
}

function ellipse(frame, cx, cy, rx, ry, color, thickness = 1, start = 0, end = Math.PI * 2) {
	const steps = 420;
	for (let s = 0; s <= steps; s++) {
		const a = start + ((end - start) * s) / steps;
		const x = cx + Math.cos(a) * rx;
		const y = cy + Math.sin(a) * ry;
		fillRect(
			frame,
			Math.round(x - thickness / 2),
			Math.round(y - thickness / 2),
			thickness,
			thickness,
			color
		);
	}
}

function glowEllipse(frame, cx, cy, rx, ry, color, pulse) {
	for (let i = 8; i >= 1; i--) {
		const c = mix(colors.bg1, color, 0.18 + pulse * 0.08);
		ellipse(frame, cx, cy, rx + i * 5, ry + i * 3, c, 2);
	}
	ellipse(frame, cx, cy, rx, ry, color, 3);
	ellipse(frame, cx, cy, rx * 0.72, ry * 0.62, mix(color, colors.white, 0.18), 2);
}

function drawBackground(frame, t) {
	for (let y = 0; y < height; y++) {
		const v = y / height;
		const base = mix(colors.bg0, colors.bg1, v);
		for (let x = 0; x < width; x++) {
			const vignette = Math.hypot((x - width / 2) / width, (y - height / 2) / height);
			const scan = (Math.sin(y * 0.45 + t * Math.PI * 6) + 1) * 3;
			const staticNoise = noise(Math.floor(x / 6), Math.floor(y / 4), Math.floor(t * frameCount)) * 9;
			const wall = Math.abs(x - width / 2) < 7 + Math.sin(y * 0.08 + t * Math.PI * 8) * 5 ? 34 : 0;
			const c = base.map((channel, index) =>
				Math.max(0, Math.min(255, channel + scan + staticNoise - vignette * 26 + (index === 0 ? wall : 0)))
			);
			rgba(frame, x, y, c);
		}
	}

	const gridOffset = (t * 36) % 36;
	for (let x = -80; x < width + 80; x += 36) {
		line(frame, x + gridOffset, 394, x - 230 + gridOffset, height, colors.grid);
		line(frame, x - gridOffset, 394, x + 230 - gridOffset, height, colors.grid);
	}
	for (let y = 390; y < height; y += 22) {
		line(frame, 0, y, width, y, mix(colors.grid, colors.deepRed, (y - 390) / 220));
	}

	for (let i = 0; i < 30; i++) {
		const x = Math.floor(noise(i, 3, t * 19) * width);
		const y = Math.floor(noise(i, 9, t * 23) * 360) + 78;
		const h = 18 + Math.floor(noise(i, 17, t * 29) * 116);
		const color = i % 3 === 0 ? colors.red : i % 3 === 1 ? colors.cyanDim : colors.violet;
		line(frame, x, y, x + Math.sin(t * Math.PI * 8 + i) * 12, y + h, color, i % 5 === 0 ? 3 : 2);
	}

	const breachX = width / 2 + Math.sin(t * Math.PI * 2) * 9;
	for (let i = 0; i < 13; i++) {
		const x = breachX - 34 + i * 6 + Math.sin(t * Math.PI * 10 + i) * 6;
		line(frame, x, 36, x + Math.sin(i) * 34, 486, i % 2 ? colors.red : colors.cyan, i === 6 ? 6 : 3);
	}
}

function text(frame, x, y, value, color, scale = 2) {
	const font = {
		A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
		B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
		C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
		D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
		E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
		F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
		G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
		H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
		I: ["111", "010", "010", "010", "010", "010", "111"],
		K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
		L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
		M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
		N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
		O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
		P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
		R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
		S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
		T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
		U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
		V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
		W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
		X: ["10001", "01010", "00100", "00100", "00100", "01010", "10001"],
		Y: ["10001", "01010", "00100", "00100", "00100", "00100", "00100"],
		Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
		" ": ["0", "0", "0", "0", "0", "0", "0"],
		":": ["0", "1", "1", "0", "1", "1", "0"],
		"/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
		".": ["0", "0", "0", "0", "0", "1", "1"],
		"-": ["0", "0", "0", "1", "0", "0", "0"],
	};
	let cursor = x;
	for (const ch of value) {
		const glyph = font[ch] ?? font[" "];
		for (let row = 0; row < glyph.length; row++) {
			for (let col = 0; col < glyph[row].length; col++) {
				if (glyph[row][col] === "1")
					fillRect(frame, cursor + col * scale, y + row * scale, scale, scale, color);
			}
		}
		cursor += (glyph[0].length + 2) * scale;
	}
}

function drawInterface(frame, t, pulse) {
	const borderColor = mix(colors.red, colors.cyan, pulse * 0.18);
	rect(frame, 92, 68, 776, 398, borderColor, 4);
	rect(frame, 116, 92, 728, 350, mix(colors.deepRed, colors.cyanDim, pulse * 0.2), 1);

	for (let i = 0; i < 42; i++) {
		const side = i % 2 === 0 ? 132 : 782;
		const y = 108 + i * 8;
		const w = 18 + Math.floor(noise(i, 12, t * 9) * 52);
		const color = noise(i, 7, t * 13) > 0.62 ? colors.red : colors.grid;
		fillRect(frame, side - (i % 2 === 0 ? 0 : w), y, w, 4, color);
	}
}

function drawAvatar(frame, t) {
	const cx = width / 2;
	const cy = 266;
	const pulse = (Math.sin(t * Math.PI * 2) + 1) / 2;
	const bob = Math.sin(t * Math.PI * 2) * 4;
	const glitch = Math.sin(t * Math.PI * 16) > 0.78 ? 22 : 0;

	for (let i = 0; i < 7; i++) {
		ellipse(
			frame,
			cx + glitch / 2,
			cy + bob,
			128 + i * 42,
			86 + i * 22,
			mix(colors.bg1, colors.deepRed, 0.18),
			2
		);
	}
	glowEllipse(frame, cx + glitch, cy + bob, 152, 104, mix(colors.red, colors.cyan, pulse * 0.12), pulse);

	// A large, readable mask shape survives the terminal renderer much better than thin detail.
	line(frame, cx - 164 + glitch, cy - 80 + bob, cx - 88, cy - 18 + bob, colors.red, 8);
	line(frame, cx - 88, cy - 18 + bob, cx - 126, cy + 68 + bob, colors.red, 8);
	line(frame, cx - 126, cy + 68 + bob, cx - 26, cy + 116 + bob, colors.red, 8);
	line(frame, cx + 164 - glitch, cy - 80 + bob, cx + 88, cy - 18 + bob, colors.cyan, 8);
	line(frame, cx + 88, cy - 18 + bob, cx + 126, cy + 68 + bob, colors.cyan, 8);
	line(frame, cx + 126, cy + 68 + bob, cx + 26, cy + 116 + bob, colors.cyan, 8);

	fillRect(frame, cx - 150 + glitch, cy - 34 + bob, 92, 22, colors.red);
	fillRect(frame, cx + 58 - glitch, cy - 34 + bob, 92, 22, colors.cyan);
	fillRect(frame, cx - 136 + glitch, cy - 26 + bob, 58, 8, mix(colors.red, colors.white, pulse * 0.24));
	fillRect(frame, cx + 78 - glitch, cy - 26 + bob, 58, 8, mix(colors.cyan, colors.white, pulse * 0.24));

	for (let i = 0; i < 16; i++) {
		const x = cx - 92 + i * 12 + Math.sin(t * 12 + i) * 4;
		const h = 12 + Math.round(noise(i, Math.floor(t * frameCount), 7) * 42);
		fillRect(frame, x, cy + 28 + bob - h, 7, h, i % 3 ? colors.red : colors.cyan);
	}
	line(frame, cx - 98, cy + 72 + bob, cx - 24, cy + 100 + bob, colors.red, 6);
	line(frame, cx - 24, cy + 100 + bob, cx + 22, cy + 78 + bob, colors.violet, 6);
	line(frame, cx + 22, cy + 78 + bob, cx + 102, cy + 108 + bob, colors.cyan, 6);

	const sweep = t * Math.PI * 2;
	ellipse(frame, cx + glitch, cy + bob, 214, 142, colors.red, 5, sweep, sweep + Math.PI * 0.84);
	ellipse(frame, cx - glitch, cy + bob, 254, 168, colors.cyan, 5, sweep + Math.PI, sweep + Math.PI * 1.5);
	line(frame, cx, cy + bob, cx + Math.cos(sweep) * 310, cy + bob + Math.sin(sweep) * 198, colors.red, 4);
	line(frame, cx - 158, cy - 112 + bob, cx + 164, cy + 126 + bob, colors.deepRed, 4);
	line(frame, cx + 154, cy - 118 + bob, cx - 168, cy + 132 + bob, colors.cyanDim, 4);
}

function makeFrame(index) {
	const t = index / frameCount;
	const pulse = (Math.sin(t * Math.PI * 2) + 1) / 2;
	const frame = new GifFrame(width, height, { delayCentisecs: 4 });
	drawBackground(frame, t);
	drawInterface(frame, t, pulse);
	drawAvatar(frame, t);
	return frame;
}

const frames = Array.from({ length: frameCount }, (_, index) => makeFrame(index));
await GifUtil.write(outPath, frames, { loops: 0 });
console.log(`Wrote ${outPath}`);
