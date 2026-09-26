import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const loginSection = document.getElementById("loginSection");
const dashboardSection = document.getElementById("dashboardSection");
const loginForm = document.getElementById("loginForm");
const loginStatus = document.getElementById("loginStatus");
const logoutBtn = document.getElementById("logoutBtn");
const tableBody = document.getElementById("apptTableBody");
const dashboardStatus = document.getElementById("dashboardStatus");

let unsubscribeAppointments = null;

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginStatus.textContent = "";
  loginStatus.className = "form-status";

  const email = document.getElementById("adminEmail").value;
  const password = document.getElementById("adminPassword").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    console.error("Login failed:", err);
    loginStatus.textContent = `Login failed: ${err.code || err.message || "unknown error"}`;
    loginStatus.classList.add("error");
  }
});

logoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginSection.hidden = true;
    dashboardSection.hidden = false;
    logoutBtn.hidden = false;
    listenForAppointments();
  } else {
    loginSection.hidden = false;
    dashboardSection.hidden = true;
    logoutBtn.hidden = true;
    if (unsubscribeAppointments) unsubscribeAppointments();
  }
});

function listenForAppointments() {
  const q = query(collection(db, "appointments"), orderBy("apptDate"), orderBy("apptTime"));
  unsubscribeAppointments = onSnapshot(
    q,
    (snap) => {
      dashboardStatus.textContent = `${snap.size} appointment${snap.size === 1 ? "" : "s"}`;
      tableBody.innerHTML = "";
      snap.forEach((docSnap) => renderRow(docSnap.id, docSnap.data()));
    },
    (err) => {
      dashboardStatus.textContent = `Couldn't load appointments: ${err.code || ""} ${err.message || err}`;
      console.error(err);
    }
  );
}

function renderRow(id, appt) {
  const tr = document.createElement("tr");

  const statusOptions = ["pending", "confirmed", "completed", "cancelled"]
    .map((s) => `<option value="${s}" ${appt.status === s ? "selected" : ""}>${s}</option>`)
    .join("");

  tr.innerHTML = `
    <td>${escapeHtml(appt.apptDate ?? "")}</td>
    <td>${escapeHtml(appt.apptTime ?? "")}</td>
    <td>${escapeHtml(appt.fullName ?? "")}</td>
    <td>${escapeHtml(appt.cnic ?? "")}</td>
    <td>${escapeHtml(appt.phone ?? "")}</td>
    <td>${escapeHtml(appt.email ?? "")}</td>
    <td>${escapeHtml(appt.reason ?? "")}</td>
    <td>${escapeHtml(appt.notes ?? "")}</td>
    <td><select class="status-select">${statusOptions}</select></td>
    <td><button type="button" class="btn btn-ghost btn-sm delete-btn">Delete</button></td>
  `;

  tr.querySelector(".status-select").addEventListener("change", (e) => {
    updateDoc(doc(db, "appointments", id), { status: e.target.value }).catch((err) =>
      console.error("Status update failed:", err)
    );
  });

  tr.querySelector(".delete-btn").addEventListener("click", () => {
    if (confirm("Delete this appointment permanently?")) {
      deleteDoc(doc(db, "appointments", id)).catch((err) => console.error("Delete failed:", err));
    }
  });

  tableBody.appendChild(tr);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
