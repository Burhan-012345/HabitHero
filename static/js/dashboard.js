// Dashboard JavaScript - FIXED VERSION (No socket conflicts)
document.addEventListener("DOMContentLoaded", function () {
  // Initialize components first
  initializeHabitCompletion();
  initializeStreakAnimations();
  initializeActivityFeed();
  initializeStatsCharts();
  initializeNotifications();

  // Initialize Socket.IO connection only if available
  initializeSocketIO();

  // Mobile menu toggle
  const menuToggle = document.querySelector(".menu-toggle");
  const sidebar = document.querySelector(".sidebar");

  if (menuToggle && sidebar) {
    menuToggle.addEventListener("click", function () {
      sidebar.classList.toggle("active");
    });
  }

  // Close sidebar when clicking outside on mobile
  document.addEventListener("click", function (event) {
    if (
      window.innerWidth <= 768 &&
      sidebar &&
      sidebar.classList.contains("active")
    ) {
      if (
        !sidebar.contains(event.target) &&
        !menuToggle.contains(event.target)
      ) {
        sidebar.classList.remove("active");
      }
    }
  });

  // Load notification badge on page load
  updateNotificationBadge();
});

// Global socket variable
let appSocket = null;

function initializeSocketIO() {
  // Check if Socket.IO is available
  if (typeof io === "undefined") {
    console.warn("Socket.IO not available. Real-time features disabled.");
    return;
  }

  // Create socket connection
  appSocket = io();

  // Make socket globally available with unique name
  window.appSocket = appSocket;
  window.habitHeroSocket = appSocket;

  // User online status
  appSocket.on("connect", function () {
    console.log("Connected to server");
    updateOnlineStatus(true);
  });

  appSocket.on("disconnect", function () {
    updateOnlineStatus(false);
  });

  // Real-time notifications
  appSocket.on("new_snap", function (data) {
    showNotification(`📸 New snap from ${data.from}!`, "info");
    updateSnapBadge();
  });

  appSocket.on("snap_viewed", function (data) {
    showNotification(`👀 ${data.viewer} viewed your snap!`, "success");
  });

  appSocket.on("snap_reaction", function (data) {
    showNotification(
      `${data.from} reacted ${data.emoji} to your snap!`,
      "success"
    );
  });

  appSocket.on("friend_request", function (data) {
    showNotification(`👋 Friend request from ${data.from}!`, "info");
    updateFriendRequestBadge();
  });

  appSocket.on("friend_request_accepted", function (data) {
    showNotification(
      `✅ ${data.from} accepted your friend request!`,
      "success"
    );
  });

  appSocket.on("user_status", function (data) {
    updateUserStatusIndicator(data.user_id, data.status);
  });

  // Add new notification event listeners
  appSocket.on("new_notification", function (data) {
    showNotification(data.notification.text, "info");
    updateNotificationBadge();
  });

  appSocket.on("notification_count_update", function (data) {
    updateNotificationBadge(data.count);
  });

  // Chat events
  appSocket.on("chat_message", function (data) {
    console.log("Chat message received:", data);
  });

  appSocket.on("user_typing", function (data) {
    console.log("User typing:", data);
  });
}

// Global socket getter
window.getSocket = function () {
  return window.appSocket || appSocket || null;
};

// Habit completion functionality
function initializeHabitCompletion() {
  const completeButtons = document.querySelectorAll(".complete-habit-btn");

  completeButtons.forEach((button) => {
    button.addEventListener("click", async function () {
      const habitId = this.dataset.habitId;
      const habitCard = this.closest(".habit-card");

      if (!habitId || this.disabled) return;

      try {
        // Show loading state
        const originalText = this.innerHTML;
        this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Completing...';
        this.disabled = true;

        const response = await fetch(`/habits/${habitId}/complete`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": getCSRFToken(),
          },
        });

        const data = await response.json();

        if (data.success) {
          // Update UI
          this.innerHTML = '<i class="fas fa-check"></i> Completed!';
          this.classList.add("completed");

          // Update streak count
          const streakElement = habitCard.querySelector(".streak-count");
          if (streakElement) {
            streakElement.textContent = data.streak;
          }

          // Update last completed
          const lastCompletedElement =
            habitCard.querySelector(".last-completed");
          if (lastCompletedElement) {
            const now = new Date();
            lastCompletedElement.textContent = formatDate(now);
          }

          // Show success animation
          animateHabitCompletion(habitCard);

          // Update stats
          updateDashboardStats();

          showNotification(
            "Habit completed! Keep the streak going! 🔥",
            "success"
          );
        } else {
          showNotification(
            "Failed to complete habit. Please try again.",
            "error"
          );
          this.innerHTML = originalText;
          this.disabled = false;
        }
      } catch (error) {
        console.error("Error completing habit:", error);
        showNotification("An error occurred. Please try again.", "error");
        this.innerHTML = originalText;
        this.disabled = false;
      }
    });
  });
}

// Streak animations
function initializeStreakAnimations() {
  const streakElements = document.querySelectorAll(".streak-count");

  streakElements.forEach((element) => {
    const streak = parseInt(element.textContent);
    if (streak >= 7) {
      element.classList.add("hot-streak");
    }
    if (streak >= 30) {
      element.classList.add("fire-streak");
    }
  });
}

// Activity feed
function initializeActivityFeed() {
  const activityItems = document.querySelectorAll(".activity-item");

  activityItems.forEach((item) => {
    item.addEventListener("click", function () {
      const type = this.dataset.type;
      const id = this.dataset.id;

      if (type === "snap" && id) {
        viewSnap(id);
      } else if (type === "habit" && id) {
        showHabitDetails(id);
      }
    });
  });
}

// Stats charts
function initializeStatsCharts() {
  const statsChartCanvas = document.getElementById("stats-chart");
  const habitsChartCanvas = document.getElementById("habits-chart");

  if (statsChartCanvas) {
    loadStatsChart(statsChartCanvas);
  }

  if (habitsChartCanvas) {
    loadHabitsChart(habitsChartCanvas);
  }
}

// Notifications
function initializeNotifications() {
  const notificationBell = document.querySelector(".notification-bell");
  const notificationPanel = document.querySelector(".notification-panel");

  if (notificationBell && notificationPanel) {
    notificationBell.addEventListener("click", function () {
      notificationPanel.classList.toggle("active");
      markNotificationsAsRead();
    });

    // Close notification panel when clicking outside
    document.addEventListener("click", function (event) {
      if (
        !notificationBell.contains(event.target) &&
        !notificationPanel.contains(event.target)
      ) {
        notificationPanel.classList.remove("active");
      }
    });
  }
}

// Helper functions
function updateOnlineStatus(isOnline) {
  const statusIndicator = document.querySelector(".online-status");
  if (statusIndicator) {
    statusIndicator.textContent = isOnline ? "Online" : "Offline";
    statusIndicator.className = `online-status ${
      isOnline ? "online" : "offline"
    }`;
  }
}

function updateUserStatusIndicator(userId, status) {
  const indicator = document.querySelector(
    `[data-user-id="${userId}"] .status-indicator`
  );
  if (indicator) {
    indicator.className = `status-indicator ${status}`;
  }
}

function updateSnapBadge() {
  const badge = document.querySelector(".snaps-badge");
  if (badge) {
    let count = parseInt(badge.textContent) || 0;
    badge.textContent = count + 1;
    badge.style.display = "inline-block";
  }
}

function updateFriendRequestBadge() {
  const badge = document.querySelector(".friends-badge");
  if (badge) {
    let count = parseInt(badge.textContent) || 0;
    badge.textContent = count + 1;
    badge.style.display = "inline-block";
  }
}

function markNotificationsAsRead() {
  const unreadNotifications = document.querySelectorAll(
    ".notification-item.unread"
  );
  unreadNotifications.forEach((item) => {
    item.classList.remove("unread");
  });

  // Update badge
  const badge = document.querySelector(".notification-badge");
  if (badge) {
    badge.style.display = "none";
  }
}

function showNotification(message, type = "info") {
  // Create notification element
  const notification = document.createElement("div");
  notification.className = `notification-toast notification-${type}`;
  notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${getNotificationIcon(type)}"></i>
            <span>${message}</span>
        </div>
        <button class="notification-close">
            <i class="fas fa-times"></i>
        </button>
    `;

  // Add to page
  let container = document.querySelector(".notification-container");
  if (!container) {
    const newContainer = document.createElement("div");
    newContainer.className = "notification-container";
    document.body.appendChild(newContainer);
    container = newContainer;
  }

  container.appendChild(notification);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    notification.style.animation = "slideOut 0.3s ease";
    setTimeout(() => notification.remove(), 300);
  }, 5000);

  // Close button
  notification
    .querySelector(".notification-close")
    .addEventListener("click", function () {
      notification.remove();
    });

  // Add styles if not already present
  if (!document.getElementById("notification-styles")) {
    const style = document.createElement("style");
    style.id = "notification-styles";
    style.textContent = `
            .notification-container {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 9999;
                max-width: 400px;
            }
            
            .notification-toast {
                background: white;
                border-radius: 12px;
                padding: 1rem 1.5rem;
                margin-bottom: 1rem;
                box-shadow: 0 10px 25px rgba(0,0,0,0.1);
                display: flex;
                align-items: center;
                justify-content: space-between;
                animation: slideIn 0.3s ease;
                border-left: 4px solid #4f46e5;
            }
            
            .notification-info {
                border-left-color: #3b82f6;
            }
            
            .notification-success {
                border-left-color: #10b981;
            }
            
            .notification-warning {
                border-left-color: #f59e0b;
            }
            
            .notification-error {
                border-left-color: #ef4444;
            }
            
            .notification-content {
                display: flex;
                align-items: center;
                gap: 0.75rem;
                flex: 1;
            }
            
            .notification-close {
                background: none;
                border: none;
                color: #94a3b8;
                cursor: pointer;
                padding: 0.25rem;
                margin-left: 1rem;
            }
            
            .notification-close:hover {
                color: #64748b;
            }
            
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            
            @keyframes slideOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }
        `;
    document.head.appendChild(style);
  }
}

function getNotificationIcon(type) {
  const icons = {
    info: "info-circle",
    success: "check-circle",
    warning: "exclamation-triangle",
    error: "exclamation-circle",
  };
  return icons[type] || "info-circle";
}

function animateHabitCompletion(element) {
  element.style.transform = "scale(1.05)";
  element.style.boxShadow = "0 20px 40px rgba(16, 185, 129, 0.3)";

  setTimeout(() => {
    element.style.transform = "scale(1)";
    element.style.boxShadow = "";
  }, 300);
}

function formatDate(date) {
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) {
    // Less than 1 minute
    return "Just now";
  } else if (diff < 3600000) {
    // Less than 1 hour
    return `${Math.floor(diff / 60000)}m ago`;
  } else if (diff < 86400000) {
    // Less than 1 day
    return `${Math.floor(diff / 3600000)}h ago`;
  } else {
    return date.toLocaleDateString();
  }
}

function getCSRFToken() {
  const metaTag = document.querySelector('meta[name="csrf-token"]');
  return metaTag ? metaTag.content : "";
}

function updateDashboardStats() {
  // Reload stats cards
  const statsCards = document.querySelectorAll(".stat-card .value");
  statsCards.forEach((card) => {
    // Animate number update
    const current = parseInt(card.textContent);
    const target = current + 1;

    animateNumber(card, current, target, 500);
  });
}

function animateNumber(element, start, end, duration) {
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const value = Math.floor(progress * (end - start) + start);
    element.textContent = value;
    if (progress < 1) {
      window.requestAnimationFrame(step);
    }
  };
  window.requestAnimationFrame(step);
}

function loadStatsChart(canvas) {
  const ctx = canvas.getContext("2d");

  // Sample data - replace with actual API call
  const data = {
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    datasets: [
      {
        label: "Habits Completed",
        data: [3, 5, 4, 6, 7, 8, 5],
        borderColor: "#4f46e5",
        backgroundColor: "rgba(79, 70, 229, 0.1)",
        fill: true,
        tension: 0.4,
      },
    ],
  };

  new Chart(ctx, {
    type: "line",
    data: data,
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
          max: 10,
        },
      },
    },
  });
}

function loadHabitsChart(canvas) {
  const ctx = canvas.getContext("2d");

  // Sample data - replace with actual API call
  const data = {
    labels: ["Exercise", "Read", "Meditate", "Code", "Learn"],
    datasets: [
      {
        data: [85, 70, 90, 95, 60],
        backgroundColor: [
          "#4f46e5",
          "#7c3aed",
          "#8b5cf6",
          "#a78bfa",
          "#c4b5fd",
        ],
      },
    ],
  };

  new Chart(ctx, {
    type: "doughnut",
    data: data,
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: "bottom",
        },
      },
    },
  });
}

// Update notification badge
function updateNotificationBadge(count) {
  console.log("🔄 Updating notification badge:", count);

  if (count !== undefined) {
    // Update badge with specific count
    const badge = document.querySelector(".notification-badge");
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? "inline-block" : "none";
    }
  } else {
    // Fetch latest count from server
    fetch("/api/notifications/unread-count")
      .then((response) => response.json())
      .then((data) => {
        const badge = document.querySelector(".notification-badge");
        if (badge) {
          badge.textContent = data.count;
          badge.style.display = data.count > 0 ? "inline-block" : "none";
        }
      })
      .catch((error) =>
        console.error("Error fetching notification count:", error)
      );
  }
}

// Export for use in other files
window.HabitHero = {
  showNotification,
  updateOnlineStatus,
  getCSRFToken,
  updateNotificationBadge,
  getSocket,
};
