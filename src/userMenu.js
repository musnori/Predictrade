// src/userMenu.js
export function initUserMenu() {
  const btn = document.getElementById("userMenuBtn");
  const menu = document.getElementById("userMenu");
  if (!btn || !menu) return;

  const close = () => {
    menu.classList.add("hidden");
    btn.setAttribute("aria-expanded", "false");
  };

  const open = () => {
    menu.classList.remove("hidden");
    btn.setAttribute("aria-expanded", "true");
  };

  const toggle = () => {
    const isHidden = menu.classList.contains("hidden");
    if (isHidden) open();
    else close();
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });

  document.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}
