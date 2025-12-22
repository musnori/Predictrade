import { initAuthAndRender } from "./auth.js";
import { createEvent } from "./storage.js";

function setMinimumDate() {
  const endDateInput = document.getElementById("endDate");
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  endDateInput.min = now.toISOString().slice(0, 16);
  const def = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  endDateInput.value = def.toISOString().slice(0, 16);
}

function toggleRangesUI() {
  const on = document.getElementById("enableRanges")?.checked;
  const box = document.getElementById("rangesBox");
  if (!box) return;
  box.classList.toggle("hidden", !on);
}

document.addEventListener("DOMContentLoaded", async () => {
  const auth = await initAuthAndRender();
  setMinimumDate();

  document.getElementById("enableRanges")?.addEventListener("change", toggleRangesUI);
  toggleRangesUI();

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

      const enableRanges = !!document.getElementById("enableRanges")?.checked;

      const body = {
        deviceId: auth.deviceId, // (API側は使わなくてもOK)
        title,
        description,
        category,
        endDate: new Date(endDate).toISOString(),
      };

      if (enableRanges) {
        const start = Number(document.getElementById("rangeStart").value);
        const endV = Number(document.getElementById("rangeEnd").value);
        const step = Number(document.getElementById("rangeStep").value);

        if (![start, endV, step].every((x) => Number.isFinite(x))) {
          throw new Error("ranges の start/end/step を正しく入力してください");
        }
        body.ranges = { start, end: endV, step };
      }

      const out = await createEvent(body, adminKey);

      msg.textContent = enableRanges
        ? "作成しました（レンジ子イベント生成中）…"
        : "作成しました。イベントへ移動します…";

      // レンジなら「親」に飛ぶ（まずはこれでOK）
      const parentId = out?.parent?.id;
      const singleId = out?.event?.id;

      const goId = parentId || singleId;
      if (!goId) throw new Error("created id not found");

      setTimeout(() => (location.href = `event.html?id=${goId}`), 300);
    } catch (err) {
      msg.textContent = String(err?.message || err);
    }
  });
});
