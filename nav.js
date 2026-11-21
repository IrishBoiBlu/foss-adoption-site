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
})();
