// HabitHero Admin JavaScript

document.addEventListener("DOMContentLoaded", function () {
  // Auto-dismiss alerts
  const alerts = document.querySelectorAll(".alert");
  alerts.forEach((alert) => {
    setTimeout(() => {
      const bsAlert = new bootstrap.Alert(alert);
      bsAlert.close();
    }, 5000);
  });

  // Enable tooltips
  const tooltipTriggerList = [].slice.call(
    document.querySelectorAll('[data-bs-toggle="tooltip"]')
  );
  tooltipTriggerList.map(function (tooltipTriggerEl) {
    return new bootstrap.Tooltip(tooltipTriggerEl);
  });

  // Enable popovers
  const popoverTriggerList = [].slice.call(
    document.querySelectorAll('[data-bs-toggle="popover"]')
  );
  popoverTriggerList.map(function (popoverTriggerEl) {
    return new bootstrap.Popover(popoverTriggerEl);
  });

  // Confirm delete actions
  document.addEventListener("click", function (e) {
    if (
      e.target.matches(".confirm-delete") ||
      e.target.closest(".confirm-delete")
    ) {
      if (
        !confirm(
          "Are you sure you want to delete this item? This action cannot be undone."
        )
      ) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }
  });

  // Confirm bulk actions
  document.addEventListener("click", function (e) {
    if (
      e.target.matches(".confirm-bulk-action") ||
      e.target.closest(".confirm-bulk-action")
    ) {
      const action = e.target.dataset.action || "perform this action";
      if (
        !confirm(
          `Are you sure you want to ${action}? This action cannot be undone.`
        )
      ) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }
  });

  // Toggle sidebar on mobile
  const sidebarToggle = document.querySelector('[data-toggle="sidebar"]');
  const sidebar = document.querySelector(".sidebar");

  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener("click", function () {
      sidebar.classList.toggle("show");
    });
  }

  // Auto-update time
  updateServerTime();
  setInterval(updateServerTime, 1000);

  // Form validation
  const forms = document.querySelectorAll(".needs-validation");
  forms.forEach((form) => {
    form.addEventListener(
      "submit",
      function (event) {
        if (!form.checkValidity()) {
          event.preventDefault();
          event.stopPropagation();
        }
        form.classList.add("was-validated");
      },
      false
    );
  });

  // Table row selection
  const selectAllCheckbox = document.getElementById("selectAll");
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener("change", function () {
      const checkboxes = document.querySelectorAll(".item-checkbox");
      checkboxes.forEach((checkbox) => {
        checkbox.checked = this.checked;
        const row = checkbox.closest("tr");
        if (row) {
          row.classList.toggle("selected", this.checked);
        }
      });
    });
  }

  // Search filter
  const searchInput = document.querySelector(".admin-search");
  if (searchInput) {
    searchInput.addEventListener("input", function () {
      const searchTerm = this.value.toLowerCase();
      const rows = document.querySelectorAll(".searchable-row");

      rows.forEach((row) => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(searchTerm) ? "" : "none";
      });
    });
  }

  // Export data
  const exportButtons = document.querySelectorAll(".export-data");
  exportButtons.forEach((button) => {
    button.addEventListener("click", function (e) {
      e.preventDefault();
      const format = this.dataset.format || "csv";
      const endpoint = this.dataset.endpoint;

      if (endpoint) {
        window.location.href = `${endpoint}?format=${format}`;
      }
    });
  });

  // Refresh stats
  const refreshButtons = document.querySelectorAll(".refresh-stats");
  refreshButtons.forEach((button) => {
    button.addEventListener("click", function () {
      const spinner = this.querySelector(".fa-sync-alt");
      if (spinner) {
        spinner.classList.add("fa-spin");
        setTimeout(() => {
          spinner.classList.remove("fa-spin");
        }, 1000);
      }

      // You can add AJAX call to refresh stats here
      console.log("Refreshing stats...");
    });
  });

  // Copy to clipboard
  const copyButtons = document.querySelectorAll(".copy-to-clipboard");
  copyButtons.forEach((button) => {
    button.addEventListener("click", function () {
      const text = this.dataset.copy || this.textContent;
      const originalText = this.innerHTML;

      navigator.clipboard
        .writeText(text)
        .then(() => {
          this.innerHTML = '<i class="fas fa-check"></i> Copied!';
          setTimeout(() => {
            this.innerHTML = originalText;
          }, 2000);
        })
        .catch((err) => {
          console.error("Failed to copy: ", err);
        });
    });
  });

  // Initialize charts if Chart.js is available
  if (typeof Chart !== "undefined") {
    initializeCharts();
  }
});

// Update server time
function updateServerTime() {
  const timeElements = document.querySelectorAll(".server-time");
  if (timeElements.length > 0) {
    const now = new Date();
    const formatted =
      now
        .toLocaleString("en-US", {
          timeZone: "UTC",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
        .replace(",", "") + " UTC";

    timeElements.forEach((el) => {
      el.textContent = formatted;
    });
  }
}

// Initialize charts
function initializeCharts() {
  // Dashboard charts
  const dashboardChart = document.getElementById("dashboardChart");
  if (dashboardChart) {
    const ctx = dashboardChart.getContext("2d");
    new Chart(ctx, {
      type: "line",
      data: {
        labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
        datasets: [
          {
            label: "User Growth",
            data: [65, 78, 90, 120, 156, 200],
            borderColor: "#667eea",
            backgroundColor: "rgba(102, 126, 234, 0.1)",
            tension: 0.4,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: false,
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: {
              drawBorder: false,
            },
          },
          x: {
            grid: {
              display: false,
            },
          },
        },
      },
    });
  }

  // Activity chart
  const activityChart = document.getElementById("activityChart");
  if (activityChart) {
    const ctx = activityChart.getContext("2d");
    new Chart(ctx, {
      type: "bar",
      data: {
        labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        datasets: [
          {
            label: "Activity",
            data: [12, 19, 8, 15, 22, 18, 25],
            backgroundColor: "rgba(102, 126, 234, 0.8)",
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: false,
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: {
              drawBorder: false,
            },
          },
          x: {
            grid: {
              display: false,
            },
          },
        },
      },
    });
  }
}

// Toggle dark mode
function toggleDarkMode() {
  document.body.classList.toggle("dark-mode");
  localStorage.setItem(
    "darkMode",
    document.body.classList.contains("dark-mode")
  );
}

// Check for saved dark mode preference
if (localStorage.getItem("darkMode") === "true") {
  document.body.classList.add("dark-mode");
}

// Search functionality
function performSearch(query) {
  if (!query) return;

  // You can implement AJAX search here
  console.log("Searching for:", query);

  // Show loading
  const resultsContainer = document.getElementById("searchResults");
  if (resultsContainer) {
    resultsContainer.innerHTML =
      '<div class="text-center py-3"><i class="fas fa-spinner fa-spin"></i> Searching...</div>';

    // Simulate API call
    setTimeout(() => {
      resultsContainer.innerHTML = `
                <div class="list-group">
                    <a href="#" class="list-group-item list-group-item-action">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">Search Result 1</h6>
                            <small>Just now</small>
                        </div>
                        <p class="mb-1">Details about search result 1</p>
                    </a>
                    <a href="#" class="list-group-item list-group-item-action">
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">Search Result 2</h6>
                            <small>2 minutes ago</small>
                        </div>
                        <p class="mb-1">Details about search result 2</p>
                    </a>
                </div>
            `;
    }, 500);
  }
}

// Export data function
function exportData(format, filters = {}) {
  let url = `/admin/export?format=${format}`;

  // Add filters to URL
  const params = new URLSearchParams(filters).toString();
  if (params) {
    url += `&${params}`;
  }

  window.location.href = url;
}

// Show notification
function showNotification(type, message) {
  const container = document.getElementById("notifications");
  if (!container) return;

  const alert = document.createElement("div");
  alert.className = `alert alert-${type} alert-dismissible fade show`;
  alert.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

  container.appendChild(alert);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (alert.parentNode) {
      alert.classList.remove("show");
      setTimeout(() => {
        if (alert.parentNode) {
          alert.parentNode.removeChild(alert);
        }
      }, 300);
    }
  }, 5000);
}

// Load more data (pagination/infinite scroll)
function loadMoreData(url, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const loading = document.createElement("div");
  loading.className = "text-center py-3";
  loading.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
  container.appendChild(loading);

  fetch(url)
    .then((response) => response.json())
    .then((data) => {
      container.removeChild(loading);

      if (data.html) {
        container.innerHTML += data.html;
      }

      if (data.has_more) {
        const loadMoreBtn = document.createElement("button");
        loadMoreBtn.className = "btn btn-admin mt-3";
        loadMoreBtn.textContent = "Load More";
        loadMoreBtn.onclick = () => loadMoreData(data.next_url, containerId);
        container.appendChild(loadMoreBtn);
      }
    })
    .catch((error) => {
      console.error("Error loading more data:", error);
      container.removeChild(loading);
      showNotification("danger", "Failed to load more data");
    });
}

// Filter table
function filterTable(tableId, columnIndex, searchTerm) {
  const table = document.getElementById(tableId);
  if (!table) return;

  const rows = table.getElementsByTagName("tr");

  for (let i = 1; i < rows.length; i++) {
    const cell = rows[i].getElementsByTagName("td")[columnIndex];
    if (cell) {
      const text = cell.textContent || cell.innerText;
      rows[i].style.display =
        text.toLowerCase().indexOf(searchTerm.toLowerCase()) > -1 ? "" : "none";
    }
  }
}

// Sort table
function sortTable(tableId, columnIndex) {
  const table = document.getElementById(tableId);
  if (!table) return;

  const tbody = table.getElementsByTagName("tbody")[0];
  const rows = Array.from(tbody.getElementsByTagName("tr"));

  const isAscending =
    table.dataset.sortColumn !== columnIndex ||
    table.dataset.sortOrder === "desc";

  rows.sort((a, b) => {
    const aValue = a.getElementsByTagName("td")[columnIndex].textContent;
    const bValue = b.getElementsByTagName("td")[columnIndex].textContent;

    if (isAscending) {
      return aValue.localeCompare(bValue, undefined, { numeric: true });
    } else {
      return bValue.localeCompare(aValue, undefined, { numeric: true });
    }
  });

  // Remove existing rows
  while (tbody.firstChild) {
    tbody.removeChild(tbody.firstChild);
  }

  // Add sorted rows
  rows.forEach((row) => tbody.appendChild(row));

  // Update sort indicators
  table.dataset.sortColumn = columnIndex;
  table.dataset.sortOrder = isAscending ? "asc" : "desc";

  // Update header classes
  const headers = table.getElementsByTagName("th");
  for (let i = 0; i < headers.length; i++) {
    headers[i].classList.remove("sort-asc", "sort-desc");
    if (i === columnIndex) {
      headers[i].classList.add(isAscending ? "sort-asc" : "sort-desc");
    }
  }
}

// Bulk actions
function performBulkAction(action, selectedItems) {
  if (selectedItems.length === 0) {
    showNotification("warning", "Please select items first");
    return;
  }

  if (
    !confirm(
      `Are you sure you want to ${action} ${selectedItems.length} item(s)?`
    )
  ) {
    return;
  }

  const formData = new FormData();
  formData.append("action", action);
  selectedItems.forEach((id) => formData.append("items[]", id));

  fetch("/admin/bulk-action", {
    method: "POST",
    body: formData,
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        showNotification("success", data.message);
        setTimeout(() => location.reload(), 1000);
      } else {
        showNotification("danger", data.message);
      }
    })
    .catch((error) => {
      console.error("Error performing bulk action:", error);
      showNotification("danger", "Failed to perform bulk action");
    });
}

// Initialize when page loads
window.addEventListener("load", function () {
  // Add loading animation to buttons with loading state
  const loadingButtons = document.querySelectorAll(".btn-loading");
  loadingButtons.forEach((button) => {
    button.addEventListener("click", function () {
      const originalText = this.innerHTML;
      this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
      this.disabled = true;

      // Reset after 3 seconds (or after AJAX completes)
      setTimeout(() => {
        this.innerHTML = originalText;
        this.disabled = false;
      }, 3000);
    });
  });

  // Initialize any custom components
  initCustomComponents();
});

// Custom components initialization
function initCustomComponents() {
  // Date range pickers
  const datePickers = document.querySelectorAll(".date-range-picker");
  datePickers.forEach((picker) => {
    // You can initialize a date range picker library here
  });

  // Color pickers
  const colorPickers = document.querySelectorAll(".color-picker");
  colorPickers.forEach((picker) => {
    // Initialize color picker
  });

  // Rich text editors
  const editors = document.querySelectorAll(".rich-text-editor");
  editors.forEach((editor) => {
    // Initialize rich text editor
  });
}

// Debounce function for search/resize events
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Throttle function for scroll events
function throttle(func, limit) {
  let inThrottle;
  return function () {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// Export utility functions
window.AdminUtils = {
  showNotification,
  exportData,
  filterTable,
  sortTable,
  performBulkAction,
  toggleDarkMode,
};
