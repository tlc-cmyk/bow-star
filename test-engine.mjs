/**
 * Headless tests for the 弓弦星 play engine.
 * No browser, no Web Audio.
 */
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const E = require("./engine.js");

const DT = 1 / 60;
const WIDTH = 400;

function songOf(eng) {
  return (eng && eng.song) || E.getCurrentSong();
}

function notesOf(eng) {
  return songOf(eng).notes;
}

function run(inputFn, songId) {
  if (songId) E.setSong(songId);
  const eng = new E.PlayEngine(songId);
  const resultAt = songOf(eng).resultAt;
  let steps = 0;
  const maxSteps = Math.ceil(resultAt / DT) + 8;
  while (eng.time < resultAt && steps < maxSteps) {
    const input = inputFn(eng, DT) || {};
    input.canvasCssWidth = input.canvasCssWidth || WIDTH;
    eng.step(DT, input);
    steps++;
  }
  return eng;
}

/** Perfect-ish bot: correct lane, mid-band speed, reverse only near note starts. */
function perfectBot() {
  let dir = 1;
  const target = 0.82;
  const px = E.bowPixelWidth(WIDTH);

  return function (eng) {
    const t = eng.time;
    const notes = notesOf(eng);
    const note = E.noteAt(t, songOf(eng)) || notes.find((n) => n.start >= t);
    let padY = (1 + 0.5) / 4; // A string centre, default
    if (note) padY = (note.lane + 0.5) / 4;

    const upcoming = notes.find((n) => Math.abs(t - n.start) <= 0.12);
    if (upcoming && Math.abs(t - upcoming.start) <= 0.12) {
      const need = upcoming.dur * target + 0.02;
      const remaining = dir > 0 ? 1 - eng.s : eng.s;
      if (remaining < need) dir = -dir;
    }

    const pointerDown = t >= 0;
    const ds = dir * target * DT;
    const deltaX = ds * px;
    return { pointerDown, padY, deltaX, canvasCssWidth: WIDTH };
  };
}

function stillBot() {
  return function () {
    return { pointerDown: false, canvasCssWidth: WIDTH };
  };
}

function wrongLaneBot() {
  let dir = 1;
  const target = 0.82;
  const px = E.bowPixelWidth(WIDTH);
  return function (eng) {
    const t = eng.time;
    const notes = notesOf(eng);
    const upcoming = notes.find((n) => Math.abs(t - n.start) <= 0.12);
    if (upcoming && Math.abs(t - upcoming.start) <= 0.12) {
      const need = upcoming.dur * target + 0.02;
      const remaining = dir > 0 ? 1 - eng.s : eng.s;
      if (remaining < need) dir = -dir;
    }
    // Always bow G, which is never the melody lane in these songs.
    const padY = (3 + 0.5) / 4;
    const deltaX = dir * target * DT * px;
    return { pointerDown: true, padY, deltaX, canvasCssWidth: WIDTH };
  };
}

function assertContinuous(song) {
  const notes = song.notes;
  assert.ok(notes.length > 0, song.id + " should have notes");
  assert.ok(Math.abs(notes[0].start - song.lead) < 1e-9, song.id + " should start after lead-in");
  for (let i = 1; i < notes.length; i++) {
    assert.ok(
      Math.abs(notes[i].start - notes[i - 1].end) < 1e-9,
      song.id + " should tile without gaps at note " + i
    );
  }
  assert.ok(Math.abs(notes[notes.length - 1].end - song.songEnd) < 1e-9);
}

function heardFreq(note) {
  return E.OPEN_FREQ[note.lane] * Math.pow(2, note.semi / 12);
}

E.setSong("twinkle");

console.log("TOTAL seconds:", E.TOTAL.toFixed(4), "notes:", E.NOTES.length, "resultAt:", E.RESULT_AT.toFixed(4));
assert.equal(E.NOTES.length, 42);
assert.ok(Math.abs(E.TOTAL - 48 * E.BEAT) < 1e-9, "TOTAL should be 48 beats");

// Lanes
assert.deepEqual(E.lanesFromY(0.12), [0], "top is E");
assert.deepEqual(E.lanesFromY(0.38), [1], "second band is A");
assert.deepEqual(E.lanesFromY(0.25), [0, 1], "border E/A is a double stop");

const eng1 = run(perfectBot(), "twinkle");
const r1 = eng1.result();
console.log("\n[1] perfect bot");
console.log("  shown 名演度:", r1.shown, " raw:", r1.raw.toFixed(2));
console.log("  grade:", r1.grade, " type:", r1.type, " headline:", r1.headline);
console.log("  buckets:", Object.fromEntries(Object.entries(r1.buckets).map(([k, v]) => [k, +v.toFixed(3)])));
console.log("  ends:", r1.endCount, " finished:", eng1.finished, " time:", eng1.time.toFixed(3));
assert.ok(eng1.finished, "song should finish");
assert.ok(r1.shown > 75, "perfect bot should be well above 75, got " + r1.shown);
assert.ok(r1.shown >= 90, "perfect bot should ideally be 90+, got " + r1.shown);

const eng2 = run(stillBot(), "twinkle");
const r2 = eng2.result();
console.log("\n[2] still / no input");
console.log("  shown 名演度:", r2.shown, " raw:", r2.raw.toFixed(2));
console.log("  buckets:", Object.fromEntries(Object.entries(r2.buckets).map(([k, v]) => [k, +v.toFixed(3)])));
assert.ok(r2.shown <= 2, "still run should be near 0, got " + r2.shown);
assert.ok(r2.buckets.silent > E.TOTAL * 0.95, "still run should be almost all silent");
assert.equal(r2.buckets.clean, 0);

const eng3 = run(wrongLaneBot(), "twinkle");
const r3 = eng3.result();
console.log("\n[3] wrong-lane bowing");
console.log("  shown 名演度:", r3.shown, " raw:", r3.raw.toFixed(2));
console.log("  buckets:", Object.fromEntries(Object.entries(r3.buckets).map(([k, v]) => [k, +v.toFixed(3)])));
console.log("  last note visited via time:", E.lastNoteAt(eng3.time - E.TAIL - 0.01).index);
assert.ok(r3.buckets.wrong > E.TOTAL * 0.6, "wrong time should accumulate, got " + r3.buckets.wrong);
assert.ok(r3.shown < 20, "wrong-lane score should be low, got " + r3.shown);
// Song clock must not skip notes: all 42 notes exist on a fixed timeline.
assert.equal(E.NOTES.length, 42);
assert.ok(eng3.time >= E.RESULT_AT);
assert.equal(E.lastNoteAt(E.SONG_END - 1e-6).index, 41, "final note is reachable");
// Pitch of a wrong G string should be open G * 2^(semi/12), not skipped.
const sample = eng3.trace.find((p) => p.kind === "wrong" && p.lanes[0] === 3);
assert.ok(sample, "should have wrong-string samples");


const R = require("./render.js");

// Input mapping contract: pointer Y is always clamped onto the pad.
// Touching the staff (or anywhere above the pad) is padY=0, i.e. the E string.
assert.equal(R.mapPadY(80, 400, 600), 0, "staff / above pad clamps to 0 (E)");
assert.equal(R.mapPadY(400, 400, 600), 0, "pad top is 0 (E)");
assert.ok(Math.abs(R.mapPadY(475, 400, 600) - 0.125) < 1e-9, "mid of first band");
assert.equal(R.mapPadY(1000, 400, 600), 1, "below pad clamps to 1 (G)");
assert.equal(R.mapPadY(2000, 400, 600), 1, "far below pad still 1");
assert.deepEqual(E.lanesFromY(R.mapPadY(80, 400, 600)), [0], "staff start selects E");
assert.deepEqual(E.lanesFromY(0), [0], "y=0 is E");
assert.deepEqual(E.lanesFromY(1), [3], "y=1 is G");

// A stroke that starts in the staff (padY=0) at mid-band speed must select
// the E lane and must not go silent just because Y is outside the pad.
{
  const eng = new E.PlayEngine("twinkle");
  const px = E.bowPixelWidth(WIDTH);
  const deltaX = 0.82 * DT * px;
  for (let i = 0; i < 18; i++) {
    eng.step(DT, { pointerDown: true, padY: 0, deltaX, canvasCssWidth: WIDTH });
  }
  assert.deepEqual(eng.lanes, [0], "staff-start mid-speed stroke must keep E, got " + JSON.stringify(eng.lanes));
  assert.notEqual(eng.kind, "silent", "staff-start mid-speed stroke must not go silent, got " + eng.kind);
  console.log("\n[4] staff-start padY=0 mid-speed: lanes=", eng.lanes, "kind=", eng.kind, "sp=", eng.v.toFixed(3));
}

// --- New songs ---
assert.equal(E.SONGS.length, 3);
assert.deepEqual(E.SONGS.map((s) => s.id), ["twinkle", "tigers", "joy"]);

const tigers = E.getSong("tigers");
assertContinuous(tigers);
assert.equal(tigers.title, "兩隻老虎");
assert.equal(tigers.key, "A");
assert.equal(tigers.bpm, 108);
assert.equal(tigers.notes[0].lane, 1, "Frère Jacques starts on A string");
assert.equal(tigers.notes[0].semi, 0, "Frère Jacques starts on open A / tonic");
assert.ok(Math.abs(heardFreq(tigers.notes[0]) - 440) < 0.2, "start pitch should be A4");
assert.ok(Math.abs(tigers.total - 32 * tigers.beat) < 1e-9, "tigers should be 32 beats (8 bars)");
assert.ok(tigers.notes.every((n) => n.lane === 0 || n.lane === 1), "tigers stays on A and E");
assert.ok(tigers.total > 10 && tigers.total < 30, "tigers duration should be reasonable");

const joy = E.getSong("joy");
assertContinuous(joy);
assert.equal(joy.title, "歡樂頌");
assert.equal(joy.key, "D");
assert.equal(joy.bpm, 100);
assert.equal(joy.notes[0].lane, 2, "Ode to Joy starts on D string");
assert.equal(joy.notes[0].semi, 4, "Ode to Joy starts on D(4) / F#");
assert.ok(Math.abs(heardFreq(joy.notes[0]) - 369.99) < 0.5, "start pitch should be F#4");
assert.ok(Math.abs(joy.total - 64 * joy.beat) < 1e-9, "joy should be 64 beats (16 bars)");
assert.ok(joy.notes.every((n) => n.lane === 1 || n.lane === 2), "joy stays on A and D");
assert.ok(joy.total > 20 && joy.total < 50, "joy duration should be reasonable");
const lastJoy = joy.notes[joy.notes.length - 1];
assert.equal(lastJoy.lane, 2);
assert.equal(lastJoy.semi, 0, "Ode to Joy should end on D");

const engT = run(perfectBot(), "tigers");
const rT = engT.result();
console.log("\n[5] perfect bot — 兩隻老虎");
console.log("  shown:", rT.shown, " grade:", rT.grade, " type:", rT.type, " ends:", rT.endCount);
assert.ok(engT.finished, "tigers should finish");
assert.ok(rT.shown >= 90, "tigers perfect bot should be 名演/神技, got " + rT.shown);
assert.ok(rT.grade === "神技" || rT.grade === "名演", "tigers grade should be 神技 or 名演, got " + rT.grade);

const engJ = run(perfectBot(), "joy");
const rJ = engJ.result();
console.log("\n[6] perfect bot — 歡樂頌");
console.log("  shown:", rJ.shown, " grade:", rJ.grade, " type:", rJ.type, " ends:", rJ.endCount);
assert.ok(engJ.finished, "joy should finish");
assert.ok(rJ.shown >= 90, "joy perfect bot should be 名演/神技, got " + rJ.shown);
assert.ok(rJ.grade === "神技" || rJ.grade === "名演", "joy grade should be 神技 or 名演, got " + rJ.grade);

const stillT = run(stillBot(), "tigers").result();
assert.ok(stillT.shown <= 2, "tigers still run should be near 0, got " + stillT.shown);
const stillJ = run(stillBot(), "joy").result();
assert.ok(stillJ.shown <= 2, "joy still run should be near 0, got " + stillJ.shown);

E.setSong("twinkle");
assert.equal(E.NOTES.length, 42, "setSong should restore twinkle globals");

console.log("\nAll headless tests passed.");
