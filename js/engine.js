(function (root) {
  var PAIRS = [
    ["E05", "E18"],
    ["E09", "E16"],
    ["P05", "P18"],
    ["P13", "P16"],
    ["S07", "S18"],
    ["S12", "S19"]
  ];

  function byId() {
    var map = {};
    root.BIZ_QUESTIONS.forEach(function (q) {
      map[q.id] = q;
    });
    return map;
  }

  function polarity(q, answer) {
    if (!q || !answer) return null;
    if (q.type === "single") return q.options[answer.index].t;
    if (q.type === "rank") {
      var t1 = q.options[answer.order[0]].t;
      var t2 = q.options[answer.order[1]].t;
      return (2 * t1 + t2) / 3;
    }
    var r = answer.value;
    if (q.pole === "A") return (r - 1) / 4;
    return (5 - r) / 4;
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function clarityOf(score) {
    if (score >= 70 || score <= 30) return "strong";
    if (score >= 45 && score <= 55) return "weak";
    return "moderate";
  }

  function codeFrom(scores) {
    return (scores.A > 50 ? "B" : "C") +
      (scores.B > 50 ? "M" : "K") +
      (scores.C > 50 ? "D" : "G") +
      (scores.D > 50 ? "F" : "S");
  }

  function distance(code, scores) {
    var poles = [
      ["B", "A"],
      ["M", "B"],
      ["D", "C"],
      ["F", "D"]
    ];
    var d = 0;
    for (var i = 0; i < poles.length; i++) {
      var wantHigh = code.charAt(i) === poles[i][0];
      var s = scores[poles[i][1]];
      d += wantHigh ? (100 - s) : s;
    }
    return d;
  }

  function nearest(scores, n) {
    var primary = codeFrom(scores);
    var codes = Object.keys(root.BIZ_ARCHETYPES);
    codes.sort(function (a, b) {
      var diff = distance(a, scores) - distance(b, scores);
      if (diff) return diff;
      if (a === primary) return -1;
      if (b === primary) return 1;
      return a < b ? -1 : 1;
    });
    return codes.slice(0, n);
  }

  function scoreAttempt(answers, onlyIds) {
    var map = byId();
    var allow = null;
    if (onlyIds && onlyIds.length) {
      allow = {};
      onlyIds.forEach(function (id) { allow[id] = 1; });
    }
    var buckets = { A: [], B: [], C: [], D: [] };
    root.BIZ_QUESTIONS.forEach(function (q) {
      if (allow && !allow[q.id]) return;
      var p = polarity(q, answers[q.id]);
      if (p === null || p === undefined || isNaN(p)) {
        throw new Error("missing answer " + q.id);
      }
      buckets[q.axis].push(p);
    });
    var scores = {};
    ["A", "B", "C", "D"].forEach(function (k) {
      if (!buckets[k].length) throw new Error("axis " + k + " has 0");
      if (!allow && buckets[k].length !== 15) throw new Error("axis " + k + " has " + buckets[k].length);
      var sum = buckets[k].reduce(function (a, b) { return a + b; }, 0);
      scores[k] = round1((sum / buckets[k].length) * 100);
    });
    var clarity = {};
    var weak = 0;
    ["A", "B", "C", "D"].forEach(function (k) {
      clarity[k] = clarityOf(scores[k]);
      if (clarity[k] === "weak") weak += 1;
    });
    var contradictions = 0;
    PAIRS.forEach(function (pair) {
      if (allow && (!allow[pair[0]] || !allow[pair[1]])) return;
      var left = polarity(map[pair[0]], answers[pair[0]]);
      var right = polarity(map[pair[1]], answers[pair[1]]);
      if (left === null || right === null) return;
      if (Math.abs(left - right) >= 0.75) contradictions += 1;
    });
    var code = codeFrom(scores);
    var near = nearest(scores, 3);
    return {
      scores: scores,
      code: code,
      clarity: clarity,
      weak: weak,
      mixed: weak >= 2,
      contradictions: contradictions,
      reliable: contradictions < 2,
      near: near
    };
  }

  function poleAAnswers() {
    var answers = {};
    root.BIZ_QUESTIONS.forEach(function (q) {
      if (q.type === "rank" || q.type === "single") {
        var order = q.options.map(function (_, i) { return i; }).sort(function (a, b) {
          return q.options[b].t - q.options[a].t;
        });
        answers[q.id] = q.type === "rank" ? { order: order } : { index: order[0] };
      } else {
        answers[q.id] = { value: q.pole === "A" ? 5 : 1 };
      }
    });
    return answers;
  }

  function poleBAnswers() {
    var answers = {};
    root.BIZ_QUESTIONS.forEach(function (q) {
      if (q.type === "rank" || q.type === "single") {
        var order = q.options.map(function (_, i) { return i; }).sort(function (a, b) {
          return q.options[a].t - q.options[b].t;
        });
        answers[q.id] = q.type === "rank" ? { order: order } : { index: order[0] };
      } else {
        answers[q.id] = { value: q.pole === "A" ? 1 : 5 };
      }
    });
    return answers;
  }

  root.BIZ_ENGINE = {
    polarity: polarity,
    clarityOf: clarityOf,
    codeFrom: codeFrom,
    nearest: nearest,
    scoreAttempt: scoreAttempt,
    poleAAnswers: poleAAnswers,
    poleBAnswers: poleBAnswers,
    PAIRS: PAIRS
  };
})(typeof window !== "undefined" ? window : globalThis);
