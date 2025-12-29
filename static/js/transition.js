// static/js/transition.js - NEW FILE
document.addEventListener("DOMContentLoaded", function () {
  // Check if transitions are enabled for this page
  const transitionContainer = document.querySelector(
    ".page-transition-container"
  );

  if (!transitionContainer) {
    return; // Transitions disabled for this page (e.g., intro page)
  }

  // Start enter animation
  setTimeout(() => {
    transitionContainer.classList.add("page-active");
  }, 10);

  // Handle page exit animations for internal links
  document.addEventListener("click", function (e) {
    // Find the closest anchor tag
    const link = e.target.closest("a");

    if (!link) return;

    const href = link.getAttribute("href");
    const target = link.getAttribute("target");

    if (
      !href ||
      href.startsWith("http") ||
      href.startsWith("//") ||
      target === "_blank" ||
      href.startsWith("javascript:") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("#") ||
      link.hasAttribute("download") ||
      link.classList.contains("no-transition")
    ) {
      return;
    }

    // Check if it's a Flask route (starts with / or is relative)
    if (href.startsWith("/") || !href.includes("://")) {
      e.preventDefault();

      // Start exit animation
      transitionContainer.classList.remove("page-active");
      transitionContainer.classList.add("page-exit");

      // Navigate after animation completes
      setTimeout(() => {
        window.location.href = href;
      }, 300);
    }
  });

  // Handle browser back/forward buttons
  window.addEventListener("beforeunload", function () {
    if (transitionContainer.classList.contains("page-active")) {
      transitionContainer.classList.remove("page-active");
      transitionContainer.classList.add("page-exit");
    }
  });
});

// Handle form submissions with transitions
document.addEventListener("submit", function (e) {
  const form = e.target;
  const transitionContainer = document.querySelector(
    ".page-transition-container"
  );

  if (
    !transitionContainer ||
    !form.method ||
    form.method.toLowerCase() !== "get"
  ) {
    return;
  }

  // Only animate for GET form submissions (like search)
  e.preventDefault();

  transitionContainer.classList.remove("page-active");
  transitionContainer.classList.add("page-exit");

  setTimeout(() => {
    form.submit();
  }, 300);

  // Utility function to skip transitions for specific links
  function skipTransitionForLinks() {
    // Add no-transition class to specific links
    document
      .querySelectorAll(
        'a[href*="logout"], a[href*="login"], a[href*="register"]'
      )
      .forEach((link) => {
        link.classList.add("no-transition");
      });
  }

  document.addEventListener("DOMContentLoaded", skipTransitionForLinks);
});
