/**
 * Render a play-screen preview using the same draw functions.
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let createCanvas;
try {
  ({ createCanvas } = require("canvas"));
} catch (err) {
  ({ createCanvas } = require("/tmp/ncanvas/node_modules/canvas"));
}
const E = require("./engine.js");
const R = require("./render.js");

const __dir = dirname(fileURLToPath(import.meta.url));
const CSS_W = 390;
const CSS_H = 844;
const DPR = 2;
const SAFE = 0;

function midSongState() {
  const eng = new E.PlayEngine();
  const width = CSS_W;
  const px = E.bowPixelWidth(width);
  const target = 0.82;
  let dir = 1;
  const dt = 1 / 60;
  // Play a slightly imperfect take until a visually interesting moment:
  // after count-in, a few notes in, bow mid-way, current note on a string.
  const until = E.LEAD + 6.4 * E.BEAT;
  while (eng.time < until) {
    const t = eng.time;
    const note = E.noteAt(t) || E.NOTES.find((n) => n.start >= t);
    let padY = (1 + 0.5) / 4;
    if (note) padY = (note.lane + 0.5) / 4;
    const upcoming = E.NOTES.find((n) => Math.abs(t - n.start) <= 0.12);
    if (upcoming && Math.abs(t - upcoming.start) <= 0.12) {
      const need = upcoming.dur * target + 0.02;
      const remaining = dir > 0 ? 1 - eng.s : eng.s;
      if (remaining < need) dir = -dir;
    }
    const deltaX = dir * target * dt * px;
    eng.step(dt, { pointerDown: true, padY, deltaX, canvasCssWidth: width });
  }
  return eng;
}

const engine = midSongState();
const now = engine.time;
const live = engine.liveShown();

const canvas = createCanvas(Math.round(CSS_W * DPR), Math.round(CSS_H * DPR));
const ctx = canvas.getContext("2d");
ctx.scale(DPR, DPR);
ctx.imageSmoothingEnabled = true;

R.paint(ctx, {
  cssW: CSS_W,
  cssH: CSS_H,
  safeTop: SAFE,
  now,
  playing: true,
  screen: "play",
  trace: engine.trace,
  engine,
  input: {
    pointerDown: true,
    padY: engine.lanes.length ? (engine.lanes[0] + 0.5) / 4 : 0.375,
  },
  showHint: false,
  drawHud: true,
  hudScore: "65.2%",
});

const out = join(__dir, "preview-play.png");
writeFileSync(out, canvas.toBuffer("image/png"));
console.log("wrote", out);
console.log("engine time", now.toFixed(3), "kind", engine.kind, "lanes", engine.lanes, "s", engine.s.toFixed(3), "live", live);
