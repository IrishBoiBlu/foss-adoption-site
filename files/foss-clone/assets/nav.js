/* Replaces the interactions the original React app handled client-side. */
(function () {
  "use strict";

  var ADOPT_LINKS = [
    ["/adopt/all", "All pets", "Dogs, cats and everyone else"],
    ["/adopt/dogs", "Dogs", "Puppies and adult dogs"],
    ["/adopt/cats", "Cats", "Cats and kittens"],
    ["/adopt/other-pets", "Other animals", "Small pets, when we have them"],
    ["/adopt/process", "Adoption process", "Fees, steps and questions"]
  ];

  /* --- Desktop "Adopt" dropdown --- */
  var adoptBtn = document.querySelector('[data-testid="nav-adopt"]');
  if (adoptBtn && adoptBtn.parentElement && !adoptBtn.parentElement.querySelector(".foss-dropdown")) {
    var panel = document.createElement("div");
    panel.className = "foss-dropdown";
    panel.setAttribute("id", "adopt-menu");
    ADOPT_LINKS.forEach(function (item) {
      var a = document.createElement("a");
      a.href = item[0];
      a.textContent = item[1];
      var small = document.createElement("span");
      small.textContent = item[2];
      a.appendChild(small);
      panel.appendChild(a);
    });
    adoptBtn.parentElement.appendChild(panel);

    adoptBtn.addEventListener("click", function (event) {
      event.preventDefault();
      var open = panel.classList.toggle("is-open");
      adoptBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });

    document.addEventListener("click", function (event) {
      if (!panel.contains(event.target) && event.target !== adoptBtn) {
        panel.classList.remove("is-open");
        adoptBtn.setAttribute("aria-expanded", "false");
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        panel.classList.remove("is-open");
        adoptBtn.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* --- Mobile menu --- */
  var menuBtn = document.querySelector('header button[aria-controls="mobile-menu"]');
  if (menuBtn && !document.querySelector(".foss-mobile")) {
    var mobile = document.createElement("div");
    mobile.className = "foss-mobile";
    mobile.id = "mobile-menu";

    var nav = document.createElement("nav");
    nav.setAttribute("aria-label", "Mobile");

    function addLink(href, label, isLabel) {
      if (isLabel) {
        var p = document.createElement("p");
        p.className = "foss-label";
        p.textContent = label;
        nav.appendChild(p);
        return;
      }
      var a = document.createElement("a");
      a.href = href;
      a.textContent = label;
      nav.appendChild(a);
    }

    addLink("/", "Home");
    addLink(null, "Adopt", true);
    addLink("/adopt/all", "All pets");
    addLink("/adopt/dogs", "Dogs");
    addLink("/adopt/cats", "Cats");
    addLink("/adopt/other-pets", "Other animals");
    addLink("/adopt/process", "Adoption process");
    addLink(null, "The shelter", true);
    addLink("/about", "Our story");
    addLink("/volunteer", "Volunteer");
    addLink("/programs/microchip", "Programs");
    addLink("/contact", "Visit & contact");
    addLink("/newsletter", "Newsletter");
    addLink("/sponsors", "Sponsors");
    addLink("/contact", "Get involved");

    var donate = document.createElement("a");
    donate.href = "/give";
    donate.className = "foss-donate";
    donate.textContent = "Donate";
    nav.appendChild(donate);

    mobile.appendChild(nav);
    document.body.appendChild(mobile);

    function closeMenu() {
      mobile.classList.remove("is-open");
      document.body.classList.remove("foss-menu-open");
      menuBtn.setAttribute("aria-expanded", "false");
      var sr = menuBtn.querySelector(".sr-only");
      if (sr) sr.textContent = "Open menu";
    }

    menuBtn.addEventListener("click", function (event) {
      event.preventDefault();
      var open = mobile.classList.toggle("is-open");
      document.body.classList.toggle("foss-menu-open", open);
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
      var sr = menuBtn.querySelector(".sr-only");
      if (sr) sr.textContent = open ? "Close menu" : "Open menu";
    });

    mobile.addEventListener("click", function (event) {
      if (event.target.tagName === "A") closeMenu();
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth >= 1024) closeMenu();
    });
  }

  /* --- Pet type filter on /adopt/all --- */
  var filters = document.querySelector('[data-testid="pet-filters"]');
  var list = document.querySelector('[data-testid="all-pets"]');
  if (filters && list) {
    var cards = Array.prototype.slice.call(
      list.querySelectorAll('article[data-testid^="pet-card-"]')
    );

    function kindOf(card) {
      var a = card.querySelector("a[href]");
      var href = a ? a.getAttribute("href") : "";
      if (href.indexOf("/adopt/dogs/") === 0) return "Dog";
      if (href.indexOf("/adopt/cats/") === 0) return "Cat";
      return "Other";
    }

    var activeClasses = ["border-ink", "bg-ink", "text-cream"];
    var idleClasses = ["border-ink/20", "bg-cream", "text-ink", "hover:border-ink"];

    filters.addEventListener("click", function (event) {
      var button = event.target.closest("button");
      if (!button) return;

      var match = (button.getAttribute("data-testid") || "").replace("pet-filter-", "");
      if (!/^(all|Dog|Cat|Other)$/.test(match)) return;

      Array.prototype.forEach.call(filters.querySelectorAll("button"), function (btn) {
        var isActive = btn === button;
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
        idleClasses.forEach(function (c) { btn.classList.remove(c); });
        activeClasses.forEach(function (c) { btn.classList.remove(c); });
        (isActive ? activeClasses : idleClasses).forEach(function (c) {
          btn.classList.add(c);
        });
      });

      cards.forEach(function (card) {
        var show = match === "all" || kindOf(card) === match;
        card.classList.toggle("foss-hidden", !show);
      });

      list.setAttribute("data-filter", match === "all" ? "all" : match);
    });
  }

  /* --- Staff-managed settings: site name, logo, announcement, contact --- */
  var ADMIN_ORIGIN = "https://shelter-staff-admin-0xjqut.freebuff.site";

  function applyStaffSettings(cfg) {
    var prefix = "/";
    var about = document.querySelector('a[href$="/about"]');
    if (about) prefix = about.getAttribute("href").replace(/about$/, "");

    var nameEls = document.querySelectorAll("header .font-display, footer .font-display");
    var oldName = nameEls.length ? nameEls[0].textContent.trim() : "";
    if (cfg.siteName) {
      Array.prototype.forEach.call(nameEls, function (el) {
        el.textContent = cfg.siteName;
      });
      if (oldName && document.title.indexOf(oldName) !== -1) {
        document.title = document.title.split(oldName).join(cfg.siteName);
      }
    }

    if (cfg.logoUrl) {
      var abs = /^https?:|^\/\//.test(cfg.logoUrl) ? cfg.logoUrl : ADMIN_ORIGIN + cfg.logoUrl;
      var probe = new Image();
      probe.onload = function () {
        var mark = document.querySelector('header a[href] > span[aria-hidden="true"]');
        if (!mark) {
          var baked = document.querySelector("header a[href] > img");
          if (baked) baked.src = abs;
          return;
        }
        mark.textContent = "";
        mark.style.border = "0";
        mark.style.background = "transparent";
        mark.style.width = "auto";
        mark.style.height = "auto";
        var img = document.createElement("img");
        img.src = abs;
        img.alt = "";
        img.style.cssText = "height:2.6rem;width:auto;max-width:10rem;object-fit:contain;display:block";
        mark.appendChild(img);
      };
      probe.src = abs;
    }

    if (cfg.announcement) {
      var bar = document.createElement("div");
      bar.setAttribute("role", "status");
      bar.textContent = cfg.announcement;
      bar.style.cssText =
        "position:relative;z-index:60;background:#22201d;color:#fffdf8;text-align:center;padding:10px 20px;" +
        "font:600 12.5px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:.05em";
      document.body.insertBefore(bar, document.body.firstChild);
    }

    if (cfg.contactEmail) {
      Array.prototype.forEach.call(document.querySelectorAll('a[href^="mailto:"]'), function (a) {
        a.setAttribute("href", "mailto:" + cfg.contactEmail);
        a.textContent = cfg.contactEmail;
      });
    }

    var heroText = document.querySelector('[data-testid="hero-subtext"]');
    if (heroText && cfg.tagline) heroText.textContent = cfg.tagline;

    var heroCta = document.querySelector('[data-testid="hero-adopt-cta"]');
    if (heroCta) {
      if (cfg.ctaLabel) {
        var arrow = heroCta.querySelector("svg");
        heroCta.textContent = cfg.ctaLabel;
        if (arrow) heroCta.appendChild(arrow);
      }
      if (cfg.ctaUrl) {
        heroCta.setAttribute(
          "href",
          cfg.ctaUrl.charAt(0) === "/" ? prefix + cfg.ctaUrl.slice(1) : cfg.ctaUrl
        );
      }
    }
  }

  fetch(ADMIN_ORIGIN + "/api/public-config", { credentials: "omit" })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (cfg) { if (cfg) applyStaffSettings(cfg); })
    .catch(function () { /* keep the built-in content */ });
})();

/* --- Paw-print trail up the left edge of the homepage --- */
(function () {
  "use strict";

  if (!document.querySelector('[data-testid="hero"]')) return;
  if (document.querySelector(".foss-paw-trail")) return;

  var COUNT = 12;
  var FADE = 0.07;
  var PAW =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">' +
    '<ellipse cx="7" cy="7.4" rx="2.1" ry="2.7"></ellipse>' +
    '<ellipse cx="12" cy="5.8" rx="2.1" ry="2.9"></ellipse>' +
    '<ellipse cx="17" cy="7.4" rx="2.1" ry="2.7"></ellipse>' +
    '<ellipse cx="20.2" cy="11.8" rx="1.8" ry="2.2"></ellipse>' +
    '<ellipse cx="3.8" cy="11.8" rx="1.8" ry="2.2"></ellipse>' +
    '<path d="M12 11.6c3.2 0 6.2 2.6 6.2 5.3 0 2-1.7 3.3-3.6 3.3-1.1 0-1.9-.4-2.6-.4s-1.5.4-2.6.4c-1.9 0-3.6-1.3-3.6-3.3 0-2.7 3-5.3 6.2-5.3Z"></path>' +
    "</svg>";

  var trail = document.createElement("div");
  trail.className = "foss-paw-trail";
  trail.setAttribute("aria-hidden", "true");

  var track = document.createElement("div");
  track.className = "foss-paw-track";
  trail.appendChild(track);

  var paws = [];
  for (var i = 0; i < COUNT; i++) {
    var wide = i % 2 === 1;
    var size = 30 + (i % 5) * 5;
    var paw = document.createElement("span");
    paw.className = wide ? "foss-paw foss-paw-wide" : "foss-paw";
    // The first print sits at the bottom of the column, the last at the top,
    // so the trail fills upward as the page goes down.
    paw.style.top = (92 - (i * 84) / (COUNT - 1)).toFixed(2) + "%";
    paw.style.left = (wide ? 48 : 14) + (i % 3) * 6 + "px";
    paw.style.width = size + "px";
    paw.style.height = size + "px";
    paw.style.opacity = "0";
    paw.innerHTML = PAW;
    track.appendChild(paw);
    paws.push({ el: paw, at: (i / (COUNT - 1)) * 0.82, base: 0.55 + (i % 4) * 0.09 });
  }

  document.body.appendChild(trail);

  var span = 1;
  var frame = 0;

  function paint() {
    frame = 0;
    var top = window.pageYOffset || document.documentElement.scrollTop || 0;
    var progress = Math.min(1, Math.max(0, top / span));
    for (var j = 0; j < paws.length; j++) {
      var item = paws[j];
      var seen = Math.min(1, Math.max(0, (progress - item.at) / FADE));
      item.el.style.opacity = (item.base * seen).toFixed(3);
      item.el.style.transform =
        "translate3d(0," + (22 * (1 - seen)).toFixed(1) + "px,0) rotate(" + ((j % 2 ? 15 : -13)) + "deg)";
    }
  }

  function onScroll() {
    if (!frame) frame = window.requestAnimationFrame(paint);
  }

  function measure() {
    span = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    onScroll();
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", measure);
  window.addEventListener("load", measure);
  measure();
})();
