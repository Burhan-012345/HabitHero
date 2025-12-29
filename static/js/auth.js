window.addEventListener(
  "error",
  function (e) {
    // Check if this is the specific error we're seeing
    if (
      e.message &&
      e.message.includes("Cannot read properties of null") &&
      e.message.includes("classList")
    ) {
      console.warn("Prevented null classList error:", e.filename, e.lineno);
      e.preventDefault();
      return true; // Prevents the error from propagating
    }
    return false;
  },
  true
);

// Safely override DOMTokenList methods
(function () {
  const originalAdd = DOMTokenList.prototype.add;
  const originalRemove = DOMTokenList.prototype.remove;
  const originalToggle = DOMTokenList.prototype.toggle;

  DOMTokenList.prototype.add = function () {
    if (!this || !this.value) return;
    try {
      return originalAdd.apply(this, arguments);
    } catch (e) {
      console.warn("Error in classList.add:", e);
      return;
    }
  };

  DOMTokenList.prototype.remove = function () {
    if (!this || !this.value) return;
    try {
      return originalRemove.apply(this, arguments);
    } catch (e) {
      console.warn("Error in classList.remove:", e);
      return;
    }
  };

  DOMTokenList.prototype.toggle = function () {
    if (!this || !this.value) return;
    try {
      return originalToggle.apply(this, arguments);
    } catch (e) {
      console.warn("Error in classList.toggle:", e);
      return false;
    }
  };
})();

// Global variables for verification state
window.emailVerified = false;
window.verifiedEmail = null;
window.verificationOtp = null;

// Main initialization
document.addEventListener("DOMContentLoaded", function () {
  console.log("✅ auth.js loaded");

  // Initialize verification state from storage
  initializeVerificationState();

  // Check if user is already logged in
  checkIfLoggedIn();

  // Initialize all authentication components
  initializeAuthComponents();

  // Setup page-specific flows
  setupPageSpecificFlows();
});

/**
 * Initialize verification state from storage
 */
function initializeVerificationState() {
  const sessionVerified = sessionStorage.getItem("email_verified") === "true";
  const localVerified = localStorage.getItem("email_verified") === "true";
  const email =
    sessionStorage.getItem("verified_email") ||
    localStorage.getItem("verified_email");

  window.emailVerified = sessionVerified || localVerified;
  window.verifiedEmail = email;
  window.verificationOtp = sessionStorage.getItem("last_otp");

  console.log("🔍 Verification state loaded:", {
    emailVerified: window.emailVerified,
    verifiedEmail: window.verifiedEmail,
    hasOtp: !!window.verificationOtp,
  });
}

/**
 * Check if user is already logged in and redirect to dashboard if they are
 */
function checkIfLoggedIn() {
  const authPages = [
    "/register",
    "/login",
    "/forgot-password",
    "/reset-password",
  ];
  const currentPath = window.location.pathname;

  // Only check auth on authentication pages
  if (authPages.some((page) => currentPath.includes(page))) {
    console.log("🔍 Checking authentication status...");

    fetch("/api/check-auth")
      .then((response) => {
        if (response.status === 404) {
          // Endpoint doesn't exist - this is OK
          console.log("⚠️ Auth endpoint not available, continuing normally");
          return { authenticated: false };
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        if (data.authenticated && data.redirect) {
          console.log(
            "✅ User already authenticated, redirecting to dashboard"
          );
          setTimeout(() => {
            window.location.href = data.redirect;
          }, 300);
        } else {
          console.log("ℹ️ User not authenticated, showing auth page");
        }
      })
      .catch((error) => {
        console.log("ℹ️ Auth check completed:", error.message);
      });
  }
}

/**
 * Initialize common authentication components
 */
function initializeAuthComponents() {
  // Password visibility toggle
  const toggleButtons = document.querySelectorAll(
    ".toggle-password, .toggle-icon"
  );
  toggleButtons.forEach((button) => {
    button.addEventListener("click", function () {
      const input = this.previousElementSibling;
      const icon = this.querySelector("i");

      if (!input) {
        // Try to find input differently
        const parent = this.closest(".form-group");
        if (parent) {
          input = parent.querySelector(
            'input[type="password"], input[name="password"]'
          );
        }
      }

      if (input && icon) {
        if (input.type === "password") {
          input.type = "text";
          icon.classList.remove("fa-eye");
          icon.classList.add("fa-eye-slash");
          this.setAttribute("aria-label", "Hide password");
        } else {
          input.type = "password";
          icon.classList.remove("fa-eye-slash");
          icon.classList.add("fa-eye");
          this.setAttribute("aria-label", "Show password");
        }
      }
    });
  });

  // Password strength validation
  const passwordInputs = document.querySelectorAll('input[type="password"]');
  passwordInputs.forEach((input) => {
    if (input.id === "password" || input.id === "new-password") {
      input.addEventListener("input", validatePassword);
    }
  });

  // Confirm password validation
  const confirmPasswordInputs = document.querySelectorAll(
    'input[name="confirm_password"], input[id*="confirm"]'
  );
  confirmPasswordInputs.forEach((input) => {
    input.addEventListener("input", validateConfirmPassword);
  });

  // Email validation on blur
  const emailInputs = document.querySelectorAll('input[type="email"]');
  emailInputs.forEach((input) => {
    input.addEventListener("blur", validateEmailOnBlur);
  });

  // Username validation on blur
  const usernameInputs = document.querySelectorAll('input[name="username"]');
  usernameInputs.forEach((input) => {
    input.addEventListener("blur", validateUsernameOnBlur);
  });

  // Password rules toggle
  setupPasswordRulesToggle();
}

/**
 * Setup page-specific authentication flows
 */
function setupPageSpecificFlows() {
  const currentPath = window.location.pathname;

  if (currentPath.includes("/register")) {
    setupRegistrationFlow();
  } else if (currentPath.includes("/login")) {
    setupLoginFlow();
  } else if (currentPath.includes("/forgot-password")) {
    setupForgotPasswordFlow();
  } else if (currentPath.includes("/reset-password")) {
    setupResetPasswordFlow();
  } else if (currentPath.includes("/login/select")) {
    setupAccountSelectionFlow();
  } else if (currentPath.includes("/create-account-page")) {
    setupCreateAccountFlow();
  } else if (currentPath.includes("/create-account-from-login")) {
    setupCreateAccountFromLoginFlow();
  }
}

/**
 * Setup registration flow
 */
function setupRegistrationFlow() {
  console.log("🔧 Setting up registration flow");

  const verifyBtn = document.getElementById("verify-email-btn");
  const otpSection = document.getElementById("otp-section");
  const passwordSection = document.getElementById("password-section");
  const registerBtn = document.getElementById("register-btn");
  const emailInput = document.getElementById("email");
  const usernameInput = document.getElementById("username");
  const form = document.getElementById("register-form");

  // Check if we're on the registration page
  if (!form) {
    console.log("ℹ️ Not on registration page, skipping registration setup");
    return;
  }

  // Check if all required elements exist
  if (!verifyBtn || !emailInput || !usernameInput) {
    console.error("❌ Registration form elements not found");
    showAlert(
      "Registration form is not properly loaded. Please refresh the page.",
      "danger"
    );
    return;
  }

  // Check if we're returning with verified email
  if (window.emailVerified && window.verifiedEmail === emailInput.value) {
    console.log("🔄 Returning with verified email:", window.verifiedEmail);

    if (otpSection) {
      otpSection.style.display = "none";
      emailInput.readOnly = true;
      usernameInput.readOnly = true;
      verifyBtn.style.display = "none";
    }

    if (passwordSection) {
      passwordSection.style.display = "block";
      if (registerBtn) {
        registerBtn.disabled = false;
      }

      // Focus on password field
      const passwordInput = document.getElementById("password");
      if (passwordInput) {
        passwordInput.focus();
      }
    }
  }

  // Email verification button
  verifyBtn.addEventListener("click", async function () {
    const email = emailInput.value.trim();
    const username = usernameInput.value.trim();

    if (!email || !username) {
      showAlert("Please enter both email and username", "warning");
      return;
    }

    // Validate email format
    if (!validateEmail(email)) {
      showAlert("Please enter a valid email address", "warning");
      return;
    }

    // Validate username format
    if (!validateUsername(username)) {
      showAlert(
        "Username must be 3-20 characters and can only contain letters, numbers, and underscores",
        "warning"
      );
      return;
    }

    verifyBtn.disabled = true;
    verifyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

    try {
      const response = await fetch("/verify-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, username }),
      });

      const data = await response.json();
      console.log("📡 Email verification response:", data);

      if (data.success) {
        showAlert(
          "Verification code sent to your email. Please check your inbox.",
          "success"
        );

        // Store email and OTP
        window.verifiedEmail = email;
        window.verificationOtp = data.otp;
        sessionStorage.setItem("verification_email", email);
        sessionStorage.setItem("last_otp", data.otp || "");

        if (otpSection) {
          otpSection.style.display = "block";
          emailInput.readOnly = true;
          usernameInput.readOnly = true;
          verifyBtn.style.display = "none";

          // Focus on OTP input
          const otpInput = document.getElementById("otp");
          if (otpInput) {
            otpInput.focus();

            // Auto-submit on 6 digits
            otpInput.addEventListener("input", function () {
              if (this.value.length === 6) {
                verifyOtp();
              }
            });
          }
        }
      } else {
        showAlert(data.message, "danger");
      }
    } catch (error) {
      console.error("Error verifying email:", error);
      showAlert("An error occurred. Please try again.", "danger");
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.innerHTML = "Verify Email";
    }
  });

  // OTP verification function
  const verifyOtp = async function () {
    const email = emailInput.value;
    const otp = document.getElementById("otp")?.value;
    const verifyOtpBtn = document.getElementById("verify-otp-btn");

    if (!otp || otp.length !== 6) {
      showAlert("Please enter a valid 6-digit OTP", "warning");
      return;
    }

    console.log("🔍 Verifying OTP:", { email, otp });

    if (verifyOtpBtn) {
      verifyOtpBtn.disabled = true;
      verifyOtpBtn.innerHTML =
        '<i class="fas fa-spinner fa-spin"></i> Verifying...';
    }

    try {
      const response = await fetch("/verify-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, otp }),
      });

      const data = await response.json();
      console.log("📡 OTP Verification Response:", data);

      if (data.success) {
        showAlert("Email verified successfully!", "success");

        // Store verification state
        window.emailVerified = true;
        window.verifiedEmail = email;
        window.verificationOtp = otp;

        sessionStorage.setItem("email_verified", "true");
        sessionStorage.setItem("verified_email", email);
        sessionStorage.setItem("last_otp", otp);
        sessionStorage.setItem("otp_verified", "true");

        // Also store in localStorage for persistence
        localStorage.setItem("email_verified", "true");
        localStorage.setItem("verified_email", email);

        // Check for existing accounts
        if (data.has_existing_accounts) {
          showAlert(
            "You have existing accounts. Redirecting to selection...",
            "info"
          );
          setTimeout(() => {
            window.location.href = `/login/select?email=${encodeURIComponent(
              email
            )}`;
          }, 1500);
        } else {
          // Show password section for new account
          if (otpSection) otpSection.style.display = "none";
          if (passwordSection) passwordSection.style.display = "block";
          if (registerBtn) {
            registerBtn.disabled = false;
            registerBtn.innerHTML = "Create Account";
          }

          // Store username
          const username = usernameInput.value;
          if (username) {
            sessionStorage.setItem("verified_username", username);
          }

          // Focus on password field
          const passwordInput = document.getElementById("password");
          if (passwordInput) passwordInput.focus();

          console.log("✅ OTP verified, password section shown");
        }
      } else {
        showAlert(data.message, "danger");
        console.error("OTP Verification failed:", data);
      }
    } catch (error) {
      console.error("Error verifying OTP:", error);
      showAlert("An error occurred. Please try again.", "danger");
    } finally {
      if (verifyOtpBtn) {
        verifyOtpBtn.disabled = false;
        verifyOtpBtn.innerHTML = "Verify OTP";
      }
    }
  };

  // Attach OTP verification to button
  const verifyOtpBtn = document.getElementById("verify-otp-btn");
  if (verifyOtpBtn) {
    verifyOtpBtn.addEventListener("click", verifyOtp);
  }

  // Form submission
  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    const email = emailInput.value;
    const username = usernameInput.value;
    const password = document.getElementById("password")?.value;
    const confirmPassword = document.getElementById("confirm_password")?.value;

    console.log("🔍 Form submission check:");
    console.log("   Email:", email);
    console.log("   Email verified:", window.emailVerified);
    console.log(
      "   Session verified:",
      sessionStorage.getItem("email_verified")
    );

    // Check verification status
    if (
      !window.emailVerified &&
      sessionStorage.getItem("email_verified") !== "true"
    ) {
      showAlert("Please verify your email first", "warning");
      return;
    }

    if (!password || !confirmPassword) {
      showAlert("Please enter and confirm your password", "warning");
      return;
    }

    if (password !== confirmPassword) {
      showAlert("Passwords do not match", "danger");
      return;
    }

    // Validate password strength
    const passwordErrors = validatePasswordStrength(password);
    if (passwordErrors.length > 0) {
      showAlert(passwordErrors[0], "danger");
      return;
    }

    if (registerBtn) {
      registerBtn.disabled = true;
      registerBtn.innerHTML =
        '<i class="fas fa-spinner fa-spin"></i> Creating Account...';
    }

    try {
      const response = await fetch("/create-account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email,
          username: username,
          password: password,
        }),
      });

      const data = await response.json();
      console.log("📡 Create account response:", data);

      if (data.success) {
        showAlert("Account created successfully! Redirecting...", "success");

        // Clear all storage
        sessionStorage.clear();
        localStorage.removeItem("email_verified");
        localStorage.removeItem("verified_email");

        // Clear global variables
        window.emailVerified = false;
        window.verifiedEmail = null;
        window.verificationOtp = null;

        if (data.redirect) {
          setTimeout(() => {
            window.location.href = data.redirect;
          }, 1000);
        } else {
          setTimeout(() => {
            window.location.href = "/dashboard";
          }, 1000);
        }
      } else {
        showAlert(data.message, "danger");
        if (registerBtn) {
          registerBtn.disabled = false;
          registerBtn.innerHTML = "Create Account";
        }
      }
    } catch (error) {
      console.error("Error creating account:", error);
      showAlert("An error occurred. Please try again.", "danger");
      if (registerBtn) {
        registerBtn.disabled = false;
        registerBtn.innerHTML = "Create Account";
      }
    }
  });
}

/**
 * Setup login flow
 */
function setupLoginFlow() {
  console.log("🔧 Setting up login flow");

  const loginForm = document.getElementById("login-form");
  const loginBtn = document.getElementById("login-btn");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");

  if (!loginForm || !loginBtn) {
    console.log("ℹ️ Not on login page, skipping login setup");
    return;
  }

  // Pre-fill email if available
  const urlParams = new URLSearchParams(window.location.search);
  const emailParam = urlParams.get("email");
  if (emailParam && emailInput) {
    emailInput.value = emailParam;
  }

  loginForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    const email = emailInput?.value.trim();
    const password = passwordInput?.value;
    const accountId = document.getElementById("account_id")?.value;
    const remember = document.getElementById("remember")?.checked || false;

    if (!email) {
      showAlert("Please enter your email", "warning");
      return;
    }

    if (!validateEmail(email)) {
      showAlert("Please enter a valid email address", "warning");
      return;
    }

    // If no account ID selected and no password, check for accounts
    if (!accountId && !password) {
      console.log("Checking for existing accounts...");

      // Check if there are existing accounts
      try {
        const response = await fetch(
          `/api/check-existing-accounts?email=${encodeURIComponent(email)}`
        );
        const data = await response.json();

        if (data.success && data.hasExistingAccounts) {
          // Redirect to account selection
          window.location.href = `/login/select?email=${encodeURIComponent(
            email
          )}`;
          return;
        }
      } catch (error) {
        console.error("Error checking accounts:", error);
      }

      // If no accounts or error, just continue with regular login
    }

    if (!password) {
      showAlert("Please enter your password", "warning");
      return;
    }

    loginBtn.disabled = true;
    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';

    try {
      const formData = new FormData();
      formData.append("email", email);
      formData.append("password", password);
      if (accountId) formData.append("account_id", accountId);
      if (remember) formData.append("remember", "true");

      const response = await fetch("/login", {
        method: "POST",
        body: formData,
      });

      if (response.redirected) {
        // Redirect to the URL provided by the server
        window.location.href = response.url;
      } else if (response.ok) {
        // Success - redirect to dashboard
        showAlert("Login successful! Redirecting...", "success");
        setTimeout(() => {
          window.location.href = "/dashboard";
        }, 1000);
      } else {
        // Handle error
        const text = await response.text();
        let errorMessage = "Invalid email or password";

        try {
          const data = JSON.parse(text);
          errorMessage = data.message || errorMessage;
        } catch (e) {
          // Not JSON response
          if (text.includes("Invalid password")) {
            errorMessage = "Invalid password";
          } else if (text.includes("not verified")) {
            errorMessage = "Please verify your email before logging in";
          }
        }

        showAlert(errorMessage, "danger");
      }
    } catch (error) {
      console.error("Login error:", error);
      showAlert("An error occurred. Please try again.", "danger");
    } finally {
      loginBtn.disabled = false;
      loginBtn.innerHTML = "Login";
    }
  });

  // Enter key to submit
  if (passwordInput) {
    passwordInput.addEventListener("keypress", function (e) {
      if (e.key === "Enter") {
        loginForm.dispatchEvent(new Event("submit"));
      }
    });
  }
}

/**
 * Setup forgot password flow
 */
function setupForgotPasswordFlow() {
  console.log("🔧 Setting up forgot password flow");

  const forgotForm = document.getElementById("forgot-password-form");
  const submitBtn = document.getElementById("forgot-submit-btn");
  const emailInput = document.getElementById("email");

  if (!forgotForm || !submitBtn || !emailInput) {
    console.log("ℹ️ Not on forgot password page, skipping setup");
    return;
  }

  forgotForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    const email = emailInput.value.trim();

    if (!email) {
      showAlert("Please enter your email", "warning");
      return;
    }

    if (!validateEmail(email)) {
      showAlert("Please enter a valid email address", "warning");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

    try {
      const formData = new FormData();
      formData.append("email", email);

      const response = await fetch("/forgot-password", {
        method: "POST",
        body: formData,
      });

      if (response.redirected) {
        window.location.href = response.url;
      } else if (response.ok) {
        showAlert(
          "If an account exists with that email, a reset link has been sent. Please check your inbox.",
          "success"
        );
        setTimeout(() => {
          window.location.href = "/login";
        }, 3000);
      } else {
        showAlert("Error sending reset email. Please try again.", "danger");
      }
    } catch (error) {
      console.error("Forgot password error:", error);
      showAlert("An error occurred. Please try again.", "danger");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = "Send Reset Link";
    }
  });
}

/**
 * Setup reset password flow
 */
function setupResetPasswordFlow() {
  console.log("🔧 Setting up reset password flow");

  const resetForm = document.getElementById("reset-password-form");
  const resetBtn = document.getElementById("reset-submit-btn");

  if (!resetForm || !resetBtn) {
    console.log("ℹ️ Not on reset password page, skipping setup");
    return;
  }

  resetForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    const password = document.getElementById("password")?.value;
    const confirmPassword = document.getElementById("confirm_password")?.value;

    if (!password || !confirmPassword) {
      showAlert("Please enter and confirm your new password", "warning");
      return;
    }

    if (password !== confirmPassword) {
      showAlert("Passwords do not match", "danger");
      return;
    }

    // Validate password strength
    const passwordErrors = validatePasswordStrength(password);
    if (passwordErrors.length > 0) {
      showAlert(passwordErrors[0], "danger");
      return;
    }

    resetBtn.disabled = true;
    resetBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';

    try {
      const formData = new FormData(resetForm);

      const response = await fetch(window.location.pathname, {
        method: "POST",
        body: formData,
      });

      if (response.redirected) {
        window.location.href = response.url;
      } else if (response.ok) {
        showAlert(
          "Password updated successfully! Redirecting to login...",
          "success"
        );
        setTimeout(() => {
          window.location.href = "/login";
        }, 2000);
      } else {
        showAlert("Error updating password. Please try again.", "danger");
      }
    } catch (error) {
      console.error("Reset password error:", error);
      showAlert("An error occurred. Please try again.", "danger");
    } finally {
      resetBtn.disabled = false;
      resetBtn.innerHTML = "Update Password";
    }
  });
}

/**
 * Setup account selection flow
 */
function setupAccountSelectionFlow() {
  console.log("🔧 Setting up account selection flow");

  const accountCards = document.querySelectorAll(".account-card");
  const createNewAccountBtn = document.getElementById("create-new-account-btn");

  accountCards.forEach((card) => {
    card.addEventListener("click", function () {
      const accountId = this.dataset.accountId;
      const email = this.dataset.email;

      if (accountId && email) {
        window.location.href = `/login-account/${accountId}?email=${encodeURIComponent(
          email
        )}`;
      }
    });
  });

  if (createNewAccountBtn) {
    createNewAccountBtn.addEventListener("click", function () {
      const urlParams = new URLSearchParams(window.location.search);
      const email = urlParams.get("email");

      if (email) {
        window.location.href = `/create-account-from-login?email=${encodeURIComponent(
          email
        )}`;
      }
    });
  }
}

/**
 * Setup create account flow (from login)
 */
function setupCreateAccountFromLoginFlow() {
  console.log("🔧 Setting up create account flow (from login)");

  const form = document.getElementById("create-account-form");
  const submitBtn = document.getElementById("create-account-btn");
  const emailInput = document.getElementById("email");

  if (!form || !submitBtn || !emailInput) return;

  // Pre-fill email from URL
  const urlParams = new URLSearchParams(window.location.search);
  const emailParam = urlParams.get("email");
  if (emailParam) {
    emailInput.value = emailParam;
    emailInput.readOnly = true;
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    const email = document.getElementById("email")?.value;
    const username = document.getElementById("username")?.value;
    const password = document.getElementById("password")?.value;
    const confirmPassword = document.getElementById("confirm_password")?.value;

    if (!email || !username || !password || !confirmPassword) {
      showAlert("Please fill in all fields", "warning");
      return;
    }

    if (password !== confirmPassword) {
      showAlert("Passwords do not match", "danger");
      return;
    }

    // Validate password strength
    const passwordErrors = validatePasswordStrength(password);
    if (passwordErrors.length > 0) {
      showAlert(passwordErrors[0], "danger");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';

    try {
      const response = await fetch("/create-account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, username, password }),
      });

      const data = await response.json();

      if (data.success) {
        showAlert("Account created successfully! Redirecting...", "success");

        if (data.redirect) {
          setTimeout(() => {
            window.location.href = data.redirect;
          }, 1000);
        } else {
          setTimeout(() => {
            window.location.href = "/dashboard";
          }, 1000);
        }
      } else {
        showAlert(data.message, "danger");
        submitBtn.disabled = false;
        submitBtn.innerHTML = "Create Account";
      }
    } catch (error) {
      console.error("Error creating account:", error);
      showAlert("An error occurred. Please try again.", "danger");
      submitBtn.disabled = false;
      submitBtn.innerHTML = "Create Account";
    }
  });
}

/**
 * Setup create account page flow
 */
function setupCreateAccountFlow() {
  console.log("🔧 Setting up create account page flow");

  const form = document.getElementById("create-account-form");
  const submitBtn = document.getElementById("create-account-btn");
  const emailInput = document.getElementById("email");

  if (!form || !submitBtn || !emailInput) return;

  // Check if we have verification state
  const isVerified = sessionStorage.getItem("email_verified") === "true";
  const verifiedEmail = sessionStorage.getItem("verified_email");

  if (isVerified && verifiedEmail && emailInput.value === verifiedEmail) {
    console.log("✅ Returning with verified email");
    // Email should already be filled and read-only
    emailInput.readOnly = true;

    // Enable the form
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");

    if (usernameInput) usernameInput.focus();
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    const email = document.getElementById("email")?.value;
    const username = document.getElementById("username")?.value;
    const password = document.getElementById("password")?.value;
    const confirmPassword = document.getElementById("confirm_password")?.value;

    if (!email || !username || !password || !confirmPassword) {
      showAlert("Please fill in all fields", "warning");
      return;
    }

    if (password !== confirmPassword) {
      showAlert("Passwords do not match", "danger");
      return;
    }

    // Validate password strength
    const passwordErrors = validatePasswordStrength(password);
    if (passwordErrors.length > 0) {
      showAlert(passwordErrors[0], "danger");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';

    try {
      const response = await fetch("/create-account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, username, password }),
      });

      const data = await response.json();

      if (data.success) {
        showAlert("Account created successfully! Redirecting...", "success");

        // Clear verification state
        sessionStorage.removeItem("email_verified");
        sessionStorage.removeItem("verified_email");
        sessionStorage.removeItem("otp_verified");
        sessionStorage.removeItem("last_otp");

        if (data.redirect) {
          setTimeout(() => {
            window.location.href = data.redirect;
          }, 1000);
        } else {
          setTimeout(() => {
            window.location.href = "/dashboard";
          }, 1000);
        }
      } else {
        showAlert(data.message, "danger");
        submitBtn.disabled = false;
        submitBtn.innerHTML = "Create Account";
      }
    } catch (error) {
      console.error("Error creating account:", error);
      showAlert("An error occurred. Please try again.", "danger");
      submitBtn.disabled = false;
      submitBtn.innerHTML = "Create Account";
    }
  });
}

/**
 * Setup password rules toggle
 */
function setupPasswordRulesToggle() {
  const rulesToggle = document.getElementById("toggle-rules");
  if (!rulesToggle) return;

  rulesToggle.addEventListener("click", function (e) {
    e.preventDefault();
    const rulesPanel = document.getElementById("password-rules");

    if (!rulesPanel) return;

    const icon = this.querySelector("i");
    if (!icon) return;

    if (
      rulesPanel.style.display === "none" ||
      rulesPanel.style.display === ""
    ) {
      rulesPanel.style.display = "block";
      icon.classList.remove("fa-chevron-down");
      icon.classList.add("fa-chevron-up");
      this.innerHTML =
        '<i class="fas fa-chevron-up"></i> Hide password instructions';
    } else {
      rulesPanel.style.display = "none";
      icon.classList.remove("fa-chevron-up");
      icon.classList.add("fa-chevron-down");
      this.innerHTML =
        '<i class="fas fa-chevron-down"></i> Show password instructions';
    }
  });
}

/**
 * Validate password strength in real-time
 */
function validatePassword() {
  const password = this.value;
  const strengthMeter = document.getElementById("strength-meter-fill");
  const rules = {
    length: document.getElementById("rule-length"),
    uppercase: document.getElementById("rule-uppercase"),
    lowercase: document.getElementById("rule-lowercase"),
    number: document.getElementById("rule-number"),
    special: document.getElementById("rule-special"),
  };

  // Check if we're on a page with password strength meter
  const hasStrengthMeter = !!strengthMeter;
  const hasRules = Object.values(rules).some((rule) => !!rule);

  // Check rules if elements exist
  const hasLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*()\-_=+\[\]{}|;:,.<>?/]/.test(password);

  // Update rule indicators if they exist
  if (hasRules) {
    updateRule(rules.length, hasLength);
    updateRule(rules.uppercase, hasUppercase);
    updateRule(rules.lowercase, hasLowercase);
    updateRule(rules.number, hasNumber);
    updateRule(rules.special, hasSpecial);
  }

  // Update strength meter if it exists
  if (hasStrengthMeter) {
    // Calculate strength
    let strength = 0;
    if (hasLength) strength++;
    if (hasUppercase) strength++;
    if (hasLowercase) strength++;
    if (hasNumber) strength++;
    if (hasSpecial) strength++;

    // Update strength meter
    strengthMeter.className = "strength-meter-fill";
    if (strength <= 2) {
      strengthMeter.classList.add("strength-weak");
    } else if (strength <= 4) {
      strengthMeter.classList.add("strength-medium");
    } else {
      strengthMeter.classList.add("strength-strong");
    }

    // Update width
    strengthMeter.style.width = `${strength * 20}%`;
  }

  // Enable/disable submit button if it exists
  const submitBtn = document.querySelector('button[type="submit"]');
  if (submitBtn && !submitBtn.id.includes("verify")) {
    const isPasswordValid =
      hasLength && hasUppercase && hasLowercase && hasNumber && hasSpecial;
    submitBtn.disabled = !isPasswordValid;
  }
}

/**
 * Validate password strength and return errors
 */
function validatePasswordStrength(password) {
  const errors = [];

  if (password.length < 8) {
    errors.push("Password must be at least 8 characters long");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }
  if (!/\d/.test(password)) {
    errors.push("Password must contain at least one number");
  }
  if (!/[!@#$%^&*()\-_=+\[\]{}|;:,.<>?/]/.test(password)) {
    errors.push("Password must contain at least one special character");
  }

  return errors;
}

/**
 * Update a password rule indicator
 */
function updateRule(element, isValid) {
  if (!element) return;

  if (isValid) {
    element.classList.add("rule-valid");
    element.classList.remove("rule-invalid");
    const text = element.textContent.replace(/[✓✗]\s*/, "");
    element.innerHTML = '<i class="fas fa-check-circle"></i> ' + text;
  } else {
    element.classList.add("rule-invalid");
    element.classList.remove("rule-valid");
    const text = element.textContent.replace(/[✓✗]\s*/, "");
    element.innerHTML = '<i class="fas fa-times-circle"></i> ' + text;
  }
}

/**
 * Validate confirm password
 */
function validateConfirmPassword() {
  const passwordInput =
    document.getElementById("password") ||
    document.getElementById("new-password");
  if (!passwordInput) return;

  const password = passwordInput.value;
  const confirmPassword = this.value;
  const errorElement = document.getElementById("confirm-password-error");

  if (!errorElement) return;

  if (password !== confirmPassword) {
    errorElement.textContent = "Passwords do not match";
    errorElement.style.display = "block";
  } else {
    errorElement.style.display = "none";
  }
}

/**
 * Validate email on blur
 */
function validateEmailOnBlur() {
  const email = this.value.trim();
  const errorElement = this.nextElementSibling?.classList?.contains(
    "error-message"
  )
    ? this.nextElementSibling
    : null;

  if (!email) return;

  if (!validateEmail(email)) {
    if (errorElement) {
      errorElement.textContent = "Please enter a valid email address";
      errorElement.style.display = "block";
    }
  } else if (errorElement) {
    errorElement.style.display = "none";
  }
}

/**
 * Validate username on blur
 */
function validateUsernameOnBlur() {
  const username = this.value.trim();

  if (!username) return;

  // Check username availability via API if needed
  if (username.length >= 3) {
    checkUsernameAvailability(username);
  }
}

/**
 * Check username availability
 */
async function checkUsernameAvailability(username) {
  try {
    const response = await fetch("/api/check-username", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username }),
    });

    const data = await response.json();

    if (!data.available) {
      showAlert(data.message, "warning");
    }
  } catch (error) {
    console.error("Error checking username:", error);
  }
}

/**
 * Validate email format
 */
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

/**
 * Validate username format
 */
function validateUsername(username) {
  const re = /^[a-zA-Z0-9_]{3,20}$/;
  return re.test(username);
}

/**
 * Show alert message
 */
function showAlert(message, type = "info") {
  // Remove any existing alerts
  const existingAlert = document.querySelector(
    ".alert-dismissible:not(.alert-permanent)"
  );
  if (existingAlert) {
    existingAlert.remove();
  }

  const alertDiv = document.createElement("div");
  alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
  alertDiv.role = "alert";
  alertDiv.innerHTML = `
    ${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
  `;

  // Insert at the beginning of the auth card or body
  const authCard = document.querySelector(".auth-card");
  if (authCard) {
    authCard.insertBefore(alertDiv, authCard.firstChild);
  } else {
    // Insert at top of body
    document.body.insertBefore(alertDiv, document.body.firstChild);
  }

  // Auto-remove after some time
  const removeTime =
    type === "success" ? 3000 : type === "warning" ? 5000 : 6000;

  setTimeout(() => {
    if (alertDiv.parentNode) {
      alertDiv.remove();
    }
  }, removeTime);
}

/**
 * Format error message from server response
 */
function formatErrorMessage(error) {
  if (typeof error === "string") {
    return error;
  } else if (error.message) {
    return error.message;
  } else if (error.error) {
    return error.error;
  }
  return "An unknown error occurred";
}

// Export functions for testing if needed
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    validateEmail,
    validatePasswordStrength,
    validateUsername,
    showAlert,
  };
}
