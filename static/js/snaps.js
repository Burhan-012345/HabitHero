// snaps.js - Complete with face detection, filters, and emoji overlays

class SnapManager {
  constructor() {
    this.initialize();
  }

  initialize() {
    this.setupEventListeners();
    this.setupTabSwitching();
    this.loadFaceDetectionModels();

    // Initialize camera state
    this.cameraState = {
      stream: null,
      isFrontCamera: false,
      flashOn: false,
      filter: "normal",
      emojis: [],
      pendingSnap: null,
    };

    this.videoState = {
      stream: null,
      recorder: null,
      isRecording: false,
      recordedChunks: [],
      maxDuration: 60,
      timer: null,
      currentTime: 0,
    };

    this.textSnapState = {
      text: "",
      background: "#4ECDC4",
    };

    this.replyState = {
      parentSnapId: null,
      type: "text",
      photoData: null,
      videoData: null,
      text: "",
      caption: "",
    };

    this.faceDetectionState = {
      modelsLoaded: false,
      currentFilter: null,
      selectedEmoji: null,
      emojiSize: 60,
      detectedFaces: [],
      isDetecting: false,
      faceDetectionCanvas: null,
    };

    this.selectedFriends = new Set();
  }

  setupEventListeners() {
    // Tab switching
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        this.switchTab(tab);
      });
    });

    // Friend search
    const friendSearch = document.getElementById("friend-search");
    if (friendSearch) {
      friendSearch.addEventListener("input", (e) => {
        this.searchFriends(e.target.value);
      });
    }

    // Text snap
    const snapText = document.getElementById("snap-text");
    if (snapText) {
      snapText.addEventListener("input", (e) => {
        this.textSnapState.text = e.target.value;
      });
    }

    // Preview caption
    const previewCaption = document.getElementById("preview-caption-input");
    if (previewCaption) {
      previewCaption.addEventListener("input", (e) => {
        if (this.cameraState.pendingSnap) {
          this.cameraState.pendingSnap.caption = e.target.value;
        }
      });
    }

    // Reply text
    const replyText = document.getElementById("reply-text");
    if (replyText) {
      replyText.addEventListener("input", (e) => {
        this.replyState.text = e.target.value;
      });
    }

    // Reply caption
    const replyCaption = document.getElementById("reply-caption-input");
    if (replyCaption) {
      replyCaption.addEventListener("input", (e) => {
        this.replyState.caption = e.target.value;
      });
    }

    // Quick reply
    const quickReply = document.getElementById("quick-reply-input");
    if (quickReply) {
      quickReply.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          this.sendQuickReply();
        }
      });
    }

    // Close modals on outside click
    document.addEventListener("click", (e) => {
      if (e.target.classList.contains("modal")) {
        this.closeAllModals();
      }
    });

    // Close modals with escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.closeAllModals();
      }
    });
  }

  setupTabSwitching() {
    const tabs = document.querySelectorAll(".tab-btn");
    const panes = document.querySelectorAll(".tab-pane");

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        this.switchTab(target);
      });
    });
  }

  switchTab(tabName) {
    const tabs = document.querySelectorAll(".tab-btn");
    const panes = document.querySelectorAll(".tab-pane");

    // Update tabs
    tabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === tabName);
    });

    // Update panes
    panes.forEach((pane) => {
      pane.classList.toggle("active", pane.id === `${tabName}-tab`);
    });
  }

  async loadFaceDetectionModels() {
    try {
      if (this.faceDetectionState.modelsLoaded) return;

      console.log("Loading face detection models...");

      // Check if face-api is available
      if (typeof faceapi === "undefined") {
        console.warn("face-api.js not loaded, face detection will be disabled");
        return;
      }

      // Load face detection models
      await faceapi.nets.tinyFaceDetector.loadFromUri("/static/models");
      await faceapi.nets.faceLandmark68Net.loadFromUri("/static/models");
      await faceapi.nets.faceExpressionNet.loadFromUri("/static/models");

      this.faceDetectionState.modelsLoaded = true;
      console.log("Face detection models loaded successfully");
    } catch (error) {
      console.error("Error loading face detection models:", error);
      // Don't show error to user, just disable face detection features
    }
  }

  async detectFaces(videoElement, canvasElement) {
    if (
      !this.faceDetectionState.modelsLoaded ||
      !this.faceDetectionState.isDetecting
    ) {
      return [];
    }

    try {
      const displaySize = {
        width: videoElement.videoWidth,
        height: videoElement.videoHeight,
      };

      faceapi.matchDimensions(canvasElement, displaySize);

      const detections = await faceapi
        .detectAllFaces(videoElement, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceExpressions();

      const resizedDetections = faceapi.resizeResults(detections, displaySize);
      this.faceDetectionState.detectedFaces = resizedDetections;

      return resizedDetections;
    } catch (error) {
      console.error("Error detecting faces:", error);
      return [];
    }
  }

  drawFaceDetections(canvas, detections) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (detections.length === 0 || !this.faceDetectionState.selectedEmoji)
      return;

    detections.forEach((detection) => {
      const { x, y, width, height } = detection.detection.box;

      // Calculate position for emoji
      const centerX = x + width / 2;
      const centerY = y + height / 2;
      const emojiSize = Math.max(width, height) * 0.8;

      // Draw emoji on face
      ctx.font = `${emojiSize}px Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(this.faceDetectionState.selectedEmoji, centerX, centerY);
    });
  }

  applyFilter(canvas, filterType) {
    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    switch (filterType) {
      case "vintage":
        // Apply sepia tone
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          data[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
          data[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
          data[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
        }
        break;

      case "cool":
        // Cool blue tint
        for (let i = 0; i < data.length; i += 4) {
          data[i] = Math.min(255, data[i] * 0.9); // Reduce red
          data[i + 1] = Math.min(255, data[i + 1] * 1.1); // Boost green slightly
          data[i + 2] = Math.min(255, data[i + 2] * 1.2); // Boost blue
        }
        break;

      case "warm":
        // Warm orange tint
        for (let i = 0; i < data.length; i += 4) {
          data[i] = Math.min(255, data[i] * 1.2); // Boost red
          data[i + 1] = Math.min(255, data[i + 1] * 1.1); // Boost green
          data[i + 2] = Math.min(255, data[i + 2] * 0.9); // Reduce blue
        }
        break;

      case "blackwhite":
        // Black and white
        for (let i = 0; i < data.length; i += 4) {
          const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
          data[i] = avg;
          data[i + 1] = avg;
          data[i + 2] = avg;
        }
        break;
    }

    ctx.putImageData(imageData, 0, 0);
  }

  openCameraSelection() {
    const modal = document.getElementById("camera-selection-modal");
    if (modal) modal.classList.remove("hidden");
  }

  closeCameraSelection() {
    const modal = document.getElementById("camera-selection-modal");
    if (modal) modal.classList.add("hidden");
  }

  showFilterSelector() {
    const modal = document.createElement("div");
    modal.id = "filter-modal";
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>Choose Filter</h2>
          <button class="close-btn" onclick="snapManager.closeFilterSelector()">&times;</button>
        </div>
        <div class="modal-body">
          <div class="filter-selector">
            <div class="filter-option" onclick="snapManager.selectFilter('normal')">
              <div class="filter-preview" style="background: #4ecdc4; color: white;">Normal</div>
            </div>
            <div class="filter-option" onclick="snapManager.selectFilter('vintage')">
              <div class="filter-preview" style="background: #8B4513; color: white;">Vintage</div>
            </div>
            <div class="filter-option" onclick="snapManager.selectFilter('cool')">
              <div class="filter-preview" style="background: #1E90FF; color: white;">Cool</div>
            </div>
            <div class="filter-option" onclick="snapManager.selectFilter('warm')">
              <div class="filter-preview" style="background: #FF4500; color: white;">Warm</div>
            </div>
            <div class="filter-option" onclick="snapManager.selectFilter('blackwhite')">
              <div class="filter-preview" style="background: #333; color: white;">B&W</div>
            </div>
            <div class="filter-option" onclick="snapManager.selectFilter('emoji')">
              <div class="filter-preview" style="background: #FFD700; color: #333;">Emoji Face</div>
            </div>
          </div>
          
          <div class="emoji-filter-options" id="emoji-filter-options" style="display: none;">
            <div class="emoji-filter-option" onclick="snapManager.selectEmoji('😀')">😀</div>
            <div class="emoji-filter-option" onclick="snapManager.selectEmoji('😂')">😂</div>
            <div class="emoji-filter-option" onclick="snapManager.selectEmoji('😍')">😍</div>
            <div class="emoji-filter-option" onclick="snapManager.selectEmoji('🤩')">🤩</div>
            <div class="emoji-filter-option" onclick="snapManager.selectEmoji('😎')">😎</div>
            <div class="emoji-filter-option" onclick="snapManager.selectEmoji('🥳')">🥳</div>
            <div class="emoji-filter-option" onclick="snapManager.selectEmoji('😜')">😜</div>
            <div class="emoji-filter-option" onclick="snapManager.selectEmoji('🤪')">🤪</div>
            <div class="emoji-filter-option" onclick="snapManager.selectEmoji('🤑')">🤑</div>
            <div class="emoji-filter-option" onclick="snapManager.selectEmoji('🤠')">🤠</div>
          </div>
          
          <div class="filter-actions" style="margin-top: 20px; display: flex; justify-content: space-between;">
            <button class="btn btn-outline" onclick="snapManager.closeFilterSelector()">Cancel</button>
            <button class="btn btn-primary" onclick="snapManager.applySelectedFilter()">Apply Filter</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    modal.classList.remove("hidden");

    // Set default filter
    this.selectFilter("normal");
  }

  closeFilterSelector() {
    const modal = document.getElementById("filter-modal");
    if (modal) {
      modal.remove();
    }
  }

  selectFilter(filterType) {
    this.faceDetectionState.currentFilter = filterType;

    // Update UI
    document.querySelectorAll(".filter-option").forEach((option) => {
      option.classList.remove("active");
    });

    const selectedOption = document.querySelector(
      `[onclick="snapManager.selectFilter('${filterType}')"]`
    );
    if (selectedOption) {
      selectedOption.classList.add("active");
    }

    // Show/hide emoji options for face filters
    const emojiOptions = document.getElementById("emoji-filter-options");
    if (emojiOptions) {
      if (filterType === "emoji") {
        emojiOptions.style.display = "flex";
        // Auto-select first emoji if none selected
        if (!this.faceDetectionState.selectedEmoji) {
          this.selectEmoji("😀");
        }
      } else {
        emojiOptions.style.display = "none";
        this.faceDetectionState.selectedEmoji = null;
      }
    }
  }

  selectEmoji(emoji) {
    this.faceDetectionState.selectedEmoji = emoji;

    // Update UI
    document.querySelectorAll(".emoji-filter-option").forEach((option) => {
      option.classList.remove("active");
    });

    const selectedOption = document.querySelector(
      `[onclick="snapManager.selectEmoji('${emoji}')"]`
    );
    if (selectedOption) {
      selectedOption.classList.add("active");
    }

    // Set filter type to emoji if not already
    if (this.faceDetectionState.currentFilter !== "emoji") {
      this.selectFilter("emoji");
    }
  }

  applySelectedFilter() {
    if (this.faceDetectionState.currentFilter === "emoji") {
      // Enable face detection for emoji filter
      this.faceDetectionState.isDetecting = true;
      this.showNotification(
        "Emoji filter enabled! Face detection is active.",
        "success"
      );
    } else {
      this.faceDetectionState.isDetecting = false;
      this.showNotification(
        `${this.faceDetectionState.currentFilter} filter applied!`,
        "success"
      );
    }

    this.closeFilterSelector();
  }

  // CAMERA FUNCTIONALITY
  async startPhotoCamera() {
    try {
      // Get camera stream
      const constraints = {
        video: {
          facingMode: this.cameraState.isFrontCamera ? "user" : "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.cameraState.stream = stream;

      // Show camera interface
      this.closeCameraSelection();
      const cameraInterface = document.getElementById("camera-interface");
      if (cameraInterface) cameraInterface.classList.remove("hidden");

      // Set up video element
      const video = document.getElementById("camera-video");
      if (video) {
        video.srcObject = stream;
        video.play().catch((e) => console.error("Error playing video:", e));
      }

      // Update UI
      this.updateCameraUI();

      // Start face detection if enabled
      this.startFaceDetectionLoop();
    } catch (error) {
      console.error("Error accessing camera:", error);
      this.showNotification(
        "Could not access camera. Please check permissions.",
        "error"
      );
    }
  }

  async startFaceDetectionLoop() {
    if (
      !this.faceDetectionState.isDetecting ||
      !this.faceDetectionState.modelsLoaded
    ) {
      return;
    }

    const video = document.getElementById("camera-video");
    const cameraPreview = document.querySelector(".camera-preview-container");

    if (!video || !cameraPreview) return;

    // Create face detection canvas if it doesn't exist
    if (!this.faceDetectionState.faceDetectionCanvas) {
      const canvas = document.createElement("canvas");
      canvas.className = "face-detection-canvas";
      canvas.style.position = "absolute";
      canvas.style.top = "0";
      canvas.style.left = "0";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.pointerEvents = "none";
      canvas.style.zIndex = "10";
      cameraPreview.appendChild(canvas);
      this.faceDetectionState.faceDetectionCanvas = canvas;
    }

    const canvas = this.faceDetectionState.faceDetectionCanvas;
    const ctx = canvas.getContext("2d");

    const detectFacesLoop = async () => {
      if (
        !this.faceDetectionState.isDetecting ||
        !this.cameraState.stream ||
        video.readyState !== 4
      ) {
        return;
      }

      try {
        // Match canvas dimensions to video
        const displaySize = {
          width: cameraPreview.clientWidth,
          height: cameraPreview.clientHeight,
        };

        canvas.width = displaySize.width;
        canvas.height = displaySize.height;

        // Clear previous drawings
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Detect faces
        const detections = await faceapi
          .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks();

        const resizedDetections = faceapi.resizeResults(
          detections,
          displaySize
        );

        // Draw emojis on detected faces
        if (
          resizedDetections.length > 0 &&
          this.faceDetectionState.selectedEmoji
        ) {
          resizedDetections.forEach((detection) => {
            const { x, y, width, height } = detection.detection.box;

            // Calculate position and size for emoji
            const centerX = x + width / 2;
            const centerY = y + height / 2;
            const emojiSize = Math.max(width, height) * 1.2; // Slightly larger than face

            // Draw emoji
            ctx.font = `${emojiSize}px Arial`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(
              this.faceDetectionState.selectedEmoji,
              centerX,
              centerY
            );
          });
        }
      } catch (error) {
        console.error("Error in face detection loop:", error);
      }

      // Continue loop
      if (this.faceDetectionState.isDetecting) {
        requestAnimationFrame(detectFacesLoop);
      }
    };

    // Start the detection loop
    detectFacesLoop();
  }

  closeCamera() {
    if (this.cameraState.stream) {
      this.cameraState.stream.getTracks().forEach((track) => track.stop());
      this.cameraState.stream = null;
    }

    // Stop face detection
    this.faceDetectionState.isDetecting = false;

    // Remove face detection canvas
    if (this.faceDetectionState.faceDetectionCanvas) {
      this.faceDetectionState.faceDetectionCanvas.remove();
      this.faceDetectionState.faceDetectionCanvas = null;
    }

    const cameraInterface = document.getElementById("camera-interface");
    if (cameraInterface) {
      cameraInterface.classList.add("hidden");
    }
  }

  toggleCameraMode() {
    this.cameraState.isFrontCamera = !this.cameraState.isFrontCamera;

    if (this.cameraState.stream) {
      this.cameraState.stream.getTracks().forEach((track) => track.stop());
      this.startPhotoCamera();
    }
  }

  toggleFlash() {
    this.cameraState.flashOn = !this.cameraState.flashOn;
    const flashBtn = document.querySelector(
      '[onclick="snapManager.toggleFlash()"]'
    );
    if (flashBtn) {
      flashBtn.classList.toggle("active", this.cameraState.flashOn);
      flashBtn.querySelector("i").className = this.cameraState.flashOn
        ? "fas fa-bolt"
        : "far fa-bolt";
    }
  }

  toggleEmojiPicker() {
    const emojiPicker = document.getElementById("emoji-picker");
    if (emojiPicker) {
      emojiPicker.classList.toggle("hidden");
    }
  }

  addEmoji(emoji) {
    this.cameraState.emojis.push({
      emoji: emoji,
      x: Math.random() * 70 + 15,
      y: Math.random() * 70 + 15,
      rotation: Math.random() * 60 - 30,
    });
    this.updateCameraUI();
  }

  updateCameraUI() {
    // Update emoji overlay
    const emojiOverlay = document.getElementById("emoji-overlays");
    if (emojiOverlay) {
      emojiOverlay.innerHTML = this.cameraState.emojis
        .map(
          (e) =>
            `<div class="emoji-overlay" style="left:${e.x}%; top:${e.y}%; transform:rotate(${e.rotation}deg)">${e.emoji}</div>`
        )
        .join("");
    }
  }

  async capturePhoto() {
    if (!this.cameraState.stream) return;

    const video = document.getElementById("camera-video");
    const canvas = document.getElementById("camera-canvas");
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");

    // Draw video frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Apply color filter if selected
    if (
      this.faceDetectionState.currentFilter &&
      this.faceDetectionState.currentFilter !== "normal" &&
      this.faceDetectionState.currentFilter !== "emoji"
    ) {
      this.applyFilter(canvas, this.faceDetectionState.currentFilter);
    }

    // For emoji filter: detect faces and draw emojis
    if (
      this.faceDetectionState.currentFilter === "emoji" &&
      this.faceDetectionState.selectedEmoji &&
      this.faceDetectionState.modelsLoaded
    ) {
      try {
        // Detect faces directly on the captured frame
        const detections = await faceapi.detectAllFaces(
          canvas,
          new faceapi.TinyFaceDetectorOptions()
        );

        // Draw emojis on faces
        if (detections.length > 0) {
          detections.forEach((detection) => {
            const { x, y, width, height } = detection.detection.box;

            // Calculate position for emoji
            const centerX = x + width / 2;
            const centerY = y + height / 2;
            const emojiSize = Math.max(width, height) * 1.2;

            // Draw emoji on face
            ctx.font = `${emojiSize}px Arial`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(
              this.faceDetectionState.selectedEmoji,
              centerX,
              centerY
            );
          });
        }
      } catch (error) {
        console.error("Error applying emoji filter:", error);
      }
    }

    // Add regular emojis (not face-based)
    this.cameraState.emojis.forEach((emoji) => {
      const emojiSize = Math.min(canvas.width, canvas.height) * 0.1;
      ctx.font = `${emojiSize}px Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.save();
      ctx.translate(
        (canvas.width * emoji.x) / 100,
        (canvas.height * emoji.y) / 100
      );
      ctx.rotate((emoji.rotation * Math.PI) / 180);
      ctx.fillText(emoji.emoji, 0, 0);
      ctx.restore();
    });

    // Convert to blob
    canvas.toBlob(
      (blob) => {
        const url = URL.createObjectURL(blob);

        this.cameraState.pendingSnap = {
          type: "image",
          data: blob,
          caption: "",
          filter: this.faceDetectionState.currentFilter,
          emoji: this.faceDetectionState.selectedEmoji,
        };

        this.closeCamera();
        this.showPreview(url, "image");
      },
      "image/jpeg",
      0.9
    );
  }

  // VIDEO CAMERA FUNCTIONALITY
  async startVideoCamera() {
    try {
      // Get camera stream with audio
      const constraints = {
        video: {
          facingMode: this.cameraState.isFrontCamera ? "user" : "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: true,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoState.stream = stream;

      // Show video camera interface
      this.closeCameraSelection();
      const videoInterface = document.getElementById("video-interface");
      if (videoInterface) videoInterface.classList.remove("hidden");

      // Set up video element
      const video = document.getElementById("video-camera-video");
      if (video) {
        video.srcObject = stream;
        video.play().catch((e) => console.error("Error playing video:", e));
      }

      // Reset video state
      this.videoState.recordedChunks = [];
      this.videoState.isRecording = false;
      this.videoState.currentTime = 0;

      // Update UI
      this.updateVideoCameraUI();
    } catch (error) {
      console.error("Error accessing video camera:", error);
      this.showNotification(
        "Could not access camera. Please check permissions.",
        "error"
      );
    }
  }

  closeVideoCamera() {
    // Stop recording if active
    if (this.videoState.recorder && this.videoState.isRecording) {
      this.videoState.recorder.stop();
      this.videoState.isRecording = false;
    }

    // Stop stream
    if (this.videoState.stream) {
      this.videoState.stream.getTracks().forEach((track) => track.stop());
      this.videoState.stream = null;
    }

    // Clear timer
    if (this.videoState.timer) {
      clearInterval(this.videoState.timer);
      this.videoState.timer = null;
    }

    // Hide interface
    const videoInterface = document.getElementById("video-interface");
    if (videoInterface) {
      videoInterface.classList.add("hidden");
    }
  }

  toggleVideoCamera() {
    this.cameraState.isFrontCamera = !this.cameraState.isFrontCamera;

    if (this.videoState.stream) {
      this.videoState.stream.getTracks().forEach((track) => track.stop());
      this.startVideoCamera();
    }
  }

  toggleVideoFlash() {
    this.cameraState.flashOn = !this.cameraState.flashOn;
    const flashBtn = document.querySelector(
      '[onclick="snapManager.toggleVideoFlash()"]'
    );
    if (flashBtn) {
      flashBtn.classList.toggle("active", this.cameraState.flashOn);
      flashBtn.querySelector("i").className = this.cameraState.flashOn
        ? "fas fa-bolt"
        : "far fa-bolt";
    }
  }

  toggleVideoEmojiPicker() {
    // Show filter selector for video too
    this.showFilterSelector();
  }

  toggleVideoRecording() {
    if (!this.videoState.isRecording) {
      this.startVideoRecording();
    } else {
      this.stopVideoRecording();
    }
  }

  startVideoRecording() {
    if (!this.videoState.stream || this.videoState.isRecording) return;

    try {
      this.videoState.recordedChunks = [];
      this.videoState.isRecording = true;
      this.videoState.currentTime = 0;

      // Start MediaRecorder
      this.videoState.recorder = new MediaRecorder(this.videoState.stream, {
        mimeType: "video/webm;codecs=vp9",
      });

      this.videoState.recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.videoState.recordedChunks.push(event.data);
        }
      };

      this.videoState.recorder.onstop = () => {
        this.onVideoRecordingComplete();
      };

      this.videoState.recorder.start(1000); // Collect data every second

      // Start timer
      this.videoState.timer = setInterval(() => {
        this.videoState.currentTime++;
        this.updateVideoCameraUI();

        // Stop recording if max duration reached
        if (this.videoState.currentTime >= this.videoState.maxDuration) {
          this.stopVideoRecording();
        }
      }, 1000);

      // Update UI
      const recordingIndicator = document.getElementById("recording-indicator");
      const recordingTimer = document.getElementById("recording-timer");
      const recordBtn = document.getElementById("record-btn");

      if (recordingIndicator) recordingIndicator.classList.remove("hidden");
      if (recordingTimer) recordingTimer.classList.remove("hidden");
      if (recordBtn) recordBtn.classList.add("recording");

      this.updateVideoCameraUI();
    } catch (error) {
      console.error("Error starting video recording:", error);
      this.showNotification("Could not start recording.", "error");
    }
  }

  stopVideoRecording() {
    if (!this.videoState.isRecording || !this.videoState.recorder) return;

    this.videoState.recorder.stop();
    this.videoState.isRecording = false;

    if (this.videoState.timer) {
      clearInterval(this.videoState.timer);
      this.videoState.timer = null;
    }

    // Update UI
    const recordingIndicator = document.getElementById("recording-indicator");
    const recordingTimer = document.getElementById("recording-timer");
    const recordBtn = document.getElementById("record-btn");

    if (recordingIndicator) recordingIndicator.classList.add("hidden");
    if (recordingTimer) recordingTimer.classList.add("hidden");
    if (recordBtn) recordBtn.classList.remove("recording");

    this.updateVideoCameraUI();
  }

  updateVideoCameraUI() {
    // Update timer display
    const timerDisplay = document.getElementById("recording-timer");
    if (timerDisplay) {
      const minutes = Math.floor(this.videoState.currentTime / 60);
      const seconds = this.videoState.currentTime % 60;
      timerDisplay.textContent = `${minutes
        .toString()
        .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
  }

  onVideoRecordingComplete() {
    if (this.videoState.recordedChunks.length === 0) {
      this.showNotification("No video recorded.", "error");
      return;
    }

    // Create blob from recorded chunks
    const videoBlob = new Blob(this.videoState.recordedChunks, {
      type: "video/webm",
    });

    // Create video URL for preview
    const videoUrl = URL.createObjectURL(videoBlob);

    this.cameraState.pendingSnap = {
      type: "video",
      data: videoBlob,
      caption: "",
    };

    this.closeVideoCamera();
    this.showPreview(videoUrl, "video");
  }

  // TEXT SNAP FUNCTIONALITY
  openTextSnap() {
    this.closeCameraSelection();
    const textInterface = document.getElementById("text-snap-interface");
    if (textInterface) textInterface.classList.remove("hidden");
  }

  closeTextSnap() {
    const textInterface = document.getElementById("text-snap-interface");
    if (textInterface) textInterface.classList.add("hidden");
  }

  setTextBackground(color) {
    this.textSnapState.background = color;
    const textArea = document.getElementById("snap-text");
    if (textArea) {
      textArea.style.backgroundColor = color;
    }

    // Update active state
    document.querySelectorAll(".bg-option").forEach((option) => {
      option.classList.toggle("active", option.style.backgroundColor === color);
    });
  }

  async sendTextSnap() {
    if (!this.textSnapState.text.trim()) {
      this.showNotification("Please enter some text for your snap.", "error");
      return;
    }

    // Check if text contains emojis or special characters
    const text = this.textSnapState.text;
    const hasEmoji = /[\p{Emoji}]/u.test(text);

    if (hasEmoji) {
      // If text contains emojis, convert to image
      this.convertTextToImage(text);
    } else {
      // Plain text - store as text content
      this.cameraState.pendingSnap = {
        type: "text",
        data: text,
        caption: "",
      };

      this.closeTextSnap();
      this.showTextPreview(text);
    }
  }

  convertTextToImage(text) {
    // Create canvas with text
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    canvas.width = 800;
    canvas.height = 600;

    // Set background
    ctx.fillStyle = this.textSnapState.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Add text
    ctx.fillStyle = "white";
    ctx.font = "bold 48px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Wrap text
    const lines = this.wrapText(ctx, text, canvas.width - 100);
    const lineHeight = 60;
    const startY = (canvas.height - lines.length * lineHeight) / 2;

    lines.forEach((line, index) => {
      ctx.fillText(line, canvas.width / 2, startY + index * lineHeight);
    });

    // Convert to blob and show preview
    canvas.toBlob(
      (blob) => {
        const url = URL.createObjectURL(blob);

        this.cameraState.pendingSnap = {
          type: "image", // IMPORTANT: Text with emojis becomes image
          data: blob,
          caption: "",
        };

        this.closeTextSnap();
        this.showPreview(url, "image");
      },
      "image/jpeg",
      0.9
    );
  }

  showTextPreview(text) {
    const modal = document.getElementById("preview-modal");
    const container = document.getElementById("preview-container");

    if (!modal || !container) return;

    container.innerHTML = `
      <div class="text-snap-preview" style="background: ${this.textSnapState.background}">
        <div class="text-content">${text}</div>
      </div>
    `;

    modal.classList.remove("hidden");
  }

  wrapText(ctx, text, maxWidth) {
    const words = text.split(" ");
    const lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const width = ctx.measureText(currentLine + " " + word).width;

      if (width < maxWidth) {
        currentLine += " " + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }

    lines.push(currentLine);
    return lines;
  }

  showPreview(data, type) {
    const modal = document.getElementById("preview-modal");
    const container = document.getElementById("preview-container");

    if (!modal || !container) return;

    if (type === "image") {
      container.innerHTML = `<img src="${data}" alt="Snap Preview" class="preview-image">`;
    } else if (type === "video") {
      container.innerHTML = `
        <video controls autoplay class="preview-video">
          <source src="${data}" type="video/webm">
          Your browser does not support the video tag.
        </video>
      `;
    } else if (type === "text") {
      container.innerHTML = `
        <div class="text-snap-preview">
          <div class="text-content">${data}</div>
        </div>
      `;
    }

    modal.classList.remove("hidden");
  }

  closePreview() {
    const modal = document.getElementById("preview-modal");
    if (modal) modal.classList.add("hidden");
  }

  retake() {
    this.closePreview();
    this.cameraState.pendingSnap = null;
    this.openCameraSelection();
  }

  async openFriendSelection() {
    this.closePreview();

    try {
      // Load friends
      await this.loadFriends();

      const modal = document.getElementById("friend-selection-modal");
      if (modal) modal.classList.remove("hidden");
    } catch (error) {
      console.error("Error loading friends:", error);
      this.showNotification("Failed to load friends.", "error");
    }
  }

  closeFriendSelection() {
    const modal = document.getElementById("friend-selection-modal");
    if (modal) modal.classList.add("hidden");
    this.selectedFriends.clear();
    this.updateSelectedCount();
  }

  async loadFriends() {
    const friendList = document.getElementById("friend-list");
    if (!friendList) return;

    try {
      const response = await fetch("/api/friends");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const friends = await response.json();

      if (friends.length === 0) {
        friendList.innerHTML = `
          <div class="empty-state">
            <i class="fas fa-user-friends"></i>
            <p>No friends yet. Add friends to send snaps!</p>
          </div>
        `;
        return;
      }

      let html = "";
      friends.forEach((friend) => {
        const isSelected = this.selectedFriends.has(friend.id);
        html += `
          <div class="friend-item ${isSelected ? "selected" : ""}" 
               data-friend-id="${friend.id}">
            <div class="friend-checkbox"></div>
            <div class="friend-avatar">
              ${friend.username.charAt(0).toUpperCase()}
            </div>
            <div class="friend-info">
              <h4>${friend.username}</h4>
              <div class="status">
                <span class="status-dot ${
                  friend.is_online ? "online" : "offline"
                }"></span>
                <span>${friend.is_online ? "Online" : "Offline"}</span>
              </div>
            </div>
          </div>
        `;
      });

      friendList.innerHTML = html;

      // Add click handlers
      document.querySelectorAll(".friend-item").forEach((item) => {
        item.addEventListener("click", () => {
          const friendId = item.dataset.friendId;
          this.toggleFriendSelection(friendId, item);
        });
      });
    } catch (error) {
      console.error("Error loading friends:", error);
      this.showNotification("Failed to load friends.", "error");
    }
  }

  toggleFriendSelection(friendId, element) {
    if (this.selectedFriends.has(friendId)) {
      this.selectedFriends.delete(friendId);
      element.classList.remove("selected");
    } else {
      this.selectedFriends.add(friendId);
      element.classList.add("selected");
    }

    this.updateSelectedCount();
  }

  updateSelectedCount() {
    const countElement = document.getElementById("selected-count");
    const sendBtn = document.getElementById("send-snap-btn");

    if (countElement) {
      countElement.textContent = this.selectedFriends.size;
    }

    if (sendBtn) {
      sendBtn.disabled = this.selectedFriends.size === 0;
      sendBtn.classList.toggle("disabled", this.selectedFriends.size === 0);
    }
  }

  searchFriends(query) {
    const friendItems = document.querySelectorAll(".friend-item");
    const searchLower = query.toLowerCase();

    friendItems.forEach((item) => {
      const name = item.querySelector("h4")?.textContent.toLowerCase() || "";
      if (name.includes(searchLower)) {
        item.style.display = "";
      } else {
        item.style.display = "none";
      }
    });
  }

  async sendSnap() {
    if (this.selectedFriends.size === 0 || !this.cameraState.pendingSnap) {
      this.showNotification("Please select friends to send to.", "error");
      return;
    }

    const sendBtn = document.getElementById("send-snap-btn");
    if (!sendBtn) return;

    const originalText = sendBtn.innerHTML;

    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

    const caption =
      document.getElementById("preview-caption-input")?.value || "";

    try {
      // Send to each selected friend
      let successCount = 0;
      const errors = [];

      for (const friendId of this.selectedFriends) {
        try {
          const formData = new FormData();
          formData.append("receiver_id", friendId);
          formData.append("caption", caption);

          // Handle different content types
          if (this.cameraState.pendingSnap.type === "text") {
            // Text snap - send as text content
            formData.append("text", this.cameraState.pendingSnap.data);
          } else {
            // Image or video - send as file
            const blob = this.cameraState.pendingSnap.data;
            const extension =
              this.cameraState.pendingSnap.type === "image" ? ".jpg" : ".webm";
            const filename = `snap_${Date.now()}${extension}`;
            formData.append("snap_file", blob, filename);
          }

          const response = await fetch("/snaps/send", {
            method: "POST",
            body: formData,
          });

          const result = await response.json();

          if (result.success) {
            successCount++;
          } else {
            errors.push(`Friend ${friendId}: ${result.message}`);
          }
        } catch (error) {
          errors.push(`Friend ${friendId}: ${error.message}`);
        }
      }

      // Show results
      if (successCount > 0) {
        this.showNotification(
          `Successfully sent snap to ${successCount} friend(s)!`,
          "success"
        );

        // Clear and close
        this.closeFriendSelection();
        this.cameraState.pendingSnap = null;
        this.selectedFriends.clear();

        // Reset preview caption
        const captionInput = document.getElementById("preview-caption-input");
        if (captionInput) captionInput.value = "";
      }

      if (errors.length > 0) {
        console.error("Errors sending snaps:", errors);
        this.showNotification(
          `Failed to send to ${errors.length} friend(s).`,
          "error"
        );
      }
    } catch (error) {
      console.error("Error sending snap:", error);
      this.showNotification("Error sending snap. Please try again.", "error");
    } finally {
      sendBtn.disabled = false;
      sendBtn.innerHTML = originalText;
    }
  }

  // DOWNLOAD FUNCTIONALITY
  async downloadSnap(snapId) {
    try {
      // First get download info
      const infoResponse = await fetch(`/api/snaps/${snapId}/download-info`);
      const info = await infoResponse.json();

      if (!info.success) {
        throw new Error(info.message);
      }

      const snap = info.snap;

      // Create download modal
      this.showDownloadModal(snap);
    } catch (error) {
      console.error("Error getting download info:", error);
      this.showNotification("Failed to prepare download.", "error");
    }
  }

  showDownloadModal(snap) {
    // Create modal if it doesn't exist
    let modal = document.getElementById("download-modal");

    if (!modal) {
      modal = document.createElement("div");
      modal.id = "download-modal";
      modal.className = "modal hidden";
      modal.innerHTML = `
        <div class="modal-content download-content">
          <div class="modal-header">
            <h2>Download Snap</h2>
            <button class="close-btn" onclick="snapManager.closeDownloadModal()">&times;</button>
          </div>
          <div class="modal-body">
            <div class="download-preview" id="download-preview"></div>
            <div class="download-options">
              <div class="download-option" data-format="original" onclick="snapManager.selectDownloadFormat('original')">
                <i class="fas fa-download"></i>
                <div>
                  <h4>Original Format</h4>
                  <p>Download in original quality</p>
                </div>
              </div>
              <div class="download-option" data-format="image" onclick="snapManager.selectDownloadFormat('image')">
                <i class="fas fa-image"></i>
                <div>
                  <h4>As Image</h4>
                  <p>Convert to image format</p>
                </div>
              </div>
              <div class="download-option" data-format="text" onclick="snapManager.selectDownloadFormat('text')">
                <i class="fas fa-file-alt"></i>
                <div>
                  <h4>As Text File</h4>
                  <p>Save with metadata</p>
                </div>
              </div>
            </div>
            <div class="download-customization" id="download-customization">
              <div class="customization-option">
                <label>
                  <input type="checkbox" id="include-metadata" checked>
                  Include metadata (sender, timestamp, caption)
                </label>
              </div>
              <div class="customization-option">
                <label>
                  <input type="checkbox" id="add-watermark" checked>
                  Add "Shared via HabitHero" watermark
                </label>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline" onclick="snapManager.closeDownloadModal()">Cancel</button>
            <button class="btn btn-primary" id="start-download-btn" onclick="snapManager.startDownload()">
              <i class="fas fa-download"></i> Download
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    // Update preview
    const preview = document.getElementById("download-preview");
    if (preview) {
      let previewHTML = "";

      if (snap.content_type === "image") {
        previewHTML = `
          <div class="image-preview">
            <img src="/uploads/${snap.filename}" alt="Snap preview">
          </div>
        `;
      } else if (snap.content_type === "video") {
        previewHTML = `
          <div class="video-preview">
            <video controls>
              <source src="/uploads/${snap.filename}">
            </video>
          </div>
        `;
      } else {
        previewHTML = `
          <div class="text-preview">
            <div class="text-content">${
              snap.caption || snap.content || "Text snap"
            }</div>
          </div>
        `;
      }

      previewHTML += `
        <div class="snap-info">
          <div class="info-row">
            <span class="label">From:</span>
            <span class="value">${snap.sender_username}</span>
          </div>
          <div class="info-row">
            <span class="label">Date:</span>
            <span class="value">${new Date(
              snap.created_at
            ).toLocaleString()}</span>
          </div>
          ${
            snap.caption
              ? `
            <div class="info-row">
              <span class="label">Caption:</span>
              <span class="value">${snap.caption}</span>
            </div>
          `
              : ""
          }
        </div>
      `;

      preview.innerHTML = previewHTML;
    }

    // Store current snap
    modal.dataset.snapId = snap.id;
    modal.dataset.contentType = snap.content_type;
    modal.dataset.selectedFormat = "original";

    // Select original format by default
    this.selectDownloadFormat("original");

    // Show modal
    modal.classList.remove("hidden");
  }

  selectDownloadFormat(format) {
    const modal = document.getElementById("download-modal");
    if (!modal) return;

    modal.dataset.selectedFormat = format;

    // Update UI
    document.querySelectorAll(".download-option").forEach((option) => {
      option.classList.toggle("selected", option.dataset.format === format);
    });

    // Show/hide customization options
    const customization = document.getElementById("download-customization");
    if (customization) {
      customization.style.display = "block";
    }
  }

  closeDownloadModal() {
    const modal = document.getElementById("download-modal");
    if (modal) {
      modal.classList.add("hidden");
    }
  }

  async startDownload() {
    const modal = document.getElementById("download-modal");
    if (!modal) return;

    const snapId = modal.dataset.snapId;
    const format = modal.dataset.selectedFormat;
    const contentType = modal.dataset.contentType;

    const includeMetadata =
      document.getElementById("include-metadata")?.checked || false;
    const addWatermark =
      document.getElementById("add-watermark")?.checked || false;

    const downloadBtn = document.getElementById("start-download-btn");
    if (!downloadBtn) return;

    const originalText = downloadBtn.innerHTML;

    downloadBtn.disabled = true;
    downloadBtn.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i> Preparing...';

    try {
      // Build download URL
      let url = `/snaps/${snapId}/download`;

      // Add parameters if needed
      const params = new URLSearchParams();
      if (format !== "original") params.append("format", format);
      if (includeMetadata) params.append("metadata", "true");
      if (addWatermark) params.append("watermark", "true");

      const queryString = params.toString();
      if (queryString) {
        url += `?${queryString}`;
      }

      // Create hidden link and trigger download
      const link = document.createElement("a");
      link.href = url;
      link.download = "";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();

      // Wait a moment before removing
      setTimeout(() => {
        document.body.removeChild(link);

        // Close modal after a short delay
        this.closeDownloadModal();
        this.showNotification("Download started!", "success");
      }, 100);
    } catch (error) {
      console.error("Error starting download:", error);
      this.showNotification("Failed to download snap.", "error");
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.innerHTML = originalText;
    }
  }

  // REPLY FUNCTIONALITY
  async openReplyModal(snapId) {
    try {
      // Load snap details from HTML data
      const snapCard = document.querySelector(`[data-snap-id="${snapId}"]`);
      if (!snapCard) {
        throw new Error("Snap not found on page");
      }

      this.replyState.parentSnapId = snapId;
      this.replyState.type = "text";
      this.replyState.text = "";
      this.replyState.caption = "";
      this.replyState.photoData = null;
      this.replyState.videoData = null;

      // Get snap data from the card
      const snapData = {
        id: snapId,
        content_type: snapCard.dataset.contentType || "text",
        sender_username:
          snapCard.querySelector(".user-details h4")?.textContent || "Unknown",
        created_at:
          snapCard.querySelector(".user-details .time")?.textContent || "",
        content:
          snapCard.querySelector(".text-snap-content")?.textContent || "",
        caption: snapCard.querySelector(".caption")?.textContent || "",
      };

      // Update preview
      const preview = document.getElementById("reply-preview");
      if (preview) {
        preview.innerHTML = this.createSnapPreviewHTML(snapData);
      }

      // Reset form
      const replyText = document.getElementById("reply-text");
      const replyCaption = document.getElementById("reply-caption-input");
      const photoPreview = document.getElementById("photo-reply-preview");
      const videoPreview = document.getElementById("video-reply-preview");

      if (replyText) replyText.value = "";
      if (replyCaption) replyCaption.value = "";
      if (photoPreview) photoPreview.classList.add("hidden");
      if (videoPreview) videoPreview.classList.add("hidden");

      // Set active type
      this.setReplyType("text");

      // Show modal
      const modal = document.getElementById("reply-modal");
      if (modal) modal.classList.remove("hidden");
    } catch (error) {
      console.error("Error opening reply modal:", error);
      this.showNotification("Failed to load snap for reply.", "error");
    }
  }

  createSnapPreviewHTML(snap) {
    let contentHTML = "";

    if (snap.content_type === "image") {
      const img = document.querySelector(
        `[data-snap-id="${snap.id}"] .snap-content img`
      );
      contentHTML = `<img src="${
        img?.src || "/static/images/default-snap.jpg"
      }" alt="Snap preview" class="reply-preview-image">`;
    } else if (snap.content_type === "video") {
      const video = document.querySelector(
        `[data-snap-id="${snap.id}"] .snap-content video`
      );
      contentHTML = `<video class="reply-preview-video"><source src="${
        video?.querySelector("source")?.src || ""
      }"></video>`;
    } else {
      contentHTML = `<div class="text-snap-content reply-preview-text">${snap.content}</div>`;
    }

    return `
      <div class="reply-snap-preview">
        <div class="reply-snap-header">
          <div class="avatar">${snap.sender_username
            .charAt(0)
            .toUpperCase()}</div>
          <div class="user-details">
            <h4>${snap.sender_username}</h4>
            <span class="time">${snap.created_at}</span>
          </div>
        </div>
        <div class="reply-snap-content">
          ${contentHTML}
        </div>
        ${snap.caption ? `<p class="caption">${snap.caption}</p>` : ""}
      </div>
    `;
  }

  setReplyType(type) {
    this.replyState.type = type;

    // Update button states
    document.querySelectorAll(".reply-type-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.type === type);
    });

    // Show/hide input areas
    document.querySelectorAll(".reply-input").forEach((input) => {
      input.classList.remove("active");
    });

    const inputElement = document.getElementById(`${type}-reply-input`);
    if (inputElement) {
      inputElement.classList.add("active");
    }
  }

  openReplyCamera() {
    this.showNotification(
      "Camera functionality for replies coming soon!",
      "info"
    );
  }

  uploadReplyPhoto() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      // Validate file
      if (!file.type.startsWith("image/")) {
        this.showNotification("Please select an image file.", "error");
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        // 10MB limit
        this.showNotification("Image must be less than 10MB.", "error");
        return;
      }

      // Store file object
      this.replyState.photoData = file;

      // Show preview
      const preview = document.getElementById("photo-reply-preview");
      const img = document.getElementById("reply-photo-preview");
      if (preview && img) {
        img.src = URL.createObjectURL(file);
        preview.classList.remove("hidden");
      }
    };

    input.click();
  }

  removeReplyPhoto() {
    this.replyState.photoData = null;
    const preview = document.getElementById("photo-reply-preview");
    if (preview) preview.classList.add("hidden");
  }

  startReplyVideoRecording() {
    this.showNotification("Video recording for replies coming soon!", "info");
  }

  uploadReplyVideo() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      // Validate file
      if (!file.type.startsWith("video/")) {
        this.showNotification("Please select a video file.", "error");
        return;
      }

      if (file.size > 50 * 1024 * 1024) {
        // 50MB limit
        this.showNotification("Video must be less than 50MB.", "error");
        return;
      }

      // Store file object
      this.replyState.videoData = file;

      // Show preview
      const preview = document.getElementById("video-reply-preview");
      const video = document.getElementById("reply-video-preview");
      if (preview && video) {
        video.src = URL.createObjectURL(file);
        preview.classList.remove("hidden");
      }
    };

    input.click();
  }

  removeReplyVideo() {
    this.replyState.videoData = null;
    const preview = document.getElementById("video-reply-preview");
    if (preview) preview.classList.add("hidden");
  }

  closeReplyModal() {
    const modal = document.getElementById("reply-modal");
    if (modal) modal.classList.add("hidden");

    // Reset state
    this.replyState = {
      parentSnapId: null,
      type: "text",
      photoData: null,
      videoData: null,
      text: "",
      caption: "",
    };
  }

  async sendReply() {
    if (!this.replyState.parentSnapId) {
      this.showNotification("No snap selected for reply.", "error");
      return;
    }

    // Validate input based on type
    if (this.replyState.type === "text" && !this.replyState.text.trim()) {
      this.showNotification("Please enter a reply message.", "error");
      return;
    }

    if (this.replyState.type === "photo" && !this.replyState.photoData) {
      this.showNotification("Please select or take a photo.", "error");
      return;
    }

    if (this.replyState.type === "video" && !this.replyState.videoData) {
      this.showNotification("Please select or record a video.", "error");
      return;
    }

    const sendBtn = document.getElementById("send-reply-btn");
    if (!sendBtn) return;

    const originalText = sendBtn.innerHTML;

    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

    try {
      const formData = new FormData();
      formData.append("receiver_id", this.replyState.parentSnapId);
      formData.append("caption", this.replyState.caption);

      if (this.replyState.type === "text") {
        formData.append("text", this.replyState.text);
      } else if (this.replyState.type === "photo") {
        formData.append("snap_file", this.replyState.photoData);
      } else if (this.replyState.type === "video") {
        formData.append("snap_file", this.replyState.videoData);
      }

      const response = await fetch("/snaps/send", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        this.showNotification("Reply sent successfully!", "success");
        this.closeReplyModal();
      } else {
        throw new Error(result.message);
      }
    } catch (error) {
      console.error("Error sending reply:", error);
      this.showNotification("Failed to send reply: " + error.message, "error");
    } finally {
      sendBtn.disabled = false;
      sendBtn.innerHTML = originalText;
    }
  }

  // VIEW SNAP
  async viewSnap(snapId) {
    try {
      // First try to show the snap modal
      await this.showSnapModal(snapId);

      // Then try to mark as viewed (but don't fail if it errors)
      try {
        const response = await fetch(`/snaps/${snapId}/view`, {
          method: "POST",
          headers: {
            "X-CSRFToken": this.getCSRFToken(),
          },
        });

        if (response.ok) {
          // Update UI
          const snapCard = document.querySelector(`[data-snap-id="${snapId}"]`);
          if (snapCard) {
            snapCard.classList.remove("unviewed");
            const indicator = snapCard.querySelector(".unviewed-indicator");
            if (indicator) indicator.remove();
          }
        } else if (response.status === 403) {
          console.log("User not authorized to mark snap as viewed");
          // Don't show error to user for 403 - just continue
        }
      } catch (viewError) {
        console.error("Error marking snap as viewed:", viewError);
        // Continue anyway - don't break the viewing experience
      }
    } catch (error) {
      console.error("Error viewing snap:", error);
      this.showNotification("Failed to load snap.", "error");
    }
  }

  getCSRFToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute("content") : "";
  }

  async showSnapModal(snapId) {
    try {
      // Get snap data from the card
      const snapCard = document.querySelector(`[data-snap-id="${snapId}"]`);
      if (!snapCard) return;

      const modal = document.getElementById("view-snap-modal");
      const body = document.getElementById("view-snap-body");

      if (!modal || !body) return;

      // Clone the snap content
      const snapContent = snapCard
        .querySelector(".snap-content")
        .cloneNode(true);

      // Remove unviewed indicator if present
      const indicator = snapContent.querySelector(".unviewed-indicator");
      if (indicator) indicator.remove();

      // Get caption
      const caption = snapCard.querySelector(".caption")?.textContent || "";

      body.innerHTML = `
        <div class="view-snap-content">
          <div class="view-snap-media">
            ${snapContent.innerHTML}
          </div>
          ${caption ? `<p class="caption">${caption}</p>` : ""}
        </div>
      `;

      modal.classList.remove("hidden");
    } catch (error) {
      console.error("Error showing snap modal:", error);
      this.showNotification("Failed to load snap.", "error");
    }
  }

  closeViewSnapModal() {
    const modal = document.getElementById("view-snap-modal");
    if (modal) modal.classList.add("hidden");
  }

  async viewReplies(snapId) {
    try {
      const modal = document.getElementById("replies-modal");
      const body = document.getElementById("replies-body");

      if (!modal || !body) return;

      // Store current snap ID for quick reply
      modal.dataset.currentSnapId = snapId;

      // Get the snap card for basic info
      const snapCard = document.querySelector(`[data-snap-id="${snapId}"]`);
      if (snapCard) {
        const senderName =
          snapCard.querySelector(".user-details h4")?.textContent || "Unknown";
        const time =
          snapCard.querySelector(".user-details .time")?.textContent || "";
        const caption = snapCard.querySelector(".caption")?.textContent || "";

        let contentHTML = "";
        const content = snapCard.querySelector(".snap-content");

        if (content.querySelector("img")) {
          const imgSrc = content.querySelector("img").src;
          contentHTML = `<img src="${imgSrc}" class="reply-snap-image">`;
        } else if (content.querySelector("video")) {
          const videoSrc = content.querySelector("video source")?.src || "";
          contentHTML = `<video controls><source src="${videoSrc}"></video>`;
        } else if (content.querySelector(".text-snap-content")) {
          const text = content.querySelector(".text-snap-content").textContent;
          contentHTML = `<div class="text-snap-content">${text}</div>`;
        }

        let html = `
          <div class="reply-item parent">
            <div class="reply-header">
              <div class="reply-sender">
                <div class="avatar-small">${senderName
                  .charAt(0)
                  .toUpperCase()}</div>
                <span>${senderName}</span>
              </div>
              <div class="reply-time">${time}</div>
            </div>
            <div class="reply-content">
              ${contentHTML}
            </div>
            ${caption ? `<p class="caption">${caption}</p>` : ""}
          </div>
        `;

        // TODO: Load actual replies from API
        html += `
          <div class="empty-state">
            <p>Replies feature coming soon!</p>
          </div>
        `;

        body.innerHTML = html;
        modal.classList.remove("hidden");
      }
    } catch (error) {
      console.error("Error viewing replies:", error);
      this.showNotification("Failed to load replies.", "error");
    }
  }

  closeRepliesModal() {
    const modal = document.getElementById("replies-modal");
    if (modal) modal.classList.add("hidden");
  }

  async sendQuickReply() {
    const input = document.getElementById("quick-reply-input");
    if (!input) return;

    const text = input.value.trim();

    if (!text) {
      this.showNotification("Please enter a reply.", "error");
      return;
    }

    const snapId =
      document.getElementById("replies-modal")?.dataset.currentSnapId;
    if (!snapId) {
      this.showNotification("No snap selected.", "error");
      return;
    }

    try {
      // This is a placeholder - implement actual reply sending
      this.showNotification("Replies feature coming soon!", "info");
      input.value = "";
    } catch (error) {
      console.error("Error sending quick reply:", error);
      this.showNotification("Failed to send reply.", "error");
    }
  }

  // REACTIONS
  async reactToSnap(snapId, emoji) {
    try {
      const response = await fetch(`/snaps/${snapId}/react`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": this.getCSRFToken(),
        },
        body: JSON.stringify({ emoji }),
      });

      const result = await response.json();

      if (result.success) {
        this.showNotification(`Reacted ${emoji} to snap!`, "success");
      } else {
        throw new Error(result.message);
      }
    } catch (error) {
      console.error("Error reacting to snap:", error);
      this.showNotification("Failed to react to snap.", "error");
    }
  }

  // UTILITY FUNCTIONS
  closeAllModals() {
    document.querySelectorAll(".modal").forEach((modal) => {
      modal.classList.add("hidden");
    });
  }

  showNotification(message, type = "info") {
    // Create notification element
    const notification = document.createElement("div");
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
      <div class="notification-content">
        <i class="fas ${
          type === "success"
            ? "fa-check-circle"
            : type === "error"
            ? "fa-exclamation-circle"
            : "fa-info-circle"
        }"></i>
        <span>${message}</span>
      </div>
    `;

    // Add to page
    document.body.appendChild(notification);

    // Remove after 5 seconds
    setTimeout(() => {
      notification.style.opacity = "0";
      notification.style.transform = "translateX(100%)";
      setTimeout(() => {
        notification.remove();
      }, 300);
    }, 5000);
  }
}

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  window.snapManager = new SnapManager();

  // Add filter button to camera interface
  const cameraHeader = document.querySelector(".camera-header");
  if (cameraHeader) {
    const filterBtn = document.createElement("button");
    filterBtn.className = "camera-btn";
    filterBtn.innerHTML = '<i class="fas fa-sliders-h"></i>';
    filterBtn.onclick = () => window.snapManager.showFilterSelector();

    // Insert before the last button (camera switch button)
    const switchBtn = cameraHeader.querySelector(
      '[onclick="snapManager.toggleCameraMode()"]'
    );
    if (switchBtn) {
      cameraHeader.insertBefore(filterBtn, switchBtn);
    } else {
      cameraHeader.appendChild(filterBtn);
    }
  }

  // Cleanup on page unload
  window.addEventListener("beforeunload", () => {
    if (window.snapManager.cameraState.stream) {
      window.snapManager.cameraState.stream
        .getTracks()
        .forEach((track) => track.stop());
    }
    if (window.snapManager.videoState.stream) {
      window.snapManager.videoState.stream
        .getTracks()
        .forEach((track) => track.stop());
    }
  });
});
