/* =========================================================
   DATABASE (Firebase Firestore)
   Booking data is saved here so it isn't lost after the email
   fires, and so already-booked time slots can be blocked for
   everyone else. See firebase-config.js and firestore.rules.
========================================================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// Returns a Set of "HH:MM" times already booked for the given date.
async function fetchBookedTimes(dateStr) {
  try {
    const q = query(collection(db, "bookedSlots"), where("apptDate", "==", dateStr));
    const snap = await getDocs(q);
    return new Set(snap.docs.map((d) => d.data().apptTime));
  } catch (err) {
    console.error("Could not check slot availability:", err);
    return new Set(); // fail open — don't block booking if the check fails
  }
}

// Re-checks right before saving, to close the race window between two
// people picking the same slot at nearly the same time.
async function isSlotTaken(dateStr, timeStr) {
  const q = query(
    collection(db, "bookedSlots"),
    where("apptDate", "==", dateStr),
    where("apptTime", "==", timeStr)
  );
  const snap = await getDocs(q);
  return !snap.empty;
}

// Saves the appointment: a public slim record (for slot-blocking) and
// a private full record (for the admin dashboard).
async function saveBookingToDatabase(data) {
  await Promise.all([
    addDoc(collection(db, "bookedSlots"), {
      apptDate: data.apptDate,
      apptTime: data.apptTime,
    }),
    addDoc(collection(db, "appointments"), {
      ...data,
      status: "pending",
      createdAt: serverTimestamp(),
    }),
  ]);
}

/* =========================================================
   CLINIC HOURS — edit this to match your real schedule
   Times are 24-hour "HH:MM". Set open:false for closed days.
========================================================= */
const CLINIC_HOURS = {
  0: { label: "Sunday",    open: false, start: null,    end: null   }, // Sunday closed
  1: { label: "Monday",    open: true,  start: "10:00", end: "20:00" },
  2: { label: "Tuesday",   open: true,  start: "10:00", end: "20:00" },
  3: { label: "Wednesday", open: true,  start: "10:00", end: "20:00" },
  4: { label: "Thursday",  open: true,  start: "10:00", end: "20:00" },
  5: { label: "Friday",    open: true,  start: "10:00", end: "20:00" },
  6: { label: "Saturday",  open: true,  start: "10:00", end: "20:00" },
};

const SLOT_INTERVAL_MINUTES = 30;

/* =========================================================
   BOOKING DELIVERY — where appointment requests go
   Email uses FormSubmit.co (no signup needed) sending straight
   to your inbox. IMPORTANT: the very first submission after
   this goes live will trigger a one-time confirmation email
   from FormSubmit to ammarfarooq3595@gmail.com — you must click
   the "Activate Form" link inside it once, or future emails
   won't arrive.

   PATIENT CONFIRMATION EMAILS: the booking form now collects the
   patient's email address. FormSubmit reads that field and sends
   the patient an automatic confirmation email too (the message
   text is set below as "_autoresponse" in initBookingForm). No
   extra setup needed beyond the one-time activation above.
========================================================= */
const BOOKING_EMAIL_ENDPOINT = "https://formsubmit.co/ajax/ammarfarooq3595@gmail.com";
const CLINIC_WHATSAPP_NUMBER = "923226408097"; // no + or leading zero

// Sends the booking notification + patient auto-reply via FormSubmit.
// Pulled out into its own function (and awaited, response checked) so:
//   1. It can run in parallel with the database save instead of only
//      firing after the save succeeds — previously, if Firestore failed
//      for any reason, this code was never reached at all.
//   2. A failed send (bad recipient, FormSubmit not yet activated, etc.)
//      is actually detected instead of being silently swallowed.
async function sendBookingEmail(data) {
  const payload = {
    ...data,
    _subject: `New appointment request — ${data.fullName} — ${formatDisplayDate(data.apptDate)} ${data.apptTime}`,
    _autoresponse: `Hi ${data.fullName.split(" ")[0]}, thanks for booking with Dr. Hammad Dental Clinic! ` +
      `We've received your request for ${formatDisplayDate(data.apptDate)} at ${data.apptTime} ` +
      `(${data.reason}). We'll confirm shortly by phone or WhatsApp. If you need to change anything, ` +
      `just reply to this email or message us on WhatsApp: https://wa.me/${CLINIC_WHATSAPP_NUMBER}`,
  };

  const res = await fetch(BOOKING_EMAIL_ENDPOINT, {
    method: "POST",
    headers: { Accept: "application/json" },
    body: (() => {
      const fd = new FormData();
      Object.entries(payload).forEach(([key, value]) => fd.append(key, value));
      return fd;
    })(),
  });

  if (!res.ok) {
    throw new Error(`FormSubmit responded with status ${res.status}`);
  }
  return res;
}

const WA_ICON_SVG = '<svg class="wa-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M16.004 3C9.377 3 4 8.373 4 15c0 2.34.653 4.527 1.786 6.393L4 29l7.81-1.75A11.93 11.93 0 0 0 16.004 27C22.63 27 28 21.627 28 15S22.63 3 16.004 3Zm0 21.818a9.78 9.78 0 0 1-4.99-1.365l-.358-.213-4.633 1.038 1.06-4.51-.234-.372A9.77 9.77 0 0 1 5.182 15c0-5.965 4.856-10.818 10.822-10.818S26.818 9.035 26.818 15 21.97 24.818 16.004 24.818Zm5.66-7.32c-.31-.155-1.833-.905-2.117-1.008-.284-.104-.49-.155-.697.155-.207.31-.8 1.008-.98 1.215-.18.207-.362.233-.672.078-.31-.156-1.309-.483-2.494-1.54-.922-.822-1.545-1.837-1.726-2.147-.18-.31-.02-.478.136-.633.14-.14.31-.362.465-.543.155-.18.207-.31.31-.517.104-.207.052-.388-.026-.543-.078-.155-.697-1.68-.955-2.302-.252-.605-.508-.523-.697-.533l-.594-.01c-.207 0-.543.078-.827.388-.284.31-1.084 1.06-1.084 2.585s1.11 3 1.265 3.208c.155.207 2.185 3.337 5.293 4.68.74.32 1.317.51 1.767.653.742.236 1.418.203 1.952.123.596-.089 1.833-.75 2.092-1.474.258-.724.258-1.345.181-1.474-.078-.129-.284-.207-.594-.362Z"/></svg>';

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("year").textContent = new Date().getFullYear();

  initNavToggle();
  initSmoothNavClose();
  renderHoursTable();
  initOpenClosedStatus();
  initScrollReveal();
  initBookingForm();
  initLightbox();
});

/* =========================================================
   MOBILE NAV TOGGLE
========================================================= */
function initNavToggle() {
  const toggle = document.getElementById("navToggle");
  const nav = document.getElementById("mainNav");

  toggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(isOpen));
  });
}

function initSmoothNavClose() {
  const nav = document.getElementById("mainNav");
  const toggle = document.getElementById("navToggle");
  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    });
  });
}

/* =========================================================
   HOURS TABLE
========================================================= */
function renderHoursTable() {
  const tbody = document.querySelector("#hoursTable tbody");
  const today = new Date().getDay();
  tbody.innerHTML = "";

  for (let i = 0; i < 7; i++) {
    const day = CLINIC_HOURS[i];
    const row = document.createElement("tr");
    if (i === today) row.classList.add("today");

    const nameCell = document.createElement("td");
    nameCell.textContent = day.label;

    const timeCell = document.createElement("td");
    if (day.open) {
      timeCell.textContent = `${formatTime(day.start)} – ${formatTime(day.end)}`;
    } else {
      timeCell.textContent = "Closed";
      timeCell.classList.add("closed-cell");
    }

    row.append(nameCell, timeCell);
    tbody.appendChild(row);
  }
}

function formatTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

/* =========================================================
   LIVE OPEN / CLOSED STATUS BADGE
========================================================= */
function initOpenClosedStatus() {
  updateStatus();
  setInterval(updateStatus, 60 * 1000); // refresh every minute
}

function updateStatus() {
  const now = new Date();
  const day = CLINIC_HOURS[now.getDay()];
  const dot = document.getElementById("statusDot");
  const text = document.getElementById("statusText");
  const contactStatus = document.getElementById("contactStatus");

  let isOpen = false;
  let message = "";

  if (day.open) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = day.start.split(":").map(Number);
    const [endH, endM] = day.end.split(":").map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (nowMinutes >= startMinutes && nowMinutes < endMinutes) {
      isOpen = true;
      message = `Open now · closes ${formatTime(day.end)}`;
    } else if (nowMinutes < startMinutes) {
      message = `Closed · opens ${formatTime(day.start)}`;
    } else {
      message = "Closed for today";
    }
  } else {
    message = "Closed today";
  }

  dot.classList.toggle("open", isOpen);
  dot.classList.toggle("closed", !isOpen);
  text.textContent = message;
  if (contactStatus) contactStatus.textContent = message;
}

/* =========================================================
   SCROLL REVEAL
========================================================= */
function initScrollReveal() {
  const targets = document.querySelectorAll(
    ".section-inner, .surgery-card, .service-card, .timeline-item"
  );
  targets.forEach((el) => el.classList.add("reveal"));

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );

  targets.forEach((el) => observer.observe(el));
}

/* =========================================================
   BOOKING FORM — date, dynamic time slots, validation
========================================================= */
function initBookingForm() {
  const form = document.getElementById("bookingForm");
  const dateInput = document.getElementById("apptDate");
  const slotsWrap = document.getElementById("timeSlots");
  const apptTimeHidden = document.getElementById("apptTime");
  const statusEl = document.getElementById("formStatus");

  // Restrict date picker: today → 60 days ahead
  const today = new Date();
  const maxDate = new Date();
  maxDate.setDate(today.getDate() + 60);
  dateInput.min = toISODate(today);
  dateInput.max = toISODate(maxDate);

  dateInput.addEventListener("change", () => {
    apptTimeHidden.value = "";
    renderTimeSlots(dateInput.value, slotsWrap, apptTimeHidden);
  });

  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    statusEl.textContent = "";
    statusEl.className = "form-status";

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (!apptTimeHidden.value) {
      statusEl.textContent = "Please select an available time slot.";
      statusEl.classList.add("error");
      return;
    }

    const data = Object.fromEntries(new FormData(form).entries());

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    // Re-check availability right before saving, in case someone else
    // booked this exact slot in the last few seconds.
    const taken = await isSlotTaken(data.apptDate, data.apptTime);
    if (taken) {
      statusEl.textContent = "Sorry, that slot was just booked by someone else — please pick another.";
      statusEl.classList.add("error");
      submitBtn.disabled = false;
      submitBtn.textContent = "Confirm Appointment";
      apptTimeHidden.value = "";
      renderTimeSlots(dateInput.value, slotsWrap, apptTimeHidden);
      return;
    }

    // Run the database save and the email send side by side. Previously
    // the email fetch() was placed *after* the database try/catch and
    // only ran if the save succeeded — so a Firestore problem (e.g. an
    // unconfigured firebase-config.js) silently skipped the email too.
    // Promise.allSettled lets each succeed or fail independently.
    const [dbResult, emailResult] = await Promise.allSettled([
      withTimeout(saveBookingToDatabase(data), 15000, "Database save"),
      withTimeout(sendBookingEmail(data), 15000, "Email send"),
    ]);

    const dbOk = dbResult.status === "fulfilled";
    const emailOk = emailResult.status === "fulfilled";

    if (!dbOk) console.error("Database save failed:", dbResult.reason);
    if (!emailOk) console.error("Email send failed:", emailResult.reason);

    const waLink = buildWhatsAppLink(data);

    if (dbOk || emailOk) {
      // The patient's booking got through on at least one channel, so
      // confirm it to them either way — don't make the confirmation
      // depend on Firestore specifically when the email notification
      // (a separate, working channel) already reached the clinic.
      let notice = "";
      if (emailOk && !dbOk) {
        notice =
          `<br><span class="status-detail">Note: this booking wasn't saved to the online system, so it won't show ` +
          `in the admin dashboard or block this slot for other patients — the clinic was notified by email instead. ` +
          `${escapeStatusText(dbResult.reason?.message || String(dbResult.reason))}</span>`;
      } else if (dbOk && !emailOk) {
        notice =
          `<br><span class="status-detail">Note: the confirmation email didn't go out just now. ` +
          `${escapeStatusText(emailResult.reason?.message || String(emailResult.reason))}</span>`;
      }

      statusEl.innerHTML =
        `Thank you, ${data.fullName.split(" ")[0]}! Your appointment for ` +
        `${formatDisplayDate(data.apptDate)} at ${data.apptTime} is booked. ` +
        (emailOk ? `A confirmation email is on its way to ${data.email}. ` : "") +
        notice +
        `<br><a href="${waLink}" target="_blank" rel="noopener" class="wa-followup">${WA_ICON_SVG} Also confirm it instantly on WhatsApp →</a>`;
      statusEl.classList.add("success");
      form.reset();
      slotsWrap.innerHTML = `<p class="slots-placeholder">Select a date to see available times.</p>`;
    } else {
      // Both the database save AND the email failed — nothing got
      // through, so this is the only case that shows a real error.
      const rawError = dbResult.reason?.message || String(dbResult.reason);
      const errCode = dbResult.reason?.code || "";
      let hint = "Check the browser console (F12) for the full error.";
      if (errCode.includes("permission-denied")) {
        hint = "This usually means the Firestore security rules haven't been published yet — Firebase Console → Firestore Database → Rules tab → paste in firestore.rules → Publish.";
      } else if (errCode.includes("api-key") || errCode.includes("invalid-argument")) {
        hint = "This usually means firebase-config.js still has placeholder or incorrect values — double-check every field against Firebase Console → Project Settings → General → Your apps.";
      } else if (errCode.includes("not-found") || errCode.includes("unavailable")) {
        hint = "This usually means no Firestore database has been created yet for this project — Firebase Console → Firestore Database → Create database.";
      }

      statusEl.innerHTML =
        `We couldn't save your booking right now. ` +
        `<br><span class="status-detail">Error: ${escapeStatusText(rawError)}<br>${hint}</span>` +
        `<br>Please <a href="${waLink}" target="_blank" rel="noopener" class="wa-followup">${WA_ICON_SVG} send it via WhatsApp instead →</a>`;
      statusEl.classList.add("error");
    }

    submitBtn.disabled = false;
    submitBtn.textContent = "Confirm Appointment";
  });
}

function buildWhatsAppLink(data) {
  const message =
    `New appointment request\n` +
    `Name: ${data.fullName}\n` +
    `CNIC: ${data.cnic}\n` +
    `Phone: ${data.phone}\n` +
    `Email: ${data.email}\n` +
    `Date: ${formatDisplayDate(data.apptDate)}\n` +
    `Time: ${data.apptTime}\n` +
    `Reason: ${data.reason}` +
    (data.notes ? `\nNotes: ${data.notes}` : "");
  return `https://wa.me/${CLINIC_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

async function renderTimeSlots(dateStr, container, hiddenInput) {
  container.innerHTML = "";

  if (!dateStr) {
    container.innerHTML = `<p class="slots-placeholder">Select a date to see available times.</p>`;
    return;
  }

  const selectedDate = parseISODate(dateStr);
  const dayInfo = CLINIC_HOURS[selectedDate.getDay()];

  if (!dayInfo.open) {
    container.innerHTML = `<p class="slots-placeholder">We're closed on ${dayInfo.label}s. Please choose another date.</p>`;
    return;
  }

  container.innerHTML = `<p class="slots-placeholder">Checking availability…</p>`;
  const bookedTimes = await fetchBookedTimes(dateStr);
  container.innerHTML = "";

  const slots = generateSlots(dayInfo.start, dayInfo.end, SLOT_INTERVAL_MINUTES);
  const now = new Date();
  const isToday = isSameDate(selectedDate, now);

  slots.forEach((slot) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slot-btn";
    btn.textContent = formatTime(slot);

    // Disable past time slots if the date is today
    if (isToday) {
      const [h, m] = slot.split(":").map(Number);
      const slotMinutes = h * 60 + m;
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      if (slotMinutes <= nowMinutes) btn.disabled = true;
    }

    // Disable slots already booked by someone else
    if (bookedTimes.has(formatTime(slot))) {
      btn.disabled = true;
      btn.classList.add("slot-taken");
      btn.title = "Already booked";
    }

    btn.addEventListener("click", () => {
      container
        .querySelectorAll(".slot-btn")
        .forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      hiddenInput.value = formatTime(slot);
    });

    container.appendChild(btn);
  });

  if (container.children.length === 0) {
    container.innerHTML = `<p class="slots-placeholder">No slots available for this date.</p>`;
  }
}

function generateSlots(start, end, intervalMinutes) {
  const slots = [];
  let [h, m] = start.split(":").map(Number);
  const [endH, endM] = end.split(":").map(Number);
  const endTotal = endH * 60 + endM;

  let current = h * 60 + m;
  while (current < endTotal) {
    const hh = String(Math.floor(current / 60)).padStart(2, "0");
    const mm = String(current % 60).padStart(2, "0");
    slots.push(`${hh}:${mm}`);
    current += intervalMinutes;
  }
  return slots;
}

function escapeStatusText(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

// Wraps a promise so it always settles within `ms` milliseconds — used
// below so a stuck network request (e.g. a misconfigured Firebase
// project that retries silently instead of failing fast) can't leave
// the submit button reading "Sending…" forever. The underlying request
// keeps running in the background even after this "gives up" on it.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms / 1000}s. Check your internet connection and Firebase project setup.`)),
        ms
      )
    ),
  ]);
}

/* =========================================================
   DATE HELPERS
========================================================= */
function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseISODate(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isSameDate(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDisplayDate(str) {
  const date = parseISODate(str);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/* =========================================================
   LIGHTBOX — certificate wall + PMDC license viewer
   (HD: images render at their native/full resolution, no
   downscale compression — see .lightbox img / .frame-card img
   in styles.css for the crisp rendering rules)
========================================================= */
function initLightbox() {
  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightboxImg");
  const lightboxCaption = document.getElementById("lightboxCaption");
  const closeBtn = document.getElementById("lightboxClose");

  function openLightbox(src, caption) {
    lightboxImg.src = src;
    lightboxImg.alt = caption || "";
    lightboxCaption.textContent = caption || "";
    lightbox.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    lightbox.classList.remove("open");
    document.body.style.overflow = "";
    lightboxImg.src = "";
  }

  document.querySelectorAll(".frame-card, .timeline-photo-frame").forEach((card) => {
    card.addEventListener("click", () => {
      openLightbox(card.dataset.full, card.dataset.caption);
    });
  });

  const licenseBtn = document.getElementById("viewLicense");
  if (licenseBtn) {
    licenseBtn.addEventListener("click", () => {
      openLightbox(
        "pmdc-permanent-license.jpg",
        "PMDC Permanent Certificate of Dental Registration"
      );
    });
  }

  closeBtn.addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lightbox.classList.contains("open")) closeLightbox();
  });
}

/* =========================================================
   SPLASH / LOADER — hides once the page has finished loading
========================================================= */
(function initSiteLoader() {
  const loader = document.getElementById("siteLoader");
  if (!loader) return;

  const hideLoader = () => loader.classList.add("loaded");

  // Hide once everything (images etc.) has loaded, but never make
  // the visitor wait more than 2.5s for it either way.
  window.addEventListener("load", hideLoader);
  setTimeout(hideLoader, 2500);
})();
