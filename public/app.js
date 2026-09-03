/* Hawk - mood-first streaming picker. No dependencies. */
(function () {
  "use strict";

  if (window.parent !== window) {
    window.parent.postMessage({ type: "GUEST_READY", stCommVersion: 1 }, "*");
  }

  var MOODS = [
    { id: "cozy", name: "Cozy", note: "Warm, low stakes" },
    { id: "thrilling", name: "Thrilling", note: "Tension and pace" },
    { id: "mindbending", name: "Mindbending", note: "Puzzles and twists" },
    { id: "laugh", name: "Laugh", note: "Comedy first" },
    { id: "cry", name: "Cry", note: "Emotional weight" },
    { id: "spooky", name: "Spooky", note: "Dread and horror" },
    { id: "romantic", name: "Romantic", note: "Love at the center" },
    { id: "epic", name: "Epic", note: "Scale and spectacle" }
  ];

  var TYPES = [
    { id: "movie", name: "Movie", note: "One sitting" },
    { id: "tv", name: "TV", note: "Series" }
  ];

  var TIMES = [
    { id: "quick", name: "Quick", note: "Under 100 min" },
    { id: "standard", name: "Standard", note: "Around 2 hours" },
    { id: "epic", name: "Epic", note: "Settle in" }
  ];

  var state = {
    mood: "cozy",
    type: "movie",
    time: "standard",
    item: null,
    loading: false,
    playToken: 0
  };

  var $ = function (id) { return document.getElementById(id); };

  var stage = $("stage");
  var stageEmpty = $("stage-empty");
  var pickBtn = $("pick-btn");
  var hint = $("picker-hint");
  var sourcesPanel = $("sources-panel");
  var sourcesBody = $("sources-body");
  var playerPanel = $("player-panel");
  var playerBody = $("player-body");

  /* ---------- DOM helpers (text only, never HTML) ---------- */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function setOnly(node, child) {
    clear(node);
    if (child) node.appendChild(child);
  }

  /* ---------- option controls ---------- */

  function buildOptions(container, groupName, options, selected, onChange) {
    var frag = document.createDocumentFragment();
    options.forEach(function (opt) {
      var label = el("label", "opt");
      var input = document.createElement("input");
      input.type = "radio";
      input.name = groupName;
      input.value = opt.id;
      input.checked = opt.id === selected;
      input.addEventListener("change", function () {
        if (input.checked) onChange(opt.id);
      });

      var body = el("span", "opt-body");
      body.appendChild(el("span", "opt-name", opt.name));
      if (opt.note) body.appendChild(el("span", "opt-note", opt.note));

      label.appendChild(input);
      label.appendChild(body);
      frag.appendChild(label);
    });
    setOnly(container, null);
    container.appendChild(frag);
  }

  buildOptions($("mood-grid"), "mood", MOODS, state.mood, function (v) {
    state.mood = v;
  });
  buildOptions($("type-seg"), "type", TYPES, state.type, function (v) {
    state.type = v;
  });
  buildOptions($("time-seg"), "time", TIMES, state.time, function (v) {
    state.time = v;
  });

  /* ---------- fetch ---------- */

  function request(url, options) {
    return fetch(url, options).then(function (res) {
      return res.text().then(function (raw) {
        var data = null;
        if (raw) {
          try { data = JSON.parse(raw); } catch (e) { data = null; }
        }
        if (!res.ok) {
          var msg = (data && (data.error || data.message)) ||
            (raw ? raw.slice(0, 200) : "");
          throw new Error(
            "Request failed (" + res.status + ")" + (msg ? ": " + msg : "")
          );
        }
        if (data === null && raw) throw new Error("Unexpected response format.");
        return data;
      });
    }, function () {
      throw new Error("Network unreachable. Check your connection and retry.");
    });
  }

  function errorBlock(title, detail, retry) {
    var box = el("div", "error");
    box.setAttribute("role", "alert");
    var text = el("div", "error-text");
    text.appendChild(el("div", "error-title", title));
    if (detail) text.appendChild(el("div", "error-detail", detail));
    box.appendChild(text);
    if (retry) {
      var btn = el("button", "btn btn-sm", "Retry");
      btn.type = "button";
      btn.addEventListener("click", retry);
      box.appendChild(btn);
    }
    return box;
  }

  function statusBlock(text) {
    var row = el("div", "status");
    row.appendChild(el("span", "spinner"));
    row.appendChild(el("span", null, text));
    return row;
  }

  /* ---------- normalizing ---------- */

  function pickItem(data) {
    if (!data) return null;
    if (Array.isArray(data)) return data[0] || null;
    if (Array.isArray(data.results)) return data.results[0] || null;
    if (data.result) return data.result;
    if (data.title || data.name) return data;
    return null;
  }

  function pickList(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.sources)) return data.sources;
    if (Array.isArray(data.results)) return data.results;
    return [];
  }

  function titleOf(item) {
    return item.title || item.name || item.original_title || "Untitled";
  }

  function yearOf(item) {
    var d = item.year || item.release_date || item.first_air_date || "";
    var m = String(d).match(/\d{4}/);
    return m ? m[0] : "";
  }

  function runtimeOf(item) {
    var mins = item.runtime;
    if (Array.isArray(item.episode_run_time)) mins = item.episode_run_time[0];
    mins = Number(mins);
    if (!mins || mins < 1) return "";
    var h = Math.floor(mins / 60);
    var m = Math.round(mins % 60);
    var parts = [];
    if (h) parts.push(h + "h");
    if (m || !h) parts.push(m + "m");
    return parts.join(" ");
  }

  function genresOf(item) {
    var g = item.genres || item.genre || [];
    if (typeof g === "string") g = g.split(",");
    if (!Array.isArray(g)) return [];
    return g
      .map(function (x) {
        return typeof x === "string" ? x.trim() : x && x.name ? x.name : "";
      })
      .filter(Boolean)
      .slice(0, 3);
  }

  function ratingOf(item) {
    var r = Number(item.rating !== undefined ? item.rating : item.vote_average);
    if (!isFinite(r) || r <= 0) return "";
    return r.toFixed(1);
  }

  function imageOf(item, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = item[keys[i]];
      if (typeof v === "string" && v) {
        if (/^https?:\/\//.test(v) || v.charAt(0) === "/") {
          return /^\/[a-zA-Z0-9]{10,}\.(jpg|png|webp)$/.test(v)
            ? "https://image.tmdb.org/t/p/w780" + v
            : v;
        }
      }
    }
    return "";
  }

  /* ---------- recommendation ---------- */

  function skeleton() {
    var box = el("div", "skeleton");
    box.appendChild(el("div", "sk sk-backdrop"));
    ["w1", "w2", "w3", "w4"].forEach(function (w) {
      box.appendChild(el("div", "sk sk-line " + w));
    });
    return box;
  }

  function loadRecommendation() {
    if (state.loading) return;
    state.loading = true;
    pickBtn.disabled = true;
    stage.setAttribute("aria-busy", "true");
    hint.textContent = "";
    if (stageEmpty && stageEmpty.parentNode) stageEmpty.remove();
    setOnly(stage, skeleton());
    resetDownstream();

    var url =
      "api/recommend?mood=" + encodeURIComponent(state.mood) +
      "&type=" + encodeURIComponent(state.type) +
      "&time=" + encodeURIComponent(state.time);

    request(url)
      .then(function (data) {
        var item = pickItem(data);
        if (!item) {
          setOnly(
            stage,
            errorBlock(
              "No match",
              "Nothing came back for that combination. Try another mood or length.",
              loadRecommendation
            )
          );
          return;
        }
        state.item = item;
        setOnly(stage, renderCard(item));
      })
      .catch(function (err) {
        setOnly(
          stage,
          errorBlock("Could not get a recommendation", err.message, loadRecommendation)
        );
      })
      .then(function () {
        state.loading = false;
        pickBtn.disabled = false;
        stage.setAttribute("aria-busy", "false");
      });
  }

  function renderCard(item) {
    var card = el("article", "card");

    var backdrop = imageOf(item, ["backdrop", "backdropUrl", "backdrop_url", "backdrop_path"]);
    var poster = imageOf(item, ["poster", "posterUrl", "poster_url", "poster_path"]);

    var bd = el("div", "card-backdrop");
    if (backdrop) {
      var bimg = document.createElement("img");
      bimg.src = backdrop;
      bimg.alt = "";
      bimg.loading = "lazy";
      bimg.addEventListener("error", function () { bimg.remove(); });
      bd.appendChild(bimg);
    }
    card.appendChild(bd);

    var body = el("div", "card-body" + (poster ? "" : " no-poster"));
    if (poster) {
      var pimg = document.createElement("img");
      pimg.className = "poster";
      pimg.src = poster;
      pimg.alt = "Poster for " + titleOf(item);
      pimg.addEventListener("error", function () {
        pimg.remove();
        body.className = "card-body no-poster";
      });
      body.appendChild(pimg);
    }

    var main = el("div", "card-main");

    var h = el("h2", "card-title");
    h.appendChild(document.createTextNode(titleOf(item)));
    var year = yearOf(item);
    if (year) {
      h.appendChild(document.createTextNode(" "));
      h.appendChild(el("span", "card-year", "(" + year + ")"));
    }
    main.appendChild(h);

    var meta = el("div", "meta");
    var rating = ratingOf(item);
    if (rating) meta.appendChild(el("span", "chip chip-rating", rating + " / 10"));
    var rt = runtimeOf(item);
    if (rt) meta.appendChild(el("span", "chip", rt));
    meta.appendChild(el("span", "chip", state.type === "tv" ? "TV" : "Movie"));
    genresOf(item).forEach(function (g) {
      meta.appendChild(el("span", "chip", g));
    });
    if (meta.childNodes.length) main.appendChild(meta);

    var overview = item.overview || item.description || item.summary;
    if (overview) main.appendChild(el("p", "overview", overview));

    var actions = el("div", "card-actions");

    var again = el("button", "btn", "Another one");
    again.type = "button";
    again.addEventListener("click", loadRecommendation);
    actions.appendChild(again);

    var find = el("button", "btn btn-primary", "Find a stream");
    find.type = "button";
    find.addEventListener("click", function () {
      loadSources(titleOf(item));
    });
    actions.appendChild(find);

    main.appendChild(actions);
    body.appendChild(main);
    card.appendChild(body);
    return card;
  }

  /* ---------- sources ---------- */

  function resetDownstream() {
    state.playToken++;
    sourcesPanel.hidden = true;
    clear(sourcesBody);
    stopPlayer();
  }

  function stopPlayer() {
    var v = playerBody.querySelector("video");
    if (v) {
      v.pause();
      v.removeAttribute("src");
      v.load();
    }
    playerPanel.hidden = true;
    clear(playerBody);
  }

  function loadSources(title) {
    sourcesPanel.hidden = false;
    sourcesBody.setAttribute("aria-busy", "true");
    setOnly(sourcesBody, statusBlock("Searching for streams..."));
    sourcesPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });

    request("api/sources?title=" + encodeURIComponent(title))
      .then(function (data) {
        var list = pickList(data).filter(function (s) {
          return s && (s.magnet || s.magnetLink || s.magnet_uri);
        });
        if (!list.length) {
          setOnly(
            sourcesBody,
            errorBlock(
              "No streams found",
              "Nothing playable for " + title + " right now.",
              function () { loadSources(title); }
            )
          );
          return;
        }
        setOnly(sourcesBody, renderSources(list));
      })
      .catch(function (err) {
        setOnly(
          sourcesBody,
          errorBlock("Stream search failed", err.message, function () {
            loadSources(title);
          })
        );
      })
      .then(function () {
        sourcesBody.removeAttribute("aria-busy");
      });
  }

  function renderSources(list) {
    var ul = el("ul", "source-list");
    ul.setAttribute("role", "list");
    list.slice(0, 12).forEach(function (s) {
      var magnet = s.magnet || s.magnetLink || s.magnet_uri;
      var name = s.name || s.title || s.filename || "Unnamed source";
      var seeds = Number(s.seeds !== undefined ? s.seeds : s.seeders);
      var li = el("li", "source");

      var info = el("div", null);
      info.appendChild(el("div", "source-name", name));
      var meta = el("div", "source-meta");
      if (s.size) meta.appendChild(el("span", null, String(s.size)));
      if (isFinite(seeds) && seeds >= 0) {
        meta.appendChild(
          el("span", "seeds" + (seeds < 5 ? " low" : ""), seeds + " seeds")
        );
      }
      if (s.source || s.provider) {
        meta.appendChild(el("span", null, String(s.source || s.provider)));
      }
      if (meta.childNodes.length) info.appendChild(meta);
      li.appendChild(info);

      var watch = el("button", "btn btn-primary btn-sm", "Watch");
      watch.type = "button";
      watch.addEventListener("click", function () {
        Array.prototype.forEach.call(
          ul.querySelectorAll("button"),
          function (b) { b.disabled = true; }
        );
        startStream(magnet, name, function () {
          Array.prototype.forEach.call(
            ul.querySelectorAll("button"),
            function (b) { b.disabled = false; }
          );
        });
      });
      li.appendChild(watch);
      ul.appendChild(li);
    });
    return ul;
  }

  /* ---------- playback ---------- */

  function startStream(magnet, name, done) {
    var token = ++state.playToken;
    playerPanel.hidden = false;
    setOnly(playerBody, statusBlock("Adding source..."));
    playerPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });

    function fail(title, detail) {
      if (token !== state.playToken) return;
      setOnly(
        playerBody,
        errorBlock(title, detail, function () {
          startStream(magnet, name, done);
        })
      );
      if (done) done();
    }

    request("api/torrents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ magnet: magnet })
    })
      .then(function (data) {
        if (token !== state.playToken) return;
        var hash = data && (data.infoHash || data.info_hash || data.hash);
        if (!hash) throw new Error("Server did not return an infoHash.");
        if (data && data.video !== null && data.video !== undefined) {
          return play(token, hash, data.video, name, done);
        }
        return poll(token, hash, name, done);
      })
      .catch(function (err) {
        fail("Could not start the stream", err.message);
      });
  }

  function poll(token, hash, name, done) {
    var attempts = 0;
    var MAX = 80;

    setOnly(playerBody, statusBlock("Connecting to peers..."));

    return new Promise(function (resolve) {
      function tick() {
        if (token !== state.playToken) return resolve();
        attempts++;
        request("api/torrents/" + encodeURIComponent(hash))
          .then(function (data) {
            if (token !== state.playToken) return resolve();
            var video = data && data.video;
            if (video !== null && video !== undefined) {
              play(token, hash, video, name, done);
              return resolve();
            }
            if (attempts >= MAX) {
              setOnly(
                playerBody,
                errorBlock(
                  "Stream never became ready",
                  "No video file after " + attempts + " checks. The source may have no peers.",
                  function () { poll(++state.playToken, hash, name, done); }
                )
              );
              if (done) done();
              return resolve();
            }
            setOnly(
              playerBody,
              statusBlock(
                "Preparing video... (" + attempts + ")"
              )
            );
            setTimeout(tick, 1500);
          })
          .catch(function (err) {
            if (token !== state.playToken) return resolve();
            setOnly(
              playerBody,
              errorBlock("Lost contact with the stream", err.message, function () {
                poll(++state.playToken, hash, name, done);
              })
            );
            if (done) done();
            resolve();
          });
      }
      tick();
    });
  }

  function play(token, hash, video, name, done) {
    if (token !== state.playToken) return;
    var frame = el("div", "player-frame");
    var v = document.createElement("video");
    v.controls = true;
    v.autoplay = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src =
      "api/stream/" + encodeURIComponent(hash) + "/" + encodeURIComponent(video);
    v.addEventListener("error", function () {
      setOnly(
        playerBody,
        errorBlock(
          "Playback failed",
          "The browser could not play this file. Try another source.",
          function () { play(token, hash, video, name, done); }
        )
      );
    });
    frame.appendChild(v);

    clear(playerBody);
    playerBody.appendChild(frame);
    playerBody.appendChild(el("p", "player-caption", name));
    if (done) done();
  }

  /* ---------- wiring ---------- */

  $("picker").addEventListener("submit", function (e) {
    e.preventDefault();
    loadRecommendation();
  });
})();
