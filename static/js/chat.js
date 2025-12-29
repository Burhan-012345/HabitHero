// chat.js - Complete with all features including context menu for delete, edit, and forward

class HabitHeroChat {
  constructor() {
    console.log("🚀 Initializing HabitHero Chat with complete status system");

    // Initialize audio players
    this.messageSound = new Audio("/static/audio/notification.mp3");
    this.notificationSound = new Audio("/static/audio/notification.ogg");

    // Configure audio
    this.messageSound.volume = 0.5;
    this.notificationSound.volume = 0.4;
    this.messageSound.preload = "auto";
    this.notificationSound.preload = "auto";

    // Track user focus and status
    this.isChatFocused = true;
    this.isWindowFocused = true;
    this.lastMessageSound = 0;
    this.soundCooldown = 1000;
    this.lastFriendStatus = "unknown";

    // Get configuration
    this.config = this.loadConfig();
    console.log("📋 Loaded config:", this.config);

    if (!this.config.chatUserId || !this.config.currentUserId) {
      console.error("❌ Missing required configuration:", this.config);
      this.showNotification(
        "Cannot initialize chat: Missing user information",
        "error"
      );
      return;
    }

    // Initialize core variables
    this.socket = null;
    this.messages = [];
    this.page = 1;
    this.hasMore = true;
    this.isLoading = false;
    this.isTyping = false;
    this.typingTimeout = null;
    this.connectionStatus = "connecting";
    this.lastSeenUpdate = null;
    this.messageQueue = new Map();
    this.pendingStatusCheck = null;
    this.offlineMessages = new Set();

    // Duplicate prevention variables
    this.lastSentMessage = null;
    this.lastSentTime = 0;
    this.isSending = false;
    this.messageCooldown = 2000;
    this.sentMessageHashes = new Set();

    // Track offline messages that need refresh when friend comes online
    this.pendingOfflineMessages = new Set();

    // Context menu variables
    this.contextMenu = null;
    this.currentContextMessageId = null;
    this.currentContextMessage = null;

    this.init();
  }

  loadConfig() {
    console.log("🔧 Loading chat configuration...");

    // Try multiple sources for configuration
    const sources = [
      () => window.CHAT_CONFIG || null,
      () => {
        const container = document.querySelector(".chat-container");
        if (container) {
          return {
            currentUserId: parseInt(container.dataset.currentUserId),
            currentUsername: container.dataset.currentUsername,
            chatUserId: parseInt(container.dataset.chatUserId),
            chatUsername: container.dataset.chatUsername,
            csrfToken: container.dataset.csrfToken || "",
          };
        }
        return null;
      },
      () => {
        const config = {};
        const userIdMeta = document.querySelector(
          'meta[name="current-user-id"]'
        );
        const chatIdMeta = document.querySelector('meta[name="chat-user-id"]');
        const csrfMeta = document.querySelector('meta[name="csrf-token"]');

        if (userIdMeta) config.currentUserId = parseInt(userIdMeta.content);
        if (chatIdMeta) config.chatUserId = parseInt(chatIdMeta.content);
        if (csrfMeta) config.csrfToken = csrfMeta.content;

        return Object.keys(config).length > 0 ? config : null;
      },
    ];

    // Try each source until we find valid config
    for (const source of sources) {
      try {
        const config = source();
        if (
          config &&
          config.chatUserId &&
          config.currentUserId &&
          !isNaN(config.chatUserId) &&
          !isNaN(config.currentUserId)
        ) {
          console.log("✅ Found config from source:", source.name || "unknown");
          return config;
        }
      } catch (error) {
        console.warn("⚠️ Error loading config from source:", error);
        continue;
      }
    }

    console.error("❌ Could not load chat configuration from any source");
    return {};
  }

  async init() {
    console.log("🔧 Initializing chat with config:", this.config);

    if (!this.config.chatUserId || !this.config.currentUserId) {
      console.error("❌ Cannot initialize: Missing user IDs");
      return;
    }

    this.setupUI();
    // Show initial connection status
    this.showConnectionStatus();
    this.setupFocusTracking();

    // Get immediate status FIRST before loading messages
    await this.getImmediateUserStatus();

    this.loadInitialMessages();
    this.setupSocket();
    this.setupEventListeners();
    this.setupAutoReconnect();
    this.setupActivityTracker();
    this.setupContextMenu(); // Add context menu setup

    // Preload sounds
    this.preloadSounds();

    // Start periodic status checks
    this.startStatusChecks();

    // Start message status checking
    this.startMessageStatusChecks();

    // Setup immediate offline handling
    this.setupImmediateOffline();

    // Setup context menu styles
    this.setupContextMenuStyles();
  }

  setupContextMenuStyles() {
    const style = document.createElement("style");
    style.textContent = `
      /* Context Menu Styles */
      .context-menu {
        position: absolute;
        background: rgba(20, 20, 30, 0.95);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(0, 180, 255, 0.3);
        border-radius: 8px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
        padding: 6px 0;
        min-width: 180px;
        z-index: 10000;
        display: none;
      }
      
      .context-menu-item {
        padding: 8px 16px;
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        transition: background 0.2s;
        color: #ffffff;
      }
      
      .context-menu-item:hover {
        background: rgba(0, 180, 255, 0.2) !important;
      }
      
      .context-menu-item.delete-item:hover {
        background: rgba(255, 107, 107, 0.2) !important;
        color: #ff6b6b !important;
      }
      
      .context-menu-item.delete-item:hover i {
        color: #ff6b6b !important;
      }
      
      .context-menu-item.edit-item:hover {
        background: rgba(0, 255, 157, 0.2) !important;
        color: #00ff9d !important;
      }
      
      .context-menu-item.edit-item:hover i {
        color: #00ff9d !important;
      }
      
      .context-menu-item.forward-item:hover {
        background: rgba(0, 180, 255, 0.2) !important;
        color: #00b4ff !important;
      }
      
      .context-menu-item.forward-item:hover i {
        color: #00b4ff !important;
      }
      
      /* Delete confirmation modal animations */
      @keyframes modalSlideIn {
        from {
          opacity: 0;
          transform: translateY(-20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      
      .delete-confirmation-modal > div,
      .forward-message-modal > div {
        animation: modalSlideIn 0.3s ease;
      }
      
      /* Friend selection in forward modal */
      .friend-item:hover {
        background: rgba(255, 255, 255, 0.1) !important;
        transform: translateX(5px);
      }
      
      .friend-item.selected {
        background: rgba(0, 255, 157, 0.1) !important;
        border-color: #00ff9d !important;
      }
      
      /* Edited message indicator */
      .message-bubble.edited::after {
        content: '(edited)';
        display: inline-block;
        color: #00ff9d;
        font-size: 0.75rem;
        margin-left: 8px;
        font-style: italic;
      }
      
      /* Message with overlay for deleted messages */
      .message.deleted .message-bubble {
        opacity: 0.5;
        position: relative;
      }
      
      .message.deleted .message-bubble::after {
        content: 'This message was deleted';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: #8899aa;
        font-style: italic;
        font-size: 0.9rem;
        background: rgba(0, 0, 0, 0.7);
        padding: 5px 10px;
        border-radius: 5px;
        white-space: nowrap;
      }
      
      /* Forwarded message styling */
      .message.forwarded .message-bubble {
        border-left: 3px solid #00b4ff;
        padding-left: 10px;
      }
      
      .message.forwarded .message-content::before {
        content: '↪️ ';
        margin-right: 5px;
      }
    `;
    document.head.appendChild(style);
  }

  async getImmediateUserStatus() {
    console.log(
      "⚡ Getting immediate user status for:",
      this.config.chatUserId
    );

    try {
      const response = await fetch(
        "/api/user/" + this.config.chatUserId + "/status"
      );
      if (!response.ok) {
        throw new Error("HTTP " + response.status + "");
      }

      const data = await response.json();

      if (data.success) {
        console.log("✅ Immediate status received:", data);
        this.updateUserStatusImmediately(data.status, data);

        if (data.status === "online") {
          this.updateOfflineMessagesToDelivered();
          // Refresh messages when friend comes online
          setTimeout(() => {
            this.forceRefreshMessages();
          }, 1000);
        }

        return data;
      }
    } catch (error) {
      console.error("❌ Error getting immediate status:", error);
    }
    return null;
  }

  preloadSounds() {
    console.log("🔊 Preloading notification sounds...");

    try {
      this.messageSound.load();
      this.notificationSound.load();
      console.log("✅ Sounds preloaded successfully");
    } catch (error) {
      console.warn("⚠️ Could not preload sounds:", error);
    }
  }

  setupUI() {
    console.log("🎨 Setting up UI");

    // Auto-resize textarea
    const textarea = document.getElementById("messageInput");
    if (textarea) {
      textarea.addEventListener("input", function () {
        this.style.height = "auto";
        this.style.height = Math.min(this.scrollHeight, 120) + "px";
      });

      textarea.addEventListener("focus", () => {
        this.isChatFocused = true;
      });

      textarea.addEventListener("blur", () => {
        this.isChatFocused = false;
      });
    }

    // Focus on input
    setTimeout(() => {
      const input = document.getElementById("messageInput");
      if (input) input.focus();
    }, 100);

    // Show connection status
    this.showConnectionStatus();
  }

  setupFocusTracking() {
    window.addEventListener("focus", () => {
      this.isWindowFocused = true;
      this.isChatFocused = true;
      console.log("🪟 Window focused");
      this.markMessagesAsRead();
      this.requestUserStatus();
    });

    window.addEventListener("blur", () => {
      this.isWindowFocused = false;
      console.log("🪟 Window blurred");
    });

    const chatContainer = document.querySelector(".chat-container");
    if (chatContainer) {
      chatContainer.addEventListener("mouseenter", () => {
        this.isChatFocused = true;
      });

      chatContainer.addEventListener("mouseleave", () => {
        this.isChatFocused = false;
      });
    }
  }

  async loadInitialMessages() {
    console.log(
      "📂 Loading initial messages for user:",
      this.config.chatUserId
    );

    if (!this.config.chatUserId || isNaN(this.config.chatUserId)) {
      console.error("❌ Invalid chatUserId:", this.config.chatUserId);
      this.showNotification("Cannot load messages: Invalid chat user", "error");
      return;
    }

    try {
      this.isLoading = true;

      const messagesContainer = document.getElementById("messagesContainer");
      if (
        messagesContainer &&
        !messagesContainer.querySelector(".loading-messages")
      ) {
        messagesContainer.innerHTML = `
          <div class="loading-messages">
            <div class="spinner"></div>
            <p>Loading messages...</p>
          </div>
        `;
      }

      // Add cache-busting parameter to prevent browser caching
      const cacheBuster = new Date().getTime();
      const response = await fetch(
        "/api/chat/" + this.config.chatUserId + "/messages?_=" + cacheBuster
      );

      if (!response.ok) {
        throw new Error(
          "HTTP " + response.status + ": " + (await response.text()) + ""
        );
      }

      const data = await response.json();
      console.log("📨 Received response:", data);

      if (data.success) {
        this.messages = data.messages.reverse();
        this.hasMore = data.has_next;
        this.renderMessages();
        this.scrollToBottom();

        // MARK AS READ IMMEDIATELY when loading chat
        this.markMessagesAsRead();

        console.log("✅ Loaded " + this.messages.length + " messages");
      } else {
        console.error("❌ API returned error:", data.message);
        this.showNotification(
          data.message || "Failed to load messages",
          "error"
        );
      }
    } catch (error) {
      console.error("❌ Error loading messages:", error);
      this.showNotification(
        "Failed to load messages: " + error.message + "",
        "error"
      );

      const messagesContainer = document.getElementById("messagesContainer");
      if (messagesContainer) {
        messagesContainer.innerHTML = `
          <div class="error-loading">
            <i class="fas fa-exclamation-triangle"></i>
            <h4>Failed to load messages</h4>
            <p>${error.message}</p>
            <button class="btn btn-retry" onclick="window.chat.refreshMessages()">
              <i class="fas fa-redo"></i> Try Again
            </button>
          </div>
        `;
      }
    } finally {
      this.isLoading = false;
    }
  }

  setupSocket() {
    console.log("🔌 Setting up socket connection");

    this.socket = window.getSocket ? window.getSocket() : null;

    if (!this.socket) {
      console.warn("⚠️ Socket.IO not available, using HTTP fallback");
      this.connectionStatus = "http-only";
      this.showConnectionStatus();
      return;
    }

    console.log("✅ Socket instance found:", this.socket.id);

    this.socket.on("connect", () => {
      console.log("✅ Socket connected");
      this.connectionStatus = "connected";
      this.showConnectionStatus();
      this.joinChat();
      this.updateUserStatus("online");
      this.requestUserStatus();

      // Remove any connecting/disconnected messages
      setTimeout(() => {
        const statusElements = document.querySelectorAll(".connection-status");
        statusElements.forEach((el) => el.remove());
      }, 1000);
    });

    this.socket.on("disconnect", (reason) => {
      console.log("❌ Socket disconnected, reason:", reason);
      this.connectionStatus = "disconnected";
      this.showConnectionStatus();
      this.updateUserStatus("offline");
      this.messageQueue.clear();
    });

    this.socket.on("connect_error", (error) => {
      console.error("Socket connection error:", error);
      this.connectionStatus = "error";
      this.showConnectionStatus();
    });

    this.socket.on("user_status", (data) => {
      console.log("👤 User status update:", data);
      if (data.user_id === this.config.chatUserId) {
        if (data.instant && data.status === "offline") {
          this.updateUserStatusImmediately("offline", data);
        } else {
          this.updateUserStatus(data.status, data);

          // 🔥 CRITICAL: Refresh messages when friend comes online
          if (data.status === "online") {
            console.log("🎯 Friend came online - refreshing messages...");

            // Small delay to ensure server has processed everything
            setTimeout(() => {
              this.forceRefreshMessages();

              // Show notification
              this.showNotification(
                "" +
                  this.config.chatUsername +
                  " is now online - updating messages",
                "info"
              );
            }, 500);
          }
        }
      }
    });

    this.socket.on("status_response", (data) => {
      console.log("📊 Status response:", data);
      if (data.user_id === this.config.chatUserId) {
        this.updateUserStatus(data.status, data);

        // Refresh messages when status response shows friend is online
        if (data.status === "online") {
          console.log(
            "🎯 Status response: Friend is online - refreshing messages"
          );
          setTimeout(() => {
            this.forceRefreshMessages();
          }, 500);
        }
      }
    });

    this.socket.on("new_message", (data) => {
      console.log("📨 Received new message:", data);
      this.handleIncomingMessage(data);
    });

    this.socket.on("receive_message", (data) => {
      console.log("💬 Received message in chat room:", data);
      if (data.message) {
        this.handleIncomingMessage(data.message);
      }
    });

    this.socket.on("user_typing", (data) => {
      console.log("⌨️ Typing indicator:", data);
      if (data.user_id === this.config.chatUserId) {
        this.showTypingIndicator(data.is_typing);
      }
    });

    this.socket.on("message_delivered", (data) => {
      console.log("✅ Message delivered:", data);
      if (data.temp_id) {
        this.updateMessageStatus(data.temp_id, "delivered", data.message_id);

        // Remove from pending offline messages
        this.pendingOfflineMessages.delete(data.temp_id);
      }
    });

    // CRITICAL: Handle immediate status updates from server
    this.socket.on("message_status_update", (data) => {
      console.log("🔄 IMMEDIATE Message status update from server:", data);
      if (data.message_id) {
        // Update immediately on both sides
        this.updateMessageStatusById(data.message_id, data.status);

        // Also update in messages array for consistency
        const messageIndex = this.messages.findIndex(
          (m) => m.id === data.message_id
        );
        if (messageIndex !== -1) {
          this.messages[messageIndex].status = data.status;
          if (data.status === "read") {
            this.messages[messageIndex].is_read = true;
          }
        }
      }
    });

    this.socket.on("messages_read", (data) => {
      console.log("📖 Messages read event:", data);
      this.handleMessagesRead(data);
    });

    this.socket.on("messages_marked_read", (data) => {
      console.log("📖 Messages marked read in chat:", data);
      if (data.sender_id === this.config.currentUserId) {
        this.markOurMessagesAsRead();
      }
    });

    this.socket.on("send_message_error", (data) => {
      console.error("Send message error:", data);
      if (data.temp_id) {
        this.updateMessageStatus(data.temp_id, "failed");
      }
      this.showNotification(data.error || "Failed to send message", "error");
    });

    this.socket.on("chat_joined", (data) => {
      console.log("🤝 Joined chat room:", data);
    });

    // Friend request notifications
    this.socket.on("friend_request", (data) => {
      console.log("🤝 Friend request:", data);
      this.playNotificationSound("website");
      this.showNotification("Friend request from " + data.from + "", "info");
    });

    this.socket.on("friend_request_accepted", (data) => {
      console.log("✅ Friend request accepted:", data);
      this.playNotificationSound("website");
      this.showNotification(
        "" + data.from + " accepted your friend request!",
        "success"
      );
    });

    this.socket.on("new_snap", (data) => {
      console.log("📸 New snap:", data);
      this.playNotificationSound("website");
      this.showNotification("New snap from " + data.from + "", "info");
    });

    this.socket.on("snap_viewed", (data) => {
      console.log("👀 Snap viewed:", data);
      this.showNotification("" + data.viewer + " viewed your snap", "info");
    });

    this.socket.on("snap_reaction", (data) => {
      console.log("😀 Snap reaction:", data);
      this.showNotification("" + data.from + " reacted to your snap", "info");
    });

    this.socket.on("new_notification", (data) => {
      console.log("🔔 New notification:", data);
      if (data.notification) {
        this.playNotificationSound("website");
        this.showNotification(data.notification.text, "info");
      }
    });

    this.socket.on("notification_count_update", (data) => {
      console.log("🔢 Notification count update:", data);
    });

    // Add these new socket handlers for message operations
    this.socket.on("message_deleted", (data) => {
      console.log("🗑️ Message deleted notification:", data);

      if (data.message_id) {
        const messageElement = document.querySelector(
          `[data-message-id="${data.message_id}"]`
        );
        if (messageElement) {
          messageElement.style.opacity = "0.3";
          messageElement.style.pointerEvents = "none";

          const overlay = document.createElement("div");
          overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #8899aa;
            font-style: italic;
            font-size: 0.9rem;
            border-radius: 8px;
          `;
          overlay.textContent = "This message was deleted";
          messageElement.appendChild(overlay);

          // Add deleted class
          messageElement.classList.add("deleted");
        }
      }
    });

    this.socket.on("message_edited", (data) => {
      console.log("✏️ Message edited notification:", data);

      if (data.message_id) {
        const messageElement = document.querySelector(
          `[data-message-id="${data.message_id}"]`
        );
        if (messageElement) {
          const contentDiv = messageElement.querySelector(".message-content");
          if (contentDiv) {
            contentDiv.innerHTML =
              this.escapeHtml(data.new_content) +
              '<span style="color: #00ff9d; font-size: 0.8rem; margin-left: 8px; font-style: italic;">(edited)</span>';
          }
        }
      }
    });

    this.socket.on("message_forwarded", (data) => {
      console.log("↪️ Message forwarded notification:", data);

      if (data.forwarded_message) {
        // If we're currently chatting with the sender, show the forwarded message
        if (data.forwarded_message.sender_id === this.config.chatUserId) {
          this.handleIncomingMessage(data.forwarded_message);
          this.showNotification(
            "" + data.from_username + " forwarded you a message",
            "info"
          );
        }
      }
    });

    if (this.socket.connected) {
      console.log("✅ Socket already connected");
      this.connectionStatus = "connected";
      this.joinChat();
      this.requestUserStatus();
    }
  }

  joinChat() {
    if (this.socket && this.socket.connected && this.config.chatUserId) {
      console.log("🤝 Joining chat with user:", this.config.chatUserId);
      this.socket.emit("join_chat", {
        user_id: this.config.chatUserId,
      });
    }
  }

  requestUserStatus() {
    if (this.socket && this.socket.connected && this.config.chatUserId) {
      console.log("📊 Requesting status for user:", this.config.chatUserId);
      this.socket.emit("request_status", {
        user_id: this.config.chatUserId,
      });
    }
  }

  setupEventListeners() {
    console.log("🎮 Setting up event listeners");

    const sendBtn = document.getElementById("sendMessageBtn");
    if (sendBtn) {
      sendBtn.addEventListener("click", (e) => {
        e.preventDefault();
        this.sendMessage();
      });
    }

    const messageInput = document.getElementById("messageInput");
    if (messageInput) {
      messageInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });

      messageInput.addEventListener("input", () => {
        this.handleTyping();
      });
    }

    const loadMoreBtn = document.getElementById("loadMoreBtn");
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener("click", () => {
        this.loadMoreMessages();
      });
    }

    const messagesContainer = document.getElementById("messagesContainer");
    if (messagesContainer) {
      messagesContainer.addEventListener("scroll", () => {
        this.checkAndMarkMessagesAsRead();
      });
    }
  }

  playNotificationSound(type = "message") {
    const now = Date.now();

    if (now - this.lastMessageSound < this.soundCooldown) {
      console.log("⏸️ Sound cooldown active, skipping");
      return;
    }

    this.lastMessageSound = now;

    try {
      if (type === "message") {
        this.messageSound.currentTime = 0;
        this.messageSound.play().catch((e) => {
          console.warn("⚠️ Could not play message sound:", e);
        });
        console.log("🔊 Playing message notification sound");
      } else if (type === "website") {
        this.notificationSound.currentTime = 0;
        this.notificationSound.play().catch((e) => {
          console.warn("⚠️ Could not play notification sound:", e);
        });
        console.log("🔔 Playing website notification sound");
      }
    } catch (error) {
      console.error("❌ Error playing sound:", error);
    }
  }

  async sendMessage() {
    console.log("📨 Attempting to send message");

    const input = document.getElementById("messageInput");
    if (!input) return;

    const content = input.value.trim();
    if (!content) {
      console.log("⚠️ Empty message, skipping");
      return;
    }

    console.log("Message content:", content);

    const now = Date.now();

    if (this.isSending) {
      console.log("⏸️ Already sending a message, skipping");
      return;
    }

    if (
      this.lastSentMessage === content &&
      now - this.lastSentTime < this.messageCooldown
    ) {
      console.log("🔄 Preventing duplicate message within cooldown period");
      return;
    }

    const messageHash = this.createMessageHash(content);
    if (this.sentMessageHashes.has(messageHash)) {
      console.log("🔄 Message hash already exists, skipping");
      return;
    }

    this.isSending = true;

    try {
      this.sentMessageHashes.add(messageHash);
      this.lastSentMessage = content;
      this.lastSentTime = now;

      input.value = "";
      input.style.height = "auto";

      const tempId =
        "temp_" +
        Date.now() +
        "_" +
        Math.random().toString(36).substr(2, 9) +
        "";

      if (this.messageQueue.has(tempId)) {
        console.log("⚠️ Message already in queue, skipping");
        return;
      }

      const isFriendOnline = this.isFriendOnline();
      const initialStatus = "sent"; // Always start with sent

      this.messageQueue.set(tempId, {
        content: content,
        timestamp: new Date().toISOString(),
        status: initialStatus,
        sentWhileOffline: !isFriendOnline,
        sentViaSocket: false,
        sentViaHTTP: false,
        messageHash: messageHash,
      });

      if (!isFriendOnline) {
        this.offlineMessages.add(tempId);
        // Track this as pending offline message
        this.pendingOfflineMessages.add(tempId);
        console.log(
          "📝 Message sent while friend offline - will refresh when they come online"
        );
      }

      const tempMessage = {
        id: tempId,
        sender_id: this.config.currentUserId,
        sender_username: this.config.currentUsername,
        content: content,
        timestamp: new Date().toISOString(),
        is_read: false,
        is_own: true,
        temp: true,
        status: initialStatus,
      };

      this.addMessage(tempMessage);
      this.scrollToBottom();
      this.stopTyping();

      if (this.socket && this.socket.connected) {
        console.log("📤 Sending via Socket.IO only");
        await this.sendMessageSocketIO(content, tempId, isFriendOnline);
      } else {
        console.log("📤 Socket not connected, using HTTP only");
        await this.sendMessageHTTP(content, tempId);
      }

      // Auto-refresh messages after 1.5 seconds
      setTimeout(() => {
        this.forceRefreshMessages();
      }, 1500);
    } catch (error) {
      console.error("❌ Error in sendMessage:", error);
      this.showNotification("Failed to send message", "error");
    } finally {
      setTimeout(() => {
        this.isSending = false;
      }, 500);
    }
  }

  createMessageHash(content) {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString();
  }

  isFriendOnline() {
    const statusIndicator = document.querySelector(".status-indicator");
    return statusIndicator && statusIndicator.classList.contains("online");
  }

  async sendMessageSocketIO(content, tempId, isFriendOnline) {
    try {
      console.log("📤 Sending via Socket.IO");

      this.socket.emit("send_message", {
        receiver_id: this.config.chatUserId,
        content: content,
        temp_id: tempId,
        friend_online: isFriendOnline,
      });

      const msgData = this.messageQueue.get(tempId);
      if (msgData) {
        msgData.sentViaSocket = true;
        this.messageQueue.set(tempId, msgData);
      }

      console.log("✅ Socket.IO emit sent");
    } catch (error) {
      console.error("❌ Socket.IO send error:", error);
      const msgData = this.messageQueue.get(tempId);
      if (msgData) {
        msgData.status = "failed";
        this.messageQueue.set(tempId, msgData);
      }
      this.updateMessageStatus(tempId, "failed");
      this.showNotification("Failed to send via Socket.IO", "error");
    }
  }

  async sendMessageHTTP(content, tempId) {
    try {
      console.log("📡 Sending via HTTP API");

      const response = await fetch("/api/chat/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": this.config.csrfToken || "",
        },
        body: JSON.stringify({
          receiver_id: this.config.chatUserId,
          content: content,
        }),
      });

      const data = await response.json();

      if (data.success) {
        console.log("✅ HTTP send successful:", data);

        const isFriendOnline = this.isFriendOnline();
        const status = isFriendOnline ? "delivered" : "sent";

        const msgData = this.messageQueue.get(tempId);
        if (msgData) {
          msgData.sentViaHTTP = true;
          msgData.status = status;
          this.messageQueue.set(tempId, msgData);
        }

        this.updateMessageStatus(tempId, status, data.message.id);

        const messageIndex = this.messages.findIndex((m) => m.id === tempId);
        if (messageIndex !== -1) {
          this.messages[messageIndex] = data.message;
        }
      } else {
        console.error("❌ HTTP send failed:", data);
        const msgData = this.messageQueue.get(tempId);
        if (msgData) {
          msgData.status = "failed";
          this.messageQueue.set(tempId, msgData);
        }
        this.updateMessageStatus(tempId, "failed");
        this.showNotification(
          data.message || "Failed to send message",
          "error"
        );
      }
    } catch (error) {
      console.error("❌ HTTP send error:", error);
      const msgData = this.messageQueue.get(tempId);
      if (msgData) {
        msgData.status = "failed";
        this.messageQueue.set(tempId, msgData);
      }
      this.updateMessageStatus(tempId, "failed");
      this.showNotification("Failed to send message", "error");
    }
  }

  handleIncomingMessage(data) {
    const messageHash = this.createMessageHash(data.content);

    if (this.sentMessageHashes.has(messageHash)) {
      console.log("🔄 Duplicate incoming message detected, ignoring:", data.id);
      return;
    }

    console.log("➕ Adding new message to chat");

    const isFromOtherUser = data.sender_id === this.config.chatUserId;

    const message = {
      ...data,
      is_own: data.sender_id === this.config.currentUserId,
    };

    if (!message.timestamp) {
      message.timestamp = new Date().toISOString();
    }

    this.messages.push(message);
    this.addMessage(message);
    this.scrollToBottom();

    if (isFromOtherUser) {
      if (!this.isChatFocused || !this.isWindowFocused) {
        this.playNotificationSound("message");
      }

      if (this.isChatFocused && this.isWindowFocused) {
        // Mark as read immediately when receiving message while focused
        setTimeout(() => this.markMessagesAsRead(), 100);
      }
    }
  }

  addMessage(message) {
    const container = document.getElementById("messagesContainer");
    if (!container) return;

    const noMessages = container.querySelector(".no-messages");
    if (noMessages) noMessages.remove();

    const loading = container.querySelector(
      ".loading-messages, .error-loading"
    );
    if (loading) loading.remove();

    const messageDiv = document.createElement("div");
    messageDiv.className =
      "message " + (message.is_own ? "sent" : "received") + "";
    if (message.temp) messageDiv.classList.add("temp");
    if (message.is_forwarded) messageDiv.classList.add("forwarded");
    messageDiv.dataset.messageId = message.id;

    // SERVER STATUS ONLY - no client-side status generation
    const dbStatus = message.status || "sent";
    const isRead = message.is_read || false;
    const finalStatus = isRead ? "read" : dbStatus;

    messageDiv.dataset.status = finalStatus;
    messageDiv.dataset.isRead = isRead;

    // SERVER TIMESTAMP ONLY - Convert UTC to local time
    let timeStr = "Just now";
    let fullDateTime = "";
    let localTime = null;

    if (message.timestamp) {
      try {
        // Parse server timestamp (assume UTC if ends with Z)
        let timestamp = message.timestamp;
        if (!timestamp.endsWith("Z")) {
          timestamp += "Z";
        }

        const serverTime = new Date(timestamp);

        if (!isNaN(serverTime.getTime())) {
          // Convert to local time
          localTime = serverTime;

          // Format local time
          timeStr = localTime.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          });

          // Full date-time for tooltip
          fullDateTime = localTime.toLocaleString([], {
            weekday: "short",
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
          });
        } else {
          console.warn("Invalid server timestamp:", message.timestamp);
          timeStr = "Just now";
          fullDateTime = new Date().toLocaleString();
        }
      } catch (error) {
        console.error(
          "Error parsing server timestamp:",
          error,
          message.timestamp
        );
        timeStr = "Just now";
        fullDateTime = new Date().toLocaleString();
      }
    }

    // Determine status class and tick icon from SERVER STATUS
    let statusClass = finalStatus;
    let tickIcon = this.getTickIconForStatus(statusClass);

    // Apply styling based on SERVER STATUS
    let tickStyle = "";
    if (statusClass === "read") {
      tickStyle =
        'style="color: #00ff9d !important; text-shadow: 0 0 5px rgba(0, 255, 157, 0.5) !important;"';
    } else if (statusClass === "delivered") {
      tickStyle = 'style="color: #ffffff !important;"';
    } else if (statusClass === "sent" || statusClass === "sent_offline") {
      tickStyle = 'style="color: #888888 !important;"';
    } else if (statusClass === "failed") {
      tickStyle = 'style="color: #ff6b6b !important;"';
    }

    // Check if message is edited
    const editedIndicator = message.edited
      ? '<span style="color: #00ff9d; font-size: 0.8rem; margin-left: 8px; font-style: italic;">(edited)</span>'
      : "";

    messageDiv.innerHTML = `
      <div class="message-bubble ${statusClass}">
        <div class="message-content">${this.escapeHtml(
          message.content
        )}${editedIndicator}</div>
        <div class="message-footer">
          <span class="message-time" title="${fullDateTime}">${timeStr}</span>
          ${
            message.is_own
              ? `<span class="read-status"><span class="tick" ${tickStyle}>${tickIcon}</span></span>`
              : ""
          }
        </div>
      </div>
    `;

    const loadMoreContainer = container.querySelector(".load-more-container");
    if (loadMoreContainer && !message.temp) {
      container.insertBefore(messageDiv, loadMoreContainer);
    } else {
      container.appendChild(messageDiv);
    }

    // Store the server timestamp for consistency
    if (localTime) {
      messageDiv.dataset.serverTime = message.timestamp;
      messageDiv.dataset.localTime = localTime.getTime();
    }

    // Add contextmenu event listener for right-click
    messageDiv.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showContextMenu(
        e.clientX,
        e.clientY,
        message.id,
        message.is_own,
        message
      );
    });
  }

  getTickIconForStatus(status) {
    // Based on SERVER STATUS only - WhatsApp-like behavior
    switch (status) {
      case "sending":
        return ""; // No tick while sending
      case "sent":
      case "sent_offline":
        return "✓"; // Single gray tick
      case "delivered":
        return "✓✓"; // Double gray tick
      case "read":
        return "✓✓"; // Double green tick (styled differently)
      case "failed":
        return "!"; // Exclamation for failed
      default:
        return "✓"; // Default single tick
    }
  }

  updateMessageStatus(messageId, status, realId = null) {
    const messageElement = document.querySelector(
      '[data-message-id="' + messageId + '"]'
    );
    if (!messageElement) return;

    const bubble = messageElement.querySelector(".message-bubble");
    if (!bubble) return;

    // Remove all status classes
    bubble.classList.remove(
      "sending",
      "sent",
      "sent_offline",
      "delivered",
      "read",
      "failed"
    );
    bubble.classList.add(status);

    // Update tick icon based on SERVER STATUS
    const tickSpan = bubble.querySelector(".tick");
    if (tickSpan) {
      tickSpan.textContent = this.getTickIconForStatus(status);

      // Apply styling based on SERVER STATUS
      if (status === "read") {
        tickSpan.style.color = "#00ff9d !important";
        tickSpan.style.textShadow = "0 0 5px rgba(0, 255, 157, 0.5) !important";
      } else if (status === "delivered") {
        tickSpan.style.color = "#ffffff !important";
        tickSpan.style.textShadow = "";
      } else if (status === "sent" || status === "sent_offline") {
        tickSpan.style.color = "#888888 !important";
        tickSpan.style.textShadow = "";
      } else if (status === "failed") {
        tickSpan.style.color = "#ff6b6b !important";
        tickSpan.style.textShadow = "";
      } else {
        tickSpan.style.color = "#888888 !important";
        tickSpan.style.textShadow = "";
      }
    }

    // Update data attribute with SERVER STATUS
    messageElement.dataset.status = status;

    if (realId) {
      messageElement.dataset.messageId = realId;
    }

    messageElement.classList.remove("temp");

    if (this.messageQueue.has(messageId)) {
      const msgData = this.messageQueue.get(messageId);
      this.messageQueue.set(messageId, {
        ...msgData,
        status: status,
      });

      if (status === "delivered" || status === "read") {
        this.offlineMessages.delete(messageId);
        this.pendingOfflineMessages.delete(messageId);
      }
    }
  }

  updateMessageStatusById(messageId, status) {
    const messageElement = document.querySelector(
      '[data-message-id="' + messageId + '"]'
    );
    if (!messageElement) return;

    this.updateMessageStatus(messageId, status);
  }

  updateMessageReadStatus(messageId, isRead) {
    const messageElement = document.querySelector(
      '[data-message-id="' + messageId + '"]'
    );
    if (!messageElement) return;

    const bubble = messageElement.querySelector(".message-bubble");
    if (!bubble) return;

    if (isRead) {
      bubble.classList.remove("sent", "sent_offline", "delivered");
      bubble.classList.add("read");

      const tickSpan = bubble.querySelector(".tick");
      if (tickSpan) {
        tickSpan.textContent = "✓✓";
        tickSpan.style.color = "#00ff9d !important";
        tickSpan.style.textShadow = "0 0 5px rgba(0, 255, 157, 0.5) !important";
      }

      messageElement.dataset.isRead = "true";
      messageElement.dataset.status = "read";
    }
  }

  markOurMessagesAsRead() {
    console.log("✅ Marking our messages as read");

    const ourMessages = document.querySelectorAll(
      ".message.sent .message-bubble"
    );
    ourMessages.forEach((bubble) => {
      bubble.classList.remove("sent", "sent_offline", "delivered");
      bubble.classList.add("read");

      const tickSpan = bubble.querySelector(".tick");
      if (tickSpan) {
        tickSpan.textContent = "✓✓";
        tickSpan.style.color = "#00ff9d !important";
        tickSpan.style.textShadow = "0 0 5px rgba(0, 255, 157, 0.5) !important";
      }
    });

    this.messages.forEach((msg) => {
      if (msg.is_own) {
        msg.is_read = true;
        msg.status = "read";
      }
    });
  }

  handleMessagesRead(data) {
    if (data.sender_id === this.config.chatUserId) {
      console.log("✅ Our messages were read by", data.reader_username);
      this.markOurMessagesAsRead();
      this.showNotification(
        "" + data.reader_username + " read your messages",
        "info"
      );
    }
  }

  handleTyping() {
    const input = document.getElementById("messageInput");
    if (!input || !this.socket || !this.socket.connected) return;

    const hasContent = input.value.trim().length > 0;

    if (hasContent && !this.isTyping) {
      this.isTyping = true;
      this.socket.emit("typing", {
        receiver_id: this.config.chatUserId,
        is_typing: true,
      });
    } else if (!hasContent && this.isTyping) {
      this.isTyping = false;
      this.socket.emit("typing", {
        receiver_id: this.config.chatUserId,
        is_typing: false,
      });
    }

    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }

    if (hasContent) {
      this.typingTimeout = setTimeout(() => {
        if (this.isTyping) {
          this.isTyping = false;
          this.socket.emit("typing", {
            receiver_id: this.config.chatUserId,
            is_typing: false,
          });
        }
      }, 2000);
    }
  }

  stopTyping() {
    if (this.isTyping && this.socket && this.socket.connected) {
      this.isTyping = false;
      this.socket.emit("typing", {
        receiver_id: this.config.chatUserId,
        is_typing: false,
      });
    }

    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = null;
    }
  }

  showTypingIndicator(show) {
    const indicator = document.getElementById("typingIndicator");
    if (!indicator) return;

    if (show) {
      indicator.classList.add("active");
    } else {
      indicator.classList.remove("active");
    }
  }

  markMessagesAsRead() {
    if (this.socket && this.socket.connected) {
      console.log("📖 Marking messages as read IMMEDIATELY");
      this.socket.emit("mark_read", {
        sender_id: this.config.chatUserId,
      });
    } else {
      console.log(
        "⚠️ Socket not connected, using HTTP to mark messages as read"
      );
      this.markMessagesAsReadHTTP();
    }
  }

  async markMessagesAsReadHTTP() {
    try {
      const response = await fetch(
        "/api/chat/" + this.config.chatUserId + "/mark-read",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": this.config.csrfToken || "",
          },
          body: JSON.stringify({
            sender_id: this.config.chatUserId,
          }),
        }
      );

      const data = await response.json();
      if (data.success) {
        console.log("✅ HTTP marked messages as read");
        // Update UI immediately
        this.markOurMessagesAsRead();
      }
    } catch (error) {
      console.error("❌ Error marking messages as read via HTTP:", error);
    }
  }

  checkAndMarkMessagesAsRead() {
    const container = document.getElementById("messagesContainer");
    if (!container) return;

    const isAtBottom =
      container.scrollHeight - container.scrollTop <=
      container.clientHeight + 100;

    if (isAtBottom) {
      this.markMessagesAsRead();
    }
  }

  renderMessages(isAppend = false) {
    const container = document.getElementById("messagesContainer");
    if (!container) return;

    if (!isAppend) {
      const typingIndicator = container.querySelector(".typing-indicator");
      const loadMoreContainer = container.querySelector(".load-more-container");

      container.innerHTML = "";

      if (typingIndicator) container.appendChild(typingIndicator);
      if (loadMoreContainer) container.appendChild(loadMoreContainer);

      if (this.messages.length === 0) {
        container.innerHTML = `
          <div class="no-messages">
            <i class="fas fa-comments"></i>
            <h4>No messages yet</h4>
            <p>Start the conversation!</p>
          </div>
        `;
        return;
      }
    }

    const messagesToRender = isAppend
      ? this.messages.slice(0, 50)
      : this.messages;

    messagesToRender.forEach((message) => {
      this.addMessage(message);
    });
  }

  scrollToBottom() {
    const container = document.getElementById("messagesContainer");
    if (container) {
      setTimeout(() => {
        container.scrollTop = container.scrollHeight;
        this.checkAndMarkMessagesAsRead();
      }, 100);
    }
  }

  updateUserStatus(status, data = {}) {
    console.log("🔄 Updating user status to:", status, data);

    const previousStatus = this.lastFriendStatus;
    this.lastFriendStatus = status;

    const statusIndicator = document.querySelector(".status-indicator");
    const statusText = document.querySelector(".user-status span:last-child");

    if (statusIndicator) {
      statusIndicator.className = "status-indicator";
      statusIndicator.classList.add(status);

      if (status === "online") {
        statusIndicator.classList.add("pulse");
        setTimeout(() => {
          statusIndicator.classList.remove("pulse");
        }, 2000);
      } else {
        statusIndicator.classList.remove("pulse");
      }
    }

    if (statusText) {
      if (status === "online") {
        statusText.textContent = "Online";
        statusText.style.color = "#00ff9d";
        statusText.style.textShadow = "0 0 8px rgba(0, 255, 157, 0.5)";
      } else {
        statusText.textContent = "Offline";
        statusText.style.color = "";
        statusText.style.textShadow = "";
      }
    }

    // 🔥 CRITICAL: Refresh messages when friend comes online
    if (previousStatus === "offline" && status === "online") {
      console.log("🎯 Friend just came online - refreshing messages...");

      // Update offline messages to delivered
      this.updateOfflineMessagesToDelivered();

      // Refresh messages after a short delay
      setTimeout(() => {
        this.forceRefreshMessages();

        // Show notification
        this.showNotification(
          "" + this.config.chatUsername + " came online - updating messages",
          "info"
        );
      }, 1000);
    }

    if (statusIndicator && statusIndicator.dataset.lastStatus !== status) {
      statusIndicator.dataset.lastStatus = status;

      const isImmediateOffline = data.instant && status === "offline";

      if (status === "online") {
        this.showNotification(
          "" + this.config.chatUsername + " is now online",
          "info"
        );
      } else if (status === "offline" && !isImmediateOffline) {
        if (this.connectionStatus !== "disconnected") {
          this.showNotification(
            "" + this.config.chatUsername + " is now offline",
            "warning"
          );
        }
      }
    }
  }

  updateUserStatusImmediately(status, data = {}) {
    console.log("⚡ Immediate status update to:", status);

    const statusIndicator = document.querySelector(".status-indicator");
    const statusText = document.querySelector(".user-status span:last-child");

    if (statusIndicator) {
      statusIndicator.className = "status-indicator";
      statusIndicator.classList.add(status);

      if (status === "online") {
        statusIndicator.classList.add("pulse");
        setTimeout(() => {
          statusIndicator.classList.remove("pulse");
        }, 2000);
      }
    }

    if (statusText) {
      if (status === "online") {
        statusText.textContent = "Online";
        statusText.style.color = "#00ff9d";
        statusText.style.textShadow = "0 0 8px rgba(0, 255, 157, 0.5)";
      } else {
        statusText.textContent = "Offline";
        statusText.style.color = "";
        statusText.style.textShadow = "";
      }
    }

    this.lastFriendStatus = status;

    if (data.timestamp) {
      const timeAgo = this.getTimeAgo(new Date(data.timestamp));
      console.log("Status changed: " + status + " (" + timeAgo + ")");
    }
  }

  getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);

    if (diffSec < 60) {
      return "" + diffSec + " seconds ago";
    } else if (diffSec < 3600) {
      return "" + Math.floor(diffSec / 60) + " minutes ago";
    } else {
      return "" + Math.floor(diffSec / 3600) + " hours ago";
    }
  }

  updateOfflineMessagesToDelivered() {
    console.log("🔄 Updating offline messages to delivered status");

    this.offlineMessages.forEach((messageId) => {
      this.updateMessageStatus(messageId, "delivered");
    });

    this.offlineMessages.clear();

    this.messageQueue.forEach((data, messageId) => {
      if (
        data.status === "sent_offline" ||
        (data.status === "sent" && data.sentWhileOffline)
      ) {
        data.status = "delivered";
        data.sentWhileOffline = false;
      }
    });
  }

  showConnectionStatus() {
    const existingStatus = document.querySelector(".connection-status");
    if (existingStatus) existingStatus.remove();

    // Don't show status if we're connected or still connecting
    if (
      this.connectionStatus === "connected" ||
      this.connectionStatus === "connecting"
    ) {
      return;
    }

    // Only show disconnection/error messages after 2 seconds
    if (
      this.connectionStatus === "disconnected" ||
      this.connectionStatus === "error"
    ) {
      setTimeout(() => {
        // Check status again after delay
        if (
          this.connectionStatus === "disconnected" ||
          this.connectionStatus === "error"
        ) {
          this._showActualConnectionStatus();
        }
      }, 2000);
      return;
    }

    this._showActualConnectionStatus();
  }

  _showActualConnectionStatus() {
    const statusMessages = {
      disconnected: "Chat disconnected - reconnecting...",
      error: "Chat connection error",
      "http-only": "Using HTTP fallback (real-time chat unavailable)",
      connecting: "Connecting to chat server...",
      connected: "Chat connected",
    };

    const statusColors = {
      disconnected: "disconnected",
      error: "error",
      "http-only": "disconnected",
      connecting: "connecting",
      connected: "connected",
    };

    const statusDiv = document.createElement("div");
    statusDiv.className =
      "connection-status " + statusColors[this.connectionStatus];
    statusDiv.innerHTML =
      '<i class="fas fa-' +
      (this.connectionStatus === "connected"
        ? "check-circle"
        : "exclamation-triangle") +
      '"></i><span>' +
      statusMessages[this.connectionStatus] +
      "</span>";

    document.body.appendChild(statusDiv);

    if (this.connectionStatus === "connected") {
      setTimeout(() => {
        statusDiv.remove();
      }, 3000);
    }
  }

  showNotification(message, type = "info") {
    console.log("📢 " + type.toUpperCase() + ": " + message + "");

    if (type !== "message") {
      this.playNotificationSound("website");
    }

    const notification = document.createElement("div");
    notification.className = "notification notification-" + type;
    notification.style.cssText =
      "position: fixed;" +
      "top: 20px;" +
      "right: 20px;" +
      "padding: 12px 16px;" +
      "background: " +
      (type === "success"
        ? "rgba(0, 255, 157, 0.15)"
        : type === "warning"
        ? "rgba(255, 193, 7, 0.15)"
        : type === "error"
        ? "rgba(255, 107, 107, 0.15)"
        : type === "info"
        ? "rgba(0, 180, 255, 0.15)"
        : "rgba(255, 255, 255, 0.1)") +
      ";" +
      "color: " +
      (type === "success"
        ? "#00ff9d"
        : type === "warning"
        ? "#ffc107"
        : type === "error"
        ? "#ff6b6b"
        : type === "info"
        ? "#00b4ff"
        : "#ffffff") +
      ";" +
      "border-radius: 12px;" +
      "border: 1px solid " +
      (type === "success"
        ? "rgba(0, 255, 157, 0.3)"
        : type === "warning"
        ? "rgba(255, 193, 7, 0.3)"
        : type === "error"
        ? "rgba(255, 107, 107, 0.3)"
        : type === "info"
        ? "rgba(0, 180, 255, 0.3)"
        : "rgba(255, 255, 255, 0.2)") +
      ";" +
      "box-shadow: 0 4px 20px rgba(0,0,0,0.2);" +
      "z-index: 9999;" +
      "animation: slideIn 0.3s ease;" +
      "backdrop-filter: blur(10px);" +
      "max-width: 300px;" +
      "font-size: 0.9rem;" +
      "display: flex;" +
      "align-items: center;" +
      "gap: 10px;";

    notification.innerHTML =
      '<i class="fas fa-' +
      (type === "success"
        ? "check-circle"
        : type === "warning"
        ? "exclamation-triangle"
        : type === "error"
        ? "exclamation-circle"
        : type === "info"
        ? "info-circle"
        : "bell") +
      '"></i>' +
      "<span>" +
      message +
      "</span>";

    document.body.appendChild(notification);

    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 5000);
  }

  setupAutoReconnect() {
    setInterval(() => {
      if (
        this.socket &&
        !this.socket.connected &&
        this.connectionStatus !== "http-only"
      ) {
        console.log("🔄 Attempting to reconnect socket...");
        try {
          this.socket.connect();
        } catch (error) {
          console.error("Failed to reconnect:", error);
        }
      }
    }, 10000);
  }

  setupActivityTracker() {
    const updateLastSeen = () => {
      const now = Date.now();
      if (!this.lastSeenUpdate || now - this.lastSeenUpdate > 30000) {
        this.lastSeenUpdate = now;

        if (this.socket && this.socket.connected) {
          this.socket.emit("activity_ping", {
            timestamp: now,
          });
        }
      }
    };

    document.addEventListener("mousemove", updateLastSeen);
    document.addEventListener("keydown", updateLastSeen);
    document.addEventListener("click", updateLastSeen);
    document.addEventListener("scroll", updateLastSeen);

    updateLastSeen();
  }

  startStatusChecks() {
    setInterval(() => {
      this.requestUserStatus();
    }, 45000);

    if (this.socket) {
      this.socket.on("reconnect", () => {
        setTimeout(() => this.requestUserStatus(), 1000);
      });
    }
  }

  startMessageStatusChecks() {
    this.pendingStatusCheck = setInterval(() => {
      this.checkPendingMessageStatus();
    }, 30000);
  }

  checkPendingMessageStatus() {
    const now = Date.now();
    const checkMessages = [];

    this.messageQueue.forEach((data, messageId) => {
      if (
        (data.status === "sent" || data.status === "sent_offline") &&
        now - new Date(data.timestamp).getTime() > 10000
      ) {
        checkMessages.push(messageId);
      }
    });

    if (checkMessages.length > 0) {
      console.log(
        "🔄 Checking status of " + checkMessages.length + " pending messages"
      );
      this.requestMessageStatusUpdate(checkMessages);
    }
  }

  requestMessageStatusUpdate(messageIds) {
    if (this.socket && this.socket.connected) {
      this.socket.emit("request_message_status", {
        message_ids: messageIds,
        receiver_id: this.config.chatUserId,
      });
    }
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;

    let html = div.innerHTML;
    html = html.replace(/\n/g, "<br>");

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    html = html.replace(
      urlRegex,
      '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">$1</a>'
    );

    return html;
  }

  async loadMoreMessages() {
    if (this.isLoading || !this.hasMore) return;

    try {
      this.isLoading = true;
      this.page++;

      const loadMoreBtn = document.getElementById("loadMoreBtn");
      if (loadMoreBtn) {
        loadMoreBtn.disabled = true;
        loadMoreBtn.innerHTML =
          '<i class="fas fa-spinner fa-spin"></i><span>Loading...</span>';
      }

      const response = await fetch(
        "/api/chat/" +
          this.config.chatUserId +
          "/messages?page=" +
          this.page +
          "&_=" +
          new Date().getTime()
      );
      const data = await response.json();

      if (data.success && data.messages.length > 0) {
        const oldMessages = data.messages.reverse();
        this.messages = [...oldMessages, ...this.messages];
        this.hasMore = data.has_next;
        this.renderMessages(true);

        this.showNotification(
          "Loaded " + oldMessages.length + " older messages",
          "info"
        );
      } else {
        this.hasMore = false;
      }
    } catch (error) {
      console.error("Error loading more messages:", error);
      this.showNotification("Failed to load older messages", "error");
    } finally {
      this.isLoading = false;

      const loadMoreBtn = document.getElementById("loadMoreBtn");
      if (loadMoreBtn) {
        loadMoreBtn.disabled = false;
        loadMoreBtn.innerHTML =
          '<i class="fas fa-history"></i><span>Load older messages</span>';

        if (!this.hasMore) {
          loadMoreBtn.style.display = "none";
        }
      }
    }
  }

  setupImmediateOffline() {
    window.addEventListener("beforeunload", () => {
      if (this.socket && this.socket.connected) {
        try {
          this.socket.emit("immediate_offline");
          console.log("⚡ Sent immediate offline notification");
        } catch (error) {
          console.error("Error sending immediate offline:", error);
        }
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        if (this.socket && this.socket.connected) {
          this.socket.emit("user_idle");
        }
      } else if (document.visibilityState === "visible") {
        if (this.socket && this.socket.connected) {
          this.requestUserStatus();
        }
      }
    });
  }

  checkAndUpdateConnection() {
    // If we have messages but still show disconnected, update status
    if (this.connectionStatus === "disconnected" && this.messages.length > 0) {
      console.log(
        "🔄 Detected active messages but disconnected status, updating..."
      );
      this.connectionStatus = "connected";
      this.showConnectionStatus();
    }
  }

  refreshMessages() {
    console.log("🔄 Refreshing messages (manual refresh)...");

    // Clear current messages to force a fresh load
    this.messages = [];
    this.page = 1;
    this.hasMore = true;

    // Clear the messages container
    const container = document.getElementById("messagesContainer");
    if (container) {
      container.innerHTML = `
        <div class="loading-messages">
          <div class="spinner"></div>
          <p>Refreshing messages...</p>
        </div>
      `;
    }

    // Reload messages from server
    this.loadInitialMessages().then(() => {
      console.log("✅ Messages refreshed");
      this.showNotification("Messages refreshed", "success");
    });
  }

  forceRefreshMessages() {
    console.log("🔄 FORCE Refreshing messages...");

    // Save scroll position
    const container = document.getElementById("messagesContainer");
    const scrollPos = container ? container.scrollTop : 0;

    // Add cache-busting parameter
    const cacheBuster = new Date().getTime();

    // Show loading indicator
    if (container) {
      const existingLoading = container.querySelector(".loading-messages");
      if (!existingLoading) {
        const loadingDiv = document.createElement("div");
        loadingDiv.className = "loading-messages";
        loadingDiv.style.cssText = `
          margin-top: 10px;
          text-align: center;
          padding: 10px;
          background: rgba(0,0,0,0.1);
          border-radius: 10px;
        `;
        loadingDiv.innerHTML = `
          <div class="spinner small"></div>
          <p>Updating messages...</p>
        `;
        container.appendChild(loadingDiv);
      }
    }

    // Fetch fresh messages
    fetch("/api/chat/" + this.config.chatUserId + "/messages?_=" + cacheBuster)
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          this.messages = data.messages.reverse();
          this.hasMore = data.has_next;
          this.renderMessages();

          // Restore scroll position
          if (container) {
            setTimeout(() => {
              container.scrollTop = scrollPos;
            }, 100);
          }

          console.log(
            "✅ Force refreshed " + this.messages.length + " messages"
          );
        }
      })
      .catch((error) => {
        console.error("❌ Error force refreshing messages:", error);
        this.showNotification("Failed to refresh messages", "error");
      })
      .finally(() => {
        // Remove loading indicator
        if (container) {
          const loading = container.querySelector(".loading-messages");
          if (loading) loading.remove();
        }
      });
  }

  // ================= CONTEXT MENU METHODS =================

  setupContextMenu() {
    console.log("🎯 Setting up context menu for messages");

    // Create context menu
    this.contextMenu = document.createElement("div");
    this.contextMenu.className = "context-menu";
    document.body.appendChild(this.contextMenu);

    // Close context menu on click outside
    document.addEventListener("click", (e) => {
      if (this.contextMenu && !this.contextMenu.contains(e.target)) {
        this.hideContextMenu();
      }
    });

    // Close context menu on Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.hideContextMenu();
      }
    });
  }

  showContextMenu(x, y, messageId, isOwnMessage, message) {
    console.log("📋 Showing context menu for message:", messageId);

    // Clear previous menu
    this.contextMenu.innerHTML = "";
    this.currentContextMessageId = messageId;
    this.currentContextMessage = message;

    // Build menu items
    const menuItems = [];

    // Always show "Delete for me" option
    menuItems.push({
      icon: "fas fa-trash",
      text: "Delete for me",
      action: () => this.showDeleteOptions("me"),
      className: "delete-item",
    });

    // Only show "Delete for everyone" for own messages that are recent (within 5 minutes)
    if (isOwnMessage) {
      const messageTime = new Date(message.timestamp);
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

      if (messageTime > fiveMinutesAgo) {
        menuItems.push({
          icon: "fas fa-trash-alt",
          text: "Delete for everyone",
          action: () => this.showDeleteOptions("everyone"),
          className: "delete-item delete-everyone",
        });
      }

      // Only show "Edit" for own text messages that are recent (within 15 minutes)
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      if (messageTime > fifteenMinutesAgo) {
        menuItems.push({
          icon: "fas fa-edit",
          text: "Edit message",
          action: () => this.editMessage(messageId),
          className: "edit-item",
        });
      }
    }

    // Show "Forward" for all messages
    menuItems.push({
      icon: "fas fa-share",
      text: "Forward",
      action: () => this.showForwardModal(messageId),
      className: "forward-item",
    });

    // Add menu items
    menuItems.forEach((item) => {
      const menuItem = document.createElement("div");
      menuItem.className = `context-menu-item ${item.className}`;
      menuItem.style.cssText = `
        padding: 8px 16px;
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        transition: background 0.2s;
        color: #ffffff;
      `;

      menuItem.innerHTML = `
        <i class="${item.icon}"></i>
        <span>${item.text}</span>
      `;

      menuItem.addEventListener("click", (e) => {
        e.stopPropagation();
        item.action();
        this.hideContextMenu();
      });

      menuItem.addEventListener("mouseenter", () => {
        menuItem.style.background = "rgba(0, 180, 255, 0.2)";
      });

      menuItem.addEventListener("mouseleave", () => {
        menuItem.style.background = "";
      });

      this.contextMenu.appendChild(menuItem);
    });

    // Add separator
    const separator = document.createElement("div");
    separator.style.cssText = `
      height: 1px;
      background: rgba(255, 255, 255, 0.1);
      margin: 6px 0;
    `;
    this.contextMenu.appendChild(separator);

    // Add close option
    const closeItem = document.createElement("div");
    closeItem.className = "context-menu-item";
    closeItem.style.cssText = `
      padding: 8px 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      transition: background 0.2s;
      color: #8899aa;
    `;

    closeItem.innerHTML = `
      <i class="fas fa-times"></i>
      <span>Close</span>
    `;

    closeItem.addEventListener("click", () => this.hideContextMenu());
    this.contextMenu.appendChild(closeItem);

    // Position and show menu
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const menuWidth = 200;
    const menuHeight = this.contextMenu.offsetHeight;

    // Adjust position if near edges
    let posX = x;
    let posY = y;

    if (x + menuWidth > viewportWidth) {
      posX = viewportWidth - menuWidth - 10;
    }

    if (y + menuHeight > viewportHeight) {
      posY = viewportHeight - menuHeight - 10;
    }

    this.contextMenu.style.left = posX + "px";
    this.contextMenu.style.top = posY + "px";
    this.contextMenu.style.display = "block";
  }

  hideContextMenu() {
    if (this.contextMenu) {
      this.contextMenu.style.display = "none";
      this.currentContextMessageId = null;
      this.currentContextMessage = null;
    }
  }

  showDeleteOptions(deleteType) {
    console.log("🗑️ Showing delete options for:", deleteType);

    if (!this.currentContextMessageId) return;

    // Create confirmation modal
    const modal = document.createElement("div");
    modal.className = "delete-confirmation-modal";
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(5px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10001;
    `;

    const modalContent = document.createElement("div");
    modalContent.style.cssText = `
      background: rgba(20, 20, 30, 0.95);
      border: 1px solid rgba(0, 180, 255, 0.3);
      border-radius: 12px;
      padding: 25px;
      max-width: 400px;
      width: 90%;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    `;

    const messageText = this.currentContextMessage?.content || "";
    const truncatedText =
      messageText.length > 50
        ? messageText.substring(0, 47) + "..."
        : messageText;

    const deleteTitle =
      deleteType === "me" ? "Delete for yourself?" : "Delete for everyone?";

    const deleteMessage =
      deleteType === "me"
        ? `This message will be deleted from your chat history. "${truncatedText}"`
        : `This message will be deleted from everyone's chat history. "${truncatedText}"`;

    modalContent.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h3 style="color: #ffffff; margin-bottom: 10px; font-size: 1.2rem;">
          <i class="fas fa-trash" style="margin-right: 10px; color: #ff6b6b;"></i>
          ${deleteTitle}
        </h3>
        <p style="color: #8899aa; line-height: 1.5; font-size: 0.95rem;">
          ${deleteMessage}
        </p>
      </div>
      <div style="display: flex; gap: 10px; justify-content: flex-end;">
        <button class="cancel-btn" style="
          padding: 10px 20px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 6px;
          color: #ffffff;
          cursor: pointer;
          font-size: 0.95rem;
          transition: all 0.3s;
        ">
          Cancel
        </button>
        <button class="confirm-btn" style="
          padding: 10px 20px;
          background: linear-gradient(135deg, #ff6b6b 0%, #ee5a52 100%);
          border: none;
          border-radius: 6px;
          color: #0a0a0f;
          cursor: pointer;
          font-size: 0.95rem;
          font-weight: 600;
          transition: all 0.3s;
        ">
          <i class="fas fa-check" style="margin-right: 8px;"></i>
          Delete
        </button>
      </div>
    `;

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Add event listeners
    const cancelBtn = modalContent.querySelector(".cancel-btn");
    const confirmBtn = modalContent.querySelector(".confirm-btn");

    cancelBtn.addEventListener("click", () => {
      document.body.removeChild(modal);
    });

    confirmBtn.addEventListener("click", () => {
      this.deleteMessage(this.currentContextMessageId, deleteType);
      document.body.removeChild(modal);
    });

    // Close on click outside
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
  }

  async deleteMessage(messageId, deleteType) {
    console.log(`🗑️ Deleting message ${messageId} (${deleteType})`);

    try {
      const response = await fetch("/api/chat/message/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": this.config.csrfToken || "",
        },
        body: JSON.stringify({
          message_id: messageId,
          delete_type: deleteType,
        }),
      });

      const data = await response.json();

      if (data.success) {
        this.showNotification(
          `Message deleted ${deleteType === "me" ? "for you" : "for everyone"}`,
          "success"
        );

        // Remove from UI
        const messageElement = document.querySelector(
          `[data-message-id="${messageId}"]`
        );
        if (messageElement) {
          messageElement.style.opacity = "0.3";
          messageElement.style.pointerEvents = "none";

          if (deleteType === "me") {
            // Add "deleted for you" overlay
            const overlay = document.createElement("div");
            overlay.style.cssText = `
              position: absolute;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              background: rgba(0, 0, 0, 0.7);
              display: flex;
              align-items: center;
              justify-content: center;
              color: #8899aa;
              font-style: italic;
              font-size: 0.9rem;
              border-radius: 8px;
            `;
            overlay.textContent = "This message was deleted for you";
            messageElement.appendChild(overlay);
          } else {
            // Remove completely
            setTimeout(() => {
              messageElement.remove();
            }, 300);
          }
        }

        // Remove from messages array
        this.messages = this.messages.filter((m) => m.id != messageId);
      } else {
        this.showNotification(
          data.message || "Failed to delete message",
          "error"
        );
      }
    } catch (error) {
      console.error("Error deleting message:", error);
      this.showNotification("Failed to delete message", "error");
    }
  }

  editMessage(messageId) {
    console.log("✏️ Editing message:", messageId);

    const message = this.messages.find((m) => m.id == messageId);
    if (!message) return;

    const messageElement = document.querySelector(
      `[data-message-id="${messageId}"]`
    );
    if (!messageElement) return;

    const bubble = messageElement.querySelector(".message-bubble");
    const contentDiv = bubble.querySelector(".message-content");
    const originalText = message.content;

    // Create edit input
    const editContainer = document.createElement("div");
    editContainer.style.cssText = `
      position: relative;
      width: 100%;
    `;

    const textarea = document.createElement("textarea");
    textarea.value = originalText;
    textarea.style.cssText = `
      width: 100%;
      min-height: 60px;
      padding: 10px;
      background: rgba(255, 255, 255, 0.1);
      border: 2px solid #00b4ff;
      border-radius: 8px;
      color: #ffffff;
      font-family: inherit;
      font-size: 0.95rem;
      resize: vertical;
    `;

    const buttonContainer = document.createElement("div");
    buttonContainer.style.cssText = `
      display: flex;
      gap: 10px;
      margin-top: 10px;
      justify-content: flex-end;
    `;

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText = `
      padding: 8px 16px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      color: #ffffff;
      cursor: pointer;
      font-size: 0.9rem;
    `;

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save";
    saveBtn.style.cssText = `
      padding: 8px 16px;
      background: linear-gradient(135deg, #00b4ff 0%, #0088cc 100%);
      border: none;
      border-radius: 6px;
      color: #0a0a0f;
      cursor: pointer;
      font-size: 0.9rem;
      font-weight: 600;
    `;

    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(saveBtn);

    editContainer.appendChild(textarea);
    editContainer.appendChild(buttonContainer);

    // Replace content with edit form
    const oldContent = contentDiv.innerHTML;
    contentDiv.innerHTML = "";
    contentDiv.appendChild(editContainer);
    textarea.focus();

    cancelBtn.addEventListener("click", () => {
      contentDiv.innerHTML = oldContent;
    });

    saveBtn.addEventListener("click", async () => {
      const newText = textarea.value.trim();
      if (!newText || newText === originalText) {
        contentDiv.innerHTML = oldContent;
        return;
      }

      await this.saveEditedMessage(messageId, newText, contentDiv);
    });

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.ctrlKey) {
        e.preventDefault();
        saveBtn.click();
      }
      if (e.key === "Escape") {
        cancelBtn.click();
      }
    });
  }

  async saveEditedMessage(messageId, newText, contentDiv) {
    try {
      const response = await fetch("/api/chat/message/edit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": this.config.csrfToken || "",
        },
        body: JSON.stringify({
          message_id: messageId,
          new_content: newText,
        }),
      });

      const data = await response.json();

      if (data.success) {
        contentDiv.innerHTML =
          this.escapeHtml(newText) +
          '<span style="color: #00ff9d; font-size: 0.8rem; margin-left: 8px; font-style: italic;">(edited)</span>';

        this.showNotification("Message edited", "success");

        // Update in messages array
        const messageIndex = this.messages.findIndex((m) => m.id == messageId);
        if (messageIndex !== -1) {
          this.messages[messageIndex].content = newText;
          this.messages[messageIndex].edited = true;
        }
      } else {
        this.showNotification(
          data.message || "Failed to edit message",
          "error"
        );
      }
    } catch (error) {
      console.error("Error editing message:", error);
      this.showNotification("Failed to edit message", "error");
    }
  }

  showForwardModal(messageId) {
    console.log("↪️ Forwarding message:", messageId);

    const message = this.messages.find((m) => m.id == messageId);
    if (!message) return;

    // Create modal
    const modal = document.createElement("div");
    modal.className = "forward-message-modal";
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(5px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10001;
    `;

    const modalContent = document.createElement("div");
    modalContent.style.cssText = `
      background: rgba(20, 20, 30, 0.95);
      border: 1px solid rgba(0, 180, 255, 0.3);
      border-radius: 12px;
      padding: 25px;
      max-width: 500px;
      width: 90%;
      max-height: 80vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    `;

    modalContent.innerHTML = `
      <div style="margin-bottom: 20px; flex-shrink: 0;">
        <h3 style="color: #ffffff; margin-bottom: 15px; font-size: 1.3rem; display: flex; align-items: center; gap: 10px;">
          <i class="fas fa-share" style="color: #00b4ff;"></i>
          Forward Message
        </h3>
        <div class="message-preview" style="
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          padding: 15px;
          margin-bottom: 15px;
          border-left: 3px solid #00b4ff;
        ">
          <div style="color: #ffffff; font-size: 0.95rem; line-height: 1.4;">
            ${this.escapeHtml(message.content)}
          </div>
          <div style="color: #8899aa; font-size: 0.8rem; margin-top: 8px;">
            From: ${message.sender_username || "Unknown"}
          </div>
        </div>
      </div>
      
      <div style="margin-bottom: 20px; flex: 1; overflow-y: auto;">
        <h4 style="color: #ffffff; margin-bottom: 10px; font-size: 1rem;">
          <i class="fas fa-user-friends" style="margin-right: 8px;"></i>
          Select a friend to forward to:
        </h4>
        <div class="friends-list" style="
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 300px;
          overflow-y: auto;
        ">
          <div class="loading-friends" style="
            text-align: center;
            padding: 20px;
            color: #8899aa;
          ">
            <i class="fas fa-spinner fa-spin"></i>
            <span style="margin-left: 10px;">Loading friends...</span>
          </div>
        </div>
      </div>
      
      <div style="display: flex; gap: 10px; justify-content: flex-end; flex-shrink: 0;">
        <button class="cancel-btn" style="
          padding: 10px 20px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 6px;
          color: #ffffff;
          cursor: pointer;
          font-size: 0.95rem;
          transition: all 0.3s;
        ">
          Cancel
        </button>
        <button class="forward-btn" style="
          padding: 10px 20px;
          background: linear-gradient(135deg, #00b4ff 0%, #0088cc 100%);
          border: none;
          border-radius: 6px;
          color: #0a0a0f;
          cursor: pointer;
          font-size: 0.95rem;
          font-weight: 600;
          transition: all 0.3s;
          opacity: 0.5;
          pointer-events: none;
        ">
          <i class="fas fa-paper-plane" style="margin-right: 8px;"></i>
          Forward
        </button>
      </div>
    `;

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Add event listeners
    const cancelBtn = modalContent.querySelector(".cancel-btn");
    const forwardBtn = modalContent.querySelector(".forward-btn");
    const friendsList = modalContent.querySelector(".friends-list");

    let selectedFriendId = null;

    cancelBtn.addEventListener("click", () => {
      document.body.removeChild(modal);
    });

    forwardBtn.addEventListener("click", () => {
      if (selectedFriendId) {
        this.forwardMessage(messageId, selectedFriendId);
        document.body.removeChild(modal);
      }
    });

    // Load friends
    this.loadFriendsForForward(friendsList, forwardBtn, selectedFriendId);

    // Close on click outside
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
      }
    });
  }

  async loadFriendsForForward(friendsList, forwardBtn, selectedFriendId) {
    try {
      const response = await fetch("/api/friends");
      const friends = await response.json();

      friendsList.innerHTML = "";

      if (friends.length === 0) {
        friendsList.innerHTML = `
          <div style="text-align: center; padding: 30px; color: #8899aa;">
            <i class="fas fa-user-friends" style="font-size: 2rem; margin-bottom: 10px;"></i>
            <p>No friends found</p>
          </div>
        `;
        return;
      }

      // Filter out current chat user
      const filteredFriends = friends.filter(
        (friend) =>
          friend.id != this.config.chatUserId &&
          friend.id != this.config.currentUserId
      );

      if (filteredFriends.length === 0) {
        friendsList.innerHTML = `
          <div style="text-align: center; padding: 30px; color: #8899aa;">
            <i class="fas fa-user-friends" style="font-size: 2rem; margin-bottom: 10px;"></i>
            <p>No other friends to forward to</p>
          </div>
        `;
        return;
      }

      filteredFriends.forEach((friend) => {
        const friendItem = document.createElement("div");
        friendItem.className = "friend-item";
        friendItem.dataset.friendId = friend.id;
        friendItem.style.cssText = `
          padding: 12px 15px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          display: flex;
          align-items: center;
          gap: 12px;
          cursor: pointer;
          transition: all 0.3s;
          border: 2px solid transparent;
        `;

        // Create avatar
        const avatar = document.createElement("div");
        avatar.style.cssText = `
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: linear-gradient(135deg, #00b4ff 0%, #0088cc 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #0a0a0f;
          font-weight: 600;
          font-size: 1rem;
        `;
        avatar.textContent = friend.username.charAt(0).toUpperCase();

        const friendInfo = document.createElement("div");
        friendInfo.style.cssText = `
          flex: 1;
        `;

        const friendName = document.createElement("div");
        friendName.style.cssText = `
          color: #ffffff;
          font-weight: 600;
          font-size: 0.95rem;
        `;
        friendName.textContent = friend.username;

        const friendStatus = document.createElement("div");
        friendStatus.style.cssText = `
          color: #8899aa;
          font-size: 0.85rem;
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 2px;
        `;

        const statusDot = document.createElement("span");
        statusDot.style.cssText = `
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: ${friend.is_online ? "#00ff9d" : "#8899aa"};
          display: inline-block;
        `;

        friendStatus.appendChild(statusDot);
        friendStatus.appendChild(
          document.createTextNode(friend.is_online ? "Online" : "Offline")
        );

        friendInfo.appendChild(friendName);
        friendInfo.appendChild(friendStatus);

        friendItem.appendChild(avatar);
        friendItem.appendChild(friendInfo);

        // Add selection marker
        const checkmark = document.createElement("i");
        checkmark.className = "fas fa-check";
        checkmark.style.cssText = `
          color: #00ff9d;
          font-size: 1.2rem;
          opacity: 0;
          transition: opacity 0.3s;
        `;
        friendItem.appendChild(checkmark);

        // Click handler
        friendItem.addEventListener("click", () => {
          // Deselect previous
          const previouslySelected = friendsList.querySelector(".selected");
          if (previouslySelected) {
            previouslySelected.classList.remove("selected");
            previouslySelected.style.borderColor = "transparent";
            previouslySelected.querySelector(".fa-check").style.opacity = "0";
          }

          // Select new
          friendItem.classList.add("selected");
          friendItem.style.borderColor = "#00ff9d";
          checkmark.style.opacity = "1";

          selectedFriendId = friend.id;

          // Enable forward button
          forwardBtn.style.opacity = "1";
          forwardBtn.style.pointerEvents = "all";
        });

        friendsList.appendChild(friendItem);
      });
    } catch (error) {
      console.error("Error loading friends:", error);
      friendsList.innerHTML = `
        <div style="text-align: center; padding: 30px; color: #ff6b6b;">
          <i class="fas fa-exclamation-triangle"></i>
          <p>Failed to load friends</p>
        </div>
      `;
    }
  }

  async forwardMessage(messageId, toFriendId) {
    console.log(`↪️ Forwarding message ${messageId} to friend ${toFriendId}`);

    try {
      const message = this.messages.find((m) => m.id == messageId);
      if (!message) return;

      const response = await fetch("/api/chat/message/forward", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": this.config.csrfToken || "",
        },
        body: JSON.stringify({
          message_id: messageId,
          to_friend_id: toFriendId,
        }),
      });

      const data = await response.json();

      if (data.success) {
        this.showNotification("Message forwarded successfully!", "success");

        // If we're currently chatting with that friend, show the forwarded message
        if (toFriendId == this.config.chatUserId) {
          const forwardedMessage = {
            id: data.forwarded_message_id,
            sender_id: this.config.currentUserId,
            sender_username: this.config.currentUsername,
            content: "(Forwarded) " + message.content,
            timestamp: new Date().toISOString(),
            is_read: false,
            is_own: true,
            is_forwarded: true,
          };

          this.messages.push(forwardedMessage);
          this.addMessage(forwardedMessage);
          this.scrollToBottom();
        }
      } else {
        this.showNotification(
          data.message || "Failed to forward message",
          "error"
        );
      }
    } catch (error) {
      console.error("Error forwarding message:", error);
      this.showNotification("Failed to forward message", "error");
    }
  }

  destroy() {
    if (this.pendingStatusCheck) {
      clearInterval(this.pendingStatusCheck);
    }

    if (this.socket) {
      this.socket.disconnect();
    }

    this.messageQueue.clear();
    this.offlineMessages.clear();
    this.sentMessageHashes.clear();
    this.pendingOfflineMessages.clear();

    console.log("🧹 Chat system cleaned up");
  }
}

window.debugChat = () => {
  if (window.chat) {
    console.log("🔍 Chat Debug Info:");
    console.log("Config:", window.chat.config);
    console.log("Connection Status:", window.chat.connectionStatus);
    console.log("Messages Count:", window.chat.messages.length);
    console.log("Message Queue Size:", window.chat.messageQueue.size);
    console.log("Socket Connected:", window.chat.socket?.connected);
    console.log("Friend Status:", window.chat.lastFriendStatus);
    console.log(
      "Pending Offline Messages:",
      window.chat.pendingOfflineMessages.size
    );
  } else {
    console.error("Chat not initialized");
  }
};

document.addEventListener("DOMContentLoaded", () => {
  console.log("📄 DOMContentLoaded - Checking for chat container");

  if (document.querySelector(".chat-container")) {
    console.log("✅ Found chat container, initializing...");
    window.chat = new HabitHeroChat();
  } else {
    console.log("❌ No chat container found on this page");
  }
});

window.markMessagesAsRead = function () {
  if (window.chat) {
    window.chat.markMessagesAsRead();
  }
};

window.refreshChatMessages = function () {
  if (window.chat) {
    window.chat.refreshMessages();
  }
};

document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible" && window.chat) {
    window.chat.isWindowFocused = true;
    window.chat.markMessagesAsRead();
    window.chat.requestUserStatus();
  } else if (document.visibilityState === "hidden" && window.chat) {
    window.chat.isWindowFocused = false;
  }
});

window.addEventListener("focus", function () {
  if (window.chat) {
    window.chat.isWindowFocused = true;
    window.chat.markMessagesAsRead();
    window.chat.requestUserStatus();
  }
});

window.addEventListener("blur", function () {
  if (window.chat) {
    window.chat.isWindowFocused = false;
  }
});

window.addEventListener("beforeunload", function () {
  if (window.chat) {
    window.chat.destroy();
  }
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = HabitHeroChat;
}
