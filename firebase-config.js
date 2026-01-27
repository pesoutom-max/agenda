// Configuración de Firebase - Cargada desde la consola
const firebaseConfig = {
  apiKey: "AIzaSyAg_FZL9SljS9RsaiXXRHCTt4L3ZXOl20Q",
  authDomain: "facilpyme-agenda.firebaseapp.com",
  projectId: "facilpyme-agenda",
  storageBucket: "facilpyme-agenda.firebasestorage.app",
  messagingSenderId: "256698206822",
  appId: "1:256698206822:web:bc4c254c156f0833463ba7"
};

// Exportar para usar en los otros archivos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = firebaseConfig;
}
