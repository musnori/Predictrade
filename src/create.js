import { initAuthAndRender } from "./auth.js";
import { createEvent } from "./storage.js";

let optionCount = 2;
const maxOptions = 6;

function setMinimumDate() {
  const endDateInput = document.getElementById("endDate");
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  endDateInput.min = now.toISOString().slice(0, 16);
  const def = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  endDateInput.value = def.toISOString().slice(0, 16);
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
}

function readOptions() {
  const inputs = [...document.querySelectorAll("#optionsContainer input")];
  return inputs.map((i) => i.value.trim()).filter(Boolean);
}

document.addEventListener("DOMContentLoaded", async () => {
  const auth = await initAuthAndRender();
  setMinimumDate();

  document.getElementById("addOptionBtn")?.addEventListener("click", addOption);

  document.getElementById("createEventForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("msg");
    msg.textContent = "";

    try {
      const adminKey = document.getElementById("adminKey").value.trim();
      const title = document.getElementById("eventTitle").value.trim();
      const description = document.getElementById("eventDescription").value.trim();
      const category = document.getElementById("eventCategory").value;
      const endDate = document.getElementById("endDate").value;
      const liquidityB = Number(document.getElementById("liquidityB").value);
      const options = readOptions();

      if (options.length < 2) throw new Error("選択肢は最低2つ必要です");

      const ev = await createEvent(
        {
          deviceId: auth.deviceId,
          title,
          description,
          category,
          endDate: new Date(endDate).toISOString(),
          liquidityB,
          options,
        },
        adminKey
      );

      msg.textContent = "作成しました。イベントへ移動します…";
      setTimeout(() => (location.href = `event.html?id=${ev.id}`), 300);
    } catch (err) {
      msg.textContent = String(err?.message || err);
    }
  });
});
