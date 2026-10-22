(function () {
  var ENGINE = window.BIZ_ENGINE;
  var KEY = "biz-locate-v1";
  var LIKERT = ["完全不像", "不太像", "说不好", "比较像", "非常像"];
  var CLARITY = { strong: "强偏好", moderate: "中等偏好", weak: "摇摆" };

  var state = null;
  var ephemeral = null;
  var ui = {
    preview: false,
    token: 0,
    timer: null,
    selectedCode: "",
    shareOpen: false,
    cardOpen: false,
    cardUrl: "",
    copied: "",
    confirmRetake: false,
    profileStep: 0,
    resumeAt: 0,
    pendingForm: ""
  };

  var qmap = {};
  window.BIZ_QUESTIONS.forEach(function (q) { qmap[q.id] = q; });

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function blank() {
    return {
      v: 1,
      screen: "cover",
      cursor: 0,
      profile: { audience: "", years: null, name: "" },
      order: null,
      display: {},
      answers: {},
      result: null,
      prev: null,
      form: ""
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      var data = JSON.parse(raw);
      if (!data || data.v !== 1) return blank();
      return data;
    } catch (e) {
      return blank();
    }
  }

  function save() {
    if (ui.preview) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function shuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function steps() {
    var list = [{ kind: "cover" }, { kind: "profile" }];
    if (!state.order) return list;
    window.BIZ_SECTIONS.forEach(function (sec) {
      var ids = state.order.filter(function (id) { return qmap[id] && qmap[id].section === sec.id; });
      if (!ids.length) return;
      list.push({ kind: "section", section: sec });
      ids.forEach(function (id, i) {
        list.push({ kind: "question", id: id, indexInSection: i, sectionSize: ids.length, section: sec });
      });
    });
    list.push({ kind: "computing" });
    return list;
  }

  function formIds(form) {
    if (form === "30") return window.BIZ_SHORT.slice();
    return window.BIZ_QUESTIONS.map(function (q) { return q.id; });
  }

  function answeredCount() {
    var ids = state.order || [];
    var n = 0;
    ids.forEach(function (id) { if (qmap[id] && isAnswered(qmap[id])) n += 1; });
    return n;
  }

  function isAnswered(q) {
    var a = state.answers[q.id];
    if (!a) return false;
    if (q.type === "rank") return a.order && a.order.length === 3;
    if (q.type === "single") return typeof a.index === "number";
    return typeof a.value === "number";
  }

  function profileReady() {
    return !!state.profile.audience && state.profile.years !== null && state.profile.years !== "";
  }

  function source() {
    return ephemeral || state;
  }

  function encode(obj) {
    var json = JSON.stringify(obj);
    try {
      var bytes = new TextEncoder().encode(json);
      var bin = "";
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    } catch (e) {
      return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
  }

  function decode(s) {
    var pad = s.length % 4 === 0 ? "" : "====".slice(0, 4 - (s.length % 4));
    var bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
    try {
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      return JSON.parse(decodeURIComponent(escape(bin)));
    }
  }

  function resultFromScores(scores, contradictions) {
    var clarity = {};
    var weak = 0;
    ["A", "B", "C", "D"].forEach(function (k) {
      clarity[k] = ENGINE.clarityOf(scores[k]);
      if (clarity[k] === "weak") weak += 1;
    });
    return {
      scores: scores,
      code: ENGINE.codeFrom(scores),
      clarity: clarity,
      weak: weak,
      mixed: weak >= 2,
      contradictions: contradictions || 0,
      reliable: (contradictions || 0) < 2,
      near: ENGINE.nearest(scores, 3),
      at: Date.now()
    };
  }

  function pack(s) {
    var r = s.result;
    return { v: 1, n: s.profile.name || "", a: s.profile.audience, y: s.profile.years, s: [r.scores.A, r.scores.B, r.scores.C, r.scores.D], k: r.contradictions };
  }

  function writeHash(payload) {
    if (ui.preview) return;
    history.replaceState(null, "", "#r=" + encode(payload));
  }

  function clearHash() {
    history.replaceState(null, "", location.pathname + location.search);
  }

  function audienceOf(profile) {
    var id = (profile && profile.audience) || "pro";
    for (var i = 0; i < window.BIZ_AUDIENCES.length; i++) {
      if (window.BIZ_AUDIENCES[i].id === id) return window.BIZ_AUDIENCES[i];
    }
    return window.BIZ_AUDIENCES[0];
  }

  function setTitle(arch, mixed) {
    var title = arch ? ((mixed ? "我最接近" : "我是") + arch.name + "｜商业人格") : "你是哪一种商业人格";
    document.title = title;
    var theme = document.querySelector('meta[name="theme-color"]');
    if (theme) theme.setAttribute("content", arch ? "#F7F6FB" : "#FFE4EF");
  }

  var LETTER = { B: "建造", C: "连接", M: "使命", K: "市场", D: "深度", G: "广度", F: "快迭代", S: "慢深耕" };

  function gloss(code) {
    return String(code || "").split("").map(function (ch) {
      return ch + " " + (LETTER[ch] || ch);
    }).join(" · ");
  }

  function neighbor(from, dir) {
    var list = steps();
    var i = from;
    while (true) {
      i += dir;
      if (i < 0 || i >= list.length) return i;
      if (list[i].kind !== "section") return i;
    }
  }

  function firstOpenQuestion() {
    var list = steps();
    var last = 1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].kind === "question") {
        last = i;
        if (!isAnswered(qmap[list[i].id])) return i;
      }
      if (list[i].kind === "computing") last = i;
    }
    return last;
  }

  function axisHeadline(ax, score, clarity) {
    if (clarity === "weak") return "还在两边之间";
    if (score > 50) return ax.high + " " + Math.round(score) + "%";
    return ax.low + " " + Math.round(100 - score) + "%";
  }

  function axisStory(ax, score, clarity) {
    if (clarity === "weak") return ax.midStory;
    return score > 50 ? ax.highStory : ax.lowStory;
  }

  function render(opts) {
    var keep = opts && opts.keepScroll;
    ui.keep = !!keep;
    var scroller = document.scrollingElement || document.documentElement;
    var y = keep ? scroller.scrollTop : 0;
    var inner = document.querySelector(".profile-scroll");
    var innerY = inner ? inner.scrollTop : 0;
    var html = "";
    var src = source();
    if (ephemeral || (state.screen === "result" && state.result)) html = renderResult();
    else if (state.screen === "cover" || !state.screen) html = renderCover();
    else html = renderFlow();
    document.getElementById("app").innerHTML = html;
    if (keep) {
      scroller.scrollTop = y;
      var nextInner = document.querySelector(".profile-scroll");
      if (nextInner) nextInner.scrollTop = innerY;
    } else window.scrollTo(0, 0);
    if (!(ephemeral || (state.screen === "result" && state.result))) setTitle(null);
    else {
      var arch = shownArchetype(src);
      setTitle(arch, src.result.mixed || !src.result.reliable);
    }
  }

  var POLE_LETTER = { A: ["B", "C"], B: ["M", "K"], C: ["D", "G"], D: ["F", "S"] };
  var DIM_NO = ["一", "二", "三", "四"];

  function planCard(form, spec) {
    var same = state.form === form && state.order && !state.result && answeredCount() > 0;
    var label = same ? "继续作答" : (state.result ? "再测一次" : spec.cta);
    var act = same ? "resume" : "start";
    var extra = same ? "" : ' data-form="' + form + '"';
    var note = same ? '<p class="ver-note">上次答到 ' + answeredCount() + ' / ' + state.order.length + '</p>' : "";
    return '<article class="ver ' + spec.kind + '">' +
      '<div class="ver-top"><h3>' + spec.name + (spec.badge ? "<em>" + spec.badge + "</em>" : "") + '</h3><span>' + spec.time + '</span></div>' +
      '<p class="ver-count">' + spec.count + '</p>' +
      '<p>' + spec.desc + '</p>' + note +
      '<button type="button" class="btn ' + spec.btn + '" data-act="' + act + '"' + extra + '>' + label + '</button></article>';
  }

  function renderCover() {
    var saved = state.result ? '<button type="button" class="linkish" data-act="saved">查看上次结果</button>' : "";
    var dims = window.BIZ_AXES.map(function (ax, i) {
      var pair = POLE_LETTER[ax.key];
      return '<p class="axis-kicker">维度' + DIM_NO[i] + ' · ' + esc(ax.name) + '</p>' +
        '<div class="pole"><b><em>' + pair[0] + '</em>' + esc(ax.high) + '</b><p>' + esc(ax.highStory) + '</p></div>' +
        '<div class="pole"><b><em>' + pair[1] + '</em>' + esc(ax.low) + '</b><p>' + esc(ax.lowStory) + '</p></div>';
    }).join("");
    var quick = planCard("30", {
      kind: "quick",
      name: "快速版",
      time: "约 8 分钟",
      count: "30 题",
      desc: "先看清四个字母偏向哪一侧。适合想马上有个答案的人。",
      cta: "开始快速版",
      btn: "pink"
    });
    var full = planCard("60", {
      kind: "full",
      name: "完整版",
      badge: "推荐",
      time: "约 18 分钟",
      count: "60 题",
      desc: "工作、热爱和闪光点都问到。原型和变现方向更稳。",
      cta: "开始完整版",
      btn: ""
    });
    return '<section class="home' + (ui.preview ? "" : " step") + '">' +
      '<div class="hero">' +
        '<div class="hero-copy">' +
          '<p class="brand">商业人格测试</p>' +
          '<h1>你是<br>哪一种？</h1>' +
          '<p class="sub">四个字母，十六种原型。看清你靠什么创造价值。</p>' +
        '</div>' +
        '<img class="cast" src="img/cast.svg" alt="" width="150" height="168">' +
      '</div>' +
      '<div class="home-sheet">' +
        '<h2 class="pick">选择适合你的版本</h2>' +
        quick + full + saved +
        '<section class="intro"><h2>这测的是什么</h2>' +
          '<p>很多人知道自己能干活，却说不清价值从哪一段产生。这份测试把这件事收成四个字母，合成 16 种商业人格中的一种。</p>' +
          '<p>它看三件事：你已经怎么交付，没有考核时你会被什么吸住，以及别人会为什么来找你。靠近中间的轴会标成摇摆。</p></section>' +
        '<section class="intro"><h2>四个维度</h2>' +
          '<p class="intro-lead">每一维都是两侧，没有好坏。结果页上的字母，就是更明显的那一侧。</p>' + dims + '</section>' +
        '<section class="intro"><h2>你会得到</h2><ul class="points">' +
          '<li>一个四字母原型，和一句能拿走用的定位</li>' +
          '<li>四条轴各自更偏向哪一侧</li>' +
          '<li>商业能力、优势、盲区，以及适合的战场</li>' +
          '<li>按你的身份写的变现方向，和接下来两周可以做的三件事</li></ul></section>' +
        '<section class="intro"><h2>作答须知</h2><ul class="points">' +
          '<li>没有标准答案。选更像真实的你的那一项</li>' +
          '<li>排序题按最像、其次、不像来点。程度题凭第一反应</li>' +
          '<li>答到一半可以离开，进度留在这台设备上</li></ul></section>' +
      '</div>' +
      confirmHtml() +
    '</section>';
  }

  function renderFlow() {
    var list = steps();
    var step = list[state.cursor] || list[1];
    if (!step || step.kind === "cover") return renderCover();
    if (step.kind === "profile") return renderProfile();
    if (step.kind === "section") return renderSection(step);
    if (step.kind === "computing") return renderComputing();
    return renderQuestion(step);
  }

  function qChrome(opts) {
    return '<div class="qpage' + (opts.foot ? " has-foot" : "") + (ui.keep ? "" : " step") + '">' +
      '<div class="qnav"><button type="button" data-act="back">' + (opts.back || "上一题") + '</button><span>' + opts.meta + '</span></div>' +
      '<div class="prog"><i style="width:' + opts.progress + '%"></i></div>' +
      (opts.kicker ? '<p class="qdim">' + opts.kicker + '</p>' : '') +
      (opts.intro || "") +
      '<h1 class="q">' + opts.title + '</h1>' +
      (opts.help ? '<p class="qhelp">' + opts.help + '</p>' : '') +
      opts.body + (opts.foot || "") + '</div>';
  }

  function renderProfile() {
    if (ui.profileStep === 1) {
      var years = window.BIZ_YEARS.map(function (item, i) {
        var on = state.profile.years === item.id ? " on" : "";
        return '<button type="button" class="opt' + on + '" data-act="year" data-year="' + item.id + '"><span class="mark">' + "ABCDE"[i] + '</span><span class="otxt">' + esc(item.label) + '</span></button>';
      }).join("");
      return qChrome({
        meta: "2 / 2",
        progress: 16,
        kicker: "开始之前",
        title: "相关实践做了多久？",
        help: "算上工作、项目和认真做过的副业。点一下就进入测试。",
        body: years
      });
    }
    var aud = window.BIZ_AUDIENCES.map(function (item, i) {
      var on = state.profile.audience === item.id ? " on" : "";
      return '<button type="button" class="opt' + on + '" data-act="aud" data-id="' + item.id + '"><span class="mark">' + "ABCDE"[i] + '</span><span class="otxt"><b>' + esc(item.label) + '</b><small>' + esc(item.desc) + '</small></span></button>';
    }).join("");
    return qChrome({
      back: "返回",
      meta: "1 / 2",
      progress: 8,
      kicker: "开始之前",
      title: "你现在更接近哪一种？",
      help: "变现建议会按这个身份来写。点一下就继续。",
      body: aud
    });
  }

  function renderSection(step) {
    var sec = step.section;
    return qChrome({
      meta: answeredCount() + " / " + ((state.order && state.order.length) || 60),
      progress: answeredCount() / ((state.order && state.order.length) || 60) * 100,
      kicker: esc(sec.kicker),
      title: esc(sec.title),
      help: esc(sec.desc),
      body: "",
      foot: '<div class="qfoot"><button type="button" class="btn" data-act="next">继续</button></div>'
    });
  }

  function renderQuestion(step) {
    var q = qmap[step.id];
    var total = state.order.length;
    var pos = state.order.indexOf(q.id) + 1;
    var help = q.type === "rank" ? "按顺序点：最像 → 其次 → 不像。点已选项可以重选。" : (q.type === "single" ? "点一下进入下一题。" : "凭第一反应。点一下进入下一题。");
    var body = q.type === "likert" ? likertHtml(q) : optionsHtml(q);
    var last = pos === total;
    var foot = "";
    if (q.type === "rank") {
      foot = '<div class="qfoot"><button type="button" class="btn" data-act="next"' + (isAnswered(q) ? "" : " disabled") + '>' + (last ? "看结果" : "下一题") + '</button></div>';
    }
    var intro = step.indexInSection === 0 ? '<p class="qsec">' + esc(step.section.desc) + '</p>' : "";
    return qChrome({
      meta: pos + " / " + total,
      progress: pos / total * 100,
      kicker: esc(step.section.kicker + " · " + step.section.title),
      intro: intro,
      title: esc(q.prompt),
      help: help,
      body: body,
      foot: foot
    });
  }

  function optionsHtml(q) {
    var shown = state.display[q.id] || [0, 1, 2];
    var answer = state.answers[q.id] || {};
    return shown.map(function (index, di) {
      var text = q.options[index].text;
      var mark = "ABC"[di];
      var on = "";
      if (q.type === "rank") {
        var order = answer.order || [];
        var at = order.indexOf(index);
        if (at >= 0) { mark = String(at + 1); on = " on"; }
      } else if (answer.index === index) {
        mark = "ABC"[di];
        on = " on";
      }
      return '<button type="button" class="opt' + on + '" data-act="' + q.type + '" data-id="' + q.id + '" data-i="' + index + '"><span class="mark">' + mark + '</span><span class="otxt">' + esc(text) + '</span></button>';
    }).join("");
  }

  function likertHtml(q) {
    var value = state.answers[q.id] && state.answers[q.id].value;
    var buttons = LIKERT.map(function (label, i) {
      var v = i + 1;
      var on = value === v ? " on" : "";
      return '<button type="button" class="' + on + '" data-act="likert" data-id="' + q.id + '" data-v="' + v + '" aria-label="' + label + '">' + v + '</button>';
    }).join("");
    var live = value ? LIKERT[value - 1] : "选择相符的程度";
    return '<p class="live">' + esc(live) + '</p><div class="agree-row">' + buttons + '</div><div class="agree-ends"><span>完全不像</span><span>非常像</span></div>';
  }

  function renderComputing() {
    return '<section class="compute step"><div class="spin"></div><p class="qdim">商业原型</p><h1 id="compute-line">正在分析你的回答</h1><p class="qhelp">匹配 16 种定位，并写出变现方向</p></section>';
  }

  function shownArchetype(src) {
    var code = src.result.code;
    if (src.result.mixed && ui.selectedCode && src.result.near.indexOf(ui.selectedCode) >= 0) code = ui.selectedCode;
    return window.BIZ_ARCHETYPES[code];
  }

  function renderResult() {
    var src = source();
    var result = src.result;
    var profile = src.profile || { audience: "pro", years: 2, name: "" };
    var arch = shownArchetype(src);
    var aud = audienceOf(profile);
    var who = !result.reliable ? "先暂且看成" : (result.mixed ? "你最接近" : "你是");
    if (profile.name) who = esc(profile.name) + "，" + who;
    var banners = "";
    if (ephemeral && ephemeral.demo) banners += '<p class="banner">这是一份示例，用来看结果长什么样，不是你的作答。</p>';
    else if (ephemeral) banners += '<p class="banner calm">这是一份分享出来的结果。</p>';
    if (!result.reliable) banners += '<p class="banner">有两组以上的回答彼此拧着。下面的判断请当草稿，换一个安静的时间重测。</p>';
    else if (result.mixed) banners += '<p class="banner calm">有两条以上的轴靠近中间，单一原型会把你说窄。三张都读一读，看哪段更像你最近三年，而不是理想中的自己。</p>';
    if ((profile.years === 0 || profile.years === 1) && profile.audience !== "newbie") {
      banners += '<p class="banner calm">实践年限还不长。这里的「资产」指已经露出来的倾向，不是攒下的客户和作品。把它当方向。</p>';
    }
    if (!ephemeral && state.form === "30") {
      banners += '<p class="banner calm">这是 30 题快速版，四个字母的方向可以看。想把变现方向看稳一些，可以再做 60 题完整版。</p>';
    }
    var switcher = "";
    if (result.mixed) {
      switcher = '<div class="switch">' + result.near.map(function (code) {
        var item = window.BIZ_ARCHETYPES[code];
        var on = item.code === arch.code ? " on" : "";
        var badge = code === result.code ? "最接近" : "也像";
        return '<button type="button" class="' + on + '" data-act="proto" data-code="' + code + '">' + item.icon + ' ' + esc(item.name) + ' · ' + badge + '<small>' + esc(item.tagline) + '</small></button>';
      }).join("") + '</div>';
    }
    var axes = window.BIZ_AXES.map(function (ax) {
      var score = result.scores[ax.key];
      var clarity = result.clarity[ax.key];
      var weak = clarity === "weak";
      var high = score > 50;
      var lean = weak ? 50 : Math.round(high ? score : 100 - score);
      var win = weak ? "还在两边之间" : (high ? ax.high : ax.low);
      var width = weak ? 0 : (high ? score : 100 - score);
      var bar = weak
        ? "width:10px;margin-left:calc(50% - 5px);background:#D5D1E4"
        : "width:" + width + "%;" + (high ? "margin-left:auto;" : "") + "background:" + arch.accent;
      return '<div class="dim"><div class="dim-top"><b>' + esc(win) + '</b><span>' + (weak ? CLARITY.weak : lean + "% · " + CLARITY[clarity]) + '</span></div>' +
        '<div class="dlabels"><span class="' + (!weak && !high ? "win" : "") + '">' + esc(ax.low) + '</span><span class="' + (!weak && high ? "win" : "") + '">' + esc(ax.high) + '</span></div>' +
        '<div class="dbar"><i style="' + bar + '"></i></div>' +
        '<p>' + esc(axisStory(ax, score, clarity)) + '</p></div>';
    }).join("");
    var caps = arch.capabilities.map(function (c, i) {
      return '<article class="cap"><span class="num">0' + (i + 1) + '</span><h3>' + esc(c.title) + '</h3><p>' + esc(c.desc) + '</p></article>';
    }).join("");
    var points = function (items) {
      return '<ul class="points">' + items.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join("") + '</ul>';
    };
    var money = window.BIZ_TRACKS.map(function (track) {
      var pri = track.id === aud.track;
      return '<article class="money' + (pri ? " pri" : "") + '"><header><span>' + esc(track.label) + '</span>' + (pri ? "<em>优先</em>" : "") + '</header><p>' + esc(arch.monetization[track.id]) + '</p></article>';
    }).join("");
    var actions = '<ol class="steps">' + arch.actions.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join("") + '</ol>';
    var compare = compareHtml(result);
    var foot = ephemeral
      ? '<div class="dock"><button type="button" class="btn" data-act="self">我也测一次</button>' + (state.result ? '<button type="button" class="btn ghost" data-act="saved">看我的结果</button>' : '') + '</div>'
      : '<div class="dock"><button type="button" class="btn ghost" data-act="card">保存海报</button><button type="button" class="btn" data-act="share">分享给朋友</button></div>';
    var namePanel = ephemeral ? "" : '<section class="panel"><h2>海报上的称呼</h2><p class="note">可不填。填写后会出现在分享海报上。</p><input class="field" id="nickname" maxlength="12" placeholder="怎么称呼你" value="' + esc(profile.name || "") + '" autocomplete="off"></section>';
    var extra = ephemeral ? "" : '<button type="button" class="textbtn" data-act="restart">重新测试</button>';
    return '<article class="result">' +
      '<header class="typecard">' +
        '<p class="typekicker">' + who + '</p>' +
        '<p class="typecode" style="color:' + arch.accent + '">' + arch.code + '</p>' +
        '<h1>' + arch.icon + ' ' + esc(arch.name) + '</h1>' +
        '<p class="gloss">' + esc(gloss(arch.code)) + '</p>' +
        '<p class="tagline">' + esc(arch.tagline) + '</p>' +
        '<p class="typequote">' + esc(arch.quote) + '</p>' +
      '</header>' +
      banners + switcher +
      '<section class="panel" id="ability"><h2>四维倾向</h2><p class="note">和人格测试一样，字母只表示你更常靠哪一侧。百分比是题目倾向，不是能力打分。</p>' + axes + '</section>' +
      '<section class="panel"><h2>你怎么创造价值</h2><p class="portrait">' + esc(arch.portrait) + '</p>' + caps +
        '<h3>优势</h3>' + points(arch.strengths) + '</section>' +
      '<section class="panel" id="gap"><h2>盲区</h2><p class="note">先看这些会让变现变慢的地方。</p>' + points(arch.blindspots) +
        '<h3>适合的战场</h3>' + points(arch.scenes) + '</section>' +
      '<section class="panel"><h2>按你的处境</h2><p class="note">' + esc(window.BIZ_AUDIENCE_LEAD[aud.id] || window.BIZ_AUDIENCE_LEAD.pro) + '</p><p class="portrait">' + esc(arch.audience[aud.id]) + '</p></section>' +
      '<section class="panel" id="money"><h2>变现方向</h2><p class="formula"><span>变现公式</span>' + esc(arch.formula) + '</p><p class="note">同一套能力有四种卖法。标了优先的，是按你选的身份建议先看的一条。</p>' + money + '</section>' +
      '<section class="panel" id="next"><h2>接下来两周</h2>' + actions + compare +
        '<p class="disclaimer">结果把连续的倾向分成十六种原型，靠近分界时可能不稳定。这是自我探索，不是招聘测评，也不构成职业决策建议。解读文案由人工智能辅助整理。建议两到四周后重测，看哪些轴是稳定的。作答记录保存在这台设备上。</p>' +
        extra + '</section>' +
      namePanel +
      foot +
      modalHtml() + shareHtml() + confirmHtml() +
    '</article>';
  }

  function compareHtml(result) {
    if (ephemeral || !state.prev) return "";
    var prev = state.prev;
    var days = Math.max(0, Math.round((Date.now() - (prev.at || Date.now())) / 86400000));
    var items = window.BIZ_AXES.map(function (ax) {
      var a = prev.scores[ax.key];
      var b = result.scores[ax.key];
      var nameOf = function (score) { return score > 50 ? ax.high : ax.low; };
      var changed = (a > 50) !== (b > 50);
      var weak = result.clarity[ax.key] === "weak" || (prev.clarity && prev.clarity[ax.key] === "weak");
      var tag = (!changed && !weak) ? "稳定优势" : "探索中";
      var line = changed ? (nameOf(a) + " → " + nameOf(b)) : ("仍偏向" + nameOf(b));
      return '<li><small>' + tag + ' · ' + esc(ax.name) + '</small>' + esc(line) + '</li>';
    }).join("");
    var near = days < 1 ? '<p class="note">两次隔得很近，差别可能只是当天的状态。</p>' : '<p class="note">距上次大约 ' + days + ' 天。没变的轴当成主杠杆，变了的轴先别用来做重大决定。</p>';
    return '<h3>和上次相比</h3>' + near + '<ul class="points compare">' + items + '</ul>';
  }

  function modalHtml() {
    if (!ui.cardOpen) return "";
    return '<div class="mask" data-act="close"><div class="sheet" data-act="stop"><img alt="商业定位分享卡" src="' + ui.cardUrl + '"><p>长按图片保存。微信里再点右上角，可以把链接发给朋友。</p><button class="btn" data-act="close">关闭</button></div></div>';
  }

  function shareHtml() {
    if (!ui.shareOpen) return "";
    return '<div class="mask hint" data-act="close"><div class="hint-box" data-act="stop"><b>点右上角 ···</b><p>发送给朋友，或分享到朋友圈。</p><p class="copybox">' + esc(ui.copied) + '</p><button class="btn" data-act="close">知道了</button></div></div>';
  }

  function confirmHtml() {
    if (!ui.confirmRetake) return "";
    var which = ui.pendingForm === "30" ? "30 题快速版" : "60 题完整版";
    return '<div class="mask" data-act="cancel-retake"><div class="sheet" data-act="stop"><h2>换成' + which + '</h2><p>当前作答会清空。如果已有结果，会留下一份和上次的对比。</p><button type="button" class="btn" data-act="retake-yes">清空并开始</button><button type="button" class="btn ghost" data-act="cancel-retake">取消</button></div></div>';
  }

  function shareCopy(arch, profile, result) {
    var verb = result.mixed || !result.reliable ? "最接近" : "是";
    var who = profile.name ? (profile.name + verb) : ("我" + verb);
    return who + arch.icon + arch.name + "——" + arch.tagline + "。来测测你的商业定位。";
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
    }
    fallbackCopy(text);
    return Promise.resolve();
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }

  function inWeChat() {
    return /MicroMessenger/i.test(navigator.userAgent || "");
  }

  function openShare() {
    var src = source();
    var arch = shownArchetype(src);
    var text = shareCopy(arch, src.profile, src.result);
    var url = location.href;
    copyText(text + " " + url);
    ui.copied = text;
    if (!inWeChat() && navigator.share) {
      navigator.share({ title: document.title, text: text, url: url }).catch(function (err) {
        if (err && err.name === "AbortError") return;
        ui.shareOpen = true;
        render({ keepScroll: true });
      });
      return;
    }
    ui.shareOpen = true;
    render({ keepScroll: true });
  }

  function wrapText(ctx, text, maxW) {
    var chars = Array.from(text);
    var lines = [];
    var line = "";
    for (var i = 0; i < chars.length; i++) {
      var test = line + chars[i];
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = chars[i];
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawCentered(ctx, text, center, y, tracking) {
    var chars = Array.from(text);
    var widths = chars.map(function (c) { return ctx.measureText(c).width; });
    var total = tracking * Math.max(0, chars.length - 1);
    widths.forEach(function (n) { total += n; });
    var x = center - total / 2;
    var prev = ctx.textAlign;
    ctx.textAlign = "left";
    chars.forEach(function (c, i) {
      ctx.fillText(c, x, y);
      x += widths[i] + tracking;
    });
    ctx.textAlign = prev;
  }

  function roundBar(ctx, x, y, w, h) {
    var r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCard() {
    var src = source();
    var result = src.result;
    var arch = shownArchetype(src);
    var profile = src.profile || {};
    var w = 750;
    var h = 1334;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var canvas = document.createElement("canvas");
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    var ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = arch.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = arch.accent;
    ctx.fillRect(0, 0, w, 12);
    var font = "'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(247,244,255,.72)";
    ctx.font = "26px " + font;
    ctx.fillText(profile.name ? profile.name + " 的商业原型" : "我的商业原型", w / 2, 150);
    ctx.fillStyle = "#F7F4FF";
    ctx.font = "800 120px " + font;
    drawCentered(ctx, arch.code, w / 2, 320, 18);
    ctx.font = "700 52px " + font;
    ctx.fillText(arch.icon + "  " + arch.name, w / 2, 400);
    ctx.fillStyle = "rgba(247,244,255,.78)";
    ctx.font = "26px " + font;
    ctx.fillText(gloss(arch.code), w / 2, 456);
    ctx.fillStyle = "#F7F4FF";
    ctx.font = "32px " + font;
    var y = 530;
    wrapText(ctx, arch.tagline, 620).slice(0, 2).forEach(function (line) {
      ctx.fillText(line, w / 2, y);
      y += 48;
    });
    y += 20;
    ctx.fillStyle = "rgba(247,244,255,.88)";
    ctx.font = "30px " + font;
    wrapText(ctx, arch.quote, 600).slice(0, 3).forEach(function (line) {
      ctx.fillText(line, w / 2, y);
      y += 46;
    });
    y = Math.max(y + 36, 760);
    window.BIZ_AXES.forEach(function (ax) {
      var score = result.scores[ax.key];
      var clarity = result.clarity[ax.key];
      var weak = clarity === "weak";
      var high = score > 50;
      var label = axisHeadline(ax, score, clarity);
      ctx.textAlign = "left";
      ctx.fillStyle = "#F7F4FF";
      ctx.font = "26px " + font;
      ctx.fillText(label, 64, y);
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(247,244,255,.6)";
      ctx.font = "22px " + font;
      ctx.fillText(CLARITY[clarity], w - 64, y);
      var barY = y + 18;
      var barW = w - 128;
      ctx.save();
      roundBar(ctx, 64, barY, barW, 14);
      ctx.clip();
      ctx.fillStyle = "rgba(255,255,255,.18)";
      ctx.fillRect(64, barY, barW, 14);
      if (!weak) {
        var pct = high ? score : 100 - score;
        var bw = barW * pct / 100;
        ctx.fillStyle = "#fff";
        ctx.fillRect(high ? 64 + barW - bw : 64, barY, bw, 14);
      }
      ctx.restore();
      ctx.textAlign = "left";
      ctx.fillStyle = !weak && !high ? "#fff" : "rgba(247,244,255,.55)";
      ctx.font = "22px " + font;
      ctx.fillText(ax.low, 64, barY + 40);
      ctx.textAlign = "right";
      ctx.fillStyle = !weak && high ? "#fff" : "rgba(247,244,255,.55)";
      ctx.fillText(ax.high, w - 64, barY + 40);
      y += 108;
    });
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(247,244,255,.55)";
    ctx.font = "22px " + font;
    ctx.fillText("四字母 · 十六种商业原型", w / 2, h - 78);
    ctx.fillText("测测你靠什么变现", w / 2, h - 42);
    ui.cardUrl = canvas.toDataURL("image/png");
    ui.cardOpen = true;
    render({ keepScroll: true });
  }

  function launch(form) {
    state.form = form === "30" ? "30" : "60";
    state.order = null;
    state.display = {};
    state.answers = {};
    state.result = null;
    state.screen = "flow";
    state.cursor = 1;
    ui.profileStep = 0;
    ui.resumeAt = 0;
    ui.confirmRetake = false;
    ui.pendingForm = "";
    ephemeral = null;
    clearHash();
    save();
    render();
  }

  function resume() {
    state.screen = "flow";
    if (!state.order) {
      state.cursor = 1;
      ui.profileStep = state.profile.audience ? 1 : 0;
    } else {
      var list = steps();
      var step = list[state.cursor];
      if (!step || step.kind === "cover" || step.kind === "profile" || step.kind === "section") {
        state.cursor = firstOpenQuestion();
      } else {
        while (list[state.cursor] && list[state.cursor].kind === "section") state.cursor++;
      }
    }
    save();
    render();
    var now = steps()[state.cursor];
    if (now && now.kind === "computing" && !state.result) runComputing();
  }

  function showSaved() {
    if (!state.result) return;
    ephemeral = null;
    ui.selectedCode = state.result.code;
    state.screen = "result";
    writeHash(pack(state));
    save();
    render();
  }

  function goCover() {
    ephemeral = null;
    ui.shareOpen = false;
    ui.cardOpen = false;
    ui.confirmRetake = false;
    state.screen = "cover";
    clearHash();
    save();
    render();
  }

  function startOrder() {
    var pool = {};
    formIds(state.form || "60").forEach(function (id) { pool[id] = 1; });
    var order = [];
    window.BIZ_SECTIONS.forEach(function (sec) {
      var ids = window.BIZ_QUESTIONS.filter(function (q) { return q.section === sec.id && pool[q.id]; }).map(function (q) { return q.id; });
      order = order.concat(shuffle(ids));
    });
    var display = {};
    order.forEach(function (id) {
      var q = qmap[id];
      if (q && q.type !== "likert") display[id] = shuffle([0, 1, 2]);
    });
    state.order = order;
    state.display = display;
    state.answers = {};
    state.result = null;
    state.screen = "flow";
    ui.resumeAt = 0;
    var list = steps();
    state.cursor = 1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].kind === "question") { state.cursor = i; break; }
    }
    save();
    render();
  }

  function goNext() {
    if (ui.timer) { clearTimeout(ui.timer); ui.timer = null; }
    var list = steps();
    var step = list[state.cursor];
    if (!step) return;
    if (step.kind === "profile") {
      if (!profileReady()) return;
      state.profile.name = String(state.profile.name || "").replace(/\s+/g, " ").trim().slice(0, 12);
      if (!state.order) { startOrder(); return; }
      var dest = ui.resumeAt && list[ui.resumeAt] && list[ui.resumeAt].kind === "question" ? ui.resumeAt : firstOpenQuestion();
      ui.resumeAt = 0;
      state.cursor = dest;
      state.screen = "flow";
      save();
      render();
      if (list[dest] && list[dest].kind === "computing") runComputing();
      return;
    }
    if (step.kind === "question" && !isAnswered(qmap[step.id])) return;
    var next = neighbor(state.cursor, 1);
    if (next >= list.length) return;
    state.cursor = next;
    state.screen = "flow";
    save();
    render();
    if (list[next].kind === "computing") runComputing();
  }

  function back() {
    ui.token += 1;
    if (ui.timer) { clearTimeout(ui.timer); ui.timer = null; }
    if (state.screen === "result") { goCover(); return; }
    if (state.cursor === 1 && ui.profileStep === 1) {
      ui.profileStep = 0;
      render();
      return;
    }
    var prev = neighbor(state.cursor, -1);
    if (prev <= 0) {
      state.cursor = 0;
      state.screen = "cover";
      save();
      render();
      return;
    }
    if (steps()[prev].kind === "profile" && steps()[state.cursor] && steps()[state.cursor].kind === "question") {
      ui.profileStep = 1;
      ui.resumeAt = state.cursor;
    }
    state.cursor = prev;
    state.screen = "flow";
    save();
    render();
  }

  function schedule(fromCursor) {
    if (ui.timer) clearTimeout(ui.timer);
    ui.timer = setTimeout(function () {
      ui.timer = null;
      if (state.cursor !== fromCursor) return;
      goNext();
    }, 260);
  }

  function onRank(id, index) {
    var current = state.answers[id] || { order: [] };
    var order = (current.order || []).slice();
    var pos = order.indexOf(index);
    if (pos >= 0) order = order.slice(0, pos);
    else if (order.length < 3) order.push(index);
    state.answers[id] = { order: order };
    save();
    render({ keepScroll: true });
  }

  function onSingle(id, index) {
    var from = state.cursor;
    state.answers[id] = { index: index };
    save();
    render({ keepScroll: true });
    schedule(from);
  }

  function onLikert(id, value) {
    var from = state.cursor;
    state.answers[id] = { value: value };
    save();
    render({ keepScroll: true });
    schedule(from);
  }

  function runComputing() {
    var token = ++ui.token;
    var lines = ["正在分析你的回答", "正在计算四维倾向", "正在生成你的原型"];
    var i = 0;
    var timer = setInterval(function () {
      if (token !== ui.token) { clearInterval(timer); return; }
      i += 1;
      var node = document.getElementById("compute-line");
      if (node && lines[i]) node.textContent = lines[i];
      if (i >= lines.length - 1) clearInterval(timer);
    }, 380);
    setTimeout(function () {
      clearInterval(timer);
      if (token !== ui.token) return;
      var missing = null;
      var list = steps();
      (state.order || []).forEach(function (id) {
        if (!missing && qmap[id] && !isAnswered(qmap[id])) missing = id;
      });
      if (missing) {
        for (var n = 0; n < list.length; n++) {
          if (list[n].kind === "question" && list[n].id === missing) state.cursor = n;
        }
        state.screen = "flow";
        save();
        render();
        return;
      }
      try {
        state.result = ENGINE.scoreAttempt(state.answers, state.order);
        state.result.at = Date.now();
        state.screen = "result";
        ui.selectedCode = state.result.code;
        save();
        writeHash(pack(state));
        render();
      } catch (e) {
        var node = document.getElementById("compute-line");
        if (node) node.textContent = "这卷题还没答完";
      }
    }, 1250);
  }

  function doRetake() {
    var form = ui.pendingForm || state.form || "60";
    if (state.result) {
      state.prev = {
        scores: state.result.scores,
        code: state.result.code,
        clarity: state.result.clarity,
        at: state.result.at || Date.now()
      };
    }
    launch(form);
  }

  function sameResult(a, scores, name) {
    if (!a) return false;
    return a.scores.A === scores.A && a.scores.B === scores.B && a.scores.C === scores.C && a.scores.D === scores.D && (state.profile.name || "") === (name || "");
  }

  function boot() {
    state = load();
    if (state && !state.form) state.form = state.order && state.order.length === 30 ? "30" : (state.order ? "60" : "");
    var hash = location.hash || "";
    if (hash.indexOf("#demo=") === 0) {
      var code = hash.slice(6, 10);
      if (window.BIZ_ARCHETYPES[code]) {
        var map = { B: 82, C: 18, M: 80, K: 20, D: 84, G: 16, F: 78, S: 22 };
        ephemeral = {
          demo: true,
          profile: { name: "", audience: "pro", years: 3 },
          result: resultFromScores({ A: map[code[0]], B: map[code[1]], C: map[code[2]], D: map[code[3]] }, 0)
        };
        ui.selectedCode = code;
      }
    } else if (hash.indexOf("#preview=") === 0) {
      ui.preview = true;
      state = blank();
      state.profile = { audience: "pro", years: 3, name: "" };
      state.order = window.BIZ_QUESTIONS.map(function (q) { return q.id; });
      state.display = {};
      window.BIZ_QUESTIONS.forEach(function (q) {
        if (q.type !== "likert") state.display[q.id] = [0, 1, 2];
      });
      var kind = hash.slice(9);
      state.screen = "flow";
      if (kind === "profile") state.cursor = 1;
      else if (kind === "section") state.cursor = firstOpenQuestion();
      else {
        var found = null;
        window.BIZ_QUESTIONS.forEach(function (q) { if (!found && q.type === kind) found = q; });
        var list = steps();
        state.cursor = 3;
        for (var i = 0; i < list.length; i++) {
          if (list[i].kind === "question" && list[i].id === found.id) state.cursor = i;
        }
      }
    } else if (hash.indexOf("#r=") === 0) {
      try {
        var payload = decode(hash.slice(3));
        var scores = { A: payload.s[0], B: payload.s[1], C: payload.s[2], D: payload.s[3] };
        if (!sameResult(state.result, scores, payload.n)) {
          ephemeral = {
            demo: false,
            profile: { name: payload.n || "", audience: payload.a || "pro", years: payload.y },
            result: resultFromScores(scores, payload.k || 0)
          };
          ui.selectedCode = ephemeral.result.code;
        } else {
          state.screen = "result";
          ui.selectedCode = state.result.code;
        }
      } catch (e) {}
    }
    if (!ephemeral && state.screen === "result" && state.result && hash.indexOf("#r=") !== 0 && hash.indexOf("#preview=") !== 0) {
      writeHash(pack(state));
    }
    if (!ephemeral && state.screen === "flow" && hash.indexOf("#preview=") !== 0) {
      var listBoot = steps();
      while (listBoot[state.cursor] && listBoot[state.cursor].kind === "section") state.cursor++;
      if (listBoot[state.cursor] && listBoot[state.cursor].kind === "profile" && state.profile && state.profile.audience) ui.profileStep = 1;
    }
    render();
    if (!ephemeral && state.screen === "flow") {
      var step = steps()[state.cursor];
      if (step && step.kind === "computing" && !state.result) runComputing();
    }
    if (ephemeral && hash.indexOf("card=1") >= 0) drawCard();
  }

  document.getElementById("app").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var act = btn.getAttribute("data-act");
    if (act === "stop") { e.stopPropagation(); return; }
    if (act === "begin") return launch("60");
    if (act === "start") {
      var form = btn.getAttribute("data-form") === "30" ? "30" : "60";
      var same = state.form === form && state.order && !state.result && answeredCount() > 0;
      if (same) return resume();
      var dirty = (state.order && answeredCount() > 0) || !!state.result;
      if (dirty) {
        ui.pendingForm = form;
        ui.confirmRetake = true;
        return render({ keepScroll: true });
      }
      return launch(form);
    }
    if (act === "resume") return resume();
    if (act === "saved") return showSaved();
    if (act === "self") return goCover();
    if (act === "back") return back();
    if (act === "next") return goNext();
    if (act === "aud") {
      state.profile.audience = btn.getAttribute("data-id");
      save();
      render({ keepScroll: true });
      var fromAud = state.cursor;
      if (ui.timer) clearTimeout(ui.timer);
      ui.timer = setTimeout(function () {
        ui.timer = null;
        if (state.cursor !== fromAud || state.screen !== "flow") return;
        ui.profileStep = 1;
        render();
      }, 220);
      return;
    }
    if (act === "year") {
      state.profile.years = Number(btn.getAttribute("data-year"));
      save();
      render({ keepScroll: true });
      var fromYear = state.cursor;
      if (ui.timer) clearTimeout(ui.timer);
      ui.timer = setTimeout(function () {
        ui.timer = null;
        if (state.cursor !== fromYear || state.screen !== "flow") return;
        goNext();
      }, 220);
      return;
    }
    if (act === "rank") return onRank(btn.getAttribute("data-id"), Number(btn.getAttribute("data-i")));
    if (act === "single") return onSingle(btn.getAttribute("data-id"), Number(btn.getAttribute("data-i")));
    if (act === "likert") return onLikert(btn.getAttribute("data-id"), Number(btn.getAttribute("data-v")));
    if (act === "proto") {
      ui.selectedCode = btn.getAttribute("data-code");
      return render({ keepScroll: true });
    }
    if (act === "share") return openShare();
    if (act === "card") {
      try { drawCard(); } catch (err) { ui.shareOpen = true; ui.copied = "图片生成失败，请直接截图这一页。"; render({ keepScroll: true }); }
      return;
    }
    if (act === "close" || act === "cancel-retake") {
      ui.shareOpen = false;
      ui.cardOpen = false;
      ui.confirmRetake = false;
      ui.pendingForm = "";
      return render({ keepScroll: true });
    }
    if (act === "restart") {
      ui.pendingForm = state.form || "60";
      ui.confirmRetake = true;
      return render({ keepScroll: true });
    }
    if (act === "retake-yes") return doRetake();
  });

  document.getElementById("app").addEventListener("input", function (e) {
    if (e.target.id !== "nickname") return;
    state.profile.name = e.target.value.slice(0, 12);
    save();
  });

  window.addEventListener("hashchange", function () {
    if (ui.timer) { clearTimeout(ui.timer); ui.timer = null; }
    ui.token += 1;
    ui.shareOpen = false;
    ui.cardOpen = false;
    ui.confirmRetake = false;
    ui.preview = false;
    boot();
  });

  boot();
})();
