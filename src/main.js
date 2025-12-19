import { getEvents, getUser, getCategoryName, timeRemaining, seedIfEmpty } from "./storage.js";

seedIfEmpty();

function setUserPoints() {
  const user = getUser();
  const el = document.getElementById("userPoints");
  if (el) el.textContent = user.points.toLocaleString();
}

function render() {
  const grid = document.getElementById("eventsGrid");
  if (!grid) return;

  const cat = document.getElementById("filterCategory")?.value || "";
  const sortBy = document.getElementById("sortBy")?.value || "soon";

  let events = getEvents().filter(e => e.status === "active");

  if (cat) events = events.filter(e => e.category === cat);

  if (sortBy === "soon") {
    events.sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
  } else {
    events.sort((a, b) => (b.participants || 0) - (a.participants || 0));
  }

  grid.innerHTML = "";
  events.forEach((event, idx) => {
    const card = document.createElement("div");
    card.className = "event-card rounded-xl p-6 card-hover cursor-pointer";
    card.onclick = () => location.href = `event.html?id=${event.id}`;

    const categoryColors = {
      sports: "bg-blue-500/20 text-blue-400",
      politics: "bg-red-500/20 text-red-400",
      tech: "bg-purple-500/20 text-purple-400",
      finance: "bg-yellow-500/20 text-yellow-400",
      entertainment: "bg-pink-500/20 text-pink-400",
      other: "bg-gray-500/20 text-gray-400"
    };

    card.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <span class="px-3 py-1 rounded-full text-sm font-medium ${categoryColors[event.category] || categoryColors.other}">
          ${getCategoryName(event.category)}
        </span>
        <div class="text-sm text-slate-400">${timeRemaining(event.endDate)}</div>
      </div>
      <h3 class="text-lg font-bold text-slate-100 mb-3 line-clamp-2">${event.title}</h3>
      <p class="text-slate-300 text-sm mb-4 line-clamp-2">${event.description}</p>
      <div class="flex items-center justify-between text-sm text-slate-400">
        <div>参加者: <span class="text-slate-200">${event.participants}</span></div>
        <div>プール: <span class="text-slate-200">${event.prizePool.toLocaleString()}</span>pt</div>
      </div>
    `;

    grid.appendChild(card);

    if (window.anime) {
      anime({
        targets: card,
        translateY: [30, 0],
        opacity: [0, 1],
        duration: 500,
        delay: idx * 80,
        easing: "easeOutQuart"
      });
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setUserPoints();
  render();
  document.getElementById("filterCategory")?.addEventListener("change", render);
  document.getElementById("sortBy")?.addEventListener("change", render);
});
