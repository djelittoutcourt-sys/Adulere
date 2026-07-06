const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialise firebase-admin une seule fois (réutilisé entre les appels si la fonction reste "chaude")
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            // Les retours à la ligne de la clé privée sont échappés dans les variables d'env Netlify
            privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
        }),
    });
}

const db = admin.firestore();

exports.handler = async function () {
    // Le fichier index.html est packagé avec la fonction (voir netlify.toml -> included_files)
    let html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

    try {
        const [videosSnap, categoriesSnap, settingsDoc] = await Promise.all([
            db.collection('videos').orderBy('views', 'desc').limit(6).get(),
            db.collection('categories').get(),
            db.collection('settings').doc('site').get(),
        ]);

        const videos = videosSnap.docs.map(d => d.data());
        const categories = categoriesSnap.docs.map(d => ({
            name: d.data().name,
            image: d.data().image || ''
        }));
        const settings = settingsDoc.exists ? settingsDoc.data() : null;

        const preloadScript = `<script>window.__PRELOADED__ = ${JSON.stringify({ videos, categories, settings })};</script>\n    `;

        // Injecte le script de préchargement juste avant le tout premier <script> du fichier
        html = html.replace('<script>', preloadScript + '<script>');
    } catch (e) {
        // Si Firestore échoue côté serveur (ex: identifiants manquants), on renvoie quand même
        // le HTML normal : le JS client fera sa propre requête Firestore comme avant, en secours.
        console.error('Erreur préchargement Firestore :', e);
    }

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            // Le CDN Netlify garde la réponse 60s et la rafraîchit en arrière-plan (stale-while-revalidate)
            'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300'
        },
        body: html
    };
};
