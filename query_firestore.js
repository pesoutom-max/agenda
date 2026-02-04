import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, getDocs, query, where, initializeFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, { experimentalForceLongPolling: true });

async function check() {
    console.log("Fetching appointments...");
    const q = query(collection(db, "appointments"), where("status", "==", "confirmed"));
    const snap = await getDocs(q);
    snap.forEach(doc => {
        console.log(`ID: ${doc.id}, Date: ${doc.data().date}, Time: ${doc.data().time}, Name: ${doc.data().patientName}`);
    });
    process.exit(0);
}
check();
