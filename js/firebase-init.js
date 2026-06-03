import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = window.firebaseConfig || {
  apiKey: "AIzaSyAg_FZL9SljS9RsaiXXRHCTt4L3ZXOl20Q",
  authDomain: "facilpyme-agenda.firebaseapp.com",
  projectId: "facilpyme-agenda",
  storageBucket: "facilpyme-agenda.firebasestorage.app",
  messagingSenderId: "256698206822",
  appId: "1:256698206822:web:bc4c254c156f0833463ba7"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db, app };
