const firebaseConfig = {
  apiKey: "AIzaSyAg_FZL9SljS9RsaiXXRHCTt4L3ZXOl20Q",
  authDomain: "facilpyme-agenda.firebaseapp.com",
  projectId: "facilpyme-agenda",
  storageBucket: "facilpyme-agenda.firebasestorage.app",
  messagingSenderId: "256698206822",
  appId: "1:256698206822:web:bc4c254c156f0833463ba7"
};

const TIME_SLOTS = [
    "06:00", "06:45", "07:30", "08:15",
    "09:00", "09:45", "10:30", "11:15",
    "12:00", "12:45", "13:30", "14:15",
    "15:00", "15:45", "16:30", "17:15",
    "18:00", "18:45", "19:30", "20:15",
    "21:00", "21:45"
];

// Export for module and non-module scripts
if (typeof exports !== 'undefined') {
    exports.firebaseConfig = firebaseConfig;
    exports.TIME_SLOTS = TIME_SLOTS;
}
window.firebaseConfig = firebaseConfig;
window.TIME_SLOTS = TIME_SLOTS;
