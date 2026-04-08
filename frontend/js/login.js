/**
 * Shelf — Login / Register page logic.
 */
const TOKEN_KEY = "shelf_token";
let _isRegister = false;

document.addEventListener("DOMContentLoaded", function () {
  // Already logged in — go straight to dashboard
  if (localStorage.getItem(TOKEN_KEY)) {
    window.location.href = "/dashboard";
    return;
  }

  document.getElementById("auth-toggle-link").addEventListener("click", function (e) {
    e.preventDefault();
    _isRegister = !_isRegister;
    updateMode();
  });

  document.getElementById("auth-form").addEventListener("submit", handleSubmit);
});

function updateMode() {
  document.getElementById("auth-title").textContent = _isRegister ? "Create account" : "Log in";
  document.getElementById("auth-submit").textContent = _isRegister ? "Create account" : "Log in";
  document.getElementById("confirm-group").hidden = !_isRegister;
  document.getElementById("auth-toggle-text").textContent = _isRegister
    ? "Already have an account?"
    : "Don't have an account?";
  document.getElementById("auth-toggle-link").textContent = _isRegister ? "Log in" : "Register";
  clearError();
}

function showError(msg) {
  const el = document.getElementById("auth-error");
  el.textContent = msg;
  el.style.color = "";
}

function showSuccess(msg) {
  const el = document.getElementById("auth-error");
  el.textContent = msg;
  el.style.color = "var(--status-finished)";
}

function clearError() {
  const el = document.getElementById("auth-error");
  el.textContent = "";
  el.style.color = "";
}

async function handleSubmit(e) {
  e.preventDefault();
  clearError();

  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;

  if (_isRegister) {
    const confirm = document.getElementById("auth-confirm").value;
    if (password !== confirm) {
      showError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      showError("Password must be at least 8 characters.");
      return;
    }
  }

  const endpoint = _isRegister ? "/api/auth/register" : "/api/auth/login";

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      showError(data.error || "Something went wrong.");
      return;
    }

    if (_isRegister) {
      _isRegister = false;
      updateMode();
      showSuccess("Account created! Please log in.");
      return;
    }

    // Login success
    localStorage.setItem(TOKEN_KEY, data.token);
    window.location.href = "/dashboard";
  } catch (err) {
    showError("Network error. Please try again.");
  }
}
