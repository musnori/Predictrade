import { initAuthAndRender } from "./auth.js";
import { createEvent } from "./storage.js";

function qs(id) {
  return document.getElementById(id);
}

function updateRemoveBtn() {
  const c = qs("optionsContainer");
  const rm = qs("removeOptionBtn");
  if (!c || !rm) return;
  const count = c.querySelectorAll("input").length;
  rm.classList.toggle("hidden", count <= 2);
}

document.addEventListener("DOMContentLoaded", async () => {
  await initAuthAndRender();

  const container = qs("optionsContainer");
  const addBtn = qs("addOptionBtn");
  const rmBtn = qs("removeOptionBtn");
  const msg = qs("msg");

  addBtn?.addEventListener("click", () => {
    const inputs = container.querySelectorAll("input");
    if (inputs.length >= 4) return;

    const inp = document.createElement("input");
    inp.className = "form-input w-full px-4 py-3 rounded-lg text-slate-100";
    inp.placeholder = `選択肢${inputs.length + 1}`;
    inp.required = true;
    container.appendChild(inp);
    updateRemoveBtn();
  });

  rmBtn?.addEventListener("click", () => {
    const inputs = container.querySelectorAll("input");
    if (inputs.length <= 2) return;
    inputs[inputs.length - 1].remove();
    updateRemoveBtn();
  });

  updateRemoveBtn();

  qs("createEventForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "";

    try {
      const title = qs("eventTitle").value.trim();
      const description = qs("eventDescription").value.trim();
      const category = qs("eventCategory").value;
      const endDate = qs("endDate").value;
      const prizePool = Number(qs("prizePool").value || 0);

      const options = Array.from(container.querySelectorAll("input"))
        .map((i) => i.value.trim())
        .filter(Boolean);

      if (options.length < 2 || options.length > 4) {
        msg.textContent = "選択肢は2〜4個にしてください";
        return;
      }

      const ev = await createEvent({
        title,
        description,
        category,
        endDate,
        prizePool,
        options,
      });

      location.href = `event.html?id=${ev.id}`;
    } catch (err) {
      msg.textContent = String(err?.message || err);
    }
  });
});
