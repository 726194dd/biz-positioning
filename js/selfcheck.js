require("./questions.js");
require("./archetypes.js");
require("./engine.js");

var Q = globalThis.BIZ_QUESTIONS;
var A = globalThis.BIZ_ARCHETYPES;
var E = globalThis.BIZ_ENGINE;

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

var EXPECT = {
  A: ["E01", "E02", "E08", "E09", "E10", "E16", "P01", "P03", "P11", "S01", "S02", "S03", "S08", "S09", "S13"],
  B: ["E07", "E15", "E19", "P02", "P04", "P06", "P10", "P13", "P15", "P16", "P17", "S05", "S10", "S16", "S17"],
  C: ["E03", "E04", "E11", "E12", "E13", "E17", "P08", "P09", "P14", "P19", "S04", "S07", "S11", "S14", "S18"],
  D: ["E05", "E06", "E14", "E18", "E20", "P05", "P07", "P12", "P18", "P20", "S06", "S12", "S15", "S19", "S20"]
};

var LIKERT = {
  E16: "A", E17: "A", E18: "A", E19: "B", E20: "B",
  P16: "A", P17: "B", P18: "A", P19: "B", P20: "B",
  S16: "A", S17: "B", S18: "A", S19: "A", S20: "B"
};

assert(Q.length === 60, "question count " + Q.length);
var ids = {};
Q.forEach(function (q) {
  assert(!ids[q.id], "dup " + q.id);
  ids[q.id] = q;
});

var types = { rank: 0, single: 0, likert: 0 };
Q.forEach(function (q) { types[q.type] += 1; });
assert(types.rank === 24 && types.single === 21 && types.likert === 15, "type mix " + JSON.stringify(types));

["A", "B", "C", "D"].forEach(function (axis) {
  var got = Q.filter(function (q) { return q.axis === axis; }).map(function (q) { return q.id; });
  assert(got.length === 15, axis + " count " + got.length);
  EXPECT[axis].forEach(function (id) {
    assert(got.indexOf(id) >= 0, axis + " missing " + id);
  });
  got.forEach(function (id) {
    assert(EXPECT[axis].indexOf(id) >= 0, axis + " extra " + id);
  });
});

Object.keys(LIKERT).forEach(function (id) {
  assert(ids[id].type === "likert" && ids[id].pole === LIKERT[id], "likert pole " + id);
});

Q.forEach(function (q) {
  if (q.type === "likert") return;
  assert(q.options.length === 3, q.id + " options");
  var ts = q.options.map(function (o) { return o.t; }).sort().join(",");
  assert(ts === "0,0.5,1", q.id + " t values " + ts);
});

var e01 = ids.E01;
assert(E.polarity(e01, { order: [0, 2, 1] }) === (2 * 1 + 0.5) / 3, "rank p high");
assert(Math.abs(E.polarity(e01, { order: [1, 2, 0] }) - (0.5 / 3)) < 1e-9, "rank p low");
assert(E.polarity(ids.E09, { index: 0 }) === 1, "single high");
assert(E.polarity(ids.E09, { index: 1 }) === 0, "single low");
assert(E.polarity(ids.E09, { index: 2 }) === 0.5, "single mid");
assert(E.polarity(ids.E16, { value: 5 }) === 1, "likert A5");
assert(E.polarity(ids.E16, { value: 1 }) === 0, "likert A1");
assert(E.polarity(ids.E16, { value: 3 }) === 0.5, "likert A3");
assert(E.polarity(ids.E19, { value: 5 }) === 0, "likert B5");
assert(E.polarity(ids.E19, { value: 1 }) === 1, "likert B1");
assert(E.polarity(ids.E19, { value: 3 }) === 0.5, "likert B3");

var high = E.scoreAttempt(E.poleAAnswers());
assert(high.code === "BMDF", "pole A code " + high.code);
["A", "B", "C", "D"].forEach(function (k) {
  assert(high.scores[k] > 50, k + " high " + high.scores[k]);
});
assert(high.reliable === true, "pole A reliable");
assert(high.mixed === false, "pole A mixed");

var low = E.scoreAttempt(E.poleBAnswers());
assert(low.code === "CKGS", "pole B code " + low.code);
["A", "B", "C", "D"].forEach(function (k) {
  assert(low.scores[k] < 50, k + " low " + low.scores[k]);
});

var messy = E.poleAAnswers();
messy.E16 = { value: 1 };
messy.E18 = { value: 1 };
var messyResult = E.scoreAttempt(messy);
assert(messyResult.contradictions >= 2, "contradictions " + messyResult.contradictions);
assert(messyResult.reliable === false, "messy reliable flag");

assert(E.codeFrom({ A: 50, B: 50, C: 80, D: 20 }) === "CKDS", "boundary code");
assert(E.clarityOf(50) === "weak" && E.clarityOf(45) === "weak" && E.clarityOf(55) === "weak", "weak band");
assert(E.clarityOf(70) === "strong" && E.clarityOf(30) === "strong", "strong band");
assert(E.clarityOf(62) === "moderate" && E.clarityOf(40) === "moderate", "moderate band");
assert(E.clarityOf(44) === "moderate" && E.clarityOf(56) === "moderate", "gap band");
assert(E.nearest({ A: 50, B: 50, C: 80, D: 20 }, 3)[0] === "CKDS", "nearest primary");

var codes = ["BMDF", "BMDS", "BMGF", "BMGS", "BKDF", "BKDS", "BKGF", "BKGS", "CMDF", "CMDS", "CMGF", "CMGS", "CKDF", "CKDS", "CKGF", "CKGS"];
assert(Object.keys(A).length === 16, "archetype count");
codes.forEach(function (code) {
  var item = A[code];
  assert(item && item.code === code, "missing " + code);
  ["name", "icon", "tagline", "quote", "formula", "bg", "accent", "portrait"].forEach(function (k) {
    assert(item[k] && String(item[k]).length > 0, code + " " + k);
  });
  assert(item.capabilities.length >= 3, code + " capabilities");
  assert(item.strengths.length >= 3, code + " strengths");
  assert(item.blindspots.length >= 2, code + " blindspots");
  assert(item.scenes.length >= 3, code + " scenes");
  assert(item.actions.length >= 3, code + " actions");
  ["pro", "shift", "free", "side", "newbie"].forEach(function (k) {
    assert(item.audience[k] && item.audience[k].length > 8, code + " audience " + k);
  });
  ["career", "freelance", "content", "product"].forEach(function (k) {
    assert(item.monetization[k] && item.monetization[k].length > 8, code + " money " + k);
  });
});

console.log("selfcheck ok");
console.log("poleA", high.code, JSON.stringify(high.scores), "contradictions", high.contradictions);
console.log("poleB", low.code, JSON.stringify(low.scores));
