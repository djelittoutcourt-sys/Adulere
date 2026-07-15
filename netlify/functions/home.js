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

        // IMPORTANT : on garde l'id du document ici. Le JS client (loadVideos) en a besoin
        // pour rendre les cartes cliquables (lecture, likes, favoris) — sans ça, les cartes
        // préchargées s'affichaient mais restaient inertes.
        const videos = videosSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const categories = categoriesSnap.docs.map(d => ({
            name: d.data().name,
            image: d.data().image || ''
        }));
        const settings = settingsDoc.exists ? settingsDoc.data() : null;

        // On échappe "<" en \u003c dans le JSON avant de l'injecter dans la balise <script>.
        // Sans ça, un titre ou une description de vidéo contenant la séquence "</script>"
        // fermerait la balise en plein milieu et casserait tout le reste de la page
        // (y compris le vérificateur d'âge, qui ne recevrait alors plus jamais son script).
        const safeJson = JSON.stringify({ videos, categories, settings }).replace(/</g, '\\u003c');
        const preloadScript = `<script>window.__PRELOADED__ = ${safeJson};</script>\n    `;

        // Injecte le préchargement juste avant le script principal (celui qui contient
        // firebaseConfig). On cible '<script>\n        const firebaseConfig' précisément :
        // index.html contient d'autres balises <script src="..."> (SDK Firebase) et une
        // <script> tout à la fin (enregistrement du service worker) qu'il ne faut surtout
        // pas confondre avec elle.
        html = html.replace('<script>\n        const firebaseConfig', preloadScript + '<script>\n        const firebaseConfig');
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
