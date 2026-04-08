// Shelf — landing page
document.addEventListener("DOMContentLoaded", function () {
  // If already logged in, skip landing and go to dashboard
  if (localStorage.getItem("shelf_token")) {
    window.location.href = "/dashboard";
  }
});
