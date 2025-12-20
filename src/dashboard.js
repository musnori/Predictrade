import { initAuthAndRender } from "./auth.js";

document.addEventListener("DOMContentLoaded", async () => {
  const user = await initAuthAndRender();
  document.getElementById("totalPoints").textContent = user.points.toLocaleString();
  document.getElementById("participatedEvents").textContent = "-";
  document.getElementById("predCount").textContent = "-";
});
