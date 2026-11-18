document.addEventListener("DOMContentLoaded", function () {
  "use strict";

  // Placeholder buttons stay inert until real targets exist.
  document.querySelectorAll(".button.is-coming-soon").forEach(function (btn) {
    btn.addEventListener("click", function (ev) { ev.preventDefault(); });
  });

  // Test-set tabs of the main results table.
  document.querySelectorAll("[data-tabs]").forEach(function (tabs) {
    var items = tabs.querySelectorAll("li[data-target]");
    items.forEach(function (li) {
      li.querySelector("a").addEventListener("click", function (ev) {
        ev.preventDefault();
        items.forEach(function (other) {
          var on = other === li;
          other.classList.toggle("is-active", on);
          other.querySelector("a").setAttribute("aria-selected", on ? "true" : "false");
          var panel = document.getElementById(other.getAttribute("data-target"));
          if (panel) panel.classList.toggle("is-hidden", !on);
        });
      });
    });
  });
});
