import { createEvent, getUser, seedIfEmpty } from "./storage.js";

seedIfEmpty();

let optionCount = 2;
const maxOptions = 4;
const minOptions = 2;

function setUserPoints() {
  const user = getUser();
  const el = document.getElementById("userPoints");
  if (el) el.textContent = user.points.toLocaleString();
}

function setMinimumDate() {
  const endDateInput = document.getElementById("endDate");
  if (!endDateInput) return;

  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  endDateInput.min = now.toISOString().slice(0, 16);

  const defaultDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  endDateInput.value = defaultDate.toISOString().slice(0, 16);
}

function addOption() {
  if (optionCount >= maxOptions) return;
  optionCount++;

  const container = document.getElementById("optionsContainer");
  const input = document.createElement("input");
  input.className = "form-input w-full px-4 py-3 rounded-lg text-slate-100";
  input.placeholder = `選択肢${optionCount}`;
  input.required = true;
  container.appendChild(input);

  updateOptionButtons();

  if (window.anime) {
    anime({ targets: input, translateY: [-10, 0], opacity: [0, 1], duration: 250, easing: "easeOutQuart" });
  }
}

function removeOption() {
  if (optionCount <= minOptions) return;
  const container = document.getElementById("optionsContainer");
  const last = container.lastElementChild;
  if (!last) return;

  if (window.anime) {
    anime({
      targets: last,
      translateY: [0, -10],
      opacity: [1, 0],
      duration: 200,
      easing: "easeOutQuart",
      complete: () => {
        container.removeChild(last);
        optionCount--;
        updateOptionButtons();
      }
    });
  } else {
    container.removeChild(last);
    optionCount--;
    updateOptionButtons();
  }
}

function updateOptionButtons() {
  const addBtn = document.getElementById("addOptionBtn");
  const removeBtn = document.getElementById("removeOptionBtn");
  if (addBtn) addBtn.style.display = optionCount >= maxOptions ? "none" : "inline-block";
  if (removeBtn) removeBtn.classList.toggle("hidden", optionCount <= minOptions);
}

function readOptions() {
  const inputs = [...document.querySelectorAll("#optionsContainer input")];
  return inputs.map(i => i.value.trim()).filter(Boolean);
}

async function handleSubmit(e) {
  e.preventDefault();
  const msg = document.getElementById("msg");

  const title = document.getElementById("eventTitle").value.trim();
  const description = document.getElementById("eventDescription").value.trim();
  const category = document.getElementById("eventCategory").value;
  const endDate = document.getElementById("endDate").value;
  const prizePool = document.getElementById("prizePool").value;
  const options = readOptions();

  if (options.length < 2) {
    msg.textContent = "選択肢は最低2つ必要です";
    return;
  }

  const ev = createEvent({ title, description, category, endDate: new Date(endDate).toISOString(), prizePool, options });

  msg.textContent = "作成しました。イベント詳細へ移動します…";
  setTimeout(() => (location.href = `event.html?id=${ev.id}`), 400);
}

document.addEventListener("DOMContentLoaded", () => {
  setUserPoints();
  setMinimumDate();
  updateOptionButtons();

  document.getElementById("addOptionBtn")?.addEventListener("click", addOption);
  document.getElementById("removeOptionBtn")?.addEventListener("click", removeOption);
  document.getElementById("createEventForm")?.addEventListener("submit", handleSubmit);
});
