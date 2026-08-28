// firebase-messaging-sw.js
// This file MUST be in the ROOT of your website (same folder as index.html)
// It runs in the background and receives FCM push notifications even when the app is closed

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Same config as your dashboard
firebase.initializeApp({
    apiKey: "AIzaSyAuL53PJJP8DFMBxh7H1fOLiU__KxknUKo",
    authDomain: "safetymonitor-d2303.firebaseapp.com",
    projectId: "safetymonitor-d2303",
    storageBucket: "safetymonitor-d2303.firebasestorage.app",
    messagingSenderId: "913714799421",
    appId: "1:913714799421:web:f467591c356c6ac73d9b54",
    measurementId: "G-58KY18DW67"
});

const messaging = firebase.messaging();

// Handle background messages (app is closed or minimized)
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Background message:', payload);

    const notificationTitle = payload.notification.title || 'Safety Alert';
    const notificationOptions = {
        body: payload.notification.body || 'New alert from Safety Monitor',
        icon: 'https://cdn-icons-png.flaticon.com/512/2964/2964514.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/2964/2964514.png',
        tag: 'safety-alert-' + Date.now(),
        requireInteraction: true,
        vibrate: [300, 100, 300, 100, 500],
        data: payload.data || {}
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // If app is already open, focus it
            for (const client of clientList) {
                if (client.url.includes('index.html') || client.url.includes('dashboard')) {
                    return client.focus();
                }
            }
            // Otherwise open new window
            return clients.openWindow('./');
        })
    );
});
