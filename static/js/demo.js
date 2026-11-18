/*
 * Frame-level prediction timeline under the demo video.
 *
 * Reads the JSON file named in the container's data-predictions attribute.
 * Two input formats are accepted (see README.md):
 *   1. "scores": per-class frame scores in [0, 1] with "frame_hop" seconds per frame;
 *      frames with score >= thresholds[class] (default 0.5) become active segments.
 *   2. "segments": per-class lists of [start, end] in seconds.
 */
(function () {
  "use strict";

  var CLASSES = ["speech", "vocals", "instruments", "sound"];
  var DEFAULT_THRESHOLD = 0.5;
  var FRAME_HOP = 0.1;      // seconds per cell in the frame-level view
  var FRAME_TOP = 3;        // canvas padding above the first row, matches .frames-labels
  var INACTIVE = "#e8eaed";

  function scoresToSegments(scores, hop, threshold) {
    var segs = [];
    var start = null;
    for (var i = 0; i < scores.length; i++) {
      var on = scores[i] >= threshold;
      if (on && start === null) start = i * hop;
      if (!on && start !== null) {
        segs.push([start, i * hop]);
        start = null;
      }
    }
    if (start !== null) segs.push([start, scores.length * hop]);
    return segs;
  }

  function normalize(doc) {
    var out = { duration: Number(doc.duration) || 0, segments: {}, scores: null, hop: null };
    var hop = Number(doc.frame_hop);
    if (doc.scores && hop > 0) {
      out.scores = {};
      out.hop = hop;
    }
    CLASSES.forEach(function (c) {
      if (doc.segments && Array.isArray(doc.segments[c])) {
        out.segments[c] = doc.segments[c].map(function (s) { return [Number(s[0]), Number(s[1])]; });
      } else if (out.scores && Array.isArray(doc.scores[c])) {
        var thr = doc.thresholds && doc.thresholds[c] != null ? Number(doc.thresholds[c]) : DEFAULT_THRESHOLD;
        out.segments[c] = scoresToSegments(doc.scores[c], hop, thr);
      } else {
        out.segments[c] = [];
      }
      if (out.scores && Array.isArray(doc.scores[c])) out.scores[c] = doc.scores[c];
    });
    if (!out.duration) {
      CLASSES.forEach(function (c) {
        out.segments[c].forEach(function (s) { out.duration = Math.max(out.duration, s[1]); });
        if (out.scores && out.scores[c]) out.duration = Math.max(out.duration, out.scores[c].length * hop);
      });
    }
    return out;
  }

  function fmtTime(t) {
    var m = Math.floor(t / 60);
    var s = Math.floor(t % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function niceStep(duration, maxTicks) {
    var steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    for (var i = 0; i < steps.length; i++) {
      if (duration / steps[i] <= maxTicks) return steps[i];
    }
    return steps[steps.length - 1];
  }

  function DemoTimeline(root) {
    this.root = root;
    this.video = document.getElementById(root.getAttribute("data-video"));
    this.tracksCol = root.querySelector(".timeline-tracks-col");
    this.axis = root.querySelector(".axis-track");
    this.playhead = root.querySelector(".demo-playhead");
    this.status = root.querySelector(".demo-status");
    this.chips = {};
    this.lanes = {};
    var self = this;
    CLASSES.forEach(function (c) {
      self.chips[c] = root.querySelector('.demo-chip[data-class="' + c + '"]');
      self.lanes[c] = root.querySelector('.lane-track[data-class="' + c + '"]');
    });
    this.framesCanvas = root.querySelector(".frames-canvas");
    this.framesBox = root.querySelector(".demo-frames");
    this.data = null;
    this.raf = null;
  }

  DemoTimeline.prototype.measureFrames = function () {
    if (!this.framesCanvas) return;
    var label = this.root.querySelector(".frames-label");
    var gap = parseFloat(getComputedStyle(this.framesBox).getPropertyValue("--cell-gap"));
    var rootStyle = getComputedStyle(document.documentElement);
    this.frameGeom = {
      cell: label ? label.offsetHeight : 20,
      gap: isFinite(gap) ? gap : 4,
      colors: CLASSES.map(function (c) { return rootStyle.getPropertyValue("--c-" + c).trim() || "#888"; })
    };
  };

  DemoTimeline.prototype.drawFrames = function (t) {
    var cv = this.framesCanvas;
    if (!cv || !this.data || !this.frameGeom) return;
    var w = cv.clientWidth;
    var h = cv.clientHeight;
    if (!w || !h) return;
    var dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var g = this.frameGeom;
    var cell = g.cell;
    var pitch = cell + Math.max(2, g.gap - 1);
    var rowsH = 4 * cell + 3 * g.gap;
    var cx = w / 2;
    var dur = this.duration();
    var cur = Math.floor(t / FRAME_HOP);
    var half = Math.ceil(cx / pitch) + 1;
    var segs = this.data.segments;
    var hasRound = typeof ctx.roundRect === "function";

    ctx.font = "11px 'Noto Sans', sans-serif";
    ctx.textBaseline = "top";
    for (var k = cur - half; k <= cur + half; k++) {
      var t0 = k * FRAME_HOP;
      if (k < 0 || t0 >= dur) continue;
      var x = cx + (t0 - t) / FRAME_HOP * pitch;
      var d = Math.abs(x + cell / 2 - cx) / cx;
      ctx.globalAlpha = d > 0.7 ? Math.max(0, (1 - d) / 0.3) : 1;
      var mid = t0 + FRAME_HOP / 2;
      for (var r = 0; r < 4; r++) {
        var list = segs[CLASSES[r]];
        var on = false;
        for (var i = 0; i < list.length; i++) {
          if (mid >= list[i][0] && mid < list[i][1]) { on = true; break; }
        }
        ctx.fillStyle = on ? g.colors[r] : INACTIVE;
        var y = FRAME_TOP + r * (cell + g.gap);
        if (hasRound) {
          ctx.beginPath();
          ctx.roundRect(x, y, cell, cell, 3);
          ctx.fill();
        } else {
          ctx.fillRect(x, y, cell, cell);
        }
      }
      if (k % Math.round(1 / FRAME_HOP) === 0) {
        ctx.fillStyle = "#6b7280";
        ctx.fillRect(x, FRAME_TOP + rowsH + 3, 1, 4);
        ctx.fillText(fmtTime(t0), x + 3, FRAME_TOP + rowsH + 3);
      }
    }
    ctx.globalAlpha = 1;

    // current frame
    var xc = cx + (cur * FRAME_HOP - t) / FRAME_HOP * pitch;
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;
    if (hasRound) {
      ctx.beginPath();
      ctx.roundRect(xc - 2.5, FRAME_TOP - 2.5, cell + 5, rowsH + 5, 4);
      ctx.stroke();
    } else {
      ctx.strokeRect(xc - 2.5, FRAME_TOP - 2.5, cell + 5, rowsH + 5);
    }
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#111827";
    ctx.fillRect(cx - 0.75, 0, 1.5, FRAME_TOP + rowsH + 3);
    ctx.globalAlpha = 1;
  };

  DemoTimeline.prototype.duration = function () {
    var v = this.video && isFinite(this.video.duration) && this.video.duration > 0 ? this.video.duration : 0;
    return v || (this.data ? this.data.duration : 0) || 1;
  };

  DemoTimeline.prototype.render = function () {
    var self = this;
    var dur = this.duration();
    CLASSES.forEach(function (c) {
      var lane = self.lanes[c];
      if (!lane) return;
      lane.innerHTML = "";
      if (self.data.scores && self.data.scores[c]) lane.insertAdjacentHTML("beforeend", self.scoreCurve(self.data.scores[c], c, dur));
      self.data.segments[c].forEach(function (s) {
        var a = Math.max(0, Math.min(s[0], dur));
        var b = Math.max(a, Math.min(s[1], dur));
        var el = document.createElement("div");
        el.className = "lane-seg bg-" + c;
        el.style.left = (100 * a / dur) + "%";
        el.style.width = (100 * (b - a) / dur) + "%";
        el.title = c + ": " + a.toFixed(2) + "\u2013" + b.toFixed(2) + " s";
        lane.appendChild(el);
      });
    });
    this.renderAxis();
    this.measureFrames();
    this.update();
  };

  DemoTimeline.prototype.scoreCurve = function (scores, c, dur) {
    var hop = this.data.hop;
    var d = "M0 1";
    for (var i = 0; i < scores.length; i++) {
      var t = (i + 0.5) * hop;
      if (t > dur) break;
      d += " L" + t.toFixed(3) + " " + (1 - Math.max(0, Math.min(1, Number(scores[i]) || 0))).toFixed(3);
    }
    d += " L" + Math.min(scores.length * hop, dur).toFixed(3) + " 1 Z";
    return '<svg class="lane-score" viewBox="0 0 ' + dur + ' 1" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="' + d + '" fill="var(--c-' + c + ')" fill-opacity="0.22"></path></svg>';
  };

  DemoTimeline.prototype.renderAxis = function () {
    var dur = this.duration();
    var width = this.axis.clientWidth || 300;
    var step = niceStep(dur, Math.max(2, Math.floor(width / 55)));
    this.axis.innerHTML = "";
    for (var t = 0; t <= dur + 1e-6; t += step) {
      var tick = document.createElement("span");
      tick.className = "axis-tick" + (t === 0 ? " is-first" : "") + (dur - t < 1e-6 ? " is-last" : "");
      tick.style.left = (100 * t / dur) + "%";
      tick.textContent = fmtTime(t);
      this.axis.appendChild(tick);
    }
  };

  DemoTimeline.prototype.update = function () {
    if (!this.data) return;
    var dur = this.duration();
    var t = this.video ? this.video.currentTime : 0;
    this.playhead.style.left = (100 * Math.min(t, dur) / dur) + "%";
    var self = this;
    CLASSES.forEach(function (c) {
      var active = self.data.segments[c].some(function (s) { return t >= s[0] && t < s[1]; });
      if (self.chips[c]) self.chips[c].classList.toggle("is-active", active);
    });
    this.drawFrames(t);
  };

  DemoTimeline.prototype.loop = function () {
    var self = this;
    this.update();
    if (this.video && !this.video.paused && !this.video.ended) {
      this.raf = window.requestAnimationFrame(function () { self.loop(); });
    } else {
      this.raf = null;
    }
  };

  DemoTimeline.prototype.seekFromEvent = function (ev) {
    var rect = this.tracksCol.getBoundingClientRect();
    var frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    var target = frac * this.duration();
    if (this.blobLoading) this.pendingSeek = target;
    if (this.video) {
      try { this.video.currentTime = target; } catch (e) { /* not seekable yet */ }
    }
    this.update();
  };

  function pickSource(v) {
    var sources = v.querySelectorAll("source");
    for (var i = 0; i < sources.length; i++) {
      var type = sources[i].getAttribute("type");
      if (!type || v.canPlayType(type)) return sources[i].src;
    }
    return v.currentSrc || v.src;
  }

  // The <video> starts with preload="none". Servers without byte-range support
  // (e.g. Python's built-in server) leave the video unseekable in Chromium, so the
  // range probe below decides how to load it: a 206 reply means normal streaming;
  // a 200 reply already carries the whole file, which is then played from a blob.
  DemoTimeline.prototype.prepareVideo = function () {
    var v = this.video;
    var self = this;
    var src = pickSource(v);
    if (!src || src.indexOf("blob:") === 0) return;
    var useStreaming = function () {
      v.preload = "metadata";
      v.load();
    };
    fetch(src, { headers: { Range: "bytes=0-1" } })
      .then(function (r) {
        if (r.status === 206) {
          if (r.body && r.body.cancel) r.body.cancel();
          useStreaming();
          return;
        }
        if (!r.ok) throw new Error("status " + r.status);
        self.blobLoading = true;
        self.pendingSeek = null;
        self.status.textContent = "Loading the video\u2026";
        var holdPlay = function () {
          v.pause();
          self.playAfterLoad = true;
        };
        v.addEventListener("play", holdPlay);
        return r.blob().then(function (blob) {
          v.removeEventListener("play", holdPlay);
          v.src = URL.createObjectURL(blob);
          v.addEventListener("loadedmetadata", function restore() {
            v.removeEventListener("loadedmetadata", restore);
            self.blobLoading = false;
            self.status.textContent = "";
            if (self.pendingSeek != null) v.currentTime = self.pendingSeek;
            if (self.playAfterLoad) v.play().catch(function () {});
          });
        });
      })
      .catch(function () {
        self.blobLoading = false;
        self.status.textContent = "";
        useStreaming();
      });
  };

  DemoTimeline.prototype.bind = function () {
    var self = this;
    var v = this.video;
    if (v) {
      v.addEventListener("play", function () { if (!self.raf) self.loop(); });
      ["timeupdate", "seeking", "seeked", "pause", "ended"].forEach(function (e) {
        v.addEventListener(e, function () { self.update(); });
      });
      v.addEventListener("loadedmetadata", function () { self.render(); });
      this.prepareVideo();
    }
    var dragging = false;
    this.tracksCol.addEventListener("pointerdown", function (ev) {
      dragging = true;
      if (self.tracksCol.setPointerCapture) self.tracksCol.setPointerCapture(ev.pointerId);
      self.seekFromEvent(ev);
    });
    this.tracksCol.addEventListener("pointermove", function (ev) { if (dragging) self.seekFromEvent(ev); });
    ["pointerup", "pointercancel"].forEach(function (e) {
      self.tracksCol.addEventListener(e, function () { dragging = false; });
    });
    var resizeTimer = null;
    window.addEventListener("resize", function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        self.renderAxis();
        self.measureFrames();
        self.update();
      }, 120);
    });
  };

  DemoTimeline.prototype.load = function () {
    var self = this;
    var url = this.root.getAttribute("data-predictions");
    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error("status " + r.status);
        return r.json();
      })
      .then(function (doc) {
        self.data = normalize(doc);
        if (doc.placeholder) {
          self.status.textContent = "Showing synthetic placeholder predictions (not model output).";
        }
        self.bind();
        self.render();
      })
      .catch(function () {
        self.status.textContent = "Prediction data could not be loaded. Serve this folder with a local web server (see README.md).";
      });
  };

  document.addEventListener("DOMContentLoaded", function () {
    var roots = document.querySelectorAll(".demo-player[data-predictions]");
    Array.prototype.forEach.call(roots, function (root) { new DemoTimeline(root).load(); });
  });
})();
