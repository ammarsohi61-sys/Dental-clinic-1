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
  addDoc,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
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

const adminTabs = document.getElementById("adminTabs");
const tabApptBtn = document.getElementById("tabApptBtn");
const tabRxBtn = document.getElementById("tabRxBtn");
const prescriptionsSection = document.getElementById("prescriptionsSection");
const prescriptionForm = document.getElementById("prescriptionForm");
const rxStatus = document.getElementById("rxStatus");
const rxTableBody = document.getElementById("rxTableBody");

let unsubscribeAppointments = null;
let unsubscribePrescriptions = null;

tabApptBtn.addEventListener("click", () => switchTab("appt"));
tabRxBtn.addEventListener("click", () => switchTab("rx"));

function switchTab(tab) {
  const showAppt = tab === "appt";
  dashboardSection.hidden = !showAppt;
  prescriptionsSection.hidden = showAppt;
  tabApptBtn.classList.toggle("active", showAppt);
  tabRxBtn.classList.toggle("active", !showAppt);
}

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
    adminTabs.hidden = false;
    logoutBtn.hidden = false;
    switchTab("appt");
    listenForAppointments();
    listenForPrescriptions();
  } else {
    loginSection.hidden = false;
    adminTabs.hidden = true;
    dashboardSection.hidden = true;
    prescriptionsSection.hidden = true;
    logoutBtn.hidden = true;
    if (unsubscribeAppointments) unsubscribeAppointments();
    if (unsubscribePrescriptions) unsubscribePrescriptions();
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

prescriptionForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  rxStatus.textContent = "";
  rxStatus.className = "form-status";

  const rx = {
    patientName: document.getElementById("rxPatientName").value.trim(),
    age: document.getElementById("rxAge").value.trim(),
    diagnosis: document.getElementById("rxDiagnosis").value.trim(),
    medicines: document.getElementById("rxMedicines").value.trim(),
    instructions: document.getElementById("rxInstructions").value.trim(),
    nextVisit: document.getElementById("rxNextVisit").value,
    createdAt: serverTimestamp(),
  };

  try {
    await addDoc(collection(db, "prescriptions"), rx);
    prescriptionForm.reset();
    rxStatus.textContent = "Prescription saved.";
    rxStatus.classList.add("success");
  } catch (err) {
    console.error("Saving prescription failed:", err);
    rxStatus.textContent = `Couldn't save: ${err.code || err.message || "unknown error"}`;
    rxStatus.classList.add("error");
  }
});

function listenForPrescriptions() {
  const q = query(collection(db, "prescriptions"), orderBy("createdAt", "desc"));
  unsubscribePrescriptions = onSnapshot(
    q,
    (snap) => {
      rxTableBody.innerHTML = "";
      snap.forEach((docSnap) => renderRxRow(docSnap.id, docSnap.data()));
    },
    (err) => {
      console.error("Couldn't load prescriptions:", err);
    }
  );
}

function renderRxRow(id, rx) {
  const tr = document.createElement("tr");
  const date = rx.createdAt?.toDate ? rx.createdAt.toDate().toLocaleDateString() : "";
  const medicinesHtml = escapeHtml(rx.medicines ?? "").replace(/\n/g, "<br>");

  tr.innerHTML = `
    <td>${escapeHtml(date)}</td>
    <td>${escapeHtml(rx.patientName ?? "")}</td>
    <td>${escapeHtml(rx.age ?? "")}</td>
    <td>${escapeHtml(rx.diagnosis ?? "")}</td>
    <td>${medicinesHtml}</td>
    <td>${escapeHtml(rx.instructions ?? "")}</td>
    <td>${escapeHtml(rx.nextVisit ?? "")}</td>
    <td><button type="button" class="btn btn-ghost btn-sm delete-btn">Delete</button></td>
  `;

  tr.querySelector(".delete-btn").addEventListener("click", () => {
    if (confirm("Delete this prescription permanently?")) {
      deleteDoc(doc(db, "prescriptions", id)).catch((err) =>
        console.error("Delete failed:", err)
      );
    }
  });

  rxTableBody.appendChild(tr);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
