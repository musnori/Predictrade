import { getUser, getEvents } from "./storage.js";

function setUserPoints() {
  const user = getUser();
  const el = document.getElementById("userPoints");
  if (el) el.textContent = user.points.toLocaleString();
}

function loadStats() {
  const user = getUser();
  const events = getEvents();

  const participated = events.reduce((s, e) => s + (e.predictions?.some(p => p.userId === user.id) ? 1 : 0), 0);
  const predCount = events.reduce((s, e) => s + (e.predictions?.filter(p => p.userId === user.id).length || 0), 0);

  document.getElementById("totalPoints").textContent = user.points.toLocaleString();
  document.getElementById("participatedEvents").textContent = participated;
  document.getElementById("predCount").textContent = predCount;
}

document.addEventListener("DOMContentLoaded", () => {
  setUserPoints();
  loadStats();
});
